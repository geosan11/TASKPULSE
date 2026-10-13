import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

// =========================================================================
// SELF-CONTAINED SERVERLESS HELPERS (ZERO RELATIVE IMPORT ISSUES ON VERCEL)
// =========================================================================

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    Object.setPrototypeOf(this, HttpError.prototype);
  }
}

function handleApiError(res: VercelResponse, err: any) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ status: false, message: err.message });
  }
  const message = err?.message || 'Internal server error';
  console.error('[API Error: initialize-deposit]', err);
  return res.status(500).json({ status: false, message });
}

let _adminClient: SupabaseClient | null = null;
function getSupabaseClient(userToken?: string): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_KEY;

  if (url && serviceKey) {
    if (_adminClient && !userToken) return _adminClient;
    const client = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    if (!userToken) _adminClient = client;
    return client;
  }

  // Fallback: If service_role key has not yet been added to Vercel,
  // authenticate using anon key + user bearer token
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || (!serviceKey && !anonKey)) {
    throw new Error('Database server misconfiguration: SUPABASE_URL or Supabase API keys are missing. In Vercel Project Settings > Environment Variables, please add SUPABASE_SERVICE_ROLE_KEY.');
  }

  return createClient(url, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: userToken ? { headers: { Authorization: `Bearer ${userToken}` } } : undefined
  });
}

async function requireUser(req: VercelRequest): Promise<{ user: User; token: string }> {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!headerValue || !headerValue.toLowerCase().startsWith('bearer ')) {
    throw new HttpError(401, 'Authentication required. Please sign in.');
  }
  const token = headerValue.slice(7).trim();
  if (!token) throw new HttpError(401, 'Authentication token missing.');
  const client = getSupabaseClient(token);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, 'Session invalid or expired. Please sign in again.');
  return { user: data.user, token };
}

function getPaystackSecretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new HttpError(500, 'PAYSTACK_SECRET_KEY is not configured on the server. Please add PAYSTACK_SECRET_KEY in Vercel Project Settings > Environment Variables.');
  return key;
}

async function paystackRequest<T = any>(
  path: string,
  options: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: any; headers?: Record<string, string> } = {}
): Promise<{ ok: boolean; status: number; data: T }> {
  const secretKey = getPaystackSecretKey();
  const url = path.startsWith('http') ? path : `https://api.paystack.co${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data: any = null;
  try { data = await res.json(); } catch { data = null; }
  return { ok: res.ok, status: res.status, data };
}

// =========================================================================
// HANDLER: INITIALIZE DEPOSIT
// =========================================================================

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: false, message: 'Method Not Allowed' });
  }

  try {
    const { user, token } = await requireUser(req);
    const email = user.email;
    if (!email) {
      throw new HttpError(400, 'Your user profile does not have an email address associated.');
    }

    const client = getSupabaseClient(token);

    // Check user profile activation status
    const { data: profile, error: profileErr } = await client
      .from('profiles')
      .select('is_activated, withdrawable_balance')
      .eq('id', user.id)
      .single();

    if (profileErr || !profile) {
      throw new HttpError(404, 'User profile not found in database.');
    }

    const rawAmount = req.body?.amount !== undefined ? Number(req.body.amount) : 3000;
    if (isNaN(rawAmount) || rawAmount !== Math.floor(rawAmount)) {
      throw new HttpError(400, 'Deposit amount must be a whole Naira number.');
    }

    let enforcedAmount: number;
    if (!profile.is_activated) {
      // Must be exactly ₦3,000 for activation
      enforcedAmount = 3000;
    } else {
      if (rawAmount < 1000 || rawAmount > 500000) {
        throw new HttpError(400, 'Top-up deposit must be between ₦1,000 and ₦500,000.');
      }
      enforcedAmount = rawAmount;
    }

    // Generate unique deposit reference
    const depositRef = `dep_${crypto.randomUUID().replace(/-/g, '')}`;

    // Record pending transaction in Supabase with row-level locks
    const { error: rpcErr } = await client.rpc('create_pending_deposit', {
      p_user_id: user.id,
      p_reference: depositRef,
      p_amount: enforcedAmount,
    });

    if (rpcErr) {
      throw new HttpError(400, `Could not initiate deposit: ${rpcErr.message}`);
    }

    // Determine return / callback URL
    const origin =
      process.env.APP_URL ||
      (req.headers['x-forwarded-proto'] && req.headers.host
        ? `${req.headers['x-forwarded-proto']}://${req.headers.host}`
        : req.headers.host
        ? `https://${req.headers.host}`
        : 'http://localhost:3000');
    const callbackUrl = `${origin.replace(/\/$/, '')}/?verify_deposit=${encodeURIComponent(depositRef)}`;

    // Call Paystack Initialize
    const paystackRes = await paystackRequest<{
      status: boolean;
      message: string;
      data?: {
        authorization_url: string;
        access_code: string;
        reference: string;
      };
    }>('/transaction/initialize', {
      method: 'POST',
      body: {
        email,
        amount: Math.round(enforcedAmount * 100), // in kobo
        reference: depositRef,
        currency: 'NGN',
        callback_url: callbackUrl,
        metadata: {
          app: 'TaskPulse',
          user_id: user.id,
          type: profile.is_activated ? 'wallet_topup' : 'activation_deposit',
          amount_naira: enforcedAmount,
        },
      },
    });

    if (!paystackRes.ok || !paystackRes.data?.status || !paystackRes.data.data) {
      throw new HttpError(
        502,
        paystackRes.data?.message || 'Paystack payment initialization failed. Please try again.'
      );
    }

    return res.status(200).json({
      status: true,
      message: 'Deposit initialized successfully.',
      data: {
        authorization_url: paystackRes.data.data.authorization_url,
        access_code: paystackRes.data.data.access_code,
        reference: depositRef,
        amount: enforcedAmount,
      },
    });
  } catch (err: any) {
    return handleApiError(res, err);
  }
}

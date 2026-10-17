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
// HANDLER: INITIALIZE CAMPAIGN FUNDING (BUSINESS CHECKOUT)
// =========================================================================
// TaskPulse is free to join: users no longer deposit. This endpoint now only
// starts a Paystack checkout for a BUSINESS funding one of its own task
// campaigns. The amount is never taken from the request: it is the
// campaign's total_charge, computed in the database by create_campaign()
// (reward x slots x (1 + platform fee)).

function hasServiceRoleKey(): boolean {
  return Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_KEY ||
      process.env.SUPABASE_SECRET_KEY ||
      process.env.SERVICE_ROLE_KEY ||
      process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_KEY
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

    const campaignId = req.body?.campaignId;
    if (!campaignId || typeof campaignId !== 'string' || !UUID_RE.test(campaignId)) {
      // Old clients still POST { amount } for activation/top-up deposits.
      throw new HttpError(
        410,
        'Deposits are no longer required. TaskPulse is free to join. Businesses fund task campaigns from the "For Businesses" tab.'
      );
    }

    if (!hasServiceRoleKey()) {
      throw new HttpError(500, 'SUPABASE_SERVICE_ROLE_KEY is not configured on the server. Add it in Vercel Project Settings > Environment Variables.');
    }

    const client = getSupabaseClient(token);

    // Unique checkout reference. The 'camp_' prefix routes verification and
    // webhooks to settle_campaign_funding().
    const reference = `camp_${crypto.randomUUID().replace(/-/g, '')}`;

    // Ownership + status are checked inside the RPC under a row lock; it also
    // returns the authoritative amount to charge.
    const { data: payment, error: rpcErr } = await client.rpc('create_campaign_payment', {
      p_user_id: user.id,
      p_campaign_id: campaignId,
      p_reference: reference,
    });

    if (rpcErr) {
      const msg = rpcErr.message || '';
      if (msg.includes('campaign_not_found')) throw new HttpError(404, 'Campaign not found.');
      if (msg.includes('not_campaign_owner')) throw new HttpError(403, 'You can only fund your own campaigns.');
      if (msg.includes('campaign_already_funded')) throw new HttpError(409, 'This campaign is already funded.');
      throw new HttpError(400, `Could not start campaign payment: ${msg}`);
    }

    const amountNaira = Number(payment?.amount);
    if (!amountNaira || amountNaira <= 0 || amountNaira !== Math.floor(amountNaira)) {
      throw new HttpError(500, 'Campaign amount is invalid. Please contact support.');
    }

    const origin =
      process.env.APP_URL ||
      (req.headers['x-forwarded-proto'] && req.headers.host
        ? `${req.headers['x-forwarded-proto']}://${req.headers.host}`
        : req.headers.host
        ? `https://${req.headers.host}`
        : 'http://localhost:3000');
    const callbackUrl = `${origin.replace(/\/$/, '')}/?verify_payment=${encodeURIComponent(reference)}`;

    const paystackRes = await paystackRequest<{
      status: boolean;
      message: string;
      data?: { authorization_url: string; access_code: string; reference: string };
    }>('/transaction/initialize', {
      method: 'POST',
      body: {
        email,
        amount: Math.round(amountNaira * 100), // kobo
        reference,
        currency: 'NGN',
        callback_url: callbackUrl,
        metadata: {
          app: 'TaskPulse',
          user_id: user.id,
          type: 'campaign_funding',
          campaign_id: campaignId,
          amount_naira: amountNaira,
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
      message: 'Campaign checkout initialized.',
      data: {
        authorization_url: paystackRes.data.data.authorization_url,
        access_code: paystackRes.data.data.access_code,
        reference,
        amount: amountNaira,
        campaign_id: campaignId,
      },
    });
  } catch (err: any) {
    return handleApiError(res, err);
  }
}

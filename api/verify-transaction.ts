import type { VercelRequest, VercelResponse } from '@vercel/node';
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
  console.error('[API Error: verify-transaction]', err);
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

  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || (!serviceKey && !anonKey)) {
    throw new Error('Database server misconfiguration: SUPABASE_URL or Supabase API keys are missing. In Vercel Project Settings > Environment Variables, please add SUPABASE_SERVICE_ROLE_KEY.');
  }

  return createClient(url, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: userToken ? { headers: { Authorization: `Bearer ${userToken}` } } : undefined
  });
}

async function getOptionalUser(req: VercelRequest): Promise<{ user: User | null; token?: string }> {
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    if (!headerValue || !headerValue.toLowerCase().startsWith('bearer ')) {
      return { user: null };
    }
    const token = headerValue.slice(7).trim();
    if (!token) return { user: null };
    const client = getSupabaseClient(token);
    const { data } = await client.auth.getUser(token);
    return { user: data?.user || null, token };
  } catch {
    return { user: null };
  }
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
// HANDLER: VERIFY TRANSACTION
// =========================================================================

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: false, message: 'Method Not Allowed' });
  }

  try {
    const { user: optionalUser, token: userToken } = await getOptionalUser(req);
    const reference = req.body?.reference || req.query?.reference;

    if (!reference || typeof reference !== 'string') {
      throw new HttpError(400, 'Transaction reference is required.');
    }

    const client = getSupabaseClient(userToken);

    // 1. Verify directly with Paystack API
    const paystackRes = await paystackRequest<{
      status: boolean;
      message: string;
      data?: {
        status: string;
        amount: number; // kobo
        currency: string;
        reference: string;
        customer?: { email: string };
      };
    }>(`/transaction/verify/${encodeURIComponent(reference)}`);

    if (!paystackRes.ok || !paystackRes.data?.status || !paystackRes.data.data) {
      throw new HttpError(
        400,
        paystackRes.data?.message || 'Payment verification failed with payment gateway.'
      );
    }

    const txData = paystackRes.data.data;
    if (txData.status !== 'success') {
      throw new HttpError(400, `Payment is not completed. Current status: ${txData.status}`);
    }

    if (txData.currency !== 'NGN') {
      throw new HttpError(400, 'Invalid currency: only NGN transactions are accepted.');
    }

    const actualAmountNaira = Math.floor(txData.amount / 100);

    // 2. Call the database settle_deposit RPC with row locks and idempotency
    const { data: settleResult, error: settleErr } = await client.rpc('settle_deposit', {
      p_reference: reference,
      p_paid_amount: actualAmountNaira,
    });

    if (settleErr) {
      throw new HttpError(400, `Failed to settle deposit in database: ${settleErr.message}`);
    }

    // 3. Resolve target user ID from transaction record or auth session
    const { data: txRecord } = await client
      .from('transactions')
      .select('user_id')
      .eq('reference', reference)
      .maybeSingle();

    const targetUserId = txRecord?.user_id || optionalUser?.id;

    let updatedProfile = null;
    if (targetUserId) {
      const { data: prof } = await client
        .from('profiles')
        .select('is_activated, withdrawable_balance, tier_id')
        .eq('id', targetUserId)
        .maybeSingle();
      updatedProfile = prof;
    }

    return res.status(200).json({
      status: true,
      message: 'Deposit verified and credited successfully.',
      data: {
        reference,
        amount: actualAmountNaira,
        settleResult,
        profile: updatedProfile,
      },
    });
  } catch (err: any) {
    return handleApiError(res, err);
  }
}

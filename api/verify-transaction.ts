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
function getAdminClient(): SupabaseClient {
  if (_adminClient) return _adminClient;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Database server misconfiguration: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.');
  }
  _adminClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return _adminClient;
}

async function getOptionalUser(req: VercelRequest): Promise<User | null> {
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    if (!headerValue || !headerValue.toLowerCase().startsWith('bearer ')) {
      return null;
    }
    const token = headerValue.slice(7).trim();
    if (!token) return null;
    const admin = getAdminClient();
    const { data } = await admin.auth.getUser(token);
    return data?.user || null;
  } catch {
    return null;
  }
}

function getPaystackSecretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new HttpError(500, 'PAYSTACK_SECRET_KEY is not configured on the server.');
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
    const optionalUser = await getOptionalUser(req);
    const reference = req.body?.reference || req.query?.reference;

    if (!reference || typeof reference !== 'string') {
      throw new HttpError(400, 'Transaction reference is required.');
    }

    const admin = getAdminClient();

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
    const { data: settleResult, error: settleErr } = await admin.rpc('settle_deposit', {
      p_reference: reference,
      p_paid_amount: actualAmountNaira,
    });

    if (settleErr) {
      throw new HttpError(400, `Failed to settle deposit in database: ${settleErr.message}`);
    }

    // 3. Resolve target user ID from transaction record or auth session
    const { data: txRecord } = await admin
      .from('transactions')
      .select('user_id')
      .eq('reference', reference)
      .maybeSingle();

    const targetUserId = txRecord?.user_id || optionalUser?.id;

    let updatedProfile = null;
    if (targetUserId) {
      const { data: prof } = await admin
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

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
  console.error('[API Error: verify-transaction]', err);
  const raw = String(err?.message || '');
  const message = raw.startsWith('Server misconfiguration') ? raw : 'Internal server error';
  return res.status(500).json({ status: false, message });
}

// Server-side Supabase access ALWAYS uses the service-role key. Every money
// RPC (settle_*, request_cashout, finalize_cashout, save_verified_bank_account,
// create_campaign_payment) is granted to service_role only, so an anon-key
// fallback can never work and only hides misconfiguration until a real
// payment gets stuck. Prefer SUPABASE_SERVICE_ROLE_KEY: anything prefixed
// VITE_ is a candidate for inlining into the public browser bundle.
function readServiceRoleKey(): string | undefined {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SERVICE_ROLE_KEY ||
    legacyViteServiceKey()
  );
}

// Back-compat only: older setups stored the key as VITE_SUPABASE_SERVICE_ROLE_KEY.
// It is not referenced by any browser code, so it is not in the bundle today,
// but the name is a foot-gun. Rename it to SUPABASE_SERVICE_ROLE_KEY.
function legacyViteServiceKey(): string | undefined {
  const k = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  if (k) console.warn('[config] Using VITE_SUPABASE_SERVICE_ROLE_KEY. Rename it to SUPABASE_SERVICE_ROLE_KEY.');
  return k || undefined;
}

/** True when the key is a service-role/secret key (not an anon/publishable key). */
function isServiceRoleKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true;
  if (key.startsWith('sb_publishable_')) return false;
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
      return payload?.role === 'service_role';
    } catch {
      return false;
    }
  }
  return false;
}

let _adminClient: SupabaseClient | null = null;
function getSupabaseClient(_userToken?: string): SupabaseClient {
  if (_adminClient) return _adminClient;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = readServiceRoleKey();
  if (!url || !serviceKey) {
    throw new Error('Server misconfiguration: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in Vercel Project Settings > Environment Variables (Production), then redeploy.');
  }
  if (!isServiceRoleKey(serviceKey)) {
    throw new Error('Server misconfiguration: SUPABASE_SERVICE_ROLE_KEY is not a service-role key (looks like an anon/publishable key). Copy the service_role secret from Supabase > Project Settings > API.');
  }
  _adminClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _adminClient;
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
    signal: AbortSignal.timeout(8000),
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
    // Only our own checkout references can be settled here.
    if (!/^(dep|camp)_[A-Za-z0-9_-]{6,80}$/.test(reference)) {
      throw new HttpError(400, 'Unknown transaction reference.');
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
        requested_amount?: number; // kobo, before customer-borne fees
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

    // Paystack echoes the reference; refuse anything that does not match the
    // one we asked about (defence in depth against a proxy/cache mix-up).
    if (txData.reference && txData.reference !== reference) {
      throw new HttpError(400, 'Payment reference mismatch.');
    }

    // Amount is in kobo. When fees are passed to the customer, `amount`
    // includes the fee (e.g. 314721 for a N3,000 charge) and the database
    // accepts paid >= due, crediting only the amount due.
    const actualAmountNaira = Math.floor(Number(txData.amount) / 100);

    // 2. Route by reference prefix:
    //    camp_*  -> business campaign funding (escrow + publish task)
    //    dep_*   -> legacy user deposit started before the free-marketplace
    //               pivot (still honoured, credited once)
    const isCampaign = reference.startsWith('camp_');
    const { data: settleResult, error: settleErr } = await client.rpc(
      isCampaign ? 'settle_campaign_funding' : 'settle_deposit',
      { p_reference: reference, p_paid_amount: actualAmountNaira }
    );

    if (settleErr) {
      console.error('[verify-transaction] settle RPC error', reference, settleErr);
      throw new HttpError(500, 'We received your payment but could not apply it yet. It will be retried automatically; contact support with your reference if it stays pending.');
    }
    if (settleResult && settleResult.success === false) {
      const code = settleResult.error || 'settlement_failed';
      if (code === 'underpaid') {
        throw new HttpError(400, 'The amount paid is less than the amount due. Please contact support.');
      }
      throw new HttpError(400, `Payment could not be applied (${code}).`);
    }

    if (isCampaign) {
      return res.status(200).json({
        status: true,
        message: settleResult?.status === 'duplicate_needs_refund'
          ? 'This campaign was already funded. The extra payment is flagged for a refund.'
          : 'Campaign funded. Your task is now live for workers.',
        data: {
          kind: 'campaign',
          reference,
          amount: actualAmountNaira,
          campaign_id: settleResult?.campaign_id,
          settleResult,
        },
      });
    }

    // 3. Legacy deposit: return the refreshed wallet balance
    const { data: txRecord } = await client
      .from('transactions')
      .select('user_id')
      .eq('reference', reference)
      .maybeSingle();

    // Only return a balance to the signed-in owner of this deposit; the
    // endpoint is callable without auth (Paystack redirect), so never leak
    // another user's balance to whoever holds the reference.
    const targetUserId =
      optionalUser?.id && txRecord?.user_id === optionalUser.id ? optionalUser.id : null;

    let updatedProfile = null;
    if (targetUserId) {
      const { data: prof } = await client
        .from('profiles')
        .select('withdrawable_balance')
        .eq('id', targetUserId)
        .maybeSingle();
      updatedProfile = prof;
    }

    return res.status(200).json({
      status: true,
      message: 'Legacy deposit verified and credited to your wallet.',
      data: {
        kind: 'legacy_deposit',
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

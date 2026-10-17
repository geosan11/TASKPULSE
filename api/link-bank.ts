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
  console.error('[API Error: link-bank]', err);
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
    signal: AbortSignal.timeout(8000),
  });
  let data: any = null;
  try { data = await res.json(); } catch { data = null; }
  return { ok: res.ok, status: res.status, data };
}

// =========================================================================
// HANDLER: LINK BANK ACCOUNT TO PAYSTACK & SUPABASE
// =========================================================================

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: false, message: 'Method Not Allowed' });
  }

  try {
    const { user, token } = await requireUser(req);
    const { accountNumber, bankCode, bankName } = req.body || {};

    const cleanAccount = String(accountNumber || '').trim();
    const cleanBankCode = String(bankCode || '').trim();
    const cleanBankName = String(bankName || '').trim().slice(0, 100);

    if (!/^\d{10}$/.test(cleanAccount)) {
      throw new HttpError(400, 'Invalid account number: Must be exactly 10 digits.');
    }
    if (!/^[a-zA-Z0-9]{3,6}$/.test(cleanBankCode)) {
      throw new HttpError(400, 'Invalid bank code format.');
    }

    const client = getSupabaseClient(token);

    // 1. Get user profile
    const { data: profile, error: profErr } = await client
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single();

    if (profErr || !profile) {
      throw new HttpError(404, 'User profile not found.');
    }

    // 2. Resolve account with Paystack
    const query = new URLSearchParams({
      account_number: cleanAccount,
      bank_code: cleanBankCode,
    });
    const resolveRes = await paystackRequest<{
      status: boolean;
      message: string;
      data?: { account_name: string; account_number: string };
    }>(`/bank/resolve?${query.toString()}`);

    if (!resolveRes.ok || !resolveRes.data?.status || !resolveRes.data.data) {
      throw new HttpError(400, resolveRes.data?.message || 'Unable to resolve bank account with Paystack.');
    }

    const resolvedName = resolveRes.data.data.account_name.trim();

    // 3. Name check: require at least one significant name match between profile and bank
    const isGenericName = !profile.full_name || 
      ['user', 'new user', 'guest'].includes(profile.full_name.trim().toLowerCase());

    if (isGenericName) {
      // Auto-sync profile name with verified banking identity
      await client
        .from('profiles')
        .update({ full_name: resolvedName })
        .eq('id', user.id);
    } else {
      const profileTokens = (profile.full_name || '')
        .toUpperCase()
        .split(/\s+/)
        .filter((t: string) => t.length > 2);
      const bankTokens = resolvedName
        .toUpperCase()
        .split(/\s+/)
        .filter((t: string) => t.length > 2);

      const hasMatch = profileTokens.some((pt: string) => bankTokens.includes(pt));
      if (profileTokens.length > 0 && !hasMatch) {
        throw new HttpError(
          400,
          `Bank account name mismatch: The account name "${resolvedName}" does not match your registered profile name "${profile.full_name}".`
        );
      }
    }

    // 4. One verified payout account per user (anti-fraud). Re-linking the
    //    SAME account is allowed (refreshes the Paystack recipient).
    const { data: activeBanks, error: countErr } = await client
      .from('bank_accounts')
      .select('id, bank_code, account_number')
      .eq('user_id', user.id)
      .eq('is_active', true);

    if (countErr) {
      throw new HttpError(500, countErr.message);
    }
    const otherActive = (activeBanks || []).filter(
      (b: any) => !(b.bank_code === cleanBankCode && b.account_number === cleanAccount)
    );
    if (otherActive.length > 0) {
      throw new HttpError(400, 'You already have a verified payout account. Contact support to change it.');
    }

    // 5. Prevent duplicate linking across different accounts
    const { data: existingOther } = await client
      .from('bank_accounts')
      .select('id')
      .eq('account_number', cleanAccount)
      .eq('bank_code', cleanBankCode)
      .neq('user_id', user.id)
      .eq('is_active', true)
      .limit(1);

    if (existingOther && existingOther.length > 0) {
      throw new HttpError(400, 'This bank account is already linked to another TaskPulse account.');
    }

    // 6. Create Transfer Recipient on Paystack
    const recipientRes = await paystackRequest<{
      status: boolean;
      message: string;
      data?: {
        recipient_code: string;
      };
    }>('/transferrecipient', {
      method: 'POST',
      body: {
        type: 'nuban',
        name: resolvedName,
        account_number: cleanAccount,
        bank_code: cleanBankCode,
        currency: 'NGN',
        description: `TaskPulse payout recipient for user ${user.id}`,
      },
    });

    if (!recipientRes.ok || !recipientRes.data?.status || !recipientRes.data.data?.recipient_code) {
      throw new HttpError(
        502,
        recipientRes.data?.message || 'Failed to create Paystack transfer recipient.'
      );
    }

    const recipientCode = recipientRes.data.data.recipient_code;

    // 7. Save through the server-only RPC (enforces one account per user and
    //    no sharing of an account across users, under a row lock).
    const { data: savedBank, error: rpcErr } = await client.rpc('save_verified_bank_account', {
      p_user_id: user.id,
      p_bank_code: cleanBankCode,
      p_bank_name: cleanBankName || 'Commercial Bank',
      p_account_number: cleanAccount,
      p_account_name: resolvedName,
      p_recipient_code: recipientCode,
    });

    if (rpcErr || !savedBank) {
      const msg = rpcErr?.message || '';
      if (msg.includes('bank_already_linked')) {
        throw new HttpError(400, 'You already have a verified payout account. Contact support to change it.');
      }
      if (msg.includes('bank_linked_to_other_user')) {
        throw new HttpError(400, 'This bank account is already linked to another TaskPulse account.');
      }
      throw new HttpError(500, `Failed to save bank account: ${msg || 'unknown error'}`);
    }

    return res.status(200).json({
      status: true,
      message: 'Bank account linked successfully to Paystack.',
      data: savedBank,
    });
  } catch (err: any) {
    return handleApiError(res, err);
  }
}

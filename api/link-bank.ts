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
  console.error('[API Error: link-bank]', err);
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

async function requireUser(req: VercelRequest): Promise<{ user: User; token: string }> {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!headerValue || !headerValue.toLowerCase().startsWith('bearer ')) {
    throw new HttpError(401, 'Authentication required. Please sign in.');
  }
  const token = headerValue.slice(7).trim();
  if (!token) throw new HttpError(401, 'Authentication token missing.');
  const admin = getAdminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, 'Session invalid or expired. Please sign in again.');
  return { user: data.user, token };
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
// HANDLER: LINK BANK ACCOUNT TO PAYSTACK & SUPABASE
// =========================================================================

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: false, message: 'Method Not Allowed' });
  }

  try {
    const { user } = await requireUser(req);
    const { accountNumber, bankCode, bankName } = req.body || {};

    const cleanAccount = String(accountNumber || '').trim();
    const cleanBankCode = String(bankCode || '').trim();
    const cleanBankName = String(bankName || '').trim();

    if (!/^\d{10}$/.test(cleanAccount)) {
      throw new HttpError(400, 'Invalid account number: Must be exactly 10 digits.');
    }
    if (!/^[a-zA-Z0-9]{3,6}$/.test(cleanBankCode)) {
      throw new HttpError(400, 'Invalid bank code format.');
    }

    const admin = getAdminClient();

    // 1. Get user profile
    const { data: profile, error: profErr } = await admin
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
      await admin
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

    // 4. Check maximum banks per user (limit 3)
    const { count: bankCount, error: countErr } = await admin
      .from('bank_accounts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('is_active', true);

    if (countErr) {
      throw new HttpError(500, countErr.message);
    }
    if ((bankCount || 0) >= 3) {
      throw new HttpError(400, 'Maximum of 3 bank accounts allowed per user.');
    }

    // 5. Prevent duplicate linking across different accounts
    const { data: existingOther } = await admin
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

    // 7. Insert or activate bank account in Supabase
    const { data: insertedBank, error: insertErr } = await admin
      .from('bank_accounts')
      .upsert(
        {
          user_id: user.id,
          bank_code: cleanBankCode,
          bank_name: cleanBankName || 'Commercial Bank',
          account_number: cleanAccount,
          account_name: resolvedName,
          recipient_code: recipientCode,
          is_active: true,
        },
        { onConflict: 'user_id, account_number, bank_code' }
      )
      .select()
      .single();

    if (insertErr) {
      throw new HttpError(500, `Failed to save bank account: ${insertErr.message}`);
    }

    return res.status(200).json({
      status: true,
      message: 'Bank account linked successfully to Paystack.',
      data: insertedBank,
    });
  } catch (err: any) {
    return handleApiError(res, err);
  }
}

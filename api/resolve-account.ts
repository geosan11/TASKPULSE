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
  console.error('[API Error: resolve-account]', err);
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
// HANDLER: RESOLVE NUBAN ACCOUNT
// =========================================================================

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ status: false, message: 'Method Not Allowed' });
  }

  try {
    // 1. Require valid logged-in user to prevent open-proxy abuse
    await requireUser(req);

    const accountNumber = String(req.query.account_number || '').trim();
    const bankCode = String(req.query.bank_code || '').trim();

    if (!/^\d{10}$/.test(accountNumber)) {
      throw new HttpError(400, 'Invalid account number: Must be exactly 10 digits.');
    }

    if (!/^[a-zA-Z0-9]{3,6}$/.test(bankCode)) {
      throw new HttpError(400, 'Invalid bank code format.');
    }

    // 2. Resolve account with Paystack
    const query = new URLSearchParams({
      account_number: accountNumber,
      bank_code: bankCode,
    });

    const paystackRes = await paystackRequest<{
      status: boolean;
      message: string;
      data?: {
        account_number: string;
        account_name: string;
        bank_id: number;
      };
    }>(`/bank/resolve?${query.toString()}`);

    if (!paystackRes.ok || !paystackRes.data?.status || !paystackRes.data.data) {
      throw new HttpError(
        400,
        paystackRes.data?.message || 'Could not resolve bank account details. Verify bank code and account number.'
      );
    }

    return res.status(200).json({
      status: true,
      message: 'Bank account resolved successfully',
      data: paystackRes.data.data,
    });
  } catch (err: any) {
    return handleApiError(res, err);
  }
}

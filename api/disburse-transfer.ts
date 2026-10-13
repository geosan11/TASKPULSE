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
  console.error('[API Error: disburse-transfer]', err);
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
// HANDLER: DISBURSE TRANSFER (PAYSTACK PAYOUT)
// =========================================================================

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: false, message: 'Method Not Allowed' });
  }

  try {
    const { user, token } = await requireUser(req);
    const { amount, bankAccountId, idempotencyKey } = req.body || {};

    const numAmount = Number(amount);
    if (!numAmount || isNaN(numAmount) || numAmount < 3000 || numAmount !== Math.floor(numAmount)) {
      throw new HttpError(400, 'Invalid cashout amount: Minimum is ₦3,000, whole numbers only.');
    }

    if (!bankAccountId || typeof bankAccountId !== 'string') {
      throw new HttpError(400, 'A valid linked bank account ID is required.');
    }

    const safeClientKey = String(idempotencyKey || crypto.randomUUID());
    // Create deterministic unique transfer reference (max 40 chars)
    const txRef = 'co_' + crypto.createHash('sha256').update(`${user.id}:${safeClientKey}`).digest('hex').substring(0, 32);

    const client = getSupabaseClient(token);

    // 1. Atomically evaluate all rules & deduct balance in Supabase
    const { data: rpcResult, error: rpcErr } = await client.rpc('request_cashout', {
      p_user_id: user.id,
      p_amount: numAmount,
      p_bank_account_id: bankAccountId,
      p_reference: txRef,
    });

    if (rpcErr) {
      const msg = rpcErr.message;
      if (msg.includes('cooldown_active')) {
        throw new HttpError(403, '48-hour security cooling-off period active since your activation. Please check your unlock countdown.');
      }
      if (msg.includes('referral_condition')) {
        throw new HttpError(403, 'Withdrawal condition unmet: You need at least 3 qualified referrals (₦9,000 volume) or a tier upgrade to withdraw.');
      }
      if (msg.includes('insufficient_balance')) {
        throw new HttpError(400, 'Insufficient withdrawable wallet balance.');
      }
      if (msg.includes('tier_cap')) {
        throw new HttpError(403, 'Cumulative tier withdrawal limit reached. Please upgrade your tier to continue withdrawing.');
      }
      if (msg.includes('single_limit')) {
        throw new HttpError(400, 'Amount exceeds your tier maximum single transfer limit.');
      }
      if (msg.includes('bank_not_found')) {
        throw new HttpError(404, 'Selected bank account was not found or is not active.');
      }
      throw new HttpError(400, `Withdrawal request blocked: ${msg}`);
    }

    if (rpcResult?.duplicate) {
      return res.status(200).json({
        status: true,
        message: 'This withdrawal was already initiated and is processing.',
        data: rpcResult,
      });
    }

    let recipientCode = rpcResult?.recipient_code;
    if (!recipientCode) {
      // Automatic fallback: Retrieve bank details and register recipient on Paystack immediately
      const { data: bankRow } = await client
        .from('bank_accounts')
        .select('account_number, bank_code, account_name')
        .eq('id', bankAccountId)
        .maybeSingle();

      if (bankRow?.account_number && bankRow?.bank_code) {
        const rcRes = await paystackRequest<{
          status: boolean;
          message: string;
          data?: { recipient_code: string };
        }>('/transferrecipient', {
          method: 'POST',
          body: {
            type: 'nuban',
            name: bankRow.account_name || 'TaskPulse User',
            account_number: bankRow.account_number,
            bank_code: bankRow.bank_code,
            currency: 'NGN',
            description: `Auto-linked recipient for user ${user.id}`,
          },
        });

        if (rcRes.ok && rcRes.data?.data?.recipient_code) {
          recipientCode = rcRes.data.data.recipient_code;
          await client
            .from('bank_accounts')
            .update({ recipient_code: recipientCode })
            .eq('id', bankAccountId);
        }
      }
    }

    if (!recipientCode) {
      // Auto-refund in database if recipient cannot be established
      await client.rpc('finalize_cashout', {
        p_reference: txRef,
        p_outcome: 'failed',
      });
      throw new HttpError(500, 'Bank account could not be connected to Paystack recipient network. Please re-link your bank.');
    }

    // 2. Dispatch transfer via Paystack API
    const paystackRes = await paystackRequest<{
      status: boolean;
      message: string;
      data?: {
        reference: string;
        status: string;
        transfer_code: string;
        amount: number;
      };
    }>('/transfer', {
      method: 'POST',
      body: {
        source: 'balance',
        amount: Math.round(numAmount * 100), // in kobo
        recipient: recipientCode,
        reason: `TaskPulse Cashout ${txRef}`,
        reference: txRef,
      },
    });

    // 3. Handle failure: Refund the user immediately if Paystack rejects the call
    if (!paystackRes.ok || !paystackRes.data?.status) {
      console.error('[Cashout Transfer Error]', paystackRes.data);
      // Auto-refund in database
      await client.rpc('finalize_cashout', {
        p_reference: txRef,
        p_outcome: 'failed',
      });

      throw new HttpError(
        502,
        `Payment gateway rejected transfer: ${paystackRes.data?.message || 'Check Paystack transfer balance or settings.'}`
      );
    }

    const transferData = paystackRes.data.data;
    const transferStatus = transferData?.status?.toLowerCase();

    // If Paystack returned immediate success, mark disbursed
    if (transferStatus === 'success') {
      await client.rpc('finalize_cashout', {
        p_reference: txRef,
        p_outcome: 'success',
      });
    }

    return res.status(200).json({
      status: true,
      message: 'Transfer submitted to banking network.',
      data: {
        reference: txRef,
        amount: numAmount,
        status: transferStatus || 'pending',
        transfer_code: transferData?.transfer_code,
        recipient_code: recipientCode,
      },
    });
  } catch (err: any) {
    return handleApiError(res, err);
  }
}

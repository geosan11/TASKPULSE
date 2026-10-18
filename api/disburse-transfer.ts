import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

// =========================================================================
// SELF-CONTAINED SERVERLESS HELPERS (ZERO RELATIVE IMPORT ISSUES ON VERCEL)
// =========================================================================

class HttpError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
    Object.setPrototypeOf(this, HttpError.prototype);
  }
}

// Machine-readable code the app maps to its "Verify your ID" prompt.
const ID_REQUIRED_CODE = 'identity_not_verified';
const ID_REQUIRED_MESSAGE = "Add your bank account to verify your ID before withdrawing. It's a one-time check that keeps payouts safe.";

function handleApiError(res: VercelResponse, err: any) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ status: false, message: err.message, ...(err.code ? { code: err.code } : {}) });
  }
  console.error('[API Error: disburse-transfer]', err);
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
    // Basic shape check only; the minimum, daily limit and cooldown are
    // enforced atomically inside request_cashout() from marketplace_settings.
    if (!numAmount || isNaN(numAmount) || numAmount <= 0 || numAmount !== Math.floor(numAmount)) {
      throw new HttpError(400, 'Invalid cashout amount: whole Naira amounts only.');
    }

    if (!bankAccountId || typeof bankAccountId !== 'string') {
      throw new HttpError(400, 'A valid linked bank account ID is required.');
    }

    const safeClientKey = String(idempotencyKey || crypto.randomUUID());
    // Create deterministic unique transfer reference (max 40 chars)
    const txRef = 'co_' + crypto.createHash('sha256').update(`${user.id}:${safeClientKey}`).digest('hex').substring(0, 32);

    const client = getSupabaseClient(token);

    // 0. Defence in depth: a verified identity is required to withdraw.
    //    request_cashout() enforces the same rule atomically (migration 012);
    //    this check also covers a database where 012 is not applied yet, and
    //    runs before any money is locked or Paystack is called. Fails closed.
    const { data: kycRow, error: kycErr } = await client
      .from('profiles')
      .select('kyc_status')
      .eq('id', user.id)
      .maybeSingle();
    if (kycErr) {
      console.error('[Cashout identity check failed]', kycErr);
      throw new HttpError(503, "We couldn't check your account right now. Please try again.");
    }
    if (kycRow?.kyc_status !== 'verified') {
      throw new HttpError(403, ID_REQUIRED_MESSAGE, ID_REQUIRED_CODE);
    }

    // 1. Atomically evaluate all rules & deduct balance in Supabase
    const { data: rpcResult, error: rpcErr } = await client.rpc('request_cashout', {
      p_user_id: user.id,
      p_amount: numAmount,
      p_bank_account_id: bankAccountId,
      p_reference: txRef,
    });

    if (rpcErr) {
      const msg = rpcErr.message;
      if (msg.includes(ID_REQUIRED_CODE)) {
        throw new HttpError(403, ID_REQUIRED_MESSAGE, ID_REQUIRED_CODE);
      }
      if (msg.includes('min_withdrawal')) {
        throw new HttpError(400, 'Amount is below the minimum withdrawal.');
      }
      if (msg.includes('no_approved_tasks')) {
        throw new HttpError(403, 'Withdrawals unlock after your first approved task (plus a short security cooldown).');
      }
      if (msg.includes('cooldown_active')) {
        throw new HttpError(403, 'Security cooldown active: withdrawals unlock 48 hours after your first approved task.');
      }
      if (msg.includes('daily_count_limit')) {
        throw new HttpError(429, 'Daily withdrawal count reached. Please try again tomorrow.');
      }
      if (msg.includes('daily_limit')) {
        throw new HttpError(400, 'This amount would exceed your daily withdrawal limit.');
      }
      if (msg.includes('insufficient_balance')) {
        throw new HttpError(400, 'Insufficient withdrawable wallet balance.');
      }
      if (msg.includes('whole_naira_only')) {
        throw new HttpError(400, 'Whole Naira amounts only.');
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
    // Balance is already reserved. Any failure before the transfer is sent
    // (including a timeout here) must fall through to the refund below.
    try {
      if (!recipientCode) {
        // Automatic fallback: Retrieve bank details and register recipient on Paystack immediately
        const { data: bankRow } = await client
          .from('bank_accounts')
          .select('account_number, bank_code, account_name')
          .eq('id', bankAccountId)
          .eq('user_id', user.id)
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
              .eq('id', bankAccountId)
              .eq('user_id', user.id);
          }
        }
      }
    } catch (rcErr) {
      console.error('[Cashout recipient lookup failed]', txRef, rcErr);
      recipientCode = undefined;
    }

    if (!recipientCode) {
      // Auto-refund in database if recipient cannot be established
      const { error: refundErr } = await client.rpc('finalize_cashout', {
        p_reference: txRef,
        p_outcome: 'failed',
      });
      if (refundErr) console.error('[Cashout refund failed]', txRef, refundErr);
      throw new HttpError(500, 'Bank account could not be connected to Paystack recipient network. Please re-link your bank.');
    }

    // 2. Dispatch transfer via Paystack API
    type TransferResp = {
      status: boolean;
      message: string;
      data?: { reference: string; status: string; transfer_code: string; amount: number };
    };
    let paystackRes: { ok: boolean; status: number; data: TransferResp } | null = null;
    try {
      paystackRes = await paystackRequest<TransferResp>('/transfer', {
        method: 'POST',
        body: {
          source: 'balance',
          amount: Math.round(numAmount * 100), // in kobo
          recipient: recipientCode,
          reason: `TaskPulse Cashout ${txRef}`,
          reference: txRef,
        },
      });
    } catch (netErr) {
      console.error('[Cashout Transfer network error]', txRef, netErr);
      paystackRes = null;
    }

    // 3a. Ambiguous outcome (timeout / network error / Paystack 5xx): the
    //     transfer MAY have been created. Refunding now could pay the user
    //     twice (refund + transfer). Keep it pending; the transfer.* webhook
    //     or scripts/reconcile-pending.ts finalizes it from Paystack's record.
    if (!paystackRes || paystackRes.status >= 500 || paystackRes.status === 0) {
      return res.status(202).json({
        status: true,
        message: 'Withdrawal submitted and is processing. If it fails, the amount is returned to your wallet automatically.',
        data: { reference: txRef, amount: numAmount, status: 'pending' },
      });
    }

    // 3b. Definitive rejection (4xx, status:false): nothing was sent, so
    //     refund the user immediately.
    if (!paystackRes.ok || !paystackRes.data?.status) {
      console.error('[Cashout Transfer Error]', paystackRes.status, paystackRes.data?.message);
      const { error: refundErr } = await client.rpc('finalize_cashout', {
        p_reference: txRef,
        p_outcome: 'failed',
      });
      if (refundErr) console.error('[Cashout refund failed]', txRef, refundErr);

      throw new HttpError(
        502,
        'Payment gateway rejected the transfer. The amount has been returned to your wallet. Please try again later.'
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

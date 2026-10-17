import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const config = {
  api: {
    bodyParser: false,
  },
};

// =========================================================================
// SELF-CONTAINED SERVERLESS HELPERS (ZERO RELATIVE IMPORT ISSUES ON VERCEL)
// =========================================================================

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
function getAdminClient(): SupabaseClient {
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

function getPaystackSecretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) {
    throw new Error('PAYSTACK_SECRET_KEY is not configured on the server. Please add PAYSTACK_SECRET_KEY in Vercel Project Settings > Environment Variables.');
  }
  return key;
}

// The HMAC must be computed over the exact bytes Paystack sent.
// `export const config = { api: { bodyParser: false } }` is a Next.js
// convention; plain Vercel functions ignore it and expose a lazy `req.body`.
// So: use the stream when it is still unread, accept a Buffer/string body if
// a runtime already buffered it, and never hang forever waiting for 'end'.
async function readRawBody(req: VercelRequest, timeoutMs = 8000): Promise<Buffer> {
  const pre = (req as any).rawBody ?? undefined;
  if (Buffer.isBuffer(pre)) return pre;
  if (typeof pre === 'string') return Buffer.from(pre, 'utf8');

  if ((req as any).readableEnded || (req as any).complete && (req as any).readable === false) {
    // Stream already consumed by a body parser: fall back to req.body if it
    // is raw. A re-serialised object would not match the signature.
    const b = (req as any).body;
    if (Buffer.isBuffer(b)) return b;
    if (typeof b === 'string') return Buffer.from(b, 'utf8');
    throw new Error('raw_body_unavailable');
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => reject(new Error('raw_body_timeout')), timeoutMs);
    req.on('data', (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > 1_000_000) {
        clearTimeout(timer);
        reject(new Error('payload_too_large'));
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    });
    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// Our own references: dep_* (legacy deposits), camp_*
// (campaign funding), co_* (cashouts). Anything else is not ours (for
// example another app on the same Paystack account) and is acknowledged
// with 200 so Paystack stops retrying it.
const PAY_REF_RE = /^(dep|camp)_[A-Za-z0-9_-]{6,80}$/;
const CASHOUT_REF_RE = /^co_[A-Za-z0-9_-]{6,80}$/;

// =========================================================================
// HANDLER: CRYPTOGRAPHIC PAYSTACK WEBHOOK
// =========================================================================

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const secretKey = getPaystackSecretKey();

    // 1. Read the raw request body buffer
    let rawBodyBuffer: Buffer;
    try {
      rawBodyBuffer = await readRawBody(req);
    } catch (e: any) {
      console.error('[Webhook] Could not read raw body:', e?.message);
      // 500 so Paystack retries; the event is not lost.
      return res.status(500).json({ status: false, message: 'Could not read request body' });
    }
    const signature = req.headers['x-paystack-signature'];
    const signatureStr = Array.isArray(signature) ? signature[0] : signature;

    if (!signatureStr) {
      console.warn('[Webhook] Missing x-paystack-signature header');
      return res.status(401).json({ status: false, message: 'Missing signature header' });
    }

    // 2. Verify HMAC SHA512 signature in constant time
    const expectedHash = crypto
      .createHmac('sha512', secretKey)
      .update(rawBodyBuffer)
      .digest('hex');

    const expectedBuffer = Buffer.from(expectedHash, 'utf8');
    const signatureBuffer = Buffer.from(signatureStr, 'utf8');

    if (
      expectedBuffer.length !== signatureBuffer.length ||
      !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)
    ) {
      console.warn('[Webhook] Invalid webhook signature detected');
      return res.status(401).json({ status: false, message: 'Invalid signature' });
    }

    // 3. Parse JSON event
    let event: any;
    try {
      event = JSON.parse(rawBodyBuffer.toString('utf8'));
    } catch {
      return res.status(400).json({ status: false, message: 'Invalid JSON' });
    }
    const eventType = event.event;
    const eventData = event.data || {};

    const admin = getAdminClient();

    console.log(`[Webhook] Processing event: ${eventType}`);

    // =========================================================================
    // EVENT 1: charge.success (Campaign funding or legacy deposit settled)
    // =========================================================================
    if (eventType === 'charge.success') {
      const { reference, amount, currency, status } = eventData;
      if (reference && !PAY_REF_RE.test(String(reference))) {
        console.log(`[Webhook] Ignoring charge for foreign reference ${reference}`);
      } else if (status === 'success' && currency === 'NGN' && reference) {
        const amountNaira = Math.floor(Number(amount) / 100);
        // camp_* = business campaign funding; anything else = legacy deposit
        const rpcName = String(reference).startsWith('camp_') ? 'settle_campaign_funding' : 'settle_deposit';
        const { data: settleResult, error: settleErr } = await admin.rpc(rpcName, {
          p_reference: reference,
          p_paid_amount: amountNaira,
        });

        if (settleErr) {
          console.error(`[Webhook] ${rpcName} failed for ${reference}:`, settleErr);
          return res.status(500).json({ status: false, message: settleErr.message });
        }
        // Replays are safe: both RPCs lock the row and return duplicate:true
        // once settled. A business-rule refusal (underpaid, unknown_reference)
        // is logged and acknowledged; retrying would not change it.
        if (settleResult && settleResult.success === false) {
          console.warn(`[Webhook] ${rpcName} refused ${reference}:`, settleResult);
        } else {
          console.log(`[Webhook] ${rpcName} for ${reference}:`, settleResult);
        }
      }
    }

    // =========================================================================
    // EVENT 2: transfer.success (Cashout Disbursed)
    // =========================================================================
    else if (eventType === 'transfer.success') {
      const { reference } = eventData;
      if (reference && CASHOUT_REF_RE.test(String(reference))) {
        const { data: finalizeResult, error: finalizeErr } = await admin.rpc('finalize_cashout', {
          p_reference: reference,
          p_outcome: 'success',
        });

        if (finalizeErr) {
          console.error(`[Webhook] finalize_cashout (success) failed for ${reference}:`, finalizeErr);
          return res.status(500).json({ status: false, message: finalizeErr.message });
        }
        console.log(`[Webhook] Cashout marked disbursed for ${reference}:`, finalizeResult);
      }
    }

    // =========================================================================
    // EVENT 3: transfer.failed & transfer.reversed (Cashout Failed -> Wallet Refund)
    // =========================================================================
    else if (eventType === 'transfer.failed' || eventType === 'transfer.reversed') {
      const { reference } = eventData;
      if (reference && CASHOUT_REF_RE.test(String(reference))) {
        const { data: refundResult, error: refundErr } = await admin.rpc('finalize_cashout', {
          p_reference: reference,
          p_outcome: 'failed',
        });

        if (refundErr) {
          console.error(`[Webhook] finalize_cashout (failed/reversed) failed for ${reference}:`, refundErr);
          return res.status(500).json({ status: false, message: refundErr.message });
        }
        console.log(`[Webhook] Cashout refunded to wallet for ${reference}:`, refundResult);
      }
    }

    return res.status(200).json({ status: true, message: 'Webhook processed' });
  } catch (err: any) {
    console.error('[Webhook error]', err);
    // Do not echo internal error text to the caller.
    return res.status(500).json({ status: false, message: 'Webhook failed' });
  }
}

import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { readRawBody, getAdminClient, getPaystackSecretKey } from './_lib/server';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const secretKey = getPaystackSecretKey();

    // 1. Read the raw request body buffer
    const rawBodyBuffer = await readRawBody(req);
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
    const event = JSON.parse(rawBodyBuffer.toString('utf8'));
    const eventType = event.event;
    const eventData = event.data || {};

    const admin = getAdminClient();

    console.log(`[Webhook] Processing event: ${eventType}`);

    // =========================================================================
    // EVENT 1: charge.success (Deposit Settled)
    // =========================================================================
    if (eventType === 'charge.success') {
      const { reference, amount, currency, status } = eventData;
      if (status === 'success' && currency === 'NGN' && reference) {
        const amountNaira = Math.floor(Number(amount) / 100);
        const { data: settleResult, error: settleErr } = await admin.rpc('settle_deposit', {
          p_reference: reference,
          p_paid_amount: amountNaira,
        });

        if (settleErr) {
          console.error(`[Webhook] settle_deposit failed for ${reference}:`, settleErr);
          return res.status(500).json({ status: false, message: settleErr.message });
        }
        console.log(`[Webhook] Deposit settled for ${reference}:`, settleResult);
      }
    }

    // =========================================================================
    // EVENT 2: transfer.success (Cashout Disbursed)
    // =========================================================================
    else if (eventType === 'transfer.success') {
      const { reference } = eventData;
      if (reference) {
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
      if (reference) {
        const { data: refundResult, error: refundErr } = await admin.rpc('finalize_cashout', {
          p_reference: reference,
          p_outcome: 'failed',
        });

        if (refundErr) {
          console.error(`[Webhook] finalize_cashout (refund) failed for ${reference}:`, refundErr);
          return res.status(500).json({ status: false, message: refundErr.message });
        }
        console.log(`[Webhook] Cashout refunded to wallet for ${reference}:`, refundResult);
      }
    }

    return res.status(200).json({ status: true, message: 'Webhook event processed' });
  } catch (err: any) {
    console.error('[Webhook Exception]', err);
    return res.status(500).json({ status: false, message: err?.message || 'Server error' });
  }
}

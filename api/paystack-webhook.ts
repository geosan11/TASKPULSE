import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    return res.status(500).send('Secret key missing');
  }

  // Verify Paystack Signature (HMAC SHA512)
  const signature = req.headers['x-paystack-signature'] as string;
  const hash = crypto
    .createHmac('sha512', secretKey)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (hash !== signature) {
    return res.status(401).json({ status: false, message: 'Invalid webhook signature' });
  }

  const event = req.body;

  // Handle Event: charge.success (Strictly ₦3,000 Activation Deposit)
  if (event.event === 'charge.success') {
    const { reference, amount, customer, status } = event.data || {};
    
    // Strict server-side check: Must be at least 300,000 kobo (₦3,000) and status 'success'
    if (status !== 'success' || Number(amount) < 300000) {
      console.warn(`[Security Alert] Received charge.success with invalid amount: ₦${amount / 100} from ${customer?.email}`);
      return res.status(400).json({ status: false, message: 'Invalid or insufficient deposit amount' });
    }

    console.log(`[TaskPulse Paystack Webhook] Verified payment of ₦${amount / 100} from ${customer?.email} (Ref: ${reference})`);
    // User activation confirmed
  }

  // Handle Event: transfer.success (Disbursed Cashout)
  if (event.event === 'transfer.success') {
    const { reference, amount, recipient } = event.data || {};
    console.log(`[TaskPulse Paystack Webhook] Successful transfer of ₦${amount / 100} to recipient ${recipient?.recipient_code} (Ref: ${reference})`);
  }

  return res.status(200).json({ status: true, message: 'Webhook processed' });
}

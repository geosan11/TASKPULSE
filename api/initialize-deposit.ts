import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: false, message: 'Method Not Allowed' });
  }

  const { email, amount = 3000, reference } = req.body || {};

  if (!email) {
    return res.status(400).json({ status: false, message: 'Customer email is required' });
  }

  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    return res.status(500).json({ status: false, message: 'PAYSTACK_SECRET_KEY is not configured' });
  }

  const depositRef = reference || `ref_tp_dep_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  // Convert amount in Naira to Kobo (₦3,000 = 300,000 kobo)
  const amountInKobo = Math.round(Number(amount) * 100);

  try {
    const paystackRes = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        amount: amountInKobo,
        reference: depositRef,
        metadata: {
          app: 'TaskPulse',
          type: 'activation_drop',
          amount_naira: amount
        }
      })
    });

    const data = await paystackRes.json();
    return res.status(paystackRes.status).json(data);
  } catch (error: any) {
    return res.status(500).json({ status: false, message: error?.message || 'Paystack initialization failed' });
  }
}

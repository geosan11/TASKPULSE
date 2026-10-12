import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: false, message: 'Method Not Allowed' });
  }

  const { email, reference } = req.body || {};

  if (!email) {
    return res.status(400).json({ status: false, message: 'Customer email is required' });
  }

  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    return res.status(500).json({ status: false, message: 'PAYSTACK_SECRET_KEY is not configured' });
  }

  // HARD-LOCKED ON THE SERVER: EXACTLY ₦3,000 (300,000 KOBO)
  // CLIENT CANNOT TAMPER WITH THIS VALUE
  const ENFORCED_AMOUNT_KOBO = 300000;
  const depositRef = reference || `ref_tp_dep_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  try {
    const paystackRes = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        amount: ENFORCED_AMOUNT_KOBO,
        reference: depositRef,
        currency: 'NGN',
        metadata: {
          app: 'TaskPulse',
          type: 'activation_drop',
          amount_naira: 3000
        }
      })
    });

    const data = await paystackRes.json();
    return res.status(paystackRes.status).json(data);
  } catch (error: any) {
    return res.status(500).json({ status: false, message: error?.message || 'Paystack initialization failed' });
  }
}

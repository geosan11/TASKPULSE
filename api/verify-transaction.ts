import type { VercelRequest, VercelResponse } from '@vercel/node';
import { signFinancialState } from './security';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: false, message: 'Method Not Allowed' });
  }

  const { reference, userId = 'DOCTORR' } = req.body || {};

  if (!reference) {
    return res.status(400).json({ status: false, message: 'Transaction reference is required' });
  }

  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    return res.status(500).json({ status: false, message: 'PAYSTACK_SECRET_KEY is not configured' });
  }

  try {
    // 1. Direct Server-to-Paystack Verification (Client Cannot Fake This)
    const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: {
        Authorization: `Bearer ${secretKey}`
      }
    });

    const verifyData = await verifyRes.json();

    if (!verifyData.status || verifyData.data?.status !== 'success') {
      return res.status(400).json({
        status: false,
        message: 'Payment verification failed: Transaction was not completed or was declined.'
      });
    }

    const { amount, currency, customer } = verifyData.data;

    // 2. Strict Server-Enforced Amount Check (Must be >= ₦3,000 = 300,000 Kobo)
    if (amount < 300000 || currency !== 'NGN') {
      return res.status(400).json({
        status: false,
        message: 'Fraudulent transaction: Deposit amount must be at least ₦3,000 (300,000 kobo).'
      });
    }

    // 3. Issue Cryptographically Signed Anti-Tamper State Token
    const stateToken = signFinancialState({
      userId,
      isActivated: true,
      activationTimestamp: Date.now(),
      initialDeposit: 3000,
      qualifiedReferralsCount: 0,
      referralsVolume: 0,
      withdrawableBalance: 3000
    }, secretKey);

    return res.status(200).json({
      status: true,
      message: 'Payment verified and credited successfully.',
      data: {
        reference,
        amount: amount / 100,
        customerEmail: customer?.email,
        verifiedAt: new Date().toISOString(),
        stateToken
      }
    });
  } catch (err: any) {
    return res.status(500).json({ status: false, message: err?.message || 'Verification failed' });
  }
}

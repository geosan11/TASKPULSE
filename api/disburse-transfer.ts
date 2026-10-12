import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: false, message: 'Method Not Allowed' });
  }

  const { 
    amount, 
    bankCode, 
    accountNumber, 
    accountName, 
    userActivationDate,
    qualifiedReferralsCount = 0,
    referralsVolume = 0
  } = req.body || {};

  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    return res.status(500).json({ status: false, message: 'PAYSTACK_SECRET_KEY is not configured' });
  }

  // 1. Enforce 48-Hour Security Lock Rule
  if (userActivationDate) {
    const hoursSinceActivation = (Date.now() - new Date(userActivationDate).getTime()) / (1000 * 60 * 60);
    if (hoursSinceActivation < 48) {
      return res.status(403).json({ 
        status: false, 
        message: '48-Hour Security Cooldown Active: Initial cashout unlocks 2 days after activation.' 
      });
    }
  }

  // 2. Enforce 3 Referrals & ₦9,000 Volume Rule
  if (qualifiedReferralsCount < 3 || referralsVolume < 9000) {
    return res.status(403).json({
      status: false,
      message: 'Referral Condition Required: You must have at least 3 qualified referrals with minimum ₦9,000 combined deposit volume.'
    });
  }

  // 3. Enforce Minimum ₦2,000 Threshold
  const transferAmount = Number(amount);
  if (transferAmount < 2000) {
    return res.status(400).json({ status: false, message: 'Minimum withdrawal is ₦2,000.' });
  }

  try {
    // Step A: Create Paystack Transfer Recipient
    const recipientRes = await fetch('https://api.paystack.co/transferrecipient', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'nuban',
        name: accountName,
        account_number: accountNumber,
        bank_code: bankCode,
        currency: 'NGN'
      })
    });

    const recipientData = await recipientRes.json();
    if (!recipientData.status) {
      return res.status(400).json({ 
        status: false, 
        message: recipientData.message || 'Failed to create transfer recipient on Paystack' 
      });
    }

    const recipientCode = recipientData.data.recipient_code;

    // Step B: Initiate Paystack Transfer (amount in kobo)
    const transferRes = await fetch('https://api.paystack.co/transfer', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        source: 'balance',
        amount: Math.round(transferAmount * 100),
        recipient: recipientCode,
        reason: 'TaskPulse Earner Payout'
      })
    });

    const transferData = await transferRes.json();
    return res.status(transferRes.status).json(transferData);
  } catch (error: any) {
    return res.status(500).json({ status: false, message: error?.message || 'Transfer failed' });
  }
}

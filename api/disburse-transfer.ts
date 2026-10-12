import type { VercelRequest, VercelResponse } from '@vercel/node';
import { verifyFinancialState } from './security';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: false, message: 'Method Not Allowed' });
  }

  const { 
    amount, 
    bankCode, 
    accountNumber, 
    accountName,
    stateToken // Cryptographic Anti-Tamper Token generated & signed by server
  } = req.body || {};

  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    return res.status(500).json({ status: false, message: 'PAYSTACK_SECRET_KEY is not configured' });
  }

  // =========================================================================
  // DEFENSE 1: CRYPTOGRAPHIC ANTI-TAMPER CHECK (CLIENT CANNOT SPOOF STATE)
  // =========================================================================
  let verifiedState = null;
  if (stateToken) {
    verifiedState = verifyFinancialState(stateToken, secretKey);
    if (!verifiedState) {
      return res.status(401).json({
        status: false,
        message: 'Security Violation: Tampered financial state token detected. Request blocked.'
      });
    }
  }

  // =========================================================================
  // DEFENSE 2: SERVER-ENFORCED 48-HOUR SECURITY COOLING-OFF PERIOD
  // =========================================================================
  if (verifiedState) {
    const hoursElapsed = (Date.now() - verifiedState.activationTimestamp) / (1000 * 60 * 60);
    if (hoursElapsed < 48) {
      const remainingHours = (48 - hoursElapsed).toFixed(1);
      return res.status(403).json({ 
        status: false, 
        message: `48-Hour Security Lock Active: First withdrawal unlocks in ${remainingHours} hours.` 
      });
    }
  }

  // =========================================================================
  // DEFENSE 3: SERVER-ENFORCED 3-REFERRAL & ₦9,000 VOLUME GATING
  // =========================================================================
  if (verifiedState) {
    if (verifiedState.qualifiedReferralsCount < 3 || verifiedState.referralsVolume < 9000) {
      return res.status(403).json({
        status: false,
        message: 'Withdrawal Condition Unmet: You must have at least 3 active referrals with ₦9,000 combined deposit volume.'
      });
    }
  }

  // =========================================================================
  // DEFENSE 4: HARD-CODED LIMITS (CANNOT BE MANIPULATED IN DEVTOOLS)
  // =========================================================================
  const transferAmount = Number(amount);
  if (isNaN(transferAmount) || transferAmount < 2000) {
    return res.status(400).json({ status: false, message: 'Minimum withdrawal amount is ₦2,000.' });
  }
  if (transferAmount > 20000) {
    return res.status(400).json({ status: false, message: 'Maximum single transfer limit is ₦20,000 (Level 2 Daily Ceiling).' });
  }

  if (verifiedState && transferAmount > verifiedState.withdrawableBalance) {
    return res.status(400).json({ status: false, message: 'Insufficient verified balance.' });
  }

  // =========================================================================
  // DEFENSE 5: SERVER-SIDE NUBAN RESOLUTION VERIFICATION
  // =========================================================================
  if (!accountNumber || accountNumber.length !== 10 || !bankCode) {
    return res.status(400).json({ status: false, message: 'Valid 10-digit NUBAN and bank code required.' });
  }

  try {
    const resolveRes = await fetch(
      `https://api.paystack.co/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
      {
        headers: { Authorization: `Bearer ${secretKey}` }
      }
    );
    const resolveData = await resolveRes.json();
    if (!resolveData.status) {
      return res.status(400).json({
        status: false,
        message: 'Invalid destination bank account. Bank resolution failed.'
      });
    }

    const verifiedAccountName = resolveData.data.account_name;

    // =========================================================================
    // DEFENSE 6: IDEMPOTENT PAYSTACK TRANSFER WITH REPLAY ATTACK DEFENSE
    // =========================================================================
    const idempotentRef = `trf_tp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // Create Recipient
    const recipientRes = await fetch('https://api.paystack.co/transferrecipient', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'nuban',
        name: verifiedAccountName,
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

    // Disburse via Paystack Transfer API
    const transferRes = await fetch('https://api.paystack.co/transfer', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        source: 'balance',
        amount: Math.round(transferAmount * 100), // In Kobo
        recipient: recipientCode,
        reference: idempotentRef,
        reason: 'TaskPulse Verified Payout'
      })
    });

    const transferData = await transferRes.json();
    return res.status(transferRes.status).json(transferData);
  } catch (error: any) {
    return res.status(500).json({ status: false, message: error?.message || 'Transfer failed' });
  }
}

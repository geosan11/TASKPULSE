import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { requireUser, getAdminClient, paystackRequest, handleApiError, HttpError } from './_lib/server';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: false, message: 'Method Not Allowed' });
  }

  try {
    const { user } = await requireUser(req);
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

    const admin = getAdminClient();

    // 1. Atomically evaluate all rules & deduct balance in Supabase
    const { data: rpcResult, error: rpcErr } = await admin.rpc('request_cashout', {
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

    const recipientCode = rpcResult?.recipient_code;
    if (!recipientCode) {
      throw new HttpError(500, 'Bank account does not have a Paystack recipient code.');
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
      await admin.rpc('finalize_cashout', {
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
      await admin.rpc('finalize_cashout', {
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

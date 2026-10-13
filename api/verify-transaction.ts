import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser, getAdminClient, paystackRequest, handleApiError, HttpError } from './_lib/server';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: false, message: 'Method Not Allowed' });
  }

  try {
    const { user } = await requireUser(req);
    const reference = req.body?.reference || req.query?.reference;

    if (!reference || typeof reference !== 'string') {
      throw new HttpError(400, 'Transaction reference is required.');
    }

    const admin = getAdminClient();

    // 1. Verify directly with Paystack API
    const paystackRes = await paystackRequest<{
      status: boolean;
      message: string;
      data?: {
        status: string;
        amount: number; // kobo
        currency: string;
        reference: string;
        customer?: { email: string };
      };
    }>(`/transaction/verify/${encodeURIComponent(reference)}`);

    if (!paystackRes.ok || !paystackRes.data?.status || !paystackRes.data.data) {
      throw new HttpError(
        400,
        paystackRes.data?.message || 'Payment verification failed with payment gateway.'
      );
    }

    const txData = paystackRes.data.data;
    if (txData.status !== 'success') {
      throw new HttpError(400, `Payment is not completed. Current status: ${txData.status}`);
    }

    if (txData.currency !== 'NGN') {
      throw new HttpError(400, 'Invalid currency: only NGN transactions are accepted.');
    }

    const actualAmountNaira = Math.floor(txData.amount / 100);

    // 2. Call the database settle_deposit RPC with row locks and idempotency
    const { data: settleResult, error: settleErr } = await admin.rpc('settle_deposit', {
      p_reference: reference,
      p_paid_amount: actualAmountNaira,
    });

    if (settleErr) {
      throw new HttpError(400, `Failed to settle deposit in database: ${settleErr.message}`);
    }

    // 3. Fetch latest profile
    const { data: updatedProfile } = await admin
      .from('profiles')
      .select('is_activated, withdrawable_balance, tier_id')
      .eq('id', user.id)
      .single();

    return res.status(200).json({
      status: true,
      message: 'Deposit verified and credited successfully.',
      data: {
        reference,
        amount: actualAmountNaira,
        settleResult,
        profile: updatedProfile,
      },
    });
  } catch (err: any) {
    return handleApiError(res, err);
  }
}

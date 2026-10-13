import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { requireUser, getAdminClient, paystackRequest, handleApiError, HttpError } from './_lib/server';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: false, message: 'Method Not Allowed' });
  }

  try {
    const { user } = await requireUser(req);
    const email = user.email;
    if (!email) {
      throw new HttpError(400, 'Your user profile does not have an email address associated.');
    }

    const admin = getAdminClient();

    // Check user profile activation status
    const { data: profile, error: profileErr } = await admin
      .from('profiles')
      .select('is_activated, withdrawable_balance')
      .eq('id', user.id)
      .single();

    if (profileErr || !profile) {
      throw new HttpError(404, 'User profile not found in database.');
    }

    const rawAmount = req.body?.amount !== undefined ? Number(req.body.amount) : 3000;
    if (isNaN(rawAmount) || rawAmount !== Math.floor(rawAmount)) {
      throw new HttpError(400, 'Deposit amount must be a whole Naira number.');
    }

    let enforcedAmount: number;
    if (!profile.is_activated) {
      // Must be exactly ₦3,000 for activation
      enforcedAmount = 3000;
    } else {
      if (rawAmount < 1000 || rawAmount > 500000) {
        throw new HttpError(400, 'Top-up deposit must be between ₦1,000 and ₦500,000.');
      }
      enforcedAmount = rawAmount;
    }

    // Generate unique deposit reference
    const depositRef = `dep_${crypto.randomUUID().replace(/-/g, '')}`;

    // Record pending transaction in Supabase with row-level locks
    const { error: rpcErr } = await admin.rpc('create_pending_deposit', {
      p_user_id: user.id,
      p_reference: depositRef,
      p_amount: enforcedAmount,
    });

    if (rpcErr) {
      throw new HttpError(400, `Could not initiate deposit: ${rpcErr.message}`);
    }

    // Determine return / callback URL
    const origin =
      process.env.APP_URL ||
      (req.headers['x-forwarded-proto'] && req.headers.host
        ? `${req.headers['x-forwarded-proto']}://${req.headers.host}`
        : req.headers.host
        ? `https://${req.headers.host}`
        : 'http://localhost:3000');
    const callbackUrl = `${origin.replace(/\/$/, '')}/?verify_deposit=${encodeURIComponent(depositRef)}`;

    // Call Paystack Initialize
    const paystackRes = await paystackRequest<{
      status: boolean;
      message: string;
      data?: {
        authorization_url: string;
        access_code: string;
        reference: string;
      };
    }>('/transaction/initialize', {
      method: 'POST',
      body: {
        email,
        amount: Math.round(enforcedAmount * 100), // in kobo
        reference: depositRef,
        currency: 'NGN',
        callback_url: callbackUrl,
        metadata: {
          app: 'TaskPulse',
          user_id: user.id,
          type: profile.is_activated ? 'wallet_topup' : 'activation_deposit',
          amount_naira: enforcedAmount,
        },
      },
    });

    if (!paystackRes.ok || !paystackRes.data?.status || !paystackRes.data.data) {
      throw new HttpError(
        502,
        paystackRes.data?.message || 'Paystack payment initialization failed. Please try again.'
      );
    }

    return res.status(200).json({
      status: true,
      data: {
        authorization_url: paystackRes.data.data.authorization_url,
        access_code: paystackRes.data.data.access_code,
        reference: depositRef,
        amount: enforcedAmount,
      },
    });
  } catch (err: any) {
    return handleApiError(res, err);
  }
}

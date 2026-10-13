import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser, getAdminClient, paystackRequest, handleApiError, HttpError } from './_lib/server';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: false, message: 'Method Not Allowed' });
  }

  try {
    const { user } = await requireUser(req);
    const { accountNumber, bankCode, bankName } = req.body || {};

    const cleanAccount = String(accountNumber || '').trim();
    const cleanBankCode = String(bankCode || '').trim();
    const cleanBankName = String(bankName || '').trim();

    if (!/^\d{10}$/.test(cleanAccount)) {
      throw new HttpError(400, 'Invalid account number: Must be exactly 10 digits.');
    }
    if (!/^[a-zA-Z0-9]{3,6}$/.test(cleanBankCode)) {
      throw new HttpError(400, 'Invalid bank code format.');
    }

    const admin = getAdminClient();

    // 1. Get user profile
    const { data: profile, error: profErr } = await admin
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single();

    if (profErr || !profile) {
      throw new HttpError(404, 'User profile not found.');
    }

    // 2. Resolve account with Paystack
    const query = new URLSearchParams({
      account_number: cleanAccount,
      bank_code: cleanBankCode,
    });
    const resolveRes = await paystackRequest<{
      status: boolean;
      message: string;
      data?: { account_name: string; account_number: string };
    }>(`/bank/resolve?${query.toString()}`);

    if (!resolveRes.ok || !resolveRes.data?.status || !resolveRes.data.data) {
      throw new HttpError(400, resolveRes.data?.message || 'Unable to resolve bank account with Paystack.');
    }

    const resolvedName = resolveRes.data.data.account_name.trim();

    // 3. Name check: require at least one significant name match between profile and bank
    const profileTokens = (profile.full_name || '')
      .toUpperCase()
      .split(/\s+/)
      .filter((t: string) => t.length > 2);
    const bankTokens = resolvedName
      .toUpperCase()
      .split(/\s+/)
      .filter((t: string) => t.length > 2);

    const hasMatch = profileTokens.some((pt: string) => bankTokens.includes(pt));
    if (profileTokens.length > 0 && !hasMatch) {
      throw new HttpError(
        400,
        `Bank account name mismatch: The account name "${resolvedName}" does not match your registered profile name.`
      );
    }

    // 4. Check maximum banks per user (limit 3)
    const { count: bankCount, error: countErr } = await admin
      .from('bank_accounts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('is_active', true);

    if (countErr) {
      throw new HttpError(500, countErr.message);
    }
    if ((bankCount || 0) >= 3) {
      throw new HttpError(400, 'Maximum of 3 bank accounts allowed per user.');
    }

    // 5. Prevent duplicate linking across different accounts
    const { data: existingOther } = await admin
      .from('bank_accounts')
      .select('id')
      .eq('account_number', cleanAccount)
      .eq('bank_code', cleanBankCode)
      .neq('user_id', user.id)
      .eq('is_active', true)
      .limit(1);

    if (existingOther && existingOther.length > 0) {
      throw new HttpError(400, 'This bank account is already linked to another TaskPulse account.');
    }

    // 6. Create Transfer Recipient on Paystack
    const recipientRes = await paystackRequest<{
      status: boolean;
      message: string;
      data?: {
        recipient_code: string;
      };
    }>('/transferrecipient', {
      method: 'POST',
      body: {
        type: 'nuban',
        name: resolvedName,
        account_number: cleanAccount,
        bank_code: cleanBankCode,
        currency: 'NGN',
        description: `TaskPulse payout recipient for user ${user.id}`,
      },
    });

    if (!recipientRes.ok || !recipientRes.data?.status || !recipientRes.data.data?.recipient_code) {
      throw new HttpError(
        502,
        recipientRes.data?.message || 'Failed to create Paystack transfer recipient.'
      );
    }

    const recipientCode = recipientRes.data.data.recipient_code;

    // 7. Insert or activate bank account in Supabase
    const { data: insertedBank, error: insertErr } = await admin
      .from('bank_accounts')
      .upsert(
        {
          user_id: user.id,
          bank_code: cleanBankCode,
          bank_name: cleanBankName || 'Commercial Bank',
          account_number: cleanAccount,
          account_name: resolvedName,
          recipient_code: recipientCode,
          is_active: true,
        },
        { onConflict: 'user_id, account_number, bank_code' }
      )
      .select()
      .single();

    if (insertErr) {
      throw new HttpError(500, `Failed to save bank account: ${insertErr.message}`);
    }

    return res.status(200).json({
      status: true,
      message: 'Bank account linked successfully.',
      data: insertedBank,
    });
  } catch (err: any) {
    return handleApiError(res, err);
  }
}

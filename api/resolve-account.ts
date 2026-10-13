import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser, paystackRequest, handleApiError, HttpError } from './_lib/server';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ status: false, message: 'Method Not Allowed' });
  }

  try {
    // 1. Require valid logged-in user to prevent open-proxy abuse
    await requireUser(req);

    const accountNumber = String(req.query.account_number || '').trim();
    const bankCode = String(req.query.bank_code || '').trim();

    if (!/^\d{10}$/.test(accountNumber)) {
      throw new HttpError(400, 'Invalid account number: Must be exactly 10 digits.');
    }

    if (!/^[a-zA-Z0-9]{3,6}$/.test(bankCode)) {
      throw new HttpError(400, 'Invalid bank code format.');
    }

    // 2. Resolve account with Paystack
    const query = new URLSearchParams({
      account_number: accountNumber,
      bank_code: bankCode,
    });

    const paystackRes = await paystackRequest<{
      status: boolean;
      message: string;
      data?: {
        account_number: string;
        account_name: string;
        bank_id: number;
      };
    }>(`/bank/resolve?${query.toString()}`);

    if (!paystackRes.ok || !paystackRes.data?.status || !paystackRes.data.data) {
      throw new HttpError(
        400,
        paystackRes.data?.message || 'Could not resolve bank account details. Verify bank code and account number.'
      );
    }

    return res.status(200).json({
      status: true,
      message: 'Bank account resolved successfully',
      data: paystackRes.data.data,
    });
  } catch (err: any) {
    return handleApiError(res, err);
  }
}

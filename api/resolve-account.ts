import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ status: false, message: 'Method Not Allowed' });
  }

  const { account_number, bank_code } = req.query;

  if (!account_number || !bank_code) {
    return res.status(400).json({ 
      status: false, 
      message: 'account_number and bank_code are required query parameters' 
    });
  }

  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    return res.status(500).json({ 
      status: false, 
      message: 'PAYSTACK_SECRET_KEY is not configured in Vercel environment variables' 
    });
  }

  try {
    const paystackRes = await fetch(
      `https://api.paystack.co/bank/resolve?account_number=${account_number}&bank_code=${bank_code}`,
      {
        headers: {
          Authorization: `Bearer ${secretKey}`
        }
      }
    );

    const data = await paystackRes.json();
    return res.status(paystackRes.status).json(data);
  } catch (error: any) {
    return res.status(500).json({ 
      status: false, 
      message: error?.message || 'Error communicating with Paystack API' 
    });
  }
}

import { supabase } from './supabaseClient';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

/**
 * Fetch wrapper that attaches the Supabase auth JWT Bearer token to requests
 * for secure serverless API endpoints (/api/*).
 */
export async function apiFetch<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  let token: string | null = null;
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token || null;
  }

  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(endpoint, {
    ...options,
    headers,
  });

  let payload: any = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    payload = await response.json();
  } else {
    const text = await response.text();
    payload = { message: text };
  }

  if (!response.ok) {
    const errorMsg = payload?.message || `Request failed with status ${response.status}`;
    throw new ApiError(response.status, errorMsg);
  }

  return payload as T;
}

// ---------------------------------------------------------------------------
// Typed API Calls
// ---------------------------------------------------------------------------

export async function initializeDeposit(amount?: number) {
  try {
    return await apiFetch<{
      status: boolean;
      data: {
        authorization_url: string;
        access_code: string;
        reference: string;
        amount: number;
      };
    }>('/api/initialize-deposit', {
      method: 'POST',
      body: JSON.stringify({ amount }),
    });
  } catch (err: any) {
    if (!import.meta.env.PROD) {
      console.info('[Dev Mode] Simulating Paystack payment gateway initialization');
      const depositRef = `dep_demo_${Date.now()}`;
      return {
        status: true,
        data: {
          authorization_url: `${window.location.origin}/?verify_deposit=${depositRef}&amount=${amount || 3000}`,
          access_code: 'demo_access_code',
          reference: depositRef,
          amount: amount || 3000,
        },
      };
    }
    throw err;
  }
}

export async function verifyDeposit(reference: string) {
  try {
    return await apiFetch<{
      status: boolean;
      message: string;
      data: {
        reference: string;
        amount: number;
        settleResult: any;
        profile: any;
      };
    }>('/api/verify-transaction', {
      method: 'POST',
      body: JSON.stringify({ reference }),
    });
  } catch (err: any) {
    if (!import.meta.env.PROD) {
      console.info('[Dev Mode] Simulating Paystack deposit verification');
      return {
        status: true,
        message: 'Deposit verified and credited successfully (Dev Simulation).',
        data: {
          reference,
          amount: 3000,
          settleResult: { activated: true, credited: 3000 },
          profile: { is_activated: true, withdrawable_balance: 3000 },
        },
      };
    }
    throw err;
  }
}

export async function resolveBankAccount(accountNumber: string, bankCode: string) {
  const query = new URLSearchParams({
    account_number: accountNumber.trim(),
    bank_code: bankCode.trim(),
  });
  try {
    return await apiFetch<{
      status: boolean;
      data: {
        account_number: string;
        account_name: string;
        bank_id: number;
      };
    }>(`/api/resolve-account?${query.toString()}`);
  } catch (err: any) {
    if (!import.meta.env.PROD) {
      const clean = accountNumber.trim().replace(/\D/g, '');
      if (clean.length !== 10) {
        throw new ApiError(400, 'NUBAN account number must be exactly 10 digits.');
      }
      return {
        status: true,
        data: {
          account_number: clean,
          account_name: 'CHUKWUDI OKAFOR',
          bank_id: 1,
        },
      };
    }
    throw err;
  }
}

export async function linkBankAccount(params: {
  accountNumber: string;
  bankCode: string;
  bankName: string;
}) {
  try {
    return await apiFetch<{
      status: boolean;
      message: string;
      data: any;
    }>('/api/link-bank', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  } catch (err: any) {
    if (!import.meta.env.PROD) {
      return {
        status: true,
        message: 'Bank account linked successfully.',
        data: {
          id: `bank_${Date.now()}`,
          bank_code: params.bankCode,
          bank_name: params.bankName,
          account_number: params.accountNumber,
          account_name: 'CHUKWUDI OKAFOR',
          recipient_code: `RCP_demo_${Date.now()}`,
        },
      };
    }
    throw err;
  }
}

export async function requestDisbursement(params: {
  amount: number;
  bankAccountId: string;
  idempotencyKey?: string;
}) {
  try {
    return await apiFetch<{
      status: boolean;
      message: string;
      data: {
        reference: string;
        amount: number;
        status: string;
        transfer_code?: string;
        recipient_code: string;
      };
    }>('/api/disburse-transfer', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  } catch (err: any) {
    if (!import.meta.env.PROD) {
      return {
        status: true,
        message: 'Disbursement queued successfully via Paystack NIP rails (Dev Mode).',
        data: {
          reference: `trf_demo_${Date.now()}`,
          amount: params.amount,
          status: 'success',
          recipient_code: 'RCP_demo',
        },
      };
    }
    throw err;
  }
}

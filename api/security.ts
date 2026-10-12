import crypto from 'crypto';

export interface VerifiedFinancialState {
  userId: string;
  isActivated: boolean;
  activationTimestamp: number;
  initialDeposit: number;
  qualifiedReferralsCount: number;
  referralsVolume: number;
  withdrawableBalance: number;
}

/**
 * Creates a cryptographically signed HMAC SHA256 token of the user's financial state.
 * No user can forge or modify their balance, activation date, or referral counts in DevTools
 * because only the server knows PAYSTACK_SECRET_KEY.
 */
export function signFinancialState(state: VerifiedFinancialState, secretKey: string): string {
  const payload = JSON.stringify({
    userId: state.userId,
    isActivated: state.isActivated,
    activationTimestamp: state.activationTimestamp,
    initialDeposit: state.initialDeposit,
    qualifiedReferralsCount: state.qualifiedReferralsCount,
    referralsVolume: state.referralsVolume,
    withdrawableBalance: state.withdrawableBalance
  });

  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(payload)
    .digest('hex');

  // Return base64 payload concatenated with signature
  const encodedPayload = Buffer.from(payload).toString('base64');
  return `${encodedPayload}.${signature}`;
}

/**
 * Verifies and decodes the financial state. Returns null if tampered with.
 */
export function verifyFinancialState(token: string, secretKey: string): VerifiedFinancialState | null {
  try {
    const [encodedPayload, signature] = token.split('.');
    if (!encodedPayload || !signature) return null;

    const payload = Buffer.from(encodedPayload, 'base64').toString('utf-8');

    const expectedSignature = crypto
      .createHmac('sha256', secretKey)
      .update(payload)
      .digest('hex');

    if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      return JSON.parse(payload) as VerifiedFinancialState;
    }
    return null;
  } catch (err) {
    return null;
  }
}

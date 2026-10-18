// Withdrawals need a verified identity (enforced on the server by
// api/disburse-transfer.ts and request_cashout() in migration 012). The free
// way to get verified is the bank account: /api/link-bank resolves the
// account name with Paystack and matches it to the profile name.
// This file only decides what the app SHOWS; it is not a security check.

/** Error code returned by /api/disburse-transfer when the ID is not verified. */
export const ID_REQUIRED_CODE = 'identity_not_verified';

export type WithdrawIdPrompt = {
  title: string;
  body: string;
  /** What the button does: add a bank account, re-check the saved one, or nothing yet. */
  action: 'add_bank' | 'check_bank' | null;
  actionLabel: string | null;
};

export const ADD_BANK_PROMPT: WithdrawIdPrompt = {
  title: 'Add your bank account',
  body: "Add your bank account to withdraw. We check that the name on it matches your profile. It's a one-time check that keeps payouts safe.",
  action: 'add_bank',
  actionLabel: 'Add bank account',
};

export const CHECK_BANK_PROMPT: WithdrawIdPrompt = {
  title: 'Check your bank account',
  body: "Before you withdraw, we check that the name on your bank account matches your profile. It's a one-time check that keeps payouts safe.",
  action: 'check_bank',
  actionLabel: 'Check my account',
};

export const PENDING_PROMPT: WithdrawIdPrompt = {
  title: 'Checking your account',
  body: "We're checking your account name. This usually takes a few hours.",
  action: null,
  actionLabel: null,
};

export const REJECTED_PROMPT: WithdrawIdPrompt = {
  title: "We couldn't verify you",
  body: "The name on your bank account didn't match your profile. Contact support to withdraw.",
  action: null,
  actionLabel: null,
};

/** What to show when the user taps Withdraw, or null if their ID is verified. */
export function withdrawIdPrompt(kycStatus: string | null | undefined, hasBank: boolean): WithdrawIdPrompt | null {
  if (kycStatus === 'verified') return null;
  if (kycStatus === 'pending') return PENDING_PROMPT;
  if (kycStatus === 'rejected') return REJECTED_PROMPT;
  return hasBank ? CHECK_BANK_PROMPT : ADD_BANK_PROMPT; // unverified or missing
}

/** Short toast after saving a bank account, from the server's identity result. */
export function bankSavedNotice(kycStatus: string | null | undefined): { title: string; subtitle: string } {
  if (kycStatus === 'verified') return { title: 'Bank saved', subtitle: "Your ID is verified. You're ready to withdraw." };
  if (kycStatus === 'pending') return { title: 'Bank saved', subtitle: PENDING_PROMPT.body };
  if (kycStatus === 'rejected') return { title: 'Bank saved', subtitle: REJECTED_PROMPT.body };
  return { title: 'Bank saved', subtitle: 'Your payout account is saved.' };
}

/** True when a withdrawal error means "verify your ID first". */
export function isIdRequiredError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown };
  return e.code === ID_REQUIRED_CODE || (typeof e.message === 'string' && e.message.includes(ID_REQUIRED_CODE));
}

// Withdrawals need a verified identity (enforced on the server by
// api/disburse-transfer.ts and request_cashout() in migration 012).
// This file only decides what the app SHOWS; it is not a security check.

/** Error code returned by /api/disburse-transfer when the ID is not verified. */
export const ID_REQUIRED_CODE = 'identity_not_verified';

export type WithdrawIdPrompt = {
  title: string;
  body: string;
  /** Label for the button that opens the Verify identity screen, or null when there is nothing to do yet. */
  action: string | null;
};

export const ID_REQUIRED_PROMPT: WithdrawIdPrompt = {
  title: 'Verify your ID',
  body: "Verify your ID to withdraw. It's a one-time check that keeps payouts safe.",
  action: 'Verify identity',
};

export const ID_PENDING_PROMPT: WithdrawIdPrompt = {
  title: "We're checking your ID",
  body: "You can withdraw once your ID is verified. We'll update your profile when it's done.",
  action: null,
};

/** What to show when the user taps Withdraw, or null if their ID is verified. */
export function withdrawIdPrompt(kycStatus: string | null | undefined): WithdrawIdPrompt | null {
  if (kycStatus === 'verified') return null;
  if (kycStatus === 'pending') return ID_PENDING_PROMPT;
  return ID_REQUIRED_PROMPT; // unverified, rejected, missing
}

/** True when a withdrawal error means "verify your ID first". */
export function isIdRequiredError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown };
  return e.code === ID_REQUIRED_CODE || (typeof e.message === 'string' && e.message.includes(ID_REQUIRED_CODE));
}

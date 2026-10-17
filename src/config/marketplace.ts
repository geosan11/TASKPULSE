/**
 * TaskPulse marketplace rules (display defaults).
 *
 * The database is the source of truth: every money rule is enforced inside
 * Postgres functions that read the single row in `public.marketplace_settings`
 * (see supabase/008_free_marketplace.sql). The app loads that row at start-up
 * and only falls back to these values if it cannot be read, so keep the two in
 * sync when you change either.
 */
export interface MarketplaceSettings {
  minWithdrawal: number;
  dailyWithdrawalLimit: number;
  maxWithdrawalsPerDay: number;
  payoutCooldownHours: number;
  referralBonusReferrer: number;
  referralBonusReferee: number;
  referralQualifyingTasks: number;
  referralMaxBonusesPerReferrer: number;
  platformFeeRate: number;
  minRewardPerTask: number;
  maxRewardPerTask: number;
  minCampaignSlots: number;
  maxCampaignSlots: number;
  /** Cancelling refunds the platform fee on unused slots too (009). */
  refundFeeOnUnused: boolean;
  /** Referral bonus only once the referee's third-party work generated enough fee (009). */
  referralRequireFeeCover: boolean;
}

export const DEFAULT_MARKETPLACE_SETTINGS: MarketplaceSettings = {
  minWithdrawal: 1000,
  dailyWithdrawalLimit: 20000,
  maxWithdrawalsPerDay: 2,
  payoutCooldownHours: 48,
  referralBonusReferrer: 200,
  referralBonusReferee: 0,
  referralQualifyingTasks: 3,
  referralMaxBonusesPerReferrer: 50,
  platformFeeRate: 0.25,
  minRewardPerTask: 50,
  maxRewardPerTask: 5000,
  minCampaignSlots: 5,
  maxCampaignSlots: 10000,
  refundFeeOnUnused: true,
  referralRequireFeeCover: true,
};

export const TASK_CATEGORIES = ['Social', 'App Tests', 'Surveys', 'Reviews', 'Field Audits', 'Other'] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export const PROOF_TYPES = [
  { id: 'screenshot', label: 'Screenshot', hint: 'Worker uploads an image as proof' },
  { id: 'text', label: 'Text answer', hint: 'Worker types a username, code or answer' },
  { id: 'link', label: 'Link', hint: 'Worker pastes a URL (e.g. their review or post)' },
] as const;
export type ProofType = (typeof PROOF_TYPES)[number]['id'];

export const HEARD_ABOUT_US_OPTIONS = [
  'Friend or family',
  'WhatsApp',
  'Instagram',
  'TikTok',
  'Twitter / X',
  'Facebook',
  'Google search',
  'Telegram',
  'Other',
] as const;

/**
 * Campaign cost = reward x slots + platform fee, the fee rounded UP to whole
 * Naira. Display only: create_campaign() computes the real amount. Integer
 * maths (fee rate in basis points) so floating point can never show a total
 * that differs from the server's by N1 (e.g. 100 x 1.07 = 107.00000000000001).
 */
export function computeCampaignCost(reward: number, slots: number, feeRate: number) {
  const r = Number.isFinite(reward) ? Math.max(0, Math.floor(reward)) : 0;
  const n = Number.isFinite(slots) ? Math.max(0, Math.floor(slots)) : 0;
  const bps = Math.round(Math.max(0, feeRate) * 10000);
  const rewardBudget = r * n;
  const platformFee = Math.ceil((rewardBudget * bps) / 10000);
  const feePerResponse = (r * bps) / 10000;
  return { rewardBudget, platformFee, total: rewardBudget + platformFee, costPerResponse: r + feePerResponse, feePerResponse };
}

/** What cancelling refunds now (mirrors set_campaign_status() in 009). Display only. */
export function computeCancelRefund(
  c: { escrowBalance: number; slotsPending: number; slotsApproved: number; rewardPerCompletion: number; platformFee: number; feeRefundDue: number },
  feeRate: number,
  refundFee: boolean
) {
  const reward = Math.max(0, c.escrowBalance - c.slotsPending * c.rewardPerCompletion);
  const feeLeft = Math.max(0, c.platformFee - c.feeRefundDue);
  let fee = 0;
  if (refundFee && reward > 0 && feeLeft > 0) {
    fee = c.slotsApproved === 0 && c.slotsPending === 0 ? feeLeft : Math.min(feeLeft, Math.floor(reward * feeRate));
  }
  return { reward, fee, total: reward + fee };
}

/** Plain-language referral offer, correct when the friend's bonus is N0. */
export function referralOffer(s: MarketplaceSettings) {
  const you = formatNaira(s.referralBonusReferrer);
  const them = formatNaira(s.referralBonusReferee);
  if (s.referralBonusReferee <= 0) return `Invite a friend, get ${you}`;
  if (s.referralBonusReferee === s.referralBonusReferrer) return `Invite a friend, you both get ${you}`;
  return `Invite a friend: ${you} for you, ${them} for them`;
}

export const formatNaira = (n: number) =>
  `₦${Number(n || 0).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

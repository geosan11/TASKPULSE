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
}

export const DEFAULT_MARKETPLACE_SETTINGS: MarketplaceSettings = {
  minWithdrawal: 1000,
  dailyWithdrawalLimit: 20000,
  maxWithdrawalsPerDay: 2,
  payoutCooldownHours: 48,
  referralBonusReferrer: 200,
  referralBonusReferee: 200,
  referralQualifyingTasks: 3,
  referralMaxBonusesPerReferrer: 50,
  platformFeeRate: 0.25,
  minRewardPerTask: 50,
  maxRewardPerTask: 5000,
  minCampaignSlots: 5,
  maxCampaignSlots: 10000,
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

/** Campaign cost = reward x slots x (1 + platform fee), rounded up to whole Naira (matches create_campaign()). */
export function computeCampaignCost(reward: number, slots: number, feeRate: number) {
  const rewardBudget = Math.max(0, reward) * Math.max(0, slots);
  const total = Math.ceil(rewardBudget * (1 + feeRate));
  return { rewardBudget, platformFee: total - rewardBudget, total };
}

export const formatNaira = (n: number) =>
  `₦${Number(n || 0).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

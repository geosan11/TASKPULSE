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

/**
 * Campaign categories. Must match create_campaign() / chk_campaign_category
 * in supabase/010_task_categories_policy.sql. 'Reviews' and 'Social' were
 * retired in 010 (they read like paid fake reviews / bought engagement); the
 * server still accepts them from old app builds and maps them like
 * normalizeCategory() below.
 */
export const TASK_CATEGORIES = ['Surveys', 'App Tests', 'Product Feedback', 'Field Audits', 'Community & Content', 'Other'] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

/** One-line guidance shown in the campaign builder for each category. */
export const CATEGORY_HINTS: Record<TaskCategory, string> = {
  Surveys: 'Questionnaires and polls. Ask for honest answers; never ask for passwords, BVN/NIN or card details.',
  'App Tests': 'Install, sign up or try a flow and report what happened. Testing only: no paid store ratings.',
  'Product Feedback':
    'Honest, private feedback sent to you (form, text or call). Never a public review on Google, App Store, Play Store, Jumia or similar.',
  'Field Audits': 'Visit a location, check prices, stock or signage and send a photo.',
  'Community & Content':
    'Join a community, try content and say what works, or create original content. Paying for follows, likes, subscribers or reposts is not allowed.',
  Other: 'Any other lawful task with clear steps and checkable proof.',
};

const LEGACY_CATEGORIES: Record<string, TaskCategory> = { reviews: 'Product Feedback', review: 'Product Feedback', social: 'Community & Content' };

/** Display label for a stored category (maps pre-010 labels). */
export function normalizeCategory(category: string | null | undefined): string {
  const c = (category || '').trim();
  if (!c) return 'Other';
  return LEGACY_CATEGORIES[c.toLowerCase()] || c;
}

/** What businesses may not post. Shown on /business, in the builder and in the Terms. */
export const NOT_ALLOWED_TASKS = [
  'Fake, paid or incentivised public reviews or star ratings (Google, App Store, Play Store, Jumia, Konga and similar)',
  'Buying followers, likes, subscribers, views or reposts',
  'Asking for passwords, OTPs, BVN/NIN, card details or any payment from workers',
  'Anything illegal, adult, gambling, crypto/investment schemes, or that breaks another platform’s rules',
] as const;

export type ProhibitedReason = 'fake_engagement' | 'public_review' | 'social_engagement';

const STORES = '(google|play\\s*store|app\\s*store|apple|jumia|konga|jiji|trustpilot|tripadvisor|yelp|maps)';
const PROHIBITED_PATTERNS: [ProhibitedReason, RegExp][] = [
  ['fake_engagement', /fake\s+(reviews?|ratings?|accounts?|followers|likes)/],
  ['public_review', /\b(5|five)[\s-]*stars?\b/],
  ['public_review', new RegExp(`\\b${STORES}\\s+(reviews?|ratings?)\\b`)],
  ['public_review', new RegExp(`\\b(reviews?|rate|ratings?)\\s+(us\\s+|our\\s+\\w+\\s+|the\\s+\\w+\\s+|it\\s+)?(on|in)\\s+(the\\s+)?${STORES}\\b`)],
  ['public_review', /\b(leave|write|post|drop)\s+(us\s+)?(an?\s+)?(positive\s+|good\s+|great\s+)?(public\s+)?(review|rating)\b/],
  ['social_engagement', /\b(buy|bought|sell|gain|grow|boost|increase|get)\s+(\w+\s+)?(followers|likes|subscribers|views|retweets)\b/],
  ['social_engagement', /\bfollow\s+(us|me|our|my|this|the)\s+(\w+\s+)?(page|account|handle|channel|profile|on)\b/],
  ['social_engagement', /\bfollow\s+(us|me)\b/],
  ['social_engagement', /\b(like|subscribe\s+to|retweet|repost|share)\s+(and\s+\w+\s+)?(our|my|this|the)\s+(\w+\s+)?(page|post|video|tweet|reel|photo|account|channel|status)\b/],
  ['social_engagement', /\bsubscribe\s+to\s+(our|my|this|the)\b/],
];

/**
 * Client mirror of campaign_prohibited_reason() in 010 (the server decides).
 * Returns null when the task looks fine.
 */
export function prohibitedTaskReason(title: string, instructions: string): ProhibitedReason | null {
  const t = `${title || ''}\n${instructions || ''}`.toLowerCase();
  for (const [reason, re] of PROHIBITED_PATTERNS) if (re.test(t)) return reason;
  return null;
}

export const PROHIBITED_MESSAGES: Record<ProhibitedReason, string> = {
  fake_engagement: 'Fake reviews, accounts or engagement are not allowed on TaskPulse.',
  public_review:
    'Paying for public reviews or star ratings is not allowed. Use Product Feedback and collect honest feedback privately (form, text answer or call).',
  social_engagement:
    'Paying for follows, likes, subscribers or reposts is not allowed. Ask people to try your content and give feedback, or to join a community, instead.',
};

export const PROOF_TYPES = [
  { id: 'screenshot', label: 'Screenshot', hint: 'Worker uploads an image as proof' },
  { id: 'text', label: 'Text answer', hint: 'Worker types a username, code or answer' },
  { id: 'link', label: 'Link', hint: 'Worker pastes a URL (e.g. a form confirmation or content they created)' },
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

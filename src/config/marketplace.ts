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
  /**
   * Review windows (011). Each submission stores its own deadline at submit time.
   * Auto: verified and approved instantly by the system (code matched or link check passed, no flags).
   * Human: everything a person should look at (screenshot proof, Product Feedback, Field Audits,
   * Other, high rewards, a worker's first tasks, flagged items, auto/manual campaigns).
   */
  reviewWindowAutoHours: number;
  reviewWindowHumanHours: number;
  /** When true, flagged submissions are never auto-approved; they wait for a person (011). */
  holdFlaggedForReview: boolean;
  /** A worker's first N approved tasks are always reviewed by a person (011). */
  trustedAfterTasks: number;
  /** Rewards above this are always reviewed by a person (011). */
  humanReviewRewardAbove: number;
  /** Minimum seconds between starting and submitting a task (011). */
  minTaskSeconds: number;
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
  platformFeeRate: 0.15,
  minRewardPerTask: 50,
  maxRewardPerTask: 5000,
  minCampaignSlots: 5,
  maxCampaignSlots: 10000,
  refundFeeOnUnused: true,
  referralRequireFeeCover: false,
  reviewWindowAutoHours: 24,
  reviewWindowHumanHours: 48,
  holdFlaggedForReview: false,
  trustedAfterTasks: 3,
  humanReviewRewardAbove: 1000,
  minTaskSeconds: 60,
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

// =========================================================================
// FAST APPROVALS (011). The server decides: resolve_approval_mode() and
// submit_task() in supabase/011_fast_approvals.sql. These mirror them for
// display and form defaults only.
// =========================================================================
export type ApprovalMode = 'instant' | 'auto' | 'manual';
export interface ReviewWindows {
  autoHours: number;
  humanHours: number;
  holdFlagged: boolean;
}
export const reviewWindowsFrom = (s: Pick<MarketplaceSettings, 'reviewWindowAutoHours' | 'reviewWindowHumanHours' | 'holdFlaggedForReview'>): ReviewWindows => ({
  autoHours: s.reviewWindowAutoHours,
  humanHours: s.reviewWindowHumanHours,
  holdFlagged: s.holdFlaggedForReview,
});
export type CodeMode = 'shared' | 'unique';

/** Categories that may use instant approval. Everything else is always reviewed by a person. */
export const INSTANT_CATEGORIES: readonly TaskCategory[] = ['Surveys', 'App Tests', 'Community & Content'];

export function approvalModeCopy(mode: ApprovalMode, w: ReviewWindows) {
  const a = `${w.autoHours}h`;
  const h = `${w.humanHours}h`;
  const flagged = w.holdFlagged
    ? 'Flagged submissions are never approved automatically; they wait for you.'
    : `Flagged submissions show their warnings to you, but are also approved after ${h} if you don't act.`;
  switch (mode) {
    case 'instant':
      return {
        label: 'Instant',
        title: 'Instant (automatic checks)',
        body: `Approved the moment the automatic checks pass (completion code or link). The reward stays pending for ${a} (${h} for screenshot proof) and you can reject it during that time. Anything that needs a person comes to you, with ${h} to review it.`,
      };
    case 'auto':
      return {
        label: 'You review, auto-approve',
        title: `You review, auto-approve after ${h}`,
        body: `You approve or reject each submission, with flagged items listed first. Anything you haven't reviewed within ${h} is approved automatically. ${flagged}`,
      };
    case 'manual':
      return {
        label: 'Manual',
        title: 'Manual review',
        body: `Same ${h} rule as "You review, auto-approve": anything unreviewed after ${h} is still approved so workers aren't stuck. The only difference is the default handling of checks: submissions are listed plainly in the order they arrive instead of flagged-first (flags still show). ${flagged}`,
      };
  }
}

/** Hours the worker's reward stays pending for an instant approval on this proof type. */
export const instantWindowHours = (proofType: ProofType, w: Pick<ReviewWindows, 'autoHours' | 'humanHours'>) =>
  proofType === 'screenshot' ? w.humanHours : w.autoHours;

/**
 * Which modes a business may pick, and the default (mirror of resolve_approval_mode()).
 * Instant needs a check TaskPulse can verify: a completion code, or link proof with a task link.
 */
export function approvalModeOptions(params: { category: TaskCategory; proofType: ProofType; hasCode: boolean; hasTargetUrl: boolean }) {
  const { category, proofType, hasCode, hasTargetUrl } = params;
  const instantCategory = INSTANT_CATEGORIES.includes(category);
  const hasCheck = hasCode || (proofType === 'link' && hasTargetUrl);
  const allowed: ApprovalMode[] = instantCategory && hasCheck ? ['instant', 'auto', 'manual'] : ['auto', 'manual'];
  const defaultMode: ApprovalMode = (category === 'Surveys' || category === 'App Tests') && hasCode ? 'instant' : 'auto';
  let instantBlockedReason: string | null = null;
  if (!instantCategory) instantBlockedReason = `${category} is always reviewed by a person.`;
  else if (!hasCheck) instantBlockedReason = 'Add a completion code (or use link proof with a task link) to allow instant approval.';
  return { allowed, defaultMode, instantBlockedReason };
}

/** Plain words for the automatic-check flags shown to businesses. */
export const CHECK_FLAG_LABELS: Record<string, string> = {
  wrong_code: 'Wrong completion code',
  missing_code: 'No completion code',
  too_fast: 'Submitted faster than the minimum time',
  not_started: 'Never opened the task in TaskPulse',
  duplicate_link: 'Same link already used in this campaign',
  duplicate_text: 'Same answer already sent in this campaign',
  duplicate_screenshot: 'Same screenshot already sent in this campaign',
  screenshot_unverified: 'Screenshot could not be fingerprinted',
  link_not_https: 'Link is not https',
  link_invalid: 'Link is not a valid web address',
  link_domain_mismatch: "Link is not on your task link's domain",
};

/** Why an item waits for a person even when checks pass. */
export const REVIEW_REASON_LABELS: Record<string, string> = {
  new_worker: 'New worker (first approved tasks are always reviewed)',
  high_reward: 'High reward (always reviewed)',
  category_review: 'Category is always reviewed',
  business_review: 'You review this campaign',
  no_automatic_check: 'No automatic check available',
};

/** "5h", "45m", or "now" until a timestamp. */
export function timeLeftLabel(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return 'now';
  const mins = Math.ceil(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  return `${Math.ceil(mins / 60)}h`;
}

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

/**
 * Approved worker-facing review timing line (matches 011 defaults:
 * trusted_after_tasks = 3, review_window_human_hours = 48, auto = 24).
 */
export const WORKER_REVIEW_TIMING = 'Your first 3 tasks are reviewed within 48 hours. After that, most are approved within 24 hours.';

import { supabase } from './supabaseClient';
import { DEFAULT_MARKETPLACE_SETTINGS, normalizeCategory, PROHIBITED_MESSAGES, type ApprovalMode, type CodeMode, type MarketplaceSettings, type ProofType } from '../config/marketplace';

// =========================================================================
// SETTINGS (single row in public.marketplace_settings)
// =========================================================================
export async function fetchMarketplaceSettings(): Promise<MarketplaceSettings> {
  if (!supabase) return DEFAULT_MARKETPLACE_SETTINGS;
  try {
    const { data, error } = await supabase.from('marketplace_settings').select('*').eq('id', 1).maybeSingle();
    if (error || !data) return DEFAULT_MARKETPLACE_SETTINGS;
    return {
      minWithdrawal: Number(data.min_withdrawal),
      dailyWithdrawalLimit: Number(data.daily_withdrawal_limit),
      maxWithdrawalsPerDay: Number(data.max_withdrawals_per_day),
      payoutCooldownHours: Number(data.payout_cooldown_hours),
      referralBonusReferrer: Number(data.referral_bonus_referrer),
      referralBonusReferee: Number(data.referral_bonus_referee),
      referralQualifyingTasks: Number(data.referral_qualifying_tasks),
      referralMaxBonusesPerReferrer: Number(data.referral_max_bonuses_per_referrer),
      platformFeeRate: Number(data.platform_fee_rate),
      minRewardPerTask: Number(data.min_reward_per_task),
      maxRewardPerTask: Number(data.max_reward_per_task),
      minCampaignSlots: Number(data.min_campaign_slots),
      maxCampaignSlots: Number(data.max_campaign_slots),
      // Columns added in 009; default to the 009 behaviour if not there yet.
      refundFeeOnUnused: data.refund_fee_on_unused ?? DEFAULT_MARKETPLACE_SETTINGS.refundFeeOnUnused,
      referralRequireFeeCover: data.referral_require_fee_cover ?? DEFAULT_MARKETPLACE_SETTINGS.referralRequireFeeCover,
      // Columns added in 011.
      reviewWindowAutoHours: Number(data.review_window_auto_hours ?? DEFAULT_MARKETPLACE_SETTINGS.reviewWindowAutoHours),
      reviewWindowHumanHours: Number(data.review_window_human_hours ?? DEFAULT_MARKETPLACE_SETTINGS.reviewWindowHumanHours),
      holdFlaggedForReview: Boolean(data.hold_flagged_for_review ?? DEFAULT_MARKETPLACE_SETTINGS.holdFlaggedForReview),
      trustedAfterTasks: Number(data.trusted_after_tasks ?? DEFAULT_MARKETPLACE_SETTINGS.trustedAfterTasks),
      humanReviewRewardAbove: Number(data.human_review_reward_above ?? DEFAULT_MARKETPLACE_SETTINGS.humanReviewRewardAbove),
      minTaskSeconds: Number(data.min_task_seconds ?? DEFAULT_MARKETPLACE_SETTINGS.minTaskSeconds),
    };
  } catch {
    return DEFAULT_MARKETPLACE_SETTINGS;
  }
}

// =========================================================================
// BUSINESS ACCOUNT
// =========================================================================
export async function becomeBusinessRpc(businessName: string) {
  if (!supabase) throw new Error('Database is not connected.');
  const { data, error } = await supabase.rpc('become_business', { p_business_name: businessName });
  if (error) {
    if (error.message.includes('invalid_business_name')) throw new Error('Please enter your business name.');
    throw new Error(error.message);
  }
  return data;
}

// =========================================================================
// CAMPAIGNS
// =========================================================================
export interface Campaign {
  id: string;
  title: string;
  instructions: string;
  category: string;
  proofType: ProofType;
  targetUrl: string | null;
  rewardPerCompletion: number;
  slots: number;
  rewardBudget: number;
  platformFee: number;
  /** The rate this campaign was priced at (stored; 25% before 016). */
  platformFeeRate: number;
  totalCharge: number;
  escrowBalance: number;
  slotsApproved: number;
  slotsPending: number;
  /** Accepted by a worker, proof not sent yet (013; 0 before it runs). */
  slotsHeld: number;
  refundDue: number;
  feeRefundDue: number;
  refundedAmount: number;
  status: 'pending_payment' | 'active' | 'paused' | 'completed' | 'cancelled';
  createdAt: string;
  fundedAt: string | null;
  approvalMode: ApprovalMode;
  completionCodeMode: CodeMode | null;
}

const CAMPAIGN_ERRORS: Record<string, string> = {
  business_account_required: 'Switch to a business account to post tasks.',
  invalid_reward: 'Reward per completion is outside the allowed range (whole Naira only).',
  invalid_slots: 'Number of slots is outside the allowed range.',
  invalid_proof_type: 'Choose a proof type.',
  invalid_category: 'Choose a category.',
  'prohibited_task:public_review': PROHIBITED_MESSAGES.public_review,
  'prohibited_task:social_engagement': PROHIBITED_MESSAGES.social_engagement,
  'prohibited_task:fake_engagement': PROHIBITED_MESSAGES.fake_engagement,
  prohibited_task: 'This task is not allowed on TaskPulse. See the Not allowed list.',
  chk_campaign_category: 'Choose a category.',
  chk_campaign: 'Please check the campaign details.',
  campaigns_title_check: 'Title must be at least 5 characters.',
  campaigns_instructions_check: 'Instructions must be 20 to 4,000 characters.',
  campaigns_target_url_check: 'Link must start with http:// or https://',
  not_campaign_owner: 'You can only manage your own campaigns.',
  invalid_status_change: 'That status change is not allowed.',
  instant_not_allowed_for_category: 'This category is always reviewed by a person, so it cannot be instant.',
  instant_needs_check: 'Instant approval needs a completion code (or link proof with a task link).',
  invalid_approval_mode: 'Choose how submissions are approved.',
  invalid_completion_code: 'Completion code must be 4 to 64 characters.',
  invalid_code_secret: 'The secret for per-worker codes must be 16 to 128 characters.',
  invalid_code_mode: 'Choose a completion code type.',
  unique_code_needs_link: 'Per-worker codes need a task link (we add the worker reference to it).',
};

function friendly(message: string, map: Record<string, string>) {
  const key = Object.keys(map).find(k => message.includes(k));
  return key ? map[key] : message;
}

/** Most recent unsettled checkout reference for a campaign (owner-only via RLS). */
export async function fetchLatestPendingCampaignPayment(campaignId: string): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('campaign_payments')
    .select('reference')
    .eq('campaign_id', campaignId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  return data[0].reference as string;
}

export async function fetchMyCampaigns(): Promise<Campaign[]> {
  if (!supabase) return [];
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('business_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error || !data) return [];
  return data.map((c: any) => ({
    id: c.id,
    title: c.title,
    instructions: c.instructions,
    category: normalizeCategory(c.category),
    proofType: c.proof_type,
    targetUrl: c.target_url,
    rewardPerCompletion: Number(c.reward_per_completion),
    slots: c.slots,
    rewardBudget: Number(c.reward_budget),
    platformFee: Number(c.platform_fee),
    platformFeeRate: Number(c.platform_fee_rate),
    totalCharge: Number(c.total_charge),
    escrowBalance: Number(c.escrow_balance),
    slotsApproved: c.slots_approved,
    slotsPending: c.slots_pending,
    slotsHeld: Number(c.slots_held || 0),
    refundDue: Number(c.refund_due),
    feeRefundDue: Number(c.fee_refund_due || 0),
    refundedAmount: Number(c.refunded_amount || 0),
    status: c.status,
    createdAt: c.created_at,
    fundedAt: c.funded_at,
    approvalMode: (c.approval_mode || 'manual') as ApprovalMode,
    completionCodeMode: (c.completion_code_mode || null) as CodeMode | null,
  }));
}

export async function createCampaignRpc(params: {
  title: string;
  instructions: string;
  category: string;
  proofType: ProofType;
  reward: number;
  slots: number;
  targetUrl?: string;
  approvalMode?: ApprovalMode;
  /** Sent once to the server, which stores only a salted hash (shared) or keeps the secret server-side (unique). */
  completionCode?: string;
  codeMode?: CodeMode;
}): Promise<{ campaign_id: string; total_charge: number; reward_budget: number; platform_fee: number; approval_mode: ApprovalMode }> {
  if (!supabase) throw new Error('Database is not connected.');
  const { data, error } = await supabase.rpc('create_campaign', {
    p_title: params.title,
    p_instructions: params.instructions,
    p_category: params.category,
    p_proof_type: params.proofType,
    p_reward: params.reward,
    p_slots: params.slots,
    p_target_url: params.targetUrl || null,
    p_approval_mode: params.approvalMode || null,
    p_completion_code: params.completionCode || null,
    p_code_mode: params.completionCode ? params.codeMode || 'shared' : null,
  });
  if (error) throw new Error(friendly(error.message, CAMPAIGN_ERRORS));
  return data;
}

export async function setCampaignStatusRpc(campaignId: string, status: 'active' | 'paused' | 'cancelled') {
  if (!supabase) throw new Error('Database is not connected.');
  const { data, error } = await supabase.rpc('set_campaign_status', { p_campaign_id: campaignId, p_status: status });
  if (error) throw new Error(friendly(error.message, CAMPAIGN_ERRORS));
  return data;
}

// =========================================================================
// SUBMISSION REVIEW (campaign owner or admin)
// =========================================================================
export interface ReviewSubmission {
  id: string;
  campaignId: string | null;
  campaignTitle: string;
  taskId: string;
  workerUsername: string;
  proofText: string | null;
  proofScreenshotPath: string | null;
  rewardAmount: number;
  status: 'pending' | 'approved' | 'rejected';
  reviewNote: string | null;
  completedAt: string;
  reviewedAt: string | null;
  approvalMode: ApprovalMode | null;
  approvalSource: 'business' | 'admin' | 'instant' | 'auto_timeout' | 'legacy' | null;
  payoutStatus: 'held' | 'released' | 'reversed' | null;
  /** End of the review window: auto-approve time (pending) or release time (approved). */
  reviewDeadlineAt: string | null;
  checkFlags: string[];
  reviewReasons: string[];
  codeStatus: 'match' | 'mismatch' | 'missing' | null;
  startedAt: string | null;
}

/** 'held' = approved but still inside the review window (can still be rejected). */
export type ReviewListStatus = 'pending' | 'held' | 'approved' | 'rejected';

export async function fetchReviewSubmissions(
  campaignId: string | null,
  status: ReviewListStatus | null = 'pending'
): Promise<ReviewSubmission[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('list_review_submissions', {
    p_campaign_id: campaignId,
    p_status: status,
    p_limit: 100,
  });
  if (error || !data) return [];
  return (data as any[]).map(r => ({
    id: r.id,
    campaignId: r.campaign_id,
    campaignTitle: r.campaign_title,
    taskId: r.task_id,
    workerUsername: r.worker_username,
    proofText: r.proof_text,
    proofScreenshotPath: r.proof_screenshot_url,
    rewardAmount: Number(r.reward_amount),
    status: r.status,
    reviewNote: r.review_note,
    completedAt: r.completed_at,
    reviewedAt: r.reviewed_at,
    approvalMode: r.approval_mode ?? null,
    approvalSource: r.approval_source ?? null,
    payoutStatus: r.payout_status ?? null,
    reviewDeadlineAt: r.review_deadline_at ?? null,
    checkFlags: Array.isArray(r.check_flags) ? r.check_flags : [],
    reviewReasons: Array.isArray(r.review_reasons) ? r.review_reasons : [],
    codeStatus: r.code_status ?? null,
    startedAt: r.started_at ?? null,
  }));
}

/**
 * Apply anything the review-window scheduler would do for the signed-in
 * user's own submissions and campaigns (auto-approve unreviewed items and
 * release closed windows). Safe and idempotent; ignored if 011 isn't applied.
 */
export async function processMyReviewWindows(): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.rpc('process_my_review_windows');
  } catch {
    // Best effort: the scheduler does the same work.
  }
}

const REVIEW_ERRORS: Record<string, string> = {
  not_campaign_owner: 'You can only review submissions to your own campaigns.',
  admin_required: 'Only an admin can review this submission.',
  escrow_insufficient: 'Campaign escrow is too low to pay this reward.',
  cannot_review_own_submission: 'You cannot review your own submission.',
  review_window_closed: 'The review window has closed, so this can no longer be rejected.',
  not_reversible: 'This submission can no longer be changed.',
};

export async function reviewSubmissionRpc(completionId: string, approve: boolean, note?: string) {
  if (!supabase) throw new Error('Database is not connected.');
  const { data, error } = await supabase.rpc('review_submission', {
    p_completion_id: completionId,
    p_approve: approve,
    p_note: note || null,
  });
  if (error) throw new Error(friendly(error.message, REVIEW_ERRORS));
  return data;
}

/** Short-lived signed URL for a private proof screenshot (RLS limits who can sign). */
export async function getProofSignedUrl(path: string): Promise<string | null> {
  if (!supabase || !path) return null;
  const { data, error } = await supabase.storage.from('taskpulse-proofs').createSignedUrl(path, 300);
  if (error) return null;
  return data?.signedUrl || null;
}

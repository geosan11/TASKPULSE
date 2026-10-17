import { supabase } from './supabaseClient';
import { DEFAULT_MARKETPLACE_SETTINGS, type MarketplaceSettings, type ProofType } from '../config/marketplace';

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
  totalCharge: number;
  escrowBalance: number;
  slotsApproved: number;
  slotsPending: number;
  refundDue: number;
  status: 'pending_payment' | 'active' | 'paused' | 'completed' | 'cancelled';
  createdAt: string;
  fundedAt: string | null;
}

const CAMPAIGN_ERRORS: Record<string, string> = {
  business_account_required: 'Switch to a business account to post tasks.',
  invalid_reward: 'Reward per completion is outside the allowed range (whole Naira only).',
  invalid_slots: 'Number of slots is outside the allowed range.',
  invalid_proof_type: 'Choose a proof type.',
  invalid_category: 'Choose a category.',
  chk_campaign: 'Please check the campaign details.',
  campaigns_title_check: 'Title must be at least 5 characters.',
  campaigns_instructions_check: 'Instructions must be 20 to 4,000 characters.',
  campaigns_target_url_check: 'Link must start with http:// or https://',
  not_campaign_owner: 'You can only manage your own campaigns.',
  invalid_status_change: 'That status change is not allowed.',
};

function friendly(message: string, map: Record<string, string>) {
  const key = Object.keys(map).find(k => message.includes(k));
  return key ? map[key] : message;
}

export async function fetchMyCampaigns(): Promise<Campaign[]> {
  if (!supabase) return [];
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('campaigns')
    .select('id, title, instructions, category, proof_type, target_url, reward_per_completion, slots, reward_budget, platform_fee, total_charge, escrow_balance, slots_approved, slots_pending, refund_due, status, created_at, funded_at')
    .eq('business_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error || !data) return [];
  return data.map((c: any) => ({
    id: c.id,
    title: c.title,
    instructions: c.instructions,
    category: c.category,
    proofType: c.proof_type,
    targetUrl: c.target_url,
    rewardPerCompletion: Number(c.reward_per_completion),
    slots: c.slots,
    rewardBudget: Number(c.reward_budget),
    platformFee: Number(c.platform_fee),
    totalCharge: Number(c.total_charge),
    escrowBalance: Number(c.escrow_balance),
    slotsApproved: c.slots_approved,
    slotsPending: c.slots_pending,
    refundDue: Number(c.refund_due),
    status: c.status,
    createdAt: c.created_at,
    fundedAt: c.funded_at,
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
}): Promise<{ campaign_id: string; total_charge: number; reward_budget: number; platform_fee: number }> {
  if (!supabase) throw new Error('Database is not connected.');
  const { data, error } = await supabase.rpc('create_campaign', {
    p_title: params.title,
    p_instructions: params.instructions,
    p_category: params.category,
    p_proof_type: params.proofType,
    p_reward: params.reward,
    p_slots: params.slots,
    p_target_url: params.targetUrl || null,
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
}

export async function fetchReviewSubmissions(
  campaignId: string | null,
  status: 'pending' | 'approved' | 'rejected' | null = 'pending'
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
  }));
}

const REVIEW_ERRORS: Record<string, string> = {
  not_campaign_owner: 'You can only review submissions to your own campaigns.',
  admin_required: 'Only an admin can review this submission.',
  escrow_insufficient: 'Campaign escrow is too low to pay this reward.',
  cannot_review_own_submission: 'You cannot review your own submission.',
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

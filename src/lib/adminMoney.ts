/**
 * Admin "Money" dashboard data (Profile > Money). Read-only.
 *
 * Every call is a SECURITY DEFINER Postgres RPC from migration 014 that checks
 * profiles.role = 'admin' for the signed-in user and raises 42501 for anyone
 * else; anon cannot execute them at all. Hiding the screen in the UI is not
 * the protection. No Vercel function is involved.
 */
import { supabase } from './supabaseClient';

export type Money = number;

export interface MoneySummary {
  generated_at: string;
  settings: { platform_fee_rate: number; referral_bonus_referrer: number; referral_bonus_referee: number; min_withdrawal: number };
  deposited: Money;
  deposits_count: number;
  legacy_deposits: Money;
  paid_out: Money;
  paid_out_count: number;
  withdrawals_failed_count: number;
  spent_on_workers: Money;
  fees_earned: Money;
  fee_other_kept: Money;
  referral_cost: Money;
  net_earned: Money;
  extras: { kind: string; amount: Money; count: number }[];
  pending: {
    reviews: { count: number; amount: Money };
    hold: { tracked: false } | { tracked: true; count: number; amount: Money };
    withdrawals: { count: number; amount: Money };
  };
  held: { total: Money; escrow: Money; unearned_fee: Money; refunds_owed: Money };
  refunds: { total: Money; paid: Money; owed: Money };
  books: { balanced: boolean; difference: Money; ledger_problem_campaigns: number | null };
  counts: {
    businesses: number;
    workers: number;
    workers_active: number;
    tasks_posted: number;
    tasks_live: number;
    approved_spots: number;
    wallet_withdrawable: Money;
    wallet_pending: Money;
  };
  signups: Record<string, { total: number; workers: number; from_utm: number }>;
  excluded_accounts: number;
}

export type EntryKind =
  | 'deposits'
  | 'withdrawals_paid'
  | 'withdrawals_pending'
  | 'withdrawals_failed'
  | 'fees'
  | 'spend'
  | 'extras'
  | 'reviews_pending'
  | 'hold'
  | 'held'
  | 'refunds'
  | 'tasks'
  | 'signups';

export interface EntryRow {
  at: string | null;
  title: string;
  who: string;
  amount: Money | null;
  status: string;
  detail: string;
  user_id: string | null;
}

export interface Page<T> {
  total: number;
  rows: T[];
}

export interface BusinessRow {
  id: string;
  name: string;
  username: string;
  joined: string;
  tasks_posted: number;
  tasks_live: number;
  deposited: Money;
  spent: Money;
  balance: Money;
}

export interface BusinessDetail {
  business: BusinessRow & {
    email: string;
    spent_workers: Money;
    fees: Money;
    refunds_paid: Money;
    refunds_owed: Money;
    escrow: Money;
  };
  campaigns: {
    id: string;
    title: string;
    status: string;
    slots: number;
    approved: number;
    pending: number;
    spots_left: number | null;
    reward: Money;
    spend: Money;
    paid_workers: Money;
    fee: Money;
    refund_due: Money;
    escrow: Money;
    funded_at: string;
  }[];
  unfunded_drafts: number;
  deposits: { at: string; reference: string; title: string; amount: Money; status: string; refunded: Money }[];
  transactions: { at: string; type: string; title: string; amount: Money; reference: string }[];
}

export type PayoutStatus = 'withdrawal_pending' | 'can_withdraw' | 'paid_out' | 'no_earnings' | 'not_yet';

export interface WorkerRow {
  id: string;
  name: string;
  username: string;
  joined: string;
  tasks_done: number;
  earned: Money;
  bonuses: Money;
  withdrawn: Money;
  referrals: number;
  referrals_paid: number;
  payout_status: PayoutStatus;
}

export interface WorkerDetail {
  worker: WorkerRow & {
    email: string;
    tasks_pending: number;
    withdrawal_pending: Money;
    balance: Money;
    pending_balance: Money;
    kyc_status: string;
    has_bank: boolean;
    payout_eligible_from: string | null;
    source: string;
  };
  submissions: { at: string; title: string; company: string; status: string; reward: Money }[];
  withdrawals: { at: string; amount: Money; status: string; bank: string | null; reference: string }[];
  referrals: { at: string; username: string; bonus_status: string; bonus: Money }[];
  transactions: { at: string; type: string; title: string; amount: Money; status: string }[];
}

/** Everything the screen needs; the preview swaps in fake data through this. */
export interface AdminMoneyApi {
  summary(): Promise<MoneySummary>;
  entries(kind: EntryKind, filter: string | null, limit: number, offset: number): Promise<Page<EntryRow>>;
  businesses(search: string, limit: number, offset: number): Promise<Page<BusinessRow>>;
  business(id: string): Promise<BusinessDetail>;
  workers(search: string, limit: number, offset: number): Promise<Page<WorkerRow>>;
  worker(id: string): Promise<WorkerDetail>;
}

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (error.code === '42501') throw new Error('Admins only.');
    if (error.code === 'PGRST202') throw new Error('Run migration 014 (supabase/014_admin_dashboard.sql) first.');
    throw new Error(error.message || 'Could not load the figures.');
  }
  return data as T;
}

export const supabaseAdminMoneyApi: AdminMoneyApi = {
  summary: () => rpc<MoneySummary>('admin_money_summary'),
  entries: (kind, filter, limit, offset) =>
    rpc<Page<EntryRow>>('admin_money_entries', { p_kind: kind, p_filter: filter, p_limit: limit, p_offset: offset }),
  businesses: (search, limit, offset) =>
    rpc<Page<BusinessRow>>('admin_business_list', { p_search: search || null, p_limit: limit, p_offset: offset }),
  business: id => rpc<BusinessDetail>('admin_business_detail', { p_business_id: id }),
  workers: (search, limit, offset) =>
    rpc<Page<WorkerRow>>('admin_worker_list', { p_search: search || null, p_limit: limit, p_offset: offset }),
  worker: id => rpc<WorkerDetail>('admin_worker_detail', { p_worker_id: id }),
};

/** ₦ with thousands separators; kobo only when there are any. */
export function naira(n: number | null | undefined): string {
  const v = Number(n || 0);
  const abs = Math.abs(v).toLocaleString('en-NG', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return `${v < 0 ? '-' : ''}₦${abs}`;
}

export const WORKER_GOAL = 100;

export const EXTRA_LABELS: Record<string, string> = {
  referral_bonus: 'Referral bonuses (to referrers)',
  welcome_bonus: 'Welcome bonuses (to referred users)',
  legacy_referral_commission: 'Old referral commission (pre-marketplace)',
  legacy_daily_reward: 'Old daily login rewards (pre-marketplace)',
  platform_task_reward: 'TaskPulse-funded task rewards',
};

/** Sign-up source lines, in display order. */
export const SIGNUP_BUCKETS: { id: string; label: string }[] = [
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'telegram_launch', label: 'Telegram · launch' },
  { id: 'telegram_unilag', label: 'Telegram · unilag' },
  { id: 'telegram_dsn', label: 'Telegram · dsn' },
  { id: 'telegram_other', label: 'Telegram · other' },
  { id: 'other', label: 'Other' },
  { id: 'unknown', label: 'Unknown' },
];

export const PAYOUT_STATUS_LABEL: Record<PayoutStatus, { label: string; tone: 'success' | 'pending' | 'failed' | 'neutral' }> = {
  withdrawal_pending: { label: 'Withdrawal pending', tone: 'pending' },
  can_withdraw: { label: 'Can withdraw', tone: 'success' },
  paid_out: { label: 'Paid out', tone: 'neutral' },
  no_earnings: { label: 'No earnings yet', tone: 'neutral' },
  not_yet: { label: 'Not eligible yet', tone: 'neutral' },
};

export const LEDGER_LABELS: Record<string, string> = {
  funding: 'Reward budget funded',
  platform_fee: 'Platform fee charged',
  payout: 'Worker paid',
  payout_reversal: 'Payment reversed',
  refund_due: 'Unused rewards to refund',
  fee_refund_due: 'Unused fee to refund',
  refund_paid: 'Refund sent',
};

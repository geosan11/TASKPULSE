export type Role = 'worker' | 'business' | 'admin';

export interface UserProfile {
  id: string;
  username: string;
  fullName: string;
  email: string;
  phone: string;
  role: Role;
  businessName: string | null;
  emailConfirmed: boolean;
  kycStatus: string;
  withdrawableBalance: number;
  pendingBalance: number;
  totalWithdrawnLifetime: number;
  streakDays: number;
  checkedInToday: boolean;
  referralCode: string;
  approvedTaskCount: number;
  firstTaskApprovedAt: string | null;
  payoutEligibleFrom: string | null;
  isLegacyMember: boolean;
  createdAt: string;
}

export interface TxItem {
  id: string;
  type: string;
  title: string;
  description: string;
  amount: number;
  status: string;
  reference: string;
  createdAt: string;
  destinationBank?: string | null;
}

export interface MySubmission {
  id: string;
  taskId: string;
  taskTitle: string;
  company: string;
  reward: number;
  paidAmount: number | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewNote: string | null;
  completedAt: string;
}

export interface ReferralItem {
  id: string;
  username: string;
  name: string;
  bonusStatus: string;
  bonusReferrerAmount: number;
  createdAt: string;
}

export interface SavedBank {
  id: string;
  bankCode: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
}

/** Display a credit/debit sign for a ledger row from the user's point of view. */
export function isDebit(type: string) {
  const t = type.toLowerCase();
  return t === 'cashout' || t === 'tier_upgrade' || t === 'tierupgrade' || t === 'campaign_funding';
}

export function txTypeLabel(type: string) {
  const t = type.toLowerCase();
  switch (t) {
    case 'task_payout':
    case 'taskpayout':
      return 'Task reward';
    case 'referral_bonus':
      return 'Referral bonus';
    case 'cashout':
      return 'Withdrawal';
    case 'campaign_funding':
      return 'Campaign funding';
    case 'deposit':
      return 'Legacy deposit';
    case 'streak_reward':
    case 'streakreward':
      return 'Legacy login bonus';
    case 'deposit_match':
    case 'match':
      return 'Legacy deposit match';
    case 'tier_upgrade':
    case 'tierupgrade':
      return 'Legacy tier upgrade';
    case 'payout':
      return 'Legacy referral commission';
    default:
      return type;
  }
}

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-NG', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });

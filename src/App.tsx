/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Analytics } from "@vercel/analytics/react";
import { 
  Compass, 
  Wallet, 
  CheckCircle2, 
  ArrowRight, 
  ArrowUpRight, 
  Lock, 
  Shield, 
  Plus, 
  X, 
  User, 
  Phone, 
  Eye, 
  EyeOff, 
  Copy, 
  Check, 
  Moon, 
  Sun, 
  Flame, 
  Sparkles, 
  Award, 
  Megaphone, 
  Share2, 
  ExternalLink, 
  Gift, 
  TrendingUp, 
  Bell, 
  Camera, 
  CheckSquare, 
  Menu,
  CreditCard,
  KeyRound,
  AlertTriangle,
  ChevronRight,
  Inbox,
  Timer,
  Clock,
  Zap,
  LockKeyhole,
  FileText,
  BadgeCheck,
  RefreshCw,
  Users,
  UserPlus,
  Crown,
  Layers,
  ArrowUpCircle,
  History,
  ArrowDownLeft,
  Download,
  Search,
  Receipt,
  Filter,
  Mail,
  MailCheck,
  LogOut,
  LogIn,
  UserCheck,
  ShieldAlert,
  FileCheck,
  ScrollText,
  Fingerprint
} from 'lucide-react';
import { triggerConfetti } from './utils/confetti';
import {
  supabase,
  isSupabaseConfigured,
  signUpUser,
  signInUser,
  signOutUser,
  resendVerificationEmail,
  checkDuplicateUser,
  getCurrentUserProfile,
  fetchTransactionsHistory,
  fetchReferralsHistory,
  fetchBankAccounts,
  claimDailyRewardRpc,
  upgradeTierRpc,
  submitKycRpc,
  submitTaskProofRpc,
  uploadTaskProofImage,
  updateProfileFullName,
  fetchActiveTasks
} from './lib/supabaseClient';
import {
  initializeDeposit,
  verifyDeposit,
  resolveBankAccount,
  linkBankAccount,
  requestDisbursement
} from './lib/api';

interface Task {
  id: string;
  title: string;
  company: string;
  reward: number;
  category: 'Social' | 'App Tests' | 'Surveys' | 'Field Audits';
  time: string;
  SLA: string;
  spotsLeft: number;
  spotsTotal: number;
  description: string;
  steps: string[];
  platformIcon?: string;
}

interface SavedBank {
  id: string;
  bankCode: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  type: string;
}

interface Transaction {
  id: string;
  type: 'Payout' | 'Cashout' | 'Streak' | 'Deposit' | 'DepositMatch' | 'TierUpgrade' | 'Escrow';
  title: string;
  sub: string;
  amount: number;
  status: 'Settled' | 'Disbursed' | 'Escrowed' | 'Pending' | 'Failed' | 'Declined' | 'Reversed';
  date: string;
  reference: string;
}

interface Submission {
  id: string;
  taskTitle: string;
  reward: number;
  timeAgo: string;
  device: string;
  file: string;
  status: 'Active' | 'Approved';
  autoUnlockTime: string;
}

interface Referral {
  id: string;
  username: string;
  name: string;
  depositedAmount: number;
  status: 'Qualified' | 'Pending Deposit';
  joinedTime: string;
}

interface Tier {
  id: string;
  name: string;
  badge: string;
  stakeAmount: number;
  withdrawalCap: number; // Cumulative maximum cashout before required upgrade
  multiplier: number;
  dailyMaxCashout: number;
  referralBoost: string;
  color: string;
  accentBg: string;
  description: string;
}

interface UserProfile {
  id?: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  accountStatus: string;
  kycLevel: string;
  kycStatus?: string;
  emailConfirmed?: boolean;
  tierId: string;
  level: number;
  streakDays: number;
  streakClaimedToday: boolean;
  dailyQuestProgress: number;
  referralCode: string;
  wagerActive: boolean;
  activationDate: string;
}

// 6 PROGRESSIVE FINTECH TIERS (8x to 10x Returns on Deposit)
const TIERS_CONFIG: Tier[] = [
  {
    id: 'tier-1',
    name: 'Bronze Pulse',
    badge: '🥉 BRONZE',
    stakeAmount: 3000,
    withdrawalCap: 24000, // Exactly 8x of ₦3,000 as requested
    multiplier: 8,
    dailyMaxCashout: 10000,
    referralBoost: '1.0x Commissions',
    color: 'text-amber-500',
    accentBg: 'bg-amber-500/10 border-amber-500/30 text-amber-500',
    description: 'Entry Tier. Maximum cumulative withdrawal cap is ₦24,000. Upgrade required beyond.'
  },
  {
    id: 'tier-2',
    name: 'Silver Pulse',
    badge: '🥈 SILVER',
    stakeAmount: 10000,
    withdrawalCap: 80000, // 8x of ₦10,000
    multiplier: 8,
    dailyMaxCashout: 25000,
    referralBoost: '1.25x Commissions',
    color: 'text-slate-300',
    accentBg: 'bg-slate-400/10 border-slate-400/30 text-slate-300',
    description: 'Explorer Tier. Unlocks up to ₦80,000 cumulative cashouts and higher referral rewards.'
  },
  {
    id: 'tier-3',
    name: 'Gold Pulse',
    badge: '🥇 GOLD',
    stakeAmount: 15000,
    withdrawalCap: 120000, // 8x of ₦15,000
    multiplier: 8,
    dailyMaxCashout: 40000,
    referralBoost: '1.5x Commissions',
    color: 'text-yellow-400',
    accentBg: 'bg-yellow-400/10 border-yellow-400/30 text-yellow-400',
    description: 'Pro Earner Tier. Unlocks up to ₦120,000 cumulative cashouts with accelerated payouts.'
  },
  {
    id: 'tier-4',
    name: 'Platinum Pulse',
    badge: '💎 PLATINUM',
    stakeAmount: 30000,
    withdrawalCap: 250000, // 8.3x of ₦30,000
    multiplier: 8.33,
    dailyMaxCashout: 75000,
    referralBoost: '2.0x Commissions',
    color: 'text-cyan-400',
    accentBg: 'bg-cyan-400/10 border-cyan-400/30 text-cyan-400',
    description: 'Elite Tier. Unlocks up to ₦250,000 cumulative cashouts with doubled referral earnings.'
  },
  {
    id: 'tier-5',
    name: 'Diamond Pulse',
    badge: '🔷 DIAMOND',
    stakeAmount: 50000,
    withdrawalCap: 450000, // 9x of ₦50,000
    multiplier: 9,
    dailyMaxCashout: 150000,
    referralBoost: '2.5x Commissions',
    color: 'text-blue-400',
    accentBg: 'bg-blue-400/10 border-blue-400/30 text-blue-400',
    description: 'Executive Tier. Unlocks up to ₦450,000 in lifetime disbursements.'
  },
  {
    id: 'tier-6',
    name: 'Black Crown VIP',
    badge: '👑 VIP CROWN',
    stakeAmount: 75000,
    withdrawalCap: 750000, // 10x of ₦75,000
    multiplier: 10,
    dailyMaxCashout: 250000,
    referralBoost: '3.5x Commissions + Priority Concierge',
    color: 'text-purple-400',
    accentBg: 'bg-purple-400/10 border-purple-400/30 text-purple-400',
    description: 'Top Master Tier. Unlocks up to ₦750,000 in payouts with maximum referral multipliers.'
  }
];

const PAYSTACK_BANKS = [
  { code: '50515', name: 'Moniepoint MFB' },
  { code: '999992', name: 'OPay Digital Services' },
  { code: '50211', name: 'Kuda Bank' },
  { code: '044', name: 'Access Bank PLC' },
  { code: '058', name: 'Guaranty Trust Bank (GTB)' },
  { code: '057', name: 'Zenith Bank' },
  { code: '033', name: 'United Bank for Africa (UBA)' },
  { code: '011', name: 'First Bank of Nigeria' }
];

// USER REQUEST: EXACTLY ONE ACTIVE TASK, THEN "MORE COMING SOON"
const DEFAULT_TASKS: Task[] = [
  {
    id: 't-soc-1',
    title: 'Follow & Like Brand Announcement on TikTok',
    company: 'Kuda FinTech Media',
    reward: 450,
    category: 'Social',
    time: '2m',
    SLA: 'Instant SLA Approval',
    spotsLeft: 34,
    spotsTotal: 150,
    description: 'Follow @kudabank on TikTok, like their latest pinned video, and submit your TikTok username or profile screenshot for instant escrow settlement.',
    steps: [
      'Open TikTok and navigate to official @kudabank profile.',
      'Tap Follow and Like the first pinned video regarding virtual card upgrades.',
      'Upload a screenshot or input your TikTok username to verify.'
    ],
    platformIcon: '🎵'
  }
];

const STREAK_DAYS_CONFIG = [
  { day: 1, reward: 100, label: '₦100', status: 'claimed' },
  { day: 2, reward: 100, label: '₦100', status: 'claimed' },
  { day: 3, reward: 100, label: '₦100', status: 'claimed' },
  { day: 4, reward: 100, label: '₦100', status: 'claimed' },
  { day: 5, reward: 100, label: '₦100', status: 'active' },
  { day: 6, reward: 100, label: '₦100', status: 'locked' },
  { day: 7, reward: 100, label: '₦100 🎁', status: 'locked' }
];

const INITIAL_DEMO_REFERRALS: Referral[] = [];

export default function App() {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    return localStorage.getItem('taskpulse_theme') !== 'light';
  });

  // Synchronize Dark / Light Theme on Document Root
  useEffect(() => {
    localStorage.setItem('taskpulse_theme', isDarkMode ? 'dark' : 'light');
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.setAttribute('data-theme', 'light');
    }
  }, [isDarkMode]);

  // Mandatory Minimum Drop Rule
  const [isActivated, setIsActivated] = useState<boolean>(() => {
    const saved = localStorage.getItem('taskpulse_activated');
    return saved === 'true';
  });

  // Balance Privacy (Eye toggle)
  const [isBalanceHidden, setIsBalanceHidden] = useState<boolean>(false);

  // Authentic User Profile (Clean initial state - null when unauthenticated)
  const [user, setUser] = useState<UserProfile | null>(() => {
    const saved = localStorage.getItem('taskpulse_user_v7');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.email && !parsed.email.includes('taskpulse.website')) {
          return parsed;
        }
      } catch (e) {}
    }
    return null;
  });

  // 4 Bottom Navigation Tabs: Home, Tasks, History, Profile
  const [activeTab, setActiveTab] = useState<'home' | 'tasks' | 'history' | 'profile'>('home');

  // History Tab Filter & Receipt States
  const [historyCategory, setHistoryCategory] = useState<'all' | 'finance' | 'tasks' | 'referrals' | 'rewards'>('all');
  const [historySearchQuery, setHistorySearchQuery] = useState<string>('');
  const [selectedReceipt, setSelectedReceipt] = useState<Transaction | null>(null);

  // Clean Zero Initial Balances (No Mock Data)
  const [withdrawableBalance, setWithdrawableBalance] = useState<number>(() => {
    const saved = localStorage.getItem('taskpulse_withdrawable');
    return saved ? parseInt(saved, 10) : 0;
  });
  const [pendingBalance, setPendingBalance] = useState<number>(() => {
    const saved = localStorage.getItem('taskpulse_pending');
    return saved ? parseInt(saved, 10) : 0;
  });

  // Cumulative Lifetime Withdrawals (Used for Tier Limit Cap)
  const [totalWithdrawnLifetime, setTotalWithdrawnLifetime] = useState<number>(() => {
    const saved = localStorage.getItem('taskpulse_lifetime_withdrawn');
    return saved ? parseInt(saved, 10) : 0;
  });

  // KYC Verification Modal States
  const [isKycModalOpen, setIsKycModalOpen] = useState(false);
  const [kycDocType, setKycDocType] = useState<'bvn' | 'nin' | 'voters_card' | 'drivers_license'>('bvn');
  const [kycNumber, setKycNumber] = useState('');
  const [kycDob, setKycDob] = useState('');
  const [isKycSubmitting, setIsKycSubmitting] = useState(false);
  const [kycError, setKycError] = useState<string | null>(null);

  // Terms of Service & Privacy Policy Modal States
  const [isTermsModalOpen, setIsTermsModalOpen] = useState(false);
  const [termsTab, setTermsTab] = useState<'terms' | 'privacy'>('terms');

  // Current User Tier
  const currentTier = TIERS_CONFIG.find(t => t.id === user?.tierId) || TIERS_CONFIG[0];
  const remainingTierAllowance = Math.max(0, currentTier.withdrawalCap - totalWithdrawnLifetime);
  const tierProgressPercent = Math.min(100, Math.round((totalWithdrawnLifetime / currentTier.withdrawalCap) * 100));

  // ========================================================
  // RULE 1: 2 DAYS (48 HOURS) SECURITY COOLING WINDOW
  // ========================================================
  const [cooldownSeconds, setCooldownSeconds] = useState<number>(() => {
    const saved = localStorage.getItem('taskpulse_cooldown_seconds');
    return saved !== null ? parseInt(saved, 10) : 157335; // 1d 19h 42m 15s
  });

  const [is48hLockOverridden, setIs48hLockOverridden] = useState<boolean>(() => {
    return localStorage.getItem('taskpulse_48h_override') === 'true';
  });

  const [isSecurityLockModalOpen, setIsSecurityLockModalOpen] = useState<boolean>(false);

  // ========================================================
  // RULE 2: 3 REFERRALS & 3X DEPOSIT VOLUME REQUIREMENT
  // ========================================================
  const [referrals, setReferrals] = useState<Referral[]>(() => {
    const saved = localStorage.getItem('taskpulse_referrals_list_v3');
    if (saved) return JSON.parse(saved);
    return INITIAL_DEMO_REFERRALS;
  });

  const [hasReceivedDoubleCredit, setHasReceivedDoubleCredit] = useState<boolean>(() => {
    return localStorage.getItem('taskpulse_double_credited_v3') === 'true';
  });

  const [isReferralLockModalOpen, setIsReferralLockModalOpen] = useState<boolean>(false);
  const [isTierModalOpen, setIsTierModalOpen] = useState<boolean>(false);

  // Computed Referral Metrics
  const activeReferralsCount = referrals.filter(r => r.depositedAmount >= 3000).length;
  const totalReferralsDeposit = referrals.reduce((acc, r) => acc + r.depositedAmount, 0);
  const targetReferralVolume = 9000; // 3 x ₦3,000 initial deposit (Bronze)

  // Track if user made an upgrade after referring people that made them surpass their limit
  const [hasUpgradedAfterLimit, setHasUpgradedAfterLimit] = useState<boolean>(() => {
    return localStorage.getItem('taskpulse_upgraded_after_limit') === 'true' || (user?.tierId !== 'tier-1');
  });

  const hasTripledInitialDeposit = (activeReferralsCount >= 3 && totalReferralsDeposit >= targetReferralVolume) || hasReceivedDoubleCredit;

  // USER DIRECTIVE: Minimum withdrawal ONLY applies to those whose referrals tripled their initial deposit,
  // OR those who made an upgrade after referring people that made them surpass their withdrawal limit.
  const isEligibleForWithdrawal = hasTripledInitialDeposit || hasUpgradedAfterLimit;
  const isReferralGoalMet = isEligibleForWithdrawal;

  // Live 48h Countdown Ticker
  useEffect(() => {
    if (is48hLockOverridden || cooldownSeconds <= 0) return;
    const interval = setInterval(() => {
      setCooldownSeconds(prev => {
        const next = Math.max(0, prev - 1);
        localStorage.setItem('taskpulse_cooldown_seconds', next.toString());
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [is48hLockOverridden, cooldownSeconds]);

  const formatCountdown = (totalSecs: number) => {
    const d = Math.floor(totalSecs / 86400);
    const h = Math.floor((totalSecs % 86400) / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = totalSecs % 60;
    return {
      d: String(d).padStart(2, '0'),
      h: String(h).padStart(2, '0'),
      m: String(m).padStart(2, '0'),
      s: String(s).padStart(2, '0'),
      fullString: `${d}d ${h}h ${m}m ${s}s`
    };
  };

  const countdownParts = formatCountdown(cooldownSeconds);
  const isWithdrawalLockedByTime = !is48hLockOverridden && cooldownSeconds > 0;
  const seasoningProgressPercent = Math.min(100, Math.round(((172800 - cooldownSeconds) / 172800) * 100));

  // Ledger Transactions (Clean Initial State - Zero Mock Data)
  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    const saved = localStorage.getItem('taskpulse_ledger_txs_v4');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return [];
  });

  useEffect(() => {
    localStorage.setItem('taskpulse_ledger_txs_v4', JSON.stringify(transactions));
  }, [transactions]);
  const [isLedgerModalOpen, setIsLedgerModalOpen] = useState(false);

  // Task & Workspace (Dynamically loaded from database public.tasks)
  const [tasksList, setTasksList] = useState<Task[]>(DEFAULT_TASKS);
  const [selectedTaskForModal, setSelectedTaskForModal] = useState<Task | null>(null);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [workspaceTimer, setWorkspaceTimer] = useState<number>(1800);
  const [taskProofInput, setTaskProofInput] = useState('');
  const [uploadedScreenshot, setUploadedScreenshot] = useState<string | null>(null);
  const [isUploadingProof, setIsUploadingProof] = useState<boolean>(false);
  const proofFileInputRef = React.useRef<HTMLInputElement | null>(null);

  // Live Offline / Online Connectivity Sentinel
  const [isOnline, setIsOnline] = useState<boolean>(() => typeof navigator !== 'undefined' ? navigator.onLine : true);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      showToast('Connection Restored', 'Back online. Real-time sync active.');
    };
    const handleOffline = () => {
      setIsOnline(false);
      showToast('Offline Mode Active', 'Network connection lost. Live operations paused.');
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Paystack Deposit Modal for 3k Drop
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const [depositChannel, setDepositChannel] = useState<'transfer' | 'card' | 'ussd'>('transfer');
  const [isProcessingDeposit, setIsProcessingDeposit] = useState(false);

  // Saved Banks (Clean Initial State - User links their real NUBAN)
  const [savedBanks, setSavedBanks] = useState<SavedBank[]>(() => {
    const saved = localStorage.getItem('taskpulse_saved_banks');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return [];
  });

  useEffect(() => {
    localStorage.setItem('taskpulse_saved_banks', JSON.stringify(savedBanks));
  }, [savedBanks]);

  const [selectedBankId, setSelectedBankId] = useState('');

  // Paystack Withdrawal Modal Workflow
  const [isCashoutModalOpen, setIsCashoutModalOpen] = useState(false);
  const [cashoutAmount, setCashoutAmount] = useState('3000'); // Minimum ₦3,000
  const [cashoutStep, setCashoutStep] = useState<'amount' | 'confirm' | 'success'>('amount');
  const [isCashoutProcessing, setIsCashoutProcessing] = useState(false);
  const [transferRef, setTransferRef] = useState('');
  const [cashoutIdempotencyKey, setCashoutIdempotencyKey] = useState('');

  // Add Bank Modal with Live Paystack Resolution
  const [isAddBankModalOpen, setIsAddBankModalOpen] = useState(false);
  const [addBankCode, setAddBankCode] = useState('999992');
  const [addAccountNum, setAddAccountNum] = useState('');
  const [resolvedAccountName, setResolvedAccountName] = useState('');
  const [isResolvingAccount, setIsResolvingAccount] = useState(false);

  // Daily Streak Modal
  const [isStreakModalOpen, setIsStreakModalOpen] = useState(false);

  // Profile Edit fields
  const [editFirstName, setEditFirstName] = useState(user?.firstName || '');
  const [editLastName, setEditLastName] = useState(user?.lastName || '');
  const [editEmail, setEditEmail] = useState(user?.email || '');
  const [editPhone, setEditPhone] = useState(user?.phone || '');

  // Supabase Authentication & Duplicate Check States
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup' | 'verify_email'>('signin');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authUsername, setAuthUsername] = useState('');
  const [authFullName, setAuthFullName] = useState('');
  const [authPhone, setAuthPhone] = useState('');
  const [authReferralCode, setAuthReferralCode] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authDuplicateError, setAuthDuplicateError] = useState<string | null>(null);
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [isCheckingDuplicate, setIsCheckingDuplicate] = useState(false);
  const [authAcceptTerms, setAuthAcceptTerms] = useState(false);
  const [resendCooldown, setResendCooldown] = useState<number>(0);
  const [isResendingEmail, setIsResendingEmail] = useState<boolean>(false);

  // Countdown timer for email resend cooldown
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const interval = setInterval(() => {
      setResendCooldown(prev => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [resendCooldown]);

  // Resend email confirmation link
  const handleResendVerification = async () => {
    if (!authEmail || resendCooldown > 0 || isResendingEmail) return;
    setIsResendingEmail(true);
    setAuthError(null);
    try {
      const res = await resendVerificationEmail(authEmail);
      setIsResendingEmail(false);
      if (res.success) {
        setResendCooldown(60);
        showToast('Verification Sent ✉️', `Look for an email from "Supabase Auth" sent to ${authEmail.trim()}`);
      } else {
        setAuthError(res.error || 'Could not resend email link.');
      }
    } catch (err: any) {
      setIsResendingEmail(false);
      setAuthError(err.message || 'Failed to send confirmation email.');
    }
  };

  // Centralized live data synchronization with Supabase
  const refreshUserData = async () => {
    if (!supabase) return;
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) return;
      const isEmailConfirmed = Boolean(authUser.email_confirmed_at || authUser.confirmed_at);

      const profile = await getCurrentUserProfile();
      if (profile) {
        const nameParts = (profile.full_name || '').trim().split(' ');
        setUser({
          id: profile.id,
          username: profile.username || 'USER',
          firstName: nameParts[0] || 'User',
          lastName: nameParts.slice(1).join(' ') || '',
          email: profile.email,
          phone: profile.phone || '',
          accountStatus: profile.kyc_status === 'verified' ? 'Identity Verified' : profile.kyc_status === 'pending' ? 'KYC In Review' : 'Basic Tier',
          kycLevel: profile.kyc_status === 'verified' ? 'Level 2 KYC' : 'Level 1 KYC',
          kycStatus: profile.kyc_status,
          emailConfirmed: isEmailConfirmed,
          tierId: profile.tier_id || 'tier-1',
          level: 1,
          streakDays: profile.streak_days || 1,
          streakClaimedToday: profile.streak_last_claimed_date === (new Date().toISOString().slice(0, 10)),
          dailyQuestProgress: 1,
          referralCode: profile.referral_code || `TP-${profile.username}`,
          wagerActive: false,
          activationDate: profile.activation_timestamp ? new Date(profile.activation_timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Pending'
        });
        setEditFirstName(nameParts[0] || '');
        setEditLastName(nameParts.slice(1).join(' ') || '');
        setEditEmail(profile.email || '');
        setEditPhone(profile.phone || '');
        setIsActivated(Boolean(profile.is_activated));
        setWithdrawableBalance(Number(profile.withdrawable_balance || 0));
        setPendingBalance(Number(profile.pending_balance || 0));
        setTotalWithdrawnLifetime(Number(profile.total_withdrawn_lifetime || 0));
        setHasReceivedDoubleCredit(Boolean(profile.has_received_double_credit));
        setHasUpgradedAfterLimit(Boolean(profile.has_upgraded_after_limit));

        if (profile.activation_timestamp) {
          const actMs = new Date(profile.activation_timestamp).getTime();
          const elapsed = Math.floor((Date.now() - actMs) / 1000);
          const rem = Math.max(0, 172800 - elapsed);
          setCooldownSeconds(rem);
        }
      }

      // Fetch transaction history
      const { data: txList } = await fetchTransactionsHistory(authUser.id, 'all', 50);
      if (txList && txList.length > 0) {
        const mappedTxs: Transaction[] = txList.map(t => {
          let uiType: Transaction['type'] = 'Payout';
          if (t.type === 'deposit') uiType = 'Deposit';
          else if (t.type === 'cashout') uiType = 'Cashout';
          else if (t.type === 'deposit_match') uiType = 'DepositMatch';
          else if (t.type === 'streak_reward') uiType = 'Streak';
          else if (t.type === 'tier_upgrade') uiType = 'TierUpgrade';
          else if (t.type === 'task_payout') uiType = 'Payout';

          let uiStatus: Transaction['status'] = 'Settled';
          if (t.status === 'disbursed') uiStatus = 'Disbursed';
          else if (t.status === 'pending') uiStatus = 'Pending';
          else if (t.status === 'declined' || t.status === 'failed' || t.status === 'reversed') uiStatus = 'Failed';

          const d = new Date(t.created_at);
          const formattedDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

          return {
            id: t.id,
            type: uiType,
            title: t.title || 'Transaction',
            sub: t.description || '',
            amount: Number(t.amount),
            status: uiStatus,
            date: formattedDate,
            reference: t.reference || ''
          };
        });
        setTransactions(mappedTxs);
      }

      // Fetch referrals
      const { data: refList } = await fetchReferralsHistory(authUser.id, 50);
      if (refList) {
        const mappedRefs: Referral[] = refList.map(r => ({
          id: r.id,
          username: r.referee_username || 'user',
          name: r.referee_name || 'Referral',
          depositedAmount: Number(r.deposited_amount || 0),
          status: r.is_qualified ? 'Qualified' : 'Pending Deposit',
          joinedTime: r.joined_time || new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        }));
        setReferrals(mappedRefs);
      }

      // Fetch bank accounts
      const { data: bankList } = await fetchBankAccounts(authUser.id);
      if (bankList) {
        const mappedBanks: SavedBank[] = bankList.map(b => ({
          id: b.id,
          bankCode: b.bank_code,
          bankName: b.bank_name,
          accountName: b.account_name,
          accountNumber: b.account_number,
          type: 'Savings'
        }));
        setSavedBanks(mappedBanks);
        if (mappedBanks.length > 0 && (!selectedBankId || !mappedBanks.some(b => b.id === selectedBankId))) {
          setSelectedBankId(mappedBanks[0].id);
        }
      }

      // Fetch dynamic active tasks catalog
      const dbTasks = await fetchActiveTasks();
      if (dbTasks && dbTasks.length > 0) {
        setTasksList(dbTasks);
      }
    } catch (err) {
      console.warn('Error syncing profile from Supabase:', err);
    }
  };

  // Sync Supabase Auth Session
  useEffect(() => {
    // Initial task fetch from database
    fetchActiveTasks().then(tasks => {
      if (tasks && tasks.length > 0) {
        setTasksList(tasks);
      }
    });

    if (!isSupabaseConfigured || !supabase) return;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        refreshUserData();
      } else {
        setIsAuthModalOpen(true);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        refreshUserData();
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        setWithdrawableBalance(0);
        setPendingBalance(0);
        setTotalWithdrawnLifetime(0);
        setIsActivated(false);
        setTransactions([]);
        setReferrals([]);
        setSavedBanks([]);
        setSelectedBankId('');
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Check URL hash errors & query parameters for Paystack callback & Referral invite
  useEffect(() => {
    // 0. Intercept Supabase Auth URL Hash Errors (#error=access_denied&error_code=otp_expired...)
    if (typeof window !== 'undefined' && window.location.hash) {
      try {
        const hashStr = window.location.hash.replace(/^#/, '');
        const hashParams = new URLSearchParams(hashStr);
        const errCode = hashParams.get('error_code');
        const errDescription = hashParams.get('error_description');
        const err = hashParams.get('error');

          if (errCode || err || errDescription) {
          // Immediately wipe the ugly error hash from browser history & URL bar
          window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
          const friendlyMessage = errDescription
            ? decodeURIComponent(errDescription.replace(/\+/g, ' '))
            : errCode === 'otp_expired'
            ? 'Your verification link has expired. You can request a fresh activation link below.'
            : 'Authentication verification link has expired. Please sign in or request a new link.';

          showToast('Verification Notice', friendlyMessage);
          if (errCode === 'otp_expired') {
            setAuthMode('verify_email');
          }
          setIsAuthModalOpen(true);
        }
      } catch (e) {
        console.warn('Error reading URL hash:', e);
      }
    }

    const urlParams = new URLSearchParams(window.location.search);

    // 1. Referral Link capture (?ref=CODE or ?referral=CODE)
    const refParam = urlParams.get('ref') || urlParams.get('referral');
    if (refParam) {
      const cleanRef = refParam.trim().toUpperCase();
      localStorage.setItem('taskpulse_ref_code', cleanRef);
      setAuthReferralCode(cleanRef);
      if (!user) {
        setAuthMode('signup');
        setIsAuthModalOpen(true);
        showToast('Referral Code Applied', `Invited by ${cleanRef}. Sign up to join!`);
      }
    }

    // 2. Paystack Deposit verification (?verify_deposit=...)
    const verifyRef = urlParams.get('verify_deposit') || urlParams.get('reference') || urlParams.get('trxref');
    if (verifyRef) {
      window.history.replaceState({}, document.title, window.location.pathname);
      setIsProcessingDeposit(true);
      showToast('Verifying Paystack Payment', 'Communicating with banking gateway...');
      verifyDeposit(verifyRef)
        .then(res => {
          setIsProcessingDeposit(false);
          setIsDepositModalOpen(false);
          setIsActivated(true);
          const depositAmt = res.data?.amount || 3000;
          setWithdrawableBalance(prev => prev + depositAmt);
          triggerConfetti();
          showToast('Payment Verified!', `₦${depositAmt.toLocaleString()} deposited. Account activated!`);
          refreshUserData();
        })
        .catch(err => {
          setIsProcessingDeposit(false);
          showToast('Payment Verification Failed', err.message || 'Transaction could not be confirmed.');
        });
    }
  }, []);

  // Toast
  const [toast, setToast] = useState<{ title: string; subtitle: string; show: boolean }>({
    title: '',
    subtitle: '',
    show: false
  });

  const showToast = (title: string, subtitle: string) => {
    setToast({ title, subtitle, show: true });
    setTimeout(() => {
      setToast(prev => ({ ...prev, show: false }));
    }, 4000);
  };

  useEffect(() => {
    localStorage.setItem('taskpulse_theme', isDarkMode ? 'dark' : 'light');
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  useEffect(() => {
    localStorage.setItem('taskpulse_activated', isActivated ? 'true' : 'false');
  }, [isActivated]);

  useEffect(() => {
    if (user) {
      localStorage.setItem('taskpulse_user_v7', JSON.stringify(user));
    }
  }, [user]);

  useEffect(() => {
    localStorage.setItem('taskpulse_withdrawable', withdrawableBalance.toString());
  }, [withdrawableBalance]);

  useEffect(() => {
    localStorage.setItem('taskpulse_lifetime_withdrawn', totalWithdrawnLifetime.toString());
  }, [totalWithdrawnLifetime]);

  useEffect(() => {
    localStorage.setItem('taskpulse_referrals_list_v3', JSON.stringify(referrals));
  }, [referrals]);

  useEffect(() => {
    localStorage.setItem('taskpulse_double_credited_v3', hasReceivedDoubleCredit ? 'true' : 'false');
  }, [hasReceivedDoubleCredit]);

  // Live Paystack NUBAN Resolution via Backend
  useEffect(() => {
    if (addAccountNum.length === 10 && addBankCode) {
      setIsResolvingAccount(true);
      setResolvedAccountName('');
      resolveBankAccount(addAccountNum, addBankCode)
        .then(res => {
          setIsResolvingAccount(false);
          setResolvedAccountName(res.data?.account_name || '');
        })
        .catch(() => {
          setIsResolvingAccount(false);
          setResolvedAccountName('');
        });
    } else {
      setResolvedAccountName('');
    }
  }, [addAccountNum, addBankCode]);

  // ========================================================
  // ANTI-DOUBLE ENTRY & IDEMPOTENCY DEFENSES
  // ========================================================
  const [processedIdempotencyKeys] = useState<Set<string>>(() => new Set());

  const addTransactionSafe = (newTx: Transaction) => {
    setTransactions(prev => {
      if (prev.some(t => t.reference === newTx.reference || t.id === newTx.id)) {
        return prev;
      }
      return [newTx, ...prev];
    });
  };

  // Real Paystack Deposit Launcher
  const handleInitiatePaystackDeposit = async (customAmount?: number) => {
    if (isProcessingDeposit) return;
    setIsProcessingDeposit(true);
    try {
      const res = await initializeDeposit(customAmount || 3000);
      if (res.data?.authorization_url) {
        window.location.href = res.data.authorization_url;
      } else {
        setIsProcessingDeposit(false);
        showToast('Gateway Error', 'Unable to initiate Paystack checkout.');
      }
    } catch (err: any) {
      setIsProcessingDeposit(false);
      showToast('Deposit Initialization Failed', err.message || 'Please check network connection.');
    }
  };

  // Upgrade User Tier (Strict Financial Verification & Stake Enforcement via RPC)
  const handleSelectUpgradeTier = async (targetTier: Tier) => {
    if (!user) return;
    if (targetTier.id === user.tierId) {
      showToast('Current Tier', `You are already on ${targetTier.name}.`);
      return;
    }

    try {
      await upgradeTierRpc(targetTier.id);
      setIsTierModalOpen(false);
      triggerConfetti();
      showToast(`🎉 Upgraded to ${targetTier.name}!`, `₦${targetTier.stakeAmount.toLocaleString()} staked from wallet. Cap expanded to ₦${targetTier.withdrawalCap.toLocaleString()}!`);
      await refreshUserData();
    } catch (err: any) {
      if (err.message?.includes('Insufficient wallet balance') || err.message?.includes('insufficient_balance')) {
        showToast('Stake Deposit Required', `₦${targetTier.stakeAmount.toLocaleString()} stake required. Please top up your wallet.`);
        setIsTierModalOpen(false);
        setIsDepositModalOpen(true);
      } else {
        showToast('Upgrade Blocked', err.message || 'Could not upgrade tier.');
      }
    }
  };

  // WITHDRAW CLICK HANDLER (Enforces 48h Lock, Referral / Upgrade Rule, Minimum ₦3,000, & Tier Limits)
  const handleWithdrawClick = () => {
    if (!isActivated) {
      setIsDepositModalOpen(true);
      return;
    }

    if (isWithdrawalLockedByTime) {
      setIsSecurityLockModalOpen(true);
      return;
    }

    if (!isEligibleForWithdrawal) {
      setIsReferralLockModalOpen(true);
      showToast('Referral Condition Required', 'Minimum withdrawal (₦3,000) only applies once your referrals triple your initial deposit, or after upgrading tier.');
      return;
    }

    if (remainingTierAllowance <= 0) {
      setIsTierModalOpen(true);
      showToast('Tier Withdrawal Cap Reached', `You have reached the ₦${currentTier.withdrawalCap.toLocaleString()} limit for ${currentTier.name}. Upgrade tier now to withdraw immediately!`);
      return;
    }

    if (withdrawableBalance < 3000) {
      showToast('Minimum Balance Required', 'Minimum withdrawal amount is ₦3,000.');
      return;
    }

    if (savedBanks.length === 0) {
      setIsAddBankModalOpen(true);
      showToast('Link Bank Account', 'Please add a verified NUBAN bank account before withdrawing.');
      return;
    }

    setCashoutStep('amount');
    setIsCashoutModalOpen(true);
  };

  // Claim Daily Streak via RPC
  const handleClaimDailyStreak = async () => {
    if (!user) return;
    if (user.streakClaimedToday) {
      showToast('Already Claimed', 'Today’s login reward has already been settled.');
      return;
    }

    try {
      const res = await claimDailyRewardRpc();
      const rewardAmt = res.reward_amount || 100;
      setWithdrawableBalance(prev => prev + rewardAmt);
      setUser(prev => prev ? { ...prev, streakClaimedToday: true, streakDays: res.streak_days } : null);
      triggerConfetti();
      showToast('🔥 +₦100 Claimed!', `Day ${res.streak_days} login reward credited to your wallet!`);
      setIsStreakModalOpen(false);
      await refreshUserData();
    } catch (err: any) {
      showToast('Daily Reward', err.message || 'Could not claim daily reward.');
    }
  };

  // Start Task
  const handleStartTask = (task: Task) => {
    if (!isActivated) {
      setSelectedTaskForModal(null);
      setIsDepositModalOpen(true);
      return;
    }
    setActiveTask(task);
    setWorkspaceTimer(1800);
    setTaskProofInput('');
    setUploadedScreenshot(null);
    setSelectedTaskForModal(null);
    setActiveTab('tasks');
    showToast('Task Reserved', `${task.title} allocated to your active workspace.`);
  };

  // Real Supabase Storage Task Proof File Upload
  const handleScreenshotFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!user?.id) {
      showToast('Authentication Required', 'Please sign in to upload task proof images.');
      setIsAuthModalOpen(true);
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      showToast('File Too Large', 'Screenshot must be under 5MB.');
      return;
    }

    setIsUploadingProof(true);
    try {
      const storagePath = await uploadTaskProofImage(file, user.id);
      setUploadedScreenshot(storagePath);
      showToast('Screenshot Attached ✓', 'Verification screenshot attached successfully.');
    } catch (err: any) {
      showToast('Upload Failed', err.message || 'Could not upload screenshot.');
    } finally {
      setIsUploadingProof(false);
      if (e.target) e.target.value = '';
    }
  };

  // Submit Task Proof (Database Persistence)
  const handleSubmitTaskProof = async () => {
    if (!activeTask) return;
    if (!taskProofInput && !uploadedScreenshot) {
      showToast('Proof Required', 'Please enter your handle/link or upload a screenshot.');
      return;
    }

    try {
      await submitTaskProofRpc({
        taskId: activeTask.id,
        taskTitle: activeTask.title,
        company: activeTask.company,
        rewardAmount: activeTask.reward,
        category: activeTask.category,
        proofScreenshotUrl: uploadedScreenshot || taskProofInput,
      });

      setActiveTask(null);
      setTaskProofInput('');
      setUploadedScreenshot(null);
      triggerConfetti();
      showToast('Proof Submitted', `₦${activeTask.reward} submitted for SLA verification. Reward pays to wallet upon approval.`);
      await refreshUserData();
    } catch (err: any) {
      showToast('Task Submission', err.message || 'Failed to submit task proof.');
    }
  };

  // Paystack Cashout Initiation (Moves to confirmation step)
  const handleInitiateCashout = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Math.floor(Number(cashoutAmount));

    if (isNaN(amt) || amt < 3000) {
      showToast('Minimum Withdrawal is ₦3,000', 'The minimum withdrawal threshold is ₦3,000 whole Naira.');
      return;
    }
    if (amt > withdrawableBalance) {
      showToast('Insufficient Balance', `Available balance is ₦${withdrawableBalance.toLocaleString()}`);
      return;
    }
    if (amt > remainingTierAllowance) {
      showToast('Tier Limit Exceeded', `Your remaining allowance for ${currentTier.name} is ₦${remainingTierAllowance.toLocaleString()}. Upgrade tier to withdraw more!`);
      setIsTierModalOpen(true);
      return;
    }
    if (amt > currentTier.dailyMaxCashout) {
      showToast('Single Transfer Limit Exceeded', `Max single cashout for ${currentTier.name} is ₦${currentTier.dailyMaxCashout.toLocaleString()}.`);
      return;
    }

    setCashoutIdempotencyKey(`co_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`);
    setCashoutStep('confirm');
  };

  // Paystack Transfer Confirmation (Calls secure backend disbursement)
  const handleConfirmCashout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCashoutProcessing) return;

    const amt = Math.floor(Number(cashoutAmount));
    if (!selectedBank) {
      showToast('Bank Account Required', 'Please select a verified bank account.');
      setIsAddBankModalOpen(true);
      return;
    }

    setIsCashoutProcessing(true);
    try {
      const res = await requestDisbursement({
        amount: amt,
        bankAccountId: selectedBank.id,
        idempotencyKey: cashoutIdempotencyKey || undefined,
      });

      setIsCashoutProcessing(false);
      setTransferRef(res.data?.reference || `TRF_${Date.now()}`);
      setCashoutStep('success');
      triggerConfetti();
      await refreshUserData();
    } catch (err: any) {
      setIsCashoutProcessing(false);
      showToast('Cashout Failed', err.message || 'Transfer could not be processed.');
    }
  };

  // Add Bank (Via Secure Backend)
  const handleAddBank = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{10}$/.test(addAccountNum.trim())) {
      showToast('Invalid NUBAN', 'Please enter a valid 10-digit NUBAN account.');
      return;
    }

    const bankMeta = PAYSTACK_BANKS.find(b => b.code === addBankCode) || PAYSTACK_BANKS[0];
    setIsResolvingAccount(true);
    try {
      const res = await linkBankAccount({
        accountNumber: addAccountNum.trim(),
        bankCode: addBankCode,
        bankName: bankMeta.name,
      });

      const newBankObj: SavedBank = {
        id: res.data?.id || `bank_${Date.now()}`,
        bankCode: addBankCode,
        bankName: bankMeta.name,
        accountName: res.data?.account_name || resolvedAccountName || 'Bank Account',
        accountNumber: addAccountNum.trim(),
        type: 'Savings',
      };
      setSavedBanks(prev => [newBankObj, ...prev.filter(b => b.accountNumber !== newBankObj.accountNumber)]);
      setSelectedBankId(newBankObj.id);

      setIsResolvingAccount(false);
      setIsAddBankModalOpen(false);
      setAddAccountNum('');
      setResolvedAccountName('');
      triggerConfetti();
      showToast('Paystack Recipient Linked', `${bankMeta.name} verified & linked for instant payouts.`);
      await refreshUserData();
    } catch (err: any) {
      setIsResolvingAccount(false);
      showToast('Bank Verification Error', err.message || 'Could not verify and link account.');
    }
  };

  // Check Duplicate Field on blur
  const handleCheckDuplicateField = async (field: 'email' | 'username' | 'phone') => {
    if (authMode !== 'signup') return;
    if (field === 'email' && !authEmail) return;
    if (field === 'username' && !authUsername) return;
    if (field === 'phone' && !authPhone) return;

    setIsCheckingDuplicate(true);
    const result = await checkDuplicateUser(
      field === 'email' ? authEmail : '',
      field === 'username' ? authUsername : '',
      field === 'phone' ? authPhone : ''
    );
    setIsCheckingDuplicate(false);

    if (result.exists) {
      setAuthDuplicateError(result.message || 'This detail is already registered.');
    } else if (authDuplicateError) {
      setAuthDuplicateError(null);
    }
  };

  // Sign Up Handler with Strict Duplicate Prevention
  const handleAuthSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthDuplicateError(null);

    if (!authEmail || !authPassword || !authUsername || !authFullName || !authPhone) {
      setAuthError('Please fill in all required registration fields.');
      return;
    }

    if (authPassword.length < 6) {
      setAuthError('Password must be at least 6 characters long.');
      return;
    }

    if (!authAcceptTerms) {
      setAuthError('You must read and agree to the Terms of Service & Privacy Policy to create an account.');
      return;
    }

    setIsAuthSubmitting(true);

    // 1. Strict Duplicate Check (Email, Username, Phone)
    const dupCheck = await checkDuplicateUser(authEmail, authUsername, authPhone);
    if (dupCheck.exists) {
      setIsAuthSubmitting(false);
      setAuthDuplicateError(dupCheck.message || 'The same person cannot register twice. Duplicate details detected.');
      return;
    }

    // 2. Perform Registration
    const res = await signUpUser({
      email: authEmail,
      password: authPassword,
      username: authUsername,
      fullName: authFullName,
      phone: authPhone,
      referralCode: authReferralCode
    });

    setIsAuthSubmitting(false);

    if (!res.success) {
      setAuthError(res.error || 'Failed to create account.');
      return;
    }

    // If Supabase didn't provide a session immediately, email confirmation is active and required!
    if (!res.session && supabase) {
      setAuthMode('verify_email');
      setResendCooldown(60);
      setAuthError(null);
      setAuthDuplicateError(null);
      triggerConfetti();
      showToast('Check Your Inbox ✉️', `Look for an email from "Supabase Auth" sent to ${authEmail.trim()}`);
      return;
    }

    const nameParts = authFullName.trim().split(' ');
    const fName = nameParts[0] || authUsername;
    const lName = nameParts.slice(1).join(' ') || '';

    const newProfile: UserProfile = {
      username: authUsername.trim().toUpperCase(),
      firstName: fName.toUpperCase(),
      lastName: lName.toUpperCase(),
      email: authEmail.trim(),
      phone: authPhone.trim(),
      accountStatus: 'Fully Verified',
      kycLevel: 'Level 1 KYC',
      tierId: 'tier-1',
      level: 1,
      streakDays: 1,
      streakClaimedToday: false,
      dailyQuestProgress: 0,
      referralCode: `TP-${authUsername.trim().toUpperCase()}`,
      wagerActive: false,
      activationDate: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    };

    setUser(newProfile);
    setEditFirstName(newProfile.firstName);
    setEditLastName(newProfile.lastName);
    setEditEmail(newProfile.email);
    setEditPhone(newProfile.phone);
    setIsActivated(false);
    setWithdrawableBalance(0);
    setTotalWithdrawnLifetime(0);
    setHasUpgradedAfterLimit(false);
    setHasReceivedDoubleCredit(false);

    setIsAuthModalOpen(false);
    triggerConfetti();
    showToast(`Welcome, @${authUsername.toUpperCase()}!`, 'Your TaskPulse account has been created successfully.');
  };

  // Sign In Handler
  const handleAuthSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthDuplicateError(null);

    if (!authEmail || !authPassword) {
      setAuthError('Please enter your email and password.');
      return;
    }

    setIsAuthSubmitting(true);
    const res = await signInUser(authEmail, authPassword);
    setIsAuthSubmitting(false);

    if (!res.success) {
      const errLower = (res.error || '').toLowerCase();
      if (errLower.includes('email not confirmed') || errLower.includes('not confirmed') || errLower.includes('unconfirmed')) {
        setAuthMode('verify_email');
        setResendCooldown(60);
        setAuthError(null);
        showToast('Email Not Confirmed ✉️', 'Please confirm the email from "Supabase Auth" to log in.');
        return;
      }
      setAuthError(res.error || 'Invalid credentials. Please verify your details.');
      return;
    }

    if (res.profile) {
      const p = res.profile;
      const nameParts = (p.full_name || '').trim().split(' ');
      setUser({
        username: p.username || 'USER',
        firstName: nameParts[0] || p.username,
        lastName: nameParts.slice(1).join(' ') || '',
        email: p.email,
        phone: p.phone || '',
        accountStatus: 'Fully Verified',
        kycLevel: 'Level 2 KYC',
        tierId: p.tier_id || 'tier-1',
        level: 2,
        streakDays: p.streak_days || 1,
        streakClaimedToday: false,
        dailyQuestProgress: 1,
        referralCode: p.referral_code || `TP-${p.username}`,
        wagerActive: false,
        activationDate: 'Oct 2026'
      });
      if (p.withdrawable_balance !== undefined) setWithdrawableBalance(Number(p.withdrawable_balance));
      if (p.is_activated !== undefined) setIsActivated(Boolean(p.is_activated));
      if (p.has_upgraded_after_limit !== undefined) setHasUpgradedAfterLimit(Boolean(p.has_upgraded_after_limit));
    }

    setIsAuthModalOpen(false);
    triggerConfetti();
    showToast('Signed In!', 'Welcome back to TaskPulse.');
  };

  // Sign Out Handler
  const handleAuthSignOut = async () => {
    await signOutUser();
    showToast('Signed Out', 'You have been safely logged out.');
    setAuthMode('signin');
    setIsAuthModalOpen(true);
  };

  // KYC Verification Submission
  const handleVerifyKyc = async (e: React.FormEvent) => {
    e.preventDefault();
    setKycError(null);

    const cleanNum = kycNumber.replace(/\D/g, '');
    if ((kycDocType === 'bvn' || kycDocType === 'nin') && cleanNum.length !== 11) {
      setKycError('BVN / NIN must be exactly 11 digits.');
      return;
    }

    if (!kycDob) {
      setKycError('Date of birth is required for identity verification.');
      return;
    }

    setIsKycSubmitting(true);
    try {
      await submitKycRpc(kycDocType, cleanNum);
      setIsKycSubmitting(false);
      setIsKycModalOpen(false);
      setKycNumber('');
      setKycDob('');
      setUser(prev => prev ? { ...prev, kycLevel: 'Level 2 KYC', accountStatus: 'Identity Verified' } : null);
      triggerConfetti();
      showToast('KYC Submitted!', 'Your document details have been submitted for compliance verification.');
      await refreshUserData();
    } catch (err: any) {
      setIsKycSubmitting(false);
      setKycError(err.message || 'Submission failed.');
    }
  };

  // Save Profile (Only full_name is modifiable by user)
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const fullName = `${editFirstName.trim()} ${editLastName.trim()}`.trim();
    if (!fullName) {
      showToast('Validation Error', 'Full name cannot be blank.');
      return;
    }

    try {
      await updateProfileFullName(fullName);
      triggerConfetti();
      showToast('Profile Updated', 'Your full name has been updated.');
      await refreshUserData();
    } catch (err: any) {
      showToast('Update Failed', err.message || 'Could not update profile name.');
    }
  };

  const selectedBank = savedBanks.find(b => b.id === selectedBankId) || savedBanks[0];
  const referralVolumePercent = Math.min(100, Math.round((totalReferralsDeposit / targetReferralVolume) * 100));

  return (
    <div className={`h-[100dvh] w-full overflow-hidden flex flex-col items-center justify-center p-0 md:p-3 select-none transition-colors duration-300 ${isDarkMode ? 'dark bg-[#070709] text-white' : 'bg-[#eef2f6] text-slate-900'}`}>
      
      {/* AMBIENT AURORA BACKGROUND GLOWS */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-[-10%] right-[-10%] w-[550px] h-[550px] rounded-full bg-blue-500/5 dark:bg-cyan-500/15 blur-[140px] animate-float-slow"></div>
        <div className="absolute bottom-[-10%] left-[-10%] w-[650px] h-[650px] rounded-full bg-indigo-500/5 dark:bg-sky-500/10 blur-[150px] animate-float-slow [animation-delay:2.5s]"></div>
      </div>

      {/* PHONE CANVAS CONTAINER */}
      <div className={`relative z-10 w-full max-w-md h-full md:max-h-[852px] ${isDarkMode ? 'dark bg-[#0c0d12] text-white md:border-white/[0.08]' : 'bg-[#f8fafc] text-slate-900 md:border-slate-200/90 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.08)]'} md:rounded-[46px] shadow-2xl md:border overflow-hidden flex flex-col transition-colors duration-300`}>
        
        {/* LIVE OFFLINE BANNER */}
        {!isOnline && (
          <div className="bg-rose-600 text-white text-[11px] font-bold py-1.5 px-3 flex items-center justify-center gap-1.5 shrink-0 z-50 animate-in slide-in-from-top">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Offline: No Internet Connection. Retrying...</span>
          </div>
        )}
        {/* TOP STATUS BAR & HEADER                                  */}
        {/* ======================================================== */}
        <header className="px-5 py-3.5 bg-white/95 dark:bg-[#0c0d12]/95 backdrop-blur-xl border-b border-slate-200/80 dark:border-white/[0.06] flex items-center justify-between shrink-0 z-40 transition-colors">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setIsLedgerModalOpen(true)}
              className="w-9 h-9 rounded-2xl bg-slate-100 dark:bg-zinc-900 border border-slate-200/60 dark:border-white/[0.08] hover:bg-slate-200 dark:hover:bg-zinc-800 flex items-center justify-center text-slate-700 dark:text-zinc-300 transition-colors"
              title="View Double-Entry Ledger"
            >
              <FileText className="w-4 h-4 text-sky-500" />
            </button>
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => setActiveTab('home')}>
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-sky-500 via-cyan-400 to-blue-600 flex items-center justify-center text-white font-black text-sm shadow-md shadow-sky-500/30">
                ⚡
              </div>
              <div>
                <span className="text-base font-black tracking-tight bg-gradient-to-r from-sky-600 via-cyan-500 to-blue-600 dark:from-sky-400 dark:via-cyan-300 dark:to-blue-400 bg-clip-text text-transparent">
                  TaskPulse
                </span>
                <span className="text-[9px] block font-extrabold text-sky-600 dark:text-cyan-400 tracking-wider uppercase leading-none">
                  {currentTier.name}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Dark / Light Toggle Pill */}
            <button 
              onClick={() => setIsDarkMode(!isDarkMode)}
              className="w-9 h-9 rounded-2xl bg-slate-100 dark:bg-zinc-900 border border-slate-200/60 dark:border-white/[0.08] hover:bg-slate-200 dark:hover:bg-zinc-800 flex items-center justify-center text-slate-700 dark:text-yellow-400 transition-all shadow-xs"
              title="Toggle theme"
            >
              {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4 text-slate-700" />}
            </button>

            {/* Profile Avatar or Sign In Pill */}
            {user ? (
              <button 
                onClick={() => setActiveTab('profile')}
                className="flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-2xl bg-sky-50 dark:bg-zinc-900 border border-sky-200 dark:border-white/[0.08] hover:border-sky-400 transition-all"
              >
                <div className="w-6 h-6 rounded-xl bg-gradient-to-tr from-sky-500 to-cyan-400 text-white flex items-center justify-center text-[10px] font-black shadow-xs">
                  {user.username.slice(0, 1)}
                </div>
                <span className="text-[11px] font-bold text-sky-600 dark:text-zinc-200 max-w-[70px] truncate">
                  @{user.username}
                </span>
              </button>
            ) : (
              <button
                onClick={() => {
                  setAuthMode('signin');
                  setIsAuthModalOpen(true);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-2xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white text-[11px] font-bold shadow-xs active:scale-95 transition-all"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Sign In</span>
              </button>
            )}
          </div>
        </header>

        {/* Unconfirmed Email Notice Banner */}
        {user && user.emailConfirmed === false && isSupabaseConfigured && (
          <div className="bg-amber-500/15 border-b border-amber-500/30 px-3.5 py-2 flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <Mail className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span className="text-[11px] font-medium text-amber-800 dark:text-amber-200 truncate">
                Confirm the email from <strong>"Supabase Auth"</strong> (sent to <strong>{user.email}</strong>) to guarantee instant cashouts.
              </span>
            </div>
            <button
              onClick={() => {
                setAuthEmail(user.email);
                setAuthMode('verify_email');
                setIsAuthModalOpen(true);
              }}
              className="text-[10px] font-bold text-amber-600 dark:text-amber-400 hover:underline shrink-0 cursor-pointer"
            >
              Verify Now →
            </button>
          </div>
        )}

        {/* ======================================================== */}
        {/* SECURE GATEWAY STATUS BAR                                */}
        {/* ======================================================== */}
        <div className="bg-sky-50/70 dark:bg-zinc-950/80 border-b border-sky-100 dark:border-white/[0.04] px-3.5 py-1.5 overflow-hidden shrink-0 flex items-center justify-between text-[10px]">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="font-black uppercase tracking-wider text-sky-700 dark:text-cyan-400">Payment Gateway</span>
            <span className="text-slate-400 dark:text-zinc-500">•</span>
            <span className="font-semibold text-slate-600 dark:text-zinc-300">Paystack NIP Network Active</span>
          </div>
          <div className="flex items-center gap-1 text-slate-400 dark:text-zinc-500 font-mono text-[9px]">
            <Shield className="w-3 h-3 text-emerald-500" />
            <span>256-Bit SSL</span>
          </div>
        </div>

        {/* ======================================================== */}
        {/* MAIN SCROLLABLE APP BODY                                 */}
        {/* ======================================================== */}
        <div className="flex-1 overflow-y-auto no-scrollbar flex flex-col p-4 space-y-4">

          {/* ======================================================== */}
          {/* TAB 1: HOME (Hero Balance, Streak, Payout Ticker)        */}
          {/* ======================================================== */}
          {activeTab === 'home' && (
            !isActivated ? (
              <div className="flex-1 flex flex-col justify-center items-center py-6 px-2 text-center space-y-5 animate-in fade-in duration-300">
                
                <div className="relative">
                  <div className="w-20 h-20 rounded-3xl bg-gradient-to-tr from-sky-500 via-cyan-400 to-blue-600 text-white flex items-center justify-center text-3xl shadow-xl shadow-cyan-500/20">
                    💎
                  </div>
                  <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-2xl bg-amber-500 border-2 border-white dark:border-[#0c0d12] flex items-center justify-center text-white text-xs shadow-md">
                    🔒
                  </div>
                </div>

                <div className="space-y-1">
                  <h2 className="text-xl font-black text-slate-900 dark:text-white">
                    Drop ₦3,000 to Activate
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-zinc-400 max-w-xs mx-auto leading-relaxed font-medium">
                    A minimum deposit of ₦3,000 is required to activate Bronze Pulse. 100% credited to your wallet balance.
                  </p>
                </div>

                {/* CLEAN SIMPLE 3-ROW CARD */}
                <div className="w-full bg-white dark:bg-zinc-900/80 border border-slate-100 dark:border-white/[0.08] rounded-3xl p-5 shadow-xl text-left space-y-3">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-600 dark:text-zinc-400">
                    <span>Entry Stake (Bronze Pulse):</span>
                    <span className="font-mono text-base font-black text-slate-900 dark:text-white">₦3,000</span>
                  </div>
                  <div className="flex items-center justify-between text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    <span>Credited to Your Balance:</span>
                    <span className="font-mono text-base font-black">+₦3,000.00</span>
                  </div>
                  <div className="pt-2 border-t border-slate-100 dark:border-zinc-800 flex items-center justify-between text-[11px] text-slate-500 dark:text-zinc-400 font-semibold">
                    <span>Bronze Withdrawal Cap:</span>
                    <span className="text-cyan-500 font-black uppercase">₦24,000 (8x RETURN) ✓</span>
                  </div>
                </div>

                {/* ACTION BUTTON */}
                <div className="w-full space-y-2 pt-1">
                  <button 
                    onClick={() => setIsDepositModalOpen(true)}
                    className="w-full h-12 rounded-full bg-gradient-to-r from-sky-500 via-cyan-500 to-blue-600 hover:opacity-95 text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-sky-500/25 active:scale-98 transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <CreditCard className="w-4 h-4" />
                    <span>Drop ₦3,000 via Paystack</span>
                  </button>
                </div>

                <div className="inline-flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-zinc-500 font-semibold">
                  <Shield className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Secured 256-bit encryption by Paystack</span>
                </div>

              </div>
            ) : (
              <div className="space-y-4 animate-in fade-in duration-300">
                  
                  {/* ULTRA-PREMIUM REVOLUT BLACK CARD */}
                  <div className="relative rounded-3xl bg-gradient-to-br from-zinc-900 via-black to-zinc-950 text-white p-5 border border-white/10 shadow-2xl overflow-hidden group">
                    
                    {/* HOLOGRAPHIC CARD SHINE SWEEP */}
                    <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-3xl">
                      <div className="w-1/2 h-full bg-gradient-to-r from-transparent via-white/[0.08] to-transparent animate-card-shine"></div>
                    </div>

                    {/* AMBIENT RADIAL CORNER GLOW */}
                    <div className="absolute top-0 right-0 w-36 h-36 bg-gradient-to-bl from-cyan-500/20 to-transparent rounded-full blur-2xl pointer-events-none"></div>

                    {/* CARD HEADER ROW */}
                    <div className="relative z-10 flex items-center justify-between text-xs font-semibold text-zinc-400">
                      <div className="flex items-center gap-2">
                        {/* EMV Microchip Icon */}
                        <div className="w-7 h-5 rounded bg-gradient-to-tr from-amber-400 to-yellow-200 border border-yellow-500/50 flex items-center justify-center shadow-xs">
                          <div className="w-4 h-3 border border-amber-700/60 rounded-[2px] opacity-70"></div>
                        </div>
                        <span className="text-zinc-500 font-mono text-[10px]">))))</span>
                        <span className="text-[10px] font-mono tracking-widest uppercase text-zinc-400">
                          TASKPULSE BLACK
                        </span>
                      </div>

                      <button 
                        onClick={() => setIsTierModalOpen(true)}
                        className={`px-2.5 py-0.5 rounded-full border text-[9px] font-mono font-black tracking-wider uppercase flex items-center gap-1 ${currentTier.accentBg}`}
                      >
                        <span>{currentTier.badge}</span>
                        <ChevronRight className="w-3 h-3" />
                      </button>
                    </div>

                    {/* MAIN BALANCE ROW WITH PRIVACY TOGGLE */}
                    <div className="relative z-10 my-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-medium text-zinc-400 flex items-center gap-1.5">
                          <span>Withdrawable Balance</span>
                          <button 
                            onClick={() => setIsBalanceHidden(!isBalanceHidden)}
                            className="text-zinc-400 hover:text-white transition-colors p-0.5"
                            title="Toggle Balance Visibility"
                          >
                            {isBalanceHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        </span>
                        <span className="text-[10px] font-mono text-emerald-400">
                          Min Cashout: ₦3,000
                        </span>
                      </div>

                      <div className="mt-1 flex items-baseline gap-2">
                        <h2 className="text-3xl font-black font-mono tracking-tight text-white">
                          {isBalanceHidden ? '₦ ••••••••' : `₦${withdrawableBalance.toLocaleString()}.00`}
                        </h2>
                      </div>

                      {/* ESCROW & STREAK PILLS */}
                      <div className="flex items-center gap-2 mt-2">
                        <div className="px-2.5 py-1 rounded-xl bg-white/[0.05] border border-white/[0.08] text-[10px] text-zinc-300 font-medium flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                          <span>Escrow: <strong className="font-mono text-white">₦{pendingBalance.toLocaleString()}</strong></span>
                        </div>
                        <div className="px-2.5 py-1 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-300 font-bold flex items-center gap-1">
                          <Flame className="w-3 h-3 text-amber-400 fill-current" />
                          <span>0% Paystack Fee</span>
                        </div>
                      </div>
                    </div>

                    {/* CARD QUICK ACTIONS (Deposit, Withdraw, Streak, Upgrade Tier) */}
                    <div className="relative z-10 grid grid-cols-4 gap-2 pt-3 border-t border-white/[0.08]">
                      
                      {/* Fund */}
                      <button 
                        onClick={() => setIsDepositModalOpen(true)}
                        className="py-2 px-1 bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 text-white rounded-2xl text-[11px] font-bold transition-all flex flex-col items-center justify-center gap-1 active:scale-95"
                      >
                        <Plus className="w-4 h-4 text-cyan-400" />
                        <span>Fund</span>
                      </button>

                      {/* Cashout (Under 2-day, Referral / Upgrade, and Tier rules) */}
                      <button 
                        onClick={handleWithdrawClick}
                        className={`py-2 px-1 rounded-2xl text-[11px] font-bold transition-all flex flex-col items-center justify-center gap-1 active:scale-95 shadow-md ${
                          isWithdrawalLockedByTime || remainingTierAllowance <= 0 || !isEligibleForWithdrawal
                            ? 'bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300'
                            : 'bg-gradient-to-tr from-cyan-500 to-sky-500 text-white'
                        }`}
                      >
                        {isWithdrawalLockedByTime ? (
                          <>
                            <LockKeyhole className="w-4 h-4 text-amber-400" />
                            <span>Cashout (48h)</span>
                          </>
                        ) : remainingTierAllowance <= 0 ? (
                          <>
                            <ArrowUpCircle className="w-4 h-4 text-amber-400 animate-pulse" />
                            <span>Upgrade Tier</span>
                          </>
                        ) : !isEligibleForWithdrawal ? (
                          <>
                            <Users className="w-4 h-4 text-amber-400" />
                            <span>Cashout (3 Refs)</span>
                          </>
                        ) : (
                          <>
                            <ArrowUpRight className="w-4 h-4 text-white" />
                            <span>Cashout</span>
                          </>
                        )}
                      </button>

                      {/* Streak Calendar */}
                      <button 
                        onClick={() => setIsStreakModalOpen(true)}
                        className="py-2 px-1 bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 text-white rounded-2xl text-[11px] font-bold transition-all flex flex-col items-center justify-center gap-1 active:scale-95"
                      >
                        <Flame className="w-4 h-4 text-amber-400" />
                        <span>Streak 🔥</span>
                      </button>

                      {/* Upgrade Tiers */}
                      <button 
                        onClick={() => setIsTierModalOpen(true)}
                        className="py-2 px-1 bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 text-white rounded-2xl text-[11px] font-bold transition-all flex flex-col items-center justify-center gap-1 active:scale-95"
                      >
                        <Crown className="w-4 h-4 text-yellow-400" />
                        <span>Tiers</span>
                      </button>
                    </div>

                  </div>

                  {/* ======================================================== */}
                  {/* COMPREHENSIBLE CASHOUT READINESS & TIER PROGRESS DASHBOARD*/}
                  {/* ======================================================== */}
                  <div className="bg-white dark:bg-zinc-900/80 border border-slate-100 dark:border-white/[0.08] rounded-3xl p-4 shadow-sm space-y-3.5">
                    
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-2xl bg-cyan-50 dark:bg-zinc-800 text-cyan-500 flex items-center justify-center font-bold">
                          <Layers className="w-4 h-4" />
                        </div>
                        <div>
                          <h4 className="text-xs font-black text-slate-900 dark:text-white leading-tight">
                            Cashout Readiness &amp; Tier Allowance
                          </h4>
                          <p className="text-[10px] text-slate-500 dark:text-zinc-400">
                            Current Tier: <strong className="text-cyan-500 font-bold">{currentTier.name}</strong> ({currentTier.multiplier}x Multiplier)
                          </p>
                        </div>
                      </div>

                      <button 
                        onClick={() => setIsTierModalOpen(true)}
                        className="px-2.5 py-1 rounded-xl text-[10px] font-black border border-cyan-400/40 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-50 dark:hover:bg-zinc-800 transition-all"
                      >
                        Upgrade Tier
                      </button>
                    </div>

                    {/* PROGRESS BAR 1: TIER LIFETIME WITHDRAWAL LIMIT */}
                    <div className="p-3 rounded-2xl bg-slate-50 dark:bg-zinc-800/50 border border-slate-100 dark:border-white/[0.04] space-y-1.5">
                      <div className="flex justify-between items-center text-[10px] font-bold text-slate-600 dark:text-zinc-300">
                        <span>Tier Withdrawal Limit Used:</span>
                        <span className="font-mono text-cyan-600 dark:text-cyan-400">
                          ₦{totalWithdrawnLifetime.toLocaleString()} / ₦{currentTier.withdrawalCap.toLocaleString()} Cap
                        </span>
                      </div>
                      <div className="w-full bg-slate-200 dark:bg-zinc-700 h-2 rounded-full overflow-hidden">
                        <div 
                          className="bg-gradient-to-r from-cyan-500 to-blue-600 h-full rounded-full transition-all duration-500"
                          style={{ width: `${tierProgressPercent}%` }}
                        ></div>
                      </div>
                      <div className="flex justify-between text-[9px] text-slate-400 dark:text-zinc-400 font-semibold">
                        <span>Remaining Allowance: <strong>₦{remainingTierAllowance.toLocaleString()}</strong></span>
                        <span>{tierProgressPercent}% of Cap Reached</span>
                      </div>
                    </div>

                    {/* 3 CONDITIONS CHECKLIST (SUPER COMPREHENSIBLE) */}
                    <div className="grid grid-cols-3 gap-2 text-center text-[10px] font-bold">
                      
                      {/* Condition 1: 48h Cooling */}
                      <div 
                        onClick={() => setIsSecurityLockModalOpen(true)}
                        className={`p-2 rounded-2xl border cursor-pointer transition-all ${
                          !isWithdrawalLockedByTime 
                            ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400' 
                            : 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-400'
                        }`}
                      >
                        <span className="block text-sm leading-none mb-1">{!isWithdrawalLockedByTime ? '✓' : '🔒'}</span>
                        <span className="block font-black text-[9px]">48h Seasoning</span>
                        <span className="text-[8px] font-mono opacity-80 mt-0.5 block">
                          {!isWithdrawalLockedByTime ? 'Ready' : countdownParts.fullString.slice(0, 7)}
                        </span>
                      </div>

                      {/* Condition 2: 3 Referrals (Tripled Deposit) OR Upgraded After Surpassing Limit */}
                      <div 
                        onClick={() => isEligibleForWithdrawal ? (hasUpgradedAfterLimit ? setIsTierModalOpen(true) : setIsReferralLockModalOpen(true)) : setIsReferralLockModalOpen(true)}
                        className={`p-2 rounded-2xl border cursor-pointer transition-all ${
                          isEligibleForWithdrawal 
                            ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400' 
                            : 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-800 text-indigo-700 dark:text-indigo-400'
                        }`}
                      >
                        <span className="block text-sm leading-none mb-1">{isEligibleForWithdrawal ? '✓' : '👥'}</span>
                        <span className="block font-black text-[9px]">
                          {hasUpgradedAfterLimit ? 'Tier Upgraded' : '3 Referrals'}
                        </span>
                        <span className="text-[8px] font-mono opacity-80 mt-0.5 block">
                          {hasUpgradedAfterLimit ? 'Can Cashout Now ✓' : `${activeReferralsCount}/3 (₦${totalReferralsDeposit.toLocaleString()})`}
                        </span>
                      </div>

                      {/* Condition 3: Min ₦3,000 */}
                      <div 
                        className={`p-2 rounded-2xl border ${
                          withdrawableBalance >= 3000
                            ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400'
                            : 'bg-slate-50 dark:bg-zinc-800 border-slate-200 dark:border-white/10 text-slate-400'
                        }`}
                      >
                        <span className="block text-sm leading-none mb-1">{withdrawableBalance >= 3000 ? '✓' : '💰'}</span>
                        <span className="block font-black text-[9px]">Min ₦3,000</span>
                        <span className="text-[8px] font-mono opacity-80 mt-0.5 block">
                          ₦{withdrawableBalance.toLocaleString()} avail.
                        </span>
                      </div>

                    </div>

                  </div>

                  {/* DAILY HABIT STREAK CARD */}
                  <div className="bg-white dark:bg-zinc-900/80 border border-slate-100 dark:border-white/[0.08] rounded-3xl p-4 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-2xl bg-orange-100 dark:bg-orange-950/50 flex items-center justify-center text-orange-500 font-bold">
                          🔥
                        </div>
                        <div>
                          <h3 className="text-xs font-black text-slate-900 dark:text-white leading-tight">
                            {user?.streakDays}-Day Login Streak
                          </h3>
                          <p className="text-[10px] text-slate-500 dark:text-zinc-400">
                            {user?.streakClaimedToday ? 'Today’s reward claimed · 0% Paystack fees active' : 'Claim today’s cash bonus before midnight'}
                          </p>
                        </div>
                      </div>
                      <button 
                        onClick={handleClaimDailyStreak}
                        disabled={user?.streakClaimedToday}
                        className={`px-3 py-1.5 rounded-2xl text-[11px] font-black transition-all ${
                          user?.streakClaimedToday 
                            ? 'bg-slate-100 dark:bg-zinc-800 text-slate-400 cursor-not-allowed'
                            : 'bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-md shadow-orange-500/20 active:scale-95'
                        }`}
                      >
                        {user?.streakClaimedToday ? 'Claimed ✓' : 'Claim ₦100'}
                      </button>
                    </div>

                    <div className="grid grid-cols-7 gap-1.5 pt-1">
                      {STREAK_DAYS_CONFIG.map((s, index) => {
                        const isToday = index + 1 === user?.streakDays;
                        const isPast = index + 1 < (user?.streakDays || 1) || (isToday && user?.streakClaimedToday);
                        return (
                          <div 
                            key={s.day} 
                            className={`flex flex-col items-center justify-center p-1.5 rounded-xl text-center border transition-all ${
                              isPast 
                                ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400' 
                                : isToday 
                                  ? 'bg-sky-50 dark:bg-sky-950/40 border-sky-300 dark:border-cyan-500 text-sky-700 dark:text-cyan-300 font-black scale-105'
                                  : 'bg-slate-50 dark:bg-zinc-900/50 border-slate-100 dark:border-white/[0.04] text-slate-400 dark:text-zinc-600'
                            }`}
                          >
                            <span className="text-[9px] font-bold">D{s.day}</span>
                            <span className="text-[10px] font-mono font-black mt-0.5">{isPast ? '✓' : s.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                </div>
              )
            )
          }

              {/* ======================================================== */}
              {/* TAB 2: TASKS (EXACTLY ONE TASK + "MORE COMING SOON")     */}
              {/* ======================================================== */}
              {activeTab === 'tasks' && (
                <div className="space-y-4 animate-in fade-in duration-300">
                  
                  {/* ACTIVE WORKSPACE (If task in progress) */}
                  {activeTask && (
                    <div className="bg-gradient-to-r from-zinc-900 to-sky-950 text-white rounded-3xl p-4 border border-cyan-500/30 shadow-lg space-y-3 relative overflow-hidden">
                      <div className="flex items-center justify-between">
                        <span className="px-2.5 py-0.5 rounded-full bg-cyan-500 text-white text-[9px] font-black uppercase tracking-wider">
                          ACTIVE TASK IN PROGRESS
                        </span>
                        <span className="font-mono text-sm font-black text-amber-300">
                          ⏱ {Math.floor(workspaceTimer / 60)}:{(workspaceTimer % 60).toString().padStart(2, '0')}
                        </span>
                      </div>

                      <div>
                        <h4 className="text-xs font-black text-white">{activeTask.title}</h4>
                        <p className="text-[10px] text-sky-200 mt-0.5">{activeTask.company} · ₦{activeTask.reward} reward</p>
                      </div>

                      <div className="bg-white/10 rounded-2xl p-3 space-y-2 border border-white/10">
                        <label className="text-[10px] font-bold text-sky-100 block">
                          Submit Verification Proof:
                        </label>
                        <input 
                          type="text"
                          value={taskProofInput}
                          onChange={e => setTaskProofInput(e.target.value)}
                          placeholder="Your social username or post URL"
                          className="w-full h-9 px-3 rounded-xl bg-zinc-900/80 border border-cyan-500/30 text-xs text-white placeholder:text-zinc-400 focus:outline-none"
                        />

                        {/* Real Supabase Storage Screenshot / File Upload */}
                        <input 
                          type="file"
                          ref={proofFileInputRef}
                          accept="image/*"
                          className="hidden"
                          onChange={handleScreenshotFileSelect}
                        />
                        <button 
                          type="button"
                          disabled={isUploadingProof}
                          onClick={() => proofFileInputRef.current?.click()}
                          className="w-full py-2 px-3 bg-white/15 hover:bg-white/25 rounded-xl text-[10px] font-bold text-white flex items-center justify-center gap-1.5 border border-white/10 transition-all cursor-pointer active:scale-95 disabled:opacity-60"
                        >
                          {isUploadingProof ? (
                            <>
                              <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                              <span>Uploading screenshot...</span>
                            </>
                          ) : (
                            <>
                              <Camera className="w-3.5 h-3.5 text-cyan-300" />
                              <span>{uploadedScreenshot ? 'Change Attached Screenshot ✓' : 'Upload Verification Screenshot (Photo/File)'}</span>
                            </>
                          )}
                        </button>
                        {uploadedScreenshot && (
                          <div className="flex items-center justify-between px-2.5 py-1.5 bg-black/40 rounded-xl text-[10px] text-cyan-300 font-medium border border-cyan-400/20">
                            <span className="truncate max-w-[200px]">📎 Screenshot attached ✓</span>
                            <button 
                              type="button" 
                              onClick={() => setUploadedScreenshot(null)} 
                              className="text-slate-400 hover:text-white ml-2 text-xs font-bold"
                            >
                              ✕
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <button 
                          onClick={() => { setActiveTask(null); showToast('Task Abandoned', 'Reservation returned to pool.'); }}
                          className="py-2 px-3 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-bold text-slate-300"
                        >
                          Abandon
                        </button>
                        <button 
                          onClick={handleSubmitTaskProof}
                          className="flex-1 py-2 px-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-xs font-black uppercase tracking-wider shadow-md active:scale-95 transition-all"
                        >
                          Submit Proof (₦{activeTask.reward})
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ONLY ONE ACTIVE TASK (USER DIRECTIVE) */}
                  <div className="space-y-3">
                    {tasksList.map(task => (
                      <div 
                        key={task.id}
                        className="bg-white dark:bg-zinc-900/80 border border-slate-100 dark:border-white/[0.08] rounded-3xl p-4 shadow-sm hover:border-cyan-400/50 transition-all space-y-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-10 h-10 rounded-2xl bg-sky-50 dark:bg-zinc-800 text-xl flex items-center justify-center shrink-0">
                              {task.platformIcon || '🎵'}
                            </div>
                            <div>
                              <span className="text-[10px] font-bold text-sky-600 dark:text-cyan-400 uppercase">
                                {task.company} · {task.category}
                              </span>
                              <h4 className="text-xs font-extrabold text-slate-900 dark:text-white leading-snug">
                                {task.title}
                              </h4>
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <span className="text-base font-black font-mono text-emerald-600 dark:text-emerald-400">
                              +₦{task.reward}
                            </span>
                            <span className="text-[8px] block text-slate-400 dark:text-zinc-500 uppercase font-bold">
                              Escrowed
                            </span>
                          </div>
                        </div>

                        <p className="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed">
                          {task.description}
                        </p>

                        <div className="flex items-center justify-between text-[11px] text-slate-400 dark:text-zinc-500 pt-2 border-t border-slate-50 dark:border-white/[0.04]">
                          <span>⏱ {task.time} · 🛡 {task.SLA}</span>
                          <span className="font-mono font-bold text-slate-600 dark:text-zinc-300">{task.spotsLeft}/{task.spotsTotal} spots</span>
                        </div>

                        <button 
                          onClick={() => setSelectedTaskForModal(task)}
                          className="w-full h-10 rounded-full bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white font-bold text-xs uppercase tracking-wider shadow-md shadow-sky-500/15 flex items-center justify-center gap-1.5 active:scale-95 transition-all"
                        >
                          <CheckSquare className="w-3.5 h-3.5" />
                          <span>View Task Details (₦{task.reward})</span>
                        </button>
                      </div>
                    ))}

                    {/* USER DIRECTIVE: "MORE COMING SOON" CARD */}
                    <div className="bg-white/80 dark:bg-zinc-900/60 border border-dashed border-slate-200 dark:border-white/10 rounded-3xl p-6 text-center space-y-2.5">
                      <div className="w-12 h-12 rounded-2xl bg-cyan-50 dark:bg-zinc-800/80 border border-cyan-200/80 dark:border-white/[0.08] flex items-center justify-center mx-auto text-xl shadow-xs">
                        🚀
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center justify-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-cyan-500 animate-ping"></span>
                          <h4 className="text-sm font-black text-slate-900 dark:text-white">
                            More Coming Soon
                          </h4>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-zinc-400 max-w-xs mx-auto leading-relaxed">
                          Sponsors are reviewing and funding verification escrow slots. New tasks drop daily.
                        </p>
                      </div>
                      <div className="pt-1">
                        <span className="px-3 py-1 rounded-full bg-slate-100 dark:bg-zinc-800 text-[10px] font-bold text-slate-600 dark:text-zinc-300 border border-slate-200 dark:border-white/[0.06] inline-block">
                          🔔 Auto-Drop SLA: Active
                        </span>
                      </div>
                    </div>

                  </div>

                </div>
              )}

              {/* ======================================================== */}
              {/* TAB 3: HISTORY & ACCOUNTABILITY LEDGER                   */}
              {/* ======================================================== */}
              {activeTab === 'history' && (
                <div className="space-y-4 animate-in fade-in duration-300">
                  
                  {/* SUMMARY HERO CARD */}
                  <div className="p-5 rounded-3xl bg-gradient-to-br from-zinc-900 via-black to-zinc-950 text-white border border-white/10 shadow-xl space-y-4 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/10 rounded-full blur-2xl pointer-events-none"></div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-xl bg-cyan-500/20 text-cyan-400 flex items-center justify-center font-bold text-sm">
                          <History className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="text-xs font-black uppercase tracking-wider text-zinc-300">Accountability History</h3>
                          <span className="text-[10px] text-zinc-400 font-mono">Immutable Double-Entry Ledger</span>
                        </div>
                      </div>

                      <button 
                        onClick={() => {
                          const csvContent = "data:text/csv;charset=utf-8," 
                            + ["Date,Type,Title,Amount,Status,Reference", 
                              ...transactions.map(t => `"${t.date}","${t.type}","${t.title}","${t.amount}","${t.status}","${t.reference}"`)
                            ].join("\n");
                          const encodedUri = encodeURI(csvContent);
                          const link = document.createElement("a");
                          link.setAttribute("href", encodedUri);
                          link.setAttribute("download", `TaskPulse_Audit_Statement_${Date.now()}.csv`);
                          document.body.appendChild(link);
                          link.click();
                          document.body.removeChild(link);
                          showToast('Statement Exported', 'CSV downloaded for personal accounting.');
                        }}
                        className="py-1 px-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-cyan-300 text-[10px] font-bold flex items-center gap-1 transition-all border border-white/10"
                      >
                        <Download className="w-3 h-3" />
                        <span>Export CSV</span>
                      </button>
                    </div>

                    {/* METRICS ROW */}
                    <div className="grid grid-cols-2 gap-2.5 pt-1">
                      <div className="p-3 rounded-2xl bg-white/[0.05] border border-white/[0.06]">
                        <span className="text-[10px] text-zinc-400 block font-medium">Lifetime Disbursed:</span>
                        <span className="text-base font-black font-mono text-white block mt-0.5">
                          ₦{totalWithdrawnLifetime.toLocaleString()}.00
                        </span>
                        <span className="text-[9px] text-emerald-400 font-mono mt-0.5 block">✓ Verified NIP</span>
                      </div>
                      <div className="p-3 rounded-2xl bg-white/[0.05] border border-white/[0.06]">
                        <span className="text-[10px] text-zinc-400 block font-medium">Withdrawable Balance:</span>
                        <span className="text-base font-black font-mono text-cyan-400 block mt-0.5">
                          ₦{withdrawableBalance.toLocaleString()}.00
                        </span>
                        <span className="text-[9px] text-zinc-400 font-mono mt-0.5 block">₦3k Min Floor</span>
                      </div>
                    </div>
                  </div>

                  {/* SEARCH BAR */}
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 dark:text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input 
                      type="text"
                      value={historySearchQuery}
                      onChange={e => setHistorySearchQuery(e.target.value)}
                      placeholder="Search transactions, references, banks..."
                      className="w-full h-11 pl-10 pr-4 rounded-full bg-white dark:bg-zinc-900 border border-slate-200 dark:border-white/[0.08] text-xs font-medium text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-cyan-500"
                    />
                    {historySearchQuery && (
                      <button 
                        onClick={() => setHistorySearchQuery('')}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 hover:text-slate-600"
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  {/* FILTER PILLS */}
                  <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
                    {[
                      { id: 'all', label: 'All Activity' },
                      { id: 'finance', label: 'Deposits & Cashouts' },
                      { id: 'tasks', label: 'Tasks Done' },
                      { id: 'referrals', label: 'Referrals' },
                      { id: 'rewards', label: 'Bonuses & Tiers' }
                    ].map(tab => (
                      <button 
                        key={tab.id}
                        onClick={() => setHistoryCategory(tab.id as any)}
                        className={`py-1.5 px-3 rounded-full text-xs font-bold shrink-0 transition-all ${
                          historyCategory === tab.id 
                            ? 'bg-sky-500 text-white shadow-xs' 
                            : 'bg-white dark:bg-zinc-900 border border-slate-200/80 dark:border-white/[0.08] text-slate-600 dark:text-zinc-400 hover:border-sky-400'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {/* TRANSACTIONS FEED */}
                  <div className="space-y-2.5">
                    {transactions
                      .filter(tx => {
                        // Category filter
                        if (historyCategory === 'finance') {
                          return tx.type === 'Deposit' || tx.type === 'Cashout';
                        }
                        if (historyCategory === 'tasks') {
                          return tx.type === 'Payout' || tx.type === 'Escrow';
                        }
                        if (historyCategory === 'referrals') {
                          return tx.type === 'DepositMatch';
                        }
                        if (historyCategory === 'rewards') {
                          return tx.type === 'Streak' || tx.type === 'TierUpgrade';
                        }
                        return true;
                      })
                      .filter(tx => {
                        // Search filter
                        if (!historySearchQuery) return true;
                        const q = historySearchQuery.toLowerCase();
                        return tx.title.toLowerCase().includes(q) 
                          || tx.sub.toLowerCase().includes(q) 
                          || tx.reference.toLowerCase().includes(q);
                      })
                      .map(tx => {
                        const isCashout = tx.type === 'Cashout';
                        const isDeposit = tx.type === 'Deposit';
                        const isTask = tx.type === 'Payout';
                        const isMatch = tx.type === 'DepositMatch';
                        const isStreak = tx.type === 'Streak';
                        const isTier = tx.type === 'TierUpgrade';

                        return (
                          <div 
                            key={tx.id}
                            onClick={() => setSelectedReceipt(tx)}
                            className="p-3.5 rounded-2xl bg-white dark:bg-zinc-900/80 border border-slate-100 dark:border-white/[0.08] hover:border-cyan-400/50 shadow-xs flex items-center justify-between gap-3 cursor-pointer transition-all active:scale-98"
                          >
                            <div className="flex items-center gap-3">
                              {/* Icon based on event type */}
                              <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
                                isCashout ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-500' :
                                isDeposit ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-500' :
                                isTask ? 'bg-sky-50 dark:bg-cyan-950/40 text-cyan-500' :
                                isMatch ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-500' :
                                isStreak ? 'bg-orange-50 dark:bg-orange-950/40 text-orange-500' :
                                'bg-amber-50 dark:bg-amber-950/40 text-amber-500'
                              }`}>
                                {isCashout && <ArrowUpRight className="w-5 h-5" />}
                                {isDeposit && <ArrowDownLeft className="w-5 h-5" />}
                                {isTask && <CheckSquare className="w-5 h-5" />}
                                {isMatch && <Gift className="w-5 h-5" />}
                                {isStreak && <Flame className="w-5 h-5" />}
                                {isTier && <Crown className="w-5 h-5" />}
                              </div>

                              <div>
                                <div className="flex items-center gap-1.5">
                                  <h4 className="text-xs font-black text-slate-900 dark:text-white leading-tight">
                                    {tx.title}
                                  </h4>
                                  <span className={`text-[8px] font-mono px-1.5 py-0.2 rounded font-black uppercase ${
                                    tx.status === 'Disbursed' ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400' :
                                    tx.status === 'Escrowed' ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400' :
                                    'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'
                                  }`}>
                                    {tx.status}
                                  </span>
                                </div>
                                <p className="text-[10px] text-slate-400 dark:text-zinc-500 mt-0.5 leading-snug">
                                  {tx.sub} · {tx.date}
                                </p>
                                <span className="text-[9px] font-mono text-cyan-600 dark:text-cyan-400">
                                  {tx.reference}
                                </span>
                              </div>
                            </div>

                            <div className="text-right shrink-0">
                              <span className={`text-sm font-black font-mono block ${
                                isCashout ? 'text-rose-500' : 'text-emerald-600 dark:text-emerald-400'
                              }`}>
                                {isCashout ? '-' : '+'}₦{tx.amount.toLocaleString()}
                              </span>
                              <span className="text-[9px] text-slate-400 hover:text-cyan-500 font-bold block mt-0.5">
                                Receipt →
                              </span>
                            </div>
                          </div>
                        );
                      })}

                    {/* EMPTY STATE WHEN NO TRANSACTIONS EXIST */}
                    {transactions.length === 0 && (
                      <div className="py-12 px-4 rounded-3xl bg-white dark:bg-zinc-900/60 border border-slate-100 dark:border-white/[0.06] text-center space-y-3">
                        <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-zinc-800 text-slate-400 mx-auto flex items-center justify-center">
                          <Receipt className="w-6 h-6 text-slate-400" />
                        </div>
                        <h4 className="text-sm font-black text-slate-800 dark:text-zinc-200">No Transactions Recorded</h4>
                        <p className="text-xs text-slate-400 max-w-xs mx-auto">
                          Your double-entry financial ledger will automatically track all activation deposits, task payouts, and Paystack bank cashouts here.
                        </p>
                      </div>
                    )}

                    {/* REFERRALS SPECIFIC BREAKDOWN (If Referrals Tab Selected) */}
                    {historyCategory === 'referrals' && (
                      <div className="mt-4 p-4 rounded-3xl bg-slate-50 dark:bg-zinc-900/60 border border-slate-200/80 dark:border-white/[0.08] space-y-3">
                        <div className="flex justify-between items-center text-xs font-black text-slate-900 dark:text-white">
                          <span>Referral Lineage ({activeReferralsCount}/3 Qualified)</span>
                          <span className="font-mono text-emerald-600 dark:text-emerald-400">₦{totalReferralsDeposit.toLocaleString()} Total Volume</span>
                        </div>
                        <div className="space-y-2">
                          {referrals.map(ref => (
                            <div key={ref.id} className="p-3 rounded-2xl bg-white dark:bg-zinc-800/80 border border-slate-100 dark:border-white/[0.06] flex items-center justify-between text-xs">
                              <div>
                                <span className="font-bold text-slate-900 dark:text-white block">{ref.name} (@{ref.username})</span>
                                <span className="text-[10px] text-slate-400">Joined {ref.joinedTime}</span>
                              </div>
                              <div className="text-right">
                                <span className="font-mono font-black text-emerald-600 dark:text-emerald-400 block">₦{ref.depositedAmount.toLocaleString()}</span>
                                <span className="text-[9px] font-bold text-slate-400">{ref.status}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  </div>

                </div>
              )}

              {/* ======================================================== */}
              {/* TAB 4: PROFILE (Exact LeadsAfrica Screenshot 1 Details)  */}
              {/* ======================================================== */}
              {activeTab === 'profile' && (
                <div className="space-y-4 animate-in fade-in duration-300">
                  
                  {/* MAIN PROFILE CARD */}
                  <div className="bg-white dark:bg-zinc-900/80 border border-slate-100 dark:border-white/[0.08] rounded-3xl p-6 shadow-sm space-y-5 text-center">
                    
                    {/* User Avatar with Green Verified Badge */}
                    <div className="flex flex-col items-center space-y-2">
                      <div className="relative">
                        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-sky-400 to-blue-600 text-white flex items-center justify-center text-3xl font-black shadow-lg shadow-sky-500/25">
                          <User className="w-10 h-10" />
                        </div>
                        <div className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-emerald-500 border-2 border-white dark:border-zinc-900 flex items-center justify-center text-white shadow-xs">
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                        </div>
                      </div>

                      {/* Cyan handle & KYC verification status pill */}
                      <span className="text-sm font-black text-sky-500 dark:text-cyan-400 tracking-wide">
                        @{user?.username}
                      </span>

                      <div className="flex items-center gap-2 pt-1">
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1 ${
                          user?.kycLevel?.includes('Tier 2') || user?.kycLevel?.includes('Level 2')
                            ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/40'
                            : 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800/40'
                        }`}>
                          <Fingerprint className="w-3 h-3" />
                          {user?.kycLevel || 'Tier 1 (Basic)'}
                        </span>

                        {(!user?.kycLevel?.includes('Tier 2') && !user?.kycLevel?.includes('Level 2')) && (
                          <button
                            type="button"
                            onClick={() => {
                              setKycError(null);
                              setIsKycModalOpen(true);
                            }}
                            className="text-[10px] font-bold text-sky-500 dark:text-cyan-400 hover:underline cursor-pointer"
                          >
                            Verify KYC →
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Profile Fields Form */}
                    <form onSubmit={handleSaveProfile} className="space-y-3.5 text-left">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-500 dark:text-zinc-400 ml-1">
                            First name
                          </label>
                          <input 
                            type="text"
                            value={editFirstName}
                            onChange={e => setEditFirstName(e.target.value)}
                            className="w-full h-11 px-4 rounded-full bg-slate-50/70 dark:bg-zinc-800/80 border border-slate-100 dark:border-white/[0.08] text-xs font-bold text-slate-900 dark:text-white uppercase focus:outline-none focus:border-cyan-500"
                            required
                          />
                        </div>

                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-500 dark:text-zinc-400 ml-1">
                            Last name
                          </label>
                          <input 
                            type="text"
                            value={editLastName}
                            onChange={e => setEditLastName(e.target.value)}
                            className="w-full h-11 px-4 rounded-full bg-slate-50/70 dark:bg-zinc-800/80 border border-slate-100 dark:border-white/[0.08] text-xs font-bold text-slate-900 dark:text-white uppercase focus:outline-none focus:border-cyan-500"
                            required
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-500 dark:text-zinc-400 ml-1">
                          Email address
                        </label>
                        <input 
                          type="email"
                          value={editEmail}
                          onChange={e => setEditEmail(e.target.value)}
                          className="w-full h-11 px-4 rounded-full bg-slate-50/70 dark:bg-zinc-800/80 border border-slate-100 dark:border-white/[0.08] text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500"
                          required
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-slate-500 dark:text-zinc-400 ml-1">
                          Phone number
                        </label>
                        <input 
                          type="tel"
                          value={editPhone}
                          onChange={e => setEditPhone(e.target.value)}
                          className="w-full h-11 px-4 rounded-full bg-slate-50/70 dark:bg-zinc-800/80 border border-slate-100 dark:border-white/[0.08] text-xs font-bold font-mono text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500"
                          required
                        />
                      </div>

                      {/* Electric Blue Button */}
                      <button 
                        type="submit"
                        className="w-full h-11 rounded-full bg-gradient-to-r from-sky-400 via-sky-500 to-blue-600 hover:opacity-95 text-white font-bold text-xs shadow-lg shadow-sky-500/25 transition-all active:scale-[0.98] mt-2"
                      >
                        Save Profile Details
                      </button>
                    </form>

                  </div>

                  {/* CURRENT TIER CARD */}
                  <div className="bg-white dark:bg-zinc-900/80 border border-slate-100 dark:border-white/[0.08] rounded-3xl p-4 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Crown className="w-5 h-5 text-yellow-400" />
                        <div>
                          <span className="text-[10px] font-bold text-slate-400 uppercase block">Active Membership Tier</span>
                          <h4 className="text-sm font-black text-slate-900 dark:text-white">{currentTier.name}</h4>
                        </div>
                      </div>
                      <button 
                        onClick={() => setIsTierModalOpen(true)}
                        className="px-3 py-1.5 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold text-xs shadow-md"
                      >
                        Upgrade Tier
                      </button>
                    </div>

                    <div className="p-3 bg-slate-50 dark:bg-zinc-800/50 rounded-2xl text-xs space-y-1.5">
                      <div className="flex justify-between">
                        <span className="text-slate-400">Stake Deposit:</span>
                        <span className="font-mono font-bold text-slate-900 dark:text-white">₦{currentTier.stakeAmount.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Lifetime Withdrawal Cap:</span>
                        <span className="font-mono font-bold text-emerald-500">₦{currentTier.withdrawalCap.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Total Withdrawn:</span>
                        <span className="font-mono font-bold text-cyan-500">₦{totalWithdrawnLifetime.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>

                  {/* REFERRAL NETWORK MANAGEMENT */}
                  <div className="bg-white dark:bg-zinc-900/80 border border-slate-100 dark:border-white/[0.08] rounded-3xl p-4 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-zinc-300">
                        Referral Network ({activeReferralsCount}/3 Qualified)
                      </span>
                      <button 
                        onClick={() => setIsReferralLockModalOpen(true)}
                        className="text-xs font-bold text-cyan-500 hover:underline"
                      >
                        Inspect Rule
                      </button>
                    </div>

                    <div className="space-y-2">
                      {referrals.length === 0 ? (
                        <div className="p-5 rounded-2xl border border-dashed border-slate-200 dark:border-white/[0.08] text-center space-y-1.5">
                          <UserPlus className="w-5 h-5 text-slate-400 mx-auto" />
                          <p className="text-xs font-bold text-slate-700 dark:text-zinc-300">No Referrals Registered Yet</p>
                          <p className="text-[11px] text-slate-400">Share your referral link to invite peers and unlock withdrawal multipliers.</p>
                        </div>
                      ) : (
                        referrals.map(r => (
                          <div key={r.id} className="p-3 rounded-2xl border border-slate-100 dark:border-white/[0.06] bg-slate-50/50 dark:bg-zinc-800/40 flex items-center justify-between text-xs">
                            <div>
                              <span className="font-bold text-slate-900 dark:text-white block">{r.name} (@{r.username})</span>
                              <span className="text-[10px] text-slate-400 font-mono">Joined {r.joinedTime}</span>
                            </div>
                            <div className="text-right">
                              <span className="font-mono font-black text-emerald-600 dark:text-emerald-400 block">₦{r.depositedAmount.toLocaleString()}</span>
                              <span className="text-[9px] font-bold text-slate-400">{r.status}</span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* LINKED PAYSTACK BANKS */}
                  <div className="bg-white dark:bg-zinc-900/80 border border-slate-100 dark:border-white/[0.08] rounded-3xl p-4 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-zinc-300">
                        Linked Banks (Paystack NUBAN)
                      </span>
                      <button 
                        onClick={() => setIsAddBankModalOpen(true)}
                        className="text-xs font-bold text-cyan-500 hover:underline cursor-pointer"
                      >
                        + Add Bank
                      </button>
                    </div>

                    <div className="space-y-2">
                      {savedBanks.length === 0 ? (
                        <div className="p-4 rounded-2xl border border-dashed border-slate-200 dark:border-white/[0.08] text-center space-y-1.5">
                          <CreditCard className="w-5 h-5 text-slate-400 mx-auto" />
                          <p className="text-xs font-bold text-slate-700 dark:text-zinc-300">No Bank Account Linked</p>
                          <button 
                            onClick={() => setIsAddBankModalOpen(true)}
                            className="text-xs font-bold text-sky-500 hover:underline cursor-pointer"
                          >
                            + Link your 10-digit NUBAN account
                          </button>
                        </div>
                      ) : (
                        savedBanks.map(b => (
                          <div key={b.id} className="p-3 rounded-2xl border border-slate-100 dark:border-white/[0.06] bg-slate-50/50 dark:bg-zinc-800/40 flex items-center justify-between">
                            <div>
                              <span className="text-xs font-black text-slate-900 dark:text-white block">{b.bankName}</span>
                              <span className="text-[10px] font-mono text-slate-400 dark:text-zinc-400">{b.accountName} · •••• {b.accountNumber.slice(-4)}</span>
                            </div>
                            <span className="px-2 py-0.5 rounded-full bg-sky-50 dark:bg-zinc-800 text-sky-600 dark:text-cyan-400 text-[9px] font-bold">
                              Active
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* SUPABASE ACCOUNT & AUTHENTICATION CARD */}
                  <div className="bg-white dark:bg-zinc-900/80 border border-slate-100 dark:border-white/[0.08] rounded-3xl p-5 shadow-sm space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Shield className="w-4 h-4 text-emerald-500" />
                        <span className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-zinc-300">
                          Account & Security
                        </span>
                      </div>
                      <span className="px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 text-[10px] font-black flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                        {isSupabaseConfigured ? 'Cloud Sync Active' : 'Offline Mode'}
                      </span>
                    </div>

                    <div className="p-3.5 bg-slate-50/70 dark:bg-zinc-800/40 rounded-2xl border border-slate-100 dark:border-white/[0.06] space-y-2 text-xs">
                      <div className="flex justify-between items-center">
                        <span className="text-slate-400 dark:text-zinc-500">Connected Handle:</span>
                        <span className="font-bold text-sky-500 dark:text-cyan-400">@{user?.username}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-400 dark:text-zinc-500">Linked Email:</span>
                        <span className="font-mono text-slate-700 dark:text-zinc-300 font-semibold truncate max-w-[190px]">{user?.email}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-400 dark:text-zinc-500">Verified Phone:</span>
                        <span className="font-mono text-slate-700 dark:text-zinc-300 font-semibold">{user?.phone}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-slate-400 dark:text-zinc-500">Anti-Sybil Defense:</span>
                        <span className="text-emerald-600 dark:text-emerald-400 font-bold">1 Person = 1 Account</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        onClick={() => {
                          setAuthMode('signin');
                          setAuthError(null);
                          setAuthDuplicateError(null);
                          setIsAuthModalOpen(true);
                        }}
                        className="h-10 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-200 text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <UserCheck className="w-3.5 h-3.5 text-sky-500" />
                        Switch Account
                      </button>

                      <button
                        onClick={handleAuthSignOut}
                        className="h-10 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 border border-rose-200/60 dark:border-rose-900/40 text-rose-600 dark:text-rose-400 text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        Log Out
                      </button>
                    </div>
                  </div>

                  {/* LEGAL COMPLIANCE & POLICIES CARD */}
                  <div className="p-4 rounded-3xl bg-slate-50 dark:bg-zinc-900/50 border border-slate-200/70 dark:border-white/[0.06] text-center space-y-2.5">
                    <div className="flex items-center justify-center gap-3 text-xs font-bold text-slate-500 dark:text-zinc-400">
                      <button
                        type="button"
                        onClick={() => {
                          setTermsTab('terms');
                          setIsTermsModalOpen(true);
                        }}
                        className="hover:text-slate-900 dark:hover:text-white hover:underline cursor-pointer flex items-center gap-1"
                      >
                        <ScrollText className="w-3.5 h-3.5 text-sky-500" />
                        Terms of Service
                      </button>
                      <span>•</span>
                      <button
                        type="button"
                        onClick={() => {
                          setTermsTab('privacy');
                          setIsTermsModalOpen(true);
                        }}
                        className="hover:text-slate-900 dark:hover:text-white hover:underline cursor-pointer flex items-center gap-1"
                      >
                        <FileCheck className="w-3.5 h-3.5 text-emerald-500" />
                        Privacy & NDPR Policy
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-400 dark:text-zinc-500 leading-normal">
                      TaskPulse · Digital micro-task platform with automated Paystack payment processing.
                    </p>
                  </div>

                </div>
              )}

        </div>

        {/* ======================================================== */}
        {/* BOTTOM NAVIGATION                                        */}
        {/* ======================================================== */}
        <nav className="bg-white/95 dark:bg-[#0c0d12]/95 backdrop-blur-xl border-t border-slate-200/80 dark:border-white/[0.06] px-4 py-2 shrink-0 z-40 flex items-center justify-around transition-colors">
          
          <button 
            onClick={() => setActiveTab('home')}
            className={`flex flex-col items-center gap-1 py-1.5 px-3 rounded-2xl transition-all cursor-pointer ${
              activeTab === 'home' 
                ? 'bg-blue-50/90 dark:bg-zinc-800 text-blue-600 dark:text-sky-400 font-black shadow-xs' 
                : 'text-slate-500 hover:text-slate-800 dark:text-zinc-500 dark:hover:text-zinc-200'
            }`}
          >
            <Compass className="w-5 h-5" />
            <span className="text-[10px] font-extrabold tracking-tight">Home</span>
          </button>

          <button 
            onClick={() => setActiveTab('tasks')}
            className={`flex flex-col items-center gap-1 py-1.5 px-3 rounded-2xl relative transition-all cursor-pointer ${
              activeTab === 'tasks' 
                ? 'bg-blue-50/90 dark:bg-zinc-800 text-blue-600 dark:text-sky-400 font-black shadow-xs' 
                : 'text-slate-500 hover:text-slate-800 dark:text-zinc-500 dark:hover:text-zinc-200'
            }`}
          >
            <div className="relative">
              <CheckSquare className="w-5 h-5" />
              <span className="absolute -top-1 -right-1.5 w-3.5 h-3.5 rounded-full bg-blue-600 text-white text-[8px] font-black flex items-center justify-center">
                1
              </span>
            </div>
            <span className="text-[10px] font-extrabold tracking-tight">Tasks</span>
          </button>

          <button 
            onClick={() => setActiveTab('history')}
            className={`flex flex-col items-center gap-1 py-1.5 px-3 rounded-2xl relative transition-all cursor-pointer ${
              activeTab === 'history' 
                ? 'bg-blue-50/90 dark:bg-zinc-800 text-blue-600 dark:text-sky-400 font-black shadow-xs' 
                : 'text-slate-500 hover:text-slate-800 dark:text-zinc-500 dark:hover:text-zinc-200'
            }`}
          >
            <div className="relative">
              <History className="w-5 h-5" />
              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-500"></span>
            </div>
            <span className="text-[10px] font-extrabold tracking-tight">History</span>
          </button>

          <button 
            onClick={() => setActiveTab('profile')}
            className={`flex flex-col items-center gap-1 py-1.5 px-3.5 rounded-2xl transition-all cursor-pointer ${
              activeTab === 'profile' 
                ? 'bg-blue-50/90 dark:bg-zinc-800 text-blue-600 dark:text-sky-400 font-black shadow-xs' 
                : 'text-slate-500 hover:text-slate-800 dark:text-zinc-500 dark:hover:text-zinc-200'
            }`}
          >
            <div className="w-5 h-5 rounded-full border-2 border-current flex items-center justify-center">
              <User className="w-3 h-3" />
            </div>
            <span className="text-[10px] font-extrabold tracking-tight">Profile</span>
          </button>

        </nav>

        {/* BOTTOM HOME INDICATOR */}
        <div className="py-1.5 bg-white dark:bg-[#0c0d12] flex justify-center shrink-0">
          <div className="w-28 h-1 rounded-full bg-slate-200 dark:bg-zinc-800"></div>
        </div>

      </div>

      {/* ======================================================== */}
      {/* MODAL: TIERS SELECTION & UPGRADE (3k to 75k+)            */}
      {/* ======================================================== */}
      {isTierModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-[#111218] border border-cyan-400/40 dark:border-white/[0.08] rounded-3xl max-w-sm w-full p-5 space-y-4 shadow-2xl max-h-[90vh] flex flex-col">
            
            <div className="flex items-start justify-between shrink-0">
              <div>
                <span className="text-[10px] font-black text-cyan-500 uppercase tracking-wider">Membership Progression</span>
                <h3 className="text-base font-black text-slate-900 dark:text-white mt-0.5">Select &amp; Upgrade Tier</h3>
              </div>
              <button 
                onClick={() => setIsTierModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 dark:bg-zinc-800 flex items-center justify-center text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1.5 shrink-0">
              <p className="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed">
                Each tier caps your cumulative cashouts (e.g. ₦24,000 for Bronze). When you hit your tier limit, upgrade your tier to unlock higher limits!
              </p>
              <div className="p-2.5 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-amber-700 dark:text-amber-400 text-[11px] leading-snug font-medium">
                ⚡ <strong>Instant Withdrawal Rule:</strong> Those who made an upgrade after referring people that made them surpass their withdrawal limit can withdraw immediately after the upgrade has been made!
              </div>
            </div>

            <div className="space-y-2.5 overflow-y-auto no-scrollbar flex-1 pr-0.5">
              {TIERS_CONFIG.map(t => {
                const isCurrent = user?.tierId === t.id;
                return (
                  <div 
                    key={t.id}
                    onClick={() => handleSelectUpgradeTier(t)}
                    className={`p-3.5 rounded-2xl border text-xs cursor-pointer transition-all ${
                      isCurrent 
                        ? 'border-cyan-500 bg-cyan-50/50 dark:bg-cyan-950/40 shadow-sm' 
                        : 'border-slate-100 dark:border-white/[0.06] bg-slate-50/50 dark:bg-zinc-800/40 hover:border-cyan-400/40'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-black text-slate-900 dark:text-white">{t.name}</span>
                        <span className={`text-[9px] font-mono font-black px-1.5 py-0.2 rounded ${t.accentBg}`}>
                          {t.multiplier}x Limit
                        </span>
                      </div>
                      <span className="font-mono font-black text-sm text-slate-900 dark:text-white">
                        ₦{t.stakeAmount.toLocaleString()}
                      </span>
                    </div>

                    <div className="mt-2 pt-2 border-t border-slate-200/60 dark:border-white/[0.06] flex items-center justify-between text-[11px]">
                      <div>
                        <span className="text-slate-400 block text-[9px] uppercase font-bold">Lifetime Cashout Cap</span>
                        <span className="font-mono font-black text-emerald-600 dark:text-emerald-400">
                          ₦{t.withdrawalCap.toLocaleString()}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-slate-400 block text-[9px] uppercase font-bold">Referral Multiplier</span>
                        <span className="font-bold text-cyan-600 dark:text-cyan-400">{t.referralBoost}</span>
                      </div>
                    </div>

                    <div className="mt-2 flex items-center justify-between text-[10px] font-bold">
                      <span className="text-slate-400">{t.description}</span>
                      {isCurrent ? (
                        <span className="text-cyan-500 font-extrabold uppercase shrink-0">Current ✓</span>
                      ) : (
                        <span className="text-sky-500 font-extrabold uppercase shrink-0">Upgrade →</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <button 
              onClick={() => setIsTierModalOpen(false)}
              className="w-full h-11 rounded-full bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 font-bold text-xs shrink-0"
            >
              Close Tiers
            </button>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: 3 REFERRALS & 3X DEPOSIT WITHDRAWAL GATEKEEPER    */}
      {/* ======================================================== */}
      {isReferralLockModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-[#111218] border border-indigo-400/50 dark:border-indigo-500/40 rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl text-center relative overflow-hidden">
            
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-cyan-400 to-indigo-500"></div>

            <div className="relative mx-auto w-16 h-16 rounded-3xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-300 dark:border-indigo-500/40 flex items-center justify-center text-indigo-500 shadow-lg shadow-indigo-500/10">
              <Users className="w-8 h-8 text-indigo-500 animate-pulse-subtle" />
            </div>

            <div className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-wider text-indigo-500 dark:text-indigo-400">
                Referral Gating &amp; Deposit Doubler
              </span>
              <h3 className="text-lg font-black text-slate-900 dark:text-white">
                3 Qualified Referrals Required
              </h3>
              <p className="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed font-medium pt-0.5">
                The minimum withdrawal (₦3,000) only applies to members whose direct referrals have <strong>tripled their initial deposit</strong> (at least 3 referrals totaling <strong>₦9,000 volume</strong>).
              </p>
            </div>

            {/* RULE CALLOUT FOR UPGRADES */}
            <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-left space-y-1">
              <span className="text-[10px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400 block">
                ⚡ Tier Upgrade Exemption Rule
              </span>
              <p className="text-[11px] text-slate-600 dark:text-zinc-300 leading-snug">
                Members who referred people that made them surpass their withdrawal limit can withdraw immediately once their tier upgrade has been made!
              </p>
            </div>

            {/* REWARD CALLOUT */}
            <div className="p-3 rounded-2xl bg-gradient-to-br from-indigo-50 to-cyan-50 dark:from-indigo-950/40 dark:to-zinc-900 border border-indigo-200 dark:border-white/[0.08] text-left space-y-1.5">
              <div className="flex items-center justify-between text-xs font-bold text-slate-900 dark:text-white">
                <span className="flex items-center gap-1.5">
                  <Gift className="w-4 h-4 text-indigo-500" />
                  <span>Double Deposit Reward:</span>
                </span>
                <span className="font-mono text-emerald-600 dark:text-emerald-400 font-black">+₦3,000 Credit</span>
              </div>
              <p className="text-[10px] text-slate-500 dark:text-zinc-400 leading-snug">
                Once met, your initial deposit will be credited back into your wallet (doubling your balance) and minimum withdrawal unlocks permanently!
              </p>
            </div>

            {/* PROGRESS STATUS */}
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-zinc-900/80 border border-slate-200 dark:border-white/[0.08] space-y-2.5">
              <div className="flex justify-between items-center text-xs font-bold text-slate-700 dark:text-zinc-300">
                <span>Active Referrals:</span>
                <span className="font-mono text-indigo-600 dark:text-indigo-400">{activeReferralsCount} / 3 Referrals</span>
              </div>

              {/* 3 Referral Cards */}
              <div className="space-y-1.5 text-left text-[11px]">
                {[0, 1, 2].map(idx => {
                  const ref = referrals[idx];
                  const isQualified = ref && ref.depositedAmount >= 3000;
                  return (
                    <div 
                      key={idx}
                      className={`p-2.5 rounded-xl border flex items-center justify-between font-mono transition-all ${
                        isQualified 
                          ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300' 
                          : ref
                          ? 'bg-sky-50/60 dark:bg-sky-950/20 border-sky-200 dark:border-sky-800/40 text-sky-800 dark:text-sky-300'
                          : 'bg-white dark:bg-zinc-800 border-slate-200 dark:border-white/10 text-slate-400'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="font-bold shrink-0">Slot {idx + 1}:</span>
                        <span className="truncate">
                          {ref ? (ref.name || `@${ref.username}`) : 'Invite a Friend'}
                        </span>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="font-black">
                          {isQualified 
                            ? `₦${ref.depositedAmount.toLocaleString()} ✓` 
                            : ref 
                            ? `₦${ref.depositedAmount.toLocaleString()} / ₦3k` 
                            : '₦0 / ₦3k'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-between text-[10px] text-slate-400 font-semibold pt-1">
                <span>Combined Volume: <strong>₦{totalReferralsDeposit.toLocaleString()}</strong></span>
                <span>Target: <strong>₦{targetReferralVolume.toLocaleString()}</strong></span>
              </div>
            </div>

            {/* ACTION BUTTON */}
            <div className="space-y-2 pt-1">
              <button 
                onClick={() => {
                  const shareUrl = `${window.location.origin}/?ref=${user?.referralCode || ''}`;
                  navigator.clipboard.writeText(shareUrl);
                  triggerConfetti();
                  showToast('Referral Link Copied', 'Share your link: Earn when referrals deposit ₦3,000!');
                }}
                className="w-full h-11 rounded-full bg-gradient-to-r from-indigo-500 via-sky-500 to-blue-600 hover:opacity-95 text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-indigo-500/25 active:scale-95 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Share2 className="w-4 h-4" />
                <span>Copy Referral Invite Link</span>
              </button>
            </div>

            <button 
              onClick={() => setIsReferralLockModalOpen(false)}
              className="text-xs font-bold text-slate-400 hover:text-slate-600 block mx-auto pt-1"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: 48-HOUR FIRST CASHOUT SECURITY LOCK SCREEN        */}
      {/* ======================================================== */}
      {isSecurityLockModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-[#111218] border border-amber-300 dark:border-amber-500/30 rounded-3xl max-w-sm w-full p-6 space-y-5 shadow-2xl text-center relative overflow-hidden">
            
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500"></div>

            <div className="relative mx-auto w-16 h-16 rounded-3xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-500/40 flex items-center justify-center text-amber-500 shadow-lg shadow-amber-500/10">
              <LockKeyhole className="w-8 h-8 text-amber-500 animate-pulse-subtle" />
            </div>

            <div className="space-y-1">
              <span className="text-[10px] font-black uppercase tracking-wider text-amber-500 dark:text-amber-400">
                FinTech Fraud Prevention Protocol
              </span>
              <h3 className="text-lg font-black text-slate-900 dark:text-white">
                Initial Cashout Unlocks in 2 Days
              </h3>
              <p className="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed font-medium pt-1">
                Per Nigerian banking and anti-chargeback guidelines, all newly activated accounts undergo a mandatory <strong>48-hour (2-day)</strong> account seasoning period before the first withdrawal.
              </p>
            </div>

            {/* LIVE COUNTDOWN DISPLAY */}
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-zinc-900/80 border border-slate-200 dark:border-white/[0.08] space-y-2">
              <div className="grid grid-cols-4 gap-2 text-center font-mono">
                <div className="p-2 rounded-xl bg-white dark:bg-zinc-800 border border-slate-200 dark:border-white/[0.08]">
                  <span className="text-lg font-black text-amber-500 block leading-none">{countdownParts.d}</span>
                  <span className="text-[8px] font-bold text-slate-400 uppercase mt-0.5 block">Days</span>
                </div>
                <div className="p-2 rounded-xl bg-white dark:bg-zinc-800 border border-slate-200 dark:border-white/[0.08]">
                  <span className="text-lg font-black text-amber-500 block leading-none">{countdownParts.h}</span>
                  <span className="text-[8px] font-bold text-slate-400 uppercase mt-0.5 block">Hours</span>
                </div>
                <div className="p-2 rounded-xl bg-white dark:bg-zinc-800 border border-slate-200 dark:border-white/[0.08]">
                  <span className="text-lg font-black text-amber-500 block leading-none">{countdownParts.m}</span>
                  <span className="text-[8px] font-bold text-slate-400 uppercase mt-0.5 block">Mins</span>
                </div>
                <div className="p-2 rounded-xl bg-white dark:bg-zinc-800 border border-slate-200 dark:border-white/[0.08]">
                  <span className="text-lg font-black text-amber-500 block leading-none animate-pulse">{countdownParts.s}</span>
                  <span className="text-[8px] font-bold text-slate-400 uppercase mt-0.5 block">Secs</span>
                </div>
              </div>

              <div className="flex justify-between items-center text-[10px] text-slate-400 dark:text-zinc-400 font-semibold pt-1">
                <span>Escrow Balance: <strong className="text-emerald-500 font-mono">₦{withdrawableBalance.toLocaleString()}</strong></span>
                <span>Seasoning: <strong className="text-amber-500 font-mono">{seasoningProgressPercent}%</strong></span>
              </div>
            </div>

            {/* ACTION BUTTON */}
            <div className="space-y-2 pt-1">

              <button 
                onClick={() => {
                  setIsSecurityLockModalOpen(false);
                  setActiveTab('tasks');
                }}
                className="w-full h-10 rounded-full bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-300 font-bold text-xs transition-all"
              >
                Continue Completing High-Paying Tasks
              </button>
            </div>

            <button 
              onClick={() => setIsSecurityLockModalOpen(false)}
              className="text-xs font-bold text-slate-400 hover:text-slate-600 block mx-auto pt-1"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: PAYSTACK ₦3,000 CHECKOUT MODAL                    */}
      {/* ======================================================== */}
      {isDepositModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-[#111218] border border-slate-200 dark:border-white/[0.08] rounded-3xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
            
            <div className="flex items-center justify-between border-b pb-3 border-slate-100 dark:border-white/[0.06]">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-[#0ba4db] text-white flex items-center justify-center font-black text-sm">
                  P
                </div>
                <div>
                  <h4 className="text-xs font-black text-slate-900 dark:text-white leading-none">Paystack Checkout</h4>
                  <span className="text-[10px] text-slate-400">TaskPulse ₦3,000 Activation Drop</span>
                </div>
              </div>
              <button 
                onClick={() => setIsDepositModalOpen(false)}
                className="w-7 h-7 rounded-full bg-slate-100 dark:bg-zinc-800 flex items-center justify-center text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 bg-slate-50 dark:bg-zinc-800/60 rounded-2xl space-y-3 text-xs border border-slate-100 dark:border-white/[0.06]">
              <div className="flex justify-between items-center">
                <span className="text-slate-400 font-medium">Deposit Purpose:</span>
                <span className="text-slate-900 dark:text-white font-bold">{isActivated ? 'Wallet Top-Up' : 'Bronze Pulse Activation'}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400 font-medium">Amount:</span>
                <span className="font-mono font-black text-base text-emerald-600 dark:text-emerald-400">₦3,000.00</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400 font-medium">Processing Fee:</span>
                <span className="font-mono font-bold text-sky-500">₦0.00 (Zero Fee)</span>
              </div>
              <div className="pt-2 border-t border-slate-200/60 dark:border-white/[0.06] text-[11px] text-slate-500 dark:text-zinc-400 leading-relaxed">
                You will be redirected to Paystack’s secure checkout. Supports Debit Card, Bank Transfer, USSD, and Apple Pay.
              </div>
            </div>

            <div className="flex items-center justify-center gap-1.5 py-1 text-[10px] text-slate-400">
              <Shield className="w-3.5 h-3.5 text-emerald-500" />
              <span>Certified PCI-DSS Merchant · Instant Bank Crediting</span>
            </div>

            <button 
              onClick={() => handleInitiatePaystackDeposit(3000)}
              disabled={isProcessingDeposit}
              className="w-full h-12 rounded-full bg-gradient-to-r from-sky-500 via-cyan-500 to-blue-600 text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-sky-500/25 active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              {isProcessingDeposit ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  <span>Connecting to Paystack...</span>
                </>
              ) : (
                <>
                  <CreditCard className="w-4 h-4" />
                  <span>Proceed to Paystack (₦3,000)</span>
                </>
              )}
            </button>

          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: PAYSTACK CASHOUT (MINIMUM ₦3,000 ENFORCED)        */}
      {/* ======================================================== */}
      {isCashoutModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-[#111218] border border-slate-200 dark:border-white/[0.08] rounded-3xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
            
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-black text-cyan-500 uppercase tracking-wider">{currentTier.name} Transfer Rail</span>
                <h3 className="text-base font-black text-slate-900 dark:text-white mt-0.5">
                  {cashoutStep === 'amount' ? 'Instant Bank Cashout' : cashoutStep === 'confirm' ? 'Confirm Withdrawal Details' : 'Transfer Disbursed!'}
                </h3>
              </div>
              <button 
                onClick={() => setIsCashoutModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 dark:bg-zinc-800 flex items-center justify-center text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {cashoutStep === 'amount' && (
              <form onSubmit={handleInitiateCashout} className="space-y-3.5">
                
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-zinc-300">Destination Account</label>
                  <div className="space-y-1.5">
                    {savedBanks.map(b => (
                      <div 
                        key={b.id}
                        onClick={() => setSelectedBankId(b.id)}
                        className={`p-2.5 rounded-2xl border text-xs cursor-pointer flex items-center justify-between transition-all ${
                          selectedBankId === b.id 
                            ? 'border-cyan-500 bg-sky-50/60 dark:bg-cyan-950/40 text-sky-700 dark:text-cyan-300 font-bold' 
                            : 'border-slate-100 dark:border-white/[0.06] text-slate-600 dark:text-zinc-400'
                        }`}
                      >
                        <div>
                          <p className="font-extrabold">{b.bankName}</p>
                          <p className="text-[10px] font-mono text-slate-400 dark:text-zinc-500">•••• {b.accountNumber.slice(-4)}</p>
                        </div>
                        {selectedBankId === b.id && <Check className="w-4 h-4 text-cyan-500" />}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between items-center text-xs font-semibold text-slate-600 dark:text-zinc-400">
                    <span>Withdrawal Amount (₦)</span>
                    <span className="font-mono text-emerald-600 dark:text-emerald-400">
                      Min: ₦3,000 · Remaining: ₦{remainingTierAllowance.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <input 
                      type="number"
                      min={3000} // USER DIRECTIVE: MINIMUM ₦3,000
                      max={Math.min(withdrawableBalance, remainingTierAllowance, currentTier.dailyMaxCashout)}
                      value={cashoutAmount}
                      onChange={e => setCashoutAmount(e.target.value)}
                      className="flex-1 h-11 px-4 rounded-full bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-white/[0.08] text-xs font-bold font-mono focus:outline-none"
                      required
                    />
                    <button 
                      type="button"
                      onClick={() => setCashoutAmount(Math.min(withdrawableBalance, remainingTierAllowance, currentTier.dailyMaxCashout).toString())}
                      className="px-4 rounded-full bg-slate-100 dark:bg-zinc-800 text-xs font-bold"
                    >
                      Max
                    </button>
                  </div>
                </div>

                {/* FEE & STREAK BREAKDOWN */}
                <div className="p-3 rounded-2xl bg-slate-50 dark:bg-zinc-800/60 border border-slate-100 dark:border-white/[0.06] text-xs space-y-1.5 font-semibold">
                  <div className="flex justify-between text-slate-500 dark:text-zinc-400">
                    <span>Standard Paystack Transfer Fee:</span>
                    <span className="line-through font-mono">₦50</span>
                  </div>
                  <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                    <span className="flex items-center gap-1 font-bold">
                      <Flame className="w-3.5 h-3.5 fill-current" />
                      <span>5-Day Streak Fee Waiver:</span>
                    </span>
                    <span className="font-mono font-black">-₦50 (0% Fee)</span>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-slate-200 dark:border-white/[0.06] font-black text-slate-900 dark:text-white">
                    <span>Net Disbursed to {selectedBank?.bankName || 'Verified Bank'}:</span>
                    <span className="font-mono text-emerald-600 dark:text-emerald-400">₦{parseFloat(cashoutAmount || '0').toLocaleString()}</span>
                  </div>
                </div>

                <button 
                  type="submit"
                  className="w-full h-11 rounded-full bg-gradient-to-r from-sky-500 to-blue-600 text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-sky-500/25 active:scale-95 transition-all mt-1 cursor-pointer"
                >
                  Proceed to Transfer Confirmation
                </button>
              </form>
            )}

            {cashoutStep === 'confirm' && (
              <form onSubmit={handleConfirmCashout} className="space-y-4">
                <div className="p-3.5 bg-slate-50 dark:bg-zinc-800/60 rounded-2xl border border-slate-200/60 dark:border-white/[0.06] space-y-2.5 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Destination Bank:</span>
                    <span className="text-slate-900 dark:text-white font-bold">{selectedBank?.bankName || 'Bank'}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Account Number:</span>
                    <span className="font-mono font-bold text-slate-900 dark:text-white">•••• {selectedBank?.accountNumber?.slice(-4) || '••••'}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Account Name:</span>
                    <span className="font-bold text-slate-900 dark:text-white">{selectedBank?.accountName || user?.firstName}</span>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t border-slate-200/60 dark:border-white/[0.06]">
                    <span className="text-slate-400">Cashout Amount:</span>
                    <span className="font-mono font-black text-emerald-600 dark:text-emerald-400 text-sm">₦{parseFloat(cashoutAmount || '0').toLocaleString()}.00</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Network Fee:</span>
                    <span className="font-mono font-bold text-emerald-500">₦0.00 (Zero Fee)</span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button 
                    type="button"
                    onClick={() => setCashoutStep('amount')}
                    className="flex-1 h-11 rounded-full border border-slate-200 dark:border-white/[0.08] text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                  >
                    Back
                  </button>
                  <button 
                    type="submit"
                    disabled={isCashoutProcessing}
                    className="flex-2 h-11 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-bold text-xs uppercase tracking-wider shadow-md active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {isCashoutProcessing ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                        <span>Disbursing via NIP...</span>
                      </>
                    ) : (
                      <span>Confirm & Disburse Funds</span>
                    )}
                  </button>
                </div>
              </form>
            )}

            {cashoutStep === 'success' && (
              <div className="text-center space-y-4 py-2">
                <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-500 flex items-center justify-center mx-auto text-3xl shadow-md">
                  ✓
                </div>
                <div>
                  <h4 className="text-base font-black text-slate-900 dark:text-white">Funds Successfully Disbursed!</h4>
                  <p className="text-xs font-medium text-slate-500 dark:text-zinc-400 mt-1">
                    ₦{parseFloat(cashoutAmount).toLocaleString()} sent to {selectedBank?.bankName || 'Verified Bank'} ({selectedBank?.accountNumber || '••••'}).
                  </p>
                </div>

                <div className="p-3 rounded-2xl bg-slate-50 dark:bg-zinc-800/80 font-mono text-[11px] space-y-1 text-left border border-slate-200 dark:border-white/[0.08]">
                  <div className="flex justify-between">
                    <span className="text-slate-400 dark:text-zinc-500">Paystack Ref:</span>
                    <span className="font-bold text-slate-900 dark:text-white">{transferRef}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400 dark:text-zinc-500">Tier Allowance Left:</span>
                    <span className="font-bold text-cyan-500">₦{remainingTierAllowance.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400 dark:text-zinc-500">Fee Paid:</span>
                    <span className="font-bold text-amber-500">₦0 (Streak Waived)</span>
                  </div>
                </div>

                <button 
                  onClick={() => setIsCashoutModalOpen(false)}
                  className="w-full h-11 rounded-full bg-cyan-500 text-white font-bold text-xs uppercase tracking-wider"
                >
                  Done
                </button>
              </div>
            )}

          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: DOUBLE-ENTRY FINTECH AUDIT LEDGER                 */}
      {/* ======================================================== */}
      {isLedgerModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-[#111218] border border-slate-200 dark:border-white/[0.08] rounded-3xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-black text-cyan-500 uppercase tracking-wider">Immutable Audit Trail</span>
                <h3 className="text-base font-black text-slate-900 dark:text-white mt-0.5">FinTech Transaction Ledger</h3>
              </div>
              <button 
                onClick={() => setIsLedgerModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 dark:bg-zinc-800 flex items-center justify-center text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2 max-h-[320px] overflow-y-auto no-scrollbar">
              {transactions.map(tx => (
                <div key={tx.id} className="p-3 rounded-2xl bg-slate-50 dark:bg-zinc-800/50 border border-slate-100 dark:border-white/[0.06] flex items-center justify-between text-xs">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-slate-900 dark:text-white">{tx.title}</span>
                      <span className={`text-[8px] font-mono px-1.5 py-0.2 rounded uppercase font-black ${
                        tx.type === 'DepositMatch' 
                          ? 'bg-purple-100 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400' 
                          : tx.type === 'TierUpgrade'
                            ? 'bg-cyan-100 dark:bg-cyan-950/60 text-cyan-600 dark:text-cyan-400'
                            : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'
                      }`}>
                        {tx.status}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 dark:text-zinc-500 mt-0.5">{tx.sub} · {tx.date}</p>
                    <p className="text-[9px] font-mono text-cyan-600 dark:text-cyan-400">{tx.reference}</p>
                  </div>
                  <span className={`font-mono font-black text-sm ${
                    tx.type === 'Cashout' 
                      ? 'text-rose-500' 
                      : tx.type === 'DepositMatch' 
                        ? 'text-purple-500 dark:text-purple-400' 
                        : 'text-emerald-600 dark:text-emerald-400'
                  }`}>
                    {tx.type === 'Cashout' ? '-' : '+'}₦{tx.amount.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>

            <button 
              onClick={() => setIsLedgerModalOpen(false)}
              className="w-full h-10 rounded-full bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-200 font-bold text-xs"
            >
              Close Ledger
            </button>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: VERIFIED FINTECH DIGITAL RECEIPT                  */}
      {/* ======================================================== */}
      {selectedReceipt && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-[#111218] border border-slate-200 dark:border-white/[0.08] rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-400 via-sky-500 to-blue-600"></div>

            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-black text-cyan-500 uppercase tracking-wider font-mono">
                  TaskPulse Double-Entry Audit Seal
                </span>
                <h3 className="text-base font-black text-slate-900 dark:text-white mt-0.5">
                  Official Transaction Receipt
                </h3>
              </div>
              <button 
                onClick={() => setSelectedReceipt(null)}
                className="w-8 h-8 rounded-full bg-slate-100 dark:bg-zinc-800 flex items-center justify-center text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* RECEIPT WATERMARK BOX */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-zinc-900 border border-slate-200/80 dark:border-white/[0.06] text-center space-y-2">
              <span className="text-[10px] text-slate-400 uppercase font-black tracking-widest block">
                Settled Amount
              </span>
              <div className={`text-2xl font-black font-mono ${
                selectedReceipt.type === 'Cashout' ? 'text-rose-500' : 'text-emerald-600 dark:text-emerald-400'
              }`}>
                {selectedReceipt.type === 'Cashout' ? '-' : '+'}₦{selectedReceipt.amount.toLocaleString()}.00
              </div>
              <span className="inline-block px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 text-[10px] font-mono font-black uppercase">
                ✓ {selectedReceipt.status}
              </span>
            </div>

            {/* RECEIPT LINE ITEMS */}
            <div className="space-y-2 text-xs divide-y divide-slate-100 dark:divide-white/[0.04] pt-1">
              <div className="flex justify-between py-1.5">
                <span className="text-slate-400">Description:</span>
                <span className="font-bold text-slate-900 dark:text-white text-right">{selectedReceipt.title}</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-slate-400">Event Rail:</span>
                <span className="font-mono font-bold text-slate-900 dark:text-white">{selectedReceipt.sub}</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-slate-400">Date &amp; Time:</span>
                <span className="font-mono text-slate-600 dark:text-zinc-300">{selectedReceipt.date}</span>
              </div>
              <div className="flex justify-between py-1.5 items-center">
                <span className="text-slate-400">Reference Hash:</span>
                <div className="flex items-center gap-1 font-mono text-[10px] text-cyan-600 dark:text-cyan-400 font-bold">
                  <span>{selectedReceipt.reference}</span>
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(selectedReceipt.reference);
                      showToast('Copied', 'Reference hash copied to clipboard.');
                    }}
                    className="p-1 hover:text-slate-900 dark:hover:text-white"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <div className="flex justify-between py-1.5 text-[10px] text-slate-400">
                <span>Cryptographic Proof:</span>
                <span className="font-mono text-emerald-600 dark:text-emerald-400 font-bold">HMAC-SHA256 Validated</span>
              </div>
            </div>

            <div className="pt-2 flex gap-2">
              <button 
                onClick={() => {
                  window.print();
                }}
                className="flex-1 h-10 rounded-full border border-slate-200 dark:border-white/[0.08] text-xs font-bold text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-all flex items-center justify-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Print Receipt</span>
              </button>
              <button 
                onClick={() => setSelectedReceipt(null)}
                className="flex-1 h-10 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold transition-all"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: ADD BANK WITH LIVE PAYSTACK NUBAN RESOLUTION     */}
      {/* ======================================================== */}
      {isAddBankModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-[#111218] border border-slate-200 dark:border-white/[0.08] rounded-3xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-black text-cyan-500 uppercase tracking-wider">Instant Account Verification</span>
                <h3 className="text-base font-black text-slate-900 dark:text-white mt-0.5">Link NUBAN Bank Account</h3>
              </div>
              <button 
                onClick={() => setIsAddBankModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 dark:bg-zinc-800 flex items-center justify-center text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddBank} className="space-y-3.5">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 dark:text-zinc-300">Bank Provider</label>
                <select 
                  value={addBankCode}
                  onChange={e => setAddBankCode(e.target.value)}
                  className="w-full h-11 px-4 rounded-full bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-white/[0.08] text-xs font-semibold focus:outline-none"
                >
                  {PAYSTACK_BANKS.map(b => (
                    <option key={b.code} value={b.code}>{b.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 dark:text-zinc-300">10-Digit NUBAN Account</label>
                <input 
                  type="text"
                  maxLength={10}
                  value={addAccountNum}
                  onChange={e => setAddAccountNum(e.target.value.replace(/\D/g, ''))}
                  placeholder="0816596113"
                  className="w-full h-11 px-4 rounded-full bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-white/[0.08] text-xs font-bold font-mono focus:outline-none"
                  required
                />
              </div>

              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-white/[0.08] space-y-1">
                <span className="text-[10px] font-bold uppercase text-slate-400 dark:text-zinc-500 block">
                  Resolved Account Name:
                </span>
                {isResolvingAccount ? (
                  <span className="text-xs font-bold text-cyan-500 flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin"></span>
                    <span>Verifying account details...</span>
                  </span>
                ) : resolvedAccountName ? (
                  <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <span>✓</span>
                    <span>{resolvedAccountName}</span>
                  </span>
                ) : (
                  <span className="text-xs text-slate-400 dark:text-zinc-500 font-medium">
                    Enter 10 digits to auto-resolve account name.
                  </span>
                )}
              </div>

              <button 
                type="submit"
                disabled={!resolvedAccountName}
                className="w-full h-11 rounded-full bg-gradient-to-r from-sky-500 to-blue-600 text-white font-bold text-xs uppercase tracking-wider shadow-md mt-2 disabled:opacity-50"
              >
                Save &amp; Link Bank Account
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* TASK START MODAL                                         */}
      {/* ======================================================== */}
      {selectedTaskForModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-[#111218] border border-slate-200 dark:border-white/[0.08] rounded-3xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-black text-cyan-500 uppercase tracking-wider">{selectedTaskForModal.company}</span>
                <h3 className="text-sm font-black text-slate-900 dark:text-white mt-0.5">{selectedTaskForModal.title}</h3>
              </div>
              <button 
                onClick={() => setSelectedTaskForModal(null)}
                className="w-7 h-7 rounded-full bg-slate-100 dark:bg-zinc-800 flex items-center justify-center text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-sky-50 dark:bg-zinc-800/80 rounded-2xl flex items-center justify-between border border-sky-100 dark:border-white/[0.06]">
              <span className="text-xs font-bold text-sky-800 dark:text-zinc-300">Reward Payout:</span>
              <span className="text-lg font-black font-mono text-emerald-600 dark:text-emerald-400">₦{selectedTaskForModal.reward}</span>
            </div>

            <div className="space-y-2 text-xs text-slate-600 dark:text-zinc-300">
              <p className="font-semibold text-slate-900 dark:text-white">Required Steps:</p>
              {selectedTaskForModal.steps.map((step, idx) => (
                <div key={idx} className="flex items-start gap-2 text-[11px]">
                  <span className="w-4 h-4 rounded-full bg-sky-100 dark:bg-zinc-800 text-sky-600 dark:text-cyan-400 font-bold flex items-center justify-center shrink-0 text-[10px]">
                    {idx + 1}
                  </span>
                  <span>{step}</span>
                </div>
              ))}
            </div>

            <div className="flex gap-2 pt-2">
              <button 
                onClick={() => setSelectedTaskForModal(null)}
                className="flex-1 h-10 rounded-full border border-slate-200 dark:border-white/[0.08] text-xs font-bold text-slate-500"
              >
                Cancel
              </button>
              <button 
                onClick={() => handleStartTask(selectedTaskForModal)}
                className="flex-1 h-10 rounded-full bg-gradient-to-r from-sky-500 to-blue-600 text-white text-xs font-bold uppercase tracking-wider shadow-md active:scale-95 transition-all"
              >
                Accept Directive
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: DAILY STREAK CALENDAR & CLAIM                     */}
      {/* ======================================================== */}
      {isStreakModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-[#111218] border border-slate-200 dark:border-white/[0.08] rounded-3xl max-w-sm w-full p-5 space-y-4 shadow-2xl text-center">
            <div className="w-14 h-14 rounded-full bg-orange-100 dark:bg-orange-950/60 text-2xl flex items-center justify-center mx-auto text-orange-500 shadow-md">
              🔥
            </div>

            <div>
              <h3 className="text-base font-black text-slate-900 dark:text-white">
                {user?.streakDays}-Day Daily Login Streak
              </h3>
              <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">
                Maintain 5+ days streak to enjoy 0% Paystack cashout fees &amp; multiplying rewards.
              </p>
            </div>

            <div className="grid grid-cols-7 gap-1.5 py-2">
              {STREAK_DAYS_CONFIG.map((s, index) => {
                const isToday = index + 1 === user?.streakDays;
                const isPast = index + 1 < (user?.streakDays || 1) || (isToday && user?.streakClaimedToday);
                return (
                  <div 
                    key={s.day} 
                    className={`p-1.5 rounded-xl border text-center ${
                      isPast 
                        ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 text-emerald-600 font-bold'
                        : isToday 
                          ? 'bg-sky-50 dark:bg-sky-950/50 border-sky-400 text-sky-600 dark:text-cyan-400 font-black scale-105'
                          : 'bg-slate-50 dark:bg-zinc-800 border-slate-100 dark:border-white/[0.06] text-slate-400'
                    }`}
                  >
                    <span className="text-[9px] block">Day {s.day}</span>
                    <span className="text-[10px] font-black font-mono mt-1 block">{isPast ? '✓' : s.label}</span>
                  </div>
                );
              })}
            </div>

            <button 
              onClick={handleClaimDailyStreak}
              disabled={user?.streakClaimedToday}
              className={`w-full h-11 rounded-full font-bold text-xs uppercase tracking-wider transition-all ${
                user?.streakClaimedToday 
                  ? 'bg-slate-100 dark:bg-zinc-800 text-slate-400 cursor-not-allowed'
                  : 'bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-lg shadow-orange-500/25 active:scale-95'
              }`}
            >
              {user?.streakClaimedToday ? 'Already Claimed Today ✓' : 'Claim Daily Reward (₦100)'}
            </button>

            <button 
              onClick={() => setIsStreakModalOpen(false)}
              className="text-xs font-bold text-slate-400 hover:text-slate-600"
            >
              Close Calendar
            </button>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: SUPABASE AUTHENTICATION & DUPLICATE DEFENSE        */}
      {/* ======================================================== */}
      {isAuthModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-[#10121a] border border-slate-200 dark:border-white/[0.1] rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl relative max-h-[92vh] overflow-y-auto">
            
            {/* Header with Close */}
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-1.5">
                  <div className="w-5 h-5 rounded-md bg-gradient-to-tr from-sky-500 to-cyan-400 flex items-center justify-center text-white text-[10px] font-black">
                    {authMode === 'verify_email' ? '✉️' : '⚡'}
                  </div>
                  <span className="text-[10px] font-black text-sky-500 uppercase tracking-widest">
                    {authMode === 'verify_email' ? 'Email Verification' : 'Verified Secure Access'}
                  </span>
                </div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white mt-1">
                  {authMode === 'verify_email' ? 'Confirm Your Email' : authMode === 'signin' ? 'Sign In to TaskPulse' : 'Create an Account'}
                </h3>
              </div>
              <button 
                onClick={() => setIsAuthModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 flex items-center justify-center text-slate-400 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {authMode === 'verify_email' ? (
              <div className="space-y-4 py-1">
                {/* Visual Hero Badge */}
                <div className="text-center py-1">
                  <div className="relative mx-auto w-16 h-16 rounded-3xl bg-gradient-to-tr from-sky-500 via-cyan-400 to-blue-600 p-[2px] shadow-xl shadow-sky-500/20 mb-3">
                    <div className="w-full h-full rounded-[22px] bg-white dark:bg-zinc-900 flex items-center justify-center">
                      <Mail className="w-8 h-8 text-sky-500 animate-pulse" />
                    </div>
                  </div>
                  <h4 className="text-base font-black text-slate-900 dark:text-white">
                    Check your inbox to verify
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1 max-w-xs mx-auto leading-relaxed">
                    We sent an activation link to your email. Check for a message from <strong className="text-sky-600 dark:text-cyan-400">"Supabase Auth"</strong> to confirm your account.
                  </p>
                </div>

                {/* SENDER CALLOUT: SUPABASE AUTH */}
                <div className="p-3.5 rounded-2xl bg-sky-50/80 dark:bg-sky-950/40 border border-sky-200/80 dark:border-sky-800/60 space-y-2 text-left">
                  <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-sky-700 dark:text-cyan-400">
                    <Mail className="w-3.5 h-3.5 text-sky-500" />
                    <span>Important: Look for this email</span>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-500 dark:text-zinc-400">Sender Name:</span>
                      <span className="font-bold text-sky-700 dark:text-cyan-300 bg-white dark:bg-zinc-800 px-2 py-0.5 rounded-lg border border-sky-200/60 dark:border-white/[0.08] text-[11px]">
                        Supabase Auth
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-500 dark:text-zinc-400">Sender Address:</span>
                      <span className="font-mono text-[10px] text-slate-700 dark:text-zinc-300">
                        noreply@mail.app.supabase.io
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-500 dark:text-zinc-400">Subject Line:</span>
                      <span className="font-bold text-slate-800 dark:text-zinc-200 text-[11px]">
                        "Confirm your signup"
                      </span>
                    </div>
                  </div>
                </div>

                {/* Recipient Email Address Pill */}
                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-zinc-900/80 border border-slate-200 dark:border-white/[0.08] flex items-center justify-between gap-2 shadow-xs">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-7 h-7 rounded-xl bg-sky-500/10 flex items-center justify-center shrink-0">
                      <MailCheck className="w-4 h-4 text-sky-500" />
                    </div>
                    <div className="min-w-0">
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-zinc-500 font-bold block">
                        Recipient Address
                      </span>
                      <span className="font-mono font-bold text-xs text-slate-900 dark:text-white truncate block">
                        {authEmail || 'your.email@example.com'}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('signup');
                      setAuthError(null);
                    }}
                    className="text-[11px] font-bold text-sky-500 hover:text-sky-600 dark:text-sky-400 hover:underline shrink-0 cursor-pointer"
                  >
                    Edit
                  </button>
                </div>

                {/* Quick Email Launcher Helper */}
                {authEmail && (
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500 block ml-1">
                      Quick Access
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      {authEmail.toLowerCase().includes('@gmail') ? (
                        <a
                          href="https://mail.google.com"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="h-10 px-3 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/50 border border-rose-200/60 dark:border-rose-900/40 text-rose-600 dark:text-rose-400 text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-xs"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Open Gmail
                        </a>
                      ) : authEmail.toLowerCase().includes('@yahoo') ? (
                        <a
                          href="https://mail.yahoo.com"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="h-10 px-3 rounded-xl bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/40 dark:hover:bg-purple-900/50 border border-purple-200/60 dark:border-purple-900/40 text-purple-600 dark:text-purple-400 text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-xs"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Open Yahoo
                        </a>
                      ) : authEmail.toLowerCase().includes('@outlook') || authEmail.toLowerCase().includes('@hotmail') ? (
                        <a
                          href="https://outlook.live.com"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="h-10 px-3 rounded-xl bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/40 dark:hover:bg-blue-900/50 border border-blue-200/60 dark:border-blue-900/40 text-blue-600 dark:text-blue-400 text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-xs"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Open Outlook
                        </a>
                      ) : (
                        <a
                          href={`mailto:${authEmail}`}
                          className="h-10 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-slate-700 dark:text-zinc-200 text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-xs"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Open Mail App
                        </a>
                      )}

                      <button
                        type="button"
                        onClick={handleResendVerification}
                        disabled={resendCooldown > 0 || isResendingEmail}
                        className={`h-10 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-xs cursor-pointer ${
                          resendCooldown > 0 || isResendingEmail
                            ? 'bg-slate-100 dark:bg-zinc-800 text-slate-400 dark:text-zinc-500 cursor-not-allowed border border-transparent'
                            : 'bg-sky-50 hover:bg-sky-100 dark:bg-sky-950/40 dark:hover:bg-sky-900/50 border border-sky-200/60 dark:border-sky-800/40 text-sky-600 dark:text-sky-400'
                        }`}
                      >
                        {isResendingEmail ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>Sending...</span>
                          </>
                        ) : resendCooldown > 0 ? (
                          <>
                            <Clock className="w-3.5 h-3.5" />
                            <span>Resend in {resendCooldown}s</span>
                          </>
                        ) : (
                          <>
                            <RefreshCw className="w-3.5 h-3.5" />
                            <span>Resend Link</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* Helpful Checklist Card */}
                <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-xs space-y-2">
                  <div className="flex items-center gap-1.5 font-bold text-amber-600 dark:text-amber-400 text-[11px]">
                    <Sparkles className="w-3.5 h-3.5 shrink-0" />
                    <span>How to activate:</span>
                  </div>
                  <ul className="text-[11px] text-slate-600 dark:text-zinc-300 space-y-1.5 pl-1 leading-snug">
                    <li className="flex items-start gap-1.5">
                      <span className="text-amber-500 font-bold shrink-0">1.</span>
                      <span>Search your inbox for sender <strong>"Supabase Auth"</strong> or subject <strong>"Confirm your signup"</strong>.</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="text-amber-500 font-bold shrink-0">2.</span>
                      <span>Click the <strong>Confirm your mail</strong> link inside.</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="text-amber-500 font-bold shrink-0">3.</span>
                      <span>Can't find it in your primary inbox? Check your <strong>Spam</strong> or <strong>Promotions</strong> folder.</span>
                    </li>
                  </ul>
                </div>

                {/* Error Banner if any */}
                {authError && (
                  <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                    <span className="text-xs text-rose-800 dark:text-rose-200 font-medium">{authError}</span>
                  </div>
                )}

                {/* Actions */}
                <div className="space-y-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('signin');
                      setAuthError(null);
                    }}
                    className="w-full h-11 rounded-full bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-sky-500/25 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>I've Confirmed, Let Me Sign In</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('signup');
                      setAuthError(null);
                    }}
                    className="w-full text-center text-[11px] font-bold text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white py-1 block cursor-pointer"
                  >
                    Use a different email address
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Mode Switcher Tabs */}
                <div className="p-1 rounded-2xl bg-slate-100 dark:bg-zinc-900/90 border border-slate-200/60 dark:border-white/[0.06] flex items-center">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('signin');
                      setAuthError(null);
                      setAuthDuplicateError(null);
                    }}
                    className={`flex-1 py-2 text-xs font-black rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                      authMode === 'signin'
                        ? 'bg-white dark:bg-zinc-800 text-sky-500 dark:text-cyan-400 shadow-sm'
                        : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('signup');
                      setAuthError(null);
                      setAuthDuplicateError(null);
                    }}
                    className={`flex-1 py-2 text-xs font-black rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                      authMode === 'signup'
                        ? 'bg-white dark:bg-zinc-800 text-sky-500 dark:text-cyan-400 shadow-sm'
                        : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    Create Account
                  </button>
                </div>

            {/* Anti-Duplicate Notice for Registration */}
            {authMode === 'signup' && (
              <div className="p-3 rounded-2xl bg-sky-50/80 dark:bg-sky-950/30 border border-sky-100 dark:border-sky-800/40 flex items-start gap-2.5">
                <Shield className="w-4 h-4 text-sky-500 shrink-0 mt-0.5" />
                <div className="text-[11px] text-sky-900 dark:text-sky-200 leading-tight">
                  <span className="font-black block text-sky-600 dark:text-cyan-400 mb-0.5">Strict Anti-Sybil Defense</span>
                  Each person is strictly limited to <strong>1 account</strong>. The same person cannot register twice using duplicate emails, phones, or usernames.
                </div>
              </div>
            )}

            {/* Real-Time Duplicate Warning Alert */}
            {authDuplicateError && (
              <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 flex items-start gap-2.5 animate-in shake">
                <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                <div className="text-xs text-rose-800 dark:text-rose-200 leading-tight">
                  <span className="font-black block text-rose-600 dark:text-rose-400 mb-0.5">Duplicate Registration Blocked</span>
                  {authDuplicateError}
                </div>
              </div>
            )}

            {/* General Auth Error Alert */}
            {authError && !authDuplicateError && (
              <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 flex items-start gap-2.5">
                <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-800 dark:text-amber-200 leading-tight">
                  <span className="font-black block text-amber-600 dark:text-amber-400 mb-0.5">Authentication Error</span>
                  {authError}
                </div>
              </div>
            )}

            {/* Form */}
            <form onSubmit={authMode === 'signup' ? handleAuthSignUp : handleAuthSignIn} className="space-y-3">
              
              {/* Extra fields for SIGN UP */}
              {authMode === 'signup' && (
                <>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700 dark:text-zinc-300 ml-1">
                      Full Legal Name
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={authFullName}
                        onChange={e => setAuthFullName(e.target.value)}
                        placeholder="e.g. John Doe"
                        className="w-full h-11 pl-10 pr-4 rounded-full bg-slate-50 dark:bg-zinc-800/80 border border-slate-200 dark:border-white/[0.08] text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500"
                        required
                      />
                      <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between ml-1">
                      <label className="text-xs font-bold text-slate-700 dark:text-zinc-300">
                        Username Handle
                      </label>
                      <span className="text-[10px] text-slate-400">Unique @handle</span>
                    </div>
                    <div className="relative">
                      <input
                        type="text"
                        value={authUsername}
                        onChange={e => setAuthUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                        onBlur={() => handleCheckDuplicateField('username')}
                        placeholder="e.g. DOCTORR"
                        className="w-full h-11 pl-10 pr-4 rounded-full bg-slate-50 dark:bg-zinc-800/80 border border-slate-200 dark:border-white/[0.08] text-xs font-bold uppercase text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500"
                        required
                      />
                      <span className="text-slate-400 font-bold text-xs absolute left-3.5 top-3.5">@</span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between ml-1">
                      <label className="text-xs font-bold text-slate-700 dark:text-zinc-300">
                        Nigerian Phone Number
                      </label>
                      <span className="text-[10px] text-slate-400">1 Account per SIM</span>
                    </div>
                    <div className="relative">
                      <input
                        type="tel"
                        value={authPhone}
                        onChange={e => setAuthPhone(e.target.value.replace(/\D/g, ''))}
                        onBlur={() => handleCheckDuplicateField('phone')}
                        placeholder="08012345678"
                        maxLength={11}
                        className="w-full h-11 pl-10 pr-4 rounded-full bg-slate-50 dark:bg-zinc-800/80 border border-slate-200 dark:border-white/[0.08] text-xs font-bold font-mono text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500"
                        required
                      />
                      <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                    </div>
                  </div>
                </>
              )}

              {/* Email Address (Both Modes) */}
              <div className="space-y-1">
                <div className="flex items-center justify-between ml-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-zinc-300">
                    Email Address
                  </label>
                  {authMode === 'signup' && <span className="text-[10px] text-slate-400">No duplicate emails</span>}
                </div>
                <div className="relative">
                  <input
                    type="email"
                    value={authEmail}
                    onChange={e => setAuthEmail(e.target.value)}
                    onBlur={() => handleCheckDuplicateField('email')}
                    placeholder="your.email@gmail.com"
                    className="w-full h-11 pl-10 pr-4 rounded-full bg-slate-50 dark:bg-zinc-800/80 border border-slate-200 dark:border-white/[0.08] text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500"
                    required
                  />
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                </div>
              </div>

              {/* Password (Both Modes) */}
              <div className="space-y-1">
                <div className="flex items-center justify-between ml-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-zinc-300">
                    Password
                  </label>
                  {authMode === 'signup' && <span className="text-[10px] text-slate-400">Min 8 characters</span>}
                </div>
                <div className="relative">
                  <input
                    type={showAuthPassword ? 'text' : 'password'}
                    value={authPassword}
                    onChange={e => setAuthPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full h-11 pl-10 pr-10 rounded-full bg-slate-50 dark:bg-zinc-800/80 border border-slate-200 dark:border-white/[0.08] text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500"
                    required
                  />
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                  <button
                    type="button"
                    onClick={() => setShowAuthPassword(!showAuthPassword)}
                    className="absolute right-3.5 top-3.5 text-slate-400 hover:text-slate-600 dark:hover:text-white cursor-pointer"
                  >
                    {showAuthPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Optional Referral Code for Sign Up */}
              {authMode === 'signup' && (
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-zinc-300 ml-1">
                    Referral Code (Optional)
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={authReferralCode}
                      onChange={e => setAuthReferralCode(e.target.value.toUpperCase())}
                      placeholder="e.g. TP-DOCTORR-2026"
                      className="w-full h-11 pl-10 pr-4 rounded-full bg-slate-50 dark:bg-zinc-800/80 border border-slate-200 dark:border-white/[0.08] text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500"
                    />
                    <Gift className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                  </div>
                </div>
              )}

              {/* Terms of Service Acceptance Checkbox for Sign Up */}
              {authMode === 'signup' && (
                <div className="flex items-start gap-2.5 p-3 rounded-2xl bg-slate-50 dark:bg-zinc-800/60 border border-slate-200/80 dark:border-white/[0.08] text-xs">
                  <input
                    type="checkbox"
                    id="authTermsCheckbox"
                    checked={authAcceptTerms}
                    onChange={e => setAuthAcceptTerms(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer shrink-0 accent-blue-600"
                    required
                  />
                  <label htmlFor="authTermsCheckbox" className="text-[11px] text-slate-600 dark:text-zinc-400 leading-snug cursor-pointer select-none">
                    I agree to the{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setTermsTab('terms');
                        setIsTermsModalOpen(true);
                      }}
                      className="font-black text-blue-600 dark:text-sky-400 hover:underline cursor-pointer"
                    >
                      Terms of Service
                    </button>{' '}
                    and{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setTermsTab('privacy');
                        setIsTermsModalOpen(true);
                      }}
                      className="font-black text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                    >
                      Privacy Policy (NDPR)
                    </button>
                  </label>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isAuthSubmitting || Boolean(authDuplicateError) || (authMode === 'signup' && !authAcceptTerms)}
                className={`w-full h-11 rounded-full font-bold text-xs uppercase tracking-wider shadow-lg transition-all active:scale-[0.98] mt-2 flex items-center justify-center gap-2 cursor-pointer ${
                  authDuplicateError || (authMode === 'signup' && !authAcceptTerms)
                    ? 'bg-slate-200 dark:bg-zinc-800 text-slate-400 cursor-not-allowed'
                    : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-blue-500/25 hover:opacity-95'
                }`}
              >
                {isAuthSubmitting ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                    <span>{authMode === 'signup' ? 'Verifying & Creating...' : 'Signing In...'}</span>
                  </>
                ) : (
                  <span>{authMode === 'signup' ? 'Create My Account' : 'Sign In to Account'}</span>
                )}
              </button>
            </form>

            <div className="pt-2 text-center border-t border-slate-100 dark:border-white/[0.06]">
              <span className="text-[10px] text-slate-400 dark:text-zinc-500 block">
                🔒 Protected by 256-bit bank-grade encryption & anti-fraud security.
              </span>
            </div>
            </>
            )}

          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: KYC VERIFICATION (TIER 1 TO TIER 2 UPGRADE)        */}
      {/* ======================================================== */}
      {isKycModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-[#10121a] border border-slate-200 dark:border-white/[0.1] rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl relative max-h-[92vh] overflow-y-auto">
            
            {/* Header with Close */}
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-1.5">
                  <div className="w-5 h-5 rounded-md bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-white text-[10px] font-black">
                    ✓
                  </div>
                  <span className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">
                    Identity Verification
                  </span>
                </div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white mt-1">
                  KYC Tier 2 Upgrade
                </h3>
              </div>
              <button 
                onClick={() => setIsKycModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 flex items-center justify-center text-slate-400 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed">
              Submit your identity details for Level 2 verification. For security and privacy, only the last 4 digits are retained.
            </p>

            {/* Error Alert */}
            {kycError && (
              <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                <span className="text-xs text-rose-800 dark:text-rose-200 font-medium">{kycError}</span>
              </div>
            )}

            <form onSubmit={handleVerifyKyc} className="space-y-3.5">
              
              {/* Document Type Selector */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 dark:text-zinc-300 ml-1">
                  Verification Method
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setKycDocType('bvn')}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                      kycDocType === 'bvn'
                        ? 'bg-sky-50 dark:bg-sky-950/50 border-sky-400 text-sky-600 dark:text-cyan-400 shadow-xs'
                        : 'border-slate-200 dark:border-white/[0.08] text-slate-600 dark:text-zinc-400'
                    }`}
                  >
                    <Fingerprint className="w-3.5 h-3.5" />
                    BVN (Bank ID)
                  </button>
                  <button
                    type="button"
                    onClick={() => setKycDocType('nin')}
                    className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                      kycDocType === 'nin'
                        ? 'bg-sky-50 dark:bg-sky-950/50 border-sky-400 text-sky-600 dark:text-cyan-400 shadow-xs'
                        : 'border-slate-200 dark:border-white/[0.08] text-slate-600 dark:text-zinc-400'
                    }`}
                  >
                    <FileCheck className="w-3.5 h-3.5" />
                    NIN (National ID)
                  </button>
                </div>
              </div>

              {/* 11-digit Number */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 dark:text-zinc-300 ml-1">
                  {kycDocType === 'bvn' ? '11-Digit BVN' : '11-Digit National Identity Number'}
                </label>
                <input
                  type="text"
                  maxLength={11}
                  value={kycNumber}
                  onChange={e => setKycNumber(e.target.value.replace(/\D/g, ''))}
                  placeholder={kycDocType === 'bvn' ? '22194829104' : '58192049182'}
                  className="w-full h-11 px-4 rounded-full bg-slate-50 dark:bg-zinc-800/80 border border-slate-200 dark:border-white/[0.08] text-xs font-bold font-mono tracking-wider text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500"
                  required
                />
              </div>

              {/* Date of Birth */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 dark:text-zinc-300 ml-1">
                  Date of Birth (as registered on BVN/NIN)
                </label>
                <input
                  type="date"
                  value={kycDob}
                  onChange={e => setKycDob(e.target.value)}
                  className="w-full h-11 px-4 rounded-full bg-slate-50 dark:bg-zinc-800/80 border border-slate-200 dark:border-white/[0.08] text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500"
                  required
                />
              </div>

              {/* Security Encryption Disclaimer */}
              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-zinc-800/50 border border-slate-100 dark:border-white/[0.06] flex items-start gap-2 text-[10px] text-slate-500 dark:text-zinc-400 leading-tight">
                <Lock className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                <span>
                  Identity verification is processed under Nigerian Data Protection Regulation (NDPR) guidelines. Only the last 4 digits are recorded in profile logs.
                </span>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isKycSubmitting || kycNumber.length !== 11}
                className="w-full h-11 rounded-full bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-emerald-500/25 transition-all active:scale-[0.98] disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
              >
                {isKycSubmitting ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                    <span>Submitting for Review...</span>
                  </>
                ) : (
                  <span>Submit for Review</span>
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: TERMS OF SERVICE & PRIVACY POLICY                   */}
      {/* ======================================================== */}
      {isTermsModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-[#10121a] border border-slate-200 dark:border-white/[0.1] rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl relative max-h-[92vh] flex flex-col">
            
            {/* Header */}
            <div className="flex items-start justify-between shrink-0">
              <div>
                <span className="text-[10px] font-black text-sky-500 uppercase tracking-widest">
                  Compliance &amp; Legal
                </span>
                <h3 className="text-lg font-black text-slate-900 dark:text-white mt-0.5">
                  TaskPulse Policies
                </h3>
              </div>
              <button 
                onClick={() => setIsTermsModalOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 flex items-center justify-center text-slate-400 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Mode Tabs */}
            <div className="p-1 rounded-2xl bg-slate-100 dark:bg-zinc-900 border border-slate-200/60 dark:border-white/[0.06] flex items-center shrink-0">
              <button
                type="button"
                onClick={() => setTermsTab('terms')}
                className={`flex-1 py-2 text-xs font-black rounded-xl transition-all cursor-pointer ${
                  termsTab === 'terms'
                    ? 'bg-white dark:bg-zinc-800 text-sky-500 dark:text-cyan-400 shadow-sm'
                    : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Terms of Service
              </button>
              <button
                type="button"
                onClick={() => setTermsTab('privacy')}
                className={`flex-1 py-2 text-xs font-black rounded-xl transition-all cursor-pointer ${
                  termsTab === 'privacy'
                    ? 'bg-white dark:bg-zinc-800 text-emerald-500 dark:text-emerald-400 shadow-sm'
                    : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Privacy Policy (NDPR)
              </button>
            </div>

            {/* Scrollable Policy Content */}
            <div className="flex-1 overflow-y-auto pr-1 space-y-3.5 text-xs text-slate-600 dark:text-zinc-300 leading-relaxed no-scrollbar border-y border-slate-100 dark:border-white/[0.06] py-3">
              {termsTab === 'terms' ? (
                <>
                  <div className="space-y-1">
                    <h4 className="font-black text-slate-900 dark:text-white text-xs">1. Platform Eligibility &amp; Account Rule</h4>
                    <p>
                      TaskPulse is a micro-task and peer-referral incentive platform. Each user is strictly permitted to hold exactly <strong>one (1) account</strong>. Multi-accounting, device spoofing, and emulator farm usage are prohibited under our anti-sybil protocol and will result in immediate permanent forfeiture of balances.
                    </p>
                  </div>

                  <div className="space-y-1">
                    <h4 className="font-black text-slate-900 dark:text-white text-xs">2. ₦3,000 Activation Stake &amp; Tier Allowance</h4>
                    <p>
                      To prevent bot abuse, users activate their profile with a one-time ₦3,000 commitment stake. Each membership tier grants a progressive withdrawal allowance (Bronze allows up to ₦24,000, Silver up to ₦80,000, Gold up to ₦120,000, Platinum up to ₦250,000, Diamond up to ₦450,000, and Black Crown VIP up to ₦750,000). Surpassing your tier allowance requires an upgrade to continue withdrawing.
                    </p>
                  </div>

                  <div className="space-y-1">
                    <h4 className="font-black text-slate-900 dark:text-white text-xs">3. Withdrawal Conditions &amp; 48-Hour Security Lock</h4>
                    <p>
                      Withdrawals are subject to a minimum floor of <strong>₦3,000</strong>. The minimum withdrawal is unlocked once you introduce at least 3 qualified referrals whose combined volume triples your initial deposit (₦9,000+), <em>OR</em> once you execute a tier upgrade. All new activations undergo a mandatory 48-hour cooling period before their initial cashout to safeguard community liquidity.
                    </p>
                  </div>

                  <div className="space-y-1">
                    <h4 className="font-black text-slate-900 dark:text-white text-xs">4. Paystack Settlement &amp; Banking Rails</h4>
                    <p>
                      All bank disbursements and deposit collections are executed through certified Paystack NIP banking rails. TaskPulse does not retain bank account card CVVs or online banking passwords.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-1">
                    <h4 className="font-black text-slate-900 dark:text-white text-xs">1. Nigeria Data Protection Regulation (NDPR)</h4>
                    <p>
                      TaskPulse complies with the NDPR and the Nigeria Data Protection Act (NDPA). We process your personal information lawfully, transparently, and exclusively for service delivery, identity verification, and anti-fraud auditing.
                    </p>
                  </div>

                  <div className="space-y-1">
                    <h4 className="font-black text-slate-900 dark:text-white text-xs">2. Personal Information Collected</h4>
                    <p>
                      We collect your legal name, username, verified Nigerian phone number, email address, NUBAN bank payout details, and identity documents (BVN/NIN) for KYC anti-money laundering compliance.
                    </p>
                  </div>

                  <div className="space-y-1">
                    <h4 className="font-black text-slate-900 dark:text-white text-xs">3. Cryptographic Storage &amp; Encryption</h4>
                    <p>
                      All personal data and financial audit ledgers are housed in PostgreSQL with Row-Level Security (RLS) and encrypted using AES-256 standards. We never sell, rent, or monetize your personal information to third-party ad networks.
                    </p>
                  </div>

                  <div className="space-y-1">
                    <h4 className="font-black text-slate-900 dark:text-white text-xs">4. Right to Deletion &amp; Data Access</h4>
                    <p>
                      You retain the right to inspect, export, or request the deletion of your account and transaction ledger at any time by contacting our compliance officers at support@taskpulse.website.
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* Close Button */}
            <button
              onClick={() => setIsTermsModalOpen(false)}
              className="w-full h-11 rounded-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold text-xs uppercase tracking-wider shrink-0 transition-all hover:opacity-95 cursor-pointer"
            >
              I Understand &amp; Agree
            </button>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* FLOATING TOAST NOTIFICATION                              */}
      {/* ======================================================== */}
      <div 
        className={`fixed top-4 right-4 z-50 bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-3 transform transition-all duration-300 max-w-sm ${
          toast.show ? 'translate-y-0 opacity-100 pointer-events-auto' : '-translate-y-10 opacity-0 pointer-events-none'
        }`}
      >
        <div className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0">
          <CheckCircle2 className="w-4 h-4" />
        </div>
        <div className="text-left">
          <p className="text-xs font-bold leading-tight">{toast.title}</p>
          <p className="text-[11px] opacity-80 leading-snug mt-0.5">{toast.subtitle}</p>
        </div>
      </div>

      {/* Vercel Analytics Tracker */}
      <Analytics />

    </div>
  );
}

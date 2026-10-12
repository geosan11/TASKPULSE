/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
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
  RefreshCw
} from 'lucide-react';
import { triggerConfetti } from './utils/confetti';

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
  type: 'Payout' | 'Cashout' | 'Streak' | 'Deposit' | 'Escrow';
  title: string;
  sub: string;
  amount: number;
  status: 'Settled' | 'Disbursed' | 'Escrowed';
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

interface UserProfile {
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  accountStatus: string;
  kycLevel: string;
  tier: string;
  level: number;
  dailyCashoutLimit: number;
  streakDays: number;
  streakClaimedToday: boolean;
  dailyQuestProgress: number;
  referralCode: string;
  wagerActive: boolean;
  activationDate: string;
}

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
  },
  {
    id: 't-soc-2',
    title: 'Retweet & Quote LeadsAfrica Launch',
    company: 'LeadsAfrica Growth',
    reward: 550,
    category: 'Social',
    time: '3m',
    SLA: 'Instant SLA Approval',
    spotsLeft: 18,
    spotsTotal: 80,
    description: 'Retweet the official LeadsAfrica 2026 digital journey campaign, tag 2 friends, and submit your post link.',
    steps: [
      'Visit the pinned tweet on X (@LeadsAfricaOfficial).',
      'Quote tweet with #LeadsAfrica and mention 2 active friends.',
      'Paste your tweet URL in the proof box below.'
    ],
    platformIcon: '𝕏'
  },
  {
    id: 't1',
    title: 'Test New Banking App Onboarding & OTP',
    company: 'PayFlow Labs',
    reward: 1500,
    category: 'App Tests',
    time: '15m',
    SLA: '24h SLA review',
    spotsLeft: 12,
    spotsTotal: 50,
    description: 'Install staging APK, run phone OTP & BVN validation test flow, and record video proof. Requires high-speed connection.',
    steps: [
      'Download and install the staging PayFlow test application from the link below.',
      'Input test phone number and trigger the SMS OTP. Verify the autofill sequence completes under 3 seconds.',
      'Record your screen showing the final successful BVN status screen with standard Android status bar visible.'
    ],
    platformIcon: '📱'
  },
  {
    id: 't2',
    title: 'POS Terminal & Storefront Audit',
    company: 'TradeDepot Lagos',
    reward: 2400,
    category: 'Field Audits',
    time: '25m field',
    SLA: '24h review',
    spotsLeft: 8,
    spotsTotal: 20,
    description: 'Verify agent POS operational status, capture geo-tagged storefront photo, and confirm sticker branding presence at Ikeja Plaza.',
    steps: [
      'Travel to the geofenced Ikeja Plaza agent merchant location.',
      'Verify with the merchant that their POS terminal is fully operational and note current downtime metrics.',
      'Capture a clear, geotagged photograph of the storefront clearly displaying the orange logo banner.'
    ],
    platformIcon: '📍'
  },
  {
    id: 't3',
    title: 'Agency Banking KYC Friction Survey',
    company: 'Moniepoint Research',
    reward: 650,
    category: 'Surveys',
    time: '8m',
    SLA: 'Instant SLA Approval',
    spotsLeft: 11,
    spotsTotal: 100,
    description: '12 structured questions concerning customer BVN lookup speed and merchant terminal downtime over the past 30 days.',
    steps: [
      'Open the Moniepoint interactive survey terminal form.',
      'Provide objective responses regarding daily agent transaction failures and average KYC verification latency.',
      'Submit the form after completing all 12 quantitative rating questions.'
    ],
    platformIcon: '📝'
  }
];

const LIVE_COMMUNITY_PAYOUTS = [
  { user: 'Grace O.', action: 'withdrew ₦15,000 via Moniepoint', bank: 'Moniepoint', time: '1m ago' },
  { user: 'Doctorr', action: 'earned ₦1,500 on Banking KYC Test', bank: 'Escrow', time: '3m ago' },
  { user: 'Chinedu A.', action: 'claimed ₦300 Day 5 Streak Bonus', bank: 'Wallet', time: '5m ago' },
  { user: 'Blessing K.', action: 'withdrew ₦24,000 via OPay', bank: 'OPay', time: '8m ago' },
  { user: 'Tunde M.', action: 'withdrew ₦9,500 via Kuda Bank', bank: 'Kuda', time: '12m ago' },
  { user: 'Favour E.', action: 'earned ₦2,400 on POS Audit', bank: 'Escrow', time: '15m ago' }
];

const STREAK_DAYS_CONFIG = [
  { day: 1, reward: 50, label: '₦50', status: 'claimed' },
  { day: 2, reward: 100, label: '₦100', status: 'claimed' },
  { day: 3, reward: 150, label: '₦150', status: 'claimed' },
  { day: 4, reward: 200, label: '₦200', status: 'claimed' },
  { day: 5, reward: 300, label: '₦300', status: 'active' },
  { day: 6, reward: 450, label: '₦450', status: 'locked' },
  { day: 7, reward: 1000, label: '₦1,000 🎁', status: 'locked' }
];

export default function App() {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    return localStorage.getItem('taskpulse_theme') !== 'light';
  });

  // Mandatory ₦3,000 Minimum Drop Rule
  const [isActivated, setIsActivated] = useState<boolean>(() => {
    const saved = localStorage.getItem('taskpulse_activated');
    return saved === 'true';
  });

  // Balance Privacy (Eye toggle)
  const [isBalanceHidden, setIsBalanceHidden] = useState<boolean>(false);

  // User Profile matching Emmanuel @DOCTORR (from Screenshots)
  const [user, setUser] = useState<UserProfile | null>(() => {
    const saved = localStorage.getItem('taskpulse_user_v5');
    if (saved) return JSON.parse(saved);
    return {
      username: 'DOCTORR',
      firstName: 'EMMANUEL',
      lastName: 'ONUABUGHICHI',
      email: 'emmanuelonuabughichi@gmail.com',
      phone: '08165961134',
      accountStatus: 'Fully Verified',
      kycLevel: 'Level 2 KYC',
      tier: 'Black Elite Earner',
      level: 2,
      dailyCashoutLimit: 20000,
      streakDays: 5,
      streakClaimedToday: false,
      dailyQuestProgress: 2,
      referralCode: 'TP-DOCTORR-2026',
      wagerActive: false,
      activationDate: 'Oct 11, 2026'
    };
  });

  // 4 Bottom Navigation Tabs (matching LeadsAfrica screenshot: Home, Tasks, Ads, Profile)
  const [activeTab, setActiveTab] = useState<'home' | 'tasks' | 'ads' | 'profile'>('home');

  const [withdrawableBalance, setWithdrawableBalance] = useState<number>(() => {
    const saved = localStorage.getItem('taskpulse_withdrawable');
    return saved ? parseInt(saved, 10) : 18750;
  });
  const [pendingBalance, setPendingBalance] = useState<number>(() => {
    const saved = localStorage.getItem('taskpulse_pending');
    return saved ? parseInt(saved, 10) : 3800;
  });

  // ========================================================
  // RULE: 2 DAYS (48 HOURS) BEFORE FIRST WITHDRAWAL CAN BE MADE
  // ========================================================
  // Default to 1 day, 19 hours, 42 minutes, 15 seconds remaining (~43.7 hours left)
  const [cooldownSeconds, setCooldownSeconds] = useState<number>(() => {
    const saved = localStorage.getItem('taskpulse_cooldown_seconds');
    return saved !== null ? parseInt(saved, 10) : 157335; // 1d 19h 42m 15s
  });

  // Developer / Reviewer Demo Override (lets tester fast-forward the 2 days anytime)
  const [is48hLockOverridden, setIs48hLockOverridden] = useState<boolean>(() => {
    return localStorage.getItem('taskpulse_48h_override') === 'true';
  });

  const [isSecurityLockModalOpen, setIsSecurityLockModalOpen] = useState<boolean>(false);

  // Live Countdown Ticker
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
  const isWithdrawalLocked = !is48hLockOverridden && cooldownSeconds > 0;
  const progressPercent = Math.min(100, Math.round(((172800 - cooldownSeconds) / 172800) * 100));

  // Ledger Transactions (FinTech Double-Entry Audit Trail)
  const [transactions, setTransactions] = useState<Transaction[]>([
    { id: 'tx-1', type: 'Payout', title: 'TikTok Follow Bounty', sub: 'Kuda FinTech Media · SLA verified', amount: 450, status: 'Settled', date: 'Today, 2:15 PM', reference: 'ref_tp_984102' },
    { id: 'tx-2', type: 'Deposit', title: 'Activation Deposit', sub: 'Paystack NIP Instant Inflow', amount: 3000, status: 'Settled', date: 'Yesterday, 11:20 AM', reference: 'ref_tp_871920' },
    { id: 'tx-3', type: 'Streak', title: 'Day 5 Login Multiplier', sub: 'Community habit reward', amount: 300, status: 'Settled', date: 'Today, 8:00 AM', reference: 'ref_tp_719024' },
    { id: 'tx-4', type: 'Payout', title: 'Banking KYC Friction Survey', sub: 'Moniepoint Research Corp', amount: 650, status: 'Settled', date: 'Yesterday, 4:10 PM', reference: 'ref_tp_610294' }
  ]);
  const [isLedgerModalOpen, setIsLedgerModalOpen] = useState(false);

  // Tasks & Submissions
  const [tasksList, setTasksList] = useState<Task[]>(DEFAULT_TASKS);
  const [taskFilter, setTaskFilter] = useState<'all' | 'Social' | 'App Tests' | 'Surveys' | 'Field Audits'>('all');
  const [selectedTaskForModal, setSelectedTaskForModal] = useState<Task | null>(null);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [workspaceTimer, setWorkspaceTimer] = useState<number>(1800);
  const [taskProofInput, setTaskProofInput] = useState('');
  const [uploadedScreenshot, setUploadedScreenshot] = useState<string | null>(null);

  const [submissions, setSubmissions] = useState<Submission[]>([
    { id: 'sub-101', taskTitle: 'Follow & Like Brand Announcement on TikTok', reward: 450, timeAgo: '15 mins ago', device: 'TikTok @doctorr_ng', file: 'Proof_Verified.png', status: 'Active', autoUnlockTime: '23h 45m' },
    { id: 'sub-102', taskTitle: 'Test New Banking App Onboarding', reward: 1500, timeAgo: '2 hours ago', device: 'Samsung Galaxy A53', file: 'Screen_KYC.mp4', status: 'Active', autoUnlockTime: '21h 10m' }
  ]);

  // Paystack Deposit Modal for the 3k Drop
  const [isDepositModalOpen, setIsDepositModalOpen] = useState(false);
  const [depositChannel, setDepositChannel] = useState<'transfer' | 'card' | 'ussd'>('transfer');
  const [isProcessingDeposit, setIsProcessingDeposit] = useState(false);

  // Saved Banks with Paystack bank codes
  const [savedBanks, setSavedBanks] = useState<SavedBank[]>([
    { id: '1', bankCode: '50515', bankName: 'Moniepoint MFB', accountName: 'EMMANUEL ONUABUGHICHI', accountNumber: '8012394012', type: 'Current' },
    { id: '2', bankCode: '044', bankName: 'Access Bank PLC', accountName: 'EMMANUEL ONUABUGHICHI', accountNumber: '0816596113', type: 'Savings' }
  ]);
  const [selectedBankId, setSelectedBankId] = useState('1');

  // Paystack Withdrawal Modal Workflow
  const [isCashoutModalOpen, setIsCashoutModalOpen] = useState(false);
  const [cashoutAmount, setCashoutAmount] = useState('10000');
  const [cashoutStep, setCashoutStep] = useState<'amount' | 'otp' | 'success'>('amount');
  const [paystackOtp, setPaystackOtp] = useState('');
  const [isCashoutProcessing, setIsCashoutProcessing] = useState(false);
  const [transferRef, setTransferRef] = useState('');

  // Add Bank Modal with Live Paystack Resolution
  const [isAddBankModalOpen, setIsAddBankModalOpen] = useState(false);
  const [addBankCode, setAddBankCode] = useState('999992');
  const [addAccountNum, setAddAccountNum] = useState('');
  const [resolvedAccountName, setResolvedAccountName] = useState('');
  const [isResolvingAccount, setIsResolvingAccount] = useState(false);

  // Daily Streak Modal
  const [isStreakModalOpen, setIsStreakModalOpen] = useState(false);

  // Profile Edit fields
  const [editFirstName, setEditFirstName] = useState(user?.firstName || 'EMMANUEL');
  const [editLastName, setEditLastName] = useState(user?.lastName || 'ONUABUGHICHI');
  const [editEmail, setEditEmail] = useState(user?.email || 'emmanuelonuabughichi@gmail.com');
  const [editPhone, setEditPhone] = useState(user?.phone || '08165961134');

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
      localStorage.setItem('taskpulse_user_v5', JSON.stringify(user));
    }
  }, [user]);

  useEffect(() => {
    localStorage.setItem('taskpulse_withdrawable', withdrawableBalance.toString());
  }, [withdrawableBalance]);

  // Live Paystack NUBAN Resolution Simulation
  useEffect(() => {
    if (addAccountNum.length === 10) {
      setIsResolvingAccount(true);
      setResolvedAccountName('');
      const timer = setTimeout(() => {
        setIsResolvingAccount(false);
        setResolvedAccountName(`${user?.firstName || 'EMMANUEL'} ${user?.lastName || 'ONUABUGHICHI'}`);
      }, 700);
      return () => clearTimeout(timer);
    } else {
      setResolvedAccountName('');
    }
  }, [addAccountNum, user]);

  // Execute 3,000 Activation Drop
  const handleCompleteActivation = () => {
    setIsProcessingDeposit(true);
    setTimeout(() => {
      setIsProcessingDeposit(false);
      setIsDepositModalOpen(false);
      setIsActivated(true);
      setWithdrawableBalance(prev => prev + 3000);
      setTransactions(prev => [
        {
          id: `tx-${Date.now()}`,
          type: 'Deposit',
          title: 'Account Activation Deposit',
          sub: '100% credited to wallet via Paystack',
          amount: 3000,
          status: 'Settled',
          date: 'Just now',
          reference: `ref_tp_${Math.floor(100000 + Math.random() * 900000)}`
        },
        ...prev
      ]);
      triggerConfetti();
      showToast('Account Activated!', '₦3,000 credited to your balance. 48-hour seasoning timer initialized.');
    }, 1200);
  };

  // Instant Demo Activation
  const handleInstantDemoActivate = () => {
    setIsActivated(true);
    setWithdrawableBalance(prev => prev + 3000);
    setTransactions(prev => [
      {
        id: `tx-${Date.now()}`,
        type: 'Deposit',
        title: 'Account Activation Deposit (Demo)',
        sub: '100% credited to wallet via Paystack',
        amount: 3000,
        status: 'Settled',
        date: 'Just now',
        reference: `ref_tp_${Math.floor(100000 + Math.random() * 900000)}`
      },
      ...prev
    ]);
    triggerConfetti();
    showToast('Instant Activated!', '₦3,000 stake credited. 48-hour security seasoning timer running.');
  };

  // Withdraw Click Handler (Respects 2-Day Rule)
  const handleWithdrawClick = () => {
    if (!isActivated) {
      setIsDepositModalOpen(true);
      return;
    }

    if (isWithdrawalLocked) {
      setIsSecurityLockModalOpen(true);
    } else {
      setCashoutStep('amount');
      setIsCashoutModalOpen(true);
    }
  };

  // Override/Fast-Forward 48h Security Lock for Demo Review
  const handleFastForwardLock = () => {
    setIs48hLockOverridden(true);
    localStorage.setItem('taskpulse_48h_override', 'true');
    setIsSecurityLockModalOpen(false);
    triggerConfetti();
    showToast('48h Cooldown Bypassed!', 'Security check satisfied. Payout rails now unlocked!');
    setTimeout(() => {
      setCashoutStep('amount');
      setIsCashoutModalOpen(true);
    }, 400);
  };

  // Reset 48h Lock back to active
  const handleReactivate48hLock = () => {
    setIs48hLockOverridden(false);
    setCooldownSeconds(157335); // Reset back to ~43.7h
    localStorage.removeItem('taskpulse_48h_override');
    localStorage.setItem('taskpulse_cooldown_seconds', '157335');
    showToast('48h Security Lock Re-Engaged', 'Initial cashout cooling period is now active.');
  };

  // Claim Daily Streak
  const handleClaimDailyStreak = () => {
    if (!user) return;
    if (user.streakClaimedToday) {
      showToast('Streak Protected', '5-day streak active! 0% Paystack fees are unlocked.');
      return;
    }
    const bonus = 300;
    setWithdrawableBalance(prev => prev + bonus);
    setUser({
      ...user,
      streakDays: user.streakDays + 1,
      streakClaimedToday: true
    });
    setTransactions(prev => [
      {
        id: `tx-${Date.now()}`,
        type: 'Streak',
        title: 'Day 5 Login Multiplier',
        sub: '0% Paystack withdrawal fee active',
        amount: bonus,
        status: 'Settled',
        date: 'Just now',
        reference: `ref_tp_${Math.floor(100000 + Math.random() * 900000)}`
      },
      ...prev
    ]);
    triggerConfetti();
    showToast('🔥 +₦300 Claimed!', 'Your 5-day streak is blazing! 0% Paystack fees unlocked.');
    setIsStreakModalOpen(false);
  };

  // Start Task
  const handleStartTask = (task: Task) => {
    if (!isActivated) {
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

  // Submit Task Proof
  const handleSubmitTaskProof = () => {
    if (!activeTask) return;
    if (!taskProofInput && !uploadedScreenshot) {
      showToast('Proof Required', 'Please enter your handle/link or upload a screenshot.');
      return;
    }

    const newSub: Submission = {
      id: `sub-${Date.now()}`,
      taskTitle: activeTask.title,
      reward: activeTask.reward,
      timeAgo: 'Just now',
      device: taskProofInput ? `@${taskProofInput}` : 'Screenshot Verified',
      file: uploadedScreenshot || 'Link_Proof_Submitted',
      status: 'Active',
      autoUnlockTime: '23h 59m'
    };

    setSubmissions([newSub, ...submissions]);
    setPendingBalance(prev => prev + activeTask.reward);
    setActiveTask(null);
    setTaskProofInput('');
    setUploadedScreenshot(null);
    triggerConfetti();
    showToast('Proof Submitted', `₦${activeTask.reward} locked in escrow. 24h SLA review started.`);
  };

  // Paystack Cashout Initiation
  const handleInitiateCashout = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(cashoutAmount);

    if (amt < 2000) {
      showToast('Minimum Withdrawal is ₦2,000', 'Tiered minimum withdrawal threshold for verified earners is ₦2,000.');
      return;
    }
    if (amt > withdrawableBalance) {
      showToast('Insufficient Balance', `Available balance is ₦${withdrawableBalance.toLocaleString()}`);
      return;
    }
    if (user && amt > user.dailyCashoutLimit) {
      showToast('Daily Limit Exceeded', `Your Level ${user.level} limit is ₦${user.dailyCashoutLimit.toLocaleString()}/day.`);
      return;
    }

    setCashoutStep('otp');
    setPaystackOtp('');
  };

  // Paystack OTP Final Confirmation
  const handleConfirmPaystackOtp = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(cashoutAmount);
    setIsCashoutProcessing(true);

    setTimeout(() => {
      setWithdrawableBalance(prev => prev - amt);
      setIsCashoutProcessing(false);
      const ref = `TRF_pstk_${Math.random().toString(36).substring(2, 9)}`;
      setTransferRef(ref);
      setTransactions(prev => [
        {
          id: `tx-${Date.now()}`,
          type: 'Cashout',
          title: `Cashout to ${selectedBank.bankName}`,
          sub: `NIP Transfer to ${selectedBank.accountNumber}`,
          amount: amt,
          status: 'Disbursed',
          date: 'Just now',
          reference: ref
        },
        ...prev
      ]);
      setCashoutStep('success');
      triggerConfetti();
    }, 1500);
  };

  // Add Bank
  const handleAddBank = (e: React.FormEvent) => {
    e.preventDefault();
    if (addAccountNum.length !== 10) {
      showToast('Invalid NUBAN', 'Please enter a valid 10-digit NUBAN account.');
      return;
    }
    const bankMeta = PAYSTACK_BANKS.find(b => b.code === addBankCode) || PAYSTACK_BANKS[0];
    const newBank: SavedBank = {
      id: `bank-${Date.now()}`,
      bankCode: bankMeta.code,
      bankName: bankMeta.name,
      accountName: resolvedAccountName || `${user?.firstName || 'EMMANUEL'} ${user?.lastName || 'ONUABUGHICHI'}`,
      accountNumber: addAccountNum,
      type: 'Savings'
    };
    setSavedBanks([...savedBanks, newBank]);
    setSelectedBankId(newBank.id);
    setIsAddBankModalOpen(false);
    setAddAccountNum('');
    triggerConfetti();
    showToast('Paystack Recipient Saved', `${newBank.bankName} verified & linked for instant payouts.`);
  };

  // Save Profile
  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setUser({
      ...user,
      firstName: editFirstName,
      lastName: editLastName,
      email: editEmail,
      phone: editPhone
    });
    triggerConfetti();
    showToast('Profile Updated', 'Your profile details have been saved successfully.');
  };

  const selectedBank = savedBanks.find(b => b.id === selectedBankId) || savedBanks[0];

  return (
    <div className={`h-screen w-full overflow-hidden flex flex-col items-center justify-center p-0 md:p-3 select-none transition-colors duration-300 ${isDarkMode ? 'dark bg-[#070709] text-white' : 'bg-[#f4f6f8] text-slate-900'}`}>
      
      {/* AMBIENT AURORA BACKGROUND GLOWS */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-[-10%] right-[-10%] w-[550px] h-[550px] rounded-full bg-cyan-500/10 dark:bg-cyan-500/15 blur-[140px] animate-float-slow"></div>
        <div className="absolute bottom-[-10%] left-[-10%] w-[650px] h-[650px] rounded-full bg-blue-600/10 dark:bg-sky-500/10 blur-[150px] animate-float-slow [animation-delay:2.5s]"></div>
      </div>

      {/* PHONE CANVAS CONTAINER (Revolut / LeadsAfrica Ultra-Chic Frame) */}
      <div className="relative z-10 w-full max-w-md h-full md:max-h-[852px] bg-white dark:bg-[#0c0d12] md:rounded-[46px] shadow-2xl md:border md:border-slate-200/90 dark:md:border-white/[0.08] overflow-hidden flex flex-col transition-colors duration-300">
        
        {/* ======================================================== */}
        {/* TOP STATUS BAR & HEADER                                  */}
        {/* ======================================================== */}
        <header className="px-5 py-3.5 bg-white/95 dark:bg-[#0c0d12]/95 backdrop-blur-xl border-b border-slate-100 dark:border-white/[0.06] flex items-center justify-between shrink-0 z-40 transition-colors">
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
                  FinTech Bounties
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

            {/* Profile Avatar Pill */}
            <button 
              onClick={() => setActiveTab('profile')}
              className="flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-2xl bg-sky-50 dark:bg-zinc-900 border border-sky-200 dark:border-white/[0.08] hover:border-sky-400 transition-all"
            >
              <div className="w-6 h-6 rounded-xl bg-gradient-to-tr from-sky-500 to-cyan-400 text-white flex items-center justify-center text-[10px] font-black shadow-xs">
                {user?.username.slice(0, 1)}
              </div>
              <span className="text-[11px] font-bold text-sky-600 dark:text-zinc-200 max-w-[70px] truncate">
                @{user?.username}
              </span>
            </button>
          </div>
        </header>

        {/* ======================================================== */}
        {/* LIVE SOCIAL PROOF TICKER                                 */}
        {/* ======================================================== */}
        <div className="bg-sky-50/70 dark:bg-zinc-950/80 border-b border-sky-100 dark:border-white/[0.04] px-3 py-1.5 overflow-hidden shrink-0 flex items-center">
          <div className="flex items-center gap-1.5 shrink-0 pr-3 border-r border-sky-200 dark:border-white/10">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-[9px] font-black uppercase tracking-wider text-sky-700 dark:text-cyan-400">Verified Payouts</span>
          </div>
          <div className="overflow-hidden flex-1 pl-3">
            <div className="animate-marquee whitespace-nowrap flex items-center gap-6 text-[11px] font-medium text-slate-600 dark:text-zinc-300">
              {LIVE_COMMUNITY_PAYOUTS.map((item, idx) => (
                <span key={idx} className="flex items-center gap-1.5">
                  <strong className="text-sky-600 dark:text-cyan-400 font-bold">{item.user}</strong>
                  <span>{item.action}</span>
                  <span className="px-1.5 py-0.2 rounded-md bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 text-[9px] font-mono font-bold">✓ {item.bank}</span>
                  <span className="text-[9px] text-slate-400 dark:text-zinc-500">({item.time})</span>
                  <span className="text-slate-300 dark:text-zinc-700">•</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ======================================================== */}
        {/* MAIN SCROLLABLE APP BODY                                 */}
        {/* ======================================================== */}
        <div className="flex-1 overflow-y-auto no-scrollbar flex flex-col p-4 space-y-4">

          {/* ======================================================== */}
          {/* MANDATORY ₦3,000 ACTIVATION STAKE GATEKEEPER             */}
          {/* ======================================================== */}
          {!isActivated ? (
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
                  A minimum deposit of ₦3,000 is required before starting. 100% credited to your wallet balance.
                </p>
              </div>

              {/* CLEAN SIMPLE 3-ROW CARD */}
              <div className="w-full bg-white dark:bg-zinc-900/80 border border-slate-100 dark:border-white/[0.08] rounded-3xl p-5 shadow-xl text-left space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-slate-600 dark:text-zinc-400">
                  <span>Activation Stake Required:</span>
                  <span className="font-mono text-base font-black text-slate-900 dark:text-white">₦3,000</span>
                </div>
                <div className="flex items-center justify-between text-xs font-bold text-emerald-600 dark:text-emerald-400">
                  <span>Credited to Your Balance:</span>
                  <span className="font-mono text-base font-black">+₦3,000.00</span>
                </div>
                <div className="pt-2 border-t border-slate-100 dark:border-zinc-800 flex items-center justify-between text-[11px] text-slate-500 dark:text-zinc-400 font-semibold">
                  <span>Paystack Instant Rails:</span>
                  <span className="text-cyan-500 font-black uppercase">UNLOCKED ✓</span>
                </div>
              </div>

              {/* SIMPLE ACTION BUTTONS */}
              <div className="w-full space-y-2.5 pt-1">
                <button 
                  onClick={() => setIsDepositModalOpen(true)}
                  className="w-full h-12 rounded-full bg-gradient-to-r from-sky-500 via-cyan-500 to-blue-600 hover:opacity-95 text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-sky-500/25 active:scale-98 transition-all flex items-center justify-center gap-2"
                >
                  <CreditCard className="w-4 h-4" />
                  <span>Drop ₦3,000 via Paystack</span>
                </button>

                <button 
                  onClick={handleInstantDemoActivate}
                  className="w-full h-11 rounded-full bg-slate-100 dark:bg-zinc-900 border border-slate-200/60 dark:border-white/[0.08] hover:bg-slate-200 dark:hover:bg-zinc-800 text-slate-700 dark:text-zinc-200 font-bold text-xs flex items-center justify-center gap-1.5 transition-all"
                >
                  <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Instant 1-Tap Activate (Demo Test)</span>
                </button>
              </div>

              <div className="inline-flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-zinc-500 font-semibold">
                <Shield className="w-3.5 h-3.5 text-emerald-500" />
                <span>Secured 256-bit encryption by Paystack</span>
              </div>

            </div>
          ) : (
            <>
              {/* ======================================================== */}
              {/* TAB 1: HOME (Hero Balance, Streak, Payout Ticker)        */}
              {/* ======================================================== */}
              {activeTab === 'home' && (
                <div className="space-y-4 animate-in fade-in duration-300">
                  
                  {/* ULTRA-PREMIUM OBSIDIAN / REVOLUT BLACK CARD */}
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
                        {/* Contactless RFID waves symbol */}
                        <span className="text-zinc-500 font-mono text-[10px]">))))</span>
                        <span className="text-[10px] font-mono tracking-widest uppercase text-zinc-400">
                          TASKPULSE BLACK
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className="px-2 py-0.5 rounded-full bg-white/[0.08] border border-white/10 text-[9px] font-mono font-bold tracking-wider text-cyan-300 uppercase">
                          LEVEL 2 VERIFIED
                        </span>
                      </div>
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
                        <span className="text-[10px] font-mono text-zinc-400">
                          ₦20k Daily Limit
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
                          <span>0% Paystack Fee Active</span>
                        </div>
                      </div>
                    </div>

                    {/* CARD QUICK ACTIONS (Deposit, Withdraw, Streak, Ledger) */}
                    <div className="relative z-10 grid grid-cols-4 gap-2 pt-3 border-t border-white/[0.08]">
                      
                      {/* Fund / 3k Drop */}
                      <button 
                        onClick={() => setIsDepositModalOpen(true)}
                        className="py-2 px-1 bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 text-white rounded-2xl text-[11px] font-bold transition-all flex flex-col items-center justify-center gap-1 active:scale-95"
                      >
                        <Plus className="w-4 h-4 text-cyan-400" />
                        <span>Fund</span>
                      </button>

                      {/* Cashout (Under 2-day security rule) */}
                      <button 
                        onClick={handleWithdrawClick}
                        className={`py-2 px-1 rounded-2xl text-[11px] font-bold transition-all flex flex-col items-center justify-center gap-1 active:scale-95 shadow-md ${
                          isWithdrawalLocked
                            ? 'bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300'
                            : 'bg-gradient-to-tr from-cyan-500 to-sky-500 text-white'
                        }`}
                      >
                        {isWithdrawalLocked ? (
                          <>
                            <LockKeyhole className="w-4 h-4 text-amber-400" />
                            <span>Cashout (48h)</span>
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

                      {/* Double-Entry Ledger */}
                      <button 
                        onClick={() => setIsLedgerModalOpen(true)}
                        className="py-2 px-1 bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 text-white rounded-2xl text-[11px] font-bold transition-all flex flex-col items-center justify-center gap-1 active:scale-95"
                      >
                        <FileText className="w-4 h-4 text-emerald-400" />
                        <span>Ledger</span>
                      </button>
                    </div>

                  </div>

                  {/* ======================================================== */}
                  {/* RULE REQUIREMENT: 48-HOUR (2-DAY) SECURITY LOCK WIDGET  */}
                  {/* ======================================================== */}
                  <div className={`rounded-3xl p-4 border transition-all ${
                    isWithdrawalLocked 
                      ? 'bg-amber-50/70 dark:bg-zinc-900/90 border-amber-200 dark:border-amber-500/30 shadow-md shadow-amber-500/5' 
                      : 'bg-emerald-50/70 dark:bg-zinc-900/90 border-emerald-200 dark:border-emerald-500/30'
                  }`}>
                    
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 ${
                          isWithdrawalLocked 
                            ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400' 
                            : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'
                        }`}>
                          {isWithdrawalLocked ? <Lock className="w-4 h-4" /> : <BadgeCheck className="w-5 h-5" />}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <h4 className="text-xs font-black text-slate-900 dark:text-white leading-tight">
                              {isWithdrawalLocked ? '48h First Cashout Security Lock' : '48h Security Seasoning Completed'}
                            </h4>
                            <span className={`text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded-md ${
                              isWithdrawalLocked 
                                ? 'bg-amber-200/60 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300' 
                                : 'bg-emerald-200/60 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300'
                            }`}>
                              {isWithdrawalLocked ? 'Anti-Fraud Active' : 'Unlocked ✓'}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-500 dark:text-zinc-400 mt-0.5">
                            {isWithdrawalLocked 
                              ? 'Mandatory 2-day cooling window following ₦3k activation deposit.'
                              : 'Your account is fully seasoned. Paystack direct transfers are ready.'}
                          </p>
                        </div>
                      </div>

                      {/* FAST FORWARD OR RESET DEMO TOGGLE */}
                      <button 
                        onClick={isWithdrawalLocked ? handleFastForwardLock : handleReactivate48hLock}
                        className="px-2.5 py-1 rounded-xl text-[10px] font-black border transition-all shrink-0 bg-white dark:bg-zinc-800 hover:scale-105 active:scale-95 text-sky-600 dark:text-cyan-400 border-sky-200 dark:border-white/10 shadow-xs"
                        title="Toggle 48h Lock State for Demo Review"
                      >
                        {isWithdrawalLocked ? '⚡ Fast-Forward' : '↺ Reset 48h'}
                      </button>
                    </div>

                    {/* LIVE 4-SEGMENT COUNTDOWN DISPLAY */}
                    {isWithdrawalLocked && (
                      <div className="mt-3 pt-3 border-t border-amber-200/60 dark:border-white/[0.06] space-y-2">
                        <div className="grid grid-cols-4 gap-2 text-center font-mono">
                          <div className="p-1.5 rounded-xl bg-white dark:bg-zinc-800/80 border border-amber-200/80 dark:border-white/10">
                            <span className="text-base font-black text-amber-600 dark:text-amber-400 block leading-none">
                              {countdownParts.d}
                            </span>
                            <span className="text-[8px] font-bold text-slate-400 uppercase mt-0.5 block">Days</span>
                          </div>
                          <div className="p-1.5 rounded-xl bg-white dark:bg-zinc-800/80 border border-amber-200/80 dark:border-white/10">
                            <span className="text-base font-black text-amber-600 dark:text-amber-400 block leading-none">
                              {countdownParts.h}
                            </span>
                            <span className="text-[8px] font-bold text-slate-400 uppercase mt-0.5 block">Hours</span>
                          </div>
                          <div className="p-1.5 rounded-xl bg-white dark:bg-zinc-800/80 border border-amber-200/80 dark:border-white/10">
                            <span className="text-base font-black text-amber-600 dark:text-amber-400 block leading-none">
                              {countdownParts.m}
                            </span>
                            <span className="text-[8px] font-bold text-slate-400 uppercase mt-0.5 block">Mins</span>
                          </div>
                          <div className="p-1.5 rounded-xl bg-white dark:bg-zinc-800/80 border border-amber-200/80 dark:border-white/10">
                            <span className="text-base font-black text-amber-600 dark:text-amber-400 block leading-none animate-pulse">
                              {countdownParts.s}
                            </span>
                            <span className="text-[8px] font-bold text-slate-400 uppercase mt-0.5 block">Secs</span>
                          </div>
                        </div>

                        {/* PROGRESS BAR */}
                        <div className="w-full bg-amber-200/50 dark:bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                          <div 
                            className="bg-gradient-to-r from-amber-500 to-yellow-400 h-full rounded-full transition-all duration-500" 
                            style={{ width: `${progressPercent}%` }}
                          ></div>
                        </div>
                        <div className="flex justify-between text-[10px] text-slate-400 dark:text-zinc-500 font-semibold">
                          <span>Seasoning: {progressPercent}% Complete</span>
                          <span>Unlocks: Tomorrow 11:20 AM</span>
                        </div>
                      </div>
                    )}
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
                        {user?.streakClaimedToday ? 'Claimed ✓' : 'Claim ₦300'}
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

                  {/* FEATURED MICRO-TASKS */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-zinc-300">
                        Top Micro-Tasks For You
                      </h3>
                      <button 
                        onClick={() => setActiveTab('tasks')}
                        className="text-xs font-bold text-cyan-500 hover:underline flex items-center gap-0.5"
                      >
                        <span>View All ({tasksList.length})</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="space-y-2">
                      {tasksList.slice(0, 2).map(task => (
                        <div 
                          key={task.id}
                          onClick={() => setSelectedTaskForModal(task)}
                          className="bg-white dark:bg-zinc-900/80 border border-slate-100 dark:border-white/[0.08] rounded-2xl p-3.5 hover:border-cyan-400/50 transition-all cursor-pointer shadow-xs flex items-center justify-between gap-3 group"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-2xl bg-sky-50 dark:bg-zinc-800 text-xl flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                              {task.platformIcon || '⚡'}
                            </div>
                            <div className="space-y-0.5">
                              <span className="text-[10px] font-bold text-sky-600 dark:text-cyan-400 uppercase">
                                {task.company}
                              </span>
                              <h4 className="text-xs font-bold text-slate-900 dark:text-white leading-snug line-clamp-1">
                                {task.title}
                              </h4>
                              <div className="flex items-center gap-2 text-[10px] text-slate-400 dark:text-zinc-500">
                                <span>⏱ {task.time}</span>
                                <span>·</span>
                                <span className="font-mono">{task.spotsLeft} spots remaining</span>
                              </div>
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <span className="text-sm font-black font-mono text-emerald-600 dark:text-emerald-400">
                              +₦{task.reward}
                            </span>
                            <span className="text-[9px] block text-slate-400 dark:text-zinc-500 uppercase font-semibold">
                              Instant Escrow
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                </div>
              )}

              {/* ======================================================== */}
              {/* TAB 2: TASKS MARKETPLACE & WORKSPACE                     */}
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

                        <button 
                          onClick={() => {
                            setUploadedScreenshot('Screenshot_Verified.png');
                            showToast('Screenshot Attached', 'Device telemetry validated.');
                          }}
                          className="w-full py-1.5 px-2 bg-white/15 hover:bg-white/25 rounded-xl text-[10px] font-bold text-white flex items-center justify-center gap-1"
                        >
                          <Camera className="w-3.5 h-3.5 text-cyan-300" />
                          <span>{uploadedScreenshot ? 'Screenshot Attached ✓' : 'Upload Verification Screenshot'}</span>
                        </button>
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

                  {/* CATEGORY FILTERS */}
                  <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                    {(['all', 'Social', 'App Tests', 'Surveys', 'Field Audits'] as const).map(cat => (
                      <button 
                        key={cat}
                        onClick={() => setTaskFilter(cat)}
                        className={`px-3.5 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
                          taskFilter === cat 
                            ? 'bg-sky-600 text-white shadow-md shadow-sky-600/20' 
                            : 'bg-white dark:bg-zinc-900 border border-slate-200 dark:border-white/[0.08] text-slate-600 dark:text-zinc-300'
                        }`}
                      >
                        {cat === 'all' ? 'All Tasks' : cat}
                      </button>
                    ))}
                  </div>

                  {/* TASKS LIST */}
                  <div className="space-y-3">
                    {tasksList
                      .filter(t => taskFilter === 'all' || t.category === taskFilter)
                      .map(task => (
                        <div 
                          key={task.id}
                          className="bg-white dark:bg-zinc-900/80 border border-slate-100 dark:border-white/[0.08] rounded-3xl p-4 shadow-sm hover:border-cyan-400/50 transition-all space-y-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-2.5">
                              <div className="w-10 h-10 rounded-2xl bg-sky-50 dark:bg-zinc-800 text-xl flex items-center justify-center shrink-0">
                                {task.platformIcon || '⚡'}
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
                                ₦{task.reward}
                              </span>
                              <span className="text-[8px] block text-slate-400 dark:text-zinc-500 uppercase font-bold">
                                Escrowed
                              </span>
                            </div>
                          </div>

                          <p className="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed line-clamp-2">
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
                  </div>

                </div>
              )}

              {/* ======================================================== */}
              {/* TAB 3: ADS / SPONSORED TASKS                             */}
              {/* ======================================================== */}
              {activeTab === 'ads' && (
                <div className="space-y-4 animate-in fade-in duration-300">
                  <div className="p-4 rounded-3xl bg-gradient-to-br from-indigo-900 to-sky-900 text-white space-y-1 shadow-md">
                    <span className="text-[10px] font-black uppercase tracking-wider text-cyan-300">Sponsored Brand Rewards</span>
                    <h3 className="text-sm font-black">Watch, Follow &amp; Earn Instant Cash</h3>
                    <p className="text-[11px] text-sky-200">High-volume sponsored micro-jobs with instant approval.</p>
                  </div>

                  {[
                    { id: 'ad1', title: 'Watch 30s FinTech Demo Video', sponsor: 'PaySwitch Africa', reward: 180, time: '30s' },
                    { id: 'ad2', title: 'Join Official Telegram Community', sponsor: 'BitPulse Global', reward: 220, time: '1m' }
                  ].map(ad => (
                    <div key={ad.id} className="bg-white dark:bg-zinc-900/80 border border-slate-100 dark:border-white/[0.08] rounded-3xl p-4 shadow-sm flex items-center justify-between">
                      <div>
                        <span className="text-[10px] font-bold text-cyan-500 uppercase">{ad.sponsor}</span>
                        <h4 className="text-xs font-bold text-slate-900 dark:text-white mt-0.5">{ad.title}</h4>
                        <span className="text-[10px] text-slate-400 dark:text-zinc-500">Duration: {ad.time}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-sm font-black font-mono text-emerald-600 dark:text-emerald-400 block">+₦{ad.reward}</span>
                        <button 
                          onClick={() => {
                            setWithdrawableBalance(prev => prev + ad.reward);
                            setTransactions(prev => [
                              {
                                id: `tx-${Date.now()}`,
                                type: 'Payout',
                                title: ad.title,
                                sub: `${ad.sponsor} instant settlement`,
                                amount: ad.reward,
                                status: 'Settled',
                                date: 'Just now',
                                reference: `ref_tp_${Math.floor(100000 + Math.random() * 900000)}`
                              },
                              ...prev
                            ]);
                            triggerConfetti();
                            showToast(`+₦${ad.reward} Earned!`, `Reward settled from ${ad.sponsor}.`);
                          }}
                          className="px-3 py-1 rounded-full bg-cyan-500 text-white text-[11px] font-bold mt-1"
                        >
                          Claim
                        </button>
                      </div>
                    </div>
                  ))}
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

                      {/* Cyan handle */}
                      <span className="text-sm font-black text-sky-500 dark:text-cyan-400 tracking-wide">
                        @{user?.username}
                      </span>
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

                      {/* Electric Blue Button (Screenshot 1 Match) */}
                      <button 
                        type="submit"
                        className="w-full h-11 rounded-full bg-gradient-to-r from-sky-400 via-sky-500 to-blue-600 hover:opacity-95 text-white font-bold text-xs shadow-lg shadow-sky-500/25 transition-all active:scale-[0.98] mt-2"
                      >
                        Save Profile Details
                      </button>
                    </form>

                  </div>

                  {/* ACCOUNT STATUS CARD (Screenshot 1 Match) */}
                  <div className="bg-white dark:bg-zinc-900/80 border border-slate-100 dark:border-white/[0.08] rounded-3xl p-4 shadow-sm flex items-center gap-3.5">
                    <div className="w-11 h-11 rounded-2xl bg-cyan-50 dark:bg-cyan-950/40 border border-cyan-100 dark:border-cyan-800/60 flex items-center justify-center text-cyan-500 text-xl shadow-xs">
                      <Shield className="w-6 h-6 text-cyan-500" />
                    </div>
                    <div>
                      <span className="text-[11px] font-semibold text-slate-400 dark:text-zinc-500 block leading-none">
                        Account Status
                      </span>
                      <h4 className="text-sm font-black text-slate-900 dark:text-white mt-1">
                        Fully Verified
                      </h4>
                    </div>
                    <div className="ml-auto">
                      <span className="px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400 text-[10px] font-black uppercase">
                        Level 2 KYC
                      </span>
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
                        className="text-xs font-bold text-cyan-500 hover:underline"
                      >
                        + Add Bank
                      </button>
                    </div>

                    <div className="space-y-2">
                      {savedBanks.map(b => (
                        <div key={b.id} className="p-3 rounded-2xl border border-slate-100 dark:border-white/[0.06] bg-slate-50/50 dark:bg-zinc-800/40 flex items-center justify-between">
                          <div>
                            <span className="text-xs font-black text-slate-900 dark:text-white block">{b.bankName}</span>
                            <span className="text-[10px] font-mono text-slate-400 dark:text-zinc-400">{b.accountName} · •••• {b.accountNumber.slice(-4)}</span>
                          </div>
                          <span className="px-2 py-0.5 rounded-full bg-sky-50 dark:bg-zinc-800 text-sky-600 dark:text-cyan-400 text-[9px] font-bold">
                            Active
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* Reset Activation Test Trigger */}
                    <div className="pt-2 border-t border-slate-100 dark:border-white/[0.06] flex items-center justify-between">
                      <span className="text-[11px] text-slate-400 dark:text-zinc-500 font-medium">Test ₦3,000 Activation Gate</span>
                      <button 
                        onClick={() => {
                          setIsActivated(false);
                          showToast('Lock Screen Enabled', 'Now testing the ₦3,000 activation deposit screen.');
                        }}
                        className="px-2.5 py-1 rounded-full bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 text-[10px] font-bold"
                      >
                        Lock Account
                      </button>
                    </div>
                  </div>

                </div>
              )}
            </>
          )}

        </div>

        {/* ======================================================== */}
        {/* BOTTOM NAVIGATION (Screenshot 1 Floating Pill Match)     */}
        {/* ======================================================== */}
        <nav className="bg-white/95 dark:bg-[#0c0d12]/95 backdrop-blur-xl border-t border-slate-100 dark:border-white/[0.06] px-4 py-2 shrink-0 z-40 flex items-center justify-around transition-colors">
          
          <button 
            onClick={() => setActiveTab('home')}
            className={`flex flex-col items-center gap-1 py-1 px-3 rounded-2xl transition-all ${
              activeTab === 'home' 
                ? 'bg-sky-50 dark:bg-zinc-800 text-sky-500 dark:text-cyan-400 font-black' 
                : 'text-slate-400 hover:text-slate-600 dark:text-zinc-500 dark:hover:text-zinc-200'
            }`}
          >
            <Compass className="w-5 h-5" />
            <span className="text-[10px] font-extrabold tracking-tight">Home</span>
          </button>

          <button 
            onClick={() => setActiveTab('tasks')}
            className={`flex flex-col items-center gap-1 py-1 px-3 rounded-2xl relative transition-all ${
              activeTab === 'tasks' 
                ? 'bg-sky-50 dark:bg-zinc-800 text-sky-500 dark:text-cyan-400 font-black' 
                : 'text-slate-400 hover:text-slate-600 dark:text-zinc-500 dark:hover:text-zinc-200'
            }`}
          >
            <div className="relative">
              <CheckSquare className="w-5 h-5" />
              {tasksList.length > 0 && (
                <span className="absolute -top-1 -right-1.5 w-3.5 h-3.5 rounded-full bg-cyan-500 text-white text-[8px] font-black flex items-center justify-center">
                  {tasksList.length}
                </span>
              )}
            </div>
            <span className="text-[10px] font-extrabold tracking-tight">Tasks</span>
          </button>

          <button 
            onClick={() => setActiveTab('ads')}
            className={`flex flex-col items-center gap-1 py-1 px-3 rounded-2xl relative transition-all ${
              activeTab === 'ads' 
                ? 'bg-sky-50 dark:bg-zinc-800 text-sky-500 dark:text-cyan-400 font-black' 
                : 'text-slate-400 hover:text-slate-600 dark:text-zinc-500 dark:hover:text-zinc-200'
            }`}
          >
            <div className="relative">
              <Megaphone className="w-5 h-5" />
              <span className="absolute -top-1 -right-2 px-1 py-0.2 rounded-full bg-amber-500 text-white text-[7px] font-black uppercase">
                Hot
              </span>
            </div>
            <span className="text-[10px] font-extrabold tracking-tight">Ads</span>
          </button>

          <button 
            onClick={() => setActiveTab('profile')}
            className={`flex flex-col items-center gap-1 py-1 px-4 rounded-full transition-all ${
              activeTab === 'profile' 
                ? 'bg-cyan-50 dark:bg-zinc-800 text-cyan-600 dark:text-cyan-400 font-black' 
                : 'text-slate-400 hover:text-slate-600 dark:text-zinc-500 dark:hover:text-zinc-200'
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
      {/* MODAL: 48-HOUR FIRST CASHOUT SECURITY LOCK SCREEN        */}
      {/* ======================================================== */}
      {isSecurityLockModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-[#111218] border border-amber-300 dark:border-amber-500/30 rounded-3xl max-w-sm w-full p-6 space-y-5 shadow-2xl text-center relative overflow-hidden">
            
            {/* Top Amber Halo */}
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
                <span>Seasoning: <strong className="text-amber-500 font-mono">{progressPercent}%</strong></span>
              </div>
            </div>

            {/* ACTION BUTTONS */}
            <div className="space-y-2 pt-1">
              <button 
                onClick={handleFastForwardLock}
                className="w-full h-11 rounded-full bg-gradient-to-r from-amber-500 to-yellow-500 hover:opacity-95 text-slate-950 font-black text-xs uppercase tracking-wider shadow-lg shadow-amber-500/20 active:scale-95 transition-all flex items-center justify-center gap-1.5"
              >
                <Zap className="w-4 h-4 fill-current" />
                <span>Fast-Forward 48h (Demo Test Cashout)</span>
              </button>

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

            {/* Channels: Bank Transfer / Card / USSD */}
            <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 dark:bg-zinc-800/80 rounded-2xl">
              <button 
                onClick={() => setDepositChannel('transfer')}
                className={`py-1.5 text-xs font-bold rounded-xl transition-all ${
                  depositChannel === 'transfer' ? 'bg-white dark:bg-zinc-900 text-sky-600 dark:text-cyan-400 shadow-xs' : 'text-slate-500'
                }`}
              >
                Transfer
              </button>
              <button 
                onClick={() => setDepositChannel('card')}
                className={`py-1.5 text-xs font-bold rounded-xl transition-all ${
                  depositChannel === 'card' ? 'bg-white dark:bg-zinc-900 text-sky-600 dark:text-cyan-400 shadow-xs' : 'text-slate-500'
                }`}
              >
                Card
              </button>
              <button 
                onClick={() => setDepositChannel('ussd')}
                className={`py-1.5 text-xs font-bold rounded-xl transition-all ${
                  depositChannel === 'ussd' ? 'bg-white dark:bg-zinc-900 text-sky-600 dark:text-cyan-400 shadow-xs' : 'text-slate-500'
                }`}
              >
                USSD
              </button>
            </div>

            {depositChannel === 'transfer' && (
              <div className="p-3.5 bg-slate-50 dark:bg-zinc-800/60 rounded-2xl space-y-2 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400">Pay To Bank:</span>
                  <span className="text-slate-900 dark:text-white font-black">Wema Bank / Paystack</span>
                </div>
                <div className="flex justify-between items-center font-bold">
                  <span className="text-slate-400">Account No:</span>
                  <span className="font-mono font-black text-sm text-[#0ba4db]">9928301928</span>
                </div>
                <div className="flex justify-between items-center font-bold">
                  <span className="text-slate-400">Beneficiary:</span>
                  <span className="text-slate-900 dark:text-white font-bold">TaskPulse / Paystack</span>
                </div>
              </div>
            )}

            {depositChannel === 'card' && (
              <div className="space-y-2 text-left text-xs">
                <input 
                  type="text" 
                  defaultValue="5399 8291 0029 4810"
                  className="w-full h-10 px-3 rounded-xl bg-slate-50 dark:bg-zinc-800 border font-mono text-xs focus:outline-none"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" defaultValue="08/29" className="h-10 px-3 rounded-xl bg-slate-50 dark:bg-zinc-800 border font-mono text-xs focus:outline-none" />
                  <input type="text" defaultValue="729" className="h-10 px-3 rounded-xl bg-slate-50 dark:bg-zinc-800 border font-mono text-xs focus:outline-none" />
                </div>
              </div>
            )}

            {depositChannel === 'ussd' && (
              <div className="p-3 bg-slate-50 dark:bg-zinc-800 rounded-2xl text-center text-xs font-bold space-y-1">
                <span className="text-slate-400 block text-[11px]">Dial on your registered phone:</span>
                <span className="text-base font-black font-mono text-[#0ba4db] block">*737*50*3000*1928#</span>
              </div>
            )}

            <button 
              onClick={handleCompleteActivation}
              disabled={isProcessingDeposit}
              className="w-full h-12 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-emerald-500/20 active:scale-95 transition-all flex items-center justify-center gap-1.5"
            >
              {isProcessingDeposit ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                  <span>Confirming Paystack Deposit...</span>
                </>
              ) : (
                <span>I Have Sent ₦3,000 (Activate Account)</span>
              )}
            </button>

          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: PAYSTACK CASHOUT (Rules: Min 2k, 0% streak fee)  */}
      {/* ======================================================== */}
      {isCashoutModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-[#111218] border border-slate-200 dark:border-white/[0.08] rounded-3xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
            
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-black text-cyan-500 uppercase tracking-wider">Paystack Direct Transfers</span>
                <h3 className="text-base font-black text-slate-900 dark:text-white mt-0.5">
                  {cashoutStep === 'amount' ? 'Instant Bank Cashout' : cashoutStep === 'otp' ? 'Paystack 2FA Authorization' : 'Transfer Disbursed!'}
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
                    <span className="font-mono text-emerald-600 dark:text-emerald-400">Min: ₦2,000 · Max: ₦{user?.dailyCashoutLimit.toLocaleString()}</span>
                  </div>
                  <div className="flex gap-2">
                    <input 
                      type="number"
                      min={2000}
                      max={user?.dailyCashoutLimit || 20000}
                      value={cashoutAmount}
                      onChange={e => setCashoutAmount(e.target.value)}
                      className="flex-1 h-11 px-4 rounded-full bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-white/[0.08] text-xs font-bold font-mono focus:outline-none"
                      required
                    />
                    <button 
                      type="button"
                      onClick={() => setCashoutAmount(Math.min(withdrawableBalance, user?.dailyCashoutLimit || 20000).toString())}
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
                    <span>Net Disbursed to {selectedBank.bankName}:</span>
                    <span className="font-mono text-emerald-600 dark:text-emerald-400">₦{parseFloat(cashoutAmount || '0').toLocaleString()}</span>
                  </div>
                </div>

                <button 
                  type="submit"
                  className="w-full h-11 rounded-full bg-gradient-to-r from-sky-500 to-blue-600 text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-sky-500/25 active:scale-95 transition-all mt-1"
                >
                  Proceed to Paystack 2FA Authorization
                </button>
              </form>
            )}

            {cashoutStep === 'otp' && (
              <form onSubmit={handleConfirmPaystackOtp} className="space-y-4">
                <div className="p-3 bg-sky-50 dark:bg-cyan-950/40 rounded-2xl text-center space-y-1">
                  <KeyRound className="w-7 h-7 text-cyan-500 mx-auto" />
                  <p className="text-xs font-bold text-slate-900 dark:text-white">Transfer Authorization Required</p>
                  <p className="text-[11px] text-slate-500 dark:text-zinc-400">
                    Enter the 4-digit Paystack OTP sent to <strong className="font-mono">{user?.phone}</strong>
                  </p>
                </div>

                <div className="space-y-1">
                  <input 
                    type="text"
                    maxLength={4}
                    value={paystackOtp}
                    onChange={e => setPaystackOtp(e.target.value.replace(/\D/g, ''))}
                    placeholder="••••"
                    className="w-full h-12 text-center text-xl tracking-[0.5em] font-mono font-black rounded-2xl bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-white/[0.08] focus:outline-none"
                    required
                  />
                  <button 
                    type="button" 
                    onClick={() => setPaystackOtp('7821')}
                    className="text-[11px] font-bold text-cyan-500 block mx-auto hover:underline pt-1"
                  >
                    Auto-Fill Demo Code (7821)
                  </button>
                </div>

                <div className="flex gap-2">
                  <button 
                    type="button"
                    onClick={() => setCashoutStep('amount')}
                    className="flex-1 h-11 rounded-full border border-slate-200 dark:border-white/[0.08] text-xs font-bold text-slate-500"
                  >
                    Back
                  </button>
                  <button 
                    type="submit"
                    disabled={isCashoutProcessing}
                    className="flex-2 h-11 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-bold text-xs uppercase tracking-wider shadow-md"
                  >
                    {isCashoutProcessing ? 'Disbursing via NIP...' : 'Confirm & Disburse'}
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
                    ₦{parseFloat(cashoutAmount).toLocaleString()} sent to {selectedBank.bankName} ({selectedBank.accountNumber}).
                  </p>
                </div>

                <div className="p-3 rounded-2xl bg-slate-50 dark:bg-zinc-800/80 font-mono text-[11px] space-y-1 text-left border border-slate-200 dark:border-white/[0.08]">
                  <div className="flex justify-between">
                    <span className="text-slate-400 dark:text-zinc-500">Paystack Ref:</span>
                    <span className="font-bold text-slate-900 dark:text-white">{transferRef}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400 dark:text-zinc-500">Channel:</span>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">NIP Direct Rail</span>
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
                      <span className="text-[8px] font-mono px-1.5 py-0.2 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 uppercase font-black">
                        {tx.status}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-400 dark:text-zinc-500 mt-0.5">{tx.sub} · {tx.date}</p>
                    <p className="text-[9px] font-mono text-cyan-600 dark:text-cyan-400">{tx.reference}</p>
                  </div>
                  <span className={`font-mono font-black text-sm ${tx.type === 'Cashout' ? 'text-rose-500' : 'text-emerald-600 dark:text-emerald-400'}`}>
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
      {/* MODAL: ADD BANK WITH LIVE PAYSTACK NUBAN RESOLUTION     */}
      {/* ======================================================== */}
      {isAddBankModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-[#111218] border border-slate-200 dark:border-white/[0.08] rounded-3xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <span className="text-[10px] font-black text-cyan-500 uppercase tracking-wider">Paystack Bank Resolve API</span>
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
                    <span>Resolving with Paystack API...</span>
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
                Save &amp; Verify with Paystack
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
              {user?.streakClaimedToday ? 'Already Claimed Today ✓' : 'Claim Day 5 Reward (₦300)'}
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

    </div>
  );
}

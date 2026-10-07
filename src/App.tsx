/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { 
  Compass, 
  Inbox, 
  Wallet, 
  CheckCircle, 
  ArrowRight, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Lock, 
  Shield, 
  Smartphone, 
  Plus, 
  X, 
  Download, 
  Video, 
  HelpCircle, 
  ChevronRight, 
  User, 
  Phone, 
  Eye, 
  EyeOff, 
  Trash2, 
  MapPin, 
  Mic, 
  Activity,
  AlertTriangle,
  Copy,
  Check,
  CheckCircle2,
  LifeBuoy
} from 'lucide-react';

interface Task {
  id: string;
  title: string;
  company: string;
  reward: number;
  category: 'App Tests' | 'Surveys' | 'Field Audits' | 'Micro Tasks';
  time: string;
  SLA: string;
  spotsLeft: number;
  spotsTotal: number;
  description: string;
  steps: string[];
}

interface SavedBank {
  id: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  type: string;
}

interface Transaction {
  id: string;
  type: 'Payout' | 'Cashout' | 'Data';
  title: string;
  sub: string;
  amount: number;
  status: 'Settled' | 'Disbursed' | 'Delivered';
  date: string;
}

interface Submission {
  id: string;
  taskTitle: string;
  reward: number;
  timeAgo: string;
  device: string;
  file: string;
  status: 'Active' | 'Approved' | 'Action';
  autoUnlockTime: string;
}

const DEFAULT_TASKS: Task[] = [
  {
    id: 't1',
    title: 'Test New Banking App Onboarding',
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
    ]
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
    ]
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
    ]
  },
  {
    id: 't4',
    title: 'Airtel P2P Transaction Load Evaluation',
    company: 'Airtel Microfinance',
    reward: 950,
    category: 'App Tests',
    time: '10m',
    SLA: '12h SLA',
    spotsLeft: 4,
    spotsTotal: 30,
    description: 'Verify phone number verification and test wallet funding speed using an active Airtel line on the sandbox application.',
    steps: [
      'Launch sandbox Airtel Money evaluation application.',
      'Attempt mock peer-to-peer payout verification with dynamic OTP sequence.',
      'Screenshot network diagnostic report with standard timestamp visible.'
    ]
  },
  {
    id: 't5',
    title: 'Lekki General Merchant Retail Audit',
    company: 'Sabi Retail',
    reward: 1200,
    category: 'Field Audits',
    time: '20m field',
    SLA: '24h review',
    spotsLeft: 15,
    spotsTotal: 40,
    description: 'Visit general merchant retail shop in Lekki Phase 1, audit stock level of essential products, and record inventory state.',
    steps: [
      'Identify merchant agent shop located at Lekki Block 14.',
      'Verify physical presence of standard Sabi inventory tablet.',
      'Log stock levels for 5 major FMCG brands inside Sabi terminal.'
    ]
  }
];

interface CompletedHistoryItem {
  id: string;
  taskTitle: string;
  reward: number;
  completedDate: string;
  device: string;
}

const COMPLETED_TASKS_MOCK: CompletedHistoryItem[] = [
  { id: 'hist1', taskTitle: 'BVN Registration Onboarding Test', reward: 1500, completedDate: 'Yesterday, 10:14 AM', device: 'Samsung Galaxy A53 (Verified)' },
  { id: 'hist2', taskTitle: 'Ikeja Storefront Audit & GPS Verification', reward: 2400, completedDate: 'Oct 04, 2026', device: 'GPS 100m Geofenced (Ikeja Plaza)' },
  { id: 'hist3', taskTitle: 'MTN Network Diagnostic Sample', reward: 950, completedDate: 'Oct 02, 2026', device: 'Airtel/MTN Sandbox' }
];

// Custom Recharts Tooltip for elegant monochromatic earnings display
const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-brand-on-background text-white px-2.5 py-1.5 rounded-lg border border-brand-inverse-surface shadow-md text-[10px] font-bold font-mono">
        <p className="leading-none text-brand-primary-fixed">₦{payload[0].value.toLocaleString()}</p>
      </div>
    );
  }
  return null;
};

export default function App() {
  // Authentication state
  const [user, setUser] = useState<{ 
    username: string; 
    phone: string; 
    referralCode?: string; 
    referredBy?: string | null; 
    hasCompletedFirstTask?: boolean;
  } | null>(() => {
    const saved = localStorage.getItem('taskpulse_user');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (!parsed.referralCode) {
        parsed.referralCode = `TP-${parsed.username.toUpperCase().slice(0, 5)}-${Math.floor(1000 + Math.random() * 9000)}`;
        parsed.hasCompletedFirstTask = parsed.hasCompletedFirstTask || false;
        parsed.referredBy = parsed.referredBy || null;
        localStorage.setItem('taskpulse_user', JSON.stringify(parsed));
      }
      return parsed;
    }
    return null;
  });

  const [authMode, setAuthMode] = useState<'signin' | 'register'>('register');
  const [phone, setPhone] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [referralInput, setReferralInput] = useState('');
  const [authError, setAuthError] = useState('');

  // Navigation state
  const [activeTab, setActiveTab] = useState<'earn' | 'submissions' | 'wallet'>('earn');

  // Wallet & Payout balances
  const [withdrawableBalance, setWithdrawableBalance] = useState<number>(() => {
    const saved = localStorage.getItem('taskpulse_withdrawable');
    return saved ? parseInt(saved, 10) : 14250;
  });
  const [pendingBalance, setPendingBalance] = useState<number>(() => {
    const saved = localStorage.getItem('taskpulse_pending');
    return saved ? parseInt(saved, 10) : 3800;
  });
  const [lifetimeDisbursed, setLifetimeDisbursed] = useState<number>(() => {
    const saved = localStorage.getItem('taskpulse_lifetime');
    return saved ? parseInt(saved, 10) : 182400;
  });

  // Saved Banks list
  const [savedBanks, setSavedBanks] = useState<SavedBank[]>(() => {
    const saved = localStorage.getItem('taskpulse_banks');
    if (saved) return JSON.parse(saved);
    return [
      { id: '1', bankName: 'Moniepoint MFB', accountName: 'Tunde Emmanuel Adeleke', accountNumber: '8012', type: 'Current' },
      { id: '2', bankName: 'Access Bank PLC', accountName: 'Tunde Emmanuel Adeleke', accountNumber: '4920', type: 'Savings' }
    ];
  });

  const [isAddingBank, setIsAddingBank] = useState(false);
  const [newBankName, setNewBankName] = useState('Access Bank PLC');
  const [newAccountNumber, setNewAccountNumber] = useState('');
  const [newAccountName, setNewAccountName] = useState('Tunde Emmanuel Adeleke');

  // Transactions list
  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    const saved = localStorage.getItem('taskpulse_transactions');
    if (saved) return JSON.parse(saved);
    return [
      { id: 'tr1', type: 'Payout', title: 'Task Payout: App Onboarding', sub: 'PayFlow Labs', amount: 1500, status: 'Settled', date: 'Today, 10:14 AM' },
      { id: 'tr2', type: 'Cashout', title: 'Instant Bank Cashout', sub: 'Moniepoint MFB', amount: -10000, status: 'Disbursed', date: 'Yesterday' },
      { id: 'tr3', type: 'Data', title: 'Data Bundle Purchase', sub: 'MTN 5GB SME', amount: -1200, status: 'Delivered', date: 'Oct 04' }
    ];
  });

  // Task feed filters
  const [taskFilter, setTaskFilter] = useState<'all' | 'App Tests' | 'Surveys' | 'Field Audits' | 'Micro Tasks'>('all');

  // Active / Accepted Task in the Workspace
  const [activeTask, setActiveTask] = useState<Task | null>(() => {
    const saved = localStorage.getItem('taskpulse_active_task');
    return saved ? JSON.parse(saved) : null;
  });

  // Workspace interaction state
  const [workspaceTimer, setWorkspaceTimer] = useState<number>(2304); // 38m 24s default timer in seconds
  const [uploadedFile, setUploadedFile] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [declarationChecked, setDeclarationChecked] = useState(true);
  const [activeStepsStatus, setActiveStepsStatus] = useState<boolean[]>([false, false, false]);

  // Submissions list
  const [submissions, setSubmissions] = useState<Submission[]>(() => {
    const saved = localStorage.getItem('taskpulse_submissions');
    if (saved) return JSON.parse(saved);
    return [
      { id: 'sub1', taskTitle: 'Test New Banking App Onboarding', reward: 1500, timeAgo: '22 mins ago', device: 'Samsung Galaxy A53 (Verified)', file: 'Screen_KYC.mp4', status: 'Active', autoUnlockTime: '23h 38m' },
      { id: 'sub2', taskTitle: 'Lagos Retail POS Geolocation Audit', reward: 2400, timeAgo: '3 hours ago', device: 'GPS 100m Geofenced (Ikeja Plaza)', file: 'Screen_POS_Lekki.png', status: 'Active', autoUnlockTime: '20h 52m' },
      { id: 'sub3', taskTitle: 'Agency Banking Voice Sample', reward: 850, timeAgo: '6 hours ago', device: 'Mic Authenticated', file: 'Voice_KYC_Sample.wav', status: 'Approved', autoUnlockTime: 'Settled' }
    ];
  });

  const [submissionTab, setSubmissionTab] = useState<'Active' | 'Approved' | 'Action'>('Active');

  // Notification Toast state
  const [toast, setToast] = useState<{ title: string; subtitle: string; show: boolean }>({
    title: '',
    subtitle: '',
    show: false
  });

  // Direct cashout modal & amount selected state
  const [cashoutAmountInput, setCashoutAmountInput] = useState<string>('14250');
  const [selectedBankId, setSelectedBankId] = useState<string>('1');
  const [isCashoutConfirming, setIsCashoutConfirming] = useState(false);
  const [isCashoutProcessing, setIsCashoutProcessing] = useState(false);

  // UTU Utility Data Redemption
  const [isUtilityRedeeming, setIsUtilityRedeeming] = useState<boolean>(false);
  const [utilitySelected, setUtilitySelected] = useState<{ provider: string; name: string; price: number } | null>(null);

  // Support Dispute dialog state
  const [isSupportOpen, setIsSupportOpen] = useState(false);
  const [supportMessage, setSupportMessage] = useState('');
  const [supportSubmitted, setSupportSubmitted] = useState(false);

  // Password visibility
  const [showPassword, setShowPassword] = useState(false);

  // Referral copy state
  const [copiedReferral, setCopiedReferral] = useState(false);

  // Active workspace count down effect
  useEffect(() => {
    let interval: any = null;
    if (activeTask) {
      interval = setInterval(() => {
        setWorkspaceTimer((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      setWorkspaceTimer(2304);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [activeTask]);

  // Synchronize local storage when crucial states update
  useEffect(() => {
    localStorage.setItem('taskpulse_withdrawable', withdrawableBalance.toString());
  }, [withdrawableBalance]);

  useEffect(() => {
    localStorage.setItem('taskpulse_pending', pendingBalance.toString());
  }, [pendingBalance]);

  useEffect(() => {
    localStorage.setItem('taskpulse_lifetime', lifetimeDisbursed.toString());
  }, [lifetimeDisbursed]);

  useEffect(() => {
    localStorage.setItem('taskpulse_banks', JSON.stringify(savedBanks));
  }, [savedBanks]);

  useEffect(() => {
    localStorage.setItem('taskpulse_transactions', JSON.stringify(transactions));
  }, [transactions]);

  useEffect(() => {
    localStorage.setItem('taskpulse_submissions', JSON.stringify(submissions));
  }, [submissions]);

  useEffect(() => {
    if (activeTask) {
      localStorage.setItem('taskpulse_active_task', JSON.stringify(activeTask));
    } else {
      localStorage.removeItem('taskpulse_active_task');
    }
  }, [activeTask]);

  // Show dynamic self-dismissing toast
  const triggerToast = (title: string, subtitle: string) => {
    setToast({ title, subtitle, show: true });
    setTimeout(() => {
      setToast((prev) => ({ ...prev, show: false }));
    }, 4500);
  };

  // Simplified Authentication logic: Strictly Username, Phone Number, Password
  const handleAuthentication = (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');

    if (!phone || !username || !password) {
      setAuthError('All fields (Phone, Username, and Password) are strictly required.');
      return;
    }

    if (phone.length < 8) {
      setAuthError('Please enter a valid phone number (minimum 8 characters).');
      return;
    }

    if (username.length < 3) {
      setAuthError('Username must be at least 3 characters.');
      return;
    }

    if (password.length < 6) {
      setAuthError('Password must be at least 6 characters.');
      return;
    }

    // Success flow - mock login or signup
    const generatedCode = `TP-${username.toUpperCase().slice(0, 5)}-${Math.floor(1000 + Math.random() * 9000)}`;
    const loggedUser = { 
      username, 
      phone,
      referralCode: generatedCode,
      referredBy: authMode === 'register' && referralInput.trim() ? referralInput.trim().toUpperCase() : null,
      hasCompletedFirstTask: false
    };
    setUser(loggedUser);
    localStorage.setItem('taskpulse_user', JSON.stringify(loggedUser));
    triggerToast(
      authMode === 'register' ? 'Account Created' : 'Welcome Back',
      `Logged in as @${username} (${phone})`
    );
  };

  const handleSignOut = () => {
    setUser(null);
    localStorage.removeItem('taskpulse_user');
    setActiveTask(null);
    triggerToast('Logged Out', 'Your session has been cleared.');
  };

  // Task Interaction Handlers
  const handleAcceptTask = (task: Task) => {
    if (activeTask) {
      triggerToast('Active Task Already In Progress', 'Please complete or abandon your current task first.');
      return;
    }
    setActiveTask(task);
    setWorkspaceTimer(2700); // 45:00 minutes
    setUploadedFile(null);
    setActiveStepsStatus([false, false, false]);
    setActiveTab('earn'); // Keep view on dashboard / active task
    triggerToast('Task Reserved', `${task.title} allocated to your active workspace.`);
  };

  const handleAbandonTask = () => {
    if (!activeTask) return;
    setActiveTask(null);
    setUploadedFile(null);
    triggerToast('Task Abandoned', 'The reservation has been returned to the pool.');
  };

  // Mock upload interaction for proof submission
  const handleMockUpload = () => {
    setIsUploading(true);
    setTimeout(() => {
      setIsUploading(false);
      const randomId = Math.floor(1000 + Math.random() * 9000);
      setUploadedFile(`Screen_KYC_Verification_${randomId}.mp4`);
      triggerToast('Proof Loaded', 'EXIF metadata and Nigerian GPS telemetry verified successfully.');
    }, 1500);
  };

  const handleSubmitProof = () => {
    if (!activeTask) return;
    if (!uploadedFile) {
      triggerToast('Missing Proof', 'Please capture or upload your video screen sequence.');
      return;
    }
    if (!declarationChecked) {
      triggerToast('Attestation Required', 'You must verify the physical, authentic device declaration checkbox.');
      return;
    }

    // Move task to submissions list as "Active Review"
    const newSubmission: Submission = {
      id: `sub-${Date.now()}`,
      taskTitle: activeTask.title,
      reward: activeTask.reward,
      timeAgo: 'Just now',
      device: 'Samsung Galaxy A53 (Verified)',
      file: uploadedFile,
      status: 'Active',
      autoUnlockTime: '23h 59m'
    };

    setSubmissions([newSubmission, ...submissions]);
    setPendingBalance((prev) => prev + activeTask.reward);
    setActiveTask(null);
    setUploadedFile(null);
    setActiveTab('submissions');
    setSubmissionTab('Active');
    
    // Referral bonus check
    if (user && user.referredBy && !user.hasCompletedFirstTask) {
      const bonusAmount = 500;
      setWithdrawableBalance((prev) => prev + bonusAmount);
      
      const refTx: Transaction = {
        id: `tr-ref-${Date.now()}`,
        type: 'Payout',
        title: 'Referral Sign-Up Bonus',
        sub: `Referred by ${user.referredBy}`,
        amount: bonusAmount,
        status: 'Settled',
        date: 'Today, Just now'
      };
      
      setTransactions((prev) => [refTx, ...prev]);
      
      // Update user state to mark first task completed
      const updatedUser = { ...user, hasCompletedFirstTask: true };
      setUser(updatedUser);
      localStorage.setItem('taskpulse_user', JSON.stringify(updatedUser));
      
      triggerToast('₦500 Referral Bonus Credited!', `Sign-up reward settled. Referrer @${user.referredBy.split('-')[1] || 'arbitrage_ref'} also rewarded +₦500.`);
    } else {
      triggerToast('Submission Received', `₦${newSubmission.reward.toLocaleString()} locked in escrow. 24h SLA review started.`);
    }
  };

  // Dynamic SLA simulation for immediate approval evaluation
  const handleSimulateApproval = (submissionId: string) => {
    const targetSub = submissions.find(s => s.id === submissionId);
    if (!targetSub) return;

    // Change status
    const updatedSubmissions = submissions.map(s => {
      if (s.id === submissionId) {
        return { ...s, status: 'Approved' as const, autoUnlockTime: 'Settled' };
      }
      return s;
    });
    setSubmissions(updatedSubmissions);

    // Update balances
    setPendingBalance((prev) => Math.max(0, prev - targetSub.reward));
    setWithdrawableBalance((prev) => prev + targetSub.reward);

    // Add settlement ledger transaction
    const newTx: Transaction = {
      id: `tr-settle-${Date.now()}`,
      type: 'Payout',
      title: `Task Payout: Approved`,
      sub: targetSub.taskTitle,
      amount: targetSub.reward,
      status: 'Settled',
      date: 'Today, Just now'
    };
    setTransactions((prev) => [newTx, ...prev]);

    triggerToast('Escrow Funds Released', `₦${targetSub.reward.toLocaleString()} settled to your withdrawable balance.`);
  };

  // Wallet Cashout Action
  const handleCashout = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(cashoutAmountInput);

    if (isNaN(amount) || amount <= 0) {
      triggerToast('Invalid Amount', 'Please input a valid withdrawable amount.');
      return;
    }

    if (amount > withdrawableBalance) {
      triggerToast('Insufficient Balance', `Your withdrawable balance is ₦${withdrawableBalance.toLocaleString()}.`);
      return;
    }

    setIsCashoutConfirming(false);
    setIsCashoutProcessing(true);

    setTimeout(() => {
      setWithdrawableBalance((prev) => prev - amount);
      setLifetimeDisbursed((prev) => prev + amount);

      const targetBank = savedBanks.find((b) => b.id === selectedBankId) || savedBanks[0];
      const newTx: Transaction = {
        id: `tr-${Date.now()}`,
        type: 'Cashout',
        title: 'Instant Bank Cashout',
        sub: targetBank.bankName,
        amount: -amount,
        status: 'Disbursed',
        date: 'Today, Just now'
      };

      setTransactions([newTx, ...transactions]);
      setIsCashoutProcessing(false);
      triggerToast('Cashout Disbursed', `₦${amount.toLocaleString()} settled to ${targetBank.bankName} (${targetBank.accountNumber}).`);
    }, 2000);
  };

  // Saved Bank Addition
  const handleAddBank = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAccountNumber || newAccountNumber.length < 10) {
      triggerToast('Invalid Account Number', 'Please enter a valid 10-digit NUBAN account number.');
      return;
    }

    const newBank: SavedBank = {
      id: `bank-${Date.now()}`,
      bankName: newBankName,
      accountName: newAccountName,
      accountNumber: newAccountNumber,
      type: 'Savings'
    };

    setSavedBanks([...savedBanks, newBank]);
    setSelectedBankId(newBank.id);
    setIsAddingBank(false);
    setNewAccountNumber('');
    triggerToast('Bank Added', `${newBank.bankName} successfully linked to your profile.`);
  };

  // Data Bundle Purchase
  const handleRedeemUtility = (provider: string, name: string, price: number) => {
    setUtilitySelected({ provider, name, price });
    setIsUtilityRedeeming(true);
  };

  const handleConfirmUtility = () => {
    if (!utilitySelected) return;
    if (utilitySelected.price > withdrawableBalance) {
      triggerToast('Insufficient Funds', 'Redeem amount exceeds your withdrawable balance.');
      setIsUtilityRedeeming(false);
      return;
    }

    setWithdrawableBalance((prev) => prev - utilitySelected.price);
    
    const newTx: Transaction = {
      id: `tr-${Date.now()}`,
      type: 'Data',
      title: `${utilitySelected.provider} ${utilitySelected.name}`,
      sub: 'Instant VTU',
      amount: -utilitySelected.price,
      status: 'Delivered',
      date: 'Today, Just now'
    };

    setTransactions([newTx, ...transactions]);
    setIsUtilityRedeeming(false);
    setUtilitySelected(null);
    triggerToast('Voucher Redeemed', `Your ${utilitySelected.provider} subscription was loaded successfully.`);
  };

  // Support / Dispute Submission
  const handleSupportSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!supportMessage.trim()) return;
    setSupportSubmitted(true);
    setTimeout(() => {
      setSupportSubmitted(false);
      setSupportMessage('');
      setIsSupportOpen(false);
      triggerToast('Dispute Filed', 'Our 24/7 arbitration specialists have initiated a priority review.');
    }, 1500);
  };

  // Helper formatting for timer
  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <div className="h-screen w-full overflow-hidden bg-brand-background text-brand-on-background flex flex-col items-center justify-center p-0 sm:p-4 select-none">
      
      {/* PROFESSIONAL BACKGROUND ACCENTS AND MESH GRADIENTS */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,var(--color-brand-surface-highest),transparent)] pointer-events-none z-0 opacity-75"></div>
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-brand-surface-dim/40 rounded-full blur-3xl pointer-events-none z-0 opacity-60"></div>

      {/* PARENT RESPONSIVE CONTAINER */}
      <div className="relative z-10 w-full max-w-6xl h-full max-h-full sm:max-h-[840px] grid grid-cols-1 lg:grid-cols-12 gap-8 items-center justify-items-center overflow-hidden">
        
        {/* DESKTOP BRAND LEFT COLUMN - Hidden on Mobile */}
        <div className="hidden lg:flex lg:col-span-5 flex-col space-y-6 text-left max-w-md">
          
          <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-brand-surface-container border border-brand-surface-high text-xs font-semibold text-brand-primary uppercase tracking-widest leading-none">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-primary animate-pulse"></span>
            Escrow Network Spec: Active
          </div>
          
          <div className="space-y-3">
            <h1 className="text-4xl font-extrabold tracking-tight text-brand-on-background leading-tight">
              A High-Trust <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-primary to-brand-tertiary">Decentralized</span> <br />
              NIP Escrow Switch.
            </h1>
            <p className="text-sm text-brand-on-surface-variant leading-relaxed font-medium">
              An institutional crowd-testing platform built strictly to coordinate verified telemetry checks, hardware diagnostic validations, and autonomous instant payouts across Nigeria.
            </p>
          </div>

          {/* Claim-to-Proof Adjacency Security Trust items */}
          <div className="border-t border-brand-surface-container pt-6 space-y-4 text-xs text-brand-on-surface-variant">
            
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-brand-surface-low border border-brand-surface-container flex items-center justify-center text-brand-primary">
                <Shield className="w-4 h-4" />
              </div>
              <div>
                <strong className="text-brand-on-background block font-bold">100% Escrow Protection</strong>
                <span className="text-[11px]">Employer task funds are pre-funded and held in custody.</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-brand-surface-low border border-brand-surface-container flex items-center justify-center text-brand-tertiary">
                <Activity className="w-4 h-4" />
              </div>
              <div>
                <strong className="text-brand-on-background block font-bold">Automated Autocut SLA</strong>
                <span className="text-[11px]">If manual review fails within 24h, the escrow locks auto-release.</span>
              </div>
            </div>

          </div>
        </div>

        {/* HIGH-FIDELITY SMARTPHONE VIEWPORT WRAPPER */}
        <div className="col-span-1 lg:col-span-7 w-full h-full max-h-full sm:max-h-[812px] flex justify-center items-center overflow-hidden">
          
          <div className="relative w-full max-w-[375px] h-full sm:max-h-[812px] rounded-none sm:rounded-[40px] bg-brand-on-background sm:shadow-[0_25px_60px_-15px_rgba(11,28,48,0.4),0_0_0_10px_#213145,0_0_0_12px_#3f465c] overflow-hidden flex flex-col text-brand-on-surface border-0 sm:border border-brand-inverse-surface z-10">
            
            {/* SCREEN TOP HEADER BAR */}
            <div className="bg-brand-surface-lowest border-b border-brand-surface-container/60 px-4 py-3 flex items-center justify-between shrink-0 relative z-40">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-brand-primary flex items-center justify-center text-brand-on-primary font-extrabold text-[13px] tracking-tighter shadow-sm">
                  TP
                </div>
                <div>
                  <h2 className="text-xs font-black tracking-tight text-brand-on-surface leading-none">TaskPulse</h2>
                  {user && (
                    <p className="text-[9px] text-brand-on-surface-variant font-bold leading-none mt-0.5">@_{user.username}</p>
                  )}
                </div>
              </div>

              {user ? (
                <div className="flex items-center gap-2">
                  <div className="text-right">
                    <p className="text-[8px] font-bold text-brand-on-surface-variant uppercase tracking-widest leading-none">withdrawable</p>
                    <p className="text-xs font-black text-brand-primary font-mono mt-0.5">₦{withdrawableBalance.toLocaleString()}</p>
                  </div>
                  <button 
                    onClick={handleSignOut}
                    className="text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded bg-brand-surface-low hover:bg-brand-surface-container text-brand-on-surface transition-colors border border-brand-surface-container/80"
                  >
                    Exit
                  </button>
                </div>
              ) : (
                <span className="text-[8px] font-extrabold text-brand-on-surface-variant uppercase tracking-wider bg-brand-surface-low px-2 py-1 rounded">SECURED SWITCH</span>
              )}
            </div>

            {/* PHONE CANVAS BODY CONTAINER */}
            <div className="flex-1 overflow-hidden bg-brand-surface flex flex-col">
              
              {/* AUTHENTICATION OVERLAY SHEET - Requires exactly Phone, Username, Password */}
              {!user ? (
                <div className="flex-1 flex flex-col justify-center px-5 py-6 space-y-5 overflow-y-auto no-scrollbar">
                  <div className="text-center space-y-1.5">
                    <div className="w-10 h-10 rounded-xl bg-brand-primary text-brand-on-primary flex items-center justify-center mx-auto shadow-sm">
                      <Lock className="w-5 h-5" />
                    </div>
                    <h3 className="text-sm font-black tracking-tight text-brand-on-surface">
                      {authMode === 'register' ? 'Register Escrow Profile' : 'Authenticate Session'}
                    </h3>
                    <p className="text-[10px] text-brand-on-surface-variant max-w-xs mx-auto leading-relaxed">
                      Surgical monochromatic validation. Use the preset demo login below for immediate evaluation access.
                    </p>
                  </div>

                  {authError && (
                    <div className="p-3 bg-brand-error-container border border-brand-error/20 rounded-lg flex gap-2 text-[10px] text-brand-error leading-snug">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-brand-error" />
                      <span>{authError}</span>
                    </div>
                  )}

                  <form onSubmit={handleAuthentication} className="space-y-3.5">
                    
                    {/* INPUT 1: Phone */}
                    <div className="space-y-1">
                      <label htmlFor="phone" className="text-[9px] font-bold text-brand-on-surface-variant uppercase tracking-wider block">Phone Number (+234 / Standard)</label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-brand-on-surface-variant">
                          <Phone className="w-3.5 h-3.5" />
                        </div>
                        <input 
                          id="phone"
                          type="tel"
                          placeholder="e.g. 08012345678"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          className="w-full h-10 pl-8 pr-3 rounded-lg border border-brand-surface-container bg-brand-surface-lowest text-xs font-semibold text-brand-on-surface placeholder:text-brand-on-surface-variant/40 focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                          required
                        />
                      </div>
                    </div>

                    {/* INPUT 2: Username */}
                    <div className="space-y-1">
                      <label htmlFor="username" className="text-[9px] font-bold text-brand-on-surface-variant uppercase tracking-wider block">Contributor Username</label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-brand-on-surface-variant">
                          <User className="w-3.5 h-3.5" />
                        </div>
                        <input 
                          id="username"
                          type="text"
                          placeholder="e.g. tunde_adeleke"
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          className="w-full h-10 pl-8 pr-3 rounded-lg border border-brand-surface-container bg-brand-surface-lowest text-xs font-semibold text-brand-on-surface placeholder:text-brand-on-surface-variant/40 focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                          required
                        />
                      </div>
                    </div>

                    {/* INPUT 3: Password */}
                    <div className="space-y-1">
                      <label htmlFor="pass" className="text-[9px] font-bold text-brand-on-surface-variant uppercase tracking-wider block">Escrow Security Password</label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-brand-on-surface-variant">
                          <Lock className="w-3.5 h-3.5" />
                        </div>
                        <input 
                          id="pass"
                          type={showPassword ? 'text' : 'password'}
                          placeholder="••••••••"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="w-full h-10 pl-8 pr-9 rounded-lg border border-brand-surface-container bg-brand-surface-lowest text-xs font-semibold text-brand-on-surface placeholder:text-brand-on-surface-variant/40 focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-brand-on-surface-variant"
                        >
                          {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>

                    {/* INPUT 4: Referral */}
                    {authMode === 'register' && (
                      <div className="space-y-1">
                        <label htmlFor="ref" className="text-[9px] font-bold text-brand-on-surface-variant uppercase tracking-wider block">Invite Code (Optional)</label>
                        <div className="relative">
                          <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-brand-on-surface-variant">
                            <Plus className="w-3.5 h-3.5" />
                          </div>
                          <input 
                            id="ref"
                            type="text"
                            placeholder="e.g. TP-DEMO-9999"
                            value={referralInput}
                            onChange={(e) => setReferralInput(e.target.value)}
                            className="w-full h-10 pl-8 pr-3 rounded-lg border border-brand-surface-container bg-brand-surface-lowest text-xs font-semibold text-brand-on-surface focus:outline-none focus:border-brand-primary"
                          />
                        </div>
                      </div>
                    )}

                    <button
                      type="submit"
                      className="w-full h-11 bg-brand-primary hover:bg-brand-primary-container text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 shadow-sm active:scale-[0.98] transition-transform"
                    >
                      <span>{authMode === 'register' ? 'Register Escrow Account' : 'Resume Escrow Session'}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>

                    {/* DEMO BYPASS BUTTON */}
                    <button
                      type="button"
                      onClick={() => {
                        const demoUser = { 
                          username: 'tunde_adeleke', 
                          phone: '08012345678',
                          referralCode: 'TP-TUNDE-8012',
                          referredBy: 'TP-DEMO-9999',
                          hasCompletedFirstTask: false
                        };
                        setUser(demoUser);
                        localStorage.setItem('taskpulse_user', JSON.stringify(demoUser));
                        triggerToast('Demo Session Loaded', 'Referral program active (@tunde_adeleke)');
                      }}
                      className="w-full h-11 bg-brand-surface-low hover:bg-brand-surface-container text-brand-on-surface border border-brand-surface-high font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
                    >
                      <span>Quick Demo Login</span>
                      <User className="w-3.5 h-3.5 text-brand-primary" />
                    </button>

                  </form>

                  <div className="text-center pt-1 text-[10px]">
                    <button
                      onClick={() => {
                        setAuthMode(authMode === 'register' ? 'signin' : 'register');
                        setAuthError('');
                      }}
                      className="font-bold text-brand-secondary hover:text-brand-on-surface underline"
                    >
                      {authMode === 'register' ? 'Already registered? Sign In' : 'Need NIP escrow access? Sign Up'}
                    </button>
                  </div>

                </div>
              ) : (
                /* AUTHENTICATED ACTIVE WORKER DASHBOARD */
                <div className="flex-1 flex flex-col p-4 space-y-4 overflow-y-auto no-scrollbar">
                  
                  {/* ACTIVE DIRECTIVE WORKSPACE WINDOW - If task accepted */}
                  {activeTask && (
                    <div className="bg-brand-inverse-surface text-brand-inverse-on-surface rounded-2xl p-4 border border-brand-inverse-surface shadow-md space-y-3 relative overflow-hidden">
                      <div className="absolute top-0 right-0 p-1.5 bg-brand-primary text-brand-on-primary text-[8px] font-black tracking-wider uppercase rounded-bl-lg">
                        ACTIVE DIRECTIVE
                      </div>

                      <div>
                        <div className="flex items-center gap-1 text-[9px] text-brand-inverse-on-surface/75">
                          <span className="font-extrabold uppercase">{activeTask.company}</span>
                          <span aria-hidden="true">·</span>
                          <span>{activeTask.category}</span>
                        </div>
                        <h3 className="text-xs font-black tracking-tight text-white leading-tight mt-0.5">{activeTask.title}</h3>
                      </div>

                      {/* Timer */}
                      <div className="flex items-center justify-between bg-brand-on-background/40 p-2 rounded-lg text-xs border border-brand-inverse-surface/30">
                        <div>
                          <span className="text-[8px] font-bold text-brand-surface-dim block uppercase leading-none">COUNTDOWN</span>
                          <span className="text-sm font-black font-mono mt-0.5 block leading-none text-brand-primary-fixed-dim">{formatTimer(workspaceTimer)}</span>
                        </div>
                        <button 
                          onClick={handleAbandonTask}
                          className="text-[9px] font-bold text-brand-inverse-on-surface/85 hover:text-white"
                        >
                          Abandon
                        </button>
                      </div>

                      {/* Step Guides */}
                      <div className="space-y-3 pt-2 text-[11px] border-t border-brand-inverse-surface/30">
                        <div className="space-y-2">
                          {/* Step 1 download */}
                          <div className="flex gap-2">
                            <div className="w-4 h-4 rounded-full bg-brand-primary text-brand-on-primary text-[9px] font-bold flex items-center justify-center shrink-0">1</div>
                            <div className="space-y-1 flex-1 text-left">
                              <span className="font-bold text-white block">Download secure APK sandbox</span>
                              <p className="text-[10px] text-brand-surface-dim leading-snug">{activeTask.steps[0]}</p>
                              
                              <button
                                onClick={() => {
                                  setActiveStepsStatus([true, activeStepsStatus[1], activeStepsStatus[2]]);
                                  triggerToast('Sandbox Download Triggered', 'APK stream starting.');
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 bg-brand-surface-lowest text-brand-primary rounded text-[9px] font-bold hover:bg-brand-surface-low transition-colors shadow-xs"
                              >
                                <Download className="w-2.5 h-2.5" />
                                <span>Get Sandbox APK</span>
                              </button>
                            </div>
                          </div>

                          {/* Step 2 simulation */}
                          <div className="flex gap-2 text-left">
                            <div className="w-4 h-4 rounded-full bg-brand-primary text-brand-on-primary text-[9px] font-bold flex items-center justify-center shrink-0">2</div>
                            <div className="flex-1">
                              <span className="font-bold text-white block">Simulate input test sequence</span>
                              <p className="text-[10px] text-brand-surface-dim leading-snug">{activeTask.steps[1]}</p>
                            </div>
                          </div>

                          {/* Step 3 Screenshot upload */}
                          <div className="flex gap-2 text-left">
                            <div className="w-4 h-4 rounded-full bg-brand-primary text-brand-on-primary text-[9px] font-bold flex items-center justify-center shrink-0">3</div>
                            <div className="flex-1 space-y-2">
                              <span className="font-bold text-white block">Screenshot or Video evaluation</span>
                              <p className="text-[10px] text-brand-surface-dim leading-snug">{activeTask.steps[2]}</p>
                              
                              <div 
                                onClick={handleMockUpload}
                                className="border border-dashed border-brand-inverse-on-surface/20 bg-brand-on-background/20 hover:bg-brand-on-background/30 rounded-xl p-3 text-center cursor-pointer relative"
                              >
                                {isUploading ? (
                                  <div className="w-4 h-4 rounded-full border border-white border-t-transparent animate-spin mx-auto"></div>
                                ) : uploadedFile ? (
                                  <div className="space-y-0.5 text-center">
                                    <Video className="w-4 h-4 text-white mx-auto" />
                                    <p className="text-[10px] text-white font-mono truncate">{uploadedFile}</p>
                                    <span className="text-[8px] text-brand-primary-fixed font-black uppercase">TELEMETRY SECURED</span>
                                  </div>
                                ) : (
                                  <div className="space-y-1">
                                    <Video className="w-4 h-4 text-brand-inverse-on-surface/40 mx-auto" />
                                    <p className="text-[9px] text-white font-bold">Tap to trigger device camera</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                        </div>
                      </div>

                      {/* Declaration attestation */}
                      <div className="border-t border-brand-inverse-surface/30 pt-3 space-y-2 text-left">
                        <label className="flex items-start gap-2 select-none cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={declarationChecked}
                            onChange={() => setDeclarationChecked(!declarationChecked)}
                            className="mt-0.5 w-3.5 h-3.5 rounded border-brand-inverse-surface bg-brand-on-background accent-brand-primary shrink-0" 
                          />
                          <span className="text-[10px] text-brand-surface-dim leading-snug">
                            I verify this evaluation is on an authentic physical device.
                          </span>
                        </label>

                        <button 
                          onClick={handleSubmitProof}
                          disabled={!uploadedFile}
                          className={`w-full h-10 rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-transform active:scale-[0.98] ${
                            uploadedFile 
                              ? 'bg-brand-primary text-white hover:bg-brand-primary-container' 
                              : 'bg-brand-inverse-surface text-brand-surface-dim/40 cursor-not-allowed border border-brand-inverse-on-surface/10'
                          }`}
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                          <span>Submit Evaluation Proof (₦{activeTask.reward})</span>
                        </button>
                      </div>

                    </div>
                  )}

                  {/* TAB SWITCH VIEW: EARN (Marketplace Listings) */}
                  {activeTab === 'earn' && (
                    <div className="space-y-4 flex-1 flex flex-col min-h-0">
                      
                      {/* Segmented Controls filter tabs */}
                      <div className="flex gap-1 overflow-x-auto pb-1 no-scrollbar shrink-0">
                        {(['all', 'App Tests', 'Surveys', 'Field Audits'] as const).map((category) => (
                          <button
                            key={category}
                            onClick={() => setTaskFilter(category)}
                            className={`px-3.5 py-1.5 text-[10px] font-bold rounded-lg whitespace-nowrap transition-colors ${
                              taskFilter === category 
                                ? 'bg-brand-primary text-white shadow-xs font-extrabold'
                                : 'bg-brand-surface-lowest text-brand-secondary border border-brand-surface-container hover:border-brand-surface-high'
                            }`}
                          >
                            {category === 'all' ? 'All Directives' : category}
                          </button>
                        ))}
                      </div>

                      {/* Listings Stack */}
                      <div className="space-y-3 overflow-y-auto no-scrollbar flex-1">
                        {DEFAULT_TASKS
                          .filter(t => taskFilter === 'all' || t.category === taskFilter)
                          .map((task) => (
                            <div key={task.id} className="bg-brand-surface-lowest rounded-2xl border border-brand-surface-container/60 p-4 space-y-3 hover:border-brand-surface-high transition-colors shadow-xs text-left">
                              
                              <div className="flex items-start justify-between gap-3">
                                <div className="space-y-0.5">
                                  <div className="flex items-center gap-1.5 text-[10px] text-brand-on-surface-variant font-semibold">
                                    <span className="font-extrabold text-brand-primary uppercase">{task.company}</span>
                                    <span aria-hidden="true">·</span>
                                    <span>{task.category}</span>
                                  </div>
                                  <h4 className="text-xs font-black tracking-tight text-brand-on-surface leading-tight mt-0.5">{task.title}</h4>
                                </div>

                                <div className="text-right shrink-0">
                                  <p className="text-xs font-black text-brand-primary font-mono">₦{task.reward}</p>
                                  <span className="text-[8px] font-bold text-brand-on-surface-variant uppercase tracking-widest leading-none mt-0.5 block">Escrowed</span>
                                </div>
                              </div>

                              <p className="text-[11px] text-brand-on-surface-variant leading-snug line-clamp-2">
                                {task.description}
                              </p>

                              <div className="flex items-center justify-between text-[9px] text-brand-on-surface-variant font-bold border-t border-brand-surface-container/30 pt-2 bg-brand-surface-low p-1.5 rounded">
                                <span className="flex items-center gap-1">⏱ {task.time} · 🛡 SLA Protected</span>
                                <span className="font-mono text-brand-on-surface">{task.spotsLeft}/{task.spotsTotal} spots</span>
                              </div>

                              <button 
                                onClick={() => handleAcceptTask(task)}
                                className="w-full h-10 bg-brand-primary hover:bg-brand-primary-container text-white rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1 shadow-xs transition-transform active:scale-[0.98]"
                              >
                                <Lock className="w-3 h-3" />
                                <span>Reserve Directive</span>
                              </button>

                            </div>
                        ))}
                      </div>

                    </div>
                  )}

                  {/* TAB SWITCH VIEW: SUBMISSIONS */}
                  {activeTab === 'submissions' && (
                    <div className="space-y-4 flex-1 flex flex-col min-h-0">
                      
                      {/* Interactive Review Segment Tabs */}
                      <div className="flex items-center bg-brand-surface-container p-1 rounded-xl shrink-0">
                        <button
                          onClick={() => setSubmissionTab('Active')}
                          className={`flex-1 py-1.5 text-[10px] font-black uppercase rounded-lg transition-colors text-center ${
                            submissionTab === 'Active' 
                              ? 'bg-brand-surface-lowest text-brand-on-surface shadow-sm'
                              : 'text-brand-secondary hover:text-brand-on-surface'
                          }`}
                        >
                          Active Reviews ({submissions.filter(s => s.status === 'Active').length})
                        </button>
                        <button
                          onClick={() => setSubmissionTab('Approved')}
                          className={`flex-1 py-1.5 text-[10px] font-black uppercase rounded-lg transition-colors text-center ${
                            submissionTab === 'Approved' 
                              ? 'bg-brand-surface-lowest text-brand-on-surface shadow-sm'
                              : 'text-brand-secondary hover:text-brand-on-surface'
                          }`}
                        >
                          Completed History
                        </button>
                      </div>

                      {/* Submissions Feed List */}
                      <div className="space-y-3 overflow-y-auto no-scrollbar flex-1">
                        {submissionTab === 'Approved' ? (
                          <div className="space-y-3">
                            {/* COMBINED COMPLETED HISTORY LIST */}
                            {submissions.filter(s => s.status === 'Approved').length === 0 && COMPLETED_TASKS_MOCK.length === 0 ? (
                              <div className="bg-brand-surface-lowest rounded-xl p-8 border border-brand-surface-container text-center space-y-2 shadow-xs">
                                <Inbox className="w-6 h-6 text-brand-surface-dim mx-auto" />
                                <p className="text-[10px] font-bold text-brand-on-surface-variant uppercase">No completed tasks yet</p>
                              </div>
                            ) : (
                              <>
                                {/* Newly Approved Submissions in the Current Session */}
                                {submissions
                                  .filter(s => s.status === 'Approved')
                                  .map((sub) => (
                                    <div key={sub.id} className="bg-brand-surface-lowest rounded-xl border border-brand-surface-container/60 p-4 space-y-2.5 shadow-xs text-left relative overflow-hidden">
                                      <div className="absolute top-0 right-0 p-1 bg-brand-primary text-white text-[7px] font-black uppercase rounded-bl">
                                        RECENTLY SETTLED
                                      </div>
                                      <div className="flex justify-between items-start gap-3">
                                        <div>
                                          <span className="text-[8px] font-black text-brand-on-surface-variant block uppercase">REF INDEX #{sub.id}</span>
                                          <h4 className="text-xs font-extrabold text-brand-on-surface mt-0.5 leading-snug">{sub.taskTitle}</h4>
                                        </div>
                                        <span className="text-[10px] font-black font-mono text-brand-primary bg-brand-surface-low px-2 py-0.5 rounded shrink-0">₦{sub.reward}</span>
                                      </div>

                                      <div className="bg-brand-surface-low p-2 rounded text-[10px] text-brand-on-surface-variant space-y-1">
                                        <p className="flex justify-between"><span>Diagnostic Hardware:</span> <strong className="text-brand-on-surface">{sub.device}</strong></p>
                                        <p className="flex justify-between"><span>Submitted Proof:</span> <strong className="text-brand-on-surface">{sub.file}</strong></p>
                                        <p className="flex justify-between"><span>Completed Date:</span> <strong className="text-brand-on-surface">Today, Just now</strong></p>
                                      </div>

                                      <div className="flex justify-between items-center text-[10px] border-t border-brand-surface-container/30 pt-2 font-bold text-brand-primary">
                                        <span>✓ Transferred to Available Balance</span>
                                        <span className="text-brand-on-surface-variant font-mono text-[9px]">SLA Verified</span>
                                      </div>
                                    </div>
                                  ))}

                                {/* Past Completed Tasks History */}
                                {COMPLETED_TASKS_MOCK.map((hist) => (
                                  <div key={hist.id} className="bg-brand-surface-lowest rounded-xl border border-brand-surface-container/60 p-4 space-y-2.5 shadow-xs text-left">
                                    <div className="flex justify-between items-start gap-3">
                                      <div>
                                        <span className="text-[8px] font-black text-brand-on-surface-variant block uppercase font-mono">REF INDEX #{hist.id}</span>
                                        <h4 className="text-xs font-extrabold text-brand-on-surface mt-0.5 leading-snug">{hist.taskTitle}</h4>
                                      </div>
                                      <span className="text-[10px] font-black font-mono text-brand-primary bg-brand-surface-low px-2 py-0.5 rounded shrink-0">₦{hist.reward}</span>
                                    </div>

                                    <div className="bg-brand-surface-low p-2 rounded text-[10px] text-brand-on-surface-variant space-y-1">
                                      <p className="flex justify-between"><span>Diagnostic Hardware:</span> <strong className="text-brand-on-surface">{hist.device}</strong></p>
                                      <p className="flex justify-between"><span>Completed Date:</span> <strong className="text-brand-on-surface">{hist.completedDate}</strong></p>
                                    </div>

                                    <div className="flex justify-between items-center text-[10px] border-t border-brand-surface-container/30 pt-2 font-bold text-brand-primary">
                                      <span>✓ Payout Settled &amp; Audited</span>
                                      <span className="text-brand-on-surface-variant font-mono text-[9px]">NIP Confirmed</span>
                                    </div>
                                  </div>
                                ))}
                              </>
                            )}
                          </div>
                        ) : (
                          /* Active submissions queue tab */
                          submissions.filter(s => s.status === 'Active').length === 0 ? (
                            <div className="bg-brand-surface-lowest rounded-xl p-8 border border-brand-surface-container text-center space-y-2 shadow-xs">
                              <Inbox className="w-6 h-6 text-brand-surface-dim mx-auto" />
                              <p className="text-[10px] font-bold text-brand-on-surface-variant uppercase">No active reviews</p>
                            </div>
                          ) : (
                            submissions
                              .filter(s => s.status === 'Active')
                              .map((sub) => (
                                <div key={sub.id} className="bg-brand-surface-lowest rounded-xl border border-brand-surface-container/60 p-4 space-y-2.5 shadow-xs text-left">
                                  <div className="flex justify-between items-start gap-3">
                                    <div>
                                      <span className="text-[8px] font-black text-brand-on-surface-variant block uppercase">REF INDEX #{sub.id}</span>
                                      <h4 className="text-xs font-extrabold text-brand-on-surface mt-0.5 leading-snug">{sub.taskTitle}</h4>
                                    </div>
                                    <span className="text-[10px] font-black font-mono text-brand-primary bg-brand-surface-low px-2 py-0.5 rounded">₦{sub.reward}</span>
                                  </div>

                                  <div className="bg-brand-surface-low p-2 rounded text-[10px] text-brand-on-surface-variant space-y-1">
                                    <p className="flex justify-between"><span>Diagnostic Hardware:</span> <strong className="text-brand-on-surface">{sub.device}</strong></p>
                                    <p className="flex justify-between"><span>Submitted Proof:</span> <strong className="text-brand-on-surface">{sub.file}</strong></p>
                                  </div>

                                  <div className="flex justify-between items-center text-[10px] border-t border-brand-surface-container/30 pt-2 font-bold">
                                    <span className="text-brand-primary">● In Employer QA Queue</span>
                                    <span className="text-brand-on-surface-variant">Unlocks in {sub.autoUnlockTime}</span>
                                  </div>

                                  {/* Auto-Release interactive action to approve the task */}
                                  <button 
                                    onClick={() => handleSimulateApproval(sub.id)}
                                    className="w-full mt-2 h-8 bg-brand-surface-low hover:bg-brand-surface-container text-brand-primary rounded-lg text-[9px] font-black uppercase tracking-wider transition-all border border-brand-surface-container/60 flex items-center justify-center gap-1 active:scale-[0.98]"
                                  >
                                    <span>Auto-Release SLA Escrow</span>
                                  </button>
                                </div>
                              ))
                          )
                        )}
                      </div>

                      {/* Dispute Support widget */}
                      <div className="bg-brand-surface-low rounded-xl p-3 border border-brand-surface-container text-center space-y-2">
                        <p className="text-[9px] text-brand-on-surface-variant leading-normal font-medium">
                          Need priority escrow review arbitration? File a support case.
                        </p>
                        <button 
                          onClick={() => setIsSupportOpen(true)}
                          className="h-8 px-3 rounded bg-brand-primary hover:bg-brand-primary-container text-white text-[9px] font-bold uppercase tracking-wider transition-colors shadow-xs"
                        >
                          Arbitrate Case
                        </button>
                      </div>

                    </div>
                  )}

                  {/* TAB SWITCH VIEW: WALLET */}
                  {activeTab === 'wallet' && (
                    <div className="space-y-4 flex-1 flex flex-col min-h-0">
                      
                      {/* Rich On-Surface Blue Wallet Card with Fixed Accent color font-mono */}
                      <div className="bg-brand-on-background text-white rounded-xl p-4 space-y-3 relative overflow-hidden border border-brand-inverse-surface shadow-md text-left">
                        <div className="absolute right-0 bottom-0 p-4 opacity-[0.03]">
                          <Wallet className="w-32 h-32 text-brand-surface-dim" />
                        </div>

                        <div className="space-y-3 relative z-10">
                          <div className="flex items-center justify-between">
                            <span className="text-[8px] font-bold text-brand-surface-dim uppercase tracking-widest block">SECURE WALLET</span>
                            <span className="text-[8px] bg-brand-inverse-surface border border-brand-inverse-on-surface/10 px-1.5 py-0.5 rounded text-brand-inverse-on-surface font-mono">NIBSS</span>
                          </div>

                          <div className="grid grid-cols-3 gap-2 border-t border-brand-inverse-surface/30 pt-3">
                            <div>
                              <span className="text-[8px] font-black text-brand-surface-dim uppercase block">Available</span>
                              {/* Highlight with primary fixed light green accent color from uploaded specs! */}
                              <p className="text-lg font-black font-mono tracking-tight leading-none text-brand-primary-fixed mt-1">
                                ₦{withdrawableBalance.toLocaleString()}
                              </p>
                            </div>
                            <div>
                              <span className="text-[8px] font-black text-brand-surface-dim uppercase block">In Escrow</span>
                              <p className="text-xs font-bold font-mono tracking-tight leading-none text-brand-inverse-on-surface/85 mt-1">
                                ₦{pendingBalance.toLocaleString()}
                              </p>
                            </div>
                            <div>
                              <span className="text-[8px] font-black text-brand-surface-dim uppercase block">Lifetime</span>
                              <p className="text-xs font-bold font-mono tracking-tight leading-none text-brand-inverse-on-surface/85 mt-1">
                                ₦{lifetimeDisbursed.toLocaleString()}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 7-DAY PERFORMANCE EARNINGS BAR CHART */}
                      {user && (
                        <div className="bg-brand-surface-lowest rounded-xl border border-brand-surface-container/60 p-4 space-y-3 shadow-xs text-left">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-black text-brand-on-surface uppercase tracking-wider block">7-Day Performance</span>
                            <span className="text-[8px] font-bold text-brand-primary bg-brand-surface-low px-1.5 py-0.5 rounded font-mono">⚡ ₦7,050 TOTAL</span>
                          </div>
                          <p className="text-[10px] text-brand-on-surface-variant leading-relaxed">
                            Contributor telemetry payouts processed and settled in the last 7 days.
                          </p>
                          
                          <div className="h-32 w-full mt-1">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart 
                                data={[
                                  { name: 'Wed', amount: 1200 },
                                  { name: 'Thu', amount: 2400 },
                                  { name: 'Fri', amount: 650 },
                                  { name: 'Sat', amount: 1500 },
                                  { name: 'Sun', amount: 0 },
                                  { name: 'Mon', amount: 1800 },
                                  { name: 'Tue', amount: 1500 }
                                ]} 
                                margin={{ top: 5, right: 5, left: -25, bottom: 0 }}
                              >
                                <XAxis 
                                  dataKey="name" 
                                  axisLine={false} 
                                  tickLine={false} 
                                  tick={{ fill: '#565e74', fontSize: 8, fontWeight: 700 }} 
                                />
                                <YAxis 
                                  axisLine={false} 
                                  tickLine={false} 
                                  tick={{ fill: '#565e74', fontSize: 8, fontWeight: 700 }} 
                                  tickFormatter={(v) => `₦${v}`}
                                />
                                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--color-brand-surface-low)', opacity: 0.4 }} />
                                <Bar 
                                  dataKey="amount" 
                                  fill="var(--color-brand-primary)" 
                                  radius={[3, 3, 0, 0]}
                                  barSize={16}
                                >
                                  {[
                                    { name: 'Wed', amount: 1200 },
                                    { name: 'Thu', amount: 2400 },
                                    { name: 'Fri', amount: 650 },
                                    { name: 'Sat', amount: 1500 },
                                    { name: 'Sun', amount: 0 },
                                    { name: 'Mon', amount: 1800 },
                                    { name: 'Tue', amount: 1500 }
                                  ].map((entry, index) => (
                                    <Cell 
                                      key={`cell-${index}`} 
                                      fill={entry.amount === 2400 ? 'var(--color-brand-primary)' : 'var(--color-brand-primary-container)'} 
                                    />
                                  ))}
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      )}

                      {/* Invite Dashboard UI */}
                      <div className="bg-brand-surface-lowest rounded-xl border border-brand-surface-container/60 p-4 space-y-3 shadow-xs text-left">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-black text-brand-on-surface uppercase tracking-wider block">Invite &amp; Earn ₦500 Program</span>
                          <span className="text-[8px] font-black text-brand-primary bg-brand-surface-low px-1.5 py-0.2 rounded font-mono">₦500 REWARD</span>
                        </div>
                        <p className="text-[11px] text-brand-on-surface-variant leading-relaxed font-medium">
                          Share your referral code. When a referred contributor registers using your code and completes their first task, BOTH instantly receive ₦500.
                        </p>
                        
                        <div className="flex items-center gap-2 bg-brand-surface-low border border-brand-surface-container rounded-lg p-2.5">
                          <div className="flex-1">
                            <span className="text-[8px] font-bold text-brand-on-surface-variant uppercase tracking-wider block">INVITE CODE</span>
                            <span className="text-xs font-black font-mono tracking-wider text-brand-primary">
                              {user.referralCode || `TP-TUNDE-8012`}
                            </span>
                          </div>
                          <button 
                            onClick={() => {
                              const code = user.referralCode || 'TP-TUNDE-8012';
                              navigator.clipboard.writeText(code);
                              setCopiedReferral(true);
                              setTimeout(() => setCopiedReferral(false), 2000);
                              triggerToast('Code Copied', 'Your unique TaskPulse referral code saved to clipboard.');
                            }}
                            className="px-2.5 py-1.5 bg-brand-primary hover:bg-brand-primary-container text-white rounded text-[10px] font-bold transition-all shrink-0 active:scale-[0.98]"
                          >
                            {copiedReferral ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                      </div>

                      {/* Direct Cashout Form */}
                      <div className="bg-brand-surface-lowest rounded-xl border border-brand-surface-container/60 p-4 space-y-3 shadow-xs text-left">
                        <span className="text-[10px] font-black text-brand-on-surface uppercase tracking-wider block">Direct Payout</span>
                        
                        {/* Selector */}
                        <div className="space-y-2">
                          <div className="flex justify-between items-center text-[10px] font-bold">
                            <span className="text-brand-on-surface-variant">Select Bank Account</span>
                            <button onClick={() => setIsAddingBank(true)} className="text-brand-primary hover:underline">+ Add Bank</button>
                          </div>
                          <div className="grid grid-cols-2 gap-1.5">
                            {savedBanks.map((b) => (
                              <div 
                                key={b.id} 
                                onClick={() => setSelectedBankId(b.id)}
                                className={`p-2 rounded-lg border text-[10px] cursor-pointer transition-all ${
                                  selectedBankId === b.id 
                                    ? 'border-brand-primary bg-brand-surface-low font-bold shadow-xs' 
                                    : 'border-brand-surface-container hover:border-brand-surface-high font-medium bg-brand-surface-lowest'
                                }`}
                              >
                                <p className="truncate text-brand-on-surface font-extrabold">{b.bankName}</p>
                                <p className="text-[9px] text-brand-on-surface-variant font-mono">•••• {b.accountNumber}</p>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Amount inputs */}
                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center text-[10px] font-bold text-brand-on-surface-variant">
                            <span>Amount to cash out (₦)</span>
                            <span className="font-mono text-brand-on-surface">Max: ₦{withdrawableBalance}</span>
                          </div>
                          <div className="flex gap-1.5">
                            <input 
                              type="number"
                              value={cashoutAmountInput}
                              onChange={(e) => setCashoutAmountInput(e.target.value)}
                              className="flex-1 h-9 px-2.5 rounded-lg border border-brand-surface-container bg-brand-surface-lowest text-xs font-semibold text-brand-on-surface focus:outline-none focus:border-brand-primary focus:ring-1 focus:ring-brand-primary/20"
                              required
                            />
                            <button 
                              onClick={() => setCashoutAmountInput(withdrawableBalance.toString())}
                              className="px-2.5 bg-brand-surface-low hover:bg-brand-surface-container text-brand-on-surface rounded-lg text-[10px] font-bold"
                            >
                              Max
                            </button>
                          </div>
                        </div>

                        <button 
                          onClick={(e) => { e.preventDefault(); setIsCashoutConfirming(true); }}
                          disabled={isCashoutProcessing}
                          className="w-full h-10 bg-brand-primary hover:bg-brand-primary-container text-white rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1 shadow-xs transition-transform active:scale-[0.98]"
                        >
                          {isCashoutProcessing ? 'Processing Payout...' : 'Confirm Cashout Now'}
                        </button>
                      </div>

                      {/* Convert to Data */}
                      <div className="space-y-2 text-left">
                        <span className="text-[10px] font-black text-brand-on-surface-variant uppercase tracking-widest block">Convert to Data</span>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="bg-brand-surface-lowest rounded-xl border border-brand-surface-container p-2.5 shadow-xs flex justify-between items-center">
                            <div>
                              <p className="text-[10px] font-extrabold text-brand-on-surface">MTN 5GB SME</p>
                              <span className="text-[9px] text-brand-primary font-mono font-bold">₦1,200</span>
                            </div>
                            <button onClick={() => handleRedeemUtility('MTN', '5GB SME', 1200)} className="px-2.5 py-1 bg-brand-primary hover:bg-brand-primary-container text-white text-[9px] font-bold rounded">Redeem</button>
                          </div>
                          <div className="bg-brand-surface-lowest rounded-xl border border-brand-surface-container p-2.5 shadow-xs flex justify-between items-center">
                            <div>
                              <p className="text-[10px] font-extrabold text-brand-on-surface">Airtel 2GB</p>
                              <span className="text-[9px] text-brand-primary font-mono font-bold">₦600</span>
                            </div>
                            <button onClick={() => handleRedeemUtility('Airtel', '2GB Direct', 600)} className="px-2.5 py-1 bg-brand-primary hover:bg-brand-primary-container text-white text-[9px] font-bold rounded">Redeem</button>
                          </div>
                        </div>
                      </div>

                      {/* Ledger */}
                      <div className="space-y-2 text-left pt-1">
                        <span className="text-[10px] font-black text-brand-on-surface-variant uppercase tracking-widest block">Settlement Ledger</span>
                        <div className="space-y-1.5">
                          {transactions.map((t) => (
                            <div key={t.id} className="bg-brand-surface-lowest rounded-xl p-2.5 border border-brand-surface-container/60 flex items-center justify-between text-[11px] shadow-xs">
                              <div>
                                <p className="font-extrabold text-brand-on-surface leading-none">{t.title}</p>
                                <span className="text-[8px] text-brand-on-surface-variant font-mono uppercase mt-1 block font-semibold">{t.sub} · {t.date}</span>
                              </div>
                              <div className="text-right">
                                <span className="font-bold font-mono text-brand-on-surface">{t.amount > 0 ? '+' : ''}₦{t.amount.toLocaleString()}</span>
                                <span className={`text-[8px] uppercase block font-black tracking-wider mt-0.5 ${t.amount > 0 ? 'text-brand-primary' : 'text-brand-secondary'}`}>{t.status}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                    </div>
                  )}

                </div>
              )}

            </div>

            {/* STICKY PHONE BOTTOM NAV BAR */}
            {user && (
              <nav className="bg-brand-surface-lowest border-t border-brand-surface-container/60 px-4 py-2 flex items-center justify-around shrink-0 relative z-40 pb-safe">
                <button 
                  onClick={() => { setActiveTab('earn'); }}
                  className={`flex flex-col items-center gap-0.5 ${activeTab === 'earn' ? 'text-brand-primary font-black scale-105' : 'text-brand-on-surface-variant/60'}`}
                >
                  <Compass className="w-5 h-5" />
                  <span className="text-[8px] uppercase tracking-wider font-extrabold">Earn</span>
                </button>
                <button 
                  onClick={() => { setActiveTab('submissions'); }}
                  className={`flex flex-col items-center gap-0.5 relative ${activeTab === 'submissions' ? 'text-brand-primary font-black scale-105' : 'text-brand-on-surface-variant/60'}`}
                >
                  <Inbox className="w-5 h-5" />
                  {submissions.filter(s => s.status === 'Active').length > 0 && (
                    <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-brand-primary text-white text-[7px] font-black flex items-center justify-center leading-none">
                      {submissions.filter(s => s.status === 'Active').length}
                    </span>
                  )}
                  <span className="text-[8px] uppercase tracking-wider font-extrabold">Submissions</span>
                </button>
                <button 
                  onClick={() => { setActiveTab('wallet'); }}
                  className={`flex flex-col items-center gap-0.5 ${activeTab === 'wallet' ? 'text-brand-primary font-black scale-105' : 'text-brand-on-surface-variant/60'}`}
                >
                  <Wallet className="w-5 h-5" />
                  <span className="text-[8px] uppercase tracking-wider font-extrabold">Wallet</span>
                </button>
              </nav>
            )}

            {/* BOTTOM HOME INDICATOR */}
            <div className="bg-brand-surface-lowest py-1.5 shrink-0 flex justify-center z-50">
              <div className="w-28 h-1 bg-brand-surface-container rounded-full"></div>
            </div>

          </div>
        </div>

      </div>

      {/* PARENT BODY CONTAINER POPUPS */}

      {/* POPUP: ADD BANK */}
      {isAddingBank && (
        <div className="fixed inset-0 z-50 bg-brand-on-surface/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-brand-surface-lowest rounded-2xl border border-brand-surface-container shadow-2xl max-w-sm w-full p-6 space-y-4 text-brand-on-surface">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-sm font-extrabold text-brand-on-surface uppercase">Link Bank Account</h3>
                <p className="text-xs text-brand-on-surface-variant mt-0.5">Add verified NUBAN destination details.</p>
              </div>
              <button 
                onClick={() => setIsAddingBank(false)}
                className="w-7 h-7 rounded-lg hover:bg-brand-surface-low flex items-center justify-center text-brand-on-surface-variant"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddBank} className="space-y-3">
              <div className="space-y-1 text-left">
                <label className="text-[9px] font-bold text-brand-on-surface-variant uppercase">Bank Provider</label>
                <select 
                  value={newBankName} 
                  onChange={(e) => setNewBankName(e.target.value)}
                  className="w-full h-10 px-2 rounded-lg border border-brand-surface-container text-xs font-semibold focus:outline-none bg-brand-surface-lowest"
                >
                  <option value="Moniepoint MFB">Moniepoint MFB</option>
                  <option value="Access Bank PLC">Access Bank PLC</option>
                  <option value="OPay Digital Services">OPay Digital Services</option>
                  <option value="Kuda Bank">Kuda Bank</option>
                  <option value="Guaranty Trust Bank (GTB)">Guaranty Trust Bank (GTB)</option>
                </select>
              </div>

              <div className="space-y-1 text-left">
                <label className="text-[9px] font-bold text-brand-on-surface-variant uppercase">NUBAN Account (10 digits)</label>
                <input 
                  type="text" 
                  maxLength={10}
                  placeholder="0123456789"
                  value={newAccountNumber}
                  onChange={(e) => setNewAccountNumber(e.target.value.replace(/\D/g, ''))}
                  className="w-full h-10 px-2.5 rounded-lg border border-brand-surface-container text-xs font-semibold focus:outline-none bg-brand-surface-lowest"
                  required
                />
              </div>

              <div className="space-y-1 text-left">
                <label className="text-[9px] font-bold text-brand-on-surface-variant uppercase">Auto-resolved Owner</label>
                <input 
                  type="text" 
                  value={newAccountName}
                  disabled 
                  className="w-full h-10 px-2.5 rounded-lg border border-brand-surface-container text-xs font-semibold bg-brand-surface-low cursor-not-allowed font-mono"
                />
              </div>

              <button 
                type="submit"
                className="w-full h-10 bg-brand-primary text-white rounded-lg text-xs font-bold uppercase hover:bg-brand-primary-container mt-2 transition-all active:scale-[0.98] shadow-sm"
              >
                Link Verified Bank NIP
              </button>
            </form>
          </div>
        </div>
      )}

      {/* POPUP: CONFIRM CASHOUT REASSURANCE */}
      {isCashoutConfirming && (
        <div className="fixed inset-0 z-50 bg-brand-on-surface/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-brand-surface-lowest rounded-2xl border border-brand-surface-container shadow-2xl max-w-sm w-full p-6 space-y-4 text-brand-on-surface">
            <div className="text-center space-y-2">
              <Shield className="w-10 h-10 text-brand-primary mx-auto" />
              <h3 className="text-sm font-black uppercase tracking-wider">Confirm Instant NIP Settlement</h3>
              <p className="text-xs text-brand-on-surface-variant">
                You are initiating a direct payout of <strong className="text-brand-on-surface font-mono font-bold">₦{parseFloat(cashoutAmountInput).toLocaleString()}</strong>.
              </p>
            </div>

            <div className="bg-brand-surface-low border border-brand-surface-container rounded-xl p-3 text-xs text-brand-on-surface-variant space-y-1">
              <p className="flex justify-between"><span>Withdrawable Amount:</span> <strong className="text-brand-on-surface font-bold">₦{withdrawableBalance}</strong></p>
              <p className="flex justify-between font-bold"><span>Amount to cash out:</span> <strong className="text-brand-on-surface font-black">-₦{cashoutAmountInput}</strong></p>
              <p className="flex justify-between border-t border-brand-surface-container/60 pt-1.5 font-bold"><span>Remaining Balance:</span> <strong className="text-brand-on-surface font-black">₦{withdrawableBalance - parseFloat(cashoutAmountInput)}</strong></p>
            </div>

            <div className="flex gap-2">
              <button 
                onClick={() => setIsCashoutConfirming(false)}
                className="flex-1 h-10 rounded-lg border border-brand-surface-container text-xs font-bold text-brand-on-surface-variant"
              >
                Cancel
              </button>
              <button 
                onClick={handleCashout}
                className="flex-1 h-10 rounded-lg bg-brand-primary hover:bg-brand-primary-container text-white font-bold text-xs"
              >
                Disburse Payout
              </button>
            </div>
          </div>
        </div>
      )}

      {/* POPUP: SUPPORT CASE FORM */}
      {isSupportOpen && (
        <div className="fixed inset-0 z-50 bg-brand-on-surface/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-brand-surface-lowest rounded-2xl border border-brand-surface-container shadow-2xl max-w-sm w-full p-6 space-y-4 text-brand-on-surface">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-sm font-extrabold text-brand-on-surface uppercase">Contact Dispute Desk</h3>
                <p className="text-xs text-brand-on-surface-variant mt-0.5">Priority review or evaluation arbitration.</p>
              </div>
              <button 
                onClick={() => setIsSupportOpen(false)}
                className="w-7 h-7 rounded-lg hover:bg-brand-surface-low flex items-center justify-center text-brand-on-surface-variant"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSupportSubmit} className="space-y-3">
              <textarea 
                rows={4}
                value={supportMessage}
                onChange={(e) => setSupportMessage(e.target.value)}
                placeholder="List your proof index, target APK build status, and reasons for review..."
                className="w-full p-3 rounded-lg border border-brand-surface-container text-xs font-medium focus:outline-none bg-brand-surface-lowest text-brand-on-surface"
                required
              />
              <button 
                type="submit"
                className="w-full h-10 bg-brand-primary text-white font-bold text-xs uppercase hover:bg-brand-primary-container rounded-lg transition-all active:scale-[0.98] shadow-sm"
              >
                File Dispute Case
              </button>
            </form>
          </div>
        </div>
      )}

      {/* POPUP: UTILITY REDEEM CONFIRMATION */}
      {isUtilityRedeeming && utilitySelected && (
        <div className="fixed inset-0 z-50 bg-brand-on-surface/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-brand-surface-lowest rounded-2xl border border-brand-surface-container shadow-2xl max-w-sm w-full p-6 space-y-4 text-brand-on-surface">
            <div className="text-center space-y-2">
              <h3 className="text-sm font-extrabold uppercase tracking-wider text-brand-on-surface">Confirm Data Purchase</h3>
              <p className="text-xs text-brand-on-surface-variant">
                Convert <strong className="text-brand-on-surface font-mono font-bold">₦{utilitySelected.price.toLocaleString()}</strong> of your withdrawable balance to purchase <strong className="text-brand-on-surface font-bold">{utilitySelected.provider} {utilitySelected.name}</strong>?
              </p>
            </div>

            <div className="bg-brand-surface-low border border-brand-surface-container rounded-xl p-3 text-xs text-brand-on-surface-variant space-y-1">
              <p className="flex justify-between"><span>Withdrawable Balance:</span> <span className="font-mono text-brand-on-surface">₦{withdrawableBalance.toLocaleString()}</span></p>
              <p className="flex justify-between font-bold"><span>Voucher Cost:</span> <span className="font-mono text-brand-on-surface">-₦{utilitySelected.price.toLocaleString()}</span></p>
              <p className="flex justify-between border-t border-brand-surface-container/60 pt-1.5 font-bold"><span>Remaining Balance:</span> <span className="font-mono text-brand-on-surface">₦{(withdrawableBalance - utilitySelected.price).toLocaleString()}</span></p>
            </div>

            <div className="flex gap-2">
              <button 
                onClick={() => { setIsUtilityRedeeming(false); setUtilitySelected(null); }}
                className="flex-1 h-10 rounded-lg border border-brand-surface-container text-brand-on-surface-variant font-bold text-xs"
              >
                Cancel
              </button>
              <button 
                onClick={handleConfirmUtility}
                className="flex-1 h-10 rounded-lg bg-brand-primary hover:bg-brand-primary-container text-white font-bold text-xs shadow-sm"
              >
                Confirm Purchase
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DYNAMIC NOTIFICATION TOAST */}
      <div 
        className={`fixed bottom-4 right-4 z-50 bg-brand-on-background border border-brand-inverse-surface text-white p-4 rounded-xl shadow-2xl flex items-center justify-between gap-3 transform transition-all duration-300 max-w-sm w-full ${
          toast.show ? 'translate-y-0 opacity-100 pointer-events-auto' : 'translate-y-12 opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-brand-primary-fixed shrink-0 animate-bounce" />
          <div className="text-left">
            <p className="text-xs font-bold text-white leading-tight">{toast.title}</p>
            <p className="text-[10px] text-brand-surface-dim font-medium mt-0.5 leading-snug">{toast.subtitle}</p>
          </div>
        </div>
        <button 
          onClick={() => setToast((p) => ({ ...p, show: false }))}
          className="text-slate-400 hover:text-white shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

    </div>
  );
}

/**
 * TaskPulse: free-to-join micro-task marketplace.
 * Businesses fund campaigns via Paystack; workers earn from approved tasks.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { AlertTriangle, Briefcase, CheckSquare, Compass, History, Moon, Sun, User, Wallet } from 'lucide-react';
import { triggerConfetti } from './utils/confetti';
import {
  checkInStreakRpc,
  fetchActiveTasks,
  fetchBankAccounts,
  fetchReferralsHistory,
  fetchTaskCompletionsHistory,
  fetchTransactionsHistory,
  getCurrentUserProfile,
  isSupabaseConfigured,
  signOutUser,
  supabase,
  type DbTask,
} from './lib/supabaseClient';
import { verifyPayment } from './lib/api';
import { fetchMarketplaceSettings } from './lib/marketplace';
import { DEFAULT_MARKETPLACE_SETTINGS, formatNaira, type MarketplaceSettings } from './config/marketplace';
import type { MySubmission, ReferralItem, SavedBank, TxItem, UserProfile } from './types';
import { Toast } from './components/ui';
import { Landing } from './components/Landing';
import { AuthModal, type AccountType, type AuthMode } from './components/AuthModal';
import { TermsModal } from './components/TermsModal';
import { HomeTab } from './components/HomeTab';
import { TasksTab } from './components/TasksTab';
import { WalletTab } from './components/WalletTab';
import { HistoryTab } from './components/HistoryTab';
import { ProfileTab } from './components/ProfileTab';
import { BusinessTab } from './components/BusinessTab';

type Tab = 'home' | 'tasks' | 'wallet' | 'history' | 'business' | 'profile';

const lagosToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });

export default function App() {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => localStorage.getItem('taskpulse_theme') !== 'light');
  const [isOnline, setIsOnline] = useState<boolean>(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  const [settings, setSettings] = useState<MarketplaceSettings>(DEFAULT_MARKETPLACE_SETTINGS);
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [booting, setBooting] = useState(true);

  const [user, setUser] = useState<UserProfile | null>(null);
  const [tasks, setTasks] = useState<DbTask[]>([]);
  const [transactions, setTransactions] = useState<TxItem[]>([]);
  const [submissions, setSubmissions] = useState<MySubmission[]>([]);
  const [referrals, setReferrals] = useState<ReferralItem[]>([]);
  const [banks, setBanks] = useState<SavedBank[]>([]);

  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('signup');
  const [authAccountType, setAuthAccountType] = useState<AccountType>('worker');
  const [referralCode, setReferralCode] = useState<string>(() => localStorage.getItem('taskpulse_ref_code') || '');
  const [termsOpen, setTermsOpen] = useState<null | 'terms' | 'privacy'>(null);
  const [pendingBusinessIntent, setPendingBusinessIntent] = useState(false);

  const [toast, setToast] = useState({ title: '', subtitle: '', show: false });
  const toastTimer = useRef<number | undefined>(undefined);
  const notify = useCallback((title: string, subtitle: string) => {
    setToast({ title, subtitle, show: true });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(t => ({ ...t, show: false })), 4500);
  }, []);

  useEffect(() => {
    localStorage.setItem('taskpulse_theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const loadTasks = useCallback(async () => {
    setTasks(await fetchActiveTasks());
  }, []);

  const refreshUserData = useCallback(async () => {
    if (!supabase) return;
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    if (!authUser) {
      setUser(null);
      return;
    }
    const p: any = await getCurrentUserProfile();
    if (!p) return;
    setUser({
      id: p.id,
      username: p.username || 'user',
      fullName: p.full_name || '',
      email: p.email || authUser.email || '',
      phone: p.phone || '',
      role: (p.role as UserProfile['role']) || 'worker',
      businessName: p.business_name || null,
      emailConfirmed: Boolean(authUser.email_confirmed_at),
      kycStatus: p.kyc_status || 'unverified',
      withdrawableBalance: Number(p.withdrawable_balance || 0),
      pendingBalance: Number(p.pending_balance || 0),
      totalWithdrawnLifetime: Number(p.total_withdrawn_lifetime || 0),
      streakDays: Number(p.streak_days || 0),
      checkedInToday: p.streak_last_claimed_date === lagosToday(),
      referralCode: p.referral_code || '',
      approvedTaskCount: Number(p.approved_task_count || 0),
      firstTaskApprovedAt: p.first_task_approved_at || null,
      payoutEligibleFrom: p.payout_eligible_from || null,
      isLegacyMember: Boolean(p.is_legacy_member),
      createdAt: p.created_at,
    });

    const [tx, comp, refs, bankRes] = await Promise.all([
      fetchTransactionsHistory(authUser.id, 'all', 100),
      fetchTaskCompletionsHistory(authUser.id, 50),
      fetchReferralsHistory(authUser.id, 50),
      fetchBankAccounts(authUser.id),
    ]);
    setTransactions(
      (tx.data || []).map((t: any) => ({
        id: t.id,
        type: t.type,
        title: t.title || '',
        description: t.description || '',
        amount: Number(t.amount || 0),
        status: t.status || 'settled',
        reference: t.reference || '',
        createdAt: t.created_at,
        destinationBank: t.destination_bank,
      }))
    );
    setSubmissions(
      (comp.data || []).map((c: any) => ({
        id: c.id,
        taskId: c.task_id,
        taskTitle: c.task_title,
        company: c.company,
        reward: Number(c.reward_amount || 0),
        paidAmount: c.paid_amount === null || c.paid_amount === undefined ? null : Number(c.paid_amount),
        status: c.status,
        reviewNote: c.review_note,
        completedAt: c.completed_at,
      }))
    );
    setReferrals(
      (refs.data || []).map((r: any) => ({
        id: r.id,
        username: r.referee_username || 'user',
        name: r.referee_name || '',
        bonusStatus: r.bonus_status || 'pending',
        bonusReferrerAmount: Number(r.bonus_referrer_amount || 0),
        createdAt: r.created_at,
      }))
    );
    setBanks(
      (bankRes.data || []).map((b: any) => ({
        id: b.id,
        bankCode: b.bank_code,
        bankName: b.bank_name,
        accountName: b.account_name,
        accountNumber: b.account_number,
      }))
    );
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshUserData(), loadTasks()]);
  }, [refreshUserData, loadTasks]);

  // Boot: settings, tasks, session, URL params (referral + Paystack callback)
  useEffect(() => {
    fetchMarketplaceSettings().then(setSettings);
    loadTasks();

    // Clean Supabase auth error hashes (e.g. expired confirmation links)
    if (window.location.hash.includes('error')) {
      const hp = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const desc = hp.get('error_description');
      window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
      if (desc) notify('Link problem', desc.replace(/\+/g, ' '));
    }

    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref') || params.get('referral');
    if (ref) {
      const clean = ref.trim().toUpperCase().slice(0, 40);
      localStorage.setItem('taskpulse_ref_code', clean);
      setReferralCode(clean);
    }
    const payRef = params.get('verify_payment') || params.get('verify_deposit') || params.get('reference') || params.get('trxref');
    if (ref || payRef) window.history.replaceState({}, document.title, window.location.pathname);

    if (payRef) {
      notify('Confirming payment', 'Checking with Paystack…');
      verifyPayment(payRef)
        .then(async res => {
          if (res.data?.kind === 'campaign') {
            const dup = res.data.settleResult?.duplicate && res.data.settleResult?.status === 'duplicate_needs_refund';
            if (dup) {
              notify('Payment received twice', 'This campaign was already funded. Contact support for a refund of the extra payment.');
            } else {
              triggerConfetti();
              notify('Campaign is live!', `${formatNaira(res.data.amount)} received. Workers can now see your task.`);
            }
            setActiveTab('business');
          } else {
            notify('Payment confirmed', 'Your earlier payment has been credited to your wallet.');
          }
          await refreshAll();
        })
        .catch(err => notify('Payment not confirmed', err.message || 'We could not confirm this payment yet.'));
    }

    if (!isSupabaseConfigured || !supabase) {
      setBooting(false);
      return;
    }
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        await refreshUserData();
      } else if (ref) {
        setAuthMode('signup');
        setAuthAccountType('worker');
        setAuthOpen(true);
      }
      setBooting(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        refreshUserData();
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        setTransactions([]);
        setSubmissions([]);
        setReferrals([]);
        setBanks([]);
        setActiveTab('home');
      }
    });
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openAuth = (mode: AuthMode, type: AccountType = 'worker') => {
    setAuthMode(mode);
    setAuthAccountType(type);
    setPendingBusinessIntent(type === 'business');
    setAuthOpen(true);
  };

  const handleCheckIn = async () => {
    try {
      const res = await checkInStreakRpc();
      notify('Checked in', `${res?.streak_days ?? ''}-day streak. Keep it going!`);
      await refreshUserData();
    } catch (err: any) {
      notify('Check-in', err.message);
    }
  };

  const handleSignOut = async () => {
    await signOutUser();
    setUser(null);
    setActiveTab('home');
    notify('Signed out', 'See you soon.');
  };

  const isBusiness = user?.role === 'business' || user?.role === 'admin';
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'home', label: 'Home', icon: <Compass className="w-5 h-5" /> },
    { id: 'tasks', label: 'Tasks', icon: <CheckSquare className="w-5 h-5" /> },
    ...(isBusiness ? [{ id: 'business' as Tab, label: 'Business', icon: <Briefcase className="w-5 h-5" /> }] : []),
    { id: 'wallet', label: 'Wallet', icon: <Wallet className="w-5 h-5" /> },
    { id: 'history', label: 'History', icon: <History className="w-5 h-5" /> },
    { id: 'profile', label: 'Profile', icon: <User className="w-5 h-5" /> },
  ];

  return (
    <div
      className={`h-[100dvh] w-full overflow-hidden flex flex-col items-center justify-center p-0 md:p-3 transition-colors duration-300 ${
        isDarkMode ? 'dark bg-[#070709] text-white' : 'bg-[#eef2f6] text-slate-900'
      }`}
    >
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute top-[-10%] right-[-10%] w-[550px] h-[550px] rounded-full bg-blue-500/5 dark:bg-cyan-500/15 blur-[140px] animate-float-slow"></div>
        <div className="absolute bottom-[-10%] left-[-10%] w-[650px] h-[650px] rounded-full bg-indigo-500/5 dark:bg-sky-500/10 blur-[150px] animate-float-slow [animation-delay:2.5s]"></div>
      </div>

      <div
        className={`relative z-10 w-full max-w-md h-full md:max-h-[852px] ${
          isDarkMode
            ? 'dark bg-[#0c0d12] text-white md:border-white/[0.08]'
            : 'bg-[#f8fafc] text-slate-900 md:border-slate-200/90 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.08)]'
        } md:rounded-[46px] shadow-2xl md:border overflow-hidden flex flex-col transition-colors duration-300`}
      >
        {!isOnline && (
          <div className="bg-rose-600 text-white text-[11px] font-bold py-1.5 px-3 flex items-center justify-center gap-1.5 shrink-0 z-50">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>You are offline. Reconnecting…</span>
          </div>
        )}

        <header className="px-5 py-3.5 bg-white/95 dark:bg-[#0c0d12]/95 backdrop-blur-xl border-b border-slate-200/80 dark:border-white/[0.06] flex items-center justify-between shrink-0 z-40">
          <button type="button" className="flex items-center gap-2 cursor-pointer" onClick={() => setActiveTab('home')}>
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-sky-500 via-cyan-400 to-blue-600 flex items-center justify-center text-white font-black text-sm shadow-md shadow-sky-500/30">
              ⚡
            </div>
            <div className="text-left">
              <span className="text-base font-black tracking-tight bg-gradient-to-r from-sky-600 via-cyan-500 to-blue-600 dark:from-sky-400 dark:via-cyan-300 dark:to-blue-400 bg-clip-text text-transparent">
                TaskPulse
              </span>
              <span className="text-[9px] block font-extrabold text-sky-600 dark:text-cyan-400 tracking-wider uppercase leading-none">
                {user ? (isBusiness ? 'Business' : 'Free member') : 'No deposit, ever'}
              </span>
            </div>
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsDarkMode(d => !d)}
              className="w-9 h-9 rounded-2xl bg-slate-100 dark:bg-zinc-900 border border-slate-200/60 dark:border-white/[0.08] flex items-center justify-center text-slate-700 dark:text-yellow-400 cursor-pointer"
              title="Toggle theme"
            >
              {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            {user ? (
              <button
                type="button"
                onClick={() => setActiveTab('profile')}
                className="flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-2xl bg-sky-50 dark:bg-zinc-900 border border-sky-200 dark:border-white/[0.08] cursor-pointer"
              >
                <div className="w-6 h-6 rounded-xl bg-gradient-to-tr from-sky-500 to-cyan-400 text-white flex items-center justify-center text-[10px] font-black">
                  {user.username.slice(0, 1).toUpperCase()}
                </div>
                <span className="text-[11px] font-black text-slate-800 dark:text-zinc-100">{formatNaira(user.withdrawableBalance)}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => openAuth('signin')}
                className="px-3.5 h-9 rounded-2xl bg-sky-500 text-white text-[11px] font-black cursor-pointer"
              >
                Sign in
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto no-scrollbar px-4 pt-4">
          {booting ? (
            <div className="h-full flex items-center justify-center text-xs text-slate-400">Loading…</div>
          ) : !user ? (
            <Landing
              settings={settings}
              tasks={tasks}
              onStartEarning={() => openAuth('signup', 'worker')}
              onPostTasks={() => openAuth('signup', 'business')}
              onSignIn={() => openAuth('signin')}
            />
          ) : activeTab === 'home' ? (
            <HomeTab
              user={user}
              settings={settings}
              referrals={referrals}
              availableTaskCount={tasks.length}
              onCheckIn={handleCheckIn}
              onGoto={setActiveTab}
              notify={notify}
            />
          ) : activeTab === 'tasks' ? (
            <TasksTab user={user} tasks={tasks} submissions={submissions} onSubmitted={refreshAll} notify={notify} />
          ) : activeTab === 'wallet' ? (
            <WalletTab user={user} settings={settings} banks={banks} transactions={transactions} onChanged={refreshUserData} notify={notify} />
          ) : activeTab === 'history' ? (
            <HistoryTab transactions={transactions} />
          ) : activeTab === 'business' ? (
            <BusinessTab user={user} settings={settings} onChanged={refreshAll} notify={notify} />
          ) : (
            <ProfileTab
              user={user}
              isDarkMode={isDarkMode}
              onToggleTheme={() => setIsDarkMode(d => !d)}
              onChanged={refreshUserData}
              onOpenTerms={() => setTermsOpen('terms')}
              onSignOut={handleSignOut}
              onGotoBusiness={() => setActiveTab('business')}
              notify={notify}
            />
          )}
        </main>

        {user && (
          <nav className="glass-dock px-2 py-2 shrink-0 z-40 flex items-center justify-around">
            {tabs.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`flex flex-col items-center gap-1 py-1.5 px-2.5 rounded-2xl tactile-button cursor-pointer ${
                  activeTab === t.id
                    ? 'bg-sky-500/10 dark:bg-cyan-500/15 text-sky-600 dark:text-cyan-400 border border-sky-500/25 dark:border-cyan-400/30 shadow-xs'
                    : 'text-slate-400 hover:text-slate-700 dark:text-zinc-500 dark:hover:text-zinc-200'
                }`}
              >
                {t.icon}
                <span className="text-[10px] font-black tracking-tight">{t.label}</span>
              </button>
            ))}
          </nav>
        )}
      </div>

      <AuthModal
        open={authOpen}
        initialMode={authMode}
        initialAccountType={authAccountType}
        referralCode={referralCode}
        onClose={() => setAuthOpen(false)}
        onSignedIn={async () => {
          setAuthOpen(false);
          await refreshUserData();
          setActiveTab(pendingBusinessIntent ? 'business' : 'home');
          setPendingBusinessIntent(false);
        }}
        onOpenTerms={tab => setTermsOpen(tab)}
        notify={notify}
      />
      {termsOpen && <TermsModal key={termsOpen} open onClose={() => setTermsOpen(null)} initialTab={termsOpen} settings={settings} />}
      <Toast show={toast.show} title={toast.title} subtitle={toast.subtitle} onClose={() => setToast(t => ({ ...t, show: false }))} />
      <Analytics />
    </div>
  );
}

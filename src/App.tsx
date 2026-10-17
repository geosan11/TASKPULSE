/**
 * TaskPulse: free-to-join micro-task marketplace.
 * Businesses fund campaigns via Paystack; workers earn from approved tasks.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { CheckSquare, Home, Moon, Sun, User, Wallet, WifiOff } from 'lucide-react';
import { celebrate } from './lib/celebrate';
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
import { fetchMarketplaceSettings, fetchMyCampaigns } from './lib/marketplace';
import { DEFAULT_MARKETPLACE_SETTINGS, formatNaira, type MarketplaceSettings } from './config/marketplace';
import type { MySubmission, ReferralItem, SavedBank, TxItem, UserProfile } from './types';
import { Toast } from './components/ui';
import { Landing } from './components/Landing';
import { AuthModal, type AccountType, type AuthMode } from './components/AuthModal';
import { TermsModal } from './components/TermsModal';
import { HomeTab } from './components/HomeTab';
import { TasksTab } from './components/TasksTab';
import { WalletTab } from './components/WalletTab';
import { Celebration } from './components/Celebration';
import { ProfileTab } from './components/ProfileTab';
import { BusinessTab } from './components/BusinessTab';

type Tab = 'home' | 'tasks' | 'wallet' | 'profile';

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
  const [selectedTask, setSelectedTask] = useState<DbTask | null>(null);
  const [businessModePref, setBusinessModePref] = useState<boolean | null>(() => {
    const v = localStorage.getItem('taskpulse_business_mode');
    return v === null ? null : v === '1';
  });
  const setBusinessMode = (on: boolean) => {
    localStorage.setItem('taskpulse_business_mode', on ? '1' : '0');
    setBusinessModePref(on);
  };

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

  const [pendingReviewCount, setPendingReviewCount] = useState(0);

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
              celebrate('Your task is live!', `${formatNaira(res.data.amount)} received. People can start now.`);
            }
            setBusinessMode(true);
            setActiveTab('tasks');
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
  // Business mode defaults to ON for business accounts until they switch it off.
  const businessMode = Boolean(isBusiness && (businessModePref ?? true));

  useEffect(() => {
    if (!user || !businessMode) {
      setPendingReviewCount(0);
      return;
    }
    let cancelled = false;
    fetchMyCampaigns()
      .then(cs => {
        if (!cancelled) setPendingReviewCount(cs.reduce((n, c) => n + (c.slotsPending || 0), 0));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user, businessMode, activeTab]);

  const goto = (tab: Tab) => {
    if (tab !== 'tasks') setSelectedTask(null);
    setActiveTab(tab);
  };

  // Nav badges: open tasks the worker hasn't submitted yet, or (business
  // mode) proofs waiting for the business to review.
  const submittedTaskIds = new Set(submissions.map(s => s.taskId));
  const availableTaskCount = tasks.filter(t => !submittedTaskIds.has(t.id)).length;
  const tasksBadge = businessMode ? pendingReviewCount : availableTaskCount;

  const tabs: { id: Tab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'home', label: 'Home', icon: <Home className="w-6 h-6" /> },
    { id: 'tasks', label: businessMode ? 'Campaigns' : 'Tasks', icon: <CheckSquare className="w-6 h-6" />, badge: tasksBadge },
    { id: 'wallet', label: 'Wallet', icon: <Wallet className="w-6 h-6" /> },
    { id: 'profile', label: 'Profile', icon: <User className="w-6 h-6" /> },
  ];

  return (
    <div className={`h-[100dvh] w-full overflow-hidden flex justify-center ${isDarkMode ? 'dark bg-ink' : 'bg-zinc-100'}`}>
      <div className="relative w-full max-w-md h-full flex flex-col bg-white dark:bg-ink text-ink dark:text-white sm:border-x sm:border-zinc-200 dark:sm:border-zinc-900">
        {!isOnline && (
          <div className="bg-ink text-white dark:bg-white dark:text-ink text-sm font-semibold py-2 px-3 flex items-center justify-center gap-2 shrink-0 z-50">
            <WifiOff className="w-4 h-4" /> You're offline
          </div>
        )}

        <header className="px-5 h-16 flex items-center justify-between shrink-0 z-40 bg-white/90 dark:bg-ink/90 backdrop-blur">
          <button type="button" className="h-11 cursor-pointer" onClick={() => goto('home')} aria-label="TaskPulse home">
            <img
              src={isDarkMode ? '/brand/logo-lockup-dark.png' : '/brand/logo-lockup-light.png'}
              alt="TaskPulse"
              className={`h-11 w-auto -ml-1 ${isDarkMode ? 'logo-on-dark' : 'logo-on-light'}`}
              draggable={false}
            />
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsDarkMode(d => !d)}
              className="tactile w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center text-ink dark:text-white cursor-pointer"
              aria-label="Toggle theme"
            >
              {isDarkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            {user ? (
              <button
                type="button"
                onClick={() => goto('profile')}
                aria-label="Profile"
                className="tactile w-10 h-10 rounded-full bg-pulse-500 text-ink flex items-center justify-center text-base font-extrabold cursor-pointer"
              >
                {user.username.slice(0, 1).toUpperCase()}
              </button>
            ) : (
              <button type="button" onClick={() => openAuth('signin')} className="tactile h-10 px-4 rounded-full bg-ink text-white dark:bg-white dark:text-ink text-sm font-bold cursor-pointer">
                Sign in
              </button>
            )}
          </div>
        </header>

        <main
          className={`flex-1 overflow-y-auto no-scrollbar px-5 pt-2 ${
            user ? 'pb-[calc(env(safe-area-inset-bottom)+108px)]' : ''
          }`}
        >
          {booting ? (
            <div className="h-full flex items-center justify-center text-sm text-zinc-400">Loading…</div>
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
              tasks={tasks}
              businessMode={businessMode}
              onCheckIn={handleCheckIn}
              onOpenTask={t => {
                setSelectedTask(t);
                setActiveTab('tasks');
              }}
              onGoto={goto}
            />
          ) : activeTab === 'tasks' ? (
            businessMode ? (
              <BusinessTab user={user} settings={settings} onChanged={refreshAll} notify={notify} />
            ) : (
              <TasksTab user={user} tasks={tasks} submissions={submissions} selected={selectedTask} onSelect={setSelectedTask} onSubmitted={refreshAll} />
            )
          ) : activeTab === 'wallet' ? (
            <WalletTab user={user} settings={settings} banks={banks} transactions={transactions} onChanged={refreshUserData} notify={notify} />
          ) : (
            <ProfileTab
              user={user}
              settings={settings}
              referrals={referrals}
              isDarkMode={isDarkMode}
              businessMode={businessMode}
              onBusinessModeChange={on => {
                setBusinessMode(on);
                if (on) goto('tasks');
              }}
              onToggleTheme={() => setIsDarkMode(d => !d)}
              onChanged={refreshUserData}
              onOpenTerms={() => setTermsOpen('terms')}
              onSignOut={handleSignOut}
              notify={notify}
            />
          )}
        </main>

        {user && (
          <nav
            aria-label="Main"
            className="absolute z-40 left-3 right-3 bottom-[calc(env(safe-area-inset-bottom)+12px)] rounded-full p-1.5 border border-zinc-200/80 dark:border-white/10 bg-white/[0.92] dark:bg-zinc-900/70 backdrop-blur-xl backdrop-saturate-150 shadow-[0_8px_30px_rgba(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgba(0,0,0,0.55)]"
          >
            <div className="relative grid grid-cols-4">
              {/* Sliding active pill */}
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-1/4 rounded-full bg-pulse-500/15 dark:bg-pulse-500/20 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                style={{ transform: `translateX(${Math.max(0, tabs.findIndex(t => t.id === activeTab)) * 100}%)` }}
              />
              {tabs.map(t => {
                const active = activeTab === t.id;
                const badge = t.badge && t.badge > 0 ? (t.badge > 99 ? '99+' : String(t.badge)) : null;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => goto(t.id)}
                    aria-current={active ? 'page' : undefined}
                    aria-label={badge ? `${t.label}, ${badge} new` : t.label}
                    className={`tactile relative z-10 flex flex-col items-center justify-center gap-0.5 h-14 rounded-full cursor-pointer transition-colors duration-200 ${
                      active ? 'text-pulse-800 dark:text-pulse-500' : 'text-zinc-600 dark:text-white'
                    }`}
                  >
                    <span className="relative">
                      {t.icon}
                      {badge && (
                        <span className="absolute -top-1.5 left-[60%] min-w-[20px] h-5 px-1.5 rounded-full bg-pulse-500 text-white text-[11px] font-bold leading-5 text-center ring-2 ring-white dark:ring-zinc-900">
                          {badge}
                        </span>
                      )}
                    </span>
                    <span className={`text-xs ${active ? 'font-bold' : 'font-semibold'}`}>{t.label}</span>
                  </button>
                );
              })}
            </div>
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
          if (pendingBusinessIntent) setBusinessMode(true);
          goto(pendingBusinessIntent ? 'tasks' : 'home');
          setPendingBusinessIntent(false);
        }}
        onOpenTerms={tab => setTermsOpen(tab)}
        notify={notify}
      />
      {termsOpen && <TermsModal key={termsOpen} open onClose={() => setTermsOpen(null)} initialTab={termsOpen} settings={settings} />}
      <Toast show={toast.show} title={toast.title} subtitle={toast.subtitle} onClose={() => setToast(t => ({ ...t, show: false }))} />
      <Celebration />
      <Analytics />
    </div>
  );
}

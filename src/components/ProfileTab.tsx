import React, { Suspense, lazy, useState } from 'react';
import { ChoiceButtons } from './Select';
import { Briefcase, ChevronRight, Copy, FileText, IdCard, Landmark, Loader2, LogOut, Moon, Share2, ShieldCheck, Sun } from 'lucide-react';
import { Card, ErrorText, inputClass, Label, Modal, primaryButtonClass, secondaryButtonClass, StatusBadge } from './ui';
import { submitKycRpc, updateProfileFullName } from '../lib/supabaseClient';
import { becomeBusinessRpc } from '../lib/marketplace';
import { formatNaira, referralOffer, type MarketplaceSettings } from '../config/marketplace';
import type { ReferralItem, UserProfile } from '../types';
import { AdminReviews } from './AdminReviews';
// Admin-only screen: loaded on first open so it never ships in the main bundle.
const AdminMoney = lazy(() => import('./AdminMoney'));

const KYC_TYPES: { id: string; label: string }[] = [
  { id: 'nin', label: 'NIN' },
  { id: 'bvn', label: 'BVN' },
  { id: 'voters_card', label: "Voter's card" },
  { id: 'drivers_license', label: "Driver's licence" },
];

function Row({
  icon,
  label,
  value,
  onClick,
  right,
}: {
  icon: React.ReactNode;
  label: string;
  value?: React.ReactNode;
  onClick?: () => void;
  right?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-4 px-5 py-4 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 text-left cursor-pointer"
    >
      <span className="w-9 h-9 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-ink dark:text-white shrink-0">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] font-semibold text-ink dark:text-white">{label}</span>
        {value && <span className="block text-sm text-zinc-500 truncate">{value}</span>}
      </span>
      {right ?? <ChevronRight className="w-5 h-5 text-zinc-400 shrink-0" />}
    </button>
  );
}

function Switch({ on }: { on: boolean }) {
  return (
    <span className={`relative w-12 h-7 rounded-full transition-colors shrink-0 ${on ? 'bg-pulse-500' : 'bg-zinc-300 dark:bg-zinc-700'}`}>
      <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${on ? 'left-6' : 'left-1'}`} />
    </span>
  );
}

export function ProfileTab({
  user,
  settings,
  referrals,
  isDarkMode,
  businessMode,
  onBusinessModeChange,
  onToggleTheme,
  onChanged,
  onOpenTerms,
  onSignOut,
  onGoWallet,
  notify,
}: {
  user: UserProfile;
  settings: MarketplaceSettings;
  referrals: ReferralItem[];
  isDarkMode: boolean;
  businessMode: boolean;
  onBusinessModeChange: (on: boolean) => void;
  onToggleTheme: () => void;
  onChanged: () => Promise<void>;
  onOpenTerms: () => void;
  onSignOut: () => void;
  /** Identity is verified through the bank account in Wallet. */
  onGoWallet?: () => void;
  notify: (title: string, subtitle: string) => void;
}) {
  const [sheet, setSheet] = useState<null | 'name' | 'kyc' | 'business'>(null);
  const [showIdForm, setShowIdForm] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [moneyOpen, setMoneyOpen] = useState(false);
  const [fullName, setFullName] = useState(user.fullName);
  const [kycType, setKycType] = useState('');
  const [kycTried, setKycTried] = useState(false);
  const [kycNumber, setKycNumber] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isBusiness = user.role === 'business' || user.role === 'admin';
  // 012 locks a verified user's name in the database (admins excepted); this mirrors it.
  const nameLocked = user.kycStatus === 'verified' && user.role !== 'admin';
  const shareUrl = `${window.location.origin}/?ref=${encodeURIComponent(user.referralCode)}`;
  const paid = referrals.filter(r => r.bonusStatus === 'paid').length;

  const run = async (fn: () => Promise<unknown>, okTitle: string, okSub: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      notify(okTitle, okSub);
      await onChanged();
      setSheet(null);
      return true;
    } catch (err: any) {
      setError(err.message || 'Something went wrong.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      notify('Link copied', 'Send it to a friend.');
    } catch {
      notify('Your invite link', shareUrl);
    }
  };

  const shareWhatsApp = () => {
    const text = `Join me on TaskPulse. It's free, no deposit. Get paid for real tasks: ${shareUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };

  const openSheet = (s: 'name' | 'kyc' | 'business') => {
    setError(null);
    setSheet(s);
  };

  return (
    <div className="space-y-6 pb-8">
      <div className="flex items-center gap-4 pt-1 px-1">
        <div className="w-16 h-16 rounded-full bg-pulse-500 text-ink flex items-center justify-center text-2xl font-extrabold shrink-0">
          {user.username.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold text-ink dark:text-white truncate">{user.fullName || `@${user.username}`}</h1>
          <p className="text-sm text-zinc-500 truncate">@{user.username}</p>
        </div>
      </div>

      {!isBusiness || !businessMode ? (
        <Card>
          <div>
            <p className="text-[15px] font-bold text-ink dark:text-white">Invite friends</p>
            <p className="text-sm text-zinc-500 mt-1">
              {referralOffer(settings)} after they finish {settings.referralQualifyingTasks} approved tasks for businesses.
            </p>
          </div>
          <div className="flex items-center gap-2 h-12 pl-4 pr-1.5 rounded-2xl bg-zinc-100 dark:bg-zinc-800">
            <span className="flex-1 text-sm font-semibold text-ink dark:text-white truncate">{shareUrl.replace(/^https?:\/\//, '')}</span>
            <button type="button" onClick={copyLink} aria-label="Copy invite link" className="tactile w-9 h-9 rounded-xl bg-white dark:bg-zinc-900 flex items-center justify-center cursor-pointer">
              <Copy className="w-4 h-4 text-ink dark:text-white" />
            </button>
          </div>
          <button type="button" onClick={shareWhatsApp} className={primaryButtonClass}>
            <Share2 className="w-4 h-4" /> Share on WhatsApp
          </button>
          {referrals.length > 0 && (
            <p className="text-sm text-zinc-500 text-center">
              {referrals.length} joined · {paid} bonus{paid === 1 ? '' : 'es'} paid
            </p>
          )}
        </Card>
      ) : null}

      <div className="rounded-3xl border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-200 dark:divide-zinc-800 overflow-hidden">
        <Row
          icon={<Briefcase className="w-4 h-4" />}
          label="Business mode"
          value={isBusiness ? user.businessName || 'Post and manage tasks' : 'Post tasks for your business'}
          onClick={() => (isBusiness ? onBusinessModeChange(!businessMode) : openSheet('business'))}
          right={<Switch on={isBusiness && businessMode} />}
        />
        <Row icon={<span className="text-sm font-bold">Aa</span>} label="Name" value={user.fullName || 'Add your name'} onClick={() => openSheet('name')} />
        <Row
          icon={<IdCard className="w-4 h-4" />}
          label="Identity"
          onClick={() => openSheet('kyc')}
          right={
            <StatusBadge
              {...(user.kycStatus === 'verified'
                ? { label: 'Verified', tone: 'success' as const }
                : user.kycStatus === 'pending'
                ? { label: 'In review', tone: 'pending' as const }
                : user.kycStatus === 'rejected'
                ? { label: 'Rejected', tone: 'failed' as const }
                : { label: 'Not verified', tone: 'neutral' as const })}
            />
          }
        />
        <Row icon={isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />} label="Dark mode" onClick={onToggleTheme} right={<Switch on={isDarkMode} />} />
        <Row icon={<FileText className="w-4 h-4" />} label="Terms & privacy" onClick={onOpenTerms} />
        {user.role === 'admin' && (
          <Row icon={<ShieldCheck className="w-4 h-4" />} label="Review accounts" value="Bank name checks" onClick={() => setAdminOpen(true)} />
        )}
        {user.role === 'admin' && (
          <Row icon={<Landmark className="w-4 h-4" />} label="Money" value="Deposits, payouts, revenue" onClick={() => setMoneyOpen(true)} />
        )}
      </div>

      {user.role === 'admin' && <AdminReviews open={adminOpen} onClose={() => setAdminOpen(false)} notify={notify} />}
      {user.role === 'admin' && moneyOpen && (
        <Suspense fallback={null}>
          <AdminMoney open onClose={() => setMoneyOpen(false)} />
        </Suspense>
      )}

      <div className="px-1 text-sm text-zinc-500 space-y-1">
        <p>{user.email}</p>
        {user.phone && <p>{user.phone}</p>}
      </div>

      <button
        type="button"
        onClick={onSignOut}
        className="tactile w-full h-12 rounded-full bg-zinc-100 dark:bg-zinc-900 text-ink dark:text-white font-bold text-[15px] flex items-center justify-center gap-2 cursor-pointer"
      >
        <LogOut className="w-4 h-4" /> Sign out
      </button>

      <Modal open={sheet === 'name'} onClose={() => setSheet(null)} title="Your name">
        {nameLocked ? (
          <>
            <input className={`${inputClass} opacity-70`} value={user.fullName} readOnly aria-readonly="true" aria-label="Your name" />
            <p className="text-sm text-zinc-500 px-1">Your ID is verified with this name. Contact support to change your name.</p>
          </>
        ) : (
          <>
            <input className={inputClass} value={fullName} onChange={e => setFullName(e.target.value)} autoComplete="name" />
            <ErrorText>{error}</ErrorText>
            <button
              type="button"
              className={primaryButtonClass}
              disabled={busy || fullName.trim().length < 2 || fullName.trim() === user.fullName}
              onClick={() => run(() => updateProfileFullName(fullName), 'Saved', 'Your name was updated.')}
            >
              {busy && <Loader2 className="w-5 h-5 animate-spin" />} Save
            </button>
          </>
        )}
      </Modal>

      <Modal open={sheet === 'kyc'} onClose={() => setSheet(null)} title="Verify identity">
        {user.kycStatus === 'verified' ? (
          <p className="text-[15px] text-zinc-600 dark:text-zinc-300">Your identity is verified.</p>
        ) : user.kycStatus === 'pending' ? (
          <p className="text-[15px] text-zinc-600 dark:text-zinc-300">We're checking your account name. This usually takes a few hours.</p>
        ) : user.kycStatus === 'rejected' ? (
          <p className="text-[15px] text-zinc-600 dark:text-zinc-300">The name on your bank account didn't match your profile. Contact support to withdraw.</p>
        ) : (
          <>
            <p className="text-[15px] text-zinc-600 dark:text-zinc-300">
              Add your bank account in Wallet. We check that the name on it matches your profile name. It's free and takes a minute.
            </p>
            {onGoWallet && (
              <button
                type="button"
                className={primaryButtonClass}
                onClick={() => {
                  setSheet(null);
                  onGoWallet();
                }}
              >
                Go to Wallet
              </button>
            )}
          </>
        )}
        {user.kycStatus !== 'verified' && !showIdForm && (
          <button type="button" className="text-sm font-bold text-zinc-500 cursor-pointer" onClick={() => setShowIdForm(true)}>
            Add an ID number (optional)
          </button>
        )}
        {user.kycStatus !== 'verified' && showIdForm && (
          <>
            <ChoiceButtons
              label="ID type"
              value={kycType}
              onChange={setKycType}
              options={KYC_TYPES}
              columns={2}
              required
              error={kycTried && !kycType ? 'Choose your ID type.' : undefined}
            />
            <div>
              <Label hint="Numbers only">ID number</Label>
              <input className={inputClass} type="text" inputMode="numeric" autoComplete="off" aria-label="ID number" value={kycNumber} onChange={e => setKycNumber(e.target.value.replace(/\D/g, ''))} />
            </div>
            <p className="text-xs text-zinc-500 px-1">Optional. We only keep the ID type and last 4 digits. Your bank account is what verifies you.</p>
            <ErrorText>{error}</ErrorText>
            <button
              type="button"
              className={secondaryButtonClass}
              disabled={busy || kycNumber.length < 8}
              onClick={() => {
                setKycTried(true);
                if (!kycType) return;
                run(() => submitKycRpc(kycType, kycNumber), 'ID saved', 'Thanks. Add your bank account in Wallet to finish.');
              }}
            >
              {busy && <Loader2 className="w-5 h-5 animate-spin" />} Save ID
            </button>
          </>
        )}
      </Modal>

      <Modal open={sheet === 'business'} onClose={() => setSheet(null)} title="Turn on business mode">
        <p className="text-[15px] text-zinc-600 dark:text-zinc-300">Post tasks and pay only for approved work. Your wallet stays the same.</p>
        <div>
          <Label>Business name</Label>
          <input className={inputClass} value={businessName} onChange={e => setBusinessName(e.target.value)} maxLength={100} autoComplete="organization" />
        </div>
        <ErrorText>{error}</ErrorText>
        <button
          type="button"
          className={primaryButtonClass}
          disabled={busy || businessName.trim().length < 2}
          onClick={async () => {
            const ok = await run(() => becomeBusinessRpc(businessName.trim()), 'Business mode on', 'Post your first task from the Tasks tab.');
            if (ok) onBusinessModeChange(true);
          }}
        >
          {busy && <Loader2 className="w-5 h-5 animate-spin" />} Turn on
        </button>
        <button type="button" className={secondaryButtonClass} onClick={() => setSheet(null)}>
          Not now
        </button>
      </Modal>
    </div>
  );
}

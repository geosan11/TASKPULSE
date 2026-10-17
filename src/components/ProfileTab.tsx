import { useState } from 'react';
import { Briefcase, FileText, IdCard, Loader2, LogOut, Moon, Sun } from 'lucide-react';
import { Card, inputClass, Label, primaryButtonClass, secondaryButtonClass, StatusPill } from './ui';
import { submitKycRpc, updateProfileFullName } from '../lib/supabaseClient';
import { becomeBusinessRpc } from '../lib/marketplace';
import type { UserProfile } from '../types';

const KYC_TYPES = [
  { id: 'nin', label: 'NIN' },
  { id: 'bvn', label: 'BVN' },
  { id: 'voters_card', label: "Voter's card" },
  { id: 'drivers_license', label: "Driver's licence" },
];

export function ProfileTab({
  user,
  isDarkMode,
  onToggleTheme,
  onChanged,
  onOpenTerms,
  onSignOut,
  onGotoBusiness,
  notify,
}: {
  user: UserProfile;
  isDarkMode: boolean;
  onToggleTheme: () => void;
  onChanged: () => Promise<void>;
  onOpenTerms: () => void;
  onSignOut: () => void;
  onGotoBusiness: () => void;
  notify: (title: string, subtitle: string) => void;
}) {
  const [fullName, setFullName] = useState(user.fullName);
  const [savingName, setSavingName] = useState(false);
  const [kycType, setKycType] = useState('nin');
  const [kycNumber, setKycNumber] = useState('');
  const [savingKyc, setSavingKyc] = useState(false);
  const [businessName, setBusinessName] = useState('');
  const [savingBusiness, setSavingBusiness] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>, setBusy: (b: boolean) => void, okTitle: string, okSub: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      notify(okTitle, okSub);
      await onChanged();
      return true;
    } catch (err: any) {
      setError(err.message || 'Something went wrong.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 pb-6">
      <Card>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-sky-500 to-cyan-400 text-white flex items-center justify-center text-lg font-black">
            {user.username.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black text-slate-900 dark:text-white truncate">@{user.username}</p>
            <p className="text-[11px] text-slate-500 dark:text-zinc-400 truncate">{user.email}</p>
          </div>
          <span className="text-[9px] px-2 py-0.5 rounded-full font-extrabold uppercase tracking-wide border border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-cyan-400">
            {user.role}
          </span>
        </div>
        <div>
          <Label>Full name</Label>
          <div className="flex gap-2">
            <input className={inputClass} value={fullName} onChange={e => setFullName(e.target.value)} />
            <button
              type="button"
              disabled={savingName || fullName.trim().length < 2 || fullName.trim() === user.fullName}
              onClick={() => run(() => updateProfileFullName(fullName), setSavingName, 'Profile updated', 'Your name has been saved.')}
              className="px-4 rounded-2xl bg-sky-500 text-white text-[11px] font-black disabled:opacity-50 cursor-pointer"
            >
              {savingName ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
            </button>
          </div>
        </div>
        <p className="text-[11px] text-slate-500 dark:text-zinc-400">Phone: {user.phone || '—'}</p>
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <p className="text-xs font-black text-slate-900 dark:text-white flex items-center gap-1.5">
            <IdCard className="w-4 h-4" /> Identity (KYC)
          </p>
          <StatusPill status={user.kycStatus === 'verified' ? 'approved' : user.kycStatus === 'pending' ? 'pending' : user.kycStatus || 'unverified'} />
        </div>
        {user.kycStatus === 'unverified' || user.kycStatus === 'rejected' ? (
          <>
            <div className="grid grid-cols-[110px_1fr] gap-2">
              <select className={inputClass} value={kycType} onChange={e => setKycType(e.target.value)}>
                {KYC_TYPES.map(k => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
              <input className={inputClass} inputMode="numeric" value={kycNumber} onChange={e => setKycNumber(e.target.value.replace(/\D/g, ''))} placeholder="ID number" />
            </div>
            <p className="text-[10px] text-slate-400">We only store the ID type and last 4 digits.</p>
            <button
              type="button"
              className={secondaryButtonClass}
              disabled={savingKyc || kycNumber.length < 8}
              onClick={() => run(() => submitKycRpc(kycType, kycNumber), setSavingKyc, 'KYC submitted', 'We will review your details.')}
            >
              {savingKyc && <Loader2 className="w-4 h-4 animate-spin" />} Submit for review
            </button>
          </>
        ) : (
          <p className="text-[11px] text-slate-500 dark:text-zinc-400">
            {user.kycStatus === 'verified' ? 'Your identity is verified.' : 'Your details are being reviewed.'}
          </p>
        )}
      </Card>

      {user.role === 'worker' ? (
        <Card>
          <p className="text-xs font-black text-slate-900 dark:text-white flex items-center gap-1.5">
            <Briefcase className="w-4 h-4" /> Post tasks for your business
          </p>
          <p className="text-[11px] text-slate-500 dark:text-zinc-400">
            Switch this account to a business account to create and fund campaigns. Your wallet balance is not affected.
          </p>
          <input className={inputClass} value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="Business name" maxLength={100} />
          <button
            type="button"
            className={primaryButtonClass}
            disabled={savingBusiness || businessName.trim().length < 2}
            onClick={() =>
              run(() => becomeBusinessRpc(businessName.trim()), setSavingBusiness, 'Business account ready', 'Open the Business tab to post your first task.').then(ok => {
                if (ok) onGotoBusiness();
              })
            }
          >
            {savingBusiness && <Loader2 className="w-4 h-4 animate-spin" />} Open business account
          </button>
        </Card>
      ) : (
        <Card>
          <p className="text-xs font-black text-slate-900 dark:text-white">{user.businessName || 'Business account'}</p>
          <button type="button" className={secondaryButtonClass} onClick={onGotoBusiness}>
            <Briefcase className="w-4 h-4" /> Manage campaigns
          </button>
        </Card>
      )}

      {error && <p className="text-[11px] text-rose-500 font-semibold px-1">{error}</p>}

      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={secondaryButtonClass} onClick={onToggleTheme}>
          {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />} Theme
        </button>
        <button type="button" className={secondaryButtonClass} onClick={onOpenTerms}>
          <FileText className="w-4 h-4" /> Terms
        </button>
      </div>
      <button
        type="button"
        onClick={onSignOut}
        className="w-full h-11 rounded-full border border-rose-500/40 text-rose-600 dark:text-rose-400 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer"
      >
        <LogOut className="w-4 h-4" /> Sign out
      </button>
    </div>
  );
}

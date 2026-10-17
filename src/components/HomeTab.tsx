import { useState } from 'react';
import { Briefcase, Copy, Flame, Gift, Loader2, Share2, Wallet } from 'lucide-react';
import { Card, primaryButtonClass, StatusPill } from './ui';
import { formatNaira, type MarketplaceSettings } from '../config/marketplace';
import type { ReferralItem, UserProfile } from '../types';

export function HomeTab({
  user,
  settings,
  referrals,
  availableTaskCount,
  onCheckIn,
  onGoto,
  notify,
}: {
  user: UserProfile;
  settings: MarketplaceSettings;
  referrals: ReferralItem[];
  availableTaskCount: number;
  onCheckIn: () => Promise<void>;
  onGoto: (tab: 'tasks' | 'wallet' | 'business') => void;
  notify: (title: string, subtitle: string) => void;
}) {
  const [checkingIn, setCheckingIn] = useState(false);
  const shareUrl = `${window.location.origin}/?ref=${encodeURIComponent(user.referralCode)}`;
  const paidReferrals = referrals.filter(r => r.bonusStatus === 'paid').length;
  const isBusiness = user.role === 'business' || user.role === 'admin';

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      notify('Link copied', 'Share it with friends who want to earn.');
    } catch {
      notify('Copy failed', shareUrl);
    }
  };

  const shareWhatsApp = () => {
    const text = `Join me on TaskPulse. It's free, no deposit. Get paid for real tasks: ${shareUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };

  return (
    <div className="space-y-4 pb-6">
      <div className="relative p-5 rounded-[30px] bg-gradient-to-br from-sky-500 via-cyan-500 to-blue-700 text-white overflow-hidden shadow-xl shadow-sky-500/20">
        <div className="absolute -top-16 -right-10 w-48 h-48 rounded-full bg-white/10 blur-2xl" />
        <p className="text-[10px] font-black uppercase tracking-widest text-white/80">Withdrawable balance</p>
        <p className="text-3xl font-black mt-1 tracking-tight">{formatNaira(user.withdrawableBalance)}</p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
          <div className="p-2.5 rounded-2xl bg-white/10">
            <p className="text-white/70 font-bold">Approved tasks</p>
            <p className="font-black text-base">{user.approvedTaskCount}</p>
          </div>
          <div className="p-2.5 rounded-2xl bg-white/10">
            <p className="text-white/70 font-bold">Withdrawn to date</p>
            <p className="font-black text-base">{formatNaira(user.totalWithdrawnLifetime)}</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => onGoto('tasks')} className="h-10 rounded-full bg-white text-sky-700 font-black text-[11px] uppercase tracking-wider cursor-pointer">
            Find tasks ({availableTaskCount})
          </button>
          <button type="button" onClick={() => onGoto('wallet')} className="h-10 rounded-full bg-slate-900/30 border border-white/40 font-black text-[11px] uppercase tracking-wider cursor-pointer flex items-center justify-center gap-1">
            <Wallet className="w-3.5 h-3.5" /> Withdraw
          </button>
        </div>
      </div>

      {isBusiness && (
        <Card>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center">
              <Briefcase className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-black text-slate-900 dark:text-white">{user.businessName || 'Your business'}</p>
              <p className="text-[11px] text-slate-500 dark:text-zinc-400">Create campaigns and review submissions.</p>
            </div>
            <button type="button" onClick={() => onGoto('business')} className="px-3 h-9 rounded-full bg-indigo-500 text-white text-[11px] font-black cursor-pointer">
              Post tasks
            </button>
          </div>
        </Card>
      )}

      <Card>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-orange-500/10 text-orange-500 flex items-center justify-center">
            <Flame className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <p className="text-xs font-black text-slate-900 dark:text-white">{user.streakDays}-day streak</p>
            <p className="text-[11px] text-slate-500 dark:text-zinc-400">Check in daily to keep your streak badge. Badges are for bragging rights, not cash.</p>
          </div>
        </div>
        <button
          type="button"
          disabled={user.checkedInToday || checkingIn}
          onClick={async () => {
            setCheckingIn(true);
            try {
              await onCheckIn();
            } finally {
              setCheckingIn(false);
            }
          }}
          className={primaryButtonClass}
        >
          {checkingIn && <Loader2 className="w-4 h-4 animate-spin" />}
          {user.checkedInToday ? 'Checked in today ✓' : 'Check in'}
        </button>
      </Card>

      {user.role !== 'business' && (
        <Card>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center shrink-0">
              <Gift className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-black text-slate-900 dark:text-white">
                Invite friends: {formatNaira(settings.referralBonusReferrer)} for you, {formatNaira(settings.referralBonusReferee)} for them
              </p>
              <p className="text-[11px] text-slate-500 dark:text-zinc-400 leading-snug">
                Paid once your friend's first {settings.referralQualifyingTasks} tasks are approved. Nobody pays to join.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 p-2.5 rounded-2xl bg-slate-50 dark:bg-zinc-800/80 border border-slate-200 dark:border-white/[0.08]">
            <span className="flex-1 text-[11px] font-mono font-bold text-slate-700 dark:text-zinc-200 truncate">{user.referralCode}</span>
            <button type="button" onClick={copyLink} className="w-8 h-8 rounded-xl bg-white dark:bg-zinc-900 flex items-center justify-center text-slate-500 cursor-pointer" aria-label="Copy referral link">
              <Copy className="w-4 h-4" />
            </button>
            <button type="button" onClick={shareWhatsApp} className="w-8 h-8 rounded-xl bg-emerald-500 text-white flex items-center justify-center cursor-pointer" aria-label="Share on WhatsApp">
              <Share2 className="w-4 h-4" />
            </button>
          </div>
          {referrals.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                Your referrals · {paidReferrals} bonus{paidReferrals === 1 ? '' : 'es'} paid
              </p>
              {referrals.slice(0, 5).map(r => (
                <div key={r.id} className="flex items-center justify-between text-[11px]">
                  <span className="font-bold text-slate-700 dark:text-zinc-200 truncate">@{r.username}</span>
                  <StatusPill
                    status={
                      r.bonusStatus === 'paid'
                        ? 'approved'
                        : r.bonusStatus === 'pending'
                        ? 'pending'
                        : r.bonusStatus === 'skipped_legacy'
                        ? 'legacy'
                        : 'capped'
                    }
                  />
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

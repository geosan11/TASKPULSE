import { ArrowRight, Flame, Gift, Plus } from 'lucide-react';
import { Card, Mascot, primaryButtonClass } from './ui';
import { formatNaira, referralOffer, type MarketplaceSettings } from '../config/marketplace';
import type { DbTask } from '../lib/supabaseClient';
import { spotsState } from '../lib/spots';
import type { UserProfile } from '../types';
import { IntlNote } from './IntlNote';

function greeting() {
  const h = Number(new Date().toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Africa/Lagos' }));
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function HomeTab({
  user,
  settings,
  tasks,
  businessMode,
  onCheckIn,
  onOpenTask,
  onGoto,
}: {
  user: UserProfile;
  settings: MarketplaceSettings;
  tasks: DbTask[];
  businessMode: boolean;
  onCheckIn: () => Promise<void>;
  onOpenTask: (task: DbTask | null) => void;
  onGoto: (tab: 'tasks' | 'wallet' | 'profile') => void;
}) {
  const firstName = (user.fullName || user.username).split(' ')[0];

  return (
    <div className="space-y-6 pb-8">
      <div className="flex items-center gap-3 pt-1">
        <Mascot pose="happy" className="w-14 h-14 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{greeting()},</p>
          <h1 className="text-2xl font-extrabold text-ink dark:text-white truncate">{firstName}</h1>
        </div>
        <button
          type="button"
          onClick={user.checkedInToday ? undefined : onCheckIn}
          disabled={user.checkedInToday}
          title={user.checkedInToday ? 'Checked in today' : 'Check in to keep your streak'}
          className={`tactile ml-auto flex items-center gap-1 h-9 px-3 rounded-full text-sm font-bold cursor-pointer disabled:cursor-default ${
            user.checkedInToday ? 'bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400' : 'bg-pulse-500/12 text-pulse-700 dark:text-pulse-400'
          }`}
        >
          <Flame className="w-4 h-4" />
          {user.streakDays}
        </button>
      </div>
      {!businessMode && <IntlNote audience="worker" className="-mt-3 mb-3" />}

      <div className="rounded-[28px] bg-ink dark:bg-zinc-900 dark:border dark:border-zinc-800 text-white p-6 space-y-5">
        <div>
          <p className="text-sm text-zinc-400">Available to withdraw</p>
          <p className="text-[40px] leading-none font-extrabold tracking-tight mt-2">{formatNaira(user.withdrawableBalance)}</p>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-400">
            Pending <span className="text-white font-semibold ml-1">{formatNaira(user.pendingBalance)}</span>
          </span>
          <button type="button" onClick={() => onGoto('wallet')} className="flex items-center gap-1 font-bold text-pulse-400 cursor-pointer">
            Withdraw <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {businessMode ? (
        <button type="button" className={primaryButtonClass} onClick={() => onGoto('tasks')}>
          <Plus className="w-5 h-5" /> Post a task
        </button>
      ) : (
        <button type="button" className={primaryButtonClass} onClick={() => onOpenTask(tasks[0] || null)}>
          Start a task
        </button>
      )}

      {!businessMode && (
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-base font-extrabold text-ink dark:text-white">Top tasks</h2>
            {tasks.length > 0 && (
              <button type="button" onClick={() => onGoto('tasks')} className="text-sm font-bold text-zinc-500 cursor-pointer">
                See all
              </button>
            )}
          </div>
          {tasks.length === 0 ? (
            <div className="flex items-center gap-3 p-4 rounded-3xl bg-zinc-100 dark:bg-zinc-900">
              <Mascot pose="thinking" className="w-12 h-12 shrink-0" />
              <p className="text-sm text-zinc-500 dark:text-zinc-400">No tasks right now. New ones appear as businesses post them.</p>
            </div>
          ) : (
            <div className="rounded-3xl border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-200 dark:divide-zinc-800 overflow-hidden">
              {tasks.slice(0, 3).map(t => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onOpenTask(t)}
                  className="w-full text-left flex items-center justify-between gap-3 px-5 py-4 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 cursor-pointer"
                >
                  <div className="min-w-0">
                    <p className="text-[15px] font-bold text-ink dark:text-white truncate">{t.title}</p>
                    <p className="text-xs text-zinc-500">
                      {t.time} · {spotsState(t.spotsLeft, t.spotsTotal).label}
                    </p>
                  </div>
                  <span className="text-[15px] font-extrabold text-pulse-700 dark:text-pulse-400 shrink-0">{formatNaira(t.reward)}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {user.role !== 'business' && !businessMode && (
        <Card className="!p-4">
          <button type="button" onClick={() => onGoto('profile')} className="w-full flex items-center gap-3 text-left cursor-pointer">
            <div className="w-10 h-10 rounded-2xl bg-pulse-500/12 text-pulse-700 dark:text-pulse-400 flex items-center justify-center shrink-0">
              <Gift className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-ink dark:text-white">
                {referralOffer(settings)}
              </p>
              <p className="text-xs text-zinc-500">After they finish {settings.referralQualifyingTasks} approved tasks</p>
            </div>
            <ArrowRight className="w-4 h-4 text-zinc-400 shrink-0" />
          </button>
        </Card>
      )}
    </div>
  );
}

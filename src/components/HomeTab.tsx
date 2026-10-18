import { ArrowRight, Flame, Gift, Plus } from 'lucide-react';
import { AnimatedNaira, Card, Mascot, primaryButtonClass } from './ui';
import { PulseEmote } from './PulseEmote';
import { formatNaira, referralOffer, type MarketplaceSettings } from '../config/marketplace';
import type { DbTask } from '../lib/supabaseClient';
import type { UserProfile } from '../types';

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
  hasSubmissions,
  newTaskCount,
  onCheckIn,
  onOpenTask,
  onGoto,
}: {
  user: UserProfile;
  settings: MarketplaceSettings;
  tasks: DbTask[];
  businessMode: boolean;
  hasSubmissions: boolean;
  /** Open tasks that appeared since the last visit (0 on the very first one). */
  newTaskCount: number;
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

      <div className="rounded-[28px] bg-ink dark:bg-zinc-900 dark:border dark:border-zinc-800 text-white p-6 space-y-5">
        <div>
          <p className="text-sm text-zinc-400">Available to withdraw</p>
          <p data-coin-target className="inline-block origin-left text-[40px] leading-none font-extrabold tracking-tight mt-2 tabular-nums">
            <AnimatedNaira value={user.withdrawableBalance} format={formatNaira} />
          </p>
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
      ) : user.approvedTaskCount === 0 && !hasSubmissions && tasks.length > 0 ? (
        <div className="flex items-center gap-4 p-4 rounded-3xl bg-pulse-500/10 dark:bg-pulse-500/10 border border-pulse-500/20">
          <PulseEmote name="determined" size={72} alt="" className="shrink-0" />
          <div className="min-w-0 flex-1 space-y-2">
            <div>
              <p className="text-[15px] font-extrabold text-ink dark:text-white">Do your first task</p>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Takes a few minutes. Your first approval unlocks withdrawals.</p>
            </div>
            <button type="button" className="tactile h-10 px-5 rounded-full bg-pulse-500 hover:bg-pulse-600 text-ink text-sm font-bold cursor-pointer" onClick={() => onOpenTask(tasks[0])}>
              Start a task
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className={primaryButtonClass} onClick={() => onOpenTask(tasks[0] || null)}>
          Start a task
        </button>
      )}

      {!businessMode && newTaskCount > 0 && (
        <button
          type="button"
          onClick={() => onGoto('tasks')}
          className="tactile pe-pop w-full flex items-center gap-3 p-3 pr-4 rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 text-left cursor-pointer"
        >
          <PulseEmote name="idea" size={52} animate="blink" alt="" className="shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-bold text-ink dark:text-white">
              {newTaskCount === 1 ? 'A new task just landed' : `${newTaskCount} new tasks just landed`}
            </p>
            <p className="text-xs text-zinc-500">Grab a slot before they fill up.</p>
          </div>
          <ArrowRight className="w-4 h-4 text-zinc-400 shrink-0" />
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
              <PulseEmote name="wink" size={64} animate="bob" alt="" className="shrink-0" />
              <div className="min-w-0">
                <p className="text-[15px] font-bold text-ink dark:text-white">Be first in line for paid tasks.</p>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">New ones appear here as businesses post them.</p>
              </div>
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
                      {t.time} · {t.spotsLeft} left
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

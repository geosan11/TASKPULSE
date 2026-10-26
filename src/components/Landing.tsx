import { Briefcase } from 'lucide-react';
import { Card, Mascot, inkButtonClass, primaryButtonClass, secondaryButtonClass, linkButtonClass } from './ui';
import { formatNaira, type MarketplaceSettings } from '../config/marketplace';
import type { DbTask } from '../lib/supabaseClient';
import { spotsState } from '../lib/spots';

export function Landing({
  settings,
  tasks,
  onStartEarning,
  onPostTasks,
  onSignIn,
  onSeePricing,
  onOpenTerms,
}: {
  settings: MarketplaceSettings;
  tasks: DbTask[];
  onStartEarning: () => void;
  onPostTasks: () => void;
  onSignIn: () => void;
  onSeePricing: () => void;
  onOpenTerms: (tab: 'terms' | 'privacy') => void;
}) {
  return (
    <div className="space-y-8 pb-10">
      <section className="pt-4 text-center space-y-5">
        <Mascot pose="happy" className="w-32 h-32 mx-auto" bob />
        <div className="space-y-3">
          <h1 className="text-[32px] leading-[1.1] font-extrabold text-ink dark:text-white">
            Get paid for real tasks.
            <br />
            <span className="text-pulse-600 dark:text-pulse-500">No deposit, ever.</span>
          </h1>
          <p className="text-[15px] text-zinc-500 dark:text-zinc-400 max-w-[300px] mx-auto">
            Do simple tasks for real businesses. Get paid to your bank.
          </p>
        </div>
        <div className="space-y-3 pt-1">
          <button type="button" onClick={onStartEarning} className={primaryButtonClass}>
            Start earning, it's free
          </button>
          <button type="button" onClick={onPostTasks} className={secondaryButtonClass}>
            <Briefcase className="w-4 h-4" /> Post tasks
          </button>
          <button type="button" onClick={onSignIn} className={linkButtonClass}>
            I already have an account
          </button>
        </div>
      </section>

      <section className="grid grid-cols-3 gap-2 text-center">
        {[
          ['1', 'Pick a task'],
          ['2', 'Send proof'],
          ['3', 'Get paid'],
        ].map(([n, label]) => (
          <div key={n} className="py-4 px-2 rounded-2xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200/50 dark:border-zinc-800/80 flex flex-col items-center justify-center gap-1">
            <span className="w-7 h-7 rounded-full bg-pulse-500/15 text-pulse-700 dark:text-pulse-400 text-xs font-black flex items-center justify-center">
              {n}
            </span>
            <p className="text-xs sm:text-sm font-bold text-ink dark:text-white">{label}</p>
          </div>
        ))}
      </section>

      {tasks.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-base font-extrabold text-ink dark:text-white">Live now</h2>
            <span className="text-xs font-bold text-pulse-600 dark:text-pulse-400">Escrow backed</span>
          </div>
          <div className="rounded-3xl border border-zinc-200/80 dark:border-zinc-800 divide-y divide-zinc-200/60 dark:divide-zinc-800/80 overflow-hidden shadow-sm">
            {tasks.slice(0, 3).map(t => (
              <div key={t.id} className="flex items-center justify-between gap-3 px-5 py-4 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                <div className="min-w-0">
                  <p className="text-[15px] font-bold text-ink dark:text-white truncate">{t.title}</p>
                  <p className="text-xs text-zinc-500">{spotsState(t.spotsLeft, t.spotsTotal).label}</p>
                </div>
                <span className="text-[15px] font-black text-pulse-700 dark:text-pulse-400 shrink-0">{formatNaira(t.reward)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <Card className="!bg-ink !border-zinc-800 dark:!bg-zinc-900 text-white space-y-4 shadow-md">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-pulse-500/15 text-pulse-400 text-xs font-bold ring-1 ring-inset ring-pulse-500/30">
          For businesses
        </div>
        <h2 className="text-xl font-extrabold leading-tight">Real Nigerian people. Real actions. Pay only for approved work.</h2>
        <p className="text-sm text-zinc-400 leading-relaxed">
          Reward × slots + {Math.round(settings.platformFeeRate * 100)}% fee, paid once via Paystack. Funds stay in escrow until you approve each submission.
        </p>
        <button type="button" onClick={onPostTasks} className={`${inkButtonClass} !bg-white !text-ink hover:!bg-zinc-200`}>
          Post tasks
        </button>
        <a
          href="/business"
          onClick={e => {
            e.preventDefault();
            onSeePricing();
          }}
          className="block text-center text-sm font-bold text-pulse-400 underline-offset-2 hover:underline"
        >
          See pricing and how it works
        </a>
      </Card>

      <footer className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs font-semibold text-zinc-500">
        <a href="/business" onClick={e => { e.preventDefault(); onSeePricing(); }} className="hover:text-ink dark:hover:text-white">
          For businesses
        </a>
        <a href="/terms" onClick={e => { e.preventDefault(); onOpenTerms('terms'); }} className="hover:text-ink dark:hover:text-white">
          Terms
        </a>
        <a href="/privacy" onClick={e => { e.preventDefault(); onOpenTerms('privacy'); }} className="hover:text-ink dark:hover:text-white">
          Privacy
        </a>
      </footer>
    </div>
  );
}

import { Briefcase } from 'lucide-react';
import { Card, Mascot, inkButtonClass, primaryButtonClass, secondaryButtonClass, linkButtonClass } from './ui';
import { formatNaira, type MarketplaceSettings } from '../config/marketplace';
import type { DbTask } from '../lib/supabaseClient';

export function Landing({
  settings,
  tasks,
  onStartEarning,
  onPostTasks,
  onSignIn,
}: {
  settings: MarketplaceSettings;
  tasks: DbTask[];
  onStartEarning: () => void;
  onPostTasks: () => void;
  onSignIn: () => void;
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
          <div key={n} className="py-4 rounded-3xl bg-zinc-100 dark:bg-zinc-900">
            <p className="text-lg font-extrabold text-pulse-600 dark:text-pulse-500">{n}</p>
            <p className="text-sm font-semibold text-ink dark:text-white">{label}</p>
          </div>
        ))}
      </section>

      {tasks.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-extrabold text-ink dark:text-white px-1">Live now</h2>
          <div className="rounded-3xl border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-200 dark:divide-zinc-800 overflow-hidden">
            {tasks.slice(0, 3).map(t => (
              <div key={t.id} className="flex items-center justify-between gap-3 px-5 py-4 bg-white dark:bg-zinc-900">
                <div className="min-w-0">
                  <p className="text-[15px] font-bold text-ink dark:text-white truncate">{t.title}</p>
                  <p className="text-xs text-zinc-500">{t.spotsLeft} slots left</p>
                </div>
                <span className="text-[15px] font-extrabold text-pulse-700 dark:text-pulse-400 shrink-0">{formatNaira(t.reward)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <Card className="!bg-ink !border-ink dark:!bg-zinc-900 dark:!border-zinc-800 text-white">
        <p className="text-sm font-semibold text-pulse-400">For businesses</p>
        <h2 className="text-xl font-extrabold leading-tight">Real people. Real actions. Pay only for approved work.</h2>
        <p className="text-sm text-zinc-400">
          Reward × slots + {Math.round(settings.platformFeeRate * 100)}% fee, paid once via Paystack.
        </p>
        <button type="button" onClick={onPostTasks} className={`${inkButtonClass} !bg-white !text-ink hover:!bg-zinc-200`}>
          Post tasks
        </button>
      </Card>
    </div>
  );
}

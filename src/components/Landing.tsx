import { Briefcase, CheckCircle2, ShieldCheck, Wallet, Zap } from 'lucide-react';
import { primaryButtonClass, secondaryButtonClass } from './ui';
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
  const feePct = Math.round(settings.platformFeeRate * 100);
  return (
    <div className="space-y-5 pb-6">
      <section className="relative p-6 rounded-[32px] bg-gradient-to-br from-sky-500 via-cyan-500 to-blue-700 text-white overflow-hidden shadow-xl shadow-sky-500/20">
        <div className="absolute -top-16 -right-10 w-48 h-48 rounded-full bg-white/10 blur-2xl" />
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/15 text-[10px] font-black uppercase tracking-widest">
          <Zap className="w-3 h-3" /> Free to join
        </span>
        <h1 className="mt-3 text-[28px] leading-[1.1] font-black tracking-tight">
          Get paid for real tasks. No deposit, ever.
        </h1>
        <p className="mt-2 text-xs text-white/85 leading-relaxed">
          Businesses fund real micro-tasks such as app tests, surveys and reviews. You complete them, they approve your proof, and the
          reward lands in your wallet. Cash out to any Nigerian bank.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" onClick={onStartEarning} className="h-11 rounded-full bg-white text-sky-700 font-black text-xs uppercase tracking-wider cursor-pointer active:scale-[0.98] transition-all">
            Start earning
          </button>
          <button type="button" onClick={onPostTasks} className="h-11 rounded-full bg-slate-900/30 border border-white/40 text-white font-black text-xs uppercase tracking-wider cursor-pointer active:scale-[0.98] transition-all flex items-center justify-center gap-1.5">
            <Briefcase className="w-3.5 h-3.5" /> Post tasks
          </button>
        </div>
        <button type="button" onClick={onSignIn} className="mt-3 w-full text-[11px] font-bold text-white/85 underline cursor-pointer">
          Already have an account? Sign in
        </button>
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-zinc-400 px-1">How it works</h2>
        {[
          { icon: <CheckCircle2 className="w-4 h-4" />, title: 'Pick a task', body: 'Every task is paid for upfront by the business that posted it.' },
          { icon: <ShieldCheck className="w-4 h-4" />, title: 'Submit proof', body: 'Upload a screenshot, a link or an answer. The business reviews it.' },
          { icon: <Wallet className="w-4 h-4" />, title: 'Get paid', body: `Approved rewards hit your wallet. Withdraw from ${formatNaira(settings.minWithdrawal)} to your bank.` },
        ].map(s => (
          <div key={s.title} className="flex items-start gap-3 p-3.5 rounded-2xl bg-white dark:bg-zinc-900/70 border border-slate-200/80 dark:border-white/[0.06]">
            <div className="w-8 h-8 rounded-xl bg-sky-500/10 text-sky-600 dark:text-cyan-400 flex items-center justify-center shrink-0">{s.icon}</div>
            <div>
              <p className="text-xs font-black text-slate-900 dark:text-white">{s.title}</p>
              <p className="text-[11px] text-slate-500 dark:text-zinc-400 leading-snug">{s.body}</p>
            </div>
          </div>
        ))}
      </section>

      {tasks.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-zinc-400 px-1">Live tasks</h2>
          {tasks.slice(0, 3).map(t => (
            <div key={t.id} className="flex items-center justify-between p-3.5 rounded-2xl bg-white dark:bg-zinc-900/70 border border-slate-200/80 dark:border-white/[0.06]">
              <div className="min-w-0">
                <p className="text-xs font-black text-slate-900 dark:text-white truncate">{t.title}</p>
                <p className="text-[10px] text-slate-500 dark:text-zinc-400">{t.company} · {t.spotsLeft} slots left</p>
              </div>
              <span className="text-sm font-black text-emerald-600 dark:text-emerald-400 shrink-0">{formatNaira(t.reward)}</span>
            </div>
          ))}
        </section>
      )}

      <section className="p-5 rounded-3xl bg-slate-900 dark:bg-zinc-900 text-white space-y-2 border border-white/[0.06]">
        <span className="text-[10px] font-black text-cyan-400 uppercase tracking-widest">For businesses</span>
        <h2 className="text-lg font-black leading-tight">Real people, real actions, pay only for approved work.</h2>
        <p className="text-[11px] text-zinc-300 leading-relaxed">
          Set a reward and the number of completions you need. You fund the campaign once through Paystack (reward × slots + {feePct}% platform fee), review every
          submission, and only approved work is paid from your budget.
        </p>
        <button type="button" onClick={onPostTasks} className={primaryButtonClass}>
          <Briefcase className="w-4 h-4" /> Post tasks
        </button>
      </section>

      <button type="button" onClick={onStartEarning} className={secondaryButtonClass}>
        Create a free worker account
      </button>
    </div>
  );
}

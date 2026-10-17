import React from 'react';
import { X, Sparkles } from 'lucide-react';

export const inputClass =
  'w-full h-11 px-4 rounded-2xl bg-slate-50 dark:bg-zinc-800/80 border border-slate-200 dark:border-white/[0.08] text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500';

export const textareaClass =
  'w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-zinc-800/80 border border-slate-200 dark:border-white/[0.08] text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:border-cyan-500';

export const primaryButtonClass =
  'w-full h-11 rounded-full bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-sky-500/25 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

export const secondaryButtonClass =
  'w-full h-11 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-slate-800 dark:text-zinc-100 font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`p-4 rounded-3xl bg-white dark:bg-zinc-900/70 border border-slate-200/80 dark:border-white/[0.06] shadow-sm space-y-3 ${className}`}>
      {children}
    </div>
  );
}

export function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-center justify-between ml-1 mb-1">
      <label className="text-xs font-bold text-slate-700 dark:text-zinc-300">{children}</label>
      {hint && <span className="text-[10px] text-slate-400">{hint}</span>}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  eyebrow,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in">
      <div className={`bg-white dark:bg-[#10121a] border border-slate-200 dark:border-white/[0.1] rounded-3xl ${wide ? 'max-w-md' : 'max-w-sm'} w-full p-6 space-y-4 shadow-2xl relative max-h-[92vh] overflow-y-auto no-scrollbar`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            {eyebrow && (
              <span className="text-[10px] font-black text-sky-500 uppercase tracking-widest">{eyebrow}</span>
            )}
            <h3 className="text-lg font-black text-slate-900 dark:text-white mt-0.5">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 flex items-center justify-center text-slate-400 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Toast({ show, title, subtitle, onClose }: { show: boolean; title: string; subtitle: string; onClose: () => void }) {
  return (
    <div
      className={`fixed top-4 left-1/2 -translate-x-1/2 z-[100] max-w-[92vw] sm:max-w-md w-full px-3 pointer-events-none transition-all duration-300 ease-out ${
        show ? 'translate-y-0 opacity-100 scale-100' : '-translate-y-8 opacity-0 scale-95'
      }`}
    >
      <div className="mx-auto bg-zinc-900/90 dark:bg-white/95 text-white dark:text-zinc-900 backdrop-blur-2xl border border-white/10 dark:border-zinc-200/50 rounded-3xl py-2.5 px-3.5 shadow-[0_20px_50px_rgba(0,0,0,0.35)] flex items-center justify-between gap-3 pointer-events-auto">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-2xl bg-emerald-500/20 text-emerald-400 dark:text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-500/30">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="min-w-0 text-left">
            <p className="text-xs font-black leading-tight tracking-tight truncate">{title}</p>
            <p className="text-[10px] text-zinc-300 dark:text-zinc-600 leading-snug line-clamp-2 mt-0.5">{subtitle}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-6 h-6 rounded-full bg-white/10 dark:bg-zinc-200/60 flex items-center justify-center text-zinc-400 dark:text-zinc-600 hover:text-white dark:hover:text-black shrink-0 cursor-pointer"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const s = status.toLowerCase();
  const cls =
    s === 'approved' || s === 'settled' || s === 'disbursed' || s === 'active' || s === 'completed'
      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
      : s === 'pending' || s === 'pending_payment' || s === 'paused'
      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
      : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30';
  const label = s === 'pending_payment' ? 'awaiting payment' : s;
  return (
    <span className={`text-[9px] px-2 py-0.5 rounded-full font-extrabold uppercase tracking-wide border ${cls}`}>{label}</span>
  );
}

export function EmptyState({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="py-8 text-center space-y-2">
      <div className="mx-auto w-12 h-12 rounded-2xl bg-slate-100 dark:bg-zinc-800 flex items-center justify-center text-slate-400">{icon}</div>
      <p className="text-sm font-black text-slate-800 dark:text-zinc-100">{title}</p>
      <p className="text-[11px] text-slate-500 dark:text-zinc-400 max-w-xs mx-auto">{subtitle}</p>
    </div>
  );
}

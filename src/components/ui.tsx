import React from 'react';
import { X, Check, AlertCircle } from 'lucide-react';
import { useAnimatedIncrease } from '../lib/motion';
import { PulseEmote, type EmoteAnimation, type EmoteName } from './PulseEmote';

/* ------------------------------------------------------------------ */
/* Class tokens                                                        */
/* ------------------------------------------------------------------ */

export const inputClass =
  'w-full h-12 px-4 rounded-2xl bg-zinc-100 dark:bg-zinc-900 border border-transparent text-[15px] font-medium text-ink dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:border-pulse-500 focus:bg-white dark:focus:bg-zinc-900 transition-colors disabled:opacity-60';

export const textareaClass =
  'w-full px-4 py-3 rounded-2xl bg-zinc-100 dark:bg-zinc-900 border border-transparent text-[15px] font-medium text-ink dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:border-pulse-500 focus:bg-white dark:focus:bg-zinc-900 transition-colors';

const btnBase =
  'tactile w-full h-12 rounded-full font-bold text-[15px] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';

export const primaryButtonClass = `${btnBase} bg-pulse-500 hover:bg-pulse-600 active:bg-pulse-700 text-ink`;
export const secondaryButtonClass = `${btnBase} bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 text-ink dark:text-white`;
export const inkButtonClass = `${btnBase} bg-ink hover:bg-zinc-800 text-white dark:bg-white dark:hover:bg-zinc-200 dark:text-ink`;
export const dangerButtonClass = `${btnBase} bg-transparent border border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/5`;
export const linkButtonClass = 'text-sm font-bold text-pulse-700 dark:text-pulse-400 cursor-pointer disabled:opacity-40';

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`p-5 rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 space-y-4 ${className}`}>
      {children}
    </div>
  );
}

export function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-base font-extrabold text-ink dark:text-white">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-center justify-between px-1 mb-1.5">
      <label className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{children}</label>
      {hint && <span className="text-xs text-zinc-400">{hint}</span>}
    </div>
  );
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <p className="flex items-start gap-1.5 text-sm font-medium text-red-600 dark:text-red-400 px-1">
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export function Mascot({
  pose = 'default',
  className = 'w-16 h-16',
  bob = false,
}: {
  pose?: 'default' | 'happy' | 'celebrating' | 'thinking';
  className?: string;
  bob?: boolean;
}) {
  const src = pose === 'default' ? '/brand/mascot.png' : `/brand/mascot-${pose}.png`;
  return <img src={src} alt="" aria-hidden="true" draggable={false} className={`object-contain select-none ${bob ? 'animate-bob' : ''} ${className}`} />;
}

/** ₦ figure that counts up when it grows (e.g. a reward lands). */
export function AnimatedNaira({ value, format }: { value: number; format: (n: number) => string }) {
  return <>{format(useAnimatedIncrease(value))}</>;
}

/* ------------------------------------------------------------------ */
/* Bottom sheet / dialog                                               */
/* ------------------------------------------------------------------ */

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
    <div className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className={`animate-pop-in bg-white dark:bg-ink border-t sm:border border-zinc-200 dark:border-zinc-800 rounded-t-[32px] sm:rounded-[32px] ${
          wide ? 'sm:max-w-md' : 'sm:max-w-sm'
        } w-full px-6 pt-3 pb-8 sm:pt-6 space-y-5 max-h-[92dvh] overflow-y-auto no-scrollbar`}
      >
        <div className="mx-auto w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700 sm:hidden" />
        <div className="flex items-start justify-between gap-3">
          <div>
            {eyebrow && <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">{eyebrow}</p>}
            <h3 className="text-xl font-extrabold text-ink dark:text-white">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="tactile w-9 h-9 rounded-full bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center text-zinc-500 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Toast                                                               */
/* ------------------------------------------------------------------ */

export function Toast({ show, title, subtitle, onClose }: { show: boolean; title: string; subtitle: string; onClose: () => void }) {
  return (
    <div
      className={`fixed top-3 left-1/2 -translate-x-1/2 z-[100] w-full max-w-sm px-4 pointer-events-none transition-all duration-300 ease-out ${
        show ? 'translate-y-0 opacity-100' : '-translate-y-6 opacity-0'
      }`}
      role="status"
      aria-hidden={!show}
    >
      {/* Only catch clicks while visible: the hidden toast used to sit over the
          header and swallow taps on "Sign in" and the theme toggle. */}
      <div className={`bg-ink text-white dark:bg-white dark:text-ink rounded-2xl py-3 px-4 shadow-xl flex items-center gap-3 ${show ? 'pointer-events-auto' : 'pointer-events-none'}`}>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold leading-tight truncate">{title}</p>
          {subtitle && <p className="text-xs text-zinc-400 dark:text-zinc-500 leading-snug line-clamp-2 mt-0.5">{subtitle}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="Dismiss" tabIndex={show ? 0 : -1} className="w-7 h-7 rounded-full flex items-center justify-center text-zinc-400 shrink-0 cursor-pointer">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Status: always plain words                                          */
/* ------------------------------------------------------------------ */

type Tone = 'success' | 'pending' | 'failed' | 'neutral';

export function plainStatus(status: string, kind: 'money' | 'submission' | 'campaign' = 'money'): { label: string; tone: Tone } {
  const s = (status || '').toLowerCase();
  if (kind === 'campaign') {
    if (s === 'pending_payment') return { label: 'Awaiting payment', tone: 'pending' };
    if (s === 'active') return { label: 'Live', tone: 'success' };
    if (s === 'paused') return { label: 'Paused', tone: 'neutral' };
    if (s === 'completed') return { label: 'Finished', tone: 'neutral' };
    if (s === 'cancelled') return { label: 'Cancelled', tone: 'neutral' };
  }
  if (kind === 'submission') {
    if (s === 'approved') return { label: 'Approved', tone: 'success' };
    if (s === 'rejected') return { label: 'Rejected', tone: 'failed' };
    return { label: 'In review', tone: 'pending' };
  }
  if (['settled', 'disbursed', 'success', 'successful', 'approved', 'completed', 'verified', 'paid'].includes(s)) return { label: 'Successful', tone: 'success' };
  if (['failed', 'reversed', 'declined', 'rejected', 'cancelled'].includes(s)) return { label: 'Failed', tone: 'failed' };
  if (['pending', 'processing', 'queued', 'in_review'].includes(s)) return { label: 'Pending', tone: 'pending' };
  return { label: status, tone: 'neutral' };
}

export function StatusBadge({ label, tone }: { label: string; tone: Tone }) {
  const cls =
    tone === 'success'
      ? 'bg-pulse-500/12 text-pulse-700 dark:text-pulse-400'
      : tone === 'failed'
      ? 'bg-red-500/10 text-red-600 dark:text-red-400'
      : tone === 'pending'
      ? 'bg-zinc-200/70 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
      : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400';
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-semibold whitespace-nowrap ${cls}`}>
      {tone === 'success' && <Check className="w-3 h-3" strokeWidth={3} />}
      {label}
    </span>
  );
}

export function StatusPill({ status, kind = 'money' }: { status: string; kind?: 'money' | 'submission' | 'campaign' }) {
  return <StatusBadge {...plainStatus(status, kind)} />;
}

/* ------------------------------------------------------------------ */
/* Empty state                                                         */
/* ------------------------------------------------------------------ */

export function EmptyState({
  title,
  subtitle,
  icon,
  mascot = 'thinking',
  emote,
  emoteAnimate = 'bob',
  action,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  mascot?: 'thinking' | 'happy' | 'default' | null;
  /** Pulse emote; takes precedence over the legacy mascot pose. */
  emote?: EmoteName;
  emoteAnimate?: EmoteAnimation;
  action?: React.ReactNode;
}) {
  return (
    <div className="py-10 px-6 text-center space-y-3">
      {emote ? (
        <PulseEmote name={emote} size={112} animate={emoteAnimate} alt="" className="mx-auto" />
      ) : mascot ? (
        <Mascot pose={mascot} className="w-28 h-28 mx-auto" />
      ) : (
        <div className="mx-auto w-14 h-14 rounded-2xl bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center text-zinc-400">{icon}</div>
      )}
      <p className="text-base font-bold text-ink dark:text-white">{title}</p>
      {subtitle && <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-[260px] mx-auto">{subtitle}</p>}
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}

/** Timeouts, rate limits and daily limits get the tired emote; everything else is sad. */
export function emoteForError(message: string | null | undefined): EmoteName {
  return /too many|rate limit|timed? ?out|timeout|try again later|limit reached|reached today|daily limit|withdrawal limit/i.test(message || '') ? 'tired' : 'sad';
}

/**
 * A failed action, in plain words: Pulse (sad or tired, never shaking),
 * the reason, and one clear next step.
 */
export function ErrorPanel({
  title,
  message,
  actionLabel,
  onAction,
  emote,
}: {
  title?: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  emote?: EmoteName;
}) {
  const e = emote || emoteForError(message);
  return (
    <div role="alert" className="flex items-start gap-3 p-4 rounded-3xl bg-zinc-100 dark:bg-zinc-900 text-left">
      <PulseEmote name={e} size={56} alt="" className="shrink-0" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-bold text-ink dark:text-white">{title || (e === 'tired' ? 'Let\'s take a breather' : 'That didn\'t work')}</p>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{message}</p>
        {actionLabel && onAction && (
          <button type="button" onClick={onAction} className="tactile mt-1 h-9 px-4 rounded-full bg-ink text-white dark:bg-white dark:text-ink text-sm font-bold cursor-pointer">
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Segmented control                                                   */
/* ------------------------------------------------------------------ */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex p-1 rounded-full bg-zinc-100 dark:bg-zinc-900">
      {options.map(o => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`flex-1 h-10 rounded-full text-sm font-bold cursor-pointer transition-colors ${
            value === o.id ? 'bg-white dark:bg-zinc-800 text-ink dark:text-white shadow-sm' : 'text-zinc-500'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

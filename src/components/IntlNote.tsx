import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { INTERNATIONAL_LAUNCH_AT, INTL_COPY, type IntlAudience } from '../config/launch';
import { dismissKey, formatRemaining, msToNextMinute, parseLaunchAt } from '../lib/launchCountdown';

/**
 * One quiet line: "TaskPulse is going international · Read more".
 * With INTERNATIONAL_LAUNCH_AT set it becomes a countdown that ticks once a
 * minute (not every second) and hides itself after the target. Dismissible
 * (persisted in localStorage). Only a fade, disabled under reduced motion.
 */
export function IntlNote({ audience, className = '' }: { audience: IntlAudience; className?: string }) {
  const target = parseLaunchAt(INTERNATIONAL_LAUNCH_AT);
  const key = dismissKey(audience, INTERNATIONAL_LAUNCH_AT);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  const [now, setNow] = useState(() => Date.now());
  const [shown, setShown] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Minute ticker, aligned to the minute boundary. Off when dateless/dismissed.
  useEffect(() => {
    if (target === null || dismissed) return;
    let id: ReturnType<typeof setTimeout>;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (t < target) id = setTimeout(tick, msToNextMinute(t));
    };
    id = setTimeout(tick, msToNextMinute(Date.now()));
    return () => clearTimeout(id);
  }, [target, dismissed]);

  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const remaining = target === null ? null : formatRemaining(target - now, { daysOnly: audience === 'business' });
  if (dismissed || (target !== null && remaining === null)) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(key, '1');
    } catch {
      /* ignore */
    }
  };

  const copy = INTL_COPY[audience];
  let label: React.ReactNode = copy.line;
  if (remaining) {
    const [before, after = ''] = copy.countdownLine.split('{time}');
    label = (
      <>
        {before}
        <span className="tabular-nums">{remaining}</span>
        {after}
      </>
    );
  }

  return (
    <>
      <div
        role="note"
        className={`flex items-center gap-1.5 h-6 w-full min-w-0 [contain:inline-size] text-xs font-medium text-zinc-500 dark:text-zinc-400 transition-opacity duration-500 motion-reduce:transition-none ${
          shown ? 'opacity-100' : 'opacity-0'
        } ${className}`}
      >
        <span aria-hidden className="hidden min-[360px]:block w-1.5 h-1.5 rounded-full bg-pulse-500 shrink-0" />
        <p className="min-w-0 flex items-center whitespace-nowrap">
          <span className="truncate" title={remaining ? undefined : copy.line}>{label}</span>
          <span aria-hidden className="shrink-0 px-1 text-zinc-400 dark:text-zinc-600">·</span>
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="shrink-0 font-semibold text-pulse-700 dark:text-pulse-400 hover:underline underline-offset-2 cursor-pointer"
          >
            {copy.readMore}
          </button>
        </p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="ml-auto shrink-0 w-6 h-6 -mr-1.5 flex items-center justify-center rounded-full text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {sheetOpen && <IntlSheet audience={audience} onClose={() => setSheetOpen(false)} />}
    </>
  );
}

function IntlSheet({ audience, onClose }: { audience: IntlAudience; onClose: () => void }) {
  const copy = INTL_COPY[audience];
  const btn = useRef<HTMLButtonElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    btn.current?.focus();
    const id = requestAnimationFrame(() => setShown(true));
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      className={`fixed inset-0 z-50 bg-ink/50 flex items-end sm:items-center justify-center transition-opacity duration-200 motion-reduce:transition-none ${
        shown ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="intl-sheet-title"
        onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-sm bg-white dark:bg-ink text-ink dark:text-white border-t sm:border border-zinc-200 dark:border-zinc-800 rounded-t-[28px] sm:rounded-[28px] px-6 pt-3 sm:pt-6 pb-[calc(env(safe-area-inset-bottom)+24px)] sm:pb-6 space-y-4"
      >
        <div aria-hidden className="mx-auto w-10 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700 sm:hidden" />
        <h3 id="intl-sheet-title" className="text-lg font-bold">
          {copy.sheetTitle}
        </h3>
        <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{copy.sheetBody}</p>
        <button
          ref={btn}
          type="button"
          onClick={onClose}
          className="tactile w-full h-12 rounded-full bg-pulse-500 hover:bg-pulse-600 text-ink text-[15px] font-bold cursor-pointer"
        >
          {copy.sheetButton}
        </button>
      </div>
    </div>
  );
}

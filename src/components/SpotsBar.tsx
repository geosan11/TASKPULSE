import { useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import type { DbTask } from '../lib/supabaseClient';
import { abandonTaskSpot, acceptTaskSpot, holdFor, holdUntilLabel, spotsLeftFor, spotsState, useSpotsVersion, type SpotsTone } from '../lib/spots';
import { ErrorText, primaryButtonClass } from './ui';

const FILL: Record<SpotsTone, string> = {
  normal: 'bg-pulse-500',
  low: 'bg-amber-500',
  full: 'bg-zinc-400 dark:bg-zinc-600',
};
const TEXT: Record<SpotsTone, string> = {
  normal: 'text-zinc-500',
  low: 'text-amber-700 dark:text-amber-400',
  full: 'text-zinc-400 dark:text-zinc-500',
};

/**
 * Slim "spots taken" bar with a plain label: "33 of 50 spots left",
 * "Only 4 left", "Full". Fills by spots taken.
 */
export function SpotsBar({
  left,
  total,
  label,
  trailing,
  className = '',
}: {
  left: number;
  total: number;
  /** Replace the default label (e.g. the business view's "17 of 50 done"). */
  label?: string;
  /** Right-aligned extra text on the label row. */
  trailing?: ReactNode;
  className?: string;
}) {
  const s = spotsState(left, total);
  const pct = s.total > 0 ? Math.round((s.taken / s.total) * 100) : 0;
  const text = label ?? s.label;
  return (
    <div className={`space-y-1.5 ${className}`}>
      <div
        role="progressbar"
        aria-label="Spots taken"
        aria-valuemin={0}
        aria-valuemax={s.total}
        aria-valuenow={s.taken}
        aria-valuetext={label ? `${text}. ${s.label}` : text}
        className="h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden"
      >
        <div className={`h-full rounded-full transition-[width] duration-500 ${FILL[s.tone]}`} style={{ width: `${pct}%` }} />
      </div>
      <div className={`flex items-center justify-between gap-3 text-xs font-medium ${TEXT[s.tone]}`}>
        <span>{text}</span>
        {trailing}
      </div>
    </div>
  );
}

/** Spots bar for one task in the worker views (uses fresh counts after accept). */
export function TaskSpotsBar({ task, className }: { task: DbTask; className?: string }) {
  useSpotsVersion();
  const hold = holdFor(task.id);
  return (
    <SpotsBar
      left={spotsLeftFor(task)}
      total={task.spotsTotal}
      className={className}
      trailing={hold ? <span className="text-pulse-700 dark:text-pulse-400">You have a spot</span> : undefined}
    />
  );
}

export function isTaskFull(task: DbTask) {
  return spotsLeftFor(task) <= 0;
}

/** True when the worker can go straight to sending proof (holds a spot, or the task has no spot limit). */
export function useHasSpot(task: DbTask) {
  useSpotsVersion();
  return !task.campaignId || Boolean(holdFor(task.id));
}

/** Task detail: the spots bar plus "held until …" and a way to give the spot back. */
export function TaskSpotsStatus({ task }: { task: DbTask }) {
  useSpotsVersion();
  const hold = holdFor(task.id);
  const [busy, setBusy] = useState(false);
  const until = hold ? holdUntilLabel(hold.expiresAt) : null;
  return (
    <div className="space-y-2 pt-2">
      <TaskSpotsBar task={task} />
      {hold && task.campaignId && (
        <p className="text-xs text-zinc-500">
          {until ? `Your spot is held until ${until}. Send proof before then.` : 'Your spot is held.'}{' '}
          <button
            type="button"
            className="font-semibold underline underline-offset-2 cursor-pointer disabled:opacity-50"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await abandonTaskSpot(task);
              } catch {
                /* the spot frees itself when it expires */
              } finally {
                setBusy(false);
              }
            }}
          >
            Give up spot
          </button>
        </p>
      )}
    </div>
  );
}

/** Shown instead of the proof form until the worker accepts the task. */
export function AcceptTaskPanel({ task }: { task: DbTask }) {
  useSpotsVersion();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const full = isTaskFull(task);
  return (
    <div className="space-y-3">
      <ErrorText>{error}</ErrorText>
      <button
        type="button"
        className={`${primaryButtonClass} disabled:!bg-zinc-200 disabled:!text-zinc-500 dark:disabled:!bg-zinc-800 dark:disabled:!text-zinc-400`}
        disabled={busy || full}
        aria-disabled={busy || full}
        onClick={async () => {
          setError(null);
          setBusy(true);
          try {
            await acceptTaskSpot(task);
          } catch (err: any) {
            setError(err.message || 'Could not accept this task.');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy && <Loader2 className="w-5 h-5 animate-spin" />}
        {full ? 'Full' : 'Accept task'}
      </button>
      <p className="text-xs text-zinc-400 text-center">
        {full ? 'All spots are taken. A spot opens again if someone gives theirs up.' : 'Accepting holds a spot for you while you do the task.'}
      </p>
    </div>
  );
}

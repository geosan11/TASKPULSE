import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { formatNaira } from '../config/marketplace';

export const UNUSED_SLOTS_LINE = 'Unused slots are refunded, fee included.';
export const CHECKOUT_LINE = 'Nothing is added at checkout. TaskPulse covers the Paystack fee.';

/**
 * One all-in price with a "See breakdown" toggle: worker pay (slots x
 * reward), the TaskPulse fee and the total. Worker pay is only shown inside
 * the breakdown.
 */
export function PriceBreakdown({
  total,
  slots,
  reward,
  feeRate,
  label = 'You pay',
  size = 'lg',
  showUnusedLine = true,
}: {
  total: number;
  slots: number;
  reward: number;
  /** e.g. 0.15 */
  feeRate: number;
  label?: string;
  size?: 'lg' | 'md';
  showUnusedLine?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const workerPay = slots * reward;
  const fee = Math.max(0, total - workerPay);
  const pct = Math.round(feeRate * 100);

  return (
    <div className="space-y-2">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">{label}</p>
        <p className={`${size === 'lg' ? 'text-2xl' : 'text-xl'} font-black tracking-tight text-ink dark:text-white`}>{formatNaira(total)}</p>
        <p className="text-xs text-zinc-500">{CHECKOUT_LINE}</p>
      </div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 text-xs font-bold text-pulse-700 dark:text-pulse-400 cursor-pointer hover:underline underline-offset-4"
      >
        {open ? 'Hide breakdown' : 'See breakdown'}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <dl id={id} className="p-3 rounded-2xl bg-zinc-100 dark:bg-zinc-800/60 space-y-1.5 text-sm">
          <div className="flex justify-between gap-3 text-zinc-600 dark:text-zinc-400">
            <dt>
              Worker pay ({slots} × {formatNaira(reward)})
            </dt>
            <dd className="font-semibold">{formatNaira(workerPay)}</dd>
          </div>
          <div className="flex justify-between gap-3 text-zinc-600 dark:text-zinc-400">
            <dt>TaskPulse fee ({pct}%)</dt>
            <dd className="font-semibold">{formatNaira(fee)}</dd>
          </div>
          <div className="flex justify-between gap-3 pt-1.5 border-t border-zinc-200 dark:border-zinc-700 font-extrabold text-ink dark:text-white">
            <dt>Total</dt>
            <dd>{formatNaira(total)}</dd>
          </div>
        </dl>
      )}
      {showUnusedLine && <p className="text-xs text-zinc-500">{UNUSED_SLOTS_LINE}</p>}
    </div>
  );
}

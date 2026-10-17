import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Receipt } from 'lucide-react';
import { EmptyState, Modal, StatusPill } from './ui';
import { formatNaira } from '../config/marketplace';
import { formatDateTime, isDebit, txTypeLabel, type TxItem } from '../types';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'earnings', label: 'Earnings' },
  { id: 'cashout', label: 'Withdrawals' },
  { id: 'campaign_funding', label: 'Campaigns' },
] as const;

export function HistoryTab({ transactions }: { transactions: TxItem[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all');
  const [receipt, setReceipt] = useState<TxItem | null>(null);

  const visible = transactions.filter(t => {
    const type = t.type.toLowerCase();
    if (filter === 'all') return true;
    if (filter === 'earnings') return !isDebit(type) && type !== 'deposit';
    return type === filter;
  });

  return (
    <div className="space-y-4 pb-6">
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
        {FILTERS.map(f => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`px-3 h-8 rounded-full text-[11px] font-black whitespace-nowrap cursor-pointer border ${
              filter === f.id
                ? 'bg-sky-500 text-white border-sky-500'
                : 'bg-white dark:bg-zinc-900 text-slate-600 dark:text-zinc-300 border-slate-200 dark:border-white/[0.08]'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState icon={<Receipt className="w-6 h-6" />} title="Nothing here yet" subtitle="Your earnings, withdrawals and payments will show up here." />
      ) : (
        <div className="space-y-2">
          {visible.map(t => {
            const debit = isDebit(t.type);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setReceipt(t)}
                className="w-full text-left flex items-center gap-3 p-3.5 rounded-2xl bg-white dark:bg-zinc-900/70 border border-slate-200/80 dark:border-white/[0.06] cursor-pointer"
              >
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    debit ? 'bg-rose-500/10 text-rose-500' : 'bg-emerald-500/10 text-emerald-500'
                  }`}
                >
                  {debit ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownLeft className="w-4 h-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-black text-slate-900 dark:text-white truncate">{t.title || txTypeLabel(t.type)}</p>
                  <p className="text-[10px] text-slate-500 dark:text-zinc-400">
                    {txTypeLabel(t.type)} · {formatDateTime(t.createdAt)} WAT
                  </p>
                </div>
                <div className="text-right shrink-0 space-y-0.5">
                  <p className={`text-xs font-black ${debit ? 'text-slate-900 dark:text-white' : 'text-emerald-600 dark:text-emerald-400'}`}>
                    {debit ? '-' : '+'}
                    {formatNaira(Math.abs(t.amount))}
                  </p>
                  <StatusPill status={t.status} />
                </div>
              </button>
            );
          })}
        </div>
      )}

      <Modal open={Boolean(receipt)} onClose={() => setReceipt(null)} title="Receipt" eyebrow={receipt ? txTypeLabel(receipt.type) : ''}>
        {receipt && (
          <dl className="space-y-2 text-xs">
            {[
              ['Amount', formatNaira(Math.abs(receipt.amount))],
              ['Status', receipt.status],
              ['Date', `${formatDateTime(receipt.createdAt)} WAT`],
              ['Reference', receipt.reference || '—'],
              ['Details', receipt.description || '—'],
              ...(receipt.destinationBank ? [['Bank', receipt.destinationBank]] : []),
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-slate-100 dark:border-white/[0.06] pb-2">
                <dt className="text-slate-500">{k}</dt>
                <dd className="font-bold text-slate-900 dark:text-white text-right break-all">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </Modal>
    </div>
  );
}

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Briefcase,
  Check,
  ChevronRight,
  Clock,
  Gift,
  Landmark,
  ListChecks,
  Loader2,
  Megaphone,
  RefreshCw,
  Search,
  TrendingUp,
  Undo2,
  Users,
  X,
} from 'lucide-react';
import { ErrorText, inputClass, secondaryButtonClass, StatusBadge, StatusPill } from './ui';
import { formatDateTime } from '../types';
import {
  EXTRA_LABELS,
  LEDGER_LABELS,
  naira,
  PAYOUT_STATUS_LABEL,
  SIGNUP_BUCKETS,
  supabaseAdminMoneyApi,
  WORKER_GOAL,
  type AdminMoneyApi,
  type BusinessDetail,
  type BusinessRow,
  type EntryKind,
  type EntryRow,
  type MoneySummary,
  type WorkerDetail,
  type WorkerRow,
} from '../lib/adminMoney';

// Admin-only (Profile > Money is shown to role 'admin' only; every RPC
// behind it checks the role on the server and answers 42501 otherwise).

type Screen =
  | { t: 'overview' }
  | { t: 'entries'; kind: EntryKind; filter: string | null; title: string; note?: string }
  | { t: 'extras' }
  | { t: 'signups' }
  | { t: 'businesses' }
  | { t: 'business'; id: string; name: string }
  | { t: 'workers' }
  | { t: 'worker'; id: string; name: string };

const PAGE = 25;
const when = (iso: string | null | undefined) => (iso ? `${formatDateTime(iso)} WAT` : '—');
const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' }) : '—';
const pct = (r: number) => `${Math.round(Number(r) * 10000) / 100}%`;

/* ------------------------------------------------------------------ */
/* Small building blocks                                               */
/* ------------------------------------------------------------------ */

function Tile({
  icon,
  label,
  value,
  sub,
  onClick,
  accent = false,
  className = '',
  children,
  compact = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  onClick?: () => void;
  accent?: boolean;
  className?: string;
  children?: React.ReactNode;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`tactile text-left w-full p-4 rounded-3xl border cursor-pointer flex flex-col gap-1 bg-white dark:bg-zinc-900 border-zinc-200/80 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 ${className}`}
      >
        <span className="flex items-center justify-between">
          <span className="w-7 h-7 rounded-xl flex items-center justify-center bg-zinc-100 dark:bg-zinc-800 text-ink dark:text-white">{icon}</span>
          <ChevronRight className="w-4 h-4 text-zinc-400" />
        </span>
        <span className="text-[22px] leading-tight font-extrabold tracking-tight tabular-nums text-ink dark:text-white mt-1">{value}</span>
        <span className="text-[13px] font-semibold text-zinc-500 dark:text-zinc-400 truncate">{label}</span>
        {sub && <span className="text-xs text-zinc-400 dark:text-zinc-500 -mt-0.5">{sub}</span>}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`tactile text-left w-full p-4 rounded-3xl border cursor-pointer flex flex-col gap-2 ${
        accent
          ? 'bg-pulse-500 border-pulse-500 text-ink'
          : 'bg-white dark:bg-zinc-900 border-zinc-200/80 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'
      } ${className}`}
    >
      <span className="flex items-center justify-between gap-2 min-h-[36px]">
        <span className={`flex items-center gap-2 text-[13px] leading-tight font-semibold ${accent ? 'text-ink/80' : 'text-zinc-500 dark:text-zinc-400'}`}>
          <span
            className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 ${
              accent ? 'bg-ink/10 text-ink' : 'bg-zinc-100 dark:bg-zinc-800 text-ink dark:text-white'
            }`}
          >
            {icon}
          </span>
          {label}
        </span>
        <ChevronRight className={`w-4 h-4 shrink-0 ${accent ? 'text-ink/60' : 'text-zinc-400'}`} />
      </span>
      <span className={`text-[22px] leading-tight font-extrabold tracking-tight tabular-nums ${accent ? 'text-ink' : 'text-ink dark:text-white'}`}>{value}</span>
      {sub && <span className={`text-xs leading-snug ${accent ? 'text-ink/75' : 'text-zinc-500 dark:text-zinc-400'}`}>{sub}</span>}
      {children}
    </button>
  );
}

function Line({ label, value, onClick, muted = false }: { label: React.ReactNode; value: React.ReactNode; onClick?: () => void; muted?: boolean }) {
  const inner = (
    <>
      <span className={`text-sm ${muted ? 'text-zinc-400 dark:text-zinc-500' : 'text-zinc-600 dark:text-zinc-300'}`}>{label}</span>
      <span className="flex items-center gap-1 text-sm font-bold text-ink dark:text-white tabular-nums text-right">
        {value}
        {onClick && <ChevronRight className="w-4 h-4 text-zinc-400" />}
      </span>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="w-full flex items-center justify-between gap-3 py-2.5 cursor-pointer text-left">
      {inner}
    </button>
  ) : (
    <div className="flex items-center justify-between gap-3 py-2.5">{inner}</div>
  );
}

function Panel({ title, children, action }: { title?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 px-4 py-3">
      {(title || action) && (
        <div className="flex items-center justify-between pt-1 pb-1">
          {title && <h3 className="text-[15px] font-extrabold text-ink dark:text-white">{title}</h3>}
          {action}
        </div>
      )}
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">{children}</div>
    </section>
  );
}

function NotTracked() {
  return <span className="text-xs font-semibold text-zinc-400 dark:text-zinc-500">Not tracked yet</span>;
}

function Loading() {
  return (
    <p className="text-sm text-zinc-500 flex items-center gap-2 py-6 justify-center">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading…
    </p>
  );
}

function BooksBadge({ books }: { books: MoneySummary['books'] }) {
  const ok = books.balanced && (books.ledger_problem_campaigns ?? 0) === 0;
  if (ok) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-pulse-500/12 text-pulse-700 dark:text-pulse-400">
        <Check className="w-3 h-3" strokeWidth={3} /> Books balance
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-red-500/10 text-red-600 dark:text-red-400">
      <AlertTriangle className="w-3 h-3" />
      {!books.balanced ? `Books off by ${naira(books.difference)}` : `${books.ledger_problem_campaigns} task(s) don't add up`}
    </span>
  );
}

/** Generic paginated loader (newest first, "Load more"). */
function usePaged<T>(load: (limit: number, offset: number) => Promise<{ total: number; rows: T[] }>, deps: unknown[]) {
  const [rows, setRows] = useState<T[] | null>(null);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const fetchPage = useCallback(
    async (offset: number) => {
      const my = ++seq.current;
      setBusy(true);
      setError(null);
      try {
        const page = await load(PAGE, offset);
        if (my !== seq.current) return;
        setTotal(page.total);
        setRows(prev => (offset === 0 ? page.rows : [...(prev || []), ...page.rows]));
      } catch (err: any) {
        if (my === seq.current) setError(err?.message || 'Could not load.');
      } finally {
        if (my === seq.current) setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps
  );

  useEffect(() => {
    setRows(null);
    void fetchPage(0);
  }, [fetchPage]);

  const more = rows && rows.length < total ? () => fetchPage(rows.length) : null;
  return { rows, total, busy, error, more };
}

function MoreButton({ more, busy, shown, total }: { more: (() => void) | null; busy: boolean; shown: number; total: number }) {
  return (
    <div className="space-y-2 pt-1">
      <p className="text-xs text-center text-zinc-400">
        Showing {shown.toLocaleString('en-NG')} of {total.toLocaleString('en-NG')}
      </p>
      {more && (
        <button type="button" className={secondaryButtonClass} disabled={busy} onClick={more}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} Load more
        </button>
      )}
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <Search className="w-4 h-4 text-zinc-400 absolute left-4 top-1/2 -translate-y-1/2" />
      <input className={`${inputClass} pl-10`} placeholder={placeholder} value={value} onChange={e => onChange(e.target.value)} aria-label={placeholder} autoCapitalize="none" />
    </div>
  );
}

function useDebounced(value: string, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

function Overview({ s, go }: { s: MoneySummary; go: (sc: Screen) => void }) {
  const extrasTotal = s.extras.reduce((a, e) => a + Number(e.amount), 0);
  const workers = s.counts.workers;
  const goalPct = Math.min(100, Math.round((workers / WORKER_GOAL) * 100));
  const signupTotal = SIGNUP_BUCKETS.reduce((a, b) => a + (s.signups[b.id]?.total || 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 px-1">
        <BooksBadge books={s.books} />
        <span className="text-xs text-zinc-500 dark:text-zinc-400 text-right">
          Fee {pct(s.settings.platform_fee_rate)} · referral {naira(s.settings.referral_bonus_referrer)}
        </span>
      </div>
      <Tile
        accent
        icon={<TrendingUp className="w-4 h-4" />}
        label="TaskPulse earned"
        value={naira(s.fees_earned)}
        sub={
          <>
            Platform fee ({pct(s.settings.platform_fee_rate)}) on approved work only.
            <br />
            Referral bonuses −{naira(s.referral_cost)} · <b>Net {naira(s.net_earned)}</b>
          </>
        }
        onClick={() => go({ t: 'entries', kind: 'fees', filter: null, title: 'Fees earned', note: 'Fee on approved spots, per task. Fees on unused or refunded spots are not counted.' })}
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Tile
          icon={<ArrowDownLeft className="w-4 h-4" />}
          label="Deposited"
          value={naira(s.deposited)}
          sub={`${s.deposits_count.toLocaleString('en-NG')} Paystack payments`}
          onClick={() => go({ t: 'entries', kind: 'deposits', filter: null, title: 'Deposits', note: 'Confirmed Paystack payments from businesses.' })}
        />
        <Tile
          icon={<ArrowUpRight className="w-4 h-4" />}
          label="Paid out"
          value={naira(s.paid_out)}
          sub={`${s.paid_out_count.toLocaleString('en-NG')} withdrawals to banks`}
          onClick={() => go({ t: 'entries', kind: 'withdrawals_paid', filter: null, title: 'Withdrawals paid', note: 'Transfers Paystack confirmed as sent to workers’ banks.' })}
        />
        <Tile
          icon={<ListChecks className="w-4 h-4" />}
          label="Spent on workers"
          value={naira(s.spent_on_workers)}
          sub={`${s.counts.approved_spots.toLocaleString('en-NG')} approved tasks`}
          onClick={() => go({ t: 'entries', kind: 'spend', filter: null, title: 'Rewards paid from tasks', note: 'Rewards moved from business escrow to workers’ wallets.' })}
        />
        <Tile
          icon={<Landmark className="w-4 h-4" />}
          label="Held for businesses"
          value={naira(s.held.total)}
          sub="Businesses’ money, not TaskPulse’s"
          onClick={() => go({ t: 'entries', kind: 'held', filter: null, title: 'Held for businesses', note: 'Unspent task budgets, fees on open spots and refunds still owed.' })}
        />
        <Tile
          icon={<Undo2 className="w-4 h-4" />}
          label="Refunds"
          value={naira(s.refunds.total)}
          sub={`${naira(s.refunds.paid)} sent · ${naira(s.refunds.owed)} owed`}
          onClick={() => go({ t: 'entries', kind: 'refunds', filter: null, title: 'Refunds to businesses' })}
        />
        <Tile
          icon={<Gift className="w-4 h-4" />}
          label="Extra payouts"
          value={naira(extrasTotal)}
          sub={s.extras.length ? `${s.extras.length} type${s.extras.length > 1 ? 's' : ''} · tap for breakdown` : 'None yet'}
          onClick={() => go({ t: 'extras' })}
        />
      </div>

      <Panel title="Pending">
        <Line
          label={`Rewards waiting for review (${s.pending.reviews.count.toLocaleString('en-NG')})`}
          value={naira(s.pending.reviews.amount)}
          onClick={() => go({ t: 'entries', kind: 'reviews_pending', filter: null, title: 'Waiting for review', note: 'Submitted proofs the business has not approved or rejected yet. The money is still in escrow.' })}
        />
        <Line
          label={`Withdrawals waiting to be paid (${s.pending.withdrawals.count.toLocaleString('en-NG')})`}
          value={naira(s.pending.withdrawals.amount)}
          onClick={() => go({ t: 'entries', kind: 'withdrawals_pending', filter: null, title: 'Withdrawals waiting', note: 'Requested, money taken from the wallet, transfer not confirmed yet.' })}
        />
        {s.pending.hold.tracked ? (
          <Line
            label={`Approved, in 24h/48h hold (${s.pending.hold.count.toLocaleString('en-NG')})`}
            value={naira(s.pending.hold.amount)}
            onClick={() => go({ t: 'entries', kind: 'hold', filter: null, title: 'In the hold window' })}
          />
        ) : (
          <Line label="Approved, in 24h/48h hold" value={<NotTracked />} muted />
        )}
      </Panel>

      <div className="grid grid-cols-3 gap-3">
        <Tile compact icon={<Briefcase className="w-4 h-4" />} label="Businesses" value={s.counts.businesses.toLocaleString('en-NG')} onClick={() => go({ t: 'businesses' })} />
        <Tile compact icon={<Users className="w-4 h-4" />} label="Workers" value={workers.toLocaleString('en-NG')} onClick={() => go({ t: 'workers' })} />
        <Tile
          compact
          icon={<Megaphone className="w-4 h-4" />}
          label="Tasks"
          value={s.counts.tasks_posted.toLocaleString('en-NG')}
          sub={`${s.counts.tasks_live} live`}
          onClick={() => go({ t: 'entries', kind: 'tasks', filter: null, title: 'Tasks posted', note: 'Every funded task. Amount = spent so far (rewards + fee earned).' })}
        />
      </div>

      <Panel
        title="Sign-ups by source"
        action={
          <button type="button" className="text-sm font-bold text-pulse-700 dark:text-pulse-400 cursor-pointer" onClick={() => go({ t: 'signups' })}>
            Details
          </button>
        }
      >
        <div className="py-3 space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-zinc-600 dark:text-zinc-300">Workers toward goal</span>
            <span className="text-sm font-extrabold text-ink dark:text-white tabular-nums">
              {workers.toLocaleString('en-NG')} / {WORKER_GOAL}
            </span>
          </div>
          <div className="h-2.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={WORKER_GOAL} aria-valuenow={workers}>
            <div className="h-full rounded-full bg-pulse-500" style={{ width: `${goalPct}%` }} />
          </div>
        </div>
        {SIGNUP_BUCKETS.map(b => {
          const n = s.signups[b.id]?.total || 0;
          return (
            <Line
              key={b.id}
              label={b.label}
              value={
                <span className="flex items-center gap-2">
                  <span className="hidden sm:inline-block w-20 h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                    <span className="block h-full bg-pulse-500" style={{ width: `${signupTotal ? (n / signupTotal) * 100 : 0}%` }} />
                  </span>
                  {n.toLocaleString('en-NG')}
                </span>
              }
              onClick={() => go({ t: 'entries', kind: 'signups', filter: b.id, title: `Sign-ups · ${b.label}`, note: 'UTM tags from the sign-up link first, then the “heard about us” answer.' })}
            />
          );
        })}
      </Panel>

      <Panel title="Also worth knowing">
        <Line label="Owed to users (wallet balances)" value={naira(Number(s.counts.wallet_withdrawable) + Number(s.counts.wallet_pending))} />
        <Line label="Workers with an approved task" value={`${s.counts.workers_active.toLocaleString('en-NG')} of ${workers.toLocaleString('en-NG')}`} />
        <Line
          label="Failed or reversed withdrawals"
          value={s.withdrawals_failed_count.toLocaleString('en-NG')}
          onClick={s.withdrawals_failed_count ? () => go({ t: 'entries', kind: 'withdrawals_failed', filter: null, title: 'Failed withdrawals', note: 'Paystack failed or reversed these; the money went back to the wallet.' }) : undefined}
        />
        {Number(s.fee_other_kept) > 0 && <Line label="Other fee kept (rounding on closed tasks)" value={naira(s.fee_other_kept)} />}
        {Number(s.legacy_deposits) > 0 && <Line label="Old activation deposits (before the marketplace, not counted)" value={naira(s.legacy_deposits)} />}
      </Panel>

      <Panel title="How the books check works">
        <div className="py-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400 space-y-1.5">
          <p>
            Deposited {naira(s.deposited)} = fees earned {naira(s.fees_earned)} + rewards paid {naira(s.spent_on_workers)}
            {Number(s.fee_other_kept) > 0 && <> + other fee kept {naira(s.fee_other_kept)}</>} + refunds sent {naira(s.refunds.paid)} + held{' '}
            {naira(s.held.total)}.
          </p>
          <p>
            Held is then rebuilt from the tasks themselves: escrow {naira(s.held.escrow)} + fee on open spots {naira(s.held.unearned_fee)} + refunds owed{' '}
            {naira(s.held.refunds_owed)}. {s.books.balanced ? 'The two match.' : `They differ by ${naira(s.books.difference)}.`}
          </p>
          <p>
            Fee rate {pct(s.settings.platform_fee_rate)} and referral bonus {naira(s.settings.referral_bonus_referrer)} are read from marketplace settings.
            {s.excluded_accounts > 0 && ` ${s.excluded_accounts} test account${s.excluded_accounts > 1 ? 's are' : ' is'} left out of every figure.`}
          </p>
        </div>
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Drill-down: entries                                                 */
/* ------------------------------------------------------------------ */

function entryStatus(kind: EntryKind, status: string) {
  if (kind === 'tasks' || kind === 'held' || kind === 'fees') return <StatusPill status={status} kind="campaign" />;
  if (kind === 'refunds') return <StatusBadge {...(status === 'owed' ? { label: 'Owed', tone: 'pending' as const } : { label: 'Refunded', tone: 'success' as const })} />;
  if (kind === 'reviews_pending') return <StatusBadge label="In review" tone="pending" />;
  if (kind === 'extras') return <StatusBadge label={(EXTRA_LABELS[status] || status).replace(/ \(.*\)$/, '')} tone="neutral" />;
  if (kind === 'spend') return <StatusBadge {...(status === 'payout_reversal' ? { label: 'Reversed', tone: 'failed' as const } : { label: 'Paid', tone: 'success' as const })} />;
  if (kind === 'signups') return <StatusBadge label={status === 'business' ? 'Business' : 'Worker'} tone="neutral" />;
  if (kind === 'deposits') {
    if (status === 'settled') return <StatusBadge label="Funded task" tone="success" />;
    if (status === 'refunded') return <StatusBadge label="Refunded" tone="neutral" />;
    return <StatusBadge label={status === 'underpaid' ? 'Underpaid' : 'Paid twice'} tone="pending" />;
  }
  return <StatusPill status={status} />;
}

function Entries({ api, kind, filter, note }: { api: AdminMoneyApi; kind: EntryKind; filter: string | null; note?: string }) {
  const { rows, total, busy, error, more } = usePaged<EntryRow>((l, o) => api.entries(kind, filter, l, o), [api, kind, filter]);
  return (
    <div className="space-y-3">
      {note && <p className="text-sm text-zinc-500 dark:text-zinc-400 px-1">{note}</p>}
      <ErrorText>{error}</ErrorText>
      {rows === null ? (
        <Loading />
      ) : rows.length === 0 ? (
        <p className="text-sm text-zinc-500 text-center py-8">Nothing here yet.</p>
      ) : (
        <>
          <ul className="rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.map((r, i) => (
              <li key={`${r.detail}-${i}`} className="px-4 py-3 flex gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold text-ink dark:text-white truncate">{r.title}</p>
                  <p className="text-xs text-zinc-500 truncate">{r.who}</p>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500">{when(r.at)}</p>
                  {(kind === 'held' || kind === 'refunds' || kind === 'tasks' || kind === 'fees' || kind === 'signups') && r.detail && (
                    <p className="text-xs text-zinc-400 truncate mt-0.5">{kind === 'held' || kind === 'refunds' ? r.detail.replace(/(\d+(?:\.\d+)?)/g, m => naira(Number(m))) : r.detail}</p>
                  )}
                </div>
                <div className="text-right shrink-0 space-y-1">
                  {r.amount !== null && <p className="text-[15px] font-extrabold text-ink dark:text-white tabular-nums">{naira(r.amount)}</p>}
                  {entryStatus(kind, r.status)}
                </div>
              </li>
            ))}
          </ul>
          <MoreButton more={more} busy={busy} shown={rows.length} total={total} />
        </>
      )}
    </div>
  );
}

function Extras({ s, go }: { s: MoneySummary; go: (sc: Screen) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-500 dark:text-zinc-400 px-1">
        Money credited to wallets that did not come from a business’s task budget. Referral bonus is {naira(s.settings.referral_bonus_referrer)} to the referrer
        {Number(s.settings.referral_bonus_referee) > 0 ? ` and ${naira(s.settings.referral_bonus_referee)} to the new user` : ' only'}.
      </p>
      {s.extras.length === 0 ? (
        <p className="text-sm text-zinc-500 text-center py-8">No extra payouts yet.</p>
      ) : (
        <Panel>
          {s.extras.map(e => (
            <Line
              key={e.kind}
              label={`${EXTRA_LABELS[e.kind] || e.kind} (${e.count.toLocaleString('en-NG')})`}
              value={naira(e.amount)}
              onClick={() => go({ t: 'entries', kind: 'extras', filter: e.kind, title: EXTRA_LABELS[e.kind] || e.kind })}
            />
          ))}
        </Panel>
      )}
    </div>
  );
}

function Signups({ s, go }: { s: MoneySummary; go: (sc: Screen) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-500 dark:text-zinc-400 px-1">
        From the UTM tags on the sign-up link (utm_source / utm_campaign). People with no tags are grouped by their “heard about us” answer. Admins and test accounts are left out.
      </p>
      <Panel>
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 text-xs font-semibold text-zinc-400 py-2">
          <span>Source</span>
          <span className="text-right">All</span>
          <span className="text-right">Workers</span>
          <span className="text-right">By link</span>
        </div>
        {SIGNUP_BUCKETS.map(b => {
          const v = s.signups[b.id] || { total: 0, workers: 0, from_utm: 0 };
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => go({ t: 'entries', kind: 'signups', filter: b.id, title: `Sign-ups · ${b.label}` })}
              className="w-full grid grid-cols-[1fr_auto_auto_auto] gap-x-4 py-2.5 text-sm text-left cursor-pointer"
            >
              <span className="text-zinc-600 dark:text-zinc-300">{b.label}</span>
              <span className="text-right font-bold text-ink dark:text-white tabular-nums">{v.total}</span>
              <span className="text-right text-ink dark:text-white tabular-nums">{v.workers}</span>
              <span className="text-right text-zinc-500 tabular-nums">{v.from_utm}</span>
            </button>
          );
        })}
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Businesses                                                          */
/* ------------------------------------------------------------------ */

function Businesses({ api, go }: { api: AdminMoneyApi; go: (sc: Screen) => void }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { rows, total, busy, error, more } = usePaged<BusinessRow>((l, o) => api.businesses(dq, l, o), [api, dq]);
  return (
    <div className="space-y-3">
      <SearchBox value={q} onChange={setQ} placeholder="Search businesses" />
      <ErrorText>{error}</ErrorText>
      {rows === null ? (
        <Loading />
      ) : rows.length === 0 ? (
        <p className="text-sm text-zinc-500 text-center py-8">No businesses found.</p>
      ) : (
        <>
          <ul className="rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.map(b => (
              <li key={b.id}>
                <button type="button" onClick={() => go({ t: 'business', id: b.id, name: b.name })} className="w-full text-left px-4 py-3 flex items-center gap-3 cursor-pointer">
                  <span className="w-10 h-10 rounded-2xl bg-pulse-500/12 text-pulse-700 dark:text-pulse-400 flex items-center justify-center font-extrabold shrink-0">
                    {(b.name || '?').slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold text-ink dark:text-white truncate">{b.name}</span>
                    <span className="block text-xs text-zinc-500 truncate">
                      {b.tasks_posted} task{b.tasks_posted === 1 ? '' : 's'} · joined {day(b.joined)}
                    </span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="block text-[15px] font-extrabold text-ink dark:text-white tabular-nums">{naira(b.deposited)}</span>
                    <span className="block text-xs text-zinc-500 tabular-nums">bal. {naira(b.balance)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <MoreButton more={more} busy={busy} shown={rows.length} total={total} />
        </>
      )}
    </div>
  );
}

function StatGrid({ items }: { items: { label: string; value: React.ReactNode; strong?: boolean }[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {items.map(it => (
        <div key={it.label} className={`rounded-2xl px-3.5 py-3 ${it.strong ? 'bg-pulse-500/12' : 'bg-zinc-100 dark:bg-zinc-900'}`}>
          <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">{it.label}</p>
          <p className="text-[17px] font-extrabold text-ink dark:text-white tabular-nums mt-0.5">{it.value}</p>
        </div>
      ))}
    </div>
  );
}

function useDetail<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    load()
      .then(d => live && setData(d))
      .catch((e: any) => live && setError(e?.message || 'Could not load.'));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error };
}

function BusinessScreen({ api, id }: { api: AdminMoneyApi; id: string }) {
  const { data, error } = useDetail<BusinessDetail>(() => api.business(id), [api, id]);
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data) return <Loading />;
  const b = data.business;
  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-500 px-1">
        @{b.username} · {b.email} · joined {day(b.joined)}
      </p>
      <StatGrid
        items={[
          { label: 'Deposited', value: naira(b.deposited) },
          { label: 'Spent', value: naira(b.spent) },
          { label: 'Balance', value: naira(b.balance), strong: true },
          { label: 'Paid to workers', value: naira(b.spent_workers) },
          { label: 'Fees paid', value: naira(b.fees) },
          { label: 'Refunds', value: Number(b.refunds_owed) > 0 ? `${naira(b.refunds_paid)} + ${naira(b.refunds_owed)} owed` : naira(b.refunds_paid) },
        ]}
      />

      <Panel title={`Tasks (${data.campaigns.length})`}>
        {data.campaigns.length === 0 && <p className="text-sm text-zinc-500 py-3">No funded tasks yet{data.unfunded_drafts ? ` (${data.unfunded_drafts} unpaid draft${data.unfunded_drafts > 1 ? 's' : ''})` : ''}.</p>}
        {data.campaigns.map(c => (
          <div key={c.id} className="py-3 space-y-1.5">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[15px] font-semibold text-ink dark:text-white min-w-0">{c.title}</p>
              <StatusPill status={c.status} kind="campaign" />
            </div>
            <div className="h-1.5 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden flex">
              <span className="h-full bg-pulse-500" style={{ width: `${(c.approved / c.slots) * 100}%` }} />
              <span className="h-full bg-pulse-500/35" style={{ width: `${(c.pending / c.slots) * 100}%` }} />
            </div>
            <p className="text-xs text-zinc-500 tabular-nums">
              {c.approved}/{c.slots} approved{c.pending ? ` · ${c.pending} in review` : ''} · {c.spots_left ?? '—'} spots left · {naira(c.reward)} each
            </p>
            <p className="text-xs text-zinc-500 tabular-nums">
              Spent <b className="text-ink dark:text-white">{naira(c.spend)}</b> ({naira(c.paid_workers)} workers + {naira(c.fee)} fee)
              {Number(c.escrow) > 0 && ` · ${naira(c.escrow)} in escrow`}
              {Number(c.refund_due) > 0 && ` · ${naira(c.refund_due)} refund`}
            </p>
          </div>
        ))}
      </Panel>

      <Panel title="Deposit history">
        {data.deposits.length === 0 && <p className="text-sm text-zinc-500 py-3">No payments yet.</p>}
        {data.deposits.map(d => (
          <div key={d.reference} className="py-2.5 flex items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-ink dark:text-white truncate">{d.title}</span>
              <span className="block text-xs text-zinc-500">{when(d.at)}</span>
            </span>
            <span className="text-right shrink-0 space-y-1">
              <span className="block text-sm font-extrabold text-ink dark:text-white tabular-nums">{naira(d.amount)}</span>
              {entryStatus('deposits', d.status)}
            </span>
          </div>
        ))}
      </Panel>

      <Panel title="Recent transactions">
        {data.transactions.length === 0 && <p className="text-sm text-zinc-500 py-3">Nothing yet.</p>}
        {data.transactions.map(t => (
          <div key={t.reference} className="py-2.5 flex items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-ink dark:text-white truncate">{LEDGER_LABELS[t.type] || t.type}</span>
              <span className="block text-xs text-zinc-500 truncate">
                {t.title} · {when(t.at)}
              </span>
            </span>
            <span className="text-sm font-bold text-ink dark:text-white tabular-nums shrink-0">{naira(t.amount)}</span>
          </div>
        ))}
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Workers                                                             */
/* ------------------------------------------------------------------ */

function Workers({ api, go }: { api: AdminMoneyApi; go: (sc: Screen) => void }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { rows, total, busy, error, more } = usePaged<WorkerRow>((l, o) => api.workers(dq, l, o), [api, dq]);
  return (
    <div className="space-y-3">
      <SearchBox value={q} onChange={setQ} placeholder="Search workers" />
      <ErrorText>{error}</ErrorText>
      {rows === null ? (
        <Loading />
      ) : rows.length === 0 ? (
        <p className="text-sm text-zinc-500 text-center py-8">No workers found.</p>
      ) : (
        <>
          <ul className="rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.map(w => (
              <li key={w.id}>
                <button type="button" onClick={() => go({ t: 'worker', id: w.id, name: w.name })} className="w-full text-left px-4 py-3 flex items-center gap-3 cursor-pointer">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold text-ink dark:text-white truncate">{w.name}</span>
                    <span className="block text-xs text-zinc-500 truncate">
                      @{w.username} · {w.tasks_done} task{w.tasks_done === 1 ? '' : 's'} · {w.referrals} referral{w.referrals === 1 ? '' : 's'}
                    </span>
                  </span>
                  <span className="text-right shrink-0 space-y-1">
                    <span className="block text-[15px] font-extrabold text-ink dark:text-white tabular-nums">{naira(Number(w.earned) + Number(w.bonuses))}</span>
                    <StatusBadge {...PAYOUT_STATUS_LABEL[w.payout_status]} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <MoreButton more={more} busy={busy} shown={rows.length} total={total} />
        </>
      )}
    </div>
  );
}

function WorkerScreen({ api, id }: { api: AdminMoneyApi; id: string }) {
  const { data, error } = useDetail<WorkerDetail>(() => api.worker(id), [api, id]);
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data) return <Loading />;
  const w = data.worker;
  const src = SIGNUP_BUCKETS.find(b => b.id === w.source)?.label || w.source;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 px-1">
        <span className="text-sm text-zinc-500">
          @{w.username} · joined {day(w.joined)} · via {src}
        </span>
        <StatusBadge {...PAYOUT_STATUS_LABEL[w.payout_status]} />
      </div>
      <StatGrid
        items={[
          { label: 'Earned from tasks', value: naira(w.earned) },
          { label: 'Bonuses', value: naira(w.bonuses) },
          { label: 'Withdrawn', value: naira(w.withdrawn) },
          { label: 'Wallet', value: naira(w.balance), strong: true },
          { label: 'Tasks done', value: `${w.tasks_done}${w.tasks_pending ? ` (+${w.tasks_pending} in review)` : ''}` },
          { label: 'Referrals', value: `${w.referrals} (${w.referrals_paid} paid)` },
        ]}
      />
      <Panel title="Payout readiness">
        <Line label="ID check" value={w.kyc_status === 'verified' ? 'Verified' : w.kyc_status.replace('_', ' ')} />
        <Line label="Bank account" value={w.has_bank ? 'Linked' : 'Not linked'} />
        <Line label="Can withdraw from" value={w.payout_eligible_from ? when(w.payout_eligible_from) : 'After first approved task'} />
        {Number(w.withdrawal_pending) > 0 && <Line label="Withdrawal waiting" value={naira(w.withdrawal_pending)} />}
        {Number(w.pending_balance) > 0 && <Line label="Pending balance" value={naira(w.pending_balance)} />}
      </Panel>
      <Panel title="Recent tasks">
        {data.submissions.length === 0 && <p className="text-sm text-zinc-500 py-3">No submissions yet.</p>}
        {data.submissions.map((t, i) => (
          <div key={i} className="py-2.5 flex items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-ink dark:text-white truncate">{t.title}</span>
              <span className="block text-xs text-zinc-500 truncate">
                {t.company} · {when(t.at)}
              </span>
            </span>
            <span className="text-right shrink-0 space-y-1">
              <span className="block text-sm font-bold text-ink dark:text-white tabular-nums">{naira(t.reward)}</span>
              <StatusPill status={t.status} kind="submission" />
            </span>
          </div>
        ))}
      </Panel>
      <Panel title="Withdrawals">
        {data.withdrawals.length === 0 && <p className="text-sm text-zinc-500 py-3">No withdrawals yet.</p>}
        {data.withdrawals.map(t => (
          <div key={t.reference} className="py-2.5 flex items-center justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-ink dark:text-white truncate">{t.bank || 'Bank transfer'}</span>
              <span className="block text-xs text-zinc-500">{when(t.at)}</span>
            </span>
            <span className="text-right shrink-0 space-y-1">
              <span className="block text-sm font-bold text-ink dark:text-white tabular-nums">{naira(t.amount)}</span>
              <StatusPill status={t.status} />
            </span>
          </div>
        ))}
      </Panel>
      {data.referrals.length > 0 && (
        <Panel title="People they referred">
          {data.referrals.map((r, i) => (
            <Line
              key={i}
              label={`@${r.username} · ${day(r.at)}`}
              value={r.bonus_status === 'paid' ? naira(r.bonus) : <span className="text-xs font-semibold text-zinc-400">{r.bonus_status.replace('_', ' ')}</span>}
            />
          ))}
        </Panel>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

function titleFor(sc: Screen): string {
  switch (sc.t) {
    case 'overview':
      return 'Money';
    case 'entries':
      return sc.title;
    case 'extras':
      return 'Extra payouts';
    case 'signups':
      return 'Sign-ups by source';
    case 'businesses':
      return 'Businesses';
    case 'workers':
      return 'Workers';
    case 'business':
    case 'worker':
      return sc.name;
  }
}

export function AdminMoney({ open, onClose, api = supabaseAdminMoneyApi }: { open: boolean; onClose: () => void; api?: AdminMoneyApi }) {
  const [stack, setStack] = useState<Screen[]>([{ t: 'overview' }]);
  const [summary, setSummary] = useState<MoneySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSummary(await api.summary());
    } catch (err: any) {
      setError(err?.message || 'Could not load the figures.');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (open) {
      setStack([{ t: 'overview' }]);
      void load();
    }
  }, [open, load]);

  const screen = stack[stack.length - 1];
  const go = useCallback((sc: Screen) => setStack(s => [...s, sc]), []);
  const back = useCallback(() => setStack(s => (s.length > 1 ? s.slice(0, -1) : s)), []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [stack.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') (stack.length > 1 ? back : onClose)();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, stack.length, back, onClose]);

  const body = useMemo(() => {
    if (screen.t === 'entries') return <Entries key={`${screen.kind}-${screen.filter}`} api={api} kind={screen.kind} filter={screen.filter} note={screen.note} />;
    if (screen.t === 'businesses') return <Businesses api={api} go={go} />;
    if (screen.t === 'business') return <BusinessScreen api={api} id={screen.id} />;
    if (screen.t === 'workers') return <Workers api={api} go={go} />;
    if (screen.t === 'worker') return <WorkerScreen api={api} id={screen.id} />;
    if (!summary) return error ? null : <Loading />;
    if (screen.t === 'extras') return <Extras s={summary} go={go} />;
    if (screen.t === 'signups') return <Signups s={summary} go={go} />;
    return <Overview s={summary} go={go} />;
  }, [screen, summary, error, api, go]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-zinc-50 dark:bg-ink flex flex-col" role="dialog" aria-modal="true" aria-label="Money dashboard">
      <header className="shrink-0 border-b border-zinc-200/80 dark:border-zinc-800 bg-white/90 dark:bg-ink/90 backdrop-blur">
        <div className="max-w-3xl mx-auto px-4 h-16 flex items-center gap-3">
          {stack.length > 1 ? (
            <button type="button" onClick={back} aria-label="Back" className="tactile w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center text-ink dark:text-white cursor-pointer shrink-0">
              <ArrowLeft className="w-5 h-5" />
            </button>
          ) : (
            <span className="w-10 h-10 rounded-2xl bg-pulse-500 flex items-center justify-center text-ink shrink-0">
              <Landmark className="w-5 h-5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-extrabold text-ink dark:text-white truncate leading-tight">{titleFor(screen)}</h2>
            {screen.t === 'overview' && summary && (
              <p className="text-xs text-zinc-500 truncate">Updated {when(summary.generated_at)}</p>
            )}
          </div>
          {screen.t === 'overview' && (
            <button type="button" onClick={load} disabled={loading} aria-label="Refresh" className="tactile w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center text-zinc-500 cursor-pointer shrink-0 disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Close" className="tactile w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center text-zinc-500 cursor-pointer shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      </header>
      <div ref={scroller} className="flex-1 overflow-y-auto no-scrollbar">
        <div className="max-w-3xl mx-auto px-4 pt-4 pb-10 space-y-3">
          {(screen.t === 'overview' || screen.t === 'extras' || screen.t === 'signups') && <ErrorText>{error}</ErrorText>}
          {body}
        </div>
      </div>
    </div>
  );
}

export default AdminMoney;

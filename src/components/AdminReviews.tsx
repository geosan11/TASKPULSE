import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { EmptyState, ErrorText, Modal, primaryButtonClass, secondaryButtonClass } from './ui';
import {
  decideIdentityReview,
  fetchIdentityReviews,
  runIdentityBackfill,
  type IdentityReviewItem,
} from '../lib/api';
import { formatDateTime } from '../types';

// Admin-only (Profile > Review accounts is shown to role 'admin' only; the
// API answers 404 to everyone else, so hiding this is not the protection).

const REASON: Record<IdentityReviewItem['reason'], string> = {
  name_mismatch: 'Names differ',
  no_profile_name: 'No profile name',
  shared_bank_account: 'Bank shared with another user',
};

export function AdminReviews({
  open,
  onClose,
  notify,
}: {
  open: boolean;
  onClose: () => void;
  notify: (title: string, subtitle: string) => void;
}) {
  const [items, setItems] = useState<IdentityReviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [backfill, setBackfill] = useState<string | null>(null);
  const [backfillBusy, setBackfillBusy] = useState(false);

  const load = async () => {
    setError(null);
    try {
      const res = await fetchIdentityReviews();
      setItems(res.data.items);
    } catch (err: any) {
      setError(err?.message || 'Could not load reviews.');
    }
  };

  useEffect(() => {
    if (open) void load();
  }, [open]);

  const decide = async (item: IdentityReviewItem, approve: boolean) => {
    setBusyId(item.review_id);
    setError(null);
    try {
      await decideIdentityReview(item.review_id, approve);
      notify(approve ? 'Approved' : 'Rejected', `@${item.username}`);
      setItems(list => (list || []).filter(i => i.review_id !== item.review_id));
    } catch (err: any) {
      setError(err?.message || 'Could not save the decision.');
    } finally {
      setBusyId(null);
    }
  };

  // Pages through every saved bank account of users who are not verified yet.
  const runBackfill = async (dryRun: boolean) => {
    setBackfillBusy(true);
    setError(null);
    const total = { processed: 0, verified: 0, pending: 0, failed: 0 };
    let after: string | null = null;
    try {
      for (let page = 0; page < 200; page++) {
        const res = await runIdentityBackfill({ after, limit: 20, dryRun });
        const d = res.data;
        total.processed += d.processed;
        total.verified += d.verified;
        total.pending += d.pending;
        total.failed += d.failed;
        setBackfill(`${dryRun ? 'Preview: ' : ''}${total.processed} checked · ${total.verified} ${dryRun ? 'would be ' : ''}verified · ${total.pending} ${dryRun ? 'would go ' : ''}to review · ${total.failed} could not be checked${d.nextCursor ? '…' : ''}`);
        if (!d.nextCursor) break;
        after = d.nextCursor;
      }
      if (!dryRun) await load();
    } catch (err: any) {
      setError(err?.message || 'Backfill stopped. Run it again to continue.');
    } finally {
      setBackfillBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Review accounts" wide>
      <div className="space-y-2">
        <p className="text-sm text-zinc-500">
          Existing bank accounts: check them against profile names (same check as saving a bank account). Safe to run more than once.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={secondaryButtonClass} disabled={backfillBusy} onClick={() => runBackfill(true)}>
            Preview
          </button>
          <button type="button" className={primaryButtonClass} disabled={backfillBusy} onClick={() => runBackfill(false)}>
            {backfillBusy && <Loader2 className="w-5 h-5 animate-spin" />} Check existing accounts
          </button>
        </div>
        {backfill && <p className="text-sm font-semibold text-ink dark:text-white">{backfill}</p>}
      </div>

      <ErrorText>{error}</ErrorText>

      {items === null ? (
        <p className="text-sm text-zinc-500 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </p>
      ) : items.length === 0 ? (
        <EmptyState mascot={null} icon={<span className="text-xl">✓</span>} title="Nothing to review" subtitle="New name mismatches show up here." />
      ) : (
        <ul className="space-y-3">
          {items.map(item => (
            <li key={item.review_id} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 space-y-2">
              <div className="flex justify-between gap-3 text-xs text-zinc-500">
                <span>@{item.username} · {REASON[item.reason] || item.reason}</span>
                <span>{formatDateTime(item.updated_at || item.created_at)} WAT</span>
              </div>
              <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-zinc-500">Profile name</dt>
                <dd className="font-semibold text-ink dark:text-white break-words">
                  {item.current_profile_name || item.profile_name || '—'}
                </dd>
                <dt className="text-zinc-500">Bank name</dt>
                <dd className="font-semibold text-ink dark:text-white break-words">{item.bank_account_name || '—'}</dd>
                <dt className="text-zinc-500">Bank</dt>
                <dd className="text-ink dark:text-white">
                  {item.bank_name || '—'} · {item.account_masked}
                </dd>
              </dl>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button type="button" className={secondaryButtonClass} disabled={busyId === item.review_id} onClick={() => decide(item, false)}>
                  Reject
                </button>
                <button type="button" className={primaryButtonClass} disabled={busyId === item.review_id} onClick={() => decide(item, true)}>
                  {busyId === item.review_id && <Loader2 className="w-5 h-5 animate-spin" />} Approve
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/**
 * scripts/reconcile-pending.ts
 *
 * Finds payments TaskPulse still shows as PENDING and asks Paystack what
 * really happened to each one. By default it only PRINTS what it would do.
 *
 *   # dry run (default, changes nothing)
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... PAYSTACK_SECRET_KEY=... \
 *     npx tsx scripts/reconcile-pending.ts
 *
 *   # one reference only
 *   ... npx tsx scripts/reconcile-pending.ts --ref=dep_e282f287...
 *
 *   # actually apply the actions printed by the dry run
 *   ... npx tsx scripts/reconcile-pending.ts --apply
 *
 * What it checks
 *   - legacy deposits   transactions(type=deposit,  status=pending)  -> GET /transaction/verify/:ref
 *   - campaign funding  campaign_payments(status=pending|underpaid)  -> GET /transaction/verify/:ref
 *   - cashouts          transactions(type=cashout,  status=pending)  -> GET /transfer/verify/:ref
 *
 * What --apply does (all through the same idempotent, row-locked database
 * functions the live API uses, so running it twice never double-credits)
 *   - deposit paid       -> rpc settle_deposit(ref, paid_naira)       credits the amount due ONCE
 *   - deposit not paid   -> marks the row 'declined' (no balance change)  only if older than --min-age-minutes
 *   - campaign paid      -> rpc settle_campaign_funding(ref, paid_naira)
 *   - cashout success    -> rpc finalize_cashout(ref, 'success')
 *   - cashout failed / reversed, or never reached Paystack (older than --min-age-minutes)
 *                        -> rpc finalize_cashout(ref, 'failed')       returns the amount to the wallet
 *
 * It never deletes rows and never lowers a balance.
 * Requires migration 008 (adds transactions.updated_at); it refuses to
 * --apply on a database without it, because the old settle_deposit fails.
 */

type Kind = 'deposit' | 'campaign' | 'cashout';
interface Pending {
  kind: Kind;
  reference: string;
  amount: number;
  user_id: string;
  created_at: string;
}
interface Plan {
  item: Pending;
  paystack: string;
  action: 'settle' | 'decline' | 'finalize_success' | 'finalize_failed' | 'skip';
  paidNaira?: number;
  note: string;
}

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ONLY_REF = args.find((a) => a.startsWith('--ref='))?.slice(6);
const MIN_AGE_MIN = Number(args.find((a) => a.startsWith('--min-age-minutes='))?.slice(18) || 120);
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: npx tsx scripts/reconcile-pending.ts [--apply] [--ref=<reference>] [--min-age-minutes=120]');
  process.exit(0);
}

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const PAYSTACK_KEY = process.env.PAYSTACK_SECRET_KEY || '';
// Overridable only so the script can be tested locally (PostgREST + mock).
const REST_BASE = (process.env.SUPABASE_REST_URL || `${SUPABASE_URL}/rest/v1`).replace(/\/$/, '');
const PAYSTACK_BASE = (process.env.PAYSTACK_API_BASE || 'https://api.paystack.co').replace(/\/$/, '');

function die(msg: string): never {
  console.error(`ERROR: ${msg}`);
  process.exit(2);
}
if (!SUPABASE_URL) die('SUPABASE_URL is not set.');
if (!SERVICE_KEY) die('SUPABASE_SERVICE_ROLE_KEY is not set.');
if (!PAYSTACK_KEY) die('PAYSTACK_SECRET_KEY is not set.');

async function sb(path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${REST_BASE}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers || {}),
    },
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let body: any = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  return { status: res.status, body };
}

async function rpc(fn: string, params: Record<string, unknown>) {
  const r = await sb(`/rpc/${fn}`, { method: 'POST', body: JSON.stringify(params) });
  if (r.status >= 300) throw new Error(`${fn} -> HTTP ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body;
}

async function paystack(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_KEY}` },
    signal: AbortSignal.timeout(20000),
  });
  let body: any = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

function ageMinutes(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 60000;
}

function fmtWAT(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', dateStyle: 'medium', timeStyle: 'short' }) + ' WAT';
}

async function loadPending(): Promise<Pending[]> {
  const refFilter = ONLY_REF ? `&reference=eq.${encodeURIComponent(ONLY_REF)}` : '';
  const out: Pending[] = [];

  const tx = await sb(
    `/transactions?select=reference,user_id,amount,type,status,created_at&status=ilike.pending&or=(type.ilike.deposit,type.ilike.cashout)${refFilter}&order=created_at.asc`
  );
  if (tx.status !== 200) die(`Could not read transactions (HTTP ${tx.status}): ${JSON.stringify(tx.body)}`);
  for (const r of tx.body as any[]) {
    out.push({
      kind: String(r.type).toLowerCase() === 'cashout' ? 'cashout' : 'deposit',
      reference: r.reference, amount: Number(r.amount), user_id: r.user_id, created_at: r.created_at,
    });
  }

  const cp = await sb(
    `/campaign_payments?select=reference,business_id,amount,status,created_at&status=in.(pending,underpaid)${refFilter}&order=created_at.asc`
  );
  if (cp.status === 200) {
    for (const r of cp.body as any[]) {
      out.push({ kind: 'campaign', reference: r.reference, amount: Number(r.amount), user_id: r.business_id, created_at: r.created_at });
    }
  } else {
    console.warn(`(campaign_payments not readable, HTTP ${cp.status}; skipping campaign funding. Migration 008 not applied?)`);
  }
  return out;
}

async function planFor(item: Pending): Promise<Plan> {
  const old = ageMinutes(item.created_at) >= MIN_AGE_MIN;

  if (item.kind === 'cashout') {
    const r = await paystack(`/transfer/verify/${encodeURIComponent(item.reference)}`);
    const st = String(r.body?.data?.status || '').toLowerCase();
    if (r.status === 200 && st === 'success') return { item, paystack: 'transfer success', action: 'finalize_success', note: 'mark disbursed' };
    if (r.status === 200 && (st === 'failed' || st === 'reversed'))
      return { item, paystack: `transfer ${st}`, action: 'finalize_failed', note: `refund N${item.amount} to wallet` };
    if (r.status === 404 || r.status === 400) {
      return old
        ? { item, paystack: 'transfer not found', action: 'finalize_failed', note: `never reached Paystack; refund N${item.amount} to wallet` }
        : { item, paystack: 'transfer not found', action: 'skip', note: `younger than ${MIN_AGE_MIN} min, wait` };
    }
    return { item, paystack: `transfer ${st || `HTTP ${r.status}`}`, action: 'skip', note: 'still in flight, leave pending' };
  }

  const r = await paystack(`/transaction/verify/${encodeURIComponent(item.reference)}`);
  const d = r.body?.data;
  const st = String(d?.status || '').toLowerCase();

  if (r.status === 200 && st === 'success') {
    if (d.reference && d.reference !== item.reference) return { item, paystack: 'success (ref mismatch)', action: 'skip', note: 'reference mismatch, investigate' };
    if (d.currency !== 'NGN') return { item, paystack: `success ${d.currency}`, action: 'skip', note: 'non-NGN, investigate' };
    const paidNaira = Math.floor(Number(d.amount) / 100);
    const paidAt = d.paid_at ? ` paid ${fmtWAT(d.paid_at)}` : '';
    if (paidNaira < item.amount) {
      return { item, paystack: `success N${paidNaira}${paidAt}`, action: 'skip', paidNaira, note: `UNDERPAID (due N${item.amount}); refund or top up manually` };
    }
    return {
      item, paystack: `success N${(Number(d.amount) / 100).toFixed(2)}${paidAt}`, action: 'settle', paidNaira,
      note: item.kind === 'campaign' ? 'fund campaign + publish task' : `credit N${item.amount} once`,
    };
  }

  const notPaid = (r.status === 200 && ['abandoned', 'failed', 'reversed'].includes(st)) ||
    (r.status === 400 || r.status === 404); // Paystack: "Transaction reference not found"
  if (notPaid) {
    const label = r.status === 200 ? st : 'not found';
    if (item.kind === 'campaign') return { item, paystack: label, action: 'skip', note: 'not paid; campaign stays awaiting payment (business can retry)' };
    return old
      ? { item, paystack: label, action: 'decline', note: 'never paid; mark declined (no balance change)' }
      : { item, paystack: label, action: 'skip', note: `younger than ${MIN_AGE_MIN} min, checkout may still be open` };
  }
  return { item, paystack: st || `HTTP ${r.status}`, action: 'skip', note: 'pending at Paystack, leave as is' };
}

async function applyPlan(p: Plan): Promise<string> {
  const ref = p.item.reference;
  switch (p.action) {
    case 'settle': {
      const fn = p.item.kind === 'campaign' ? 'settle_campaign_funding' : 'settle_deposit';
      const res = await rpc(fn, { p_reference: ref, p_paid_amount: p.paidNaira });
      return `${fn}: ${JSON.stringify(res)}`;
    }
    case 'decline': {
      const r = await sb(
        `/transactions?reference=eq.${encodeURIComponent(ref)}&status=ilike.pending&type=ilike.deposit`,
        { method: 'PATCH', body: JSON.stringify({ status: 'declined', description: 'Not paid at Paystack (reconciled)' }) }
      );
      if (r.status >= 300) throw new Error(`decline -> HTTP ${r.status}: ${JSON.stringify(r.body)}`);
      return `declined (${Array.isArray(r.body) ? r.body.length : 0} row)`;
    }
    case 'finalize_success':
      return `finalize_cashout: ${JSON.stringify(await rpc('finalize_cashout', { p_reference: ref, p_outcome: 'success' }))}`;
    case 'finalize_failed':
      return `finalize_cashout: ${JSON.stringify(await rpc('finalize_cashout', { p_reference: ref, p_outcome: 'failed' }))}`;
    default:
      return 'skipped';
  }
}

async function main() {
  const host = new URL(SUPABASE_URL).host;
  const mode = PAYSTACK_KEY.startsWith('sk_live_') ? 'LIVE' : PAYSTACK_KEY.startsWith('sk_test_') ? 'TEST' : 'custom';
  console.log(`Supabase: ${host}   Paystack key: ${mode}   Mode: ${APPLY ? 'APPLY (will write)' : 'DRY RUN (no changes)'}`);

  // Preflight: the pre-008 settle_deposit writes transactions.updated_at,
  // which did not exist, so every settlement failed. Refuse to apply until
  // migration 008 is in.
  const pre = await sb('/transactions?select=updated_at&limit=1');
  const has008 = pre.status === 200;
  if (!has008) {
    console.warn('WARNING: transactions.updated_at is missing, so migration 008 has not been applied. settle_deposit will fail until it is.');
    if (APPLY) die('Refusing to --apply before migration 008. Run supabase/008_free_marketplace.sql first.');
  }

  const items = await loadPending();
  if (items.length === 0) {
    console.log('No pending payments found.');
    return;
  }

  const plans: Plan[] = [];
  for (const it of items) {
    try {
      plans.push(await planFor(it));
    } catch (e: any) {
      plans.push({ item: it, paystack: 'error', action: 'skip', note: `could not verify: ${e?.message || e}` });
    }
  }

  let failures = 0;
  for (const p of plans) {
    const line = `${p.item.kind.padEnd(8)} ${p.item.reference.padEnd(38)} N${String(p.item.amount).padStart(7)}  ${fmtWAT(p.item.created_at).padEnd(24)} paystack=${p.paystack.padEnd(28)} -> ${p.action}: ${p.note}`;
    if (!APPLY || p.action === 'skip') {
      console.log((APPLY ? '' : '[dry-run] ') + line);
      continue;
    }
    try {
      console.log(`${line}\n    applied: ${await applyPlan(p)}`);
    } catch (e: any) {
      failures++;
      console.error(`${line}\n    FAILED: ${e?.message || e}`);
    }
  }

  const counts = plans.reduce<Record<string, number>>((a, p) => ((a[p.action] = (a[p.action] || 0) + 1), a), {});
  console.log(`\nSummary: ${JSON.stringify(counts)}${APPLY ? '' : '  (dry run: re-run with --apply to perform these actions)'}`);
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

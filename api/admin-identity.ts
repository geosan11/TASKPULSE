import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';

// =========================================================================
// SELF-CONTAINED SERVERLESS HELPERS (ZERO RELATIVE IMPORT ISSUES ON VERCEL)
// =========================================================================

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    Object.setPrototypeOf(this, HttpError.prototype);
  }
}

function handleApiError(res: VercelResponse, err: any) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ status: false, message: err.message });
  }
  console.error('[API Error: admin-identity]', err);
  const raw = String(err?.message || '');
  const message = raw.startsWith('Server misconfiguration') ? raw : 'Internal server error';
  return res.status(500).json({ status: false, message });
}

// <name-match>
const NAME_TITLES = new Set([
  'MR', 'MRS', 'MS', 'MISS', 'MASTER', 'MADAM', 'MDM', 'DR', 'DOC', 'PROF', 'SIR', 'LADY', 'DAME',
  'CHIEF', 'HRH', 'OBA', 'ALHAJI', 'ALHAJA', 'ALH', 'HAJIA', 'HAJIYA', 'HAJI', 'MALAM', 'MALLAM',
  'PASTOR', 'PST', 'REV', 'REVD', 'BISHOP', 'EVANG', 'APOSTLE', 'PROPHET', 'PROPHETESS', 'DEACON',
  'DEACONESS', 'DCN', 'ELDER', 'BRO', 'SIS', 'ENGR', 'ENG', 'BARR', 'ARC', 'ARCH', 'PHARM', 'SEN',
  'HON', 'COMR', 'CAPT', 'GEN', 'COL', 'MAJ', 'LT', 'SGT', 'CPL', 'ESQ', 'JR', 'JNR', 'SR', 'SNR',
]);

/** One name, e.g. "GEORGE" or a double-barrelled "SANNI-MUSA" (parts SANNI, MUSA). */
export type NameUnit = { full: string; parts: string[]; initial: boolean };

export type NameMatchResult = {
  match: boolean;
  /** Profile names/initials that were found in the bank name. */
  matched: string[];
  /** How many had to match. */
  required: number;
  profileUnits: string[];
  bankUnits: string[];
  reason: 'match' | 'no_profile_name' | 'no_bank_name' | 'name_mismatch';
};

/** Upper-case, drop accents/punctuation/titles, split into names; hyphenated names stay one unit. */
export function nameUnits(raw: string | null | undefined): NameUnit[] {
  const cleaned = String(raw ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[^A-Z\s-]/g, ' ') // dots, commas, apostrophes, digits...
    .replace(/\s*-\s*/g, '-')
    .replace(/-+/g, '-');
  const units: NameUnit[] = [];
  for (const word of cleaned.split(/\s+/)) {
    const parts = word.split('-').filter(Boolean);
    if (parts.length === 0) continue;
    if (parts.length === 1 && NAME_TITLES.has(parts[0])) continue;
    const full = parts.join('');
    units.push({ full, parts, initial: full.length === 1 });
  }
  return units;
}

/**
 * True when the bank name plausibly belongs to the profile owner.
 * - case, punctuation, extra spaces and titles are ignored; order does not matter
 * - a hyphenated name matches written joined, split, or with only one of its parts
 * - an initial ("E.") matches any name starting with that letter, and a missing
 *   middle name or initial is fine
 * - match when at least two names match (at least one of them a full name);
 *   when the profile has only one or two names, all of them must appear
 */
export function matchNames(profileName: string | null | undefined, bankName: string | null | undefined): NameMatchResult {
  const p = nameUnits(profileName);
  const b = nameUnits(bankName);
  const base = { profileUnits: p.map(u => u.parts.join('-')), bankUnits: b.map(u => u.parts.join('-')) };
  if (!p.some(u => !u.initial)) return { match: false, matched: [], required: 0, ...base, reason: 'no_profile_name' };
  if (!b.some(u => !u.initial)) return { match: false, matched: [], required: 0, ...base, reason: 'no_bank_name' };

  const used = new Set<number>();
  const take = (pred: (u: NameUnit) => boolean) => {
    const i = b.findIndex((u, k) => !used.has(k) && pred(u));
    if (i >= 0) used.add(i);
    return i >= 0;
  };
  const done = new Set<number>(); // profile units already matched
  const matched: string[] = [];
  let fullMatches = 0;
  const hit = (i: number, full: boolean) => {
    done.add(i);
    matched.push(p[i].parts.join('-'));
    if (full) fullMatches++;
  };
  // 1. Whole names first, so a partial match never steals a name another one needs.
  p.forEach((u, i) => {
    if (!u.initial && take(x => !x.initial && x.full === u.full)) hit(i, true);
  });
  // 2. Hyphenated names: "SANNI-MUSA" vs "SANNI MUSA" / "SANNI", or "SANNI" vs "SANNI-MUSA".
  p.forEach((u, i) => {
    if (u.initial || done.has(i)) return;
    if (u.parts.length > 1) {
      let any = false;
      for (const part of u.parts) any = take(x => !x.initial && x.full === part) || any;
      if (any) return hit(i, true);
    }
    if (take(x => x.parts.length > 1 && x.parts.includes(u.full))) hit(i, true);
  });
  // 3. Initials, either side: "E." vs "EMMANUEL", or "EMMANUEL" vs "E.".
  p.forEach((u, i) => {
    if (done.has(i)) return;
    const letter = u.full[0];
    if (u.initial ? take(x => x.full[0] === letter) : take(x => x.initial && x.full === letter)) hit(i, false);
  });
  const required = Math.min(p.length, 2);
  const match = fullMatches >= 1 && matched.length >= required;
  return { match, matched, required, ...base, reason: match ? 'match' : 'name_mismatch' };
}
// </name-match>

// Server-side Supabase access ALWAYS uses the service-role key. Every money
// RPC (settle_*, request_cashout, finalize_cashout, save_verified_bank_account,
// create_campaign_payment) is granted to service_role only, so an anon-key
// fallback can never work and only hides misconfiguration until a real
// payment gets stuck. Prefer SUPABASE_SERVICE_ROLE_KEY: anything prefixed
// VITE_ is a candidate for inlining into the public browser bundle.
function readServiceRoleKey(): string | undefined {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SERVICE_ROLE_KEY ||
    legacyViteServiceKey()
  );
}

// Back-compat only: older setups stored the key as VITE_SUPABASE_SERVICE_ROLE_KEY.
// It is not referenced by any browser code, so it is not in the bundle today,
// but the name is a foot-gun. Rename it to SUPABASE_SERVICE_ROLE_KEY.
function legacyViteServiceKey(): string | undefined {
  const k = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  if (k) console.warn('[config] Using VITE_SUPABASE_SERVICE_ROLE_KEY. Rename it to SUPABASE_SERVICE_ROLE_KEY.');
  return k || undefined;
}

/** True when the key is a service-role/secret key (not an anon/publishable key). */
function isServiceRoleKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true;
  if (key.startsWith('sb_publishable_')) return false;
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
      return payload?.role === 'service_role';
    } catch {
      return false;
    }
  }
  return false;
}

let _adminClient: SupabaseClient | null = null;
function getSupabaseClient(_userToken?: string): SupabaseClient {
  if (_adminClient) return _adminClient;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = readServiceRoleKey();
  if (!url || !serviceKey) {
    throw new Error('Server misconfiguration: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in Vercel Project Settings > Environment Variables (Production), then redeploy.');
  }
  if (!isServiceRoleKey(serviceKey)) {
    throw new Error('Server misconfiguration: SUPABASE_SERVICE_ROLE_KEY is not a service-role key (looks like an anon/publishable key). Copy the service_role secret from Supabase > Project Settings > API.');
  }
  _adminClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _adminClient;
}

async function requireUser(req: VercelRequest): Promise<{ user: User; token: string }> {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  const headerValue = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!headerValue || !headerValue.toLowerCase().startsWith('bearer ')) {
    throw new HttpError(401, 'Authentication required. Please sign in.');
  }
  const token = headerValue.slice(7).trim();
  if (!token) throw new HttpError(401, 'Authentication token missing.');
  const client = getSupabaseClient(token);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, 'Session invalid or expired. Please sign in again.');
  return { user: data.user, token };
}

function getPaystackSecretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new HttpError(500, 'PAYSTACK_SECRET_KEY is not configured on the server. Please add PAYSTACK_SECRET_KEY in Vercel Project Settings > Environment Variables.');
  return key;
}

async function paystackRequest<T = any>(
  path: string,
  options: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: any; headers?: Record<string, string> } = {}
): Promise<{ ok: boolean; status: number; data: T }> {
  const secretKey = getPaystackSecretKey();
  const url = path.startsWith('http') ? path : `https://api.paystack.co${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  let data: any = null;
  try { data = await res.json(); } catch { data = null; }
  return { ok: res.ok, status: res.status, data };
}

// =========================================================================
// HANDLER: ADMIN IDENTITY REVIEW + BACKFILL
// =========================================================================
// Admins only (profiles.role = 'admin', which can only be granted in SQL).
// Everyone else gets 404 so the route does not advertise itself.
//
//   GET                                   -> open review items
//   POST { action: 'approve' | 'reject', reviewId, note? }
//   POST { action: 'backfill', after?, limit?, dryRun? }
//        Resolves saved bank accounts of users who are not verified yet with
//        Paystack and applies the same name check as /api/link-bank. Paged:
//        call again with after = nextCursor until nextCursor is null.

const BACKFILL_BUDGET_MS = 7000; // stay inside the serverless time limit

async function requireAdmin(req: VercelRequest): Promise<{ user: User; client: SupabaseClient }> {
  let user: User;
  try {
    ({ user } = await requireUser(req));
  } catch (err) {
    if (err instanceof HttpError) throw new HttpError(404, 'Not found');
    throw err;
  }
  const client = getSupabaseClient();
  const { data: me, error } = await client.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (error) throw new HttpError(503, 'Could not check access. Try again.');
  if (me?.role !== 'admin') throw new HttpError(404, 'Not found');
  return { user, client };
}

function isGenericName(name: string | null | undefined) {
  return !name || ['user', 'new user', 'guest'].includes(name.trim().toLowerCase());
}

async function resolveAccountName(accountNumber: string, bankCode: string): Promise<string | null> {
  const query = new URLSearchParams({ account_number: accountNumber, bank_code: bankCode });
  const r = await paystackRequest<{ status: boolean; data?: { account_name?: string } }>(`/bank/resolve?${query.toString()}`);
  const name = r.ok && r.data?.status ? String(r.data.data?.account_name || '').trim() : '';
  return name || null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'GET' && req.method !== 'POST') throw new HttpError(404, 'Not found');
    const { user, client } = await requireAdmin(req);

    if (req.method === 'GET') {
      const { data, error } = await client.rpc('list_identity_reviews', { p_limit: 200 });
      if (error) throw new HttpError(500, `Could not load reviews: ${error.message}`);
      return res.status(200).json({ status: true, data: { items: data || [] } });
    }

    const body = req.body || {};
    const action = String(body.action || '');

    if (action === 'approve' || action === 'reject') {
      const reviewId = String(body.reviewId || '');
      if (!/^[0-9a-f-]{36}$/i.test(reviewId)) throw new HttpError(400, 'reviewId is required.');
      const { data, error } = await client.rpc('decide_identity_review', {
        p_review_id: reviewId,
        p_approve: action === 'approve',
        p_admin: user.id,
        p_note: body.note ? String(body.note).slice(0, 500) : null,
      });
      if (error) {
        if (error.message.includes('review_not_found')) throw new HttpError(404, 'Review not found.');
        throw new HttpError(500, `Could not save the decision: ${error.message}`);
      }
      return res.status(200).json({ status: true, data });
    }

    if (action === 'backfill') {
      const dryRun = body.dryRun === true;
      const limit = Math.min(Math.max(Number(body.limit) || 20, 1), 50);
      const after = body.after && /^[0-9a-f-]{36}$/i.test(String(body.after)) ? String(body.after) : null;
      const { data: rows, error } = await client.rpc('list_identity_backfill_candidates', { p_after: after, p_limit: limit });
      if (error) throw new HttpError(500, `Could not load accounts: ${error.message}`);

      const started = Date.now();
      const results: { user_id: string; account: string; outcome: string; matched?: boolean }[] = [];
      let lastId: string | null = after;
      let stoppedEarly = false;
      for (const row of (rows || []) as any[]) {
        if (Date.now() - started > BACKFILL_BUDGET_MS) {
          stoppedEarly = true;
          break;
        }
        lastId = row.bank_account_id;
        const masked = `******${String(row.account_number).slice(-4)}`;
        let resolved: string | null = null;
        try {
          resolved = await resolveAccountName(row.account_number, row.bank_code);
        } catch {
          resolved = null;
        }
        if (!resolved) {
          results.push({ user_id: row.user_id, account: masked, outcome: 'resolve_failed' });
          continue;
        }
        const profileName = isGenericName(row.full_name) ? '' : String(row.full_name);
        const check = matchNames(profileName, resolved);
        if (dryRun) {
          results.push({ user_id: row.user_id, account: masked, outcome: check.match ? 'would_verify' : 'would_queue', matched: check.match });
          continue;
        }
        const { data: applied, error: applyErr } = await client.rpc('record_bank_identity_check', {
          p_user_id: row.user_id,
          p_bank_account_id: row.bank_account_id,
          p_bank_account_name: resolved,
          p_profile_name: profileName,
          p_matched: check.match,
          p_reason: check.reason,
          p_detail: { matched: check.matched, required: check.required, profile: check.profileUnits, bank: check.bankUnits },
          p_source: 'backfill',
        });
        if (applyErr) {
          console.error('[admin-identity] backfill apply failed', row.user_id, applyErr);
          results.push({ user_id: row.user_id, account: masked, outcome: 'error', matched: check.match });
        } else {
          results.push({ user_id: row.user_id, account: masked, outcome: (applied as any)?.kyc_status || 'unknown', matched: check.match });
        }
      }
      const more = stoppedEarly || (rows || []).length === limit;
      const count = (o: string) => results.filter(r => r.outcome === o).length;
      return res.status(200).json({
        status: true,
        data: {
          dryRun,
          processed: results.length,
          verified: count('verified') + count('would_verify'),
          pending: count('pending') + count('would_queue'),
          failed: count('resolve_failed') + count('error'),
          results,
          nextCursor: more ? lastId : null,
        },
      });
    }

    throw new HttpError(400, 'Unknown action.');
  } catch (err: any) {
    return handleApiError(res, err);
  }
}

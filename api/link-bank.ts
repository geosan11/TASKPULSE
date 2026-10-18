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
  console.error('[API Error: link-bank]', err);
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
  reason: 'match' | 'no_profile_name' | 'single_name' | 'no_bank_name' | 'name_mismatch';
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
 *   when the profile has exactly two names, both must appear
 * - a one-word profile name ("Emeka") never matches automatically: it is too
 *   weak to prove anything, so it goes to admin review (reason 'single_name')
 */
export function matchNames(profileName: string | null | undefined, bankName: string | null | undefined): NameMatchResult {
  const p = nameUnits(profileName);
  const b = nameUnits(bankName);
  const base = { profileUnits: p.map(u => u.parts.join('-')), bankUnits: b.map(u => u.parts.join('-')) };
  if (!p.some(u => !u.initial)) return { match: false, matched: [], required: 0, ...base, reason: 'no_profile_name' };
  if (!b.some(u => !u.initial)) return { match: false, matched: [], required: 0, ...base, reason: 'no_bank_name' };
  if (p.length === 1) return { match: false, matched: [], required: 2, ...base, reason: 'single_name' };

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
// HANDLER: LINK BANK ACCOUNT TO PAYSTACK & SUPABASE
// =========================================================================

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = adminActionOf(req);
  if (action !== null) return adminHandler(req, res, action);
  return linkBankHandler(req, res);
}

async function linkBankHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: false, message: 'Method Not Allowed' });
  }

  try {
    const { user, token } = await requireUser(req);
    const { accountNumber, bankCode, bankName } = req.body || {};

    const cleanAccount = String(accountNumber || '').trim();
    const cleanBankCode = String(bankCode || '').trim();
    const cleanBankName = String(bankName || '').trim().slice(0, 100);

    if (!/^\d{10}$/.test(cleanAccount)) {
      throw new HttpError(400, 'Invalid account number: Must be exactly 10 digits.');
    }
    if (!/^[a-zA-Z0-9]{3,6}$/.test(cleanBankCode)) {
      throw new HttpError(400, 'Invalid bank code format.');
    }

    const client = getSupabaseClient(token);

    // 1. Get user profile
    const { data: profile, error: profErr } = await client
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single();

    if (profErr || !profile) {
      throw new HttpError(404, 'User profile not found.');
    }

    // 2. Resolve account with Paystack
    const query = new URLSearchParams({
      account_number: cleanAccount,
      bank_code: cleanBankCode,
    });
    const resolveRes = await paystackRequest<{
      status: boolean;
      message: string;
      data?: { account_name: string; account_number: string };
    }>(`/bank/resolve?${query.toString()}`);

    if (!resolveRes.ok || !resolveRes.data?.status || !resolveRes.data.data) {
      throw new HttpError(400, resolveRes.data?.message || 'Unable to resolve bank account with Paystack.');
    }

    const resolvedName = resolveRes.data.data.account_name.trim();

    // 3. Name check (identity): compare the Paystack-resolved account name with
    //    the profile name. Never blocks saving; the result is applied after the
    //    account is saved (verified on a match, otherwise queued for review).
    const isGenericName = !profile.full_name ||
      ['user', 'new user', 'guest'].includes(profile.full_name.trim().toLowerCase());
    const profileNameForCheck = isGenericName ? '' : String(profile.full_name);
    const nameCheck = matchNames(profileNameForCheck, resolvedName);

    if (isGenericName) {
      // Fill an empty profile name from the bank. That is not proof of
      // identity, so this user still goes to review (reason no_profile_name).
      await client
        .from('profiles')
        .update({ full_name: resolvedName })
        .eq('id', user.id);
    }

    // 4. One verified payout account per user (anti-fraud). Re-linking the
    //    SAME account is allowed (refreshes the Paystack recipient).
    const { data: activeBanks, error: countErr } = await client
      .from('bank_accounts')
      .select('id, bank_code, account_number')
      .eq('user_id', user.id)
      .eq('is_active', true);

    if (countErr) {
      throw new HttpError(500, countErr.message);
    }
    const otherActive = (activeBanks || []).filter(
      (b: any) => !(b.bank_code === cleanBankCode && b.account_number === cleanAccount)
    );
    if (otherActive.length > 0) {
      throw new HttpError(400, 'You already have a verified payout account. Contact support to change it.');
    }

    // 5. One bank account belongs to one TaskPulse user (active or not).
    //    Early, friendly exit before creating a Paystack recipient; the RPC
    //    and the uq_bank_accounts_owner index (012) are the real guarantee.
    //    Rows marked duplicate_of lost their claim in 012 and are ignored.
    const { data: existingOther } = await client
      .from('bank_accounts')
      .select('id')
      .eq('account_number', cleanAccount)
      .eq('bank_code', cleanBankCode)
      .neq('user_id', user.id)
      .is('duplicate_of', null)
      .limit(1);

    if (existingOther && existingOther.length > 0) {
      throw new HttpError(400, 'This bank account is already linked to another TaskPulse account.');
    }

    // 6. Create Transfer Recipient on Paystack
    const recipientRes = await paystackRequest<{
      status: boolean;
      message: string;
      data?: {
        recipient_code: string;
      };
    }>('/transferrecipient', {
      method: 'POST',
      body: {
        type: 'nuban',
        name: resolvedName,
        account_number: cleanAccount,
        bank_code: cleanBankCode,
        currency: 'NGN',
        description: `TaskPulse payout recipient for user ${user.id}`,
      },
    });

    if (!recipientRes.ok || !recipientRes.data?.status || !recipientRes.data.data?.recipient_code) {
      throw new HttpError(
        502,
        recipientRes.data?.message || 'Failed to create Paystack transfer recipient.'
      );
    }

    const recipientCode = recipientRes.data.data.recipient_code;

    // 7. Save through the server-only RPC (enforces one account per user and
    //    no sharing of an account across users, under a row lock).
    const { data: savedBank, error: rpcErr } = await client.rpc('save_verified_bank_account', {
      p_user_id: user.id,
      p_bank_code: cleanBankCode,
      p_bank_name: cleanBankName || 'Commercial Bank',
      p_account_number: cleanAccount,
      p_account_name: resolvedName,
      p_recipient_code: recipientCode,
    });

    if (rpcErr || !savedBank) {
      const msg = rpcErr?.message || '';
      if (msg.includes('bank_already_linked')) {
        throw new HttpError(400, 'You already have a verified payout account. Contact support to change it.');
      }
      if (msg.includes('bank_linked_to_other_user') || rpcErr?.code === '23505' || msg.includes('uq_bank_accounts_owner')) {
        throw new HttpError(400, 'This bank account is already linked to another TaskPulse account.');
      }
      throw new HttpError(500, `Failed to save bank account: ${msg || 'unknown error'}`);
    }

    // 8. Apply the identity result (server-only RPC, service role).
    let kycStatus: string | null = null;
    const { data: idResult, error: idErr } = await client.rpc('record_bank_identity_check', {
      p_user_id: user.id,
      p_bank_account_id: (savedBank as any).id,
      p_bank_account_name: resolvedName,
      p_profile_name: profileNameForCheck,
      p_matched: nameCheck.match,
      p_reason: nameCheck.reason,
      p_detail: { matched: nameCheck.matched, required: nameCheck.required, profile: nameCheck.profileUnits, bank: nameCheck.bankUnits },
      p_source: 'bank_link',
    });
    if (idErr) {
      // The bank is saved; the admin backfill (or saving again) re-runs the check.
      console.error('[link-bank] record_bank_identity_check failed', user.id, idErr);
    } else {
      kycStatus = (idResult as any)?.kyc_status ?? null;
    }

    return res.status(200).json({
      status: true,
      message:
        kycStatus === 'verified'
          ? 'Bank account saved. Your ID is verified.'
          : kycStatus === 'pending'
            ? "Bank account saved. We're checking your account name. This usually takes a few hours."
            : 'Bank account saved.',
      data: savedBank,
      identity: { kyc_status: kycStatus, name_match: nameCheck.match },
    });
  } catch (err: any) {
    return handleApiError(res, err);
  }
}

// =========================================================================
// ADMIN ACTIONS: IDENTITY REVIEW + BACKFILL (same function as link-bank, so
// they cost no extra Vercel function; dispatched on `action`)
// =========================================================================
// Admins only (profiles.role = 'admin', which can only be granted in SQL).
// Everyone else gets 404 for any request that carries an `action`, so the
// admin actions do not advertise themselves. Plain bank linking (POST without
// `action`) is unchanged.
//
//   GET  ?action=reviews                  -> open review items
//   POST { action: 'approve' | 'reject', reviewId, note? }
//   POST { action: 'set_name', username, fullName }   (support: change a
//        verified user's locked name; the DB lets service_role through)
//   POST { action: 'backfill', after?, limit?, dryRun? }
//        Resolves saved bank accounts of users who are not verified yet with
//        Paystack and applies the same name check as linking a bank. Paged:
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

function isPlaceholderName(name: string | null | undefined) {
  return !name || ['user', 'new user', 'guest'].includes(name.trim().toLowerCase());
}

async function resolveAccountName(accountNumber: string, bankCode: string): Promise<string | null> {
  const query = new URLSearchParams({ account_number: accountNumber, bank_code: bankCode });
  const r = await paystackRequest<{ status: boolean; data?: { account_name?: string } }>(`/bank/resolve?${query.toString()}`);
  const name = r.ok && r.data?.status ? String(r.data.data?.account_name || '').trim() : '';
  return name || null;
}

/** The admin action named by the request, or null for a normal bank-link call. */
function adminActionOf(req: VercelRequest): string | null {
  const raw = req.method === 'GET' ? (req.query || {}).action : (req.body || {}).action;
  const action = Array.isArray(raw) ? raw[0] : raw;
  return typeof action === 'string' && action.length > 0 ? action : null;
}

async function adminHandler(req: VercelRequest, res: VercelResponse, action: string) {
  try {
    if (req.method !== 'GET' && req.method !== 'POST') throw new HttpError(404, 'Not found');
    const { user, client } = await requireAdmin(req);

    if (req.method === 'GET') {
      if (action !== 'reviews') throw new HttpError(400, 'Unknown action.');
      const { data, error } = await client.rpc('list_identity_reviews', { p_limit: 200 });
      if (error) throw new HttpError(500, `Could not load reviews: ${error.message}`);
      return res.status(200).json({ status: true, data: { items: data || [] } });
    }

    const body = req.body || {};

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

    if (action === 'set_name') {
      const username = String(body.username || '').trim().replace(/^@/, '').toLowerCase();
      const fullName = String(body.fullName || '').trim().replace(/\s+/g, ' ');
      if (!username) throw new HttpError(400, 'username is required.');
      if (fullName.length < 2 || fullName.length > 100) throw new HttpError(400, 'Enter a name of 2 to 100 characters.');
      const { data, error } = await client
        .from('profiles')
        .update({ full_name: fullName })
        .eq('username', username)
        .select('id, username, full_name, kyc_status');
      if (error) throw new HttpError(500, `Could not change the name: ${error.message}`);
      if (!data || data.length === 0) throw new HttpError(404, 'No user with that username.');
      console.log('[link-bank admin] name changed', { by: user.id, user: data[0].id });
      return res.status(200).json({ status: true, data: data[0] });
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
        const profileName = isPlaceholderName(row.full_name) ? '' : String(row.full_name);
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
          console.error('[link-bank admin] backfill apply failed', row.user_id, applyErr);
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

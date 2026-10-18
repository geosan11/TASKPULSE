/**
 * /api/link-bank (bank-name identity check) and /api/admin-identity (admin
 * review + backfill) with Supabase and Paystack mocked. No network, no secrets.
 * Run: npm run test:bank-identity
 */
let failed = 0;
const check = (name: string, ok: boolean, info?: unknown) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' ' + JSON.stringify(info)}`);
  if (!ok) failed++;
};

// supabase-js wants a WebSocket class at construction (Node < 22 has none); never used here.
(globalThis as any).WebSocket ??= class {};
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
process.env.SUPABASE_URL = 'http://supabase.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = `${b64({ alg: 'none' })}.${b64({ role: 'service_role' })}.x`;
process.env.PAYSTACK_SECRET_KEY = 'sk_test_MOCK';

const USER = 'aaaaaaaa-0000-4000-8000-0000000000aa';
const ADMIN = 'aaaaaaaa-0000-4000-8000-0000000000ad';
const state = {
  authUser: USER as string | null,
  profileName: 'George Sanni' as string | null,
  role: 'worker',
  resolvedName: 'SANNI GEORGE EMMANUEL' as string | null,
  otherOwner: false,
  saveError: null as null | { message: string; code?: string },
  kycAfter: 'verified',
  candidates: [] as any[],
};
type Call = { method: string; url: string; body: any };
const calls: Call[] = [];
const rpcBodies = (name: string) => calls.filter(c => c.url.includes(`/rest/v1/rpc/${name}`)).map(c => c.body);

globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const method = init?.method || 'GET';
  let body: any = null;
  try { body = init?.body ? JSON.parse(String(init.body)) : null; } catch { body = init?.body; }
  calls.push({ method, url, body });
  const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  const u = new URL(url);
  if (u.host === 'supabase.local') {
    if (u.pathname === '/auth/v1/user') return state.authUser ? json(200, { id: state.authUser, aud: 'authenticated', role: 'authenticated' }) : json(401, { message: 'bad jwt' });
    if (u.pathname === '/rest/v1/profiles') {
      if (method === 'PATCH') {
        const un = u.searchParams.get('username');
        if (un) return json(200, un === 'eq.nobody' ? [] : [{ id: 'u9', username: un.slice(3), full_name: body.full_name, kyc_status: 'verified' }]);
        return json(204, null);
      }
      if (u.searchParams.get('select') === 'role') return json(200, { role: state.role });
      return json(200, { full_name: state.profileName });
    }
    if (u.pathname === '/rest/v1/bank_accounts') {
      if (u.searchParams.get('neq') || u.searchParams.has('user_id') && String(u.searchParams.get('user_id')).startsWith('neq.')) {
        return json(200, state.otherOwner ? [{ id: 'other' }] : []);
      }
      return json(200, []);
    }
    if (u.pathname === '/rest/v1/rpc/save_verified_bank_account') {
      if (state.saveError) return json(400, state.saveError);
      return json(200, { id: 'bbbbbbbb-0000-4000-8000-0000000000b1', account_name: body.p_account_name });
    }
    if (u.pathname === '/rest/v1/rpc/record_bank_identity_check') return json(200, { kyc_status: state.kycAfter, queued: state.kycAfter === 'pending' });
    if (u.pathname === '/rest/v1/rpc/list_identity_reviews') return json(200, [{ review_id: 'r1', username: 'x' }]);
    if (u.pathname === '/rest/v1/rpc/decide_identity_review') return json(200, { success: true, status: body.p_approve ? 'approved' : 'rejected' });
    if (u.pathname === '/rest/v1/rpc/list_identity_backfill_candidates') return json(200, state.candidates.slice(0, body.p_limit));
  }
  if (u.host === 'api.paystack.co') {
    if (u.pathname === '/bank/resolve') {
      const acct = u.searchParams.get('account_number');
      const name = acct === '9999999999' ? null : acct === '1111111111' ? 'ADEBAYO TUNDE' : state.resolvedName;
      return name ? json(200, { status: true, data: { account_name: name, account_number: acct } }) : json(422, { status: false, message: 'Could not resolve account name.' });
    }
    if (u.pathname === '/transferrecipient') return json(200, { status: true, data: { recipient_code: 'RCP_mock' } });
  }
  return json(599, { message: `unexpected ${method} ${url}` });
}) as typeof fetch;

const mockRes = () => {
  const r: any = { statusCode: 200, payload: undefined };
  r.status = (c: number) => ((r.statusCode = c), r);
  r.json = (b: any) => ((r.payload = b), r);
  return r;
};
const run = async (h: any, req: any) => {
  calls.length = 0;
  const r = mockRes();
  await h({ headers: { authorization: 'Bearer user.jwt' }, query: {}, ...req }, r);
  return r;
};

const linkBank = (await import('../../api/link-bank.ts')).default;
const admin = (await import('../../api/admin-identity.ts')).default;
const linkBody = { accountNumber: '0123456789', bankCode: '058', bankName: 'GTBank', accountName: 'CLIENT SAYS SO' };

// ---- link-bank -----------------------------------------------------------
let r = await run(linkBank, { method: 'POST', body: linkBody });
let rec = rpcBodies('record_bank_identity_check')[0];
check('link: saves and returns verified on a name match', r.statusCode === 200 && r.payload?.identity?.kyc_status === 'verified', r.payload);
check('link: resolved name used, client name ignored', rpcBodies('save_verified_bank_account')[0]?.p_account_name === 'SANNI GEORGE EMMANUEL' && rec?.p_bank_account_name === 'SANNI GEORGE EMMANUEL', rec);
check('link: match recorded server-side', rec?.p_matched === true && rec?.p_reason === 'match' && rec?.p_source === 'bank_link' && rec?.p_profile_name === 'George Sanni', rec);
check('link: resolved via Paystack', calls.some(c => c.url.startsWith('https://api.paystack.co/bank/resolve')));

state.resolvedName = 'ADEYEMI KUNLE';
state.kycAfter = 'pending';
r = await run(linkBank, { method: 'POST', body: linkBody });
rec = rpcBodies('record_bank_identity_check')[0];
check('link: mismatch still saves the account (no hard error)', r.statusCode === 200 && rpcBodies('save_verified_bank_account').length === 1, r.payload);
check('link: mismatch recorded for review', rec?.p_matched === false && rec?.p_reason === 'name_mismatch' && r.payload?.identity?.kyc_status === 'pending', rec);
check('link: pending message', /checking your account name/.test(r.payload?.message || ''), r.payload);

state.profileName = 'New User';
state.resolvedName = 'SANNI GEORGE';
r = await run(linkBank, { method: 'POST', body: linkBody });
rec = rpcBodies('record_bank_identity_check')[0];
check('link: generic profile name is filled from the bank but not auto-verified', rec?.p_matched === false && rec?.p_reason === 'no_profile_name'
  && calls.some(c => c.method === 'PATCH' && c.url.includes('/rest/v1/profiles')), rec);
state.profileName = 'George Sanni';

state.profileName = 'Emeka';
state.resolvedName = 'EMEKA NWOSU';
r = await run(linkBank, { method: 'POST', body: linkBody });
rec = rpcBodies('record_bank_identity_check')[0];
check('link: one-word profile name never auto-verifies (review, single_name)', rec?.p_matched === false && rec?.p_reason === 'single_name', rec);
state.profileName = 'George Sanni';

state.otherOwner = true;
r = await run(linkBank, { method: 'POST', body: linkBody });
check('link: account owned by another user -> friendly error, nothing saved', r.statusCode === 400 && r.payload?.message === 'This bank account is already linked to another TaskPulse account.'
  && rpcBodies('save_verified_bank_account').length === 0 && !calls.some(c => c.url.includes('/transferrecipient')), r.payload);
state.otherOwner = false;
for (const err of [{ message: 'bank_linked_to_other_user' }, { message: 'duplicate key value violates unique constraint "uq_bank_accounts_owner"', code: '23505' }]) {
  state.saveError = err;
  r = await run(linkBank, { method: 'POST', body: linkBody });
  check(`link: ${err.code || err.message} -> friendly error`, r.statusCode === 400 && r.payload?.message === 'This bank account is already linked to another TaskPulse account.', r.payload);
}
state.saveError = null;

// ---- admin-identity ------------------------------------------------------
state.role = 'worker';
r = await run(admin, { method: 'GET' });
check('admin: non-admin gets 404', r.statusCode === 404 && !calls.some(c => c.url.includes('/rpc/')), r.payload);
r = await run(admin, { method: 'POST', body: { action: 'backfill' } });
r = await run(admin, { method: 'POST', body: { action: 'set_name', username: 'someone', fullName: 'New Name' } });
check('admin: non-admin cannot change names (404, no write)', r.statusCode === 404 && !calls.some(c => c.method === 'PATCH'), r.payload);
r = await run(admin, { method: 'POST', body: { action: 'backfill' } });
check('admin: non-admin backfill 404, no Paystack', r.statusCode === 404 && !calls.some(c => c.url.includes('paystack')), r.payload);
state.authUser = null;
r = await run(admin, { method: 'GET', headers: {} });
check('admin: signed out gets 404', r.statusCode === 404, r.payload);
state.authUser = ADMIN;
state.role = 'admin';
r = await run(admin, { method: 'GET' });
check('admin: lists open reviews', r.statusCode === 200 && r.payload?.data?.items?.length === 1, r.payload);
r = await run(admin, { method: 'POST', body: { action: 'approve', reviewId: '11111111-2222-4333-8444-555555555555' } });
const dec = rpcBodies('decide_identity_review')[0];
check('admin: approve passes the admin id from the session', r.statusCode === 200 && dec?.p_approve === true && dec?.p_admin === ADMIN, dec);
r = await run(admin, { method: 'POST', body: { action: 'reject', reviewId: '11111111-2222-4333-8444-555555555555', note: 'names differ' } });
check('admin: reject', rpcBodies('decide_identity_review')[0]?.p_approve === false, rpcBodies('decide_identity_review'));

r = await run(admin, { method: 'POST', body: { action: 'set_name', username: '@Ada_Obi', fullName: '  Ada   Nkechi Obi ' } });
const patch = calls.find(c => c.method === 'PATCH');
check('admin: set_name updates by username with a tidied name', r.statusCode === 200 && !!patch?.url.includes('username=eq.ada_obi') && patch?.body?.full_name === 'Ada Nkechi Obi', { r: r.payload, patch });
r = await run(admin, { method: 'POST', body: { action: 'set_name', username: 'nobody', fullName: 'X Y' } });
check('admin: set_name unknown user -> 404', r.statusCode === 404, r.payload);
r = await run(admin, { method: 'POST', body: { action: 'set_name', username: 'ada', fullName: 'A' } });
check('admin: set_name rejects a too-short name', r.statusCode === 400, r.payload);

state.candidates = [
  { bank_account_id: '00000000-0000-4000-8000-000000000001', user_id: 'u1', bank_code: '058', account_number: '0123456789', account_name: 'OLD', full_name: 'George Sanni', kyc_status: 'unverified' },
  { bank_account_id: '00000000-0000-4000-8000-000000000002', user_id: 'u2', bank_code: '058', account_number: '1111111111', account_name: 'OLD', full_name: 'Chiamaka Obi', kyc_status: 'pending' },
  { bank_account_id: '00000000-0000-4000-8000-000000000003', user_id: 'u3', bank_code: '058', account_number: '9999999999', account_name: 'OLD', full_name: 'Bola Ade', kyc_status: 'unverified' },
];
state.resolvedName = 'SANNI GEORGE';
r = await run(admin, { method: 'POST', body: { action: 'backfill', dryRun: true } });
check('backfill dry run: nothing recorded', r.statusCode === 200 && rpcBodies('record_bank_identity_check').length === 0
  && r.payload?.data?.verified === 1 && r.payload?.data?.pending === 1 && r.payload?.data?.failed === 1, r.payload);
state.kycAfter = 'verified';
r = await run(admin, { method: 'POST', body: { action: 'backfill' } });
const recs = rpcBodies('record_bank_identity_check');
check('backfill: resolves and records match / mismatch', recs.length === 2 && recs[0].p_matched === true && recs[0].p_bank_account_name === 'SANNI GEORGE'
  && recs[1].p_matched === false && recs.every(b => b.p_source === 'backfill'), recs);
check('backfill: unresolvable account skipped, reported', r.payload?.data?.failed === 1 && r.payload?.data?.nextCursor === null, r.payload?.data);
r = await run(admin, { method: 'POST', body: { action: 'backfill', limit: 2 } });
check('backfill: pages with nextCursor', r.payload?.data?.nextCursor === '00000000-0000-4000-8000-000000000002', r.payload?.data);
check('backfill: results are masked', JSON.stringify(r.payload).includes('******6789') && !JSON.stringify(r.payload).includes('0123456789'), r.payload);

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nbank identity API tests: PASS');

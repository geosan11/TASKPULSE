/**
 * Withdrawals need a verified ID. Checks the app's prompt/error mapping and
 * that the server-side guards are in place (API + migration 012).
 * Run: npm run test:withdraw-id   (no secrets or database needed)
 * The database behaviour itself is covered by supabase/tests/70_withdraw_id_012.sql.
 */
import { readFileSync } from 'node:fs';
import {
  ADD_BANK_PROMPT,
  bankSavedNotice,
  CHECK_BANK_PROMPT,
  ID_REQUIRED_CODE,
  isIdRequiredError,
  PENDING_PROMPT,
  REJECTED_PROMPT,
  withdrawIdPrompt,
} from '../../src/lib/withdrawId';

let failed = 0;
const check = (name: string, ok: boolean, info?: unknown) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' ' + JSON.stringify(info)}`);
  if (!ok) failed++;
};

// What the app shows when Withdraw is tapped
check('verified: no prompt', withdrawIdPrompt('verified', true) === null && withdrawIdPrompt('verified', false) === null);
check('unverified, no bank: add bank', withdrawIdPrompt('unverified', false) === ADD_BANK_PROMPT && ADD_BANK_PROMPT.action === 'add_bank');
check('unverified, bank saved: check it', withdrawIdPrompt('unverified', true) === CHECK_BANK_PROMPT && CHECK_BANK_PROMPT.action === 'check_bank');
check('missing status: add bank', withdrawIdPrompt(undefined, false) === ADD_BANK_PROMPT && withdrawIdPrompt('', false) === ADD_BANK_PROMPT);
check('pending: agreed copy, no button', withdrawIdPrompt('pending', true) === PENDING_PROMPT && PENDING_PROMPT.action === null
  && PENDING_PROMPT.body === "We're checking your account name. This usually takes a few hours.");
check('rejected: contact support, no button', withdrawIdPrompt('rejected', true) === REJECTED_PROMPT && REJECTED_PROMPT.action === null);
check('copy keeps the one-time line', ADD_BANK_PROMPT.body.includes("It's a one-time check that keeps payouts safe."));
check('bank saved notice: verified', bankSavedNotice('verified').subtitle.includes('verified'));
check('bank saved notice: pending', bankSavedNotice('pending').subtitle === PENDING_PROMPT.body);

// Mapping the server error (shape of lib/api's ApiError: message + code)
const apiError = (message: string, code?: string) => Object.assign(new Error(message), { status: 403, code });
check('ApiError with code maps', isIdRequiredError(apiError('x', ID_REQUIRED_CODE)));
check('raw RPC message maps', isIdRequiredError(new Error('Withdrawal request blocked: identity_not_verified')));
check('other errors do not map', !isIdRequiredError(apiError('Insufficient withdrawable wallet balance.')) && !isIdRequiredError(null) && !isIdRequiredError('identity_not_verified'));

// Server guards are present
const api = readFileSync(new URL('../../api/disburse-transfer.ts', import.meta.url), 'utf8');
const idCheck = api.indexOf(".select('kyc_status')");
check('API reads kyc_status', idCheck > 0);
check('API checks ID before request_cashout and Paystack', idCheck > 0 && idCheck < api.indexOf("rpc('request_cashout'") && idCheck < api.indexOf("'/transfer'"));
check('API returns the code the app maps', api.includes(`'${ID_REQUIRED_CODE}'`) && api.includes('ID_REQUIRED_MESSAGE, ID_REQUIRED_CODE'));
const sql = readFileSync(new URL('../../supabase/012_withdraw_requires_id.sql', import.meta.url), 'utf8');
const mirror = readFileSync(new URL('../../supabase/migrations/20261018000012_withdraw_requires_id.sql', import.meta.url), 'utf8');
check('012 and its migrations/ copy are identical', sql === mirror);
check('012 raises identity_not_verified', /kyc_status, 'unverified'\) <> 'verified'[\s\S]*RAISE EXCEPTION 'identity_not_verified'/.test(sql));
check('012 checks ID before locking money', sql.indexOf('identity_not_verified') < sql.indexOf('withdrawable_balance = withdrawable_balance - p_amount'));
check('012 does not reference 011 objects', !/payout_status|review_deadline|_release_submission|fast_approv/i.test(sql.replace(/^--.*$/gm, '')));

// Handler: an unverified user is refused before any money RPC or Paystack call
// (Supabase and Paystack are mocked; nothing leaves this process).
// supabase-js wants a WebSocket class at construction (Node < 22 has none); never used here.
(globalThis as any).WebSocket ??= class {};
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
process.env.SUPABASE_URL = 'http://supabase.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = `${b64({ alg: 'none' })}.${b64({ role: 'service_role' })}.x`;
process.env.PAYSTACK_SECRET_KEY = 'sk_test_MOCK';
let kycStatus: string | null = 'unverified';
let profileFails = false;
let rpcMessage = 'stop here';
const calls: string[] = [];
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  calls.push(`${init?.method || 'GET'} ${url}`);
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  if (url.startsWith('http://supabase.local/auth/v1/user')) return json(200, { id: 'aaaaaaaa-0000-4000-8000-0000000000aa', aud: 'authenticated', role: 'authenticated' });
  if (url.startsWith('http://supabase.local/rest/v1/profiles')) {
    if (profileFails) return json(500, { message: 'boom', code: 'XX000' });
    return json(200, { kyc_status: kycStatus });
  }
  if (url.startsWith('http://supabase.local/rest/v1/rpc/request_cashout')) return json(400, { message: rpcMessage, code: 'P0001' });
  return json(599, { message: 'unexpected' });
}) as typeof fetch;
const handler = (await import('../../api/disburse-transfer.ts')).default;
const call = async () => {
  calls.length = 0;
  const r: any = { statusCode: 200, payload: undefined };
  r.status = (c: number) => ((r.statusCode = c), r);
  r.json = (b: any) => ((r.payload = b), r);
  await handler(
    { method: 'POST', headers: { authorization: 'Bearer user.jwt.token' }, body: { amount: 1000, bankAccountId: 'b1', idempotencyKey: 'k1' } } as any,
    r
  );
  return r;
};
const noMoney = () => !calls.some(c => c.includes('/rpc/') || c.includes('paystack'));
for (const st of ['unverified', 'pending', 'rejected', null]) {
  kycStatus = st;
  const r = await call();
  check(`handler refuses ${st ?? 'missing'} ID with 403 + code`, r.statusCode === 403 && r.payload?.code === ID_REQUIRED_CODE && /bank account/.test(r.payload?.message || ''), r.payload);
  check(`handler (${st ?? 'missing'}) calls no money RPC or Paystack`, noMoney(), calls);
}
profileFails = true;
let r = await call();
check('handler fails closed if the ID check cannot run', r.statusCode === 503 && noMoney(), { s: r.statusCode, calls });
profileFails = false;
kycStatus = 'verified';
r = await call();
check('verified ID goes on to request_cashout', calls.some(c => c.includes('/rpc/request_cashout')), calls);
rpcMessage = 'identity_not_verified'; // e.g. status changed between the two checks
r = await call();
check('request_cashout refusal maps to the same 403 + code', r.statusCode === 403 && r.payload?.code === ID_REQUIRED_CODE && !calls.some(c => c.includes('paystack')), r.payload);

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll withdraw ID checks passed');

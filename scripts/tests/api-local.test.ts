/**
 * Local-only tests for api/paystack-webhook.ts and api/verify-transaction.ts.
 *
 * Needs (all on localhost, never production):
 *   - a local Postgres with supabase/tests fixtures + migration 008
 *   - PostgREST on LOCAL_REST (default http://127.0.0.1:3999) using a JWT secret
 *   - a mock Paystack on LOCAL_PAYSTACK (default http://127.0.0.1:4999) that
 *     answers /transaction/verify/dep_ok* with success, amount 314721 kobo
 *   - SERVICE_JWT: a service_role JWT signed with the PostgREST secret
 *   - ANON_JWT (optional): an anon JWT, to test the misconfiguration guard
 *
 * Run (Node 22+, supabase-js needs native WebSocket): SERVICE_JWT=... npm run test:api
 */
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';

const LOCAL_REST = process.env.LOCAL_REST || 'http://127.0.0.1:3999';
const LOCAL_PAYSTACK = process.env.LOCAL_PAYSTACK || 'http://127.0.0.1:4999';
const DB = process.env.LOCAL_DB || 'tp_rec';
const SERVICE_JWT = process.env.SERVICE_JWT || '';
if (!SERVICE_JWT) throw new Error('SERVICE_JWT is required');
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(LOCAL_REST) || !/^http:\/\/(127\.0\.0\.1|localhost)/.test(LOCAL_PAYSTACK)) {
  throw new Error('Local endpoints only.');
}

// Route every outbound request to local stand-ins.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  let url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  url = url.replace('http://supabase.local/rest/v1', LOCAL_REST).replace('https://api.paystack.co', LOCAL_PAYSTACK);
  if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(url)) throw new Error(`blocked non-local request: ${url}`);
  return realFetch(url, init);
}) as typeof fetch;

process.env.SUPABASE_URL = 'http://supabase.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_JWT;
process.env.PAYSTACK_SECRET_KEY = 'sk_test_LOCALMOCK';

const USER = 'aaaaaaaa-0000-4000-8000-000000000001';
function sql(q: string): string {
  return execFileSync('sudo', ['-u', 'postgres', 'psql', '-qAt', '-d', DB, '-c', q], { encoding: 'utf8' }).trim();
}
const balance = () => Number(sql(`select withdrawable_balance from profiles where id='${USER}'`));
function newPending(ref: string) {
  sql(`insert into transactions (user_id,type,amount,status,reference,title,description)
       values ('${USER}','deposit',3000,'pending','${ref}','Account Activation Deposit','Awaiting Paystack confirmation')`);
}

function mockReq(opts: { method?: string; headers?: Record<string, string>; raw?: Buffer; body?: any; query?: any; consumed?: boolean }) {
  const stream: any = opts.consumed ? Readable.from([]) : Readable.from(opts.raw ? [opts.raw] : []);
  if (opts.consumed) { stream.resume(); }
  stream.method = opts.method || 'POST';
  stream.headers = opts.headers || {};
  stream.query = opts.query || {};
  if (opts.body !== undefined) stream.body = opts.body;
  return stream;
}
function mockRes() {
  const r: any = { statusCode: 200, payload: undefined };
  r.status = (c: number) => ((r.statusCode = c), r);
  r.json = (b: any) => ((r.payload = b), r);
  r.send = (b: any) => ((r.payload = b), r);
  return r;
}

let failed = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  ${JSON.stringify(extra)}`}`);
  if (!cond) failed++;
}

async function main() {
  const webhook = (await import('../../api/paystack-webhook.ts')).default;
  const verify = (await import('../../api/verify-transaction.ts')).default;
  const sign = (b: Buffer) => crypto.createHmac('sha512', 'sk_test_LOCALMOCK').update(b).digest('hex');
  const suffix = crypto.randomBytes(6).toString('hex');

  // 1. webhook charge.success with fee-inclusive amount credits once; replay is a no-op
  const ref1 = `dep_ok_wh_${suffix}`;
  newPending(ref1);
  const b0 = balance();
  const raw = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: ref1, amount: 314721, currency: 'NGN', status: 'success' } }));
  let res = mockRes();
  await webhook(mockReq({ raw, headers: { 'x-paystack-signature': sign(raw) } }) as any, res);
  check('webhook charge.success -> 200', res.statusCode === 200, res.payload);
  check('webhook credited N3000 (fee-inclusive 314721 kobo)', balance() === b0 + 3000, { b0, now: balance() });
  res = mockRes();
  await webhook(mockReq({ raw, headers: { 'x-paystack-signature': sign(raw) } }) as any, res);
  check('webhook replay -> 200', res.statusCode === 200, res.payload);
  check('webhook replay did not double-credit', balance() === b0 + 3000, { b0, now: balance() });

  // 2. bad signature
  res = mockRes();
  await webhook(mockReq({ raw, headers: { 'x-paystack-signature': 'deadbeef' } }) as any, res);
  check('webhook bad signature -> 401', res.statusCode === 401, res.payload);

  // 3. foreign reference acknowledged without touching the DB
  const rawF = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: 'T123456789', amount: 100, currency: 'NGN', status: 'success' } }));
  res = mockRes();
  await webhook(mockReq({ raw: rawF, headers: { 'x-paystack-signature': sign(rawF) } }) as any, res);
  check('webhook foreign reference -> 200 (no retry storm)', res.statusCode === 200, res.payload);

  // 4. runtime already buffered the body: still verifies against raw string
  const ref2 = `dep_ok_wh2_${suffix}`;
  newPending(ref2);
  const raw2 = Buffer.from(JSON.stringify({ event: 'charge.success', data: { reference: ref2, amount: 314721, currency: 'NGN', status: 'success' } }));
  const req2: any = mockReq({ consumed: true, headers: { 'x-paystack-signature': sign(raw2) } });
  req2.rawBody = raw2;
  await new Promise((r) => setTimeout(r, 20));
  res = mockRes();
  await webhook(req2, res);
  check('webhook with pre-buffered raw body -> 200', res.statusCode === 200, res.payload);
  check('pre-buffered webhook settled', sql(`select status from transactions where reference='${ref2}'`) === 'settled');

  // 5. verify-transaction (Paystack redirect, no auth header)
  const ref3 = `dep_ok_v_${suffix}`;
  newPending(ref3);
  const b1 = balance();
  res = mockRes();
  await verify(mockReq({ body: { reference: ref3 } }) as any, res);
  check('verify -> 200 credited', res.statusCode === 200 && res.payload?.status === true, res.payload);
  check('verify credited N3000 once', balance() === b1 + 3000, { b1, now: balance() });
  check('verify does not leak balance without auth', res.payload?.data?.profile == null, res.payload?.data);
  res = mockRes();
  await verify(mockReq({ body: { reference: ref3 } }) as any, res);
  check('verify replay -> 200, no double credit', res.statusCode === 200 && balance() === b1 + 3000, res.payload);

  // 6. reference validation
  res = mockRes();
  await verify(mockReq({ body: { reference: '../../bank' } }) as any, res);
  check('verify rejects malformed reference -> 400', res.statusCode === 400, res.payload);

  // 7. unpaid reference is reported, not credited
  const ref4 = `dep_unpaid_${suffix}`;
  newPending(ref4);
  res = mockRes();
  await verify(mockReq({ body: { reference: ref4 } }) as any, res);
  check('verify of unpaid reference -> 400, stays pending', res.statusCode === 400 && sql(`select status from transactions where reference='${ref4}'`) === 'pending', res.payload);

  console.log(failed ? `\n${failed} FAILED` : '\nall API checks passed');
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });

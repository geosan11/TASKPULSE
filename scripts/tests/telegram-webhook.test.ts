/**
 * Local unit tests for api/telegram-webhook.ts with mock Telegram updates.
 * No network: every fetch is intercepted (Bot API calls are recorded, the
 * Supabase task query returns fixtures).
 *
 * Run: npx tsx scripts/tests/telegram-webhook.test.ts
 */
process.env.TELEGRAM_BOT_TOKEN = 'TEST_TOKEN';
process.env.TELEGRAM_WEBHOOK_SECRET = 'test_secret_0123456789abcdef';
process.env.SUPABASE_URL = 'http://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

type Call = { method: string; body: any };
let calls: Call[] = [];
let taskRows: any[] = [];
let taskStatus = 200;
let lastTaskQuery = '';
let photoOk = true;

globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(typeof input === 'string' ? input : input.url);
  if (url.startsWith('https://api.telegram.org/botTEST_TOKEN/')) {
    const method = url.split('/').pop()!;
    const body = init?.body ? JSON.parse(init.body) : {};
    calls.push({ method, body });
    const ok = method === 'sendPhoto' ? photoOk : true;
    return new Response(JSON.stringify({ ok, result: {} }), { status: ok ? 200 : 400 });
  }
  if (url.startsWith('http://supabase.test/rest/v1/tasks')) {
    lastTaskQuery = decodeURIComponent(url);
    return new Response(JSON.stringify(taskRows), { status: taskStatus });
  }
  throw new Error(`unexpected fetch ${url}`);
}) as typeof fetch;

const mod = await import('../../api/telegram-webhook.ts');
const handler = mod.default;

let failed = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + JSON.stringify(extra)}`);
  if (!cond) failed++;
};
const reset = () => { calls = []; mod._resetRateLimit(); photoOk = true; taskStatus = 200; };
let uid = 1;
const privMsg = (text: string, chatId = 1001) => ({ update_id: uid++, message: { message_id: uid, from: { id: chatId, first_name: 'Ada' }, chat: { id: chatId, type: 'private' }, text } });
const groupMsg = (text: string) => ({ update_id: uid++, message: { message_id: uid, from: { id: 7, first_name: 'Bola' }, chat: { id: -500, type: 'supergroup' }, text } });

async function post(update: any, secret: string | null = process.env.TELEGRAM_WEBHOOK_SECRET!) {
  const res: any = { code: 0, body: null as any };
  res.status = (c: number) => ((res.code = c), res);
  res.json = (b: any) => ((res.body = b), res);
  await handler({ method: 'POST', headers: secret ? { 'x-telegram-bot-api-secret-token': secret } : {}, body: update } as any, res);
  return res;
}
const allButtons = (body: any) => (body?.reply_markup?.inline_keyboard || []).flat();

// --- auth
reset();
check('rejects missing secret (401)', (await post(privMsg('/start'), null)).code === 401);
check('rejects wrong secret (401)', (await post(privMsg('/start'), 'wrong_secret_0123456789abcdef')).code === 401);
check('no Bot API call on rejected request', calls.length === 0, calls);
const getRes: any = { status(c: number) { this.code = c; return this; }, json() { return this; } };
await handler({ method: 'GET', headers: {} } as any, getRes);
check('GET -> 405', getRes.code === 405);

// --- /start
reset();
let r = await post(privMsg('/start'));
check('/start -> 200 start', r.code === 200 && r.body.result === 'start', r.body);
check('/start sends mascot-happy photo', calls[0]?.method === 'sendPhoto' && calls[0].body.photo === 'https://www.taskpulse.website/brand/mascot-happy.png', calls[0]);
check('/start caption has the promise', /No deposit, ever\./.test(calls[0]?.body.caption));
const btns = allButtons(calls[0]?.body).map((b: any) => b.text);
check('/start has 4 buttons', ['Start earning', 'Latest tasks', 'How it works', 'Post tasks (for businesses)'].every(t => btns.some((b: string) => b.includes(t))), btns);
const start = allButtons(calls[0]?.body).find((b: any) => b.text.includes('Start earning'));
check('Start earning url has utm_source=telegram, no ref', start?.url === 'https://www.taskpulse.website/?utm_source=telegram', start);

reset();
await post(privMsg('/start ref_tp-adaeze'));
const startRef = allButtons(calls[0]?.body).find((b: any) => b.text.includes('Start earning'));
check('/start ref_CODE -> ?ref=CODE&utm_source=telegram', startRef?.url === 'https://www.taskpulse.website/?ref=TP-ADAEZE&utm_source=telegram', startRef);
check('caption mentions referral code', /TP-ADAEZE/.test(calls[0]?.body.caption));

reset();
await post(privMsg('/start ref_<script>'));
const startBad = allButtons(calls[0]?.body).find((b: any) => b.text.includes('Start earning'));
check('invalid ref payload ignored', startBad?.url === 'https://www.taskpulse.website/?utm_source=telegram', startBad);

reset(); photoOk = false;
await post(privMsg('/start'));
check('photo failure falls back to text message', calls.map(c => c.method).join(',') === 'sendPhoto,sendMessage', calls.map(c => c.method));

// --- /tasks
reset();
taskRows = [
  { id: 'cmp_a', title: 'Install Kobo <Notes>', company: 'Kobo', reward: 300, spots_left: 42, spots_total: 50 },
  { id: 'cmp_b', title: 'Survey', company: 'ChowNow', reward: 150, spots_left: 1, spots_total: 20 },
];
r = await post(privMsg('/tasks'));
const tmsg = calls.find(c => c.method === 'sendMessage');
check('/tasks -> sendMessage list', r.body.result === 'tasks' && Boolean(tmsg));
check('task query only open + funded', /is_active=eq\.true/.test(lastTaskQuery) && /spots_left=gt\.0/.test(lastTaskQuery) && /campaigns\.status=eq\.active/.test(lastTaskQuery) && /campaigns!inner/.test(lastTaskQuery) && /limit=5/.test(lastTaskQuery), lastTaskQuery);
check('lists reward and slots', /₦300 · 42 of 50 spots left/.test(tmsg?.body.text) && /₦150 · Only 1 left/.test(tmsg?.body.text), tmsg?.body.text);
check('escapes HTML in titles', /Install Kobo &lt;Notes&gt;/.test(tmsg?.body.text));
const open1 = allButtons(tmsg?.body).find((b: any) => b.text.startsWith('Open 1'));
check('Open button deep-links to task', open1?.url === 'https://www.taskpulse.website/?task=cmp_a&utm_source=telegram', open1);

reset(); taskRows = [];
await post(privMsg('Latest tasks'));
check('empty state uses mascot-thinking', calls[0]?.method === 'sendPhoto' && /mascot-thinking\.png$/.test(calls[0].body.photo) && /No open tasks right now/.test(calls[0].body.caption), calls[0]);

reset(); taskStatus = 500;
await post(privMsg('/tasks'));
check('DB error -> honest error message', /couldn't load tasks/.test(calls[0]?.body.text || ''), calls[0]);

// --- callbacks
reset(); taskRows = [{ id: 'cmp_a', title: 'T', company: '', reward: 100, spots_left: 3 }];
r = await post({ update_id: uid++, callback_query: { id: 'cb1', from: { id: 1001 }, data: 'tasks', message: { message_id: 9, chat: { id: 1001, type: 'private' } } } });
check('callback "tasks" answered + lists tasks', calls[0]?.method === 'answerCallbackQuery' && calls.some(c => c.method === 'sendMessage') && r.body.result === 'tasks', calls.map(c => c.method));
reset();
await post({ update_id: uid++, callback_query: { id: 'cb2', from: { id: 1001 }, data: 'how', message: { message_id: 9, chat: { id: 1001, type: 'private' } } } });
check('callback "how" sends explainer', /How TaskPulse works/.test(calls[1]?.body.text || ''));

// --- other commands
for (const [cmd, re] of [['/help', /what I can do/i], ['/business', /real people/], ['/invite', /₦200/]] as const) {
  reset();
  await post(privMsg(cmd));
  check(`${cmd} reply`, re.test(calls[0]?.body.text || ''), calls[0]?.body.text);
}
reset();
await post(privMsg('/invite'));
check('/invite says 3 approved tasks + Profile', /gets 3 tasks approved by businesses/.test(calls[0].body.text) && /Profile/.test(calls[0].body.text));
reset();
await post(privMsg('hello there'));
check('free text -> gentle fallback', /\/tasks/.test(calls[0]?.body.text || ''));

// --- groups
reset();
r = await post(groupMsg('/tasks'));
check('group /tasks ignored', r.body.result === 'ignored:group' && calls.length === 0, calls);
r = await post(groupMsg('hello'));
check('group chatter ignored', r.body.result === 'ignored:group' && calls.length === 0);
r = await post(groupMsg('/start@Taskpulse101bot'));
check('group /start@bot answered', r.body.result === 'start' && calls[0]?.method === 'sendPhoto');
reset();
r = await post(groupMsg('/start@SomeOtherBot'));
check('group /start for other bot ignored', calls.length === 0, r.body);

// --- rate limit
reset();
const results: string[] = [];
for (let i = 0; i < 10; i++) results.push((await post(privMsg('/help', 2002))).body.result);
check('rate limit after 8 messages / 30s', results.filter(x => x === 'rate-limited').length === 2, results);

// --- robustness
reset();
r = await post({ nope: true });
check('malformed update -> 200 ignored', r.code === 200 && /ignored/.test(r.body.result));
r = await post({ update_id: uid++, edited_message: { text: '/start' } });
check('unsupported update type -> 200 ignored', r.code === 200 && calls.length === 0);

console.log(failed ? `\n${failed} FAILED` : '\nall telegram checks passed');
process.exit(failed ? 1 : 0);

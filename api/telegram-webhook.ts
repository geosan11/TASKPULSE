import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';

// =========================================================================
// TaskPulse Telegram bot (@Taskpulse101bot), v1. Info-only: no account
// linking and no money actions. Telegram calls this endpoint with every
// update; we verify X-Telegram-Bot-Api-Secret-Token, then reply through the
// Bot API using plain fetch. Self-contained (Vercel functions, no imports
// from other api/ files).
// =========================================================================

export const SITE = 'https://www.taskpulse.website';
const MASCOT_HAPPY = `${SITE}/brand/mascot-happy.png`;
const MASCOT_THINKING = `${SITE}/brand/mascot-thinking.png`;
const BOT_USERNAME = (process.env.TELEGRAM_BOT_USERNAME || 'Taskpulse101bot').toLowerCase();

// ------------------------------------------------------------------ types
interface TgUser { id: number; is_bot?: boolean; first_name?: string; username?: string }
interface TgChat { id: number; type: 'private' | 'group' | 'supergroup' | 'channel' }
interface TgMessage { message_id: number; from?: TgUser; chat: TgChat; text?: string }
interface TgCallbackQuery { id: string; from: TgUser; message?: TgMessage; data?: string }
export interface TgUpdate { update_id: number; message?: TgMessage; callback_query?: TgCallbackQuery }
type Button = { text: string; url?: string; callback_data?: string };
type Markup = { inline_keyboard: Button[][] };

// ------------------------------------------------------------------ Bot API
async function tg(method: string, body: Record<string, unknown>): Promise<any> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!data?.ok) console.warn(`[telegram] ${method} failed: ${res.status} ${data?.description || ''}`);
  return data;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function naira(n: number): string {
  return `₦${Math.round(n).toLocaleString('en-NG')}`;
}

/** Web-app link with Telegram attribution (and referral code when given). */
export function siteUrl(params: Record<string, string | undefined> = {}): string {
  const u = new URL(SITE + '/');
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  u.searchParams.set('utm_source', 'telegram');
  return u.toString();
}

// Referral codes look like TP-ADAEZE / TPA1B2C3. Telegram deep-link payloads
// allow [A-Za-z0-9_-] up to 64 chars.
export function parseRefPayload(payload: string | undefined): string | undefined {
  if (!payload) return undefined;
  const m = payload.match(/^ref_([A-Za-z0-9-]{3,40})$/);
  return m ? m[1].toUpperCase() : undefined;
}

// ------------------------------------------------------------------ rate limit
// Best-effort, per warm instance: max 8 messages per chat per 30 s. Enough to
// stop button mashing / loops without any storage.
const RATE_WINDOW_MS = 30_000;
const RATE_MAX = 8;
const hits = new Map<number, number[]>();
export function rateLimited(chatId: number, now = Date.now()): boolean {
  const arr = (hits.get(chatId) || []).filter(t => now - t < RATE_WINDOW_MS);
  arr.push(now);
  hits.set(chatId, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > RATE_MAX;
}
export function _resetRateLimit() { hits.clear(); }

// ------------------------------------------------------------------ data
export interface OpenTask { id: string; title: string; company: string; reward: number; spotsLeft: number }

/** Open, funded tasks: active task, slots left, linked to an ACTIVE (paid) campaign. */
export async function fetchOpenTasks(limit = 5): Promise<OpenTask[] | null> {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.warn('[telegram] Supabase not configured; cannot list tasks');
    return null;
  }
  const q = new URLSearchParams({
    select: 'id,title,company,reward,spots_left,campaigns!inner(status)',
    is_active: 'eq.true',
    spots_left: 'gt.0',
    'campaigns.status': 'eq.active',
    order: 'created_at.desc',
    limit: String(limit),
  });
  try {
    const res = await fetch(`${url}/rest/v1/tasks?${q.toString()}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      console.warn('[telegram] task query failed', res.status);
      return null;
    }
    const rows = (await res.json()) as any[];
    return rows.map(r => ({
      id: String(r.id),
      title: String(r.title || 'Task'),
      company: String(r.company || ''),
      reward: Number(r.reward || 0),
      spotsLeft: Number(r.spots_left || 0),
    }));
  } catch (e: any) {
    console.warn('[telegram] task query error', e?.message);
    return null;
  }
}

// ------------------------------------------------------------------ replies
const HOW_IT_WORKS =
  '<b>How TaskPulse works</b>\n\n' +
  '1️⃣ <b>Sign up free.</b> No deposit, no fees, ever.\n' +
  '2️⃣ <b>Pick a task</b> posted by a real business: test an app, answer a survey, leave a review.\n' +
  '3️⃣ <b>Send proof.</b> When the business approves it, the reward lands in your wallet and you withdraw to your Nigerian bank account.\n\n' +
  'Businesses pay for the tasks, so you never pay anything to join.';

function startMarkup(ref?: string): Markup {
  return {
    inline_keyboard: [
      [{ text: '🚀 Start earning', url: siteUrl({ ref }) }],
      [{ text: '📋 Latest tasks', callback_data: 'tasks' }, { text: '❓ How it works', callback_data: 'how' }],
      [{ text: '🏢 Post tasks (for businesses)', url: siteUrl({ for: 'business' }) }],
    ],
  };
}

async function sendStart(chatId: number, firstName: string | undefined, ref?: string) {
  const hi = firstName ? `Hi ${escapeHtml(firstName.slice(0, 40))}! ` : 'Hi! ';
  const caption =
    `${hi}I'm Pulse ⚡ from <b>TaskPulse</b>.\n\n` +
    '<b>Get paid for real tasks. No deposit, ever.</b>\n\n' +
    '1. Sign up free on the website\n' +
    '2. Do short tasks from real businesses\n' +
    '3. Get paid to your bank account\n' +
    (ref ? `\n🎁 Your friend's referral code <b>${escapeHtml(ref)}</b> is applied when you sign up with the button below.\n` : '');
  const r = await tg('sendPhoto', { chat_id: chatId, photo: MASCOT_HAPPY, caption, parse_mode: 'HTML', reply_markup: startMarkup(ref) });
  if (!r?.ok) {
    // Image fetch can fail (e.g. site down); never leave the user without a reply.
    await tg('sendMessage', { chat_id: chatId, text: caption, parse_mode: 'HTML', reply_markup: startMarkup(ref), disable_web_page_preview: true });
  }
}

async function sendTasks(chatId: number) {
  const tasks = await fetchOpenTasks(5);
  if (tasks === null) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: "I couldn't load tasks right now. Please try again in a minute, or browse them on the website.",
      reply_markup: { inline_keyboard: [[{ text: 'Open TaskPulse', url: siteUrl() }]] },
    });
    return;
  }
  if (tasks.length === 0) {
    const caption =
      '<b>No open tasks right now.</b>\n\n' +
      "New tasks appear when businesses fund them. That's usually a few times a week. Sign up now so you're ready when the next one goes live.";
    const markup: Markup = { inline_keyboard: [[{ text: '🚀 Sign up free', url: siteUrl() }], [{ text: '🏢 Post a task', url: siteUrl({ for: 'business' }) }]] };
    const r = await tg('sendPhoto', { chat_id: chatId, photo: MASCOT_THINKING, caption, parse_mode: 'HTML', reply_markup: markup });
    if (!r?.ok) await tg('sendMessage', { chat_id: chatId, text: caption, parse_mode: 'HTML', reply_markup: markup });
    return;
  }
  const lines = tasks.map(
    (t, i) =>
      `${i + 1}. <b>${escapeHtml(t.title.slice(0, 90))}</b>\n` +
      `   ${naira(t.reward)} · ${t.spotsLeft} ${t.spotsLeft === 1 ? 'slot' : 'slots'} left${t.company ? ` · ${escapeHtml(t.company.slice(0, 40))}` : ''}`
  );
  const keyboard: Button[][] = tasks.map((t, i) => [{ text: `Open ${i + 1} · ${naira(t.reward)}`, url: siteUrl({ task: t.id }) }]);
  keyboard.push([{ text: 'See all tasks', url: siteUrl({ tab: 'tasks' }) }]);
  await tg('sendMessage', {
    chat_id: chatId,
    text: `<b>Latest open tasks</b>\n\n${lines.join('\n\n')}\n\nSign in on the website to take a task.`,
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard },
    disable_web_page_preview: true,
  });
}

async function sendHow(chatId: number) {
  await tg('sendMessage', { chat_id: chatId, text: HOW_IT_WORKS, parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🚀 Start earning', url: siteUrl() }]] } });
}

async function sendHelp(chatId: number) {
  await tg('sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    text:
      "<b>Here's what I can do</b>\n\n" +
      '/tasks: latest open tasks\n' +
      '/business: post tasks for your business\n' +
      '/invite: earn by inviting friends\n' +
      '/start: welcome and how it works\n\n' +
      'Your account, wallet and withdrawals live on the website: ' + SITE.replace('https://', '') + '\n' +
      "I'll never ask for your password, PIN or bank details.",
    disable_web_page_preview: true,
  });
}

async function sendBusiness(chatId: number) {
  await tg('sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    text:
      '<b>Get real people to do your tasks</b>\n\n' +
      'App installs and tests, surveys, honest reviews, social actions, store checks.\n\n' +
      '• You set the reward and the number of people\n' +
      '• You pay once with Paystack; the task goes live straight away\n' +
      '• You approve each proof, and only approved work is paid from your budget\n' +
      '• Unused budget comes back if you end the campaign early',
    reply_markup: { inline_keyboard: [[{ text: '🏢 Post your first task', url: siteUrl({ for: 'business' }) }]] },
  });
}

async function sendInvite(chatId: number) {
  await tg('sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    text:
      '<b>Invite friends, get ₦200 per friend</b>\n\n' +
      'When a friend joins with your link and gets 3 tasks approved by businesses, you get ₦200 in your wallet.\n\n' +
      'Get your personal link from <b>Profile → Invite friends</b> on the website, then share it anywhere.',
    reply_markup: { inline_keyboard: [[{ text: 'Get my invite link', url: siteUrl({ tab: 'profile' }) }]] },
  });
}

// ------------------------------------------------------------------ routing
/** Parse "/cmd@BotName payload" -> { cmd, payload } (cmd lowercased, no slash). */
export function parseCommand(text: string | undefined): { cmd: string; payload?: string; forOtherBot: boolean } | null {
  if (!text || !text.startsWith('/')) return null;
  const [head, ...rest] = text.trim().split(/\s+/);
  const [cmdRaw, at] = head.slice(1).split('@');
  return { cmd: cmdRaw.toLowerCase(), payload: rest[0], forOtherBot: Boolean(at && at.toLowerCase() !== BOT_USERNAME) };
}

export async function handleUpdate(update: TgUpdate): Promise<string> {
  // Inline buttons
  if (update.callback_query) {
    const cq = update.callback_query;
    const chat = cq.message?.chat;
    await tg('answerCallbackQuery', { callback_query_id: cq.id });
    if (!chat || chat.type !== 'private') return 'ignored:group-callback';
    if (rateLimited(chat.id)) return 'rate-limited';
    if (cq.data === 'tasks') { await sendTasks(chat.id); return 'tasks'; }
    if (cq.data === 'how') { await sendHow(chat.id); return 'how'; }
    return 'ignored:unknown-callback';
  }

  const msg = update.message;
  if (!msg || !msg.chat || msg.from?.is_bot) return 'ignored:no-message';
  const isPrivate = msg.chat.type === 'private';
  const parsed = parseCommand(msg.text);

  // Groups/channels: only /start (addressed to us); everything else is ignored.
  if (!isPrivate) {
    if (!parsed || parsed.forOtherBot || parsed.cmd !== 'start') return 'ignored:group';
  }
  if (parsed?.forOtherBot) return 'ignored:other-bot';
  if (rateLimited(msg.chat.id)) return 'rate-limited';

  const cmd = parsed?.cmd;
  switch (cmd) {
    case 'start':
      await sendStart(msg.chat.id, msg.from?.first_name, parseRefPayload(parsed?.payload));
      return 'start';
    case 'tasks':
      await sendTasks(msg.chat.id);
      return 'tasks';
    case 'help':
      await sendHelp(msg.chat.id);
      return 'help';
    case 'business':
      await sendBusiness(msg.chat.id);
      return 'business';
    case 'invite':
      await sendInvite(msg.chat.id);
      return 'invite';
    case 'how':
      await sendHow(msg.chat.id);
      return 'how';
    default:
      if (/^(latest )?tasks?$/i.test((msg.text || '').trim())) {
        await sendTasks(msg.chat.id);
        return 'tasks';
      }
      await tg('sendMessage', {
        chat_id: msg.chat.id,
        text: "I'm a simple bot for now 🙂 Try /tasks to see open tasks, or /help for everything I can do.",
      });
      return 'fallback';
  }
}

function secretMatches(header: string | string[] | undefined, expected: string): boolean {
  const got = Array.isArray(header) ? header[0] : header;
  if (!got) return false;
  const a = Buffer.from(got, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  // TELEGRAM_WEBHOOK_SOCKET is accepted as a fallback because production was
  // configured under that (misspelled) name; prefer TELEGRAM_WEBHOOK_SECRET.
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET || process.env.TELEGRAM_WEBHOOK_SOCKET;
  if (!expected) {
    console.error('[telegram] TELEGRAM_WEBHOOK_SECRET is not configured');
    return res.status(500).json({ ok: false });
  }
  if (!secretMatches(req.headers['x-telegram-bot-api-secret-token'], expected)) {
    return res.status(401).json({ ok: false });
  }

  let update: TgUpdate | null = null;
  try {
    update = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body as TgUpdate);
  } catch {
    update = null;
  }
  if (!update || typeof update.update_id !== 'number') return res.status(200).json({ ok: true, result: 'ignored:bad-update' });

  try {
    const result = await handleUpdate(update);
    return res.status(200).json({ ok: true, result });
  } catch (e: any) {
    // Always 200 after auth: a non-200 makes Telegram redeliver the same
    // update over and over.
    console.error('[telegram] handler error', e?.message);
    return res.status(200).json({ ok: true, result: 'error' });
  }
}

/**
 * scripts/telegram-setup.ts: one-time setup for @Taskpulse101bot.
 *
 * Run AFTER api/telegram-webhook.ts is deployed and TELEGRAM_BOT_TOKEN +
 * TELEGRAM_WEBHOOK_SECRET are set in Vercel (Production):
 *
 *   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... npx tsx scripts/telegram-setup.ts
 *
 * Options
 *   --secret-file=<path>   read the webhook secret from a file instead of env
 *   --skip-webhook         only set commands/descriptions
 *   --drop-pending         discard updates queued before the webhook existed
 *   --info                 print getMe + getWebhookInfo and exit (no changes)
 *
 * Never prints the token or the secret.
 */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => args.find(a => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const secretFile = opt('secret-file');
const SECRET = (secretFile ? readFileSync(secretFile, 'utf8') : process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
const WEBHOOK_URL = process.env.TELEGRAM_WEBHOOK_URL || 'https://www.taskpulse.website/api/telegram-webhook';

if (!TOKEN) { console.error('TELEGRAM_BOT_TOKEN is not set.'); process.exit(2); }

async function call(method: string, body?: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(`${method} failed: ${data.description || res.status}`);
  return data.result;
}

const COMMANDS = [
  { command: 'start', description: 'Welcome and how TaskPulse works' },
  { command: 'tasks', description: 'Latest open tasks' },
  { command: 'business', description: 'Post tasks for your business' },
  { command: 'invite', description: 'Invite friends, you both get ₦200' },
  { command: 'help', description: 'What this bot can do' },
];
const DESCRIPTION =
  'TaskPulse: get paid for real tasks. No deposit, ever.\n\n' +
  'Do short tasks from real Nigerian businesses (app tests, surveys, reviews) and get paid to your bank account. ' +
  'Tap Start to see how it works and the latest open tasks.';
const SHORT_DESCRIPTION = 'Get paid for real tasks. No deposit, ever. Free to join.';

async function main() {
  const me = await call('getMe');
  console.log(`Bot: @${me.username} (id ${me.id})`);

  if (flag('info')) {
    const info = await call('getWebhookInfo');
    console.log(`Webhook: ${info.url || '(none)'}  pending=${info.pending_update_count}  last_error=${info.last_error_message || '-'}`);
    return;
  }

  await call('setMyCommands', { commands: COMMANDS, scope: { type: 'default' } });
  console.log(`setMyCommands: ${COMMANDS.map(c => '/' + c.command).join(' ')}`);
  await call('setMyDescription', { description: DESCRIPTION });
  await call('setMyShortDescription', { short_description: SHORT_DESCRIPTION });
  console.log('setMyDescription + setMyShortDescription: ok');

  if (flag('skip-webhook')) return;
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(SECRET)) {
    console.error('TELEGRAM_WEBHOOK_SECRET missing or invalid (16-256 chars of A-Z a-z 0-9 _ -).');
    process.exit(2);
  }
  await call('setWebhook', {
    url: WEBHOOK_URL,
    secret_token: SECRET,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: flag('drop-pending'),
    max_connections: 20,
  });
  const info = await call('getWebhookInfo');
  console.log(`setWebhook: ${info.url}  allowed_updates=${(info.allowed_updates || []).join(',')}  pending=${info.pending_update_count}`);
}

main().catch(e => { console.error(e.message || e); process.exit(1); });

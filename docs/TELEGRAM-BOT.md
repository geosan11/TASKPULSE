# TaskPulse Telegram bot (@Taskpulse101bot) — v1

Webhook: `api/telegram-webhook.ts` (Vercel serverless, plain `fetch`, no deps).

## What it does
- `/start` (optional deep-link payload `ref_CODE`) — mascot photo, pitch, 3 steps, buttons:
  Start earning (`?ref=CODE&utm_source=telegram`), Latest tasks, How it works, Post tasks.
- `/tasks` / "Latest tasks" — up to 5 open, funded tasks (active, spots left, campaign `active`),
  each with an Open button (`?task=<id>`). Honest empty state.
- `/help`, `/business`, `/invite` (₦200 per friend once they have 3 tasks approved by businesses; link in Profile).
- No account linking, no money actions. Group chats: only `/start` is answered.
  Best-effort in-memory rate limit (8 updates / 30 s per chat).
- Every request must carry `X-Telegram-Bot-Api-Secret-Token` == `TELEGRAM_WEBHOOK_SECRET` (else 401).

## Vercel env (Production)
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET` (`[A-Za-z0-9_-]`, 16–256 chars)
- `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_URL` (or `VITE_SUPABASE_URL`) — read-only task listing
- optional `TELEGRAM_BOT_USERNAME` (default `Taskpulse101bot`)

## Deploy, then setup
1. Set the env vars above in Vercel → Production; merge the PR; wait for the deploy.
2. `TELEGRAM_BOT_TOKEN=... npm run telegram:setup -- --secret-file=/path/to/secret [--drop-pending]`
   (sets commands, descriptions, and the webhook to `https://www.taskpulse.website/api/telegram-webhook`
   with `allowed_updates: [message, callback_query]`). The secret must match Vercel's value.
3. `npm run telegram:setup -- --info` → check `url`, `pending_update_count`, `last_error_message`.
4. Send `/start` to the bot.

Tests: `npm run test:telegram` (mocked Bot API + PostgREST).

<p align="center">
  <img src="public/brand/logo-lockup-light.png" alt="TaskPulse logo" width="480" />
</p>

# TaskPulse

**Get paid for real tasks. No deposit, ever.**

TaskPulse is a free-to-join micro-task marketplace for Nigeria. Businesses post
and fund small tasks (app tests, surveys, reviews, social actions, field
audits). Workers complete them, submit proof, and are paid to their bank
account when the business approves the work.

Live site: https://taskpulse.website

---

## How it works

### For workers

1. **Sign up for free.** There is no activation fee and no deposit.
2. **Pick a task** from the Tasks tab. Every task you see has already been paid for by the business that posted it.
3. **Submit proof**: a screenshot, a link, or a text answer, depending on the task.
4. **Get paid when it's approved.** The reward moves from the campaign's escrow into your withdrawable balance in one atomic database transaction.
5. **Withdraw** to your verified Nigerian bank account through Paystack.

Withdrawal rules (anti-fraud):

| Rule | Default |
| --- | --- |
| Minimum withdrawal | ₦1,000 (whole Naira) |
| Daily withdrawal limit | ₦20,000, at most 2 withdrawals per day (Africa/Lagos day) |
| First-withdrawal cooldown | 48 hours after your first approved task |
| Bank accounts | One verified NUBAN account per user; an account cannot be linked to two users |

### Referral bonus

Invite a friend with your link. When their **first 3 tasks are approved**, you
get **₦200** and they get **₦200**. Bonuses are capped per referrer
(50 by default). Nobody pays to join, so referrals never involve deposits.

### Daily check-in

Checking in daily builds your streak badge. It does not pay cash.

### For businesses

1. Sign up as a business (or switch from Profile → "Open business account").
2. Create a campaign: title, instructions, category, reward per completion, number of slots, proof type (screenshot / text / link) and an optional link.
3. Pay through Paystack. **Total = reward × slots × 1.25** (reward budget plus a 25% platform fee), rounded up to the nearest Naira.
4. Your task goes live as soon as the payment is verified.
5. Review submissions in the Business tab. **Approve** pays the worker from your campaign escrow. **Reject** (with a note) frees the slot for someone else.
6. Pause, resume or cancel at any time. Cancelling marks the unused budget as a refund due to you (refunds are processed by TaskPulse support).

Admins (`profiles.role = 'admin'`) can review any submission.

---

## Configuration

Every money rule lives in **one row** of `public.marketplace_settings` and is
enforced inside Postgres functions, so the browser can't bypass it:

| Column | Default |
| --- | --- |
| `min_withdrawal` | 1000 |
| `daily_withdrawal_limit` | 20000 |
| `max_withdrawals_per_day` | 2 |
| `payout_cooldown_hours` | 48 |
| `referral_bonus_referrer` / `referral_bonus_referee` | 200 / 200 |
| `referral_qualifying_tasks` | 3 |
| `referral_max_bonuses_per_referrer` | 50 |
| `platform_fee_rate` | 0.25 |
| `min_reward_per_task` / `max_reward_per_task` | 50 / 5000 |
| `min_campaign_slots` / `max_campaign_slots` | 5 / 10000 |

The frontend reads this row on start-up and falls back to
`src/config/marketplace.ts` (keep both in sync).

---

## Architecture

- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS v4 (`src/`).
  - `src/App.tsx`: shell, routing between tabs, session and Paystack callback handling.
  - `src/components/`: Landing, Auth, Home, Tasks, Wallet, History, Profile, Business.
  - `src/lib/supabaseClient.ts`, `src/lib/marketplace.ts`, `src/lib/api.ts`: data access.
- **Serverless API** (Vercel, `api/`):
  - `initialize-deposit.ts`: starts Paystack checkout for a **campaign** (`{ campaignId }`). The amount is computed by the database. Plain user deposits are rejected (HTTP 410).
  - `verify-transaction.ts`: verifies a Paystack reference and settles the campaign (or a legacy in-flight deposit).
  - `paystack-webhook.ts`: HMAC-verified `charge.success` / transfer events.
  - `resolve-account.ts`, `link-bank.ts`: NUBAN verification and the one-bank rule.
  - `disburse-transfer.ts`: withdrawals via Paystack transfers (rules enforced by `request_cashout()`).
- **Database**: Supabase Postgres with RLS. Money functions are `SECURITY DEFINER`; settlement, cashout and bank-saving RPCs are callable only by the service role (via `api/`), and clients cannot write balances, completions or bank rows directly.
  - Key tables: `profiles`, `tasks`, `task_completions`, `transactions`, `bank_accounts`, `referrals`, `campaigns`, `campaign_payments`, `campaign_ledger`, `marketplace_settings`.

### Migrations

Run in order: `supabase/schema.sql`, then `002`–`008` (or use `supabase/migrations/` with `supabase db push`, but don't do both).
`008_free_marketplace.sql` is the free-marketplace pivot. It runs in one transaction and can safely be run again.

---

## Local development

```bash
npm install
cp .env.example .env.local   # fill in Supabase + Paystack TEST keys
npm run dev                   # http://localhost:3000
npm run lint                  # tsc --noEmit
npm run build
```

Environment variables:

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Browser + API | Supabase project |
| `SUPABASE_SERVICE_ROLE_KEY` | API only (required) | Settlement, withdrawals, bank linking |
| `PAYSTACK_SECRET_KEY` | API only | Checkout, verification, transfers, webhook signature |
| `APP_URL` | API | Paystack callback base URL (e.g. `https://taskpulse.website`) |

Use Paystack **test** keys locally. Never put the service role key or Paystack secret key in a `VITE_` variable.

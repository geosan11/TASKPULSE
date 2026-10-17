---
name: taskpulse-debugging
description: Comprehensive FinTech debugging runbook for TaskPulse covering Paystack payment gateways, Supabase database synchronization & relationships, RPC concurrency, campaign escrow, withdrawal anti-fraud rules, and UI/UX state workflows. Use whenever debugging, fixing, or extending payments, database models, RPCs, eligibility logic, or interface flows in TaskPulse.
---

# TaskPulse Comprehensive FinTech Debugging Skill

This skill is the definitive engineering runbook for debugging and developing **TaskPulse** — a free-to-join Nigerian micro-task marketplace (businesses fund tasks, workers earn from approved completions) built on React + Vite, Tailwind CSS, Supabase (PostgreSQL + Auth + Storage), and Paystack.

---

## 1. System Architecture & Critical Invariants

TaskPulse enforces these non-negotiable invariants (all enforced in Postgres, see `supabase/008_free_marketplace.sql`):

1. **Ledger Integrity**: Every balance change (task payout, referral bonus, withdrawal, campaign funding receipt) has a row in `public.transactions` (and, for campaigns, `public.campaign_ledger`) with a unique idempotent reference.
2. **Atomic Row-Level Concurrency**: Balance mutators run in a single transaction with `SELECT ... FOR UPDATE` on `profiles` / `campaigns`.
3. **Funded-Before-Paid**: Worker rewards are paid only from `campaigns.escrow_balance`, inside `_review_submission_core()`. No user deposits exist; joining is free.
4. **Withdrawal Rules** (values in `public.marketplace_settings`):
   - Minimum withdrawal ₦1,000, whole Naira only.
   - Daily limit ₦20,000 and at most 2 withdrawals per Lagos calendar day.
   - Cooldown: `profiles.payout_eligible_from` (48h after first approved task; legacy activated members kept their old 48h-from-activation date).
   - One active verified NUBAN bank account per user, and an account number cannot be linked to two users.
5. **Referral Bonus**: ₦200 to referrer + ₦200 to referee, paid once when the referee's 3rd task is approved, capped per referrer.
6. **No Demo Data**: Production must never display mock tasks or mock ledger rows.

---

## 2. Payment Gateway & Banking Rails Debugging

### Key Architecture Components:
- **Client API Adapter**: [src/lib/api.ts](file:///c:/Users/Hp/Documents/GitHub/TASKPULSE/src/lib/api.ts)
- **Backend API Server**: [api/index.ts](file:///c:/Users/Hp/Documents/GitHub/TASKPULSE/api/index.ts)
- **Supported Banks**: [PAYSTACK_BANKS](file:///c:/Users/Hp/Documents/GitHub/TASKPULSE/src/App.tsx#L272) (Moniepoint MFB, OPay, Kuda, Access, GTB, Zenith, UBA, First Bank).

### Common Payment Failure Modes & Diagnostic Steps:

#### 1. Business Paid But Campaign Still "Awaiting Payment"
- **Symptom**: Business completes Paystack checkout, returns with `?verify_payment=camp_...` (or `reference`/`trxref`), but the campaign stays `pending_payment`.
- **Diagnostic Procedure**:
  1. `SELECT * FROM public.campaign_payments WHERE reference = 'camp_...'` and check `status` (`pending`, `settled`, `underpaid`, `duplicate_needs_refund`).
  2. Call `/api/verify-transaction` with the reference (`verifyPayment(ref)`), or check the webhook (`charge.success`) logs.
  3. Paystack `data.status` must be `'success'` and the paid amount ≥ `campaign_payments.amount`.
  4. Once settled: `campaigns.status = 'active'`, `escrow_balance = reward_budget`, a `tasks` row `cmp_<uuid hex>` exists, and `campaign_ledger` has `funding` + `platform_fee` rows.
  5. `duplicate_needs_refund` / `refund_due` amounts are refunded manually in the Paystack dashboard.

#### 2. NUBAN Bank Account Resolution Fails or Times Out
- **Symptom**: User inputs 10-digit account number and selects bank, but account name displays "Unable to verify" or button remains disabled.
- **Diagnostic Procedure**:
  1. Verify bank code in `PAYSTACK_BANKS`: ensure 5-digit MFB codes (e.g. `50515` for Moniepoint, `999992` for OPay, `50211` for Kuda) are mapped correctly.
  2. Test Paystack direct resolve API: `https://api.paystack.co/bank/resolve?account_number={NUBAN}&bank_code={CODE}`.
  3. Ensure Bearer authentication header uses `PAYSTACK_SECRET_KEY`.
  4. Ensure client strips non-numeric characters before dispatching (`accountNumber.replace(/\D/g, '')`).

#### 3. Bank Cashout / Transfer Stuck or Rejected
- **Symptom**: User clicks withdraw, modal shows pending or fails with Paystack error.
- **Diagnostic Procedure**:
  1. Verify recipient code: Check `public.bank_accounts` for `paystack_recipient_code` (`RCP_...`). If missing or invalid, generate a new recipient code via `/transferrecipient`.
  2. Check rules: `withdrawable_balance >= amount`, `amount >= min_withdrawal`, `payout_eligible_from <= now()`, today's total/count within limits.
  3. Check idempotency key: Ensure `/api/disburse-transfer` transmits a unique `idempotencyKey` per attempt to avoid duplicate debits.
  4. Check Paystack balance: If Paystack integration account has insufficient funds in test or live balance, transfer returns `400` ("Insufficient balance in integration balance").

---

## 3. Database Synchronization & Concurrency Debugging

### Key Architecture Components:
- **Supabase Client**: [src/lib/supabaseClient.ts](file:///c:/Users/Hp/Documents/GitHub/TASKPULSE/src/lib/supabaseClient.ts)
- **Database Migrations**: [supabase/migrations/](file:///c:/Users/Hp/Documents/GitHub/TASKPULSE/supabase/migrations/)
- **Comprehensive Schema**: [supabase/schema.sql](file:///c:/Users/Hp/Documents/GitHub/TASKPULSE/supabase/schema.sql)

### Critical Synchronization Workflows:

#### 1. Daily Check-in Streak (`claim_daily_reward()`)
- **Badge only**: increments `streak_days`; it never credits money (the old ₦450 login bonus is removed).
- **Timezone Invariant**: `(NOW() AT TIME ZONE 'Africa/Lagos')::date`; raises `already_claimed` if already checked in today.

#### 2. Review & Payout (`review_submission()` → `_review_submission_core()`)
- Caller must own the campaign or be an admin; nobody can review their own submission.
- Approve: locks completion + campaign + worker, debits escrow, credits `withdrawable_balance`, writes `task_payout`, sets `payout_eligible_from` on first approval, and pays the referral bonus on the qualifying approval.
- Reject: frees the slot (`spots_left + 1`) and records `review_note`.

#### 3. Data Egress Optimization
- **Strict Invariant**: Never execute unpaginated `SELECT *` across high-volume tables.
- **Helpers**: Use [fetchTransactionsHistory](file:///c:/Users/Hp/Documents/GitHub/TASKPULSE/src/lib/supabaseClient.ts#L524), [fetchReferralsHistory](file:///c:/Users/Hp/Documents/GitHub/TASKPULSE/src/lib/supabaseClient.ts#L563), and [fetchTaskCompletionsHistory](file:///c:/Users/Hp/Documents/GitHub/TASKPULSE/src/lib/supabaseClient.ts#L549) with explicit column projections.

---

## 4. Relational Data Models & Foreign Key Integrity

### Entity Relationship Matrix:

| Entity | Primary Key | Foreign Key | References | Description |
| :--- | :--- | :--- | :--- | :--- |
| `auth.users` | `id` | - | Supabase Auth | User identity and credentials |
| `public.profiles` | `id` | `id` | `auth.users.id` ON DELETE CASCADE | Balances, role (worker/business/admin), KYC, streak, payout eligibility |
| `public.referrals` | `id` | `referrer_id` | `public.profiles.id` ON DELETE CASCADE | Referral attribution and `bonus_status` (pending/paid/referee_only/skipped_legacy) |
| `public.transactions` | `id` | `user_id` | `public.profiles.id` ON DELETE CASCADE | Double-entry ledger of all credits/debits |
| `public.bank_accounts` | `id` | `user_id` | `public.profiles.id` ON DELETE CASCADE | Verified NUBAN accounts + Paystack recipient codes |
| `public.tasks` | `id` | - | - | Catalog of active tasks (`is_active = TRUE`) |
| `public.task_completions`| `id` | `user_id`, `task_id` | `public.profiles.id`, `public.tasks.id` | User task proof submissions and audit status |
| `public.campaigns` | `id` | `business_id` | `public.profiles.id` | Business-funded campaigns with escrow balance |
| `public.campaign_payments` | `reference` | `campaign_id` | `public.campaigns.id` | Paystack funding attempts |
| `public.campaign_ledger` | `id` | `campaign_id` | `public.campaigns.id` | Funding / fee / payout / refund_due entries |
| `public.marketplace_settings` | `id = 1` | - | - | All money rule constants |
| `public.tiers` | `id` | - | - | Legacy, deactivated (`is_active = FALSE`), kept for history |

### Referential Debugging Checklist:
- **Orphan Profiles**: Trigger `on_auth_user_created` creates `public.profiles` upon signup. If a user signs up without a profile, check PostgreSQL triggers on `auth.users`.
- **Referral Attribution**: When signing up with `?ref=CODE`, `handle_new_user()` matches `referral_code` in `public.profiles` and creates a record in `public.referrals`.

---

## 5. UI/UX Workflow & Business Rule Validation

### Navigation & Page Hierarchy:
- **Bottom Navigation Tabs**: Home (balance, streak badge, referral card), Tasks (business-funded tasks + proof submission), Business (only for role business/admin: create & fund campaigns, review submissions), Wallet (withdrawal checklist, one bank, withdraw), History (ledger + receipts), Profile (name, KYC, open business account, terms).

### Critical UI Gotchas:
- **Never show deposit, tier, multiplier or staking UI.** Joining is free.
- **Home Cashout Button Navigation**: Tapping Cashout on the Home card **must** navigate directly to `setActiveTab('wallet')` for a unified, transparent user experience.
- **Authentication Hash Interception**: URL hash errors generated by Supabase Auth (e.g. `#error=access_denied&error_code=otp_expired`) must be immediately scrubbed from browser history with `window.history.replaceState` and mapped to user-friendly notifications.

---

## 6. Pre-Commit Verification Commands

Before deploying or submitting any code change:
```bash
# 1. TypeScript Strict Typecheck
npx tsc --noEmit

# 2. Production Vite Bundle Build
npm run build

# 3. Verify Clean Git Status
git status
```

For detailed sub-domain guides, see:
- [Payment Gateway Debugging](./references/payments-debugging.md)
- [Database Relationships & Concurrency](./references/database-relationships-sync.md)
- [UI & UX Interaction Guidelines](./references/ui-ux-guidelines.md)

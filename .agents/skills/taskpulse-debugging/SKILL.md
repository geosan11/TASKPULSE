---
name: taskpulse-debugging
description: Comprehensive FinTech debugging runbook for TaskPulse covering Paystack payment gateways, Supabase database synchronization & relationships, RPC concurrency, 48h/referral withdrawal gating rules, and UI/UX state workflows. Use whenever debugging, fixing, or extending payments, database models, RPCs, eligibility logic, or interface flows in TaskPulse.
---

# TaskPulse Comprehensive FinTech Debugging Skill

This skill is the definitive engineering runbook for debugging and developing **TaskPulse** — a Nigerian FinTech micro-task and automated payout platform built on React + Vite, Tailwind CSS, Supabase (PostgreSQL + Auth + Storage), and Paystack.

---

## 1. System Architecture & Critical Invariants

TaskPulse enforces four strict non-negotiable FinTech invariants:

1. **Double-Entry Ledger Integrity**: Every balance modification (Deposit, Withdrawal, Referral Credit, Streak Reward, Tier Upgrade) **must** be accompanied by an immutable record in `public.transactions` with a unique idempotent reference. No loose or floating balance increments.
2. **Atomic Row-Level Concurrency**: All balance mutators **must** execute inside PostgreSQL transactions using `SELECT ... FOR UPDATE` row locks on `public.profiles` to eliminate double-spend and race conditions.
3. **Tri-Rule Withdrawal Gating**:
   - **Rule A (Seasoning Lock)**: 48-hour (172,800s) cooling period from initial activation timestamp before first cashout.
   - **Rule B (Referral Volume or Tier Upgrade)**: Minimum 3 qualified direct referrals (each depositing ≥ ₦3,000, earning ₦1,000 commission each = ₦3,000 total) **OR** an explicit tier upgrade surpassing initial limit.
   - **Rule C (Liquidity Floor & Ceilings)**: Minimum single withdrawal of ₦3,000, bounded by current tier daily max cashout and lifetime cumulative cap.
4. **Data Isolation & Zero Demo Data**: Production states must never display mock, demo, or placeholder data (such as dummy TikTok tasks or mock ledger transactions).

---

## 2. Payment Gateway & Banking Rails Debugging

### Key Architecture Components:
- **Client API Adapter**: [src/lib/api.ts](file:///c:/Users/Hp/Documents/GitHub/TASKPULSE/src/lib/api.ts)
- **Backend API Server**: [api/index.ts](file:///c:/Users/Hp/Documents/GitHub/TASKPULSE/api/index.ts)
- **Supported Banks**: [PAYSTACK_BANKS](file:///c:/Users/Hp/Documents/GitHub/TASKPULSE/src/App.tsx#L272) (Moniepoint MFB, OPay, Kuda, Access, GTB, Zenith, UBA, First Bank).

### Common Payment Failure Modes & Diagnostic Steps:

#### 1. Paystack Deposit Initiated But Balance Not Credited
- **Symptom**: User completes Paystack transfer/card payment, returns to website with `?reference=...` or `?trxref=...`, but account remains unactivated and balance remains ₦0.
- **Diagnostic Procedure**:
  1. Inspect browser URL parameters: verify if `verify_deposit`, `reference`, or `trxref` is present.
  2. Verify backend endpoint `/api/verify-transaction`: call `verifyDeposit(ref)`.
  3. Check Paystack API response: `data.status` must strictly equal `'success'`.
  4. Check PostgreSQL idempotency: Query `SELECT * FROM public.transactions WHERE reference = 'ref_deposit_...'`. If already exists, ensure the transaction was settled.
  5. Check `public.profiles`: Verify `is_activated = TRUE`, `activation_timestamp IS NOT NULL`, and `withdrawable_balance` increased by exact deposit amount.

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
  2. Check balance vs floor: Ensure `withdrawable_balance >= amount` and `amount >= 3000`.
  3. Check idempotency key: Ensure `/api/disburse-transfer` transmits a unique `idempotencyKey` per attempt to avoid duplicate debits.
  4. Check Paystack balance: If Paystack integration account has insufficient funds in test or live balance, transfer returns `400` ("Insufficient balance in integration balance").

---

## 3. Database Synchronization & Concurrency Debugging

### Key Architecture Components:
- **Supabase Client**: [src/lib/supabaseClient.ts](file:///c:/Users/Hp/Documents/GitHub/TASKPULSE/src/lib/supabaseClient.ts)
- **Database Migrations**: [supabase/migrations/](file:///c:/Users/Hp/Documents/GitHub/TASKPULSE/supabase/migrations/)
- **Comprehensive Schema**: [supabase/schema.sql](file:///c:/Users/Hp/Documents/GitHub/TASKPULSE/supabase/schema.sql)

### Critical Synchronization Workflows:

#### 1. Daily Login Streak Claim (`claim_daily_reward()`)
- **Reward Value**: Strictly **₦450** per calendar day (updated from legacy ₦100).
- **Timezone Invariant**: Evaluated in Nigerian Standard Time: `(NOW() AT TIME ZONE 'Africa/Lagos')::date`.
- **Concurrency Guard**:
  ```sql
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF v_profile.streak_last_claimed_date = v_today THEN RAISE EXCEPTION 'already_claimed'; END IF;
  ```
- **Diagnostic Step**: If user cannot claim: Check `profiles.streak_last_claimed_date`. If it equals today's date in Lagos, the UI must display "Claimed Today ✓".

#### 2. Tier Upgrade Execution (`upgrade_tier_from_wallet()`)
- **Tiers Hierarchy**: Bronze (₦3k) -> Silver (₦10k) -> Gold (₦15k) -> Platinum (₦30k) -> Diamond (₦50k) -> Black Crown VIP (₦75k).
- **Rules**: Users cannot downgrade; upgrade price is debited directly from `withdrawable_balance`; immediately resets withdrawal ceiling and exempts referral lock (`has_upgraded_after_limit = TRUE`).

#### 3. Data Egress Optimization
- **Strict Invariant**: Never execute unpaginated `SELECT *` across high-volume tables.
- **Helpers**: Use [fetchTransactionsHistory](file:///c:/Users/Hp/Documents/GitHub/TASKPULSE/src/lib/supabaseClient.ts#L524), [fetchReferralsHistory](file:///c:/Users/Hp/Documents/GitHub/TASKPULSE/src/lib/supabaseClient.ts#L563), and [fetchTaskCompletionsHistory](file:///c:/Users/Hp/Documents/GitHub/TASKPULSE/src/lib/supabaseClient.ts#L549) with explicit column projections.

---

## 4. Relational Data Models & Foreign Key Integrity

### Entity Relationship Matrix:

| Entity | Primary Key | Foreign Key | References | Description |
| :--- | :--- | :--- | :--- | :--- |
| `auth.users` | `id` | - | Supabase Auth | User identity and credentials |
| `public.profiles` | `id` | `id` | `auth.users.id` ON DELETE CASCADE | Balances, KYC status, Tier ID, Streak, Activation |
| `public.referrals` | `id` | `referrer_id` | `public.profiles.id` ON DELETE CASCADE | Gating referrals; `deposited_amount >= 3000` sets `is_qualified = TRUE` |
| `public.transactions` | `id` | `user_id` | `public.profiles.id` ON DELETE CASCADE | Double-entry ledger of all credits/debits |
| `public.bank_accounts` | `id` | `user_id` | `public.profiles.id` ON DELETE CASCADE | Verified NUBAN accounts + Paystack recipient codes |
| `public.tasks` | `id` | - | - | Catalog of active tasks (`is_active = TRUE`) |
| `public.task_completions`| `id` | `user_id`, `task_id` | `public.profiles.id`, `public.tasks.id` | User task proof submissions and audit status |
| `public.tiers` | `id` | - | - | Tier stakes, withdrawal caps, and multipliers |

### Referential Debugging Checklist:
- **Orphan Profiles**: Trigger `on_auth_user_created` creates `public.profiles` upon signup. If a user signs up without a profile, check PostgreSQL triggers on `auth.users`.
- **Referral Attribution**: When signing up with `?ref=CODE`, `handle_new_user()` matches `referral_code` in `public.profiles` and creates a record in `public.referrals`.

---

## 5. UI/UX Workflow & Business Rule Validation

### Navigation & Page Hierarchy:
- **5 Bottom Navigation Tabs**:
  1. **Home (`Compass`)**: Hero balance, Quick action buttons (Fund, Cashout, Streak, Upgrade), Live tier status, Activity feed.
  2. **Tasks (`CheckSquare`)**: Displays active production task (`t-ref-growth`) + Live rolling 24-hour countdown timer for the next daily task drop.
  3. **Withdraw (`Wallet`)**: Dedicated dashboard showing real-time balance, prominent "Link Bank Account (NUBAN)" button, qualification checklist, and instant withdrawal trigger.
  4. **History (`History`)**: Filterable ledger transactions (All, Finance, Tasks, Referrals, Rewards) with instant proof receipts.
  5. **Profile (`User`)**: Identity status, KYC verification, profile details, and security controls.

### Critical UI Gating Gotchas:
- **Referral Task vs. Deposit Redirect**: Clicking the Referral task on the Tasks tab **must strictly** open the referral share modal (`isReferralLockModalOpen = true`). It must **never** redirect unactivated users to the ₦3,000 Paystack deposit modal.
- **Home Cashout Button Navigation**: Tapping Cashout on the Home card **must** navigate directly to `setActiveTab('withdraw')` for a unified, transparent user experience.
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

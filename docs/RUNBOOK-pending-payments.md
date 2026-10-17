# Runbook: payments stuck at "pending"

## What happened (Oct 2026)

Activation deposits stayed at **Pending · "Awaiting Paystack confirmation"**
even though Paystack charged the customer (e.g. a ₦3,147.21 receipt for a
₦3,000 deposit).

Root cause, on `main`:

1. `settle_deposit()` (latest live definition: `supabase/007_referral_commission_1k.sql`
   L40-42, also `003_resilience.sql` L74-76) runs
   `UPDATE public.transactions SET status = 'settled', updated_at = NOW()`.
   `transactions` has **no `updated_at` column** (`supabase/schema.sql` L49-69),
   so every call raises `column "updated_at" ... does not exist` and the whole
   settlement rolls back. Both callers hit it: `api/verify-transaction.ts`
   (L151-158, returns 400 to the user) and `api/paystack-webhook.ts`
   (L112-127, returns 500, so Paystack retries and fails again each time).
2. Even with (1) fixed, `007` L33 requires `paid = amount` exactly. With
   Paystack fees passed to the customer, Paystack reports 314721 kobo, which
   comes to ₦3,147, so the check `3147 <> 3000` raises `amount_mismatch`.
3. Every "try again" created a **new** `dep_*` row (`initialize-deposit.ts`
   L146-153), so several pending rows can belong to one payment, or to
   checkouts that were never paid.

Reproduced locally: `supabase/tests/20_settle_deposit_pre008_bug.sql`.

Fixed by migration **008** (adds `transactions.updated_at`, and settles when
`paid >= due`, crediting the amount due once). Settlement RPCs are
service-role only, and the API now refuses to run without a real
service-role key instead of silently falling back to the anon key.

## Resolving the live pending rows

1. Make sure Vercel has `SUPABASE_SERVICE_ROLE_KEY` (the **service_role**
   secret, not the anon key) and `PAYSTACK_SECRET_KEY` (live) set for
   Production. `GET /api/check-db` reports `supabase_service_role_key_valid`.
2. Apply `supabase/008_free_marketplace.sql` in the Supabase SQL editor.
3. On your own machine, with production env vars exported in your shell:

   ```bash
   SUPABASE_URL=https://<project>.supabase.co \
   SUPABASE_SERVICE_ROLE_KEY=... PAYSTACK_SECRET_KEY=sk_live_... \
   npm run reconcile                 # dry run: prints what it WOULD do
   npm run reconcile -- --apply      # does exactly what the dry run printed
   ```

   - Paid at Paystack: credits the amount due **once** (re-running is a no-op).
   - Abandoned or not found at Paystack (older than 2 h): marked `declined`, no balance change.
   - Underpaid: left alone and flagged for a manual refund.
   - Cashouts: settled or refunded from Paystack's transfer record.

   Use `--ref=dep_...` to handle a single reference.

   Without the script: users can open the pending entry in **Wallet → History**
   and tap **Check payment with Paystack**. That calls `/api/verify-transaction`,
   which only credits a payment Paystack reports as successful.

4. Check that the Paystack dashboard webhook URL is
   `https://taskpulse.website/api/paystack-webhook` (live mode).

## Local tests (never against production)

```bash
npm run test:sql      # local Postgres: reproduces the bug, then verifies the 008 fix
npm run test:api      # webhook/verify handlers against local PostgREST + mock Paystack
```

-- =========================================================================
-- TASKPULSE 008 - FREE-TO-JOIN MICRO-TASK MARKETPLACE
-- =========================================================================
-- Run ONCE in the Supabase SQL Editor (or via `supabase db push`, which uses the
-- identical copy in supabase/migrations/20261017000008_free_marketplace.sql).
-- Do not run both. It is written to be safe to re-run, and it runs inside a
-- single transaction: if any statement fails, nothing is applied.
--
-- WHAT CHANGES
--   * Sign-up is free. No activation deposit, no stake tiers, no return
--     multipliers or cumulative withdrawal caps.
--   * Workers earn ONLY from approved task completions (task_payout), plus a
--     small capped referral bonus once a referee's first N tasks are approved.
--   * Businesses create task campaigns, fund them via Paystack
--     (budget = reward x slots x (1 + platform fee)), and review submissions.
--     Approving a submission pays the worker from that campaign's escrow,
--     atomically, inside one row-locked transaction.
--   * The daily login cash bonus is gone; the streak stays as a badge.
--
-- WHAT IS PRESERVED (existing users' money)
--   * No balance is deleted, zeroed or moved. withdrawable_balance,
--     pending_balance and total_withdrawn_lifetime are untouched.
--   * A one-time snapshot of every balance is written to
--     public.legacy_balance_snapshots for audit/reconciliation.
--   * Users who had paid the activation deposit can withdraw their existing
--     balance under the new rules (min withdrawal + daily limit), with no tier
--     cap and no referral requirement. Their 48h cooldown is measured from
--     their original activation, so most can withdraw immediately.
--   * Tier rows are deactivated (is_active = FALSE), not dropped. profiles.tier_id
--     is kept for history. All transactions/referrals history is kept.
--   * Deposits already in flight (pending 'dep_' references) can still be
--     verified and credited by settle_deposit.
--
-- SECURITY FIXES BUNDLED HERE (found while reading 003/007)
--   * 003/007 granted settle_deposit and create_pending_deposit to the
--     `authenticated` role. A signed-in user could call settle_deposit from the
--     browser on their own pending reference and be credited WITHOUT paying.
--     Both are now service_role only.
--   * 003 re-opened INSERT/UPDATE on bank_accounts and granted
--     save_verified_bank_account to `authenticated`, letting users save an
--     unverified account name/recipient code. Bank rows are server-only again.
--   * task_completions could be inserted directly with a client-chosen
--     reward_amount. Submissions now go through submit_task(), which takes the
--     reward from the task row.
--   * 003/007 reference transactions.updated_at / bank_accounts.updated_at,
--     which schema.sql never created. Added here (IF NOT EXISTS).
--
-- REQUIREMENT: the Vercel functions must have SUPABASE_SERVICE_ROLE_KEY set,
-- because all money functions are service_role only.
-- =========================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- 0. MARKETPLACE SETTINGS (single row; the ONLY place money constants live)
--    Change values with:  UPDATE public.marketplace_settings SET ... WHERE id = 1;
--    The frontend reads this row and falls back to src/config/marketplace.ts.
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.marketplace_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    min_withdrawal NUMERIC(14,2) NOT NULL DEFAULT 1000 CHECK (min_withdrawal > 0),
    daily_withdrawal_limit NUMERIC(14,2) NOT NULL DEFAULT 20000 CHECK (daily_withdrawal_limit > 0),
    max_withdrawals_per_day INT NOT NULL DEFAULT 2 CHECK (max_withdrawals_per_day > 0),
    payout_cooldown_hours INT NOT NULL DEFAULT 48 CHECK (payout_cooldown_hours >= 0),
    referral_bonus_referrer NUMERIC(14,2) NOT NULL DEFAULT 200 CHECK (referral_bonus_referrer >= 0),
    referral_bonus_referee NUMERIC(14,2) NOT NULL DEFAULT 200 CHECK (referral_bonus_referee >= 0),
    referral_qualifying_tasks INT NOT NULL DEFAULT 3 CHECK (referral_qualifying_tasks > 0),
    referral_max_bonuses_per_referrer INT NOT NULL DEFAULT 50 CHECK (referral_max_bonuses_per_referrer >= 0),
    platform_fee_rate NUMERIC(5,4) NOT NULL DEFAULT 0.25 CHECK (platform_fee_rate >= 0 AND platform_fee_rate < 1),
    min_reward_per_task NUMERIC(14,2) NOT NULL DEFAULT 50 CHECK (min_reward_per_task > 0),
    max_reward_per_task NUMERIC(14,2) NOT NULL DEFAULT 5000 CHECK (max_reward_per_task <= 5000),
    min_campaign_slots INT NOT NULL DEFAULT 5 CHECK (min_campaign_slots > 0),
    max_campaign_slots INT NOT NULL DEFAULT 10000,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (max_reward_per_task >= min_reward_per_task),
    CHECK (max_campaign_slots >= min_campaign_slots)
);

INSERT INTO public.marketplace_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.marketplace_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone reads marketplace settings" ON public.marketplace_settings;
CREATE POLICY "Anyone reads marketplace settings"
    ON public.marketplace_settings FOR SELECT USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.marketplace_settings FROM anon, authenticated;
GRANT SELECT ON public.marketplace_settings TO anon, authenticated;

-- -------------------------------------------------------------------------
-- 1. LEGACY BALANCE SNAPSHOT (audit only; never read by money functions)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.legacy_balance_snapshots (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    withdrawable_balance NUMERIC(14,2) NOT NULL,
    pending_balance NUMERIC(14,2) NOT NULL,
    total_withdrawn_lifetime NUMERIC(14,2) NOT NULL,
    tier_id VARCHAR(20),
    is_activated BOOLEAN NOT NULL,
    activation_timestamp TIMESTAMPTZ,
    total_settled_deposits NUMERIC(14,2) NOT NULL DEFAULT 0,
    snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.legacy_balance_snapshots (
    user_id, withdrawable_balance, pending_balance, total_withdrawn_lifetime,
    tier_id, is_activated, activation_timestamp, total_settled_deposits
)
SELECT p.id, p.withdrawable_balance, p.pending_balance, p.total_withdrawn_lifetime,
       p.tier_id, p.is_activated, p.activation_timestamp,
       COALESCE((SELECT SUM(t.amount) FROM public.transactions t
                  WHERE t.user_id = p.id AND lower(t.type) = 'deposit'
                    AND lower(t.status) = 'settled'), 0)
  FROM public.profiles p
ON CONFLICT (user_id) DO NOTHING;

ALTER TABLE public.legacy_balance_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users view own legacy snapshot" ON public.legacy_balance_snapshots;
CREATE POLICY "Users view own legacy snapshot"
    ON public.legacy_balance_snapshots FOR SELECT USING (auth.uid() = user_id);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.legacy_balance_snapshots FROM anon, authenticated;

-- -------------------------------------------------------------------------
-- 2. RETIRE TIERS (deactivate, never drop; FK from profiles.tier_id stays)
-- -------------------------------------------------------------------------
ALTER TABLE public.tiers
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;

UPDATE public.tiers
   SET is_active = FALSE,
       deactivated_at = COALESCE(deactivated_at, NOW())
 WHERE is_active;

-- -------------------------------------------------------------------------
-- 3. PROFILE COLUMNS: role, business name, acquisition source, earning stats
-- -------------------------------------------------------------------------
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'worker',
    ADD COLUMN IF NOT EXISTS business_name VARCHAR(100),
    ADD COLUMN IF NOT EXISTS heard_about_us VARCHAR(120),
    ADD COLUMN IF NOT EXISTS approved_task_count INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS first_task_approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS payout_eligible_from TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS is_legacy_member BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS migrated_to_marketplace_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_profiles_role') THEN
        ALTER TABLE public.profiles
            ADD CONSTRAINT chk_profiles_role CHECK (role IN ('worker', 'business', 'admin'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);

-- Existing members: mark as legacy. Users who PAID the activation deposit keep
-- the ability to withdraw their existing balance; their cooldown is measured
-- from the original activation (so it has normally already elapsed).
-- Users who never deposited keep their balance too (nothing is zeroed), and
-- become payout-eligible the same way as new users: 48h after their first
-- approved task. To make every legacy balance withdrawable immediately instead,
-- the owner can run:
--   UPDATE public.profiles SET payout_eligible_from = NOW()
--    WHERE is_legacy_member AND payout_eligible_from IS NULL;
UPDATE public.profiles
   SET is_legacy_member = TRUE,
       migrated_to_marketplace_at = NOW(),
       payout_eligible_from = CASE
           WHEN is_activated THEN COALESCE(payout_eligible_from,
                COALESCE(activation_timestamp, created_at) + INTERVAL '48 hours')
           ELSE payout_eligible_from
       END
 WHERE migrated_to_marketplace_at IS NULL;

-- -------------------------------------------------------------------------
-- 4. LEDGER / BANK TABLE FIXES
-- -------------------------------------------------------------------------
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.bank_accounts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- New ledger types. NOT VALID: enforced for every new row, but existing rows
-- are not re-checked, so this can never fail because of historical data.
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS chk_tx_type;
ALTER TABLE public.transactions ADD CONSTRAINT chk_tx_type CHECK (
    lower(type) IN (
        'deposit',
        'cashout',
        'deposit_match', 'match',
        'task_payout', 'taskpayout',
        'streak_reward', 'streakreward',
        'tier_upgrade', 'tierupgrade',
        'payout',
        'referral_bonus',
        'campaign_funding'
    )
) NOT VALID;

-- -------------------------------------------------------------------------
-- 5. REFERRALS: capped task-based bonus bookkeeping
-- -------------------------------------------------------------------------
ALTER TABLE public.referrals
    ADD COLUMN IF NOT EXISTS bonus_status TEXT NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS bonus_referrer_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS bonus_referee_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS bonus_paid_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_referrals_bonus_status') THEN
        ALTER TABLE public.referrals ADD CONSTRAINT chk_referrals_bonus_status
            CHECK (bonus_status IN ('pending', 'paid', 'referee_only', 'skipped_legacy'));
    END IF;
END $$;

-- Referees who already triggered the old deposit-funded commission must not
-- ALSO trigger the new bonus.
UPDATE public.referrals
   SET bonus_status = 'skipped_legacy'
 WHERE bonus_status = 'pending' AND deposited_amount > 0;

-- -------------------------------------------------------------------------
-- 6. CAMPAIGNS, CAMPAIGN PAYMENTS, CAMPAIGN LEDGER
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    title VARCHAR(120) NOT NULL CHECK (length(trim(title)) >= 5),
    instructions TEXT NOT NULL CHECK (length(trim(instructions)) >= 20 AND length(instructions) <= 4000),
    category VARCHAR(50) NOT NULL DEFAULT 'Social',
    proof_type VARCHAR(20) NOT NULL DEFAULT 'screenshot'
        CHECK (proof_type IN ('screenshot', 'text', 'link')),
    target_url TEXT CHECK (target_url IS NULL OR target_url ~* '^https?://'),
    reward_per_completion NUMERIC(14,2) NOT NULL CHECK (reward_per_completion > 0),
    slots INT NOT NULL CHECK (slots > 0),
    platform_fee_rate NUMERIC(5,4) NOT NULL,
    reward_budget NUMERIC(14,2) NOT NULL CHECK (reward_budget > 0),
    platform_fee NUMERIC(14,2) NOT NULL CHECK (platform_fee >= 0),
    total_charge NUMERIC(14,2) NOT NULL,
    escrow_balance NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (escrow_balance >= 0),
    slots_approved INT NOT NULL DEFAULT 0 CHECK (slots_approved >= 0),
    slots_pending INT NOT NULL DEFAULT 0 CHECK (slots_pending >= 0),
    refund_due NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (refund_due >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'pending_payment'
        CHECK (status IN ('pending_payment', 'active', 'paused', 'completed', 'cancelled')),
    task_id VARCHAR(50) UNIQUE,
    funded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_campaign_total CHECK (total_charge = reward_budget + platform_fee),
    CONSTRAINT chk_campaign_budget CHECK (reward_budget = reward_per_completion * slots),
    CONSTRAINT chk_campaign_slots CHECK (slots_approved + slots_pending <= slots)
);

CREATE INDEX IF NOT EXISTS idx_campaigns_business_id ON public.campaigns(business_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON public.campaigns(status);

DROP TRIGGER IF EXISTS set_campaigns_updated_at ON public.campaigns;
CREATE TRIGGER set_campaigns_updated_at
    BEFORE UPDATE ON public.campaigns
    FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- Every Paystack checkout attempt for a campaign. A campaign can have several
-- attempts (abandoned checkouts); only the first successful one funds it.
CREATE TABLE IF NOT EXISTS public.campaign_payments (
    reference VARCHAR(100) PRIMARY KEY,
    campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE RESTRICT,
    business_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    paid_amount NUMERIC(14,2),
    status VARCHAR(30) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'settled', 'underpaid', 'duplicate_needs_refund')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    settled_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_campaign_payments_campaign ON public.campaign_payments(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_payments_business ON public.campaign_payments(business_id);

-- Append-only money trail per campaign (funding in, fee, payouts out, refunds owed).
CREATE TABLE IF NOT EXISTS public.campaign_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE RESTRICT,
    entry_type VARCHAR(20) NOT NULL
        CHECK (entry_type IN ('funding', 'platform_fee', 'payout', 'refund_due')),
    amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
    reference VARCHAR(120) UNIQUE NOT NULL,
    completion_id UUID,
    worker_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_campaign_ledger_campaign ON public.campaign_ledger(campaign_id);

-- -------------------------------------------------------------------------
-- 7. TASKS + SUBMISSIONS LINKED TO CAMPAIGNS
-- -------------------------------------------------------------------------
ALTER TABLE public.tasks
    ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS proof_type VARCHAR(20) NOT NULL DEFAULT 'screenshot',
    ADD COLUMN IF NOT EXISTS target_url TEXT;
CREATE INDEX IF NOT EXISTS idx_tasks_campaign_id ON public.tasks(campaign_id);

-- Retire the deposit-funded referral "task" (rows kept, just hidden)
UPDATE public.tasks SET is_active = FALSE
 WHERE (id = 't-ref-growth' OR category = 'Referral') AND is_active;

ALTER TABLE public.task_completions
    ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS review_note TEXT,
    ADD COLUMN IF NOT EXISTS reviewed_by UUID,
    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(14,2);
CREATE INDEX IF NOT EXISTS idx_task_completions_campaign ON public.task_completions(campaign_id, status);

-- -------------------------------------------------------------------------
-- 8. HELPERS
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin');
$$;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- -------------------------------------------------------------------------
-- 9. SIGN-UP TRIGGER: free sign-up, optional business account + source
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
    v_ref_code VARCHAR(20);
    v_referrer_id UUID;
    v_username TEXT;
    v_phone TEXT;
    v_full_name TEXT;
    v_referred_by TEXT;
    v_role TEXT;
    v_business_name TEXT;
    v_heard TEXT;
BEGIN
    v_ref_code := 'TP' || UPPER(SUBSTRING(MD5(new.id::text) FROM 1 FOR 6));

    v_username := lower(regexp_replace(
        COALESCE(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
        '[^a-zA-Z0-9_]', '', 'g'));
    IF length(v_username) < 3 THEN
        v_username := 'user' || substr(md5(new.id::text), 1, 8);
    END IF;
    v_username := left(v_username, 30);

    v_phone := regexp_replace(COALESCE(new.raw_user_meta_data->>'phone', ''), '\D', '', 'g');
    IF v_phone !~ '^0[789][01][0-9]{8}$' THEN
        RAISE EXCEPTION 'invalid_phone: a valid 11-digit Nigerian mobile number is required';
    END IF;

    v_full_name := left(trim(COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))), 100);
    v_referred_by := NULLIF(upper(trim(COALESCE(new.raw_user_meta_data->>'referred_by_code', ''))), '');

    -- Clients may self-select 'business'; 'admin' can only be granted in SQL.
    v_role := CASE WHEN lower(COALESCE(new.raw_user_meta_data->>'account_type', '')) = 'business'
                   THEN 'business' ELSE 'worker' END;
    v_business_name := NULLIF(left(trim(COALESCE(new.raw_user_meta_data->>'business_name', '')), 100), '');
    v_heard := NULLIF(left(trim(regexp_replace(COALESCE(new.raw_user_meta_data->>'heard_about_us', ''),
                                               '[[:cntrl:]]', '', 'g')), 120), '');

    INSERT INTO public.profiles (
        id, email, username, full_name, phone, referred_by_code, referral_code,
        role, business_name, heard_about_us, migrated_to_marketplace_at
    ) VALUES (
        new.id, lower(new.email), v_username, v_full_name, v_phone, v_referred_by, v_ref_code,
        v_role, CASE WHEN v_role = 'business' THEN COALESCE(v_business_name, v_full_name) END,
        v_heard, NOW()
    )
    ON CONFLICT (id) DO NOTHING;

    IF v_referred_by IS NOT NULL THEN
        SELECT id INTO v_referrer_id
        FROM public.profiles
        WHERE referral_code = v_referred_by AND id <> new.id
        LIMIT 1;

        IF v_referrer_id IS NOT NULL THEN
            INSERT INTO public.referrals (
                referrer_id, referee_id, referee_name, referee_username, deposited_amount, joined_time
            ) VALUES (
                v_referrer_id, new.id, v_full_name, v_username, 0.00, 'Just registered'
            )
            ON CONFLICT DO NOTHING;
        END IF;
    END IF;

    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- An existing worker can open a business account (admins stay admins).
CREATE OR REPLACE FUNCTION public.become_business(p_business_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_name TEXT := left(trim(COALESCE(p_business_name, '')), 100);
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
    IF length(v_name) < 2 THEN RAISE EXCEPTION 'invalid_business_name'; END IF;

    UPDATE public.profiles
       SET role = CASE WHEN role = 'admin' THEN 'admin' ELSE 'business' END,
           business_name = v_name
     WHERE id = v_uid;

    RETURN jsonb_build_object('success', true, 'business_name', v_name);
END;
$$;

-- -------------------------------------------------------------------------
-- 10. RETIRED MONEY PATHS (functions kept so old clients get a clear error)
-- -------------------------------------------------------------------------

-- 10a. No more user deposits (activation or top-up).
CREATE OR REPLACE FUNCTION public.create_pending_deposit(
    p_user_id UUID, p_reference TEXT, p_amount NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    RAISE EXCEPTION 'deposits_disabled: TaskPulse is free to join; user deposits are no longer accepted';
END;
$$;

-- 10b. Legacy in-flight deposits only: credit exactly what was paid, once.
--      No referral commission and no "deposit match" any more.
CREATE OR REPLACE FUNCTION public.settle_deposit(
    p_reference TEXT, p_paid_amount NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_tx public.transactions%ROWTYPE;
BEGIN
    SELECT * INTO v_tx FROM public.transactions WHERE reference = p_reference FOR UPDATE;
    IF NOT FOUND OR lower(v_tx.type) <> 'deposit' THEN
        RETURN jsonb_build_object('success', false, 'error', 'unknown_reference');
    END IF;
    IF lower(v_tx.status) = 'settled' THEN
        RETURN jsonb_build_object('success', true, 'duplicate', true, 'user_id', v_tx.user_id);
    END IF;
    IF lower(v_tx.status) <> 'pending' THEN
        RETURN jsonb_build_object('success', false, 'error', 'not_pending');
    END IF;
    IF p_paid_amount IS NULL OR p_paid_amount < v_tx.amount THEN
        UPDATE public.transactions
           SET status = 'declined', description = 'Underpaid: received ' || COALESCE(p_paid_amount, 0),
               updated_at = NOW()
         WHERE id = v_tx.id;
        RETURN jsonb_build_object('success', false, 'error', 'underpaid');
    END IF;

    PERFORM 1 FROM public.profiles WHERE id = v_tx.user_id FOR UPDATE;

    UPDATE public.transactions
       SET status = 'settled', description = 'Legacy deposit credited to wallet', updated_at = NOW()
     WHERE id = v_tx.id;

    -- Honour the legacy deposit: credit it and make it withdrawable after the
    -- standard cooldown (or earlier, if the user was already eligible).
    UPDATE public.profiles
       SET withdrawable_balance = withdrawable_balance + v_tx.amount,
           is_activated = TRUE,
           activation_timestamp = COALESCE(activation_timestamp, NOW()),
           payout_eligible_from = COALESCE(payout_eligible_from, NOW() + INTERVAL '48 hours')
     WHERE id = v_tx.user_id;

    UPDATE public.referrals
       SET deposited_amount = deposited_amount + v_tx.amount,
           bonus_status = CASE WHEN bonus_status = 'pending' THEN 'skipped_legacy' ELSE bonus_status END
     WHERE referee_id = v_tx.user_id;

    RETURN jsonb_build_object('success', true, 'user_id', v_tx.user_id, 'credited', v_tx.amount);
END;
$$;

-- 10c. Tiers are retired.
CREATE OR REPLACE FUNCTION public.upgrade_tier_from_wallet(p_tier_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    RAISE EXCEPTION 'tiers_retired: stake tiers have been removed';
END;
$$;

-- 10d. Daily check-in: streak badge only, NO cash.
CREATE OR REPLACE FUNCTION public.claim_daily_reward()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_profile public.profiles%ROWTYPE;
    v_today DATE := (NOW() AT TIME ZONE 'Africa/Lagos')::date;
    v_streak INT;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

    SELECT * INTO v_profile FROM public.profiles WHERE id = v_uid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;
    IF v_profile.streak_last_claimed_date = v_today THEN RAISE EXCEPTION 'already_claimed'; END IF;

    v_streak := CASE
        WHEN v_profile.streak_last_claimed_date = v_today - 1 THEN v_profile.streak_days + 1
        ELSE 1
    END;

    UPDATE public.profiles
       SET streak_days = v_streak,
           streak_last_claimed_date = v_today
     WHERE id = v_uid;

    RETURN jsonb_build_object('success', true, 'streak_days', v_streak, 'reward_amount', 0);
END;
$$;

-- -------------------------------------------------------------------------
-- 11. BANK ACCOUNTS: one verified payout account per user, server-only writes
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_verified_bank_account(
    p_user_id UUID,
    p_bank_code TEXT,
    p_bank_name TEXT,
    p_account_number TEXT,
    p_account_name TEXT,
    p_recipient_code TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_account public.bank_accounts%ROWTYPE;
BEGIN
    PERFORM 1 FROM public.profiles WHERE id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;

    IF EXISTS (SELECT 1 FROM public.bank_accounts
                WHERE user_id = p_user_id AND is_active
                  AND NOT (bank_code = p_bank_code AND account_number = p_account_number)) THEN
        RAISE EXCEPTION 'bank_already_linked';
    END IF;

    IF EXISTS (SELECT 1 FROM public.bank_accounts
                WHERE bank_code = p_bank_code AND account_number = p_account_number
                  AND user_id <> p_user_id AND is_active) THEN
        RAISE EXCEPTION 'bank_linked_to_other_user';
    END IF;

    INSERT INTO public.bank_accounts (
        user_id, bank_code, bank_name, account_number, account_name, recipient_code, is_active
    ) VALUES (
        p_user_id, p_bank_code, p_bank_name, p_account_number, p_account_name, p_recipient_code, TRUE
    )
    ON CONFLICT (user_id, bank_code, account_number) DO UPDATE SET
        account_name = EXCLUDED.account_name,
        recipient_code = EXCLUDED.recipient_code,
        bank_name = EXCLUDED.bank_name,
        is_active = TRUE,
        updated_at = NOW()
    RETURNING * INTO v_account;

    RETURN to_jsonb(v_account);
END;
$$;

-- -------------------------------------------------------------------------
-- 12. CASHOUT RULES (free model)
--     min withdrawal, daily amount + count limit, cooldown, verified bank.
--     No tier caps, no referral gate, no deposit requirement.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_cashout(
    p_user_id UUID, p_amount NUMERIC, p_bank_account_id UUID, p_reference TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_cfg public.marketplace_settings%ROWTYPE;
    v_profile public.profiles%ROWTYPE;
    v_bank public.bank_accounts%ROWTYPE;
    v_existing public.transactions%ROWTYPE;
    v_today DATE := (NOW() AT TIME ZONE 'Africa/Lagos')::date;
    v_today_sum NUMERIC;
    v_today_count INT;
BEGIN
    SELECT * INTO v_cfg FROM public.marketplace_settings WHERE id = 1;

    SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;

    -- Idempotent replay (double-tap, retry after network error)
    SELECT * INTO v_existing FROM public.transactions WHERE reference = p_reference;
    IF FOUND THEN
        IF v_existing.user_id <> p_user_id THEN RAISE EXCEPTION 'reference_conflict'; END IF;
        RETURN jsonb_build_object(
            'success', true, 'duplicate', true,
            'status', v_existing.status, 'reference', p_reference
        );
    END IF;

    IF p_amount IS NULL OR p_amount < v_cfg.min_withdrawal THEN RAISE EXCEPTION 'min_withdrawal'; END IF;
    IF p_amount <> trunc(p_amount) THEN RAISE EXCEPTION 'whole_naira_only'; END IF;

    SELECT * INTO v_bank FROM public.bank_accounts
     WHERE id = p_bank_account_id AND user_id = p_user_id AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'bank_not_found'; END IF;

    IF v_profile.payout_eligible_from IS NULL THEN RAISE EXCEPTION 'no_approved_tasks'; END IF;
    IF v_profile.payout_eligible_from > NOW() THEN RAISE EXCEPTION 'cooldown_active'; END IF;

    SELECT COALESCE(SUM(amount), 0), COUNT(*)
      INTO v_today_sum, v_today_count
      FROM public.transactions
     WHERE user_id = p_user_id
       AND lower(type) = 'cashout'
       AND lower(status) IN ('pending', 'disbursed', 'settled')
       AND (created_at AT TIME ZONE 'Africa/Lagos')::date = v_today;

    IF v_today_count >= v_cfg.max_withdrawals_per_day THEN RAISE EXCEPTION 'daily_count_limit'; END IF;
    IF v_today_sum + p_amount > v_cfg.daily_withdrawal_limit THEN RAISE EXCEPTION 'daily_limit'; END IF;

    IF v_profile.withdrawable_balance < p_amount THEN RAISE EXCEPTION 'insufficient_balance'; END IF;

    INSERT INTO public.transactions (
        user_id, type, amount, fee, status, reference, title, description,
        destination_bank, destination_account, metadata
    ) VALUES (
        p_user_id, 'cashout', p_amount, 0, 'pending', p_reference,
        'Cashout to ' || v_bank.bank_name,
        'NIP transfer to ' || repeat('*', 6) || right(v_bank.account_number, 4),
        v_bank.bank_name, v_bank.account_number,
        jsonb_build_object('bank_account_id', v_bank.id)
    );

    UPDATE public.profiles
       SET withdrawable_balance = withdrawable_balance - p_amount,
           total_withdrawn_lifetime = total_withdrawn_lifetime + p_amount
     WHERE id = p_user_id;

    RETURN jsonb_build_object(
        'success', true, 'duplicate', false, 'status', 'pending',
        'reference', p_reference, 'recipient_code', v_bank.recipient_code,
        'bank_name', v_bank.bank_name, 'account_last4', right(v_bank.account_number, 4),
        'new_balance', v_profile.withdrawable_balance - p_amount,
        'remaining_today', v_cfg.daily_withdrawal_limit - v_today_sum - p_amount
    );
END;
$$;

-- -------------------------------------------------------------------------
-- 13. BUSINESS: CREATE + FUND CAMPAIGNS
-- -------------------------------------------------------------------------

-- 13a. Create a campaign draft. Amounts are computed HERE from settings; the
--      client never supplies a budget or fee.
CREATE OR REPLACE FUNCTION public.create_campaign(
    p_title TEXT,
    p_instructions TEXT,
    p_category TEXT,
    p_proof_type TEXT,
    p_reward NUMERIC,
    p_slots INT,
    p_target_url TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_cfg public.marketplace_settings%ROWTYPE;
    v_profile public.profiles%ROWTYPE;
    v_budget NUMERIC(14,2);
    v_total NUMERIC(14,2);
    v_campaign public.campaigns%ROWTYPE;
    v_category TEXT := COALESCE(NULLIF(trim(p_category), ''), 'Social');
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
    SELECT * INTO v_cfg FROM public.marketplace_settings WHERE id = 1;
    SELECT * INTO v_profile FROM public.profiles WHERE id = v_uid;
    IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;
    IF v_profile.role NOT IN ('business', 'admin') THEN RAISE EXCEPTION 'business_account_required'; END IF;

    IF p_reward IS NULL OR p_reward <> trunc(p_reward)
       OR p_reward < v_cfg.min_reward_per_task OR p_reward > v_cfg.max_reward_per_task THEN
        RAISE EXCEPTION 'invalid_reward';
    END IF;
    IF p_slots IS NULL OR p_slots < v_cfg.min_campaign_slots OR p_slots > v_cfg.max_campaign_slots THEN
        RAISE EXCEPTION 'invalid_slots';
    END IF;
    IF p_proof_type IS NULL OR p_proof_type NOT IN ('screenshot', 'text', 'link') THEN
        RAISE EXCEPTION 'invalid_proof_type';
    END IF;
    IF v_category NOT IN ('Social', 'App Tests', 'Surveys', 'Reviews', 'Field Audits', 'Other') THEN
        RAISE EXCEPTION 'invalid_category';
    END IF;

    v_budget := p_reward * p_slots;
    -- Whole Naira only (rounded UP so escrow is never short)
    v_total := ceil(v_budget * (1 + v_cfg.platform_fee_rate));

    INSERT INTO public.campaigns (
        business_id, title, instructions, category, proof_type, target_url,
        reward_per_completion, slots, platform_fee_rate,
        reward_budget, platform_fee, total_charge, status
    ) VALUES (
        v_uid, left(trim(p_title), 120), trim(p_instructions), v_category, p_proof_type,
        NULLIF(trim(COALESCE(p_target_url, '')), ''),
        p_reward, p_slots, v_cfg.platform_fee_rate,
        v_budget, v_total - v_budget, v_total, 'pending_payment'
    ) RETURNING * INTO v_campaign;

    RETURN jsonb_build_object(
        'success', true, 'campaign_id', v_campaign.id,
        'reward_budget', v_campaign.reward_budget,
        'platform_fee', v_campaign.platform_fee,
        'total_charge', v_campaign.total_charge
    );
END;
$$;

-- 13b. Register a Paystack checkout reference for a campaign (server only).
CREATE OR REPLACE FUNCTION public.create_campaign_payment(
    p_user_id UUID, p_campaign_id UUID, p_reference TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_campaign public.campaigns%ROWTYPE;
BEGIN
    SELECT * INTO v_campaign FROM public.campaigns WHERE id = p_campaign_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
    IF v_campaign.business_id <> p_user_id THEN RAISE EXCEPTION 'not_campaign_owner'; END IF;
    IF v_campaign.status <> 'pending_payment' THEN RAISE EXCEPTION 'campaign_already_funded'; END IF;

    INSERT INTO public.campaign_payments (reference, campaign_id, business_id, amount)
    VALUES (p_reference, v_campaign.id, v_campaign.business_id, v_campaign.total_charge);

    RETURN jsonb_build_object('success', true, 'reference', p_reference,
                              'amount', v_campaign.total_charge, 'title', v_campaign.title);
END;
$$;

-- 13c. Settle a verified campaign payment: move the reward budget into escrow,
--      book the platform fee, publish the task. Idempotent per reference.
CREATE OR REPLACE FUNCTION public.settle_campaign_funding(
    p_reference TEXT, p_paid_amount NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_pay public.campaign_payments%ROWTYPE;
    v_campaign public.campaigns%ROWTYPE;
    v_business public.profiles%ROWTYPE;
    v_task_id VARCHAR(50);
    v_steps JSONB;
BEGIN
    SELECT * INTO v_pay FROM public.campaign_payments WHERE reference = p_reference FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'unknown_reference');
    END IF;
    IF v_pay.status IN ('settled', 'duplicate_needs_refund') THEN
        RETURN jsonb_build_object('success', true, 'duplicate', true,
                                  'campaign_id', v_pay.campaign_id, 'status', v_pay.status);
    END IF;

    SELECT * INTO v_campaign FROM public.campaigns WHERE id = v_pay.campaign_id FOR UPDATE;

    IF p_paid_amount IS NULL OR p_paid_amount < v_pay.amount THEN
        UPDATE public.campaign_payments
           SET status = 'underpaid', paid_amount = p_paid_amount
         WHERE reference = p_reference;
        RETURN jsonb_build_object('success', false, 'error', 'underpaid');
    END IF;

    -- A second successful checkout for an already-funded campaign: keep the
    -- record and flag it; never double-fund. Owner refunds it in Paystack.
    IF v_campaign.status <> 'pending_payment' THEN
        UPDATE public.campaign_payments
           SET status = 'duplicate_needs_refund', paid_amount = p_paid_amount, settled_at = NOW()
         WHERE reference = p_reference;
        RETURN jsonb_build_object('success', true, 'duplicate', true,
                                  'status', 'duplicate_needs_refund', 'campaign_id', v_campaign.id);
    END IF;

    SELECT * INTO v_business FROM public.profiles WHERE id = v_campaign.business_id;
    v_task_id := 'cmp_' || replace(v_campaign.id::text, '-', '');

    SELECT COALESCE(jsonb_agg(line), '[]'::jsonb) INTO v_steps
      FROM (SELECT trim(l) AS line
              FROM regexp_split_to_table(v_campaign.instructions, E'\n') AS l
             WHERE trim(l) <> '' LIMIT 12) s;

    INSERT INTO public.tasks (
        id, title, company, reward, category, time_estimate, sla,
        spots_left, spots_total, description, steps, platform_icon, is_active,
        campaign_id, proof_type, target_url
    ) VALUES (
        v_task_id, v_campaign.title,
        left(COALESCE(v_business.business_name, v_business.full_name, 'TaskPulse Business'), 100),
        v_campaign.reward_per_completion, v_campaign.category, '5m', 'Reviewed by business',
        v_campaign.slots, v_campaign.slots, v_campaign.instructions, v_steps,
        CASE v_campaign.category
            WHEN 'Social' THEN '📣' WHEN 'App Tests' THEN '📱' WHEN 'Surveys' THEN '📝'
            WHEN 'Reviews' THEN '⭐' WHEN 'Field Audits' THEN '📍' ELSE '✅' END,
        TRUE, v_campaign.id, v_campaign.proof_type, v_campaign.target_url
    )
    ON CONFLICT (id) DO UPDATE SET is_active = TRUE;

    UPDATE public.campaigns
       SET status = 'active',
           escrow_balance = reward_budget,
           funded_at = NOW(),
           task_id = v_task_id
     WHERE id = v_campaign.id;

    UPDATE public.campaign_payments
       SET status = 'settled', paid_amount = p_paid_amount, settled_at = NOW()
     WHERE reference = p_reference;

    INSERT INTO public.campaign_ledger (campaign_id, entry_type, amount, reference)
    VALUES (v_campaign.id, 'funding', v_campaign.reward_budget, 'fund_' || p_reference),
           (v_campaign.id, 'platform_fee', v_campaign.platform_fee, 'fee_' || p_reference)
    ON CONFLICT (reference) DO NOTHING;

    -- Receipt in the business user's own history (does NOT touch any balance)
    INSERT INTO public.transactions (user_id, type, amount, fee, status, reference, title, description, metadata)
    VALUES (
        v_campaign.business_id, 'campaign_funding', v_campaign.total_charge, v_campaign.platform_fee,
        'settled', p_reference, left('Campaign funded: ' || v_campaign.title, 120),
        v_campaign.slots || ' slots x N' || v_campaign.reward_per_completion || ' + platform fee',
        jsonb_build_object('campaign_id', v_campaign.id)
    )
    ON CONFLICT (reference) DO NOTHING;

    RETURN jsonb_build_object('success', true, 'campaign_id', v_campaign.id, 'task_id', v_task_id,
                              'escrow', v_campaign.reward_budget);
END;
$$;

-- 13d. Pause / resume / cancel a campaign (owner or admin).
--      Cancel unpublishes the task, keeps escrow for submissions still pending
--      review, and records the unused remainder as refund_due (the owner
--      refunds it to the business from the Paystack dashboard).
CREATE OR REPLACE FUNCTION public.set_campaign_status(p_campaign_id UUID, p_status TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_campaign public.campaigns%ROWTYPE;
    v_refund NUMERIC(14,2);
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
    SELECT * INTO v_campaign FROM public.campaigns WHERE id = p_campaign_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
    IF v_campaign.business_id <> v_uid AND NOT public.is_admin() THEN
        RAISE EXCEPTION 'not_campaign_owner';
    END IF;

    IF p_status = 'paused' AND v_campaign.status = 'active' THEN
        UPDATE public.campaigns SET status = 'paused' WHERE id = p_campaign_id;
        UPDATE public.tasks SET is_active = FALSE WHERE campaign_id = p_campaign_id;
    ELSIF p_status = 'active' AND v_campaign.status = 'paused' THEN
        UPDATE public.campaigns SET status = 'active' WHERE id = p_campaign_id;
        UPDATE public.tasks SET is_active = TRUE WHERE campaign_id = p_campaign_id;
    ELSIF p_status = 'cancelled' AND v_campaign.status IN ('pending_payment', 'active', 'paused') THEN
        v_refund := GREATEST(0, v_campaign.escrow_balance
                                - v_campaign.slots_pending * v_campaign.reward_per_completion);
        UPDATE public.campaigns
           SET status = 'cancelled',
               escrow_balance = escrow_balance - v_refund,
               refund_due = refund_due + v_refund
         WHERE id = p_campaign_id;
        UPDATE public.tasks SET is_active = FALSE WHERE campaign_id = p_campaign_id;
        IF v_refund > 0 THEN
            INSERT INTO public.campaign_ledger (campaign_id, entry_type, amount, reference)
            VALUES (p_campaign_id, 'refund_due', v_refund, 'refund_' || p_campaign_id::text)
            ON CONFLICT (reference) DO NOTHING;
        END IF;
    ELSE
        RAISE EXCEPTION 'invalid_status_change';
    END IF;

    RETURN jsonb_build_object('success', true, 'status', p_status);
END;
$$;

-- -------------------------------------------------------------------------
-- 14. WORKER: SUBMIT PROOF (reserves a slot under a campaign row lock)
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_task(
    p_task_id TEXT, p_proof_text TEXT DEFAULT NULL, p_proof_url TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_task public.tasks%ROWTYPE;
    v_campaign public.campaigns%ROWTYPE;
    v_completion_id UUID;
    v_text TEXT := NULLIF(left(trim(COALESCE(p_proof_text, '')), 2000), '');
    v_url TEXT := NULLIF(trim(COALESCE(p_proof_url, '')), '');
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
    IF NOT FOUND OR NOT v_task.is_active THEN RAISE EXCEPTION 'task_not_available'; END IF;

    IF v_text IS NULL AND v_url IS NULL THEN RAISE EXCEPTION 'proof_required'; END IF;
    IF v_task.proof_type = 'screenshot' AND v_url IS NULL THEN RAISE EXCEPTION 'screenshot_required'; END IF;
    -- Screenshot paths must live in the worker's own storage folder
    IF v_url IS NOT NULL AND v_url NOT LIKE v_uid::text || '/%' THEN RAISE EXCEPTION 'invalid_proof_path'; END IF;
    IF v_task.proof_type = 'link' AND (v_text IS NULL OR v_text !~* '^https?://') THEN
        RAISE EXCEPTION 'link_required';
    END IF;

    IF v_task.campaign_id IS NOT NULL THEN
        SELECT * INTO v_campaign FROM public.campaigns WHERE id = v_task.campaign_id FOR UPDATE;
        IF v_campaign.status <> 'active' THEN RAISE EXCEPTION 'task_not_available'; END IF;
        IF v_campaign.business_id = v_uid THEN RAISE EXCEPTION 'own_campaign'; END IF;
        IF v_campaign.slots_approved + v_campaign.slots_pending >= v_campaign.slots THEN
            RAISE EXCEPTION 'no_slots_left';
        END IF;
    END IF;

    BEGIN
        INSERT INTO public.task_completions (
            user_id, task_id, task_title, company, reward_amount, category,
            proof_text, proof_screenshot_url, status, sla_time, campaign_id
        ) VALUES (
            v_uid, v_task.id, v_task.title, v_task.company, v_task.reward, v_task.category,
            v_text, v_url, 'pending', 'Awaiting review', v_task.campaign_id
        ) RETURNING id INTO v_completion_id;
    EXCEPTION
        WHEN unique_violation THEN RAISE EXCEPTION 'already_submitted';
    END;

    IF v_task.campaign_id IS NOT NULL THEN
        UPDATE public.campaigns SET slots_pending = slots_pending + 1 WHERE id = v_task.campaign_id;
        UPDATE public.tasks SET spots_left = GREATEST(0, spots_left - 1) WHERE id = v_task.id;
    END IF;

    RETURN jsonb_build_object('success', true, 'completion_id', v_completion_id, 'status', 'pending');
END;
$$;

-- -------------------------------------------------------------------------
-- 15. REVIEW: approve / reject a submission and pay from escrow atomically
-- -------------------------------------------------------------------------
-- Core routine (NOT callable by clients). p_reviewer NULL = service_role / SQL editor.
CREATE OR REPLACE FUNCTION public._review_submission_core(
    p_completion_id UUID, p_approve BOOLEAN, p_note TEXT, p_reviewer UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_cfg public.marketplace_settings%ROWTYPE;
    v_sub public.task_completions%ROWTYPE;
    v_campaign public.campaigns%ROWTYPE;
    v_task public.tasks%ROWTYPE;
    v_reward NUMERIC(14,2);
    v_is_admin BOOLEAN := FALSE;
    v_count INT;
    v_ref public.referrals%ROWTYPE;
    v_paid_bonuses INT;
    v_referrer_bonus NUMERIC(14,2) := 0;
    v_referee_bonus NUMERIC(14,2) := 0;
BEGIN
    SELECT * INTO v_cfg FROM public.marketplace_settings WHERE id = 1;

    SELECT * INTO v_sub FROM public.task_completions WHERE id = p_completion_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'completion_not_found'; END IF;

    IF p_reviewer IS NULL THEN
        v_is_admin := TRUE;
    ELSE
        SELECT (role = 'admin') INTO v_is_admin FROM public.profiles WHERE id = p_reviewer;
        v_is_admin := COALESCE(v_is_admin, FALSE);
    END IF;

    IF v_sub.campaign_id IS NOT NULL THEN
        SELECT * INTO v_campaign FROM public.campaigns WHERE id = v_sub.campaign_id FOR UPDATE;
        IF NOT v_is_admin AND v_campaign.business_id IS DISTINCT FROM p_reviewer THEN
            RAISE EXCEPTION 'not_campaign_owner';
        END IF;
    ELSIF NOT v_is_admin THEN
        RAISE EXCEPTION 'admin_required';
    END IF;

    IF v_sub.user_id = p_reviewer THEN RAISE EXCEPTION 'cannot_review_own_submission'; END IF;

    IF lower(v_sub.status) <> 'pending' THEN
        RETURN jsonb_build_object('success', true, 'duplicate', true, 'status', v_sub.status);
    END IF;

    -- REJECT ----------------------------------------------------------------
    IF NOT p_approve THEN
        UPDATE public.task_completions
           SET status = 'rejected', review_note = left(p_note, 500),
               reviewed_by = p_reviewer, reviewed_at = NOW()
         WHERE id = v_sub.id;

        IF v_sub.campaign_id IS NOT NULL THEN
            UPDATE public.campaigns SET slots_pending = GREATEST(0, slots_pending - 1)
             WHERE id = v_campaign.id;

            IF v_campaign.status IN ('active', 'paused') THEN
                -- Slot becomes available to another worker
                UPDATE public.tasks SET spots_left = LEAST(spots_total, spots_left + 1)
                 WHERE campaign_id = v_campaign.id;
            ELSIF v_campaign.status = 'cancelled' THEN
                -- Reserve for this slot is released to the business refund
                UPDATE public.campaigns
                   SET escrow_balance = escrow_balance - v_campaign.reward_per_completion,
                       refund_due = refund_due + v_campaign.reward_per_completion
                 WHERE id = v_campaign.id;
                INSERT INTO public.campaign_ledger (campaign_id, entry_type, amount, reference, completion_id)
                VALUES (v_campaign.id, 'refund_due', v_campaign.reward_per_completion,
                        'refund_rej_' || v_sub.id::text, v_sub.id)
                ON CONFLICT (reference) DO NOTHING;
            END IF;
        END IF;
        RETURN jsonb_build_object('success', true, 'status', 'rejected');
    END IF;

    -- APPROVE ---------------------------------------------------------------
    IF v_sub.campaign_id IS NOT NULL THEN
        v_reward := v_campaign.reward_per_completion;           -- never the client value
        IF v_campaign.escrow_balance < v_reward THEN RAISE EXCEPTION 'escrow_insufficient'; END IF;

        UPDATE public.campaigns
           SET escrow_balance = escrow_balance - v_reward,
               slots_pending = GREATEST(0, slots_pending - 1),
               slots_approved = slots_approved + 1,
               status = CASE WHEN slots_approved + 1 >= slots AND status IN ('active', 'paused')
                             THEN 'completed' ELSE status END
         WHERE id = v_campaign.id;

        IF v_campaign.slots_approved + 1 >= v_campaign.slots THEN
            UPDATE public.tasks SET is_active = FALSE WHERE campaign_id = v_campaign.id;
        END IF;

        INSERT INTO public.campaign_ledger (campaign_id, entry_type, amount, reference, completion_id, worker_id)
        VALUES (v_campaign.id, 'payout', v_reward, 'payout_' || v_sub.id::text, v_sub.id, v_sub.user_id);
    ELSE
        -- Platform-owned task (admin only): pay the catalogue reward, capped by
        -- what was recorded at submission time.
        SELECT * INTO v_task FROM public.tasks WHERE id = v_sub.task_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'task_not_found'; END IF;
        v_reward := LEAST(v_task.reward, v_sub.reward_amount);
    END IF;

    PERFORM 1 FROM public.profiles WHERE id = v_sub.user_id FOR UPDATE;

    INSERT INTO public.transactions (user_id, type, amount, status, reference, title, description, metadata)
    VALUES (v_sub.user_id, 'task_payout', v_reward, 'settled',
            'task_' || v_sub.id::text, left('Task Reward: ' || v_sub.task_title, 120), v_sub.company,
            jsonb_build_object('completion_id', v_sub.id, 'campaign_id', v_sub.campaign_id));

    UPDATE public.profiles
       SET withdrawable_balance = withdrawable_balance + v_reward,
           approved_task_count = approved_task_count + 1,
           first_task_approved_at = COALESCE(first_task_approved_at, NOW()),
           payout_eligible_from = COALESCE(payout_eligible_from,
                                           NOW() + make_interval(hours => v_cfg.payout_cooldown_hours))
     WHERE id = v_sub.user_id
    RETURNING approved_task_count INTO v_count;

    UPDATE public.task_completions
       SET status = 'approved', review_note = left(p_note, 500), paid_amount = v_reward,
           reviewed_by = p_reviewer, reviewed_at = NOW()
     WHERE id = v_sub.id;

    -- Referral bonus: once, when the referee's Nth task is approved.
    -- Platform-funded (from the campaign fee), capped per referrer.
    IF v_count >= v_cfg.referral_qualifying_tasks THEN
        SELECT * INTO v_ref FROM public.referrals
         WHERE referee_id = v_sub.user_id AND bonus_status = 'pending'
         FOR UPDATE;
        IF FOUND THEN
            v_referee_bonus := v_cfg.referral_bonus_referee;

            SELECT COUNT(*) INTO v_paid_bonuses FROM public.referrals
             WHERE referrer_id = v_ref.referrer_id AND bonus_status = 'paid';
            IF v_ref.referrer_id <> v_sub.user_id
               AND v_paid_bonuses < v_cfg.referral_max_bonuses_per_referrer THEN
                v_referrer_bonus := v_cfg.referral_bonus_referrer;
            END IF;

            IF v_referee_bonus > 0 THEN
                INSERT INTO public.transactions (user_id, type, amount, status, reference, title, description)
                VALUES (v_sub.user_id, 'referral_bonus', v_referee_bonus, 'settled',
                        'refb_ee_' || v_ref.id::text, 'Welcome Bonus',
                        'Your first ' || v_cfg.referral_qualifying_tasks || ' tasks were approved')
                ON CONFLICT (reference) DO NOTHING;
                UPDATE public.profiles SET withdrawable_balance = withdrawable_balance + v_referee_bonus
                 WHERE id = v_sub.user_id;
            END IF;

            IF v_referrer_bonus > 0 THEN
                PERFORM 1 FROM public.profiles WHERE id = v_ref.referrer_id FOR UPDATE;
                INSERT INTO public.transactions (user_id, type, amount, status, reference, title, description)
                VALUES (v_ref.referrer_id, 'referral_bonus', v_referrer_bonus, 'settled',
                        'refb_er_' || v_ref.id::text, 'Referral Bonus',
                        '@' || v_ref.referee_username || ' completed '
                            || v_cfg.referral_qualifying_tasks || ' approved tasks')
                ON CONFLICT (reference) DO NOTHING;
                UPDATE public.profiles SET withdrawable_balance = withdrawable_balance + v_referrer_bonus
                 WHERE id = v_ref.referrer_id;
            END IF;

            UPDATE public.referrals
               SET bonus_status = CASE WHEN v_referrer_bonus > 0 THEN 'paid' ELSE 'referee_only' END,
                   bonus_referrer_amount = v_referrer_bonus,
                   bonus_referee_amount = v_referee_bonus,
                   bonus_paid_at = NOW()
             WHERE id = v_ref.id;
        END IF;
    END IF;

    RETURN jsonb_build_object('success', true, 'status', 'approved', 'credited', v_reward,
                              'referral_bonus_referee', v_referee_bonus,
                              'referral_bonus_referrer', v_referrer_bonus);
END;
$$;

-- Client entry point: reviewer identity always comes from auth.uid().
CREATE OR REPLACE FUNCTION public.review_submission(
    p_completion_id UUID, p_approve BOOLEAN, p_note TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
    RETURN public._review_submission_core(p_completion_id, p_approve, p_note, auth.uid());
END;
$$;

-- Legacy admin/service entry point now routes through the same core logic.
CREATE OR REPLACE FUNCTION public.approve_task_completion(p_completion_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    RETURN public._review_submission_core(p_completion_id, TRUE, NULL, NULL);
END;
$$;

-- Review queue with worker usernames only (no emails, phones or balances).
CREATE OR REPLACE FUNCTION public.list_review_submissions(
    p_campaign_id UUID DEFAULT NULL, p_status TEXT DEFAULT 'pending', p_limit INT DEFAULT 50
) RETURNS TABLE (
    id UUID, campaign_id UUID, campaign_title TEXT, task_id TEXT, worker_username TEXT,
    proof_text TEXT, proof_screenshot_url TEXT, reward_amount NUMERIC, status TEXT,
    review_note TEXT, completed_at TIMESTAMPTZ, reviewed_at TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_admin BOOLEAN := public.is_admin();
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
    RETURN QUERY
    SELECT tc.id, tc.campaign_id, COALESCE(c.title, tc.task_title)::TEXT, tc.task_id::TEXT,
           p.username::TEXT, tc.proof_text, tc.proof_screenshot_url,
           COALESCE(c.reward_per_completion, tc.reward_amount), tc.status::TEXT,
           tc.review_note, tc.completed_at, tc.reviewed_at
      FROM public.task_completions tc
      LEFT JOIN public.campaigns c ON c.id = tc.campaign_id
      JOIN public.profiles p ON p.id = tc.user_id
     WHERE (p_campaign_id IS NULL OR tc.campaign_id = p_campaign_id)
       AND (p_status IS NULL OR lower(tc.status) = lower(p_status))
       AND (v_admin OR c.business_id = v_uid)
     ORDER BY tc.completed_at ASC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
END;
$$;

-- -------------------------------------------------------------------------
-- 16. PRIVILEGES + RLS
-- -------------------------------------------------------------------------
-- Server-only (service_role) money functions
REVOKE ALL ON FUNCTION public.create_pending_deposit(UUID, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_deposit(TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_cashout(UUID, NUMERIC, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_cashout(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_task_completion(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_verified_bank_account(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_campaign_payment(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_campaign_funding(TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._review_submission_core(UUID, BOOLEAN, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.upgrade_tier_from_wallet(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_pending_deposit(UUID, TEXT, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_deposit(TEXT, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_cashout(UUID, NUMERIC, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_cashout(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_task_completion(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_verified_bank_account(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_campaign_payment(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_campaign_funding(TEXT, NUMERIC) TO service_role;

-- Signed-in user functions (identity from auth.uid(), never a parameter)
REVOKE ALL ON FUNCTION public.claim_daily_reward() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.become_business(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_campaign(TEXT, TEXT, TEXT, TEXT, NUMERIC, INT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_campaign_status(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_task(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.review_submission(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_review_submissions(UUID, TEXT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_daily_reward() TO authenticated;
GRANT EXECUTE ON FUNCTION public.become_business(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_campaign(TEXT, TEXT, TEXT, TEXT, NUMERIC, INT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_campaign_status(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_task(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_submission(UUID, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_review_submissions(UUID, TEXT, INT) TO authenticated;

-- bank_accounts: server writes only (link-bank API with the service role)
REVOKE INSERT, UPDATE, TRUNCATE ON public.bank_accounts FROM anon, authenticated;
DROP POLICY IF EXISTS "Users insert own bank accounts" ON public.bank_accounts;
DROP POLICY IF EXISTS "Users update own bank accounts" ON public.bank_accounts;

-- task_completions: submissions only through submit_task()
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.task_completions FROM anon, authenticated;
DROP POLICY IF EXISTS "Users insert task completions" ON public.task_completions;
DROP POLICY IF EXISTS "Users view own task completions" ON public.task_completions;
CREATE POLICY "Users view own task completions"
    ON public.task_completions FOR SELECT
    USING (
        auth.uid() = user_id
        OR public.is_admin()
        OR EXISTS (SELECT 1 FROM public.campaigns c
                    WHERE c.id = task_completions.campaign_id AND c.business_id = auth.uid())
    );

-- campaigns / payments / ledger: owners (and admins) read; writes via functions
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_ledger ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.campaigns FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.campaign_payments FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.campaign_ledger FROM anon, authenticated;
GRANT SELECT ON public.campaigns, public.campaign_payments, public.campaign_ledger TO authenticated;

DROP POLICY IF EXISTS "Owners view own campaigns" ON public.campaigns;
CREATE POLICY "Owners view own campaigns" ON public.campaigns FOR SELECT
    USING (business_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS "Owners view own campaign payments" ON public.campaign_payments;
CREATE POLICY "Owners view own campaign payments" ON public.campaign_payments FOR SELECT
    USING (business_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS "Owners view own campaign ledger" ON public.campaign_ledger;
CREATE POLICY "Owners view own campaign ledger" ON public.campaign_ledger FOR SELECT
    USING (public.is_admin() OR EXISTS (SELECT 1 FROM public.campaigns c
                                        WHERE c.id = campaign_ledger.campaign_id
                                          AND c.business_id = auth.uid()));

-- Storage: campaign owners and admins may view proof screenshots sent to them
DROP POLICY IF EXISTS "Reviewers read submitted proofs" ON storage.objects;
CREATE POLICY "Reviewers read submitted proofs"
    ON storage.objects FOR SELECT TO authenticated
    USING (
        bucket_id = 'taskpulse-proofs'
        AND (
            public.is_admin()
            OR EXISTS (
                SELECT 1 FROM public.task_completions tc
                  JOIN public.campaigns c ON c.id = tc.campaign_id
                 WHERE tc.proof_screenshot_url = storage.objects.name
                   AND c.business_id = auth.uid()
            )
        )
    );

COMMIT;

-- =========================================================================
-- POST-MIGRATION CHECKS (read-only; run manually after the migration)
-- =========================================================================
-- 1) Nothing was zeroed: before vs now totals must match exactly.
--    SELECT SUM(s.withdrawable_balance) AS before_w, SUM(p.withdrawable_balance) AS now_w,
--           SUM(s.pending_balance)      AS before_p, SUM(p.pending_balance)      AS now_p
--      FROM public.legacy_balance_snapshots s JOIN public.profiles p ON p.id = s.user_id;
-- 2) Total wallet liability your Paystack balance must be able to cover:
--    SELECT SUM(withdrawable_balance) AS owed_to_users FROM public.profiles;
-- 3) Grant yourself admin (replace the email):
--    UPDATE public.profiles SET role = 'admin' WHERE email = 'you@example.com';

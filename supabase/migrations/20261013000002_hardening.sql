-- =========================================================================
-- TASKPULSE 002 - SECURITY HARDENING MIGRATION
-- Run in the Supabase SQL Editor AFTER schema.sql. Safe to re-run.
-- =========================================================================
-- What this fixes (found in the audit of schema.sql):
--  1. Users could UPDATE their own profile row, including withdrawable_balance,
--     tier_id and is_activated, straight from the browser (RLS allowed it).
--  2. execute_financial_mutation() was callable by any logged-in user for any
--     user id, so anyone could credit themselves.
--  3. Users could INSERT referrals with deposited_amount = 3000 (fake referrals),
--     INSERT bank accounts with an arbitrary account name, and INSERT
--     task completions already marked 'approved'.
--  4. Tier upgrades paid by card credited the wallet instead of changing tier.
--  5. Cashouts were written as 'disbursed' before Paystack confirmed them, so a
--     failed transfer lost the user's money with no refund path.
--  6. Task-proof storage bucket was world-readable and accepted any file/path.
-- All money now moves ONLY through the SECURITY DEFINER functions below.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 0. TIERS (server-side source of truth; the UI copy is display only)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tiers (
    id VARCHAR(20) PRIMARY KEY,
    name TEXT NOT NULL,
    rank INT NOT NULL UNIQUE,
    stake_amount NUMERIC(14,2) NOT NULL,
    withdrawal_cap NUMERIC(14,2) NOT NULL,
    max_single_cashout NUMERIC(14,2) NOT NULL
);

INSERT INTO public.tiers (id, name, rank, stake_amount, withdrawal_cap, max_single_cashout) VALUES
    ('tier-1', 'Bronze Pulse',   1,  3000,  24000,  10000),
    ('tier-2', 'Silver Pulse',   2, 10000,  80000,  25000),
    ('tier-3', 'Gold Pulse',     3, 15000, 120000,  40000),
    ('tier-4', 'Platinum Pulse', 4, 30000, 250000,  75000),
    ('tier-5', 'Diamond Pulse',  5, 50000, 450000, 150000),
    ('tier-6', 'Black Crown VIP',6, 75000, 750000, 250000)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    rank = EXCLUDED.rank,
    stake_amount = EXCLUDED.stake_amount,
    withdrawal_cap = EXCLUDED.withdrawal_cap,
    max_single_cashout = EXCLUDED.max_single_cashout;

ALTER TABLE public.tiers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone reads tiers" ON public.tiers;
CREATE POLICY "Anyone reads tiers" ON public.tiers FOR SELECT USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.tiers FROM anon, authenticated;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_profiles_tier') THEN
        ALTER TABLE public.profiles
            ADD CONSTRAINT fk_profiles_tier FOREIGN KEY (tier_id) REFERENCES public.tiers(id);
    END IF;
END $$;

-- -------------------------------------------------------------------------
-- 1. PROFILE COLUMNS (KYC status + correct streak semantics) AND UNIQUENESS
-- -------------------------------------------------------------------------
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS kyc_status TEXT NOT NULL DEFAULT 'unverified'
        CHECK (kyc_status IN ('unverified', 'pending', 'verified', 'rejected')),
    ADD COLUMN IF NOT EXISTS kyc_id_type TEXT,
    ADD COLUMN IF NOT EXISTS kyc_id_last4 VARCHAR(4),
    ADD COLUMN IF NOT EXISTS kyc_submitted_at TIMESTAMPTZ;

-- streak_days now means "consecutive days claimed" (0 = never claimed)
ALTER TABLE public.profiles ALTER COLUMN streak_days SET DEFAULT 0;
UPDATE public.profiles SET streak_days = 0 WHERE streak_last_claimed_date IS NULL;

-- Case-insensitive uniqueness: "Doctorr" and "doctorr" are the same person
CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_username_lower ON public.profiles (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_email_lower ON public.profiles (lower(email));

-- One referral row per referred user
CREATE UNIQUE INDEX IF NOT EXISTS uq_referrals_referee
    ON public.referrals (referee_id) WHERE referee_id IS NOT NULL;

-- Ledger statuses now include failed / reversed for refunded cashouts
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS chk_tx_status;
ALTER TABLE public.transactions ADD CONSTRAINT chk_tx_status CHECK (
    lower(status) IN ('pending', 'settled', 'declined', 'disbursed', 'failed', 'reversed')
);

-- -------------------------------------------------------------------------
-- 2. REMOVE THE UNSAFE FUNCTION
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.execute_financial_mutation(
    UUID, VARCHAR, NUMERIC, NUMERIC, VARCHAR, VARCHAR, TEXT, VARCHAR, VARCHAR, JSONB
);

-- -------------------------------------------------------------------------
-- 3. SIGN-UP TRIGGER: normalise + validate what a client can inject
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

    INSERT INTO public.profiles (
        id, email, username, full_name, phone, referred_by_code, referral_code
    ) VALUES (
        new.id, lower(new.email), v_username, v_full_name, v_phone, v_referred_by, v_ref_code
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

-- -------------------------------------------------------------------------
-- 4. LOCK DOWN TABLE PRIVILEGES + RLS (clients may READ their own data only)
-- -------------------------------------------------------------------------
-- profiles: the ONLY thing a user may change directly is their display name
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.profiles FROM anon, authenticated;
GRANT UPDATE (full_name) ON public.profiles TO authenticated;
DROP POLICY IF EXISTS "Users insert own profile" ON public.profiles;

-- transactions: read-only for clients; written only by the functions below
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.transactions FROM anon, authenticated;

-- referrals: read-only for clients; created by the sign-up trigger
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.referrals FROM anon, authenticated;
DROP POLICY IF EXISTS "Users insert referrals" ON public.referrals;

-- bank accounts: created by the server after Paystack resolves the NUBAN
REVOKE INSERT, UPDATE, TRUNCATE ON public.bank_accounts FROM anon, authenticated;
DROP POLICY IF EXISTS "Users insert own bank accounts" ON public.bank_accounts;
DROP POLICY IF EXISTS "Users update own bank accounts" ON public.bank_accounts;

-- task completions: a user may only submit a PENDING proof, once per task
ALTER TABLE public.task_completions ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE public.task_completions DROP CONSTRAINT IF EXISTS chk_task_reward_cap;
ALTER TABLE public.task_completions ADD CONSTRAINT chk_task_reward_cap CHECK (reward_amount <= 5000);
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_completion_user_task
    ON public.task_completions (user_id, task_id);
REVOKE UPDATE, DELETE, TRUNCATE ON public.task_completions FROM anon, authenticated;
DROP POLICY IF EXISTS "Users insert task completions" ON public.task_completions;
CREATE POLICY "Users insert task completions"
    ON public.task_completions FOR INSERT
    WITH CHECK (auth.uid() = user_id AND lower(status) = 'pending');

-- -------------------------------------------------------------------------
-- 5. SERVER-ONLY MONEY FUNCTIONS (called with the service_role key from /api)
-- -------------------------------------------------------------------------

-- 5a. Register an expected deposit BEFORE the user is sent to Paystack.
--     Only references we created can ever be credited.
CREATE OR REPLACE FUNCTION public.create_pending_deposit(
    p_user_id UUID, p_reference TEXT, p_amount NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_profile public.profiles%ROWTYPE;
BEGIN
    SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;

    IF p_amount IS NULL OR p_amount <> trunc(p_amount) THEN
        RAISE EXCEPTION 'invalid_amount';
    END IF;
    IF NOT v_profile.is_activated AND p_amount <> 3000 THEN
        RAISE EXCEPTION 'activation_amount_must_be_3000';
    END IF;
    IF p_amount < 1000 OR p_amount > 500000 THEN
        RAISE EXCEPTION 'invalid_amount';
    END IF;

    INSERT INTO public.transactions (user_id, type, amount, status, reference, title, description, channel)
    VALUES (
        p_user_id, 'deposit', p_amount, 'pending', p_reference,
        CASE WHEN v_profile.is_activated THEN 'Wallet Top-up' ELSE 'Account Activation Deposit' END,
        'Awaiting Paystack confirmation', 'paystack'
    );
    RETURN jsonb_build_object('success', true, 'reference', p_reference);
END;
$$;

-- 5b. Credit a verified deposit. Idempotent: webhook + verify endpoint + retries
--     can all call this for the same reference and the wallet is credited once.
CREATE OR REPLACE FUNCTION public.settle_deposit(
    p_reference TEXT, p_paid_amount NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_tx public.transactions%ROWTYPE;
    v_profile public.profiles%ROWTYPE;
    v_ref public.referrals%ROWTYPE;
    v_referrer public.profiles%ROWTYPE;
    v_qualified INT;
    v_volume NUMERIC;
    v_bonus NUMERIC;
BEGIN
    SELECT * INTO v_tx FROM public.transactions WHERE reference = p_reference FOR UPDATE;
    IF NOT FOUND OR lower(v_tx.type) <> 'deposit' THEN
        RETURN jsonb_build_object('success', false, 'error', 'unknown_reference');
    END IF;
    IF lower(v_tx.status) = 'settled' THEN
        RETURN jsonb_build_object('success', true, 'duplicate', true);
    END IF;
    IF lower(v_tx.status) <> 'pending' THEN
        RETURN jsonb_build_object('success', false, 'error', 'not_pending');
    END IF;
    IF p_paid_amount IS NULL OR p_paid_amount < v_tx.amount THEN
        UPDATE public.transactions
           SET status = 'declined', description = 'Underpaid: received ' || COALESCE(p_paid_amount, 0)
         WHERE id = v_tx.id;
        RETURN jsonb_build_object('success', false, 'error', 'underpaid');
    END IF;

    SELECT * INTO v_profile FROM public.profiles WHERE id = v_tx.user_id FOR UPDATE;

    UPDATE public.profiles
       SET withdrawable_balance = withdrawable_balance + v_tx.amount,
           is_activated = TRUE,
           activation_timestamp = COALESCE(activation_timestamp, NOW())
     WHERE id = v_tx.user_id;

    UPDATE public.transactions
       SET status = 'settled', description = '100% credited to wallet via Paystack'
     WHERE id = v_tx.id;

    -- Referral qualification + one-time "initial deposit doubled" match bonus
    UPDATE public.referrals
       SET deposited_amount = deposited_amount + v_tx.amount
     WHERE referee_id = v_tx.user_id
    RETURNING * INTO v_ref;

    IF FOUND THEN
        SELECT * INTO v_referrer FROM public.profiles WHERE id = v_ref.referrer_id FOR UPDATE;

        SELECT COUNT(*) FILTER (WHERE deposited_amount >= 3000), COALESCE(SUM(deposited_amount), 0)
          INTO v_qualified, v_volume
          FROM public.referrals WHERE referrer_id = v_ref.referrer_id;

        IF v_qualified >= 3 AND v_volume >= 9000
           AND NOT v_referrer.has_received_double_credit
           AND v_referrer.is_activated THEN
            SELECT stake_amount INTO v_bonus FROM public.tiers WHERE id = v_referrer.tier_id;

            INSERT INTO public.transactions (user_id, type, amount, status, reference, title, description)
            VALUES (
                v_referrer.id, 'deposit_match', v_bonus, 'settled', 'match_' || v_referrer.id::text,
                '100% Initial Deposit Double Credit',
                '3 referrals and N' || v_volume || ' volume met'
            )
            ON CONFLICT (reference) DO NOTHING;

            IF FOUND THEN
                UPDATE public.profiles
                   SET withdrawable_balance = withdrawable_balance + v_bonus,
                       has_received_double_credit = TRUE
                 WHERE id = v_referrer.id;
            END IF;
        END IF;
    END IF;

    RETURN jsonb_build_object('success', true, 'user_id', v_tx.user_id, 'credited', v_tx.amount);
END;
$$;

-- 5c. Debit a cashout atomically. Every rule is enforced HERE, inside the row
--     lock, so no client or API bug can bypass it.
--     Money is debited first (status 'pending'); finalize_cashout settles/refunds.
CREATE OR REPLACE FUNCTION public.request_cashout(
    p_user_id UUID, p_amount NUMERIC, p_bank_account_id UUID, p_reference TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_profile public.profiles%ROWTYPE;
    v_tier public.tiers%ROWTYPE;
    v_bank public.bank_accounts%ROWTYPE;
    v_existing public.transactions%ROWTYPE;
    v_qualified INT;
    v_volume NUMERIC;
    v_eligible BOOLEAN;
BEGIN
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

    IF p_amount IS NULL OR p_amount < 3000 THEN RAISE EXCEPTION 'min_withdrawal'; END IF;
    IF p_amount <> trunc(p_amount) THEN RAISE EXCEPTION 'whole_naira_only'; END IF;

    SELECT * INTO v_bank FROM public.bank_accounts
     WHERE id = p_bank_account_id AND user_id = p_user_id AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'bank_not_found'; END IF;

    IF NOT v_profile.is_activated THEN RAISE EXCEPTION 'not_activated'; END IF;
    IF v_profile.activation_timestamp > NOW() - INTERVAL '48 hours' THEN
        RAISE EXCEPTION 'cooldown_active';
    END IF;

    SELECT COUNT(*) FILTER (WHERE deposited_amount >= 3000), COALESCE(SUM(deposited_amount), 0)
      INTO v_qualified, v_volume
      FROM public.referrals WHERE referrer_id = p_user_id;

    v_eligible := (v_qualified >= 3 AND v_volume >= 9000)
                  OR v_profile.has_received_double_credit
                  OR v_profile.has_upgraded_after_limit
                  OR v_profile.tier_id <> 'tier-1';
    IF NOT v_eligible THEN RAISE EXCEPTION 'referral_condition'; END IF;

    SELECT * INTO v_tier FROM public.tiers WHERE id = v_profile.tier_id;
    IF p_amount > v_tier.max_single_cashout THEN RAISE EXCEPTION 'single_limit'; END IF;
    IF v_profile.total_withdrawn_lifetime + p_amount > v_tier.withdrawal_cap THEN
        RAISE EXCEPTION 'tier_cap';
    END IF;
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
        'new_balance', v_profile.withdrawable_balance - p_amount
    );
END;
$$;

-- 5d. Settle or refund a cashout once Paystack reports the outcome. Idempotent.
CREATE OR REPLACE FUNCTION public.finalize_cashout(
    p_reference TEXT, p_outcome TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_tx public.transactions%ROWTYPE;
BEGIN
    SELECT * INTO v_tx FROM public.transactions
     WHERE reference = p_reference AND lower(type) = 'cashout' FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'unknown_reference');
    END IF;

    IF p_outcome = 'success' THEN
        IF lower(v_tx.status) = 'pending' THEN
            UPDATE public.transactions SET status = 'disbursed' WHERE id = v_tx.id;
        ELSIF lower(v_tx.status) IN ('failed', 'reversed') THEN
            -- Paystack says it was paid but we already refunded: needs manual review
            UPDATE public.transactions
               SET description = COALESCE(description, '') || ' | REVIEW: paid after refund'
             WHERE id = v_tx.id;
            RETURN jsonb_build_object('success', false, 'error', 'paid_after_refund_review');
        END IF;
        RETURN jsonb_build_object('success', true, 'status', 'disbursed');
    END IF;

    IF p_outcome = 'failed' THEN
        IF lower(v_tx.status) IN ('pending', 'disbursed') THEN
            PERFORM 1 FROM public.profiles WHERE id = v_tx.user_id FOR UPDATE;
            UPDATE public.profiles
               SET withdrawable_balance = withdrawable_balance + v_tx.amount,
                   total_withdrawn_lifetime = GREATEST(0, total_withdrawn_lifetime - v_tx.amount)
             WHERE id = v_tx.user_id;
            UPDATE public.transactions
               SET status = CASE WHEN lower(v_tx.status) = 'disbursed' THEN 'reversed' ELSE 'failed' END,
                   description = 'Transfer failed - amount returned to wallet'
             WHERE id = v_tx.id;
        END IF;
        RETURN jsonb_build_object('success', true, 'status', 'refunded');
    END IF;

    RAISE EXCEPTION 'invalid_outcome';
END;
$$;

-- 5e. Admin-only: approve a task proof and pay the reward (run from SQL editor
--     or the service role). Idempotent per completion.
CREATE OR REPLACE FUNCTION public.approve_task_completion(p_completion_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_task public.task_completions%ROWTYPE;
BEGIN
    SELECT * INTO v_task FROM public.task_completions WHERE id = p_completion_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'completion_not_found'; END IF;
    IF lower(v_task.status) <> 'pending' THEN
        RETURN jsonb_build_object('success', true, 'duplicate', true);
    END IF;

    PERFORM 1 FROM public.profiles WHERE id = v_task.user_id FOR UPDATE;

    INSERT INTO public.transactions (user_id, type, amount, status, reference, title, description)
    VALUES (v_task.user_id, 'task_payout', v_task.reward_amount, 'settled',
            'task_' || v_task.id::text, 'Task Reward: ' || v_task.task_title, v_task.company);

    UPDATE public.profiles
       SET withdrawable_balance = withdrawable_balance + v_task.reward_amount
     WHERE id = v_task.user_id;
    UPDATE public.task_completions SET status = 'approved' WHERE id = v_task.id;

    RETURN jsonb_build_object('success', true, 'credited', v_task.reward_amount);
END;
$$;

-- -------------------------------------------------------------------------
-- 6. USER-CALLABLE FUNCTIONS (identity comes from auth.uid(), never a parameter)
-- -------------------------------------------------------------------------

-- 6a. Buy a HIGHER tier from the wallet balance.
CREATE OR REPLACE FUNCTION public.upgrade_tier_from_wallet(p_tier_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_profile public.profiles%ROWTYPE;
    v_cur public.tiers%ROWTYPE;
    v_new public.tiers%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

    SELECT * INTO v_profile FROM public.profiles WHERE id = v_uid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;
    IF NOT v_profile.is_activated THEN RAISE EXCEPTION 'not_activated'; END IF;

    SELECT * INTO v_cur FROM public.tiers WHERE id = v_profile.tier_id;
    SELECT * INTO v_new FROM public.tiers WHERE id = p_tier_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid_tier'; END IF;
    IF v_new.rank <= v_cur.rank THEN RAISE EXCEPTION 'not_an_upgrade'; END IF;
    IF v_profile.withdrawable_balance < v_new.stake_amount THEN
        RAISE EXCEPTION 'insufficient_balance';
    END IF;

    INSERT INTO public.transactions (user_id, type, amount, status, reference, title, description)
    VALUES (
        v_uid, 'tier_upgrade', v_new.stake_amount, 'settled',
        'tier_' || v_uid::text || '_' || v_new.id,
        'Tier Upgraded to ' || v_new.name,
        'Withdrawal cap expanded to N' || v_new.withdrawal_cap
    );

    UPDATE public.profiles
       SET withdrawable_balance = withdrawable_balance - v_new.stake_amount,
           tier_id = v_new.id,
           has_upgraded_after_limit = TRUE
     WHERE id = v_uid;

    RETURN jsonb_build_object(
        'success', true, 'tier_id', v_new.id,
        'new_balance', v_profile.withdrawable_balance - v_new.stake_amount
    );
END;
$$;

-- 6b. Claim the daily login reward (N100, once per Lagos calendar day).
CREATE OR REPLACE FUNCTION public.claim_daily_reward()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_profile public.profiles%ROWTYPE;
    v_today DATE := (NOW() AT TIME ZONE 'Africa/Lagos')::date;
    v_streak INT;
    v_reward CONSTANT NUMERIC := 100;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

    SELECT * INTO v_profile FROM public.profiles WHERE id = v_uid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;
    IF NOT v_profile.is_activated THEN RAISE EXCEPTION 'not_activated'; END IF;
    IF v_profile.streak_last_claimed_date = v_today THEN RAISE EXCEPTION 'already_claimed'; END IF;

    v_streak := CASE
        WHEN v_profile.streak_last_claimed_date = v_today - 1 THEN (v_profile.streak_days % 7) + 1
        ELSE 1
    END;

    INSERT INTO public.transactions (user_id, type, amount, status, reference, title, description)
    VALUES (
        v_uid, 'streak_reward', v_reward, 'settled',
        'streak_' || v_uid::text || '_' || v_today::text || '_' || substr(md5(random()::text), 1, 8),
        'Daily Login Reward', 'Day ' || v_streak || ' of your login streak'
    );

    UPDATE public.profiles
       SET withdrawable_balance = withdrawable_balance + v_reward,
           streak_days = v_streak,
           streak_last_claimed_date = v_today
     WHERE id = v_uid;

    RETURN jsonb_build_object(
        'success', true, 'streak_days', v_streak,
        'new_balance', v_profile.withdrawable_balance + v_reward
    );
END;
$$;

-- 6c. Record that the user submitted ID details. Only the LAST 4 characters are
--     stored. Full BVN/NIN must go to a licensed KYC provider, never our DB.
--     Status becomes 'pending'; an admin (or provider webhook) sets 'verified'.
CREATE OR REPLACE FUNCTION public.submit_kyc(p_id_type TEXT, p_last4 TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_uid UUID := auth.uid();
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
    IF p_id_type NOT IN ('bvn', 'nin', 'voters_card', 'drivers_license') THEN
        RAISE EXCEPTION 'invalid_id_type';
    END IF;
    IF p_last4 !~ '^[A-Za-z0-9]{4}$' THEN RAISE EXCEPTION 'invalid_id_number'; END IF;

    UPDATE public.profiles
       SET kyc_status = 'pending', kyc_id_type = p_id_type,
           kyc_id_last4 = upper(p_last4), kyc_submitted_at = NOW()
     WHERE id = v_uid AND kyc_status IN ('unverified', 'rejected');

    RETURN jsonb_build_object('success', true, 'kyc_status', 'pending');
END;
$$;

-- -------------------------------------------------------------------------
-- 7. FUNCTION PERMISSIONS (Postgres grants EXECUTE to PUBLIC by default!)
-- -------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.create_pending_deposit(UUID, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_deposit(TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_cashout(UUID, NUMERIC, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_cashout(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_task_completion(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_pending_deposit(UUID, TEXT, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_deposit(TEXT, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_cashout(UUID, NUMERIC, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_cashout(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_task_completion(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.upgrade_tier_from_wallet(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_daily_reward() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_kyc(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upgrade_tier_from_wallet(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_daily_reward() TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_kyc(TEXT, TEXT) TO authenticated;

-- -------------------------------------------------------------------------
-- 8. STORAGE: private bucket, own-folder uploads only, images <= 5 MB
-- -------------------------------------------------------------------------
UPDATE storage.buckets
   SET public = FALSE,
       file_size_limit = 5242880,
       allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
 WHERE id = 'taskpulse-proofs';

DROP POLICY IF EXISTS "Authenticated users upload task proofs" ON storage.objects;
DROP POLICY IF EXISTS "Public read task proofs" ON storage.objects;
DROP POLICY IF EXISTS "Users upload own proofs" ON storage.objects;
DROP POLICY IF EXISTS "Users read own proofs" ON storage.objects;

CREATE POLICY "Users upload own proofs"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'taskpulse-proofs' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users read own proofs"
    ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'taskpulse-proofs' AND (storage.foldername(name))[1] = auth.uid()::text);

-- -------------------------------------------------------------------------
-- 9. RELATIONAL TASKS CATALOG (Dynamic database-driven micro-tasks)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tasks (
    id VARCHAR(50) PRIMARY KEY,
    title VARCHAR(150) NOT NULL,
    company VARCHAR(100) NOT NULL,
    reward NUMERIC(14,2) NOT NULL CHECK (reward > 0.00),
    category VARCHAR(50) NOT NULL DEFAULT 'Social',
    time_estimate VARCHAR(30) NOT NULL DEFAULT '2m',
    sla VARCHAR(50) NOT NULL DEFAULT 'Instant SLA Approval',
    spots_left INT NOT NULL DEFAULT 100 CHECK (spots_left >= 0),
    spots_total INT NOT NULL DEFAULT 100 CHECK (spots_total >= spots_left),
    description TEXT NOT NULL,
    steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    platform_icon VARCHAR(50) DEFAULT '🎵',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed production micro-tasks
INSERT INTO public.tasks (
    id, title, company, reward, category, time_estimate, sla, spots_left, spots_total, description, steps, platform_icon, is_active
) VALUES (
    't-soc-1',
    'Follow & Like Brand Announcement on TikTok',
    'Kuda FinTech Media',
    450.00,
    'Social',
    '2m',
    'Instant SLA Approval',
    34,
    150,
    'Follow @kudabank on TikTok, like their latest pinned video, and submit your TikTok username or profile screenshot for instant escrow settlement.',
    '["Open TikTok and navigate to official @kudabank profile.", "Tap Follow and Like the first pinned video regarding virtual card upgrades.", "Upload a screenshot or input your TikTok username to verify."]'::jsonb,
    '🎵',
    TRUE
) ON CONFLICT (id) DO UPDATE SET
    reward = EXCLUDED.reward,
    title = EXCLUDED.title,
    description = EXCLUDED.description;

GRANT SELECT ON public.tasks TO anon, authenticated;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read active tasks" ON public.tasks;
CREATE POLICY "Public read active tasks"
    ON public.tasks FOR SELECT
    USING (is_active = TRUE);


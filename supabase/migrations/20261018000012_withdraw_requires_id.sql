-- =========================================================================
-- TASKPULSE 012 - A VERIFIED ID IS REQUIRED BEFORE WITHDRAWING
-- =========================================================================
-- Run ONCE in the Supabase SQL Editor AFTER 010 (or via `supabase db push`,
-- which uses the identical copy in
-- supabase/migrations/20261018000012_withdraw_requires_id.sql). Do not run
-- both. Safe to re-run; runs in a single transaction (all or nothing).
--
-- Does NOT depend on 011 (fast approvals). Apply 012 BEFORE 011 is merged
-- and applied. 011 does not redefine request_cashout(), so applying 011
-- afterwards keeps this check.
--
-- WHY
--   Withdrawals did not check identity, so a fake account could earn and
--   cash out. profiles.kyc_status (added in 002: unverified | pending |
--   verified | rejected) already exists; this makes 'verified' required.
--
-- WHAT CHANGES
--   1. request_cashout() raises 'identity_not_verified' unless the user's
--      profiles.kyc_status = 'verified'. This is the function that locks the
--      balance and creates the 'cashout' transaction row, so no money moves
--      and no row is created for an unverified user. The rest of the body is
--      identical to 008 (same signature, same grants: service_role only).
--   2. Nothing else. No balance, transaction or profile row is touched.
--
-- HOW A USER BECOMES VERIFIED (unchanged, manual today)
--   The app's "Verify identity" sheet calls submit_kyc(), which only sets
--   kyc_status = 'pending' (ID type + last 4 digits). Nothing in the app,
--   API or SQL sets 'verified'. An admin must do it in the SQL Editor:
--     -- who is waiting
--     SELECT id, username, kyc_id_type, kyc_id_last4, kyc_submitted_at
--       FROM public.profiles WHERE kyc_status = 'pending' ORDER BY kyc_submitted_at;
--     -- approve / reject one
--     UPDATE public.profiles SET kyc_status = 'verified' WHERE id = '<user uuid>';
--     UPDATE public.profiles SET kyc_status = 'rejected' WHERE id = '<user uuid>';
-- =========================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- 1. CASHOUT RULES (008) + verified identity
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

    -- 012: identity must be verified before any money is locked. Checked
    -- after the replay above so an already-created withdrawal still answers
    -- its retry, and before every other rule so the user sees this first.
    IF COALESCE(v_profile.kyc_status, 'unverified') <> 'verified' THEN
        RAISE EXCEPTION 'identity_not_verified';
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
-- 2. GRANTS (unchanged from 008: server / service_role only)
-- -------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.request_cashout(UUID, NUMERIC, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_cashout(UUID, NUMERIC, UUID, TEXT) TO service_role;

COMMIT;

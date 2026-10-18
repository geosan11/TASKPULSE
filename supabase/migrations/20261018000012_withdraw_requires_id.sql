-- =========================================================================
-- TASKPULSE 012 - VERIFIED IDENTITY (VIA BANK ACCOUNT NAME) BEFORE WITHDRAWING
-- =========================================================================
-- Run ONCE in the Supabase SQL Editor AFTER 010 (or via `supabase db push`,
-- which uses the identical copy in
-- supabase/migrations/20261018000012_withdraw_requires_id.sql). Do not run
-- both. Safe to re-run; runs in a single transaction (all or nothing).
--
-- Does NOT depend on 011 (fast approvals). Apply 012 BEFORE 011 is merged
-- and applied. 011 does not redefine any function or table touched here, so
-- applying 011 afterwards keeps everything below.
--
-- WHY
--   Withdrawals did not check identity, so a fake account could earn and
--   cash out. profiles.kyc_status (002: unverified | pending | verified |
--   rejected) now has to be 'verified', and the free way to get there is the
--   bank account: the server resolves the NUBAN's account name with Paystack
--   and compares it with the profile name (api/link-bank.ts).
--
-- WHAT CHANGES
--   1. request_cashout() raises 'identity_not_verified' unless
--      kyc_status = 'verified' (before any money is locked or a row created).
--      Rest of the body identical to 008; still service_role only.
--   2. bank_accounts: name_resolved_at (when the server last resolved the
--      account name with Paystack) and duplicate_of (see 3).
--   3. One bank account (bank_code + account_number) belongs to ONE user:
--      unique index uq_bank_accounts_owner. Existing duplicates do NOT make
--      this migration fail: in each shared group the earliest-linked row
--      (active rows first) is kept; every later row from another user is
--      deactivated and marked duplicate_of = <kept row>, which takes it out of
--      the unique index. Every user in a shared group (kept row too) is set
--      to 'pending' with an open review (reason 'shared_bank_account').
--      Nothing is deleted. The NOTICE output says how many were found.
--   4. identity_reviews: the admin review queue (server/service_role only).
--   5. record_bank_identity_check(): server-only. Stores the resolved name
--      on the bank row and sets kyc_status: 'verified' on a name match,
--      otherwise 'pending' + an open review with both names. A 'rejected'
--      user stays rejected; a user in a shared-account review stays pending.
--   6. list_identity_reviews() / decide_identity_review() /
--      list_identity_backfill_candidates(): server-only, used by
--      api/admin-identity.ts (admins = profiles.role 'admin').
--   7. save_verified_bank_account(): also refuses an account that another
--      user holds even if that row is inactive (unique index backs it up).
--   8. submit_kyc() (the optional ID-type form) keeps the ID type + last 4
--      but no longer sets 'pending': nobody reviews that form, and 'pending'
--      now means "in the admin queue". Users left 'pending' by the old form
--      with no open review go back to 'unverified' (they verify by bank).
-- No balance or transaction row is touched.
--
-- MANUAL REVIEW (also in the app for admins: Profile > Review accounts)
--   SELECT * FROM public.list_identity_reviews(100);
--   SELECT public.decide_identity_review('<review id>', true,  '<admin uuid>', 'ok');
--   SELECT public.decide_identity_review('<review id>', false, '<admin uuid>', 'names differ');
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
-- 2. BANK ACCOUNTS: resolved name timestamp, one owner per account
-- -------------------------------------------------------------------------
ALTER TABLE public.bank_accounts ADD COLUMN IF NOT EXISTS name_resolved_at TIMESTAMPTZ;
ALTER TABLE public.bank_accounts ADD COLUMN IF NOT EXISTS duplicate_of UUID;

-- -------------------------------------------------------------------------
-- 3. IDENTITY REVIEW QUEUE (server-only)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.identity_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    bank_account_id UUID,
    reason TEXT NOT NULL CHECK (reason IN ('name_mismatch', 'no_profile_name', 'shared_bank_account')),
    source TEXT NOT NULL DEFAULT 'bank_link' CHECK (source IN ('bank_link', 'backfill', 'migration')),
    profile_name TEXT,
    bank_account_name TEXT,
    bank_name TEXT,
    bank_code TEXT,
    account_last4 TEXT,
    match_detail JSONB,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'rejected', 'superseded')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at TIMESTAMPTZ,
    decided_by UUID,
    decision_note TEXT
);
-- one open item per user; newer checks update it
CREATE UNIQUE INDEX IF NOT EXISTS uq_identity_reviews_open_user
    ON public.identity_reviews(user_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_identity_reviews_status ON public.identity_reviews(status, created_at);
ALTER TABLE public.identity_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.identity_reviews FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.identity_reviews TO service_role;

-- Queue (or refresh) the open review for a user. Internal helper.
CREATE OR REPLACE FUNCTION public._queue_identity_review(
    p_user_id UUID, p_bank_account_id UUID, p_reason TEXT, p_source TEXT,
    p_profile_name TEXT, p_bank_account_name TEXT, p_detail JSONB
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_bank public.bank_accounts%ROWTYPE;
    v_id UUID;
BEGIN
    SELECT * INTO v_bank FROM public.bank_accounts WHERE id = p_bank_account_id;
    INSERT INTO public.identity_reviews AS r (
        user_id, bank_account_id, reason, source, profile_name, bank_account_name,
        bank_name, bank_code, account_last4, match_detail
    ) VALUES (
        p_user_id, p_bank_account_id, p_reason, p_source, left(p_profile_name, 200), left(p_bank_account_name, 200),
        v_bank.bank_name, v_bank.bank_code, right(v_bank.account_number, 4), p_detail
    )
    ON CONFLICT (user_id) WHERE status = 'open' DO UPDATE SET
        -- a shared-account flag is never downgraded by a later name check
        reason = CASE WHEN r.reason = 'shared_bank_account' THEN r.reason ELSE EXCLUDED.reason END,
        bank_account_id = EXCLUDED.bank_account_id,
        source = EXCLUDED.source,
        profile_name = EXCLUDED.profile_name,
        bank_account_name = COALESCE(EXCLUDED.bank_account_name, r.bank_account_name),
        bank_name = EXCLUDED.bank_name,
        bank_code = EXCLUDED.bank_code,
        account_last4 = EXCLUDED.account_last4,
        match_detail = COALESCE(EXCLUDED.match_detail, r.match_detail),
        updated_at = NOW()
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

-- -------------------------------------------------------------------------
-- 4. EXISTING SHARED BANK ACCOUNTS (do not fail; flag and keep the earliest)
-- -------------------------------------------------------------------------
DO $$
DECLARE
    v_groups INT;
    v_rows INT;
    r RECORD;
BEGIN
    SELECT COUNT(*) INTO v_groups FROM (
        SELECT 1 FROM public.bank_accounts WHERE duplicate_of IS NULL
         GROUP BY bank_code, account_number HAVING COUNT(DISTINCT user_id) > 1
    ) g;

    IF v_groups > 0 THEN
        -- every user in a shared group goes to review (kept row included)
        FOR r IN
            SELECT b.id, b.user_id, b.account_name, p.full_name
              FROM public.bank_accounts b
              JOIN public.profiles p ON p.id = b.user_id
             WHERE b.duplicate_of IS NULL
               AND (b.bank_code, b.account_number) IN (
                    SELECT bank_code, account_number FROM public.bank_accounts
                     WHERE duplicate_of IS NULL
                     GROUP BY bank_code, account_number HAVING COUNT(DISTINCT user_id) > 1)
        LOOP
            PERFORM public._queue_identity_review(r.user_id, r.id, 'shared_bank_account', 'migration',
                                                  r.full_name, r.account_name, NULL);
            UPDATE public.profiles SET kyc_status = 'pending'
             WHERE id = r.user_id AND kyc_status <> 'rejected';
        END LOOP;

        WITH ranked AS (
            SELECT id,
                   first_value(id) OVER (PARTITION BY bank_code, account_number
                                         ORDER BY is_active DESC, created_at, id) AS keeper
              FROM public.bank_accounts
             WHERE duplicate_of IS NULL
        )
        UPDATE public.bank_accounts b
           SET duplicate_of = ranked.keeper, is_active = FALSE, updated_at = NOW()
          FROM ranked
         WHERE b.id = ranked.id AND ranked.keeper <> b.id;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        RAISE NOTICE '012: % bank account(s) were shared by more than one user; % later row(s) deactivated and marked duplicate_of; those users are pending review.', v_groups, v_rows;
    ELSE
        RAISE NOTICE '012: no bank account is shared by more than one user.';
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_accounts_owner
    ON public.bank_accounts(bank_code, account_number) WHERE duplicate_of IS NULL;

-- -------------------------------------------------------------------------
-- 5. SAVE BANK ACCOUNT (008 + also refuses an inactive row of another user)
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

    -- 012: any row of another user that still owns this account (active or not)
    IF EXISTS (SELECT 1 FROM public.bank_accounts
                WHERE bank_code = p_bank_code AND account_number = p_account_number
                  AND user_id <> p_user_id AND duplicate_of IS NULL) THEN
        RAISE EXCEPTION 'bank_linked_to_other_user';
    END IF;
    -- 012: this user's own row was marked as a duplicate of someone else's
    IF EXISTS (SELECT 1 FROM public.bank_accounts
                WHERE bank_code = p_bank_code AND account_number = p_account_number
                  AND user_id = p_user_id AND duplicate_of IS NOT NULL) THEN
        RAISE EXCEPTION 'bank_linked_to_other_user';
    END IF;

    INSERT INTO public.bank_accounts (
        user_id, bank_code, bank_name, account_number, account_name, recipient_code, is_active, name_resolved_at
    ) VALUES (
        p_user_id, p_bank_code, p_bank_name, p_account_number, p_account_name, p_recipient_code, TRUE, NOW()
    )
    ON CONFLICT (user_id, bank_code, account_number) DO UPDATE SET
        account_name = EXCLUDED.account_name,
        recipient_code = EXCLUDED.recipient_code,
        bank_name = EXCLUDED.bank_name,
        is_active = TRUE,
        name_resolved_at = NOW(),
        updated_at = NOW()
    RETURNING * INTO v_account;

    RETURN to_jsonb(v_account);
EXCEPTION WHEN unique_violation THEN
    -- uq_bank_accounts_owner: another user linked it at the same moment
    RAISE EXCEPTION 'bank_linked_to_other_user';
END;
$$;

-- -------------------------------------------------------------------------
-- 6. RECORD THE BANK-NAME CHECK (server computes the match; DB applies it)
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_bank_identity_check(
    p_user_id UUID,
    p_bank_account_id UUID,
    p_bank_account_name TEXT,
    p_profile_name TEXT,
    p_matched BOOLEAN,
    p_reason TEXT,
    p_detail JSONB DEFAULT NULL,
    p_source TEXT DEFAULT 'bank_link'
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_profile public.profiles%ROWTYPE;
    v_bank public.bank_accounts%ROWTYPE;
    v_review UUID;
BEGIN
    SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;
    SELECT * INTO v_bank FROM public.bank_accounts
     WHERE id = p_bank_account_id AND user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'bank_not_found'; END IF;
    IF p_source NOT IN ('bank_link', 'backfill') THEN RAISE EXCEPTION 'invalid_source'; END IF;

    IF NULLIF(trim(COALESCE(p_bank_account_name, '')), '') IS NOT NULL THEN
        UPDATE public.bank_accounts
           SET account_name = left(trim(p_bank_account_name), 100), name_resolved_at = NOW(), updated_at = NOW()
         WHERE id = v_bank.id;
    END IF;

    -- an admin rejection stands until an admin changes it
    IF v_profile.kyc_status = 'rejected' THEN
        RETURN jsonb_build_object('kyc_status', 'rejected', 'queued', false);
    END IF;

    IF p_matched AND v_bank.duplicate_of IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.identity_reviews
                        WHERE user_id = p_user_id AND status = 'open' AND reason = 'shared_bank_account') THEN
        UPDATE public.profiles
           SET kyc_status = 'verified', kyc_id_type = 'bank_account',
               kyc_id_last4 = right(v_bank.account_number, 4), kyc_submitted_at = NOW()
         WHERE id = p_user_id;
        UPDATE public.identity_reviews
           SET status = 'superseded', decided_at = NOW(), updated_at = NOW(),
               decision_note = 'Bank account name matched automatically'
         WHERE user_id = p_user_id AND status = 'open';
        RETURN jsonb_build_object('kyc_status', 'verified', 'queued', false);
    END IF;

    v_review := public._queue_identity_review(
        p_user_id, v_bank.id,
        CASE WHEN p_reason IN ('name_mismatch', 'no_profile_name') THEN p_reason ELSE 'name_mismatch' END,
        p_source, p_profile_name, p_bank_account_name, p_detail);
    UPDATE public.profiles
       SET kyc_status = 'pending', kyc_id_type = 'bank_account',
           kyc_id_last4 = right(v_bank.account_number, 4), kyc_submitted_at = NOW()
     WHERE id = p_user_id;
    RETURN jsonb_build_object('kyc_status', 'pending', 'queued', true, 'review_id', v_review);
END;
$$;

-- -------------------------------------------------------------------------
-- 7. ADMIN REVIEW (called by api/admin-identity.ts after it checks the admin)
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_identity_reviews(p_limit INT DEFAULT 100)
RETURNS TABLE (
    review_id UUID, user_id UUID, username TEXT, profile_name TEXT, current_profile_name TEXT,
    bank_account_name TEXT, bank_name TEXT, account_masked TEXT, reason TEXT, source TEXT,
    kyc_status TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT r.id, r.user_id, p.username::text, r.profile_name, p.full_name::text,
           r.bank_account_name, r.bank_name, '******' || COALESCE(r.account_last4, '????'),
           r.reason, r.source, p.kyc_status, r.created_at, r.updated_at
      FROM public.identity_reviews r
      JOIN public.profiles p ON p.id = r.user_id
     WHERE r.status = 'open'
     ORDER BY r.created_at
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
$$;

CREATE OR REPLACE FUNCTION public.decide_identity_review(
    p_review_id UUID, p_approve BOOLEAN, p_admin UUID, p_note TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_review public.identity_reviews%ROWTYPE;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_admin AND role = 'admin') THEN
        RAISE EXCEPTION 'admin_required';
    END IF;
    SELECT * INTO v_review FROM public.identity_reviews WHERE id = p_review_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'review_not_found'; END IF;
    IF v_review.status <> 'open' THEN
        RETURN jsonb_build_object('success', true, 'duplicate', true, 'status', v_review.status);
    END IF;
    PERFORM 1 FROM public.profiles WHERE id = v_review.user_id FOR UPDATE;

    UPDATE public.identity_reviews
       SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
           decided_at = NOW(), decided_by = p_admin, decision_note = left(p_note, 500), updated_at = NOW()
     WHERE id = v_review.id;
    UPDATE public.profiles
       SET kyc_status = CASE WHEN p_approve THEN 'verified' ELSE 'rejected' END
     WHERE id = v_review.user_id;
    RETURN jsonb_build_object('success', true, 'duplicate', false,
                              'status', CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
                              'user_id', v_review.user_id);
END;
$$;

-- Backfill: users with a saved bank account who are not verified yet
-- (unverified or pending; rejected users are left to admins). Keyset paged.
CREATE OR REPLACE FUNCTION public.list_identity_backfill_candidates(p_after UUID DEFAULT NULL, p_limit INT DEFAULT 20)
RETURNS TABLE (bank_account_id UUID, user_id UUID, bank_code TEXT, account_number TEXT,
               account_name TEXT, full_name TEXT, kyc_status TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT b.id, b.user_id, b.bank_code::text, b.account_number::text, b.account_name::text,
           p.full_name::text, p.kyc_status
      FROM public.bank_accounts b
      JOIN public.profiles p ON p.id = b.user_id
     WHERE b.is_active AND b.duplicate_of IS NULL
       AND p.kyc_status IN ('unverified', 'pending')
       AND (p_after IS NULL OR b.id > p_after)
     ORDER BY b.id
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
$$;

-- -------------------------------------------------------------------------
-- 8. OPTIONAL ID FORM: keep the details, do not park the user in 'pending'
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_kyc(p_id_type TEXT, p_last4 TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_status TEXT;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
    IF p_id_type NOT IN ('bvn', 'nin', 'voters_card', 'drivers_license') THEN
        RAISE EXCEPTION 'invalid_id_type';
    END IF;
    IF p_last4 !~ '^[A-Za-z0-9]{4}$' THEN RAISE EXCEPTION 'invalid_id_number'; END IF;

    -- Only fills the ID details; a bank-account check (kyc_id_type
    -- 'bank_account') is never overwritten and the status never changes here.
    UPDATE public.profiles
       SET kyc_id_type = p_id_type, kyc_id_last4 = upper(p_last4), kyc_submitted_at = NOW()
     WHERE id = v_uid AND COALESCE(kyc_id_type, '') <> 'bank_account'
    RETURNING kyc_status INTO v_status;

    RETURN jsonb_build_object('success', true,
        'kyc_status', COALESCE(v_status, (SELECT kyc_status FROM public.profiles WHERE id = v_uid)));
END;
$$;

-- Users parked in 'pending' by the old ID form (no open review) can verify by bank.
UPDATE public.profiles p
   SET kyc_status = 'unverified'
 WHERE p.kyc_status = 'pending'
   AND NOT EXISTS (SELECT 1 FROM public.identity_reviews r WHERE r.user_id = p.id AND r.status = 'open');

-- -------------------------------------------------------------------------
-- 9. GRANTS
-- -------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.request_cashout(UUID, NUMERIC, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_cashout(UUID, NUMERIC, UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.save_verified_bank_account(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_verified_bank_account(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public._queue_identity_review(UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._queue_identity_review(UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.record_bank_identity_check(UUID, UUID, TEXT, TEXT, BOOLEAN, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_bank_identity_check(UUID, UUID, TEXT, TEXT, BOOLEAN, TEXT, JSONB, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.list_identity_reviews(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_identity_reviews(INT) TO service_role;
REVOKE ALL ON FUNCTION public.list_identity_backfill_candidates(UUID, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_identity_backfill_candidates(UUID, INT) TO service_role;
REVOKE ALL ON FUNCTION public.decide_identity_review(UUID, BOOLEAN, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decide_identity_review(UUID, BOOLEAN, UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.submit_kyc(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_kyc(TEXT, TEXT) TO authenticated;

COMMIT;

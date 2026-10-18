-- =========================================================================
-- TASKPULSE 014 - ADMIN MONEY DASHBOARD (read-only reporting RPCs)
-- =========================================================================
-- Run ONCE in the Supabase SQL Editor AFTER 013 (or via `supabase db push`,
-- which uses the identical copy in
-- supabase/migrations/20261018000014_admin_dashboard.sql). Do not run both.
-- Safe to re-run; runs in a single transaction (all or nothing).
--
-- WHAT IT ADDS
--   * public.admin_excluded_accounts: test/staff accounts left out of every
--     dashboard figure. Add one with
--       INSERT INTO public.admin_excluded_accounts (user_id, note)
--       VALUES ('<uuid>', 'why') ON CONFLICT DO NOTHING;
--   * Read-only RPCs for Profile > Money (admins only):
--       admin_money_summary()                      overview cards + books check
--       admin_money_entries(kind, filter, limit, offset)  card drill-downs
--       admin_business_list(search, limit, offset) / admin_business_detail(id)
--       admin_worker_list(search, limit, offset)   / admin_worker_detail(id)
--     Every one is STABLE (it cannot write), SECURITY DEFINER, checks
--     profiles.role = 'admin' for the caller and raises SQLSTATE 42501
--     otherwise. EXECUTE is revoked from PUBLIC and anon.
--     With no JWT at all (SQL editor / psql as the owner) they also answer,
--     like the 009 admin tools.
--
-- WHAT IT DOES NOT DO
--   * No existing table, column, function, trigger or policy is changed.
--     Nothing from 008-013 is redefined. No balance or row is written except
--     the admin_excluded_accounts seed row.
--
-- HOW THE MONEY IS COUNTED (all from existing rows, nothing estimated)
--   deposited       = campaign_payments.paid_amount of every confirmed
--                     Paystack checkout (status <> 'pending')
--   spent on workers= campaign_ledger 'payout' - 'payout_reversal'
--   fees earned     = per funded campaign: platform_fee x slots_approved /
--                     slots (the fee on APPROVED spots only), capped at the
--                     fee still kept (platform_fee - fee_refund_due)
--   other fee kept  = closed campaigns only: kept fee - fees earned
--                     (sub-Naira rounding, or unused-spot fee when
--                     refund_fee_on_unused is switched off)
--   unearned fee    = live campaigns: kept fee - fees earned (business money)
--   refunds         = campaigns.refund_due + unapplied checkouts (underpaid /
--                     duplicate); paid = campaigns.refunded_amount +
--                     campaign_payments.refunded_amount; owed = the rest
--   held for businesses = deposited - spent on workers - fees earned
--                     - other fee kept - refunds paid
--   books check     : held must equal escrow + unearned fee + refunds owed
-- =========================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- 1. EXCLUDED (TEST) ACCOUNTS
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_excluded_accounts (
    user_id UUID PRIMARY KEY,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.admin_excluded_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_excluded_accounts FROM PUBLIC, anon, authenticated;

INSERT INTO public.admin_excluded_accounts (user_id, note) VALUES
    ('9960b327-0b02-4862-91a7-f2b9fd8e9afe', 'test account prbtest9381 (geoflashsanni+tputm9381@gmail.com)')
ON CONFLICT (user_id) DO NOTHING;

-- -------------------------------------------------------------------------
-- 2. INTERNAL HELPERS (no client role can call these)
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._admin_dash_guard()
RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    -- No JWT at all = SQL editor / psql as the owner (same rule as 009).
    IF auth.uid() IS NULL AND auth.role() IS NULL THEN RETURN; END IF;
    IF auth.uid() IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
    ) THEN
        RAISE EXCEPTION 'admin_required' USING ERRCODE = '42501';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._admin_dash_excluded(p_user UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM public.admin_excluded_accounts x WHERE x.user_id = p_user);
$$;

-- Per funded campaign money, business test accounts left out.
CREATE OR REPLACE FUNCTION public._admin_dash_campaigns()
RETURNS TABLE (
    campaign_id UUID, business_id UUID, title TEXT, status TEXT, slots INT,
    slots_approved INT, slots_pending INT, reward NUMERIC, funded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ, platform_fee NUMERIC, kept_fee NUMERIC, fee_earned NUMERIC,
    finalized BOOLEAN, fee_other_kept NUMERIC, fee_unearned NUMERIC, payouts_net NUMERIC,
    escrow NUMERIC, refund_due NUMERIC, refunded NUMERIC, refund_owed NUMERIC,
    spots_left INT, spots_total INT
)
LANGUAGE sql STABLE SET search_path = public AS $$
    WITH base AS (
        SELECT c.*,
               (c.platform_fee - c.fee_refund_due) AS kept,
               LEAST(c.platform_fee - c.fee_refund_due,
                     round(c.platform_fee * c.slots_approved / NULLIF(c.slots, 0), 2)) AS earned,
               (c.status IN ('completed', 'cancelled') AND c.slots_pending = 0) AS fin,
               COALESCE((SELECT SUM(l.amount) FROM public.campaign_ledger l
                          WHERE l.campaign_id = c.id AND l.entry_type = 'payout'), 0)
             - COALESCE((SELECT SUM(l.amount) FROM public.campaign_ledger l
                          WHERE l.campaign_id = c.id AND l.entry_type = 'payout_reversal'), 0) AS po
          FROM public.campaigns c
         WHERE c.funded_at IS NOT NULL
           AND NOT public._admin_dash_excluded(c.business_id)
    )
    SELECT b.id, b.business_id, b.title::TEXT, b.status::TEXT, b.slots, b.slots_approved,
           b.slots_pending, b.reward_per_completion, b.funded_at, b.created_at, b.platform_fee,
           b.kept, b.earned, b.fin,
           CASE WHEN b.fin THEN b.kept - b.earned ELSE 0 END,
           CASE WHEN b.fin THEN 0 ELSE b.kept - b.earned END,
           b.po, b.escrow_balance, b.refund_due, b.refunded_amount, b.refund_due - b.refunded_amount,
           t.spots_left, t.spots_total
      FROM base b
      LEFT JOIN public.tasks t ON t.id = b.task_id;
$$;

-- Confirmed checkouts per business (deposits and unapplied payments).
CREATE OR REPLACE FUNCTION public._admin_dash_payments()
RETURNS TABLE (business_id UUID, deposited NUMERIC, unapplied NUMERIC, unapplied_refunded NUMERIC,
               deposits INT, first_at TIMESTAMPTZ, last_at TIMESTAMPTZ)
LANGUAGE sql STABLE SET search_path = public AS $$
    SELECT cp.business_id,
           COALESCE(SUM(COALESCE(cp.paid_amount, 0)), 0),
           COALESCE(SUM(COALESCE(cp.paid_amount, 0)) FILTER (
               WHERE cp.status IN ('underpaid', 'duplicate_needs_refund', 'refunded')), 0),
           COALESCE(SUM(cp.refunded_amount) FILTER (
               WHERE cp.status IN ('underpaid', 'duplicate_needs_refund', 'refunded')), 0),
           COUNT(*)::INT,
           MIN(COALESCE(cp.settled_at, cp.created_at)),
           MAX(COALESCE(cp.settled_at, cp.created_at))
      FROM public.campaign_payments cp
     WHERE cp.status <> 'pending'
       AND NOT public._admin_dash_excluded(cp.business_id)
     GROUP BY cp.business_id;
$$;

-- What kind of extra (non-task) credit a wallet transaction is; NULL = not one.
CREATE OR REPLACE FUNCTION public._admin_dash_extra_kind(p_type TEXT, p_reference TEXT, p_metadata JSONB)
RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN lower(p_type) = 'referral_bonus' AND p_reference LIKE 'refb_ee_%' THEN 'welcome_bonus'
        WHEN lower(p_type) = 'referral_bonus' THEN 'referral_bonus'
        WHEN lower(p_type) IN ('deposit_match', 'match') THEN 'legacy_referral_commission'
        WHEN lower(p_type) IN ('streak_reward', 'streakreward') THEN 'legacy_daily_reward'
        WHEN lower(p_type) IN ('task_payout', 'taskpayout')
             AND NULLIF(COALESCE(p_metadata, '{}'::jsonb)->>'campaign_id', '') IS NULL THEN 'platform_task_reward'
        ELSE NULL END;
$$;

-- Sign-up source bucket: UTM tags first, then the "heard about us" answer.
CREATE OR REPLACE FUNCTION public._admin_dash_signup_bucket(p_meta JSONB, p_heard TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
    WITH v AS (
        SELECT NULLIF(lower(trim(COALESCE(p_meta, '{}'::jsonb)->>'signup_source')), '') AS src,
               NULLIF(lower(trim(COALESCE(p_meta, '{}'::jsonb)->>'signup_campaign')), '') AS camp,
               NULLIF(lower(trim(COALESCE(p_heard, p_meta->>'heard_about_us', ''))), '') AS heard
    )
    SELECT CASE
        WHEN src IN ('whatsapp', 'wa') THEN 'whatsapp'
        WHEN src IN ('telegram', 'tg') AND camp = 'launch' THEN 'telegram_launch'
        WHEN src IN ('telegram', 'tg') AND camp = 'unilag' THEN 'telegram_unilag'
        WHEN src IN ('telegram', 'tg') AND camp = 'dsn' THEN 'telegram_dsn'
        WHEN src IN ('telegram', 'tg') THEN 'telegram_other'
        WHEN src IS NOT NULL THEN 'other'
        WHEN heard = 'whatsapp' THEN 'whatsapp'
        WHEN heard = 'telegram' THEN 'telegram_other'
        WHEN heard IS NOT NULL THEN 'other'
        ELSE 'unknown' END
      FROM v;
$$;

-- Hold window (pending -> withdrawable) exists only once 011 is applied.
CREATE OR REPLACE FUNCTION public._admin_dash_has_hold()
RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'task_completions'
                      AND column_name = 'payout_status');
$$;

-- -------------------------------------------------------------------------
-- 3. OVERVIEW
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_money_summary()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_cfg public.marketplace_settings%ROWTYPE;
    c RECORD;  -- campaign totals
    p RECORD;  -- payment totals
    w RECORD;  -- wallet-side totals
    v_extras JSONB;
    v_signups JSONB;
    v_counts JSONB;
    v_held NUMERIC;
    v_parts NUMERIC;
    v_refund_paid NUMERIC;
    v_refund_owed NUMERIC;
    v_has_hold BOOLEAN := public._admin_dash_has_hold();
    v_hold JSONB;
    v_ledger_problems INT;
BEGIN
    PERFORM public._admin_dash_guard();
    SELECT * INTO v_cfg FROM public.marketplace_settings WHERE id = 1;

    SELECT COALESCE(SUM(fee_earned), 0) AS fee_earned, COALESCE(SUM(fee_other_kept), 0) AS fee_other,
           COALESCE(SUM(fee_unearned), 0) AS fee_unearned, COALESCE(SUM(payouts_net), 0) AS spend,
           COALESCE(SUM(escrow), 0) AS escrow, COALESCE(SUM(refund_due), 0) AS refund_due,
           COALESCE(SUM(refunded), 0) AS refunded,
           COUNT(*) AS tasks_posted,
           COUNT(*) FILTER (WHERE status = 'active') AS tasks_live,
           COALESCE(SUM(slots_approved), 0) AS approved_spots
      INTO c FROM public._admin_dash_campaigns();

    SELECT COALESCE(SUM(deposited), 0) AS deposited, COALESCE(SUM(unapplied), 0) AS unapplied,
           COALESCE(SUM(unapplied_refunded), 0) AS unapplied_refunded, COALESCE(SUM(deposits), 0) AS n
      INTO p FROM public._admin_dash_payments();

    v_refund_paid := c.refunded + p.unapplied_refunded;
    v_refund_owed := (c.refund_due - c.refunded) + (p.unapplied - p.unapplied_refunded);
    v_held := p.deposited - c.spend - c.fee_earned - c.fee_other - v_refund_paid;
    v_parts := c.escrow + c.fee_unearned + v_refund_owed;

    SELECT
        COALESCE(SUM(t.amount) FILTER (WHERE lower(t.type) = 'cashout' AND lower(t.status) IN ('disbursed', 'settled')), 0) AS paid_out,
        COUNT(*) FILTER (WHERE lower(t.type) = 'cashout' AND lower(t.status) IN ('disbursed', 'settled')) AS paid_out_n,
        COALESCE(SUM(t.amount) FILTER (WHERE lower(t.type) = 'cashout' AND lower(t.status) = 'pending'), 0) AS wd_pending,
        COUNT(*) FILTER (WHERE lower(t.type) = 'cashout' AND lower(t.status) = 'pending') AS wd_pending_n,
        COUNT(*) FILTER (WHERE lower(t.type) = 'cashout' AND lower(t.status) IN ('failed', 'reversed', 'declined')) AS wd_failed_n,
        COALESCE(SUM(t.amount) FILTER (WHERE lower(t.type) IN ('task_payout', 'taskpayout') AND lower(t.status) = 'pending'), 0) AS hold_amt,
        COUNT(*) FILTER (WHERE lower(t.type) IN ('task_payout', 'taskpayout') AND lower(t.status) = 'pending') AS hold_n,
        COALESCE(SUM(t.amount) FILTER (WHERE lower(t.type) = 'referral_bonus' AND lower(t.status) = 'settled'), 0) AS referral_cost,
        COALESCE(SUM(t.amount) FILTER (WHERE lower(t.type) = 'deposit' AND lower(t.status) = 'settled'), 0) AS legacy_deposits
      INTO w
      FROM public.transactions t
     WHERE NOT public._admin_dash_excluded(t.user_id);

    SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', kind, 'amount', amt, 'count', n) ORDER BY amt DESC), '[]'::jsonb)
      INTO v_extras
      FROM (SELECT public._admin_dash_extra_kind(t.type, t.reference, t.metadata) AS kind,
                   SUM(t.amount) AS amt, COUNT(*) AS n
              FROM public.transactions t
             WHERE NOT public._admin_dash_excluded(t.user_id)
               AND lower(t.status) NOT IN ('declined', 'failed', 'reversed')
               AND public._admin_dash_extra_kind(t.type, t.reference, t.metadata) IS NOT NULL
             GROUP BY 1) e;

    SELECT jsonb_build_object(
               'businesses', COUNT(*) FILTER (WHERE pr.role <> 'admin' AND (pr.role = 'business'
                              OR EXISTS (SELECT 1 FROM public.campaigns cc WHERE cc.business_id = pr.id))),
               'workers', COUNT(*) FILTER (WHERE pr.role = 'worker'),
               'workers_active', COUNT(*) FILTER (WHERE pr.role = 'worker' AND pr.approved_task_count > 0),
               'wallet_withdrawable', COALESCE(SUM(pr.withdrawable_balance), 0),
               'wallet_pending', COALESCE(SUM(pr.pending_balance), 0))
      INTO v_counts
      FROM public.profiles pr
     WHERE NOT public._admin_dash_excluded(pr.id);

    SELECT COALESCE(jsonb_object_agg(bucket, jsonb_build_object('total', n, 'workers', nw, 'from_utm', nu)), '{}'::jsonb)
      INTO v_signups
      FROM (SELECT public._admin_dash_signup_bucket(u.raw_user_meta_data, pr.heard_about_us) AS bucket,
                   COUNT(*) AS n,
                   COUNT(*) FILTER (WHERE pr.role = 'worker') AS nw,
                   COUNT(*) FILTER (WHERE NULLIF(trim(COALESCE(u.raw_user_meta_data->>'signup_source', '')), '') IS NOT NULL) AS nu
              FROM public.profiles pr
              LEFT JOIN auth.users u ON u.id = pr.id
             WHERE pr.role <> 'admin' AND NOT public._admin_dash_excluded(pr.id)
             GROUP BY 1) s;

    v_hold := CASE WHEN v_has_hold
                   THEN jsonb_build_object('tracked', true, 'amount', w.hold_amt, 'count', w.hold_n)
                   ELSE jsonb_build_object('tracked', false) END;

    -- 009's per-campaign reconciliation (011 extends it); rows = campaigns that do not add up.
    BEGIN
        SELECT COUNT(*) INTO v_ledger_problems FROM public.campaign_ledger_check();
    EXCEPTION WHEN undefined_function THEN
        v_ledger_problems := NULL;
    END;

    RETURN jsonb_build_object(
        'generated_at', NOW(),
        'settings', jsonb_build_object(
            'platform_fee_rate', v_cfg.platform_fee_rate,
            'referral_bonus_referrer', v_cfg.referral_bonus_referrer,
            'referral_bonus_referee', v_cfg.referral_bonus_referee,
            'min_withdrawal', v_cfg.min_withdrawal),
        'deposited', p.deposited,
        'deposits_count', p.n,
        'legacy_deposits', w.legacy_deposits,
        'paid_out', w.paid_out,
        'paid_out_count', w.paid_out_n,
        'withdrawals_failed_count', w.wd_failed_n,
        'spent_on_workers', c.spend,
        'fees_earned', c.fee_earned,
        'fee_other_kept', c.fee_other,
        'referral_cost', w.referral_cost,
        'net_earned', c.fee_earned - w.referral_cost,
        'extras', v_extras,
        'pending', jsonb_build_object(
            'reviews', (SELECT jsonb_build_object('count', COUNT(*), 'amount', COALESCE(SUM(cm.reward), 0))
                          FROM public.task_completions tc
                          JOIN public._admin_dash_campaigns() cm ON cm.campaign_id = tc.campaign_id
                         WHERE lower(tc.status) = 'pending'
                           AND NOT public._admin_dash_excluded(tc.user_id)),
            'hold', v_hold,
            'withdrawals', jsonb_build_object('count', w.wd_pending_n, 'amount', w.wd_pending)),
        'held', jsonb_build_object(
            'total', v_held,
            'escrow', c.escrow,
            'unearned_fee', c.fee_unearned,
            'refunds_owed', v_refund_owed),
        'refunds', jsonb_build_object(
            'total', v_refund_paid + v_refund_owed,
            'paid', v_refund_paid,
            'owed', v_refund_owed),
        'books', jsonb_build_object(
            'balanced', v_held = v_parts,
            'difference', v_held - v_parts,
            'ledger_problem_campaigns', v_ledger_problems),
        'counts', v_counts || jsonb_build_object(
            'tasks_posted', c.tasks_posted, 'tasks_live', c.tasks_live,
            'approved_spots', c.approved_spots),
        'signups', v_signups,
        'excluded_accounts', (SELECT COUNT(*) FROM public.admin_excluded_accounts)
    );
END;
$$;

-- -------------------------------------------------------------------------
-- 4. DRILL-DOWN LISTS (newest first, paginated)
--    p_kind: deposits | withdrawals_paid | withdrawals_pending | fees | spend
--            | extras (p_filter = extra kind) | reviews_pending | hold
--            | held | refunds | tasks | signups (p_filter = bucket)
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_money_entries(
    p_kind TEXT, p_filter TEXT DEFAULT NULL, p_limit INT DEFAULT 25, p_offset INT DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
    v_offset INT := GREATEST(COALESCE(p_offset, 0), 0);
    v_out JSONB;
BEGIN
    PERFORM public._admin_dash_guard();

    WITH rows AS (
        -- confirmed Paystack checkouts
        SELECT COALESCE(cp.settled_at, cp.created_at) AS at, c.title::TEXT AS title,
               COALESCE(pr.business_name, pr.full_name, pr.username)::TEXT AS who,
               COALESCE(cp.paid_amount, 0) AS amount, cp.status::TEXT AS status,
               cp.reference::TEXT AS ref, cp.business_id AS user_id
          FROM public.campaign_payments cp
          JOIN public.campaigns c ON c.id = cp.campaign_id
          JOIN public.profiles pr ON pr.id = cp.business_id
         WHERE p_kind = 'deposits' AND cp.status <> 'pending'
           AND NOT public._admin_dash_excluded(cp.business_id)
        UNION ALL
        -- withdrawals
        SELECT t.created_at, t.title::TEXT, COALESCE(pr.full_name, pr.username)::TEXT,
               t.amount, t.status::TEXT, t.reference::TEXT, t.user_id
          FROM public.transactions t JOIN public.profiles pr ON pr.id = t.user_id
         WHERE lower(t.type) = 'cashout' AND NOT public._admin_dash_excluded(t.user_id)
           AND ((p_kind = 'withdrawals_paid' AND lower(t.status) IN ('disbursed', 'settled'))
             OR (p_kind = 'withdrawals_pending' AND lower(t.status) = 'pending')
             OR (p_kind = 'withdrawals_failed' AND lower(t.status) IN ('failed', 'reversed', 'declined')))
        UNION ALL
        -- fee earned per campaign
        SELECT cm.funded_at, cm.title, COALESCE(pr.business_name, pr.full_name, pr.username)::TEXT,
               cm.fee_earned, cm.status,
               (cm.slots_approved || ' of ' || cm.slots || ' spots approved')::TEXT, cm.business_id
          FROM public._admin_dash_campaigns() cm JOIN public.profiles pr ON pr.id = cm.business_id
         WHERE p_kind = 'fees' AND (cm.fee_earned > 0 OR cm.fee_other_kept > 0)
        UNION ALL
        -- rewards paid out of campaign escrow (net of 011 reversals)
        SELECT l.created_at, c.title::TEXT, COALESCE(w.full_name, w.username)::TEXT,
               CASE WHEN l.entry_type = 'payout_reversal' THEN -l.amount ELSE l.amount END,
               l.entry_type::TEXT, l.reference::TEXT, l.worker_id
          FROM public.campaign_ledger l
          JOIN public.campaigns c ON c.id = l.campaign_id
          LEFT JOIN public.profiles w ON w.id = l.worker_id
         WHERE p_kind = 'spend' AND l.entry_type IN ('payout', 'payout_reversal')
           AND c.funded_at IS NOT NULL AND NOT public._admin_dash_excluded(c.business_id)
        UNION ALL
        -- bonuses and other non-campaign credits
        SELECT t.created_at, t.title::TEXT, COALESCE(pr.full_name, pr.username)::TEXT,
               t.amount, public._admin_dash_extra_kind(t.type, t.reference, t.metadata),
               t.reference::TEXT, t.user_id
          FROM public.transactions t JOIN public.profiles pr ON pr.id = t.user_id
         WHERE p_kind = 'extras' AND NOT public._admin_dash_excluded(t.user_id)
           AND lower(t.status) NOT IN ('declined', 'failed', 'reversed')
           AND public._admin_dash_extra_kind(t.type, t.reference, t.metadata) IS NOT NULL
           AND (p_filter IS NULL OR public._admin_dash_extra_kind(t.type, t.reference, t.metadata) = p_filter)
        UNION ALL
        -- submissions waiting for the business to review
        SELECT tc.completed_at, cm.title, COALESCE(w.full_name, w.username)::TEXT,
               cm.reward, tc.status::TEXT, tc.id::TEXT, tc.user_id
          FROM public.task_completions tc
          JOIN public._admin_dash_campaigns() cm ON cm.campaign_id = tc.campaign_id
          JOIN public.profiles w ON w.id = tc.user_id
         WHERE p_kind = 'reviews_pending' AND lower(tc.status) = 'pending'
           AND NOT public._admin_dash_excluded(tc.user_id)
        UNION ALL
        -- approved rewards still in the 011 hold window
        SELECT t.created_at, t.title::TEXT, COALESCE(pr.full_name, pr.username)::TEXT,
               t.amount, t.status::TEXT, t.reference::TEXT, t.user_id
          FROM public.transactions t JOIN public.profiles pr ON pr.id = t.user_id
         WHERE p_kind = 'hold' AND lower(t.type) IN ('task_payout', 'taskpayout')
           AND lower(t.status) = 'pending' AND NOT public._admin_dash_excluded(t.user_id)
        UNION ALL
        -- businesses' money still with TaskPulse, per campaign
        SELECT cm.funded_at, cm.title, COALESCE(pr.business_name, pr.full_name, pr.username)::TEXT,
               cm.escrow + cm.fee_unearned + cm.refund_owed, cm.status,
               ('escrow ' || cm.escrow || ' · unearned fee ' || cm.fee_unearned
                 || ' · refund owed ' || cm.refund_owed)::TEXT, cm.business_id
          FROM public._admin_dash_campaigns() cm JOIN public.profiles pr ON pr.id = cm.business_id
         WHERE p_kind = 'held' AND cm.escrow + cm.fee_unearned + cm.refund_owed > 0
        UNION ALL
        SELECT COALESCE(cp.settled_at, cp.created_at), c.title::TEXT,
               COALESCE(pr.business_name, pr.full_name, pr.username)::TEXT,
               COALESCE(cp.paid_amount, 0) - cp.refunded_amount, 'payment_' || cp.status::TEXT,
               cp.reference::TEXT, cp.business_id
          FROM public.campaign_payments cp
          JOIN public.campaigns c ON c.id = cp.campaign_id
          JOIN public.profiles pr ON pr.id = cp.business_id
         WHERE p_kind = 'held' AND cp.status IN ('underpaid', 'duplicate_needs_refund')
           AND COALESCE(cp.paid_amount, 0) > cp.refunded_amount
           AND NOT public._admin_dash_excluded(cp.business_id)
        UNION ALL
        -- refunds owed or paid back to businesses
        SELECT COALESCE((SELECT MAX(l.created_at) FROM public.campaign_ledger l
                          WHERE l.campaign_id = cm.campaign_id
                            AND l.entry_type IN ('refund_due', 'fee_refund_due', 'refund_paid')), cm.funded_at),
               cm.title, COALESCE(pr.business_name, pr.full_name, pr.username)::TEXT,
               cm.refund_due, CASE WHEN cm.refund_owed > 0 THEN 'owed' ELSE 'refunded' END,
               ('paid ' || cm.refunded || ' · owed ' || cm.refund_owed)::TEXT, cm.business_id
          FROM public._admin_dash_campaigns() cm JOIN public.profiles pr ON pr.id = cm.business_id
         WHERE p_kind = 'refunds' AND cm.refund_due > 0
        UNION ALL
        SELECT COALESCE(cp.refunded_at, cp.settled_at, cp.created_at), c.title::TEXT,
               COALESCE(pr.business_name, pr.full_name, pr.username)::TEXT,
               COALESCE(cp.paid_amount, 0),
               CASE WHEN COALESCE(cp.paid_amount, 0) > cp.refunded_amount THEN 'owed' ELSE 'refunded' END,
               ('checkout ' || cp.status || ' · paid ' || cp.refunded_amount || ' · owed '
                 || (COALESCE(cp.paid_amount, 0) - cp.refunded_amount))::TEXT, cp.business_id
          FROM public.campaign_payments cp
          JOIN public.campaigns c ON c.id = cp.campaign_id
          JOIN public.profiles pr ON pr.id = cp.business_id
         WHERE p_kind = 'refunds' AND cp.status IN ('underpaid', 'duplicate_needs_refund', 'refunded')
           AND COALESCE(cp.paid_amount, 0) > 0
           AND NOT public._admin_dash_excluded(cp.business_id)
        UNION ALL
        -- every funded task/campaign
        SELECT cm.funded_at, cm.title, COALESCE(pr.business_name, pr.full_name, pr.username)::TEXT,
               cm.payouts_net + cm.fee_earned + cm.fee_other_kept, cm.status,
               (cm.slots_approved || '/' || cm.slots || ' approved · ' || COALESCE(cm.spots_left::TEXT, '?')
                 || ' spots left')::TEXT, cm.business_id
          FROM public._admin_dash_campaigns() cm JOIN public.profiles pr ON pr.id = cm.business_id
         WHERE p_kind = 'tasks'
        UNION ALL
        -- sign-ups in one source bucket
        SELECT pr.created_at, ('@' || pr.username)::TEXT, COALESCE(pr.full_name, pr.username)::TEXT,
               NULL::NUMERIC, pr.role::TEXT,
               concat_ws(' · ',
                   NULLIF('utm ' || concat_ws('/', NULLIF(u.raw_user_meta_data->>'signup_source', ''),
                                                    NULLIF(u.raw_user_meta_data->>'signup_campaign', '')), 'utm '),
                   NULLIF('heard: ' || COALESCE(pr.heard_about_us, ''), 'heard: '))::TEXT,
               pr.id
          FROM public.profiles pr LEFT JOIN auth.users u ON u.id = pr.id
         WHERE p_kind = 'signups' AND pr.role <> 'admin' AND NOT public._admin_dash_excluded(pr.id)
           AND (p_filter IS NULL OR public._admin_dash_signup_bucket(u.raw_user_meta_data, pr.heard_about_us) = p_filter)
    ), page AS (
        SELECT r.*, COUNT(*) OVER () AS total_rows
          FROM rows r
         ORDER BY r.at DESC NULLS LAST, r.ref DESC
         LIMIT v_limit OFFSET v_offset
    )
    SELECT jsonb_build_object(
               'kind', p_kind,
               'total', COALESCE((SELECT MAX(total_rows) FROM page),
                                 (SELECT COUNT(*) FROM rows)),
               'rows', COALESCE(jsonb_agg(jsonb_build_object(
                   'at', at, 'title', title, 'who', who, 'amount', amount,
                   'status', status, 'detail', ref, 'user_id', user_id)
                   ORDER BY at DESC NULLS LAST, ref DESC), '[]'::jsonb))
      INTO v_out
      FROM page;
    RETURN v_out;
END;
$$;

-- -------------------------------------------------------------------------
-- 5. BUSINESSES
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._admin_dash_business_rows()
RETURNS TABLE (id UUID, name TEXT, username TEXT, email TEXT, joined TIMESTAMPTZ,
               tasks_posted INT, tasks_live INT, deposited NUMERIC, spent_workers NUMERIC,
               fees NUMERIC, refunds_paid NUMERIC, refunds_owed NUMERIC, balance NUMERIC,
               escrow NUMERIC, last_deposit_at TIMESTAMPTZ)
LANGUAGE sql STABLE SET search_path = public AS $$
    WITH cm AS (
        SELECT business_id, COUNT(*)::INT AS n, COUNT(*) FILTER (WHERE status = 'active')::INT AS live,
               SUM(payouts_net) AS spend, SUM(fee_earned + fee_other_kept) AS fees,
               SUM(refunded) AS refunded, SUM(refund_owed) AS owed, SUM(escrow) AS escrow
          FROM public._admin_dash_campaigns() GROUP BY business_id
    ), pm AS (SELECT * FROM public._admin_dash_payments())
    SELECT pr.id, COALESCE(pr.business_name, pr.full_name, pr.username)::TEXT, pr.username::TEXT,
           pr.email::TEXT, pr.created_at,
           COALESCE(cm.n, 0), COALESCE(cm.live, 0),
           COALESCE(pm.deposited, 0), COALESCE(cm.spend, 0), COALESCE(cm.fees, 0),
           COALESCE(cm.refunded, 0) + COALESCE(pm.unapplied_refunded, 0),
           COALESCE(cm.owed, 0) + COALESCE(pm.unapplied, 0) - COALESCE(pm.unapplied_refunded, 0),
           COALESCE(pm.deposited, 0) - COALESCE(cm.spend, 0) - COALESCE(cm.fees, 0)
             - COALESCE(cm.refunded, 0) - COALESCE(pm.unapplied_refunded, 0),
           COALESCE(cm.escrow, 0), pm.last_at
      FROM public.profiles pr
      LEFT JOIN cm ON cm.business_id = pr.id
      LEFT JOIN pm ON pm.business_id = pr.id
     WHERE (pr.role = 'business' OR cm.business_id IS NOT NULL OR pm.business_id IS NOT NULL
            OR EXISTS (SELECT 1 FROM public.campaigns c2 WHERE c2.business_id = pr.id))
       AND NOT public._admin_dash_excluded(pr.id);
$$;

CREATE OR REPLACE FUNCTION public.admin_business_list(
    p_search TEXT DEFAULT NULL, p_limit INT DEFAULT 25, p_offset INT DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_q TEXT := NULLIF(trim(COALESCE(p_search, '')), '');
    v_out JSONB;
BEGIN
    PERFORM public._admin_dash_guard();
    WITH f AS (
        SELECT * FROM public._admin_dash_business_rows() b
         WHERE v_q IS NULL OR b.name ILIKE '%' || v_q || '%' OR b.username ILIKE '%' || v_q || '%'
            OR b.email ILIKE '%' || v_q || '%'
    ), page AS (
        SELECT f.*, COUNT(*) OVER () AS total_rows FROM f
         ORDER BY f.deposited DESC, f.joined DESC
         LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100) OFFSET GREATEST(COALESCE(p_offset, 0), 0)
    )
    SELECT jsonb_build_object(
               'total', COALESCE(MAX(total_rows), (SELECT COUNT(*) FROM f)),
               'rows', COALESCE(jsonb_agg(jsonb_build_object(
                   'id', id, 'name', name, 'username', username, 'joined', joined,
                   'tasks_posted', tasks_posted, 'tasks_live', tasks_live, 'deposited', deposited,
                   'spent', spent_workers + fees, 'balance', balance)
                   ORDER BY deposited DESC, joined DESC), '[]'::jsonb))
      INTO v_out FROM page;
    RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_business_detail(p_business_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_b RECORD;
BEGIN
    PERFORM public._admin_dash_guard();
    SELECT * INTO v_b FROM public._admin_dash_business_rows() b WHERE b.id = p_business_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'business_not_found'; END IF;

    RETURN jsonb_build_object(
        'business', jsonb_build_object(
            'id', v_b.id, 'name', v_b.name, 'username', v_b.username, 'email', v_b.email,
            'joined', v_b.joined, 'tasks_posted', v_b.tasks_posted, 'tasks_live', v_b.tasks_live,
            'deposited', v_b.deposited, 'spent_workers', v_b.spent_workers, 'fees', v_b.fees,
            'spent', v_b.spent_workers + v_b.fees, 'refunds_paid', v_b.refunds_paid,
            'refunds_owed', v_b.refunds_owed, 'balance', v_b.balance, 'escrow', v_b.escrow),
        'campaigns', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'id', cm.campaign_id, 'title', cm.title, 'status', cm.status,
                       'slots', cm.slots, 'approved', cm.slots_approved, 'pending', cm.slots_pending,
                       'spots_left', cm.spots_left, 'reward', cm.reward,
                       'spend', cm.payouts_net + cm.fee_earned + cm.fee_other_kept,
                       'paid_workers', cm.payouts_net, 'fee', cm.fee_earned + cm.fee_other_kept,
                       'refund_due', cm.refund_due, 'escrow', cm.escrow, 'funded_at', cm.funded_at)
                       ORDER BY cm.funded_at DESC)
              FROM public._admin_dash_campaigns() cm WHERE cm.business_id = p_business_id), '[]'::jsonb),
        'unfunded_drafts', (SELECT COUNT(*) FROM public.campaigns c
                             WHERE c.business_id = p_business_id AND c.funded_at IS NULL),
        'deposits', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                       'at', COALESCE(cp.settled_at, cp.created_at), 'reference', cp.reference,
                       'title', c.title, 'amount', COALESCE(cp.paid_amount, 0), 'status', cp.status,
                       'refunded', cp.refunded_amount)
                       ORDER BY COALESCE(cp.settled_at, cp.created_at) DESC)
              FROM public.campaign_payments cp JOIN public.campaigns c ON c.id = cp.campaign_id
             WHERE cp.business_id = p_business_id AND cp.status <> 'pending'), '[]'::jsonb),
        'transactions', COALESCE((
            SELECT jsonb_agg(x ORDER BY (x->>'at') DESC)
              FROM (SELECT jsonb_build_object('at', l.created_at, 'type', l.entry_type,
                                              'title', c.title, 'amount', l.amount, 'reference', l.reference) AS x
                      FROM public.campaign_ledger l JOIN public.campaigns c ON c.id = l.campaign_id
                     WHERE c.business_id = p_business_id
                     ORDER BY l.created_at DESC LIMIT 30) s), '[]'::jsonb)
    );
END;
$$;

-- -------------------------------------------------------------------------
-- 6. WORKERS
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._admin_dash_worker_rows()
RETURNS TABLE (id UUID, name TEXT, username TEXT, email TEXT, joined TIMESTAMPTZ,
               tasks_done INT, tasks_pending INT, earned NUMERIC, bonuses NUMERIC,
               withdrawn NUMERIC, withdrawal_pending NUMERIC, balance NUMERIC, pending_balance NUMERIC,
               referrals INT, referrals_paid INT, kyc_status TEXT, has_bank BOOLEAN,
               payout_eligible_from TIMESTAMPTZ, payout_status TEXT, source TEXT)
LANGUAGE sql STABLE SET search_path = public AS $$
    WITH cfg AS (SELECT min_withdrawal FROM public.marketplace_settings WHERE id = 1),
    tx AS (
        SELECT t.user_id,
               SUM(t.amount) FILTER (WHERE lower(t.type) IN ('task_payout', 'taskpayout')
                                       AND lower(t.status) IN ('settled', 'pending')
                                       AND public._admin_dash_extra_kind(t.type, t.reference, t.metadata) IS NULL) AS earned,
               SUM(t.amount) FILTER (WHERE public._admin_dash_extra_kind(t.type, t.reference, t.metadata) IS NOT NULL
                                       AND lower(t.status) NOT IN ('declined', 'failed', 'reversed')) AS bonuses,
               SUM(t.amount) FILTER (WHERE lower(t.type) = 'cashout' AND lower(t.status) IN ('disbursed', 'settled')) AS withdrawn,
               SUM(t.amount) FILTER (WHERE lower(t.type) = 'cashout' AND lower(t.status) = 'pending') AS wd_pending
          FROM public.transactions t GROUP BY t.user_id
    ), tc AS (
        SELECT user_id, COUNT(*) FILTER (WHERE lower(status) = 'approved')::INT AS done,
               COUNT(*) FILTER (WHERE lower(status) = 'pending')::INT AS pending
          FROM public.task_completions GROUP BY user_id
    ), rf AS (
        SELECT referrer_id, COUNT(*)::INT AS n, COUNT(*) FILTER (WHERE bonus_status = 'paid')::INT AS paid
          FROM public.referrals GROUP BY referrer_id
    )
    SELECT pr.id, COALESCE(pr.full_name, pr.username)::TEXT, pr.username::TEXT, pr.email::TEXT, pr.created_at,
           COALESCE(tc.done, 0), COALESCE(tc.pending, 0),
           COALESCE(tx.earned, 0), COALESCE(tx.bonuses, 0), COALESCE(tx.withdrawn, 0), COALESCE(tx.wd_pending, 0),
           pr.withdrawable_balance, pr.pending_balance,
           COALESCE(rf.n, 0), COALESCE(rf.paid, 0), pr.kyc_status::TEXT,
           EXISTS (SELECT 1 FROM public.bank_accounts ba WHERE ba.user_id = pr.id AND ba.is_active),
           pr.payout_eligible_from,
           CASE WHEN COALESCE(tx.wd_pending, 0) > 0 THEN 'withdrawal_pending'
                WHEN pr.withdrawable_balance >= (SELECT min_withdrawal FROM cfg)
                     AND pr.payout_eligible_from <= NOW() AND pr.kyc_status = 'verified' THEN 'can_withdraw'
                WHEN COALESCE(tx.withdrawn, 0) > 0 THEN 'paid_out'
                WHEN COALESCE(tx.earned, 0) + COALESCE(tx.bonuses, 0) = 0 THEN 'no_earnings'
                ELSE 'not_yet' END,
           public._admin_dash_signup_bucket(u.raw_user_meta_data, pr.heard_about_us)
      FROM public.profiles pr
      LEFT JOIN tx ON tx.user_id = pr.id
      LEFT JOIN tc ON tc.user_id = pr.id
      LEFT JOIN rf ON rf.referrer_id = pr.id
      LEFT JOIN auth.users u ON u.id = pr.id
     WHERE pr.role = 'worker' AND NOT public._admin_dash_excluded(pr.id);
$$;

CREATE OR REPLACE FUNCTION public.admin_worker_list(
    p_search TEXT DEFAULT NULL, p_limit INT DEFAULT 25, p_offset INT DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_q TEXT := NULLIF(trim(COALESCE(p_search, '')), '');
    v_out JSONB;
BEGIN
    PERFORM public._admin_dash_guard();
    WITH f AS (
        SELECT * FROM public._admin_dash_worker_rows() w
         WHERE v_q IS NULL OR w.name ILIKE '%' || v_q || '%' OR w.username ILIKE '%' || v_q || '%'
            OR w.email ILIKE '%' || v_q || '%'
    ), page AS (
        SELECT f.*, COUNT(*) OVER () AS total_rows FROM f
         ORDER BY f.earned + f.bonuses DESC, f.joined DESC
         LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100) OFFSET GREATEST(COALESCE(p_offset, 0), 0)
    )
    SELECT jsonb_build_object(
               'total', COALESCE(MAX(total_rows), (SELECT COUNT(*) FROM f)),
               'rows', COALESCE(jsonb_agg(jsonb_build_object(
                   'id', id, 'name', name, 'username', username, 'joined', joined,
                   'tasks_done', tasks_done, 'earned', earned, 'bonuses', bonuses,
                   'withdrawn', withdrawn, 'referrals', referrals, 'referrals_paid', referrals_paid,
                   'payout_status', payout_status)
                   ORDER BY earned + bonuses DESC, joined DESC), '[]'::jsonb))
      INTO v_out FROM page;
    RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_worker_detail(p_worker_id UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_w RECORD;
BEGIN
    PERFORM public._admin_dash_guard();
    SELECT * INTO v_w FROM public._admin_dash_worker_rows() w WHERE w.id = p_worker_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'worker_not_found'; END IF;

    RETURN jsonb_build_object(
        'worker', to_jsonb(v_w),
        'submissions', COALESCE((
            SELECT jsonb_agg(x ORDER BY (x->>'at') DESC)
              FROM (SELECT jsonb_build_object('at', tc.completed_at, 'title', tc.task_title,
                                              'company', tc.company, 'status', tc.status,
                                              'reward', COALESCE(tc.paid_amount, tc.reward_amount)) AS x
                      FROM public.task_completions tc WHERE tc.user_id = p_worker_id
                     ORDER BY tc.completed_at DESC LIMIT 30) s), '[]'::jsonb),
        'withdrawals', COALESCE((
            SELECT jsonb_agg(x ORDER BY (x->>'at') DESC)
              FROM (SELECT jsonb_build_object('at', t.created_at, 'amount', t.amount, 'status', t.status,
                                              'bank', t.destination_bank, 'reference', t.reference) AS x
                      FROM public.transactions t
                     WHERE t.user_id = p_worker_id AND lower(t.type) = 'cashout'
                     ORDER BY t.created_at DESC LIMIT 30) s), '[]'::jsonb),
        'referrals', COALESCE((
            SELECT jsonb_agg(x ORDER BY (x->>'at') DESC)
              FROM (SELECT jsonb_build_object('at', r.created_at, 'username', r.referee_username,
                                              'bonus_status', r.bonus_status,
                                              'bonus', r.bonus_referrer_amount) AS x
                      FROM public.referrals r WHERE r.referrer_id = p_worker_id
                     ORDER BY r.created_at DESC LIMIT 50) s), '[]'::jsonb),
        'transactions', COALESCE((
            SELECT jsonb_agg(x ORDER BY (x->>'at') DESC)
              FROM (SELECT jsonb_build_object('at', t.created_at, 'type', t.type, 'title', t.title,
                                              'amount', t.amount, 'status', t.status) AS x
                      FROM public.transactions t WHERE t.user_id = p_worker_id
                     ORDER BY t.created_at DESC LIMIT 30) s), '[]'::jsonb)
    );
END;
$$;

-- -------------------------------------------------------------------------
-- 7. PRIVILEGES
-- -------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._admin_dash_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._admin_dash_excluded(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._admin_dash_campaigns() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._admin_dash_payments() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._admin_dash_extra_kind(TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._admin_dash_signup_bucket(JSONB, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._admin_dash_has_hold() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._admin_dash_business_rows() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._admin_dash_worker_rows() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.admin_money_summary() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_money_entries(TEXT, TEXT, INT, INT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_business_list(TEXT, INT, INT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_business_detail(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_worker_list(TEXT, INT, INT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_worker_detail(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_money_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_money_entries(TEXT, TEXT, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_business_list(TEXT, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_business_detail(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_worker_list(TEXT, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_worker_detail(UUID) TO authenticated;

COMMIT;

-- =========================================================================
-- AFTER RUNNING (read-only; the SQL editor has no JWT, so it is allowed)
--   SELECT public.admin_money_summary();        -- look at books->balanced
-- =========================================================================

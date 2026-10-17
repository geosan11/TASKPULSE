-- =========================================================================
-- TASKPULSE 009 - BUSINESS PAYMENTS FIXES (refunds, referral abuse, grants)
-- =========================================================================
-- Run ONCE in the Supabase SQL Editor AFTER 008 (or via `supabase db push`,
-- which uses the identical copy in
-- supabase/migrations/20261017000009_business_payments.sql). Do not run both.
-- Safe to re-run; runs in a single transaction (all or nothing).
--
-- WHAT CHANGES
--   1. Referral bonus can no longer be farmed.
--      008 paid N200 to the referrer AND N200 to the referee after any 3
--      approved tasks, even N50 tasks on a campaign the farmer funded himself.
--      Locally: N939 of campaigns paid out N2,750 of bonuses + rewards.
--      Now a referral bonus is only paid when
--        a) the referee has >= referral_qualifying_tasks approved tasks on
--           campaigns owned by someone OTHER than the referrer or referee, and
--        b) (referral_require_fee_cover, default ON) the platform fee those
--           tasks generated covers the bonus being paid.
--      At N300/task, 3 tasks generate N225 of fee, so a N200 referrer bonus
--      is paid after exactly 3 tasks, as advertised.
--      The referee ("welcome") bonus is set to N0 to match the stated model
--      ("N200 to the referrer"). To restore it:
--        UPDATE public.marketplace_settings SET referral_bonus_referee = 200 WHERE id = 1;
--      (with fee cover ON, both bonuses = N400 then need ~6 N300 tasks).
--   2. Refunds are tracked properly.
--      * Cancelling a campaign now also refunds the platform fee on unused
--        slots (refund_fee_on_unused, default ON, matching "pay only for
--        approved work"). Turn off with
--          UPDATE public.marketplace_settings SET refund_fee_on_unused = FALSE WHERE id = 1;
--      * Over/duplicate payments and underpayments are listed for refund.
--      * New admin tools: admin_refunds_owed() lists every Naira owed back
--        to businesses with the Paystack reference to refund against;
--        record_campaign_refund() / record_payment_refund() mark it paid.
--        TaskPulse never sends refunds automatically: the owner issues
--        them in the Paystack dashboard (Transactions > Refund), then
--        records them here.
--   3. settle_campaign_funding says WHY a payment was not applied
--      (already_funded vs campaign_cancelled).
--   4. anon could SELECT campaigns/campaign_payments/campaign_ledger (only
--      blocked by an is_admin() permission error). SELECT revoked from anon.
--   5. campaign_ledger_check(): admin read-only reconciliation that every
--      campaign's money adds up (funding = payouts + refunds + escrow).
-- No balance, campaign or payment row is deleted or rewritten.
-- =========================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- 1. SETTINGS
-- -------------------------------------------------------------------------
ALTER TABLE public.marketplace_settings
    ADD COLUMN IF NOT EXISTS refund_fee_on_unused BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS referral_require_fee_cover BOOLEAN NOT NULL DEFAULT TRUE;

-- Only run the referee change the first time (re-runs must not undo an
-- owner's later choice).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'campaign_refunds' AND relnamespace = 'public'::regnamespace) THEN
        UPDATE public.marketplace_settings SET referral_bonus_referee = 0, updated_at = NOW() WHERE id = 1;
    END IF;
END $$;

-- -------------------------------------------------------------------------
-- 2. REFUND BOOKKEEPING COLUMNS
-- -------------------------------------------------------------------------
ALTER TABLE public.campaigns
    ADD COLUMN IF NOT EXISTS fee_refund_due NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (fee_refund_due >= 0),
    ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_campaign_refunded_le_due') THEN
        ALTER TABLE public.campaigns ADD CONSTRAINT chk_campaign_refunded_le_due
            CHECK (refunded_amount <= refund_due) NOT VALID;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_campaign_fee_refund_le_fee') THEN
        ALTER TABLE public.campaigns ADD CONSTRAINT chk_campaign_fee_refund_le_fee
            CHECK (fee_refund_due <= platform_fee) NOT VALID;
    END IF;
END $$;

ALTER TABLE public.campaign_payments
    ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
    ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS refund_reference VARCHAR(120);

ALTER TABLE public.campaign_payments DROP CONSTRAINT IF EXISTS campaign_payments_status_check;
ALTER TABLE public.campaign_payments ADD CONSTRAINT campaign_payments_status_check
    CHECK (status IN ('pending', 'settled', 'underpaid', 'duplicate_needs_refund', 'refunded'));

ALTER TABLE public.campaign_ledger DROP CONSTRAINT IF EXISTS campaign_ledger_entry_type_check;
ALTER TABLE public.campaign_ledger ADD CONSTRAINT campaign_ledger_entry_type_check
    CHECK (entry_type IN ('funding', 'platform_fee', 'payout', 'refund_due', 'fee_refund_due', 'refund_paid'));

-- Audit trail of refunds the owner has actually paid out via Paystack.
CREATE TABLE IF NOT EXISTS public.campaign_refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE RESTRICT,
    payment_reference VARCHAR(100) REFERENCES public.campaign_payments(reference) ON DELETE RESTRICT,
    amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    paystack_refund_reference VARCHAR(120) NOT NULL,
    recorded_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((campaign_id IS NULL) <> (payment_reference IS NULL))
);
ALTER TABLE public.campaign_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.campaign_refunds FROM anon, authenticated;

-- -------------------------------------------------------------------------
-- 3. HELPER: fee to refund for an amount of unused reward
--    Never more than the fee still held; the whole remaining fee once no
--    slot was ever approved and none is pending.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._fee_refund_for(
    p_campaign public.campaigns, p_reward_refund NUMERIC, p_nothing_used BOOLEAN
) RETURNS NUMERIC
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_on BOOLEAN;
    v_left NUMERIC := p_campaign.platform_fee - p_campaign.fee_refund_due;
BEGIN
    SELECT refund_fee_on_unused INTO v_on FROM public.marketplace_settings WHERE id = 1;
    IF NOT COALESCE(v_on, TRUE) OR p_reward_refund <= 0 OR v_left <= 0 THEN RETURN 0; END IF;
    IF p_nothing_used THEN RETURN v_left; END IF;
    RETURN LEAST(v_left, floor(p_reward_refund * p_campaign.platform_fee_rate));
END;
$$;
REVOKE ALL ON FUNCTION public._fee_refund_for(public.campaigns, NUMERIC, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- -------------------------------------------------------------------------
-- 4. SETTLE: report why a paid checkout was not applied
-- -------------------------------------------------------------------------
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

    SELECT * INTO v_campaign FROM public.campaigns WHERE id = v_pay.campaign_id FOR UPDATE;

    IF v_pay.status IN ('settled', 'duplicate_needs_refund', 'refunded') THEN
        RETURN jsonb_build_object('success', true, 'duplicate', true,
                                  'campaign_id', v_pay.campaign_id, 'status', v_pay.status,
                                  'reason', CASE WHEN v_pay.status = 'settled' THEN 'already_settled'
                                                 WHEN v_campaign.status = 'cancelled' AND v_campaign.funded_at IS NULL
                                                 THEN 'campaign_cancelled' ELSE 'already_funded' END);
    END IF;

    IF p_paid_amount IS NULL OR p_paid_amount < v_pay.amount THEN
        UPDATE public.campaign_payments
           SET status = 'underpaid', paid_amount = p_paid_amount
         WHERE reference = p_reference;
        RETURN jsonb_build_object('success', false, 'error', 'underpaid');
    END IF;

    -- Paid, but the campaign is already funded or was cancelled before payment:
    -- never double-fund; list it for a full refund (admin_refunds_owed).
    IF v_campaign.status <> 'pending_payment' THEN
        UPDATE public.campaign_payments
           SET status = 'duplicate_needs_refund', paid_amount = p_paid_amount, settled_at = NOW()
         WHERE reference = p_reference;
        RETURN jsonb_build_object('success', true, 'duplicate', true,
                                  'status', 'duplicate_needs_refund', 'campaign_id', v_campaign.id,
                                  'reason', CASE WHEN v_campaign.status = 'cancelled' AND v_campaign.funded_at IS NULL
                                                 THEN 'campaign_cancelled' ELSE 'already_funded' END);
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

    INSERT INTO public.transactions (user_id, type, amount, fee, status, reference, title, description, metadata)
    VALUES (
        v_campaign.business_id, 'campaign_funding', v_campaign.total_charge, v_campaign.platform_fee,
        'settled', p_reference, left('Campaign funded: ' || v_campaign.title, 120),
        v_campaign.slots || ' slots x N' || v_campaign.reward_per_completion || ' + platform fee (paid by card)',
        jsonb_build_object('campaign_id', v_campaign.id)
    )
    ON CONFLICT (reference) DO NOTHING;

    RETURN jsonb_build_object('success', true, 'campaign_id', v_campaign.id, 'task_id', v_task_id,
                              'escrow', v_campaign.reward_budget);
END;
$$;

-- -------------------------------------------------------------------------
-- 5. CANCEL: refund unused rewards AND their share of the platform fee
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_campaign_status(p_campaign_id UUID, p_status TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_campaign public.campaigns%ROWTYPE;
    v_refund NUMERIC(14,2) := 0;
    v_fee_refund NUMERIC(14,2) := 0;
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
        v_fee_refund := public._fee_refund_for(
            v_campaign, v_refund, v_campaign.slots_approved = 0 AND v_campaign.slots_pending = 0);
        UPDATE public.campaigns
           SET status = 'cancelled',
               escrow_balance = escrow_balance - v_refund,
               fee_refund_due = fee_refund_due + v_fee_refund,
               refund_due = refund_due + v_refund + v_fee_refund
         WHERE id = p_campaign_id;
        UPDATE public.tasks SET is_active = FALSE WHERE campaign_id = p_campaign_id;
        IF v_refund > 0 THEN
            INSERT INTO public.campaign_ledger (campaign_id, entry_type, amount, reference)
            VALUES (p_campaign_id, 'refund_due', v_refund, 'refund_' || p_campaign_id::text)
            ON CONFLICT (reference) DO NOTHING;
        END IF;
        IF v_fee_refund > 0 THEN
            INSERT INTO public.campaign_ledger (campaign_id, entry_type, amount, reference)
            VALUES (p_campaign_id, 'fee_refund_due', v_fee_refund, 'feerefund_' || p_campaign_id::text)
            ON CONFLICT (reference) DO NOTHING;
        END IF;
    ELSE
        RAISE EXCEPTION 'invalid_status_change';
    END IF;

    RETURN jsonb_build_object('success', true, 'status', p_status,
                              'refund_due', v_refund + v_fee_refund,
                              'reward_refund', v_refund, 'fee_refund', v_fee_refund);
END;
$$;

-- -------------------------------------------------------------------------
-- 6. REVIEW: same as 008, plus fee refund on reject-after-cancel and the
--    abuse-resistant referral rule.
-- -------------------------------------------------------------------------
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
    v_fee_refund NUMERIC(14,2);
    v_is_admin BOOLEAN := FALSE;
    v_count INT;
    v_ref public.referrals%ROWTYPE;
    v_paid_bonuses INT;
    v_referrer_bonus NUMERIC(14,2) := 0;
    v_referee_bonus NUMERIC(14,2) := 0;
    v_qual_tasks INT := 0;
    v_qual_fee NUMERIC(14,2) := 0;
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
                UPDATE public.tasks SET spots_left = LEAST(spots_total, spots_left + 1)
                 WHERE campaign_id = v_campaign.id;
            ELSIF v_campaign.status = 'cancelled' THEN
                v_fee_refund := public._fee_refund_for(
                    v_campaign, v_campaign.reward_per_completion,
                    v_campaign.slots_approved = 0 AND v_campaign.slots_pending <= 1);
                UPDATE public.campaigns
                   SET escrow_balance = escrow_balance - v_campaign.reward_per_completion,
                       fee_refund_due = fee_refund_due + v_fee_refund,
                       refund_due = refund_due + v_campaign.reward_per_completion + v_fee_refund
                 WHERE id = v_campaign.id;
                INSERT INTO public.campaign_ledger (campaign_id, entry_type, amount, reference, completion_id)
                VALUES (v_campaign.id, 'refund_due', v_campaign.reward_per_completion,
                        'refund_rej_' || v_sub.id::text, v_sub.id)
                ON CONFLICT (reference) DO NOTHING;
                IF v_fee_refund > 0 THEN
                    INSERT INTO public.campaign_ledger (campaign_id, entry_type, amount, reference, completion_id)
                    VALUES (v_campaign.id, 'fee_refund_due', v_fee_refund,
                            'feerefund_rej_' || v_sub.id::text, v_sub.id)
                    ON CONFLICT (reference) DO NOTHING;
                END IF;
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

    -- Referral bonus (once). Only work for third-party businesses counts, and
    -- (by default) the fee that work generated must cover the bonus, so the
    -- platform can never pay out more than it earned from the referee.
    IF v_count >= v_cfg.referral_qualifying_tasks THEN
        SELECT * INTO v_ref FROM public.referrals
         WHERE referee_id = v_sub.user_id AND bonus_status = 'pending'
         FOR UPDATE;
        IF FOUND THEN
            SELECT COUNT(*), COALESCE(SUM(tc.paid_amount * c.platform_fee_rate), 0)
              INTO v_qual_tasks, v_qual_fee
              FROM public.task_completions tc
              JOIN public.campaigns c ON c.id = tc.campaign_id
             WHERE tc.user_id = v_sub.user_id
               AND lower(tc.status) = 'approved'
               AND c.business_id <> v_sub.user_id
               AND c.business_id <> v_ref.referrer_id;

            v_referee_bonus := v_cfg.referral_bonus_referee;
            SELECT COUNT(*) INTO v_paid_bonuses FROM public.referrals
             WHERE referrer_id = v_ref.referrer_id AND bonus_status = 'paid';
            IF v_ref.referrer_id <> v_sub.user_id
               AND v_paid_bonuses < v_cfg.referral_max_bonuses_per_referrer THEN
                v_referrer_bonus := v_cfg.referral_bonus_referrer;
            END IF;

            IF v_qual_tasks < v_cfg.referral_qualifying_tasks
               OR (COALESCE(v_cfg.referral_require_fee_cover, TRUE)
                   AND v_qual_fee < v_referrer_bonus + v_referee_bonus) THEN
                -- Not yet earned: stays pending, re-checked on the next approval.
                v_referrer_bonus := 0;
                v_referee_bonus := 0;
            ELSE
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
    END IF;

    RETURN jsonb_build_object('success', true, 'status', 'approved', 'credited', v_reward,
                              'referral_bonus_referee', v_referee_bonus,
                              'referral_bonus_referrer', v_referrer_bonus);
END;
$$;

-- -------------------------------------------------------------------------
-- 7. ADMIN: what is owed back to businesses, and recording paid refunds
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_refunds_owed()
RETURNS TABLE (
    kind TEXT, campaign_id UUID, campaign_title TEXT, business_id UUID, business_email TEXT,
    refund_against_reference TEXT, amount_owed NUMERIC, detail TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
    RETURN QUERY
    SELECT 'campaign'::TEXT, c.id, c.title::TEXT, c.business_id, p.email::TEXT,
           (SELECT cp.reference::TEXT FROM public.campaign_payments cp
             WHERE cp.campaign_id = c.id AND cp.status = 'settled' ORDER BY cp.settled_at LIMIT 1),
           c.refund_due - c.refunded_amount,
           ('unused rewards ' || (c.refund_due - c.fee_refund_due) || ' + fee ' || c.fee_refund_due
             || CASE WHEN c.slots_pending > 0 THEN ' (' || c.slots_pending || ' still awaiting review)' ELSE '' END)::TEXT
      FROM public.campaigns c JOIN public.profiles p ON p.id = c.business_id
     WHERE c.refund_due > c.refunded_amount
    UNION ALL
    SELECT 'payment'::TEXT, cp.campaign_id, c.title::TEXT, cp.business_id, p.email::TEXT,
           cp.reference::TEXT, COALESCE(cp.paid_amount, 0) - cp.refunded_amount,
           (CASE cp.status WHEN 'underpaid' THEN 'underpaid checkout (campaign not funded by it)'
                           ELSE 'paid after campaign was already funded or cancelled' END)::TEXT
      FROM public.campaign_payments cp
      JOIN public.campaigns c ON c.id = cp.campaign_id
      JOIN public.profiles p ON p.id = cp.business_id
     WHERE cp.status IN ('underpaid', 'duplicate_needs_refund')
       AND COALESCE(cp.paid_amount, 0) > cp.refunded_amount;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_campaign_refund(
    p_campaign_id UUID, p_amount NUMERIC, p_paystack_refund_reference TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_c public.campaigns%ROWTYPE;
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
    IF NULLIF(trim(COALESCE(p_paystack_refund_reference, '')), '') IS NULL THEN RAISE EXCEPTION 'reference_required'; END IF;
    SELECT * INTO v_c FROM public.campaigns WHERE id = p_campaign_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
    IF v_c.refunded_amount + p_amount > v_c.refund_due THEN RAISE EXCEPTION 'refund_exceeds_due'; END IF;

    UPDATE public.campaigns SET refunded_amount = refunded_amount + p_amount WHERE id = p_campaign_id;
    INSERT INTO public.campaign_refunds (campaign_id, amount, paystack_refund_reference, recorded_by)
    VALUES (p_campaign_id, p_amount, trim(p_paystack_refund_reference), auth.uid());
    INSERT INTO public.campaign_ledger (campaign_id, entry_type, amount, reference)
    VALUES (p_campaign_id, 'refund_paid', p_amount, 'refpaid_' || trim(p_paystack_refund_reference));
    RETURN jsonb_build_object('success', true, 'refunded_total', v_c.refunded_amount + p_amount,
                              'still_owed', v_c.refund_due - v_c.refunded_amount - p_amount);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_payment_refund(
    p_reference TEXT, p_paystack_refund_reference TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_p public.campaign_payments%ROWTYPE;
    v_amt NUMERIC(14,2);
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
    IF NULLIF(trim(COALESCE(p_paystack_refund_reference, '')), '') IS NULL THEN RAISE EXCEPTION 'reference_required'; END IF;
    SELECT * INTO v_p FROM public.campaign_payments WHERE reference = p_reference FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'payment_not_found'; END IF;
    IF v_p.status NOT IN ('underpaid', 'duplicate_needs_refund') THEN RAISE EXCEPTION 'payment_not_refundable'; END IF;
    v_amt := COALESCE(v_p.paid_amount, 0) - v_p.refunded_amount;
    IF v_amt <= 0 THEN RAISE EXCEPTION 'nothing_to_refund'; END IF;

    UPDATE public.campaign_payments
       SET status = 'refunded', refunded_amount = refunded_amount + v_amt, refunded_at = NOW(),
           refund_reference = trim(p_paystack_refund_reference)
     WHERE reference = p_reference;
    INSERT INTO public.campaign_refunds (payment_reference, amount, paystack_refund_reference, recorded_by)
    VALUES (p_reference, v_amt, trim(p_paystack_refund_reference), auth.uid());
    RETURN jsonb_build_object('success', true, 'refunded', v_amt);
END;
$$;

-- Read-only reconciliation: rows returned = campaigns whose money does not add up.
CREATE OR REPLACE FUNCTION public.campaign_ledger_check()
RETURNS TABLE (campaign_id UUID, funded NUMERIC, paid_out NUMERIC, reward_refunds NUMERIC,
               escrow NUMERIC, difference NUMERIC, problem TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
    RETURN QUERY
    WITH l AS (
        SELECT c.id,
               COALESCE(SUM(cl.amount) FILTER (WHERE cl.entry_type = 'funding'), 0) AS f,
               COALESCE(SUM(cl.amount) FILTER (WHERE cl.entry_type = 'payout'), 0) AS po,
               COALESCE(SUM(cl.amount) FILTER (WHERE cl.entry_type = 'refund_due'), 0) AS rr,
               COALESCE(SUM(cl.amount) FILTER (WHERE cl.entry_type = 'fee_refund_due'), 0) AS fr,
               c.escrow_balance AS e, c.slots_approved, c.reward_per_completion,
               c.refund_due, c.fee_refund_due
          FROM public.campaigns c LEFT JOIN public.campaign_ledger cl ON cl.campaign_id = c.id
         GROUP BY c.id
    ), p AS (
        SELECT tc.campaign_id AS id, COALESCE(SUM(tx.amount), 0) AS credited
          FROM public.task_completions tc
          JOIN public.transactions tx ON tx.reference = 'task_' || tc.id::text
         WHERE tc.campaign_id IS NOT NULL
         GROUP BY tc.campaign_id
    )
    SELECT l.id, l.f, l.po, l.rr, l.e, l.f - l.po - l.rr - l.e,
           CASE WHEN l.f <> l.po + l.rr + l.e THEN 'funding <> payouts + refunds + escrow'
                WHEN l.po <> COALESCE(p.credited, 0) THEN 'ledger payouts <> wallet credits'
                WHEN l.po <> l.slots_approved * l.reward_per_completion THEN 'payouts <> approved slots x reward'
                WHEN l.refund_due <> l.rr + l.fr OR l.fee_refund_due <> l.fr THEN 'refund_due <> ledger refunds'
           END
      FROM l LEFT JOIN p ON p.id = l.id
     WHERE l.f <> l.po + l.rr + l.e
        OR l.po <> COALESCE(p.credited, 0)
        OR l.po <> l.slots_approved * l.reward_per_completion
        OR l.refund_due <> l.rr + l.fr
        OR l.fee_refund_due <> l.fr;
END;
$$;

-- -------------------------------------------------------------------------
-- 8. PRIVILEGES
-- -------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.settle_campaign_funding(TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._review_submission_core(UUID, BOOLEAN, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_campaign_funding(TEXT, NUMERIC) TO service_role;

REVOKE ALL ON FUNCTION public.set_campaign_status(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_campaign_status(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_refunds_owed() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_campaign_refund(UUID, NUMERIC, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_payment_refund(TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.campaign_ledger_check() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_refunds_owed() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_campaign_refund(UUID, NUMERIC, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_payment_refund(TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.campaign_ledger_check() TO authenticated, service_role;

-- Owner-only tables are not for anonymous visitors at all.
REVOKE ALL ON public.campaigns, public.campaign_payments, public.campaign_ledger,
              public.legacy_balance_snapshots FROM anon;

COMMIT;

-- =========================================================================
-- AFTER RUNNING (read-only checks, SQL editor runs as postgres = allowed)
--   SELECT * FROM public.campaign_ledger_check();   -- expect 0 rows
--   SELECT * FROM public.admin_refunds_owed();      -- money owed to businesses
-- After refunding in Paystack (Transactions > pick the reference > Refund):
--   SELECT public.record_campaign_refund('<campaign uuid>', <amount>, '<paystack refund id>');
--   SELECT public.record_payment_refund('<camp_ reference>', '<paystack refund id>');
-- =========================================================================

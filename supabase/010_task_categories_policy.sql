-- =========================================================================
-- TASKPULSE 010 - SAFER TASK CATEGORIES + PROHIBITED-TASK GUARD
-- =========================================================================
-- Run ONCE in the Supabase SQL Editor AFTER 009 (or via `supabase db push`,
-- which uses the identical copy in
-- supabase/migrations/20261017000010_task_categories_policy.sql). Do not run
-- both. Safe to re-run; runs in a single transaction (all or nothing).
--
-- WHY
--   'Reviews' and 'Social' read like paid fake reviews / bought engagement,
--   which breaks Google, Apple, Jumia, Meta, TikTok and X rules and gets the
--   platform (and Paystack account) flagged.
--
-- WHAT CHANGES
--   1. Categories are now:
--        Surveys, App Tests, Product Feedback, Field Audits,
--        Community & Content, Other
--      Legacy values are mapped, never rejected, so an old app build keeps
--      working:  'Reviews' -> 'Product Feedback'   (private, honest feedback;
--                                                  never public store reviews)
--                'Social'  -> 'Community & Content' (join a community, try
--                                                  content and give feedback,
--                                                  create original content)
--   2. Existing campaign rows and their marketplace task rows are relabelled
--      the same way. Historic task_completions keep their original label.
--   3. create_campaign() rejects tasks that pay for public reviews/ratings or
--      for follows/likes/subscribers ('prohibited_task:<reason>').
--      The guard is a deliberately narrow keyword check; admins still review.
--   4. campaigns.category gets a CHECK constraint (added NOT VALID, then
--      validated only if every existing row already passes) and the column
--      default becomes 'Other'.
--   5. settle_campaign_funding(): icon for the new categories (body is
--      otherwise identical to 009).
-- No money, balance, payment or ledger row is touched.
-- =========================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- 1. HELPERS
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_campaign_category(p_category TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public AS $$
    SELECT CASE lower(trim(COALESCE(p_category, '')))
        WHEN '' THEN 'Other'
        WHEN 'reviews' THEN 'Product Feedback'
        WHEN 'review' THEN 'Product Feedback'
        WHEN 'product feedback' THEN 'Product Feedback'
        WHEN 'social' THEN 'Community & Content'
        WHEN 'community & content' THEN 'Community & Content'
        WHEN 'surveys' THEN 'Surveys'
        WHEN 'app tests' THEN 'App Tests'
        WHEN 'field audits' THEN 'Field Audits'
        WHEN 'other' THEN 'Other'
        ELSE trim(p_category)
    END
$$;

-- Returns NULL when the task looks fine, otherwise a short reason code.
-- Keep in sync with prohibitedTaskReason() in src/config/marketplace.ts.
CREATE OR REPLACE FUNCTION public.campaign_prohibited_reason(p_title TEXT, p_instructions TEXT)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
    t TEXT := lower(COALESCE(p_title, '') || E'\n' || COALESCE(p_instructions, ''));
BEGIN
    IF t ~ 'fake\s+(reviews?|ratings?|accounts?|followers|likes)' THEN
        RETURN 'fake_engagement';
    END IF;
    -- Paying for public reviews / star ratings on stores, maps or marketplaces
    IF t ~ '\m(5|five)[\s-]*stars?\M'
       OR t ~ '\m(google|play\s*store|app\s*store|apple|jumia|konga|jiji|trustpilot|tripadvisor|yelp|maps)\s+(reviews?|ratings?)\M'
       OR t ~ '\m(reviews?|rate|ratings?)\s+(us\s+|our\s+\w+\s+|the\s+\w+\s+|it\s+)?(on|in)\s+(the\s+)?(google|play\s*store|app\s*store|apple|jumia|konga|jiji|trustpilot|tripadvisor|yelp|maps)\M'
       OR t ~ '\m(leave|write|post|drop)\s+(us\s+)?(an?\s+)?(positive\s+|good\s+|great\s+)?(public\s+)?(review|rating)\M' THEN
        RETURN 'public_review';
    END IF;
    -- Paying for follows, likes, subscribers, reposts or bought audiences
    IF t ~ '\m(buy|bought|sell|gain|grow|boost|increase|get)\s+(\w+\s+)?(followers|likes|subscribers|views|retweets)\M'
       OR t ~ '\mfollow\s+(us|me|our|my|this|the)\s+(\w+\s+)?(page|account|handle|channel|profile|on)\M'
       OR t ~ '\mfollow\s+(us|me)\M'
       OR t ~ '\m(like|subscribe\s+to|retweet|repost|share)\s+(and\s+\w+\s+)?(our|my|this|the)\s+(\w+\s+)?(page|post|video|tweet|reel|photo|account|channel|status)\M'
       OR t ~ '\msubscribe\s+to\s+(our|my|this|the)\M' THEN
        RETURN 'social_engagement';
    END IF;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.normalize_campaign_category(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.campaign_prohibited_reason(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_campaign_category(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.campaign_prohibited_reason(TEXT, TEXT) TO authenticated, service_role;

-- -------------------------------------------------------------------------
-- 2. RELABEL EXISTING ROWS (labels only; no money columns)
-- -------------------------------------------------------------------------
UPDATE public.campaigns
   SET category = public.normalize_campaign_category(category)
 WHERE category IN ('Reviews', 'Social') OR category IS NULL OR trim(category) = '';

UPDATE public.tasks
   SET category = public.normalize_campaign_category(category)
 WHERE campaign_id IS NOT NULL AND category IN ('Reviews', 'Social');

ALTER TABLE public.campaigns ALTER COLUMN category SET DEFAULT 'Other';

ALTER TABLE public.campaigns DROP CONSTRAINT IF EXISTS chk_campaign_category;
ALTER TABLE public.campaigns ADD CONSTRAINT chk_campaign_category
    CHECK (category IN ('Surveys', 'App Tests', 'Product Feedback', 'Field Audits', 'Community & Content', 'Other'))
    NOT VALID;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.campaigns
         WHERE category NOT IN ('Surveys', 'App Tests', 'Product Feedback', 'Field Audits', 'Community & Content', 'Other')
    ) THEN
        ALTER TABLE public.campaigns VALIDATE CONSTRAINT chk_campaign_category;
    ELSE
        RAISE NOTICE 'chk_campaign_category left NOT VALID: some old campaigns use other labels (new rows are still checked)';
    END IF;
END $$;

-- -------------------------------------------------------------------------
-- 3. CREATE CAMPAIGN (same as 008 + category mapping + prohibited guard)
-- -------------------------------------------------------------------------
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
    v_category TEXT := public.normalize_campaign_category(p_category);
    v_reason TEXT;
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
    IF v_category NOT IN ('Surveys', 'App Tests', 'Product Feedback', 'Field Audits', 'Community & Content', 'Other') THEN
        RAISE EXCEPTION 'invalid_category';
    END IF;
    v_reason := public.campaign_prohibited_reason(p_title, p_instructions);
    IF v_reason IS NOT NULL THEN
        RAISE EXCEPTION 'prohibited_task:%', v_reason;
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

-- -------------------------------------------------------------------------
-- 4. SETTLE (identical to 009 except the category icon)
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
            WHEN 'Community & Content' THEN '💬' WHEN 'App Tests' THEN '📱' WHEN 'Surveys' THEN '📝'
            WHEN 'Product Feedback' THEN '💡' WHEN 'Field Audits' THEN '📍' ELSE '✅' END,
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
-- 5. GRANTS (unchanged from 008/009)
-- -------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.create_campaign(TEXT, TEXT, TEXT, TEXT, NUMERIC, INT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_campaign(TEXT, TEXT, TEXT, TEXT, NUMERIC, INT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.settle_campaign_funding(TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_campaign_funding(TEXT, NUMERIC) TO service_role;

COMMIT;

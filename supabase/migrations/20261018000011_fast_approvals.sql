-- =========================================================================
-- TASKPULSE 011 - FAST APPROVALS: INSTANT CHECKS, REVIEW WINDOW, PENDING HOLD
-- =========================================================================
-- Run ONCE in the Supabase SQL Editor AFTER 010 (or via `supabase db push`,
-- which uses the identical copy in
-- supabase/migrations/20261018000011_fast_approvals.sql). Do not run both.
-- Safe to re-run; runs in a single transaction (all or nothing).
--
-- WHAT CHANGES
--   1. Approval and payout are separate.
--      * Approving a submission takes the reward out of campaign escrow (as
--        before) but credits the worker's PENDING balance, not withdrawable.
--        The task_payout transaction is written with status 'pending'.
--      * Every submission has a review window (review_deadline_at =
--        submitted + review_window_hours, default 24h, one platform setting).
--        While it is open, the business (or an admin) can still reject an
--        approved submission: the pending credit is reversed and the reward
--        goes back to campaign escrow ('payout_reversal' ledger entry).
--      * When the window closes, release moves the reward pending ->
--        withdrawable (transaction 'pending' -> 'settled'). Release is
--        idempotent and row-locked. Anything still unreviewed when the window
--        closes is auto-approved and released at once.
--      * Processing: process_review_windows() (service_role) is scheduled
--        with pg_cron when available, the Vercel cron route
--        /api/process-review-windows is a backstop, and the app calls
--        process_my_review_windows() for the signed-in user's own items.
--      * The 48h first-payout wait (payout_cooldown_hours) is unchanged.
--   2. Per-campaign approval_mode: 'instant' | 'auto_24h' | 'manual'.
--      'auto_24h' and 'manual' use the same mechanism (business reviews,
--      auto-approve when the window closes); they differ only in how the
--      automatic checks are presented. 'instant' auto-approves (into the
--      pending hold) when every automatic check passes.
--      Product Feedback, Field Audits and Other can never be instant.
--   3. Tier 1 checks: business-set completion code (salted sha256, stored in
--      campaign_secrets which no client role can read) or a per-worker
--      unique code (derived from a secret + the worker's start ref);
--      link proof (https, domain matches target_url, not reused in the
--      campaign); minimum time since start_task().
--   4. Always routed to human review: a worker's first trusted_after_tasks
--      (default 3) approved tasks, Field Audits / Product Feedback, rewards
--      above human_review_reward_above (default N1,000), and flagged items
--      (duplicate text / link / screenshot, too fast, wrong code, ...).
--   5. Referral bonuses only count submissions whose window has closed
--      (payout_status = 'released'), on top of 009's third-party rule.
--   6. campaign_ledger_check() understands reversals; new pending_hold_check().
-- EXISTING DATA
--   * Already-approved submissions are marked 'released' (they were already
--     withdrawable). No balance is changed by this migration.
--   * Submissions still pending review get a FULL window from the moment
--     this migration runs, so nothing is auto-approved on day one.
--   * Existing campaigns become approval_mode 'manual'.
-- =========================================================================

BEGIN;

-- -------------------------------------------------------------------------
-- 1. SETTINGS
-- -------------------------------------------------------------------------
ALTER TABLE public.marketplace_settings
    ADD COLUMN IF NOT EXISTS review_window_hours INT NOT NULL DEFAULT 24
        CHECK (review_window_hours BETWEEN 1 AND 168),
    ADD COLUMN IF NOT EXISTS trusted_after_tasks INT NOT NULL DEFAULT 3
        CHECK (trusted_after_tasks >= 0),
    ADD COLUMN IF NOT EXISTS human_review_reward_above NUMERIC(14,2) NOT NULL DEFAULT 1000
        CHECK (human_review_reward_above >= 0),
    ADD COLUMN IF NOT EXISTS min_task_seconds INT NOT NULL DEFAULT 60
        CHECK (min_task_seconds >= 0);

-- -------------------------------------------------------------------------
-- 2. CAMPAIGNS: approval mode + completion code (secret lives elsewhere)
-- -------------------------------------------------------------------------
ALTER TABLE public.campaigns
    ADD COLUMN IF NOT EXISTS approval_mode VARCHAR(12) NOT NULL DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS completion_code_mode VARCHAR(10);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_campaign_approval_mode') THEN
        ALTER TABLE public.campaigns ADD CONSTRAINT chk_campaign_approval_mode
            CHECK (approval_mode IN ('instant', 'auto_24h', 'manual'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_campaign_code_mode') THEN
        ALTER TABLE public.campaigns ADD CONSTRAINT chk_campaign_code_mode
            CHECK (completion_code_mode IS NULL OR completion_code_mode IN ('shared', 'unique'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_campaign_instant_category') THEN
        ALTER TABLE public.campaigns ADD CONSTRAINT chk_campaign_instant_category
            CHECK (approval_mode <> 'instant' OR category IN ('Surveys', 'App Tests', 'Community & Content'));
    END IF;
END $$;

-- Completion-code secrets. No client role can read this table (RLS on, no
-- policies, no grants). Only SECURITY DEFINER functions touch it.
CREATE TABLE IF NOT EXISTS public.campaign_secrets (
    campaign_id UUID PRIMARY KEY REFERENCES public.campaigns(id) ON DELETE CASCADE,
    code_salt TEXT,
    code_hash TEXT,          -- shared mode: sha256(salt || ':' || UPPER(code))
    unique_secret TEXT,      -- unique mode: secret used to derive per-worker codes
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((code_hash IS NOT NULL AND code_salt IS NOT NULL) OR unique_secret IS NOT NULL)
);
ALTER TABLE public.campaign_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.campaign_secrets FROM PUBLIC, anon, authenticated;

-- -------------------------------------------------------------------------
-- 3. TASK STARTS (for the minimum-time check and per-worker codes)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.task_starts (
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    task_id VARCHAR(50) NOT NULL,
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE,
    start_ref VARCHAR(16) NOT NULL UNIQUE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, task_id)
);
ALTER TABLE public.task_starts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.task_starts FROM PUBLIC, anon, authenticated;

-- -------------------------------------------------------------------------
-- 4. SERVER-COMPUTED SCREENSHOT HASHES (written by /api/proof-hash)
-- -------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.proof_hashes (
    path TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    sha256 CHAR(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    size_bytes BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.proof_hashes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.proof_hashes FROM PUBLIC, anon, authenticated;

-- -------------------------------------------------------------------------
-- 5. SUBMISSION COLUMNS
-- -------------------------------------------------------------------------
ALTER TABLE public.task_completions
    ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS approval_source VARCHAR(16),
    ADD COLUMN IF NOT EXISTS payout_status VARCHAR(10),
    ADD COLUMN IF NOT EXISTS review_deadline_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS check_flags TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS review_reasons TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS code_status VARCHAR(10),
    ADD COLUMN IF NOT EXISTS proof_link_norm TEXT,
    ADD COLUMN IF NOT EXISTS proof_text_hash TEXT,
    ADD COLUMN IF NOT EXISTS proof_sha256 TEXT,
    ADD COLUMN IF NOT EXISTS proof_etag TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tc_approval_source') THEN
        ALTER TABLE public.task_completions ADD CONSTRAINT chk_tc_approval_source
            CHECK (approval_source IS NULL OR approval_source IN ('business', 'admin', 'instant', 'auto_timeout', 'legacy'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tc_payout_status') THEN
        ALTER TABLE public.task_completions ADD CONSTRAINT chk_tc_payout_status
            CHECK (payout_status IS NULL OR payout_status IN ('held', 'released', 'reversed'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tc_code_status') THEN
        ALTER TABLE public.task_completions ADD CONSTRAINT chk_tc_code_status
            CHECK (code_status IS NULL OR code_status IN ('match', 'mismatch', 'missing'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tc_campaign_link ON public.task_completions(campaign_id, proof_link_norm) WHERE proof_link_norm IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tc_campaign_text ON public.task_completions(campaign_id, proof_text_hash) WHERE proof_text_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tc_campaign_sha ON public.task_completions(campaign_id, proof_sha256) WHERE proof_sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tc_campaign_etag ON public.task_completions(campaign_id, proof_etag) WHERE proof_etag IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tc_held_due ON public.task_completions(review_deadline_at) WHERE payout_status = 'held';
CREATE INDEX IF NOT EXISTS idx_tc_pending_due ON public.task_completions(review_deadline_at) WHERE lower(status) = 'pending';
CREATE INDEX IF NOT EXISTS idx_tc_user_status ON public.task_completions(user_id, status);

-- Backfill (idempotent). Approved rows were already withdrawable.
UPDATE public.task_completions
   SET payout_status = 'released',
       approval_source = COALESCE(approval_source, 'legacy'),
       released_at = COALESCE(released_at, reviewed_at, completed_at)
 WHERE lower(status) = 'approved' AND payout_status IS NULL;

-- Pending rows get a full window from now: nothing auto-approves on day one.
UPDATE public.task_completions
   SET review_deadline_at = NOW() + make_interval(hours => (SELECT review_window_hours FROM public.marketplace_settings WHERE id = 1))
 WHERE lower(status) = 'pending' AND review_deadline_at IS NULL;

-- -------------------------------------------------------------------------
-- 6. LEDGER: reversal entry type
-- -------------------------------------------------------------------------
ALTER TABLE public.campaign_ledger DROP CONSTRAINT IF EXISTS campaign_ledger_entry_type_check;
ALTER TABLE public.campaign_ledger ADD CONSTRAINT campaign_ledger_entry_type_check
    CHECK (entry_type IN ('funding', 'platform_fee', 'payout', 'payout_reversal',
                          'refund_due', 'fee_refund_due', 'refund_paid'));

-- -------------------------------------------------------------------------
-- 7. PURE HELPERS
-- -------------------------------------------------------------------------
-- Host of an http(s) URL, lower-cased, without "www." / userinfo / port.
CREATE OR REPLACE FUNCTION public._url_host(p_url TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public AS $$
    SELECT NULLIF(regexp_replace(lower(substring(trim(COALESCE(p_url, '')) FROM '^[hH][tT][tT][pP][sS]?://(?:[^/?#@]*@)?([^/?#:]+)')),
                                 '^www\.', ''), '')
$$;

-- Normalised link for duplicate detection: lower-case, no scheme/www, no fragment, no trailing slash.
CREATE OR REPLACE FUNCTION public._norm_link(p_url TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public AS $$
    SELECT NULLIF(regexp_replace(regexp_replace(regexp_replace(lower(trim(COALESCE(p_url, ''))), '#.*$', ''),
                                                '^https?://(www\.)?', ''), '/+$', ''), '')
$$;

CREATE OR REPLACE FUNCTION public._code_hash(p_salt TEXT, p_code TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public AS $$
    SELECT encode(sha256(convert_to(p_salt || ':' || upper(trim(p_code)), 'UTF8')), 'hex')
$$;

-- Per-worker code: first 8 hex chars (upper case) of sha256(secret || ':' || start_ref).
-- Business side (Node): crypto.createHash('sha256').update(secret + ':' + ref).digest('hex').slice(0, 8).toUpperCase()
CREATE OR REPLACE FUNCTION public._unique_code(p_secret TEXT, p_ref TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public AS $$
    SELECT upper(left(encode(sha256(convert_to(p_secret || ':' || p_ref, 'UTF8')), 'hex'), 8))
$$;

-- Storage object ETag + size as a fallback screenshot fingerprint when
-- /api/proof-hash did not record a sha256. Never fails the caller.
CREATE OR REPLACE FUNCTION public._proof_etag(p_path TEXT)
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v TEXT;
BEGIN
    IF p_path IS NULL THEN RETURN NULL; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'storage' AND table_name = 'objects' AND column_name = 'metadata') THEN
        RETURN NULL;
    END IF;
    EXECUTE $q$SELECT lower(trim(both '"' FROM metadata->>'eTag')) || ':' || COALESCE(metadata->>'size', '')
                 FROM storage.objects
                WHERE bucket_id = 'taskpulse-proofs' AND name = $1 AND metadata->>'eTag' IS NOT NULL
                LIMIT 1$q$ INTO v USING p_path;
    RETURN v;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

-- Which approval mode a new campaign gets. Raises on a disallowed choice.
-- Keep in sync with resolveApprovalMode() in src/config/marketplace.ts.
CREATE OR REPLACE FUNCTION public.resolve_approval_mode(
    p_category TEXT, p_proof_type TEXT, p_has_code BOOLEAN, p_target_url TEXT, p_requested TEXT
) RETURNS TEXT LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
    v_req TEXT := NULLIF(lower(trim(COALESCE(p_requested, ''))), '');
    v_has_link_check BOOLEAN := p_proof_type = 'link' AND NULLIF(trim(COALESCE(p_target_url, '')), '') IS NOT NULL;
BEGIN
    IF v_req IS NOT NULL AND v_req NOT IN ('instant', 'auto_24h', 'manual') THEN
        RAISE EXCEPTION 'invalid_approval_mode';
    END IF;
    IF p_category NOT IN ('Surveys', 'App Tests', 'Community & Content') THEN
        -- Product Feedback, Field Audits, Other: always human review.
        IF v_req = 'instant' THEN RAISE EXCEPTION 'instant_not_allowed_for_category'; END IF;
        RETURN COALESCE(v_req, 'auto_24h');
    END IF;
    IF v_req = 'instant' THEN
        IF NOT COALESCE(p_has_code, FALSE) AND NOT v_has_link_check THEN
            RAISE EXCEPTION 'instant_needs_check';
        END IF;
        RETURN 'instant';
    END IF;
    IF v_req IS NOT NULL THEN RETURN v_req; END IF;
    IF p_category IN ('Surveys', 'App Tests') AND COALESCE(p_has_code, FALSE) THEN RETURN 'instant'; END IF;
    RETURN 'auto_24h';
END;
$$;

-- -------------------------------------------------------------------------
-- 8. CREATE CAMPAIGN (010 + approval mode + completion code)
--    Old 7-argument version dropped so PostgREST sees one function; old app
--    builds keep working because the new arguments have defaults.
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_campaign(TEXT, TEXT, TEXT, TEXT, NUMERIC, INT, TEXT);

CREATE OR REPLACE FUNCTION public.create_campaign(
    p_title TEXT,
    p_instructions TEXT,
    p_category TEXT,
    p_proof_type TEXT,
    p_reward NUMERIC,
    p_slots INT,
    p_target_url TEXT DEFAULT NULL,
    p_approval_mode TEXT DEFAULT NULL,
    p_completion_code TEXT DEFAULT NULL,
    p_code_mode TEXT DEFAULT NULL
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
    v_code TEXT := NULLIF(trim(COALESCE(p_completion_code, '')), '');
    v_code_mode TEXT;
    v_mode TEXT;
    v_salt TEXT;
    v_target TEXT := NULLIF(trim(COALESCE(p_target_url, '')), '');
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

    IF v_code IS NOT NULL THEN
        v_code_mode := COALESCE(NULLIF(lower(trim(COALESCE(p_code_mode, ''))), ''), 'shared');
        IF v_code_mode NOT IN ('shared', 'unique') THEN RAISE EXCEPTION 'invalid_code_mode'; END IF;
        IF v_code_mode = 'shared' AND (length(v_code) < 4 OR length(v_code) > 64) THEN
            RAISE EXCEPTION 'invalid_completion_code';
        END IF;
        IF v_code_mode = 'unique' AND (length(v_code) < 16 OR length(v_code) > 128) THEN
            RAISE EXCEPTION 'invalid_code_secret';
        END IF;
        IF v_code_mode = 'unique' AND v_target IS NULL THEN
            RAISE EXCEPTION 'unique_code_needs_link';
        END IF;
    END IF;

    v_mode := public.resolve_approval_mode(v_category, p_proof_type, v_code IS NOT NULL, v_target, p_approval_mode);

    v_budget := p_reward * p_slots;
    -- Whole Naira only (rounded UP so escrow is never short)
    v_total := ceil(v_budget * (1 + v_cfg.platform_fee_rate));

    INSERT INTO public.campaigns (
        business_id, title, instructions, category, proof_type, target_url,
        reward_per_completion, slots, platform_fee_rate,
        reward_budget, platform_fee, total_charge, status,
        approval_mode, completion_code_mode
    ) VALUES (
        v_uid, left(trim(p_title), 120), trim(p_instructions), v_category, p_proof_type, v_target,
        p_reward, p_slots, v_cfg.platform_fee_rate,
        v_budget, v_total - v_budget, v_total, 'pending_payment',
        v_mode, v_code_mode
    ) RETURNING * INTO v_campaign;

    IF v_code IS NOT NULL THEN
        IF v_code_mode = 'shared' THEN
            v_salt := replace(gen_random_uuid()::text, '-', '');
            INSERT INTO public.campaign_secrets (campaign_id, code_salt, code_hash)
            VALUES (v_campaign.id, v_salt, public._code_hash(v_salt, v_code));
        ELSE
            INSERT INTO public.campaign_secrets (campaign_id, unique_secret)
            VALUES (v_campaign.id, v_code);
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'success', true, 'campaign_id', v_campaign.id,
        'reward_budget', v_campaign.reward_budget,
        'platform_fee', v_campaign.platform_fee,
        'total_charge', v_campaign.total_charge,
        'approval_mode', v_campaign.approval_mode,
        'completion_code_mode', v_campaign.completion_code_mode
    );
END;
$$;

-- -------------------------------------------------------------------------
-- 9. WORKER: START A TASK (idempotent; first start wins)
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_task(p_task_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_task public.tasks%ROWTYPE;
    v_campaign public.campaigns%ROWTYPE;
    v_start public.task_starts%ROWTYPE;
    v_cfg public.marketplace_settings%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
    SELECT * INTO v_cfg FROM public.marketplace_settings WHERE id = 1;
    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
    IF NOT FOUND OR NOT v_task.is_active THEN RAISE EXCEPTION 'task_not_available'; END IF;
    IF v_task.campaign_id IS NOT NULL THEN
        SELECT * INTO v_campaign FROM public.campaigns WHERE id = v_task.campaign_id;
        IF v_campaign.status <> 'active' THEN RAISE EXCEPTION 'task_not_available'; END IF;
        IF v_campaign.business_id = v_uid THEN RAISE EXCEPTION 'own_campaign'; END IF;
    END IF;

    INSERT INTO public.task_starts (user_id, task_id, campaign_id, start_ref)
    VALUES (v_uid, v_task.id, v_task.campaign_id, upper(substr(md5(gen_random_uuid()::text), 1, 12)))
    ON CONFLICT (user_id, task_id) DO NOTHING;
    SELECT * INTO v_start FROM public.task_starts WHERE user_id = v_uid AND task_id = v_task.id;

    RETURN jsonb_build_object(
        'success', true,
        'started_at', v_start.started_at,
        'start_ref', v_start.start_ref,
        'code_mode', v_campaign.completion_code_mode,
        'needs_code', v_campaign.completion_code_mode IS NOT NULL,
        'approval_mode', v_campaign.approval_mode,
        'min_seconds', v_cfg.min_task_seconds,
        'review_window_hours', v_cfg.review_window_hours
    );
END;
$$;

-- -------------------------------------------------------------------------
-- 10. SERVICE: record a server-computed screenshot hash (first write wins)
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_proof_hash(
    p_user_id UUID, p_path TEXT, p_sha256 TEXT, p_size BIGINT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF p_path IS NULL OR p_path NOT LIKE p_user_id::text || '/%' THEN RAISE EXCEPTION 'invalid_proof_path'; END IF;
    IF lower(COALESCE(p_sha256, '')) !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid_sha256'; END IF;
    INSERT INTO public.proof_hashes (path, user_id, sha256, size_bytes)
    VALUES (p_path, p_user_id, lower(p_sha256), p_size)
    ON CONFLICT (path) DO NOTHING;
    RETURN jsonb_build_object('success', true);
END;
$$;

-- -------------------------------------------------------------------------
-- 11. MONEY CORE (internal; never granted to clients)
-- -------------------------------------------------------------------------

-- 11a. Referral bonus: once, and only from RELEASED third-party work
--      (009 rules otherwise: third-party campaigns, fee cover, per-referrer cap).
CREATE OR REPLACE FUNCTION public._maybe_pay_referral(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_cfg public.marketplace_settings%ROWTYPE;
    v_ref public.referrals%ROWTYPE;
    v_paid_bonuses INT;
    v_referrer_bonus NUMERIC(14,2) := 0;
    v_referee_bonus NUMERIC(14,2) := 0;
    v_qual_tasks INT := 0;
    v_qual_fee NUMERIC(14,2) := 0;
BEGIN
    SELECT * INTO v_cfg FROM public.marketplace_settings WHERE id = 1;
    SELECT * INTO v_ref FROM public.referrals
     WHERE referee_id = p_user_id AND bonus_status = 'pending'
     FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('paid', false); END IF;

    SELECT COUNT(*), COALESCE(SUM(tc.paid_amount * c.platform_fee_rate), 0)
      INTO v_qual_tasks, v_qual_fee
      FROM public.task_completions tc
      JOIN public.campaigns c ON c.id = tc.campaign_id
     WHERE tc.user_id = p_user_id
       AND lower(tc.status) = 'approved'
       AND tc.payout_status = 'released'
       AND c.business_id <> p_user_id
       AND c.business_id <> v_ref.referrer_id;

    IF v_qual_tasks < v_cfg.referral_qualifying_tasks THEN
        RETURN jsonb_build_object('paid', false, 'qualifying', v_qual_tasks);
    END IF;

    v_referee_bonus := v_cfg.referral_bonus_referee;
    SELECT COUNT(*) INTO v_paid_bonuses FROM public.referrals
     WHERE referrer_id = v_ref.referrer_id AND bonus_status = 'paid';
    IF v_ref.referrer_id <> p_user_id AND v_paid_bonuses < v_cfg.referral_max_bonuses_per_referrer THEN
        v_referrer_bonus := v_cfg.referral_bonus_referrer;
    END IF;

    IF COALESCE(v_cfg.referral_require_fee_cover, TRUE) AND v_qual_fee < v_referrer_bonus + v_referee_bonus THEN
        RETURN jsonb_build_object('paid', false, 'qualifying', v_qual_tasks, 'fee_short', true);
    END IF;

    IF v_referee_bonus > 0 THEN
        PERFORM 1 FROM public.profiles WHERE id = p_user_id FOR UPDATE;
        INSERT INTO public.transactions (user_id, type, amount, status, reference, title, description)
        VALUES (p_user_id, 'referral_bonus', v_referee_bonus, 'settled',
                'refb_ee_' || v_ref.id::text, 'Welcome Bonus',
                'Your first ' || v_cfg.referral_qualifying_tasks || ' tasks were approved')
        ON CONFLICT (reference) DO NOTHING;
        UPDATE public.profiles SET withdrawable_balance = withdrawable_balance + v_referee_bonus
         WHERE id = p_user_id;
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

    RETURN jsonb_build_object('paid', true, 'referrer', v_referrer_bonus, 'referee', v_referee_bonus);
END;
$$;

-- 11b. Release one held payout: pending -> withdrawable. Idempotent, row-locked.
CREATE OR REPLACE FUNCTION public._release_submission(p_completion_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_sub public.task_completions%ROWTYPE;
    v_amt NUMERIC(14,2);
BEGIN
    SELECT * INTO v_sub FROM public.task_completions WHERE id = p_completion_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'completion_not_found'; END IF;
    IF v_sub.payout_status IS DISTINCT FROM 'held' OR lower(v_sub.status) <> 'approved' THEN
        RETURN jsonb_build_object('success', true, 'duplicate', true, 'payout_status', v_sub.payout_status);
    END IF;
    IF v_sub.review_deadline_at > NOW() THEN
        RETURN jsonb_build_object('success', false, 'error', 'window_open', 'release_at', v_sub.review_deadline_at);
    END IF;

    v_amt := v_sub.paid_amount;
    PERFORM 1 FROM public.profiles WHERE id = v_sub.user_id FOR UPDATE;
    UPDATE public.profiles
       SET pending_balance = pending_balance - v_amt,
           withdrawable_balance = withdrawable_balance + v_amt
     WHERE id = v_sub.user_id;
    UPDATE public.transactions
       SET status = 'settled', updated_at = NOW(),
           title = left('Task Reward: ' || v_sub.task_title, 120)
     WHERE reference = 'task_' || v_sub.id::text AND lower(status) = 'pending';
    UPDATE public.task_completions
       SET payout_status = 'released', released_at = NOW()
     WHERE id = v_sub.id;

    PERFORM public._maybe_pay_referral(v_sub.user_id);
    RETURN jsonb_build_object('success', true, 'released', v_amt);
END;
$$;

-- 11c. Approve a pending submission (caller has authorised). Credits PENDING.
CREATE OR REPLACE FUNCTION public._approve_submission(
    p_completion_id UUID, p_source TEXT, p_reviewer UUID, p_note TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_cfg public.marketplace_settings%ROWTYPE;
    v_sub public.task_completions%ROWTYPE;
    v_campaign public.campaigns%ROWTYPE;
    v_task public.tasks%ROWTYPE;
    v_reward NUMERIC(14,2);
    v_deadline TIMESTAMPTZ;
    v_released BOOLEAN := FALSE;
BEGIN
    SELECT * INTO v_cfg FROM public.marketplace_settings WHERE id = 1;
    SELECT * INTO v_sub FROM public.task_completions WHERE id = p_completion_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'completion_not_found'; END IF;
    IF lower(v_sub.status) <> 'pending' THEN
        RETURN jsonb_build_object('success', true, 'duplicate', true, 'status', v_sub.status);
    END IF;

    IF v_sub.campaign_id IS NOT NULL THEN
        SELECT * INTO v_campaign FROM public.campaigns WHERE id = v_sub.campaign_id FOR UPDATE;
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
        -- Platform-owned task (admin only)
        SELECT * INTO v_task FROM public.tasks WHERE id = v_sub.task_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'task_not_found'; END IF;
        v_reward := LEAST(v_task.reward, v_sub.reward_amount);
    END IF;

    v_deadline := COALESCE(v_sub.review_deadline_at,
                           v_sub.completed_at + make_interval(hours => v_cfg.review_window_hours));

    PERFORM 1 FROM public.profiles WHERE id = v_sub.user_id FOR UPDATE;

    INSERT INTO public.transactions (user_id, type, amount, status, reference, title, description, metadata)
    VALUES (v_sub.user_id, 'task_payout', v_reward, 'pending',
            'task_' || v_sub.id::text, left('Task Reward (pending): ' || v_sub.task_title, 120), v_sub.company,
            jsonb_build_object('completion_id', v_sub.id, 'campaign_id', v_sub.campaign_id,
                               'release_at', v_deadline, 'approval_source', p_source));

    UPDATE public.profiles
       SET pending_balance = pending_balance + v_reward,
           approved_task_count = approved_task_count + 1,
           first_task_approved_at = COALESCE(first_task_approved_at, NOW()),
           payout_eligible_from = COALESCE(payout_eligible_from,
                                           NOW() + make_interval(hours => v_cfg.payout_cooldown_hours))
     WHERE id = v_sub.user_id;

    UPDATE public.task_completions
       SET status = 'approved', review_note = left(p_note, 500), paid_amount = v_reward,
           reviewed_by = p_reviewer, reviewed_at = NOW(),
           approval_source = p_source, payout_status = 'held', review_deadline_at = v_deadline,
           sla_time = 'Approved'
     WHERE id = v_sub.id;

    -- Window already closed (auto-approve on timeout, or a late review): release now.
    IF v_deadline <= NOW() THEN
        PERFORM public._release_submission(v_sub.id);
        v_released := TRUE;
    END IF;

    RETURN jsonb_build_object('success', true, 'status', 'approved', 'credited', v_reward,
                              'payout_status', CASE WHEN v_released THEN 'released' ELSE 'held' END,
                              'release_at', v_deadline, 'approval_source', p_source);
END;
$$;

-- 11d. Reject a submission that is still pending review (009 behaviour).
CREATE OR REPLACE FUNCTION public._reject_pending(
    p_completion_id UUID, p_reviewer UUID, p_note TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_sub public.task_completions%ROWTYPE;
    v_campaign public.campaigns%ROWTYPE;
    v_fee_refund NUMERIC(14,2);
BEGIN
    SELECT * INTO v_sub FROM public.task_completions WHERE id = p_completion_id FOR UPDATE;
    IF lower(v_sub.status) <> 'pending' THEN
        RETURN jsonb_build_object('success', true, 'duplicate', true, 'status', v_sub.status);
    END IF;
    UPDATE public.task_completions
       SET status = 'rejected', review_note = left(p_note, 500),
           reviewed_by = p_reviewer, reviewed_at = NOW(), sla_time = 'Rejected'
     WHERE id = v_sub.id;

    IF v_sub.campaign_id IS NOT NULL THEN
        SELECT * INTO v_campaign FROM public.campaigns WHERE id = v_sub.campaign_id FOR UPDATE;
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
END;
$$;

-- 11e. Reject an APPROVED submission inside its window: reverse the pending
--      credit and return the reward to campaign escrow (ledger-balanced).
CREATE OR REPLACE FUNCTION public._reverse_submission(
    p_completion_id UUID, p_reviewer UUID, p_note TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_sub public.task_completions%ROWTYPE;
    v_campaign public.campaigns%ROWTYPE;
    v_amt NUMERIC(14,2);
    v_fee_refund NUMERIC(14,2);
BEGIN
    SELECT * INTO v_sub FROM public.task_completions WHERE id = p_completion_id FOR UPDATE;
    IF lower(v_sub.status) <> 'approved' OR v_sub.payout_status IS DISTINCT FROM 'held' THEN
        RAISE EXCEPTION 'not_reversible';
    END IF;
    IF v_sub.review_deadline_at <= NOW() THEN RAISE EXCEPTION 'review_window_closed'; END IF;
    v_amt := v_sub.paid_amount;

    IF v_sub.campaign_id IS NOT NULL THEN
        SELECT * INTO v_campaign FROM public.campaigns WHERE id = v_sub.campaign_id FOR UPDATE;
        UPDATE public.campaigns
           SET escrow_balance = escrow_balance + v_amt,
               slots_approved = slots_approved - 1,
               status = CASE WHEN status = 'completed' THEN 'active' ELSE status END
         WHERE id = v_campaign.id;
        INSERT INTO public.campaign_ledger (campaign_id, entry_type, amount, reference, completion_id, worker_id)
        VALUES (v_campaign.id, 'payout_reversal', v_amt, 'reversal_' || v_sub.id::text, v_sub.id, v_sub.user_id);

        IF v_campaign.status IN ('active', 'paused', 'completed') THEN
            -- The slot opens up again for another worker.
            UPDATE public.tasks
               SET spots_left = LEAST(spots_total, spots_left + 1),
                   is_active = CASE WHEN v_campaign.status IN ('active', 'completed') THEN TRUE ELSE is_active END
             WHERE campaign_id = v_campaign.id;
        ELSIF v_campaign.status = 'cancelled' THEN
            -- Campaign is over: the returned reward is owed back to the business.
            SELECT * INTO v_campaign FROM public.campaigns WHERE id = v_sub.campaign_id;
            v_fee_refund := public._fee_refund_for(v_campaign, v_amt, FALSE);
            UPDATE public.campaigns
               SET escrow_balance = escrow_balance - v_amt,
                   fee_refund_due = fee_refund_due + v_fee_refund,
                   refund_due = refund_due + v_amt + v_fee_refund
             WHERE id = v_campaign.id;
            INSERT INTO public.campaign_ledger (campaign_id, entry_type, amount, reference, completion_id)
            VALUES (v_campaign.id, 'refund_due', v_amt, 'refund_rev_' || v_sub.id::text, v_sub.id);
            IF v_fee_refund > 0 THEN
                INSERT INTO public.campaign_ledger (campaign_id, entry_type, amount, reference, completion_id)
                VALUES (v_campaign.id, 'fee_refund_due', v_fee_refund, 'feerefund_rev_' || v_sub.id::text, v_sub.id);
            END IF;
        END IF;
    END IF;

    PERFORM 1 FROM public.profiles WHERE id = v_sub.user_id FOR UPDATE;
    UPDATE public.profiles
       SET pending_balance = pending_balance - v_amt,
           approved_task_count = GREATEST(0, approved_task_count - 1)
     WHERE id = v_sub.user_id;
    UPDATE public.transactions
       SET status = 'reversed', updated_at = NOW(),
           title = left('Task Reward reversed: ' || v_sub.task_title, 120)
     WHERE reference = 'task_' || v_sub.id::text AND lower(status) = 'pending';
    UPDATE public.task_completions
       SET status = 'rejected', payout_status = 'reversed', reversed_at = NOW(),
           review_note = left(p_note, 500), reviewed_by = p_reviewer, reviewed_at = NOW(),
           sla_time = 'Rejected'
     WHERE id = v_sub.id;

    RETURN jsonb_build_object('success', true, 'status', 'rejected', 'reversed', v_amt);
END;
$$;

-- 11f. Review entry (owner / admin / service). Same signature as 008/009, so
--      review_submission() and approve_task_completion() route through it.
CREATE OR REPLACE FUNCTION public._review_submission_core(
    p_completion_id UUID, p_approve BOOLEAN, p_note TEXT, p_reviewer UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_sub public.task_completions%ROWTYPE;
    v_campaign public.campaigns%ROWTYPE;
    v_is_admin BOOLEAN := FALSE;
BEGIN
    SELECT * INTO v_sub FROM public.task_completions WHERE id = p_completion_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'completion_not_found'; END IF;

    IF p_reviewer IS NULL THEN
        v_is_admin := TRUE;
    ELSE
        SELECT (role = 'admin') INTO v_is_admin FROM public.profiles WHERE id = p_reviewer;
        v_is_admin := COALESCE(v_is_admin, FALSE);
    END IF;

    IF v_sub.campaign_id IS NOT NULL THEN
        SELECT * INTO v_campaign FROM public.campaigns WHERE id = v_sub.campaign_id;
        IF NOT v_is_admin AND v_campaign.business_id IS DISTINCT FROM p_reviewer THEN
            RAISE EXCEPTION 'not_campaign_owner';
        END IF;
    ELSIF NOT v_is_admin THEN
        RAISE EXCEPTION 'admin_required';
    END IF;

    IF v_sub.user_id = p_reviewer THEN RAISE EXCEPTION 'cannot_review_own_submission'; END IF;

    IF lower(v_sub.status) = 'pending' THEN
        IF p_approve THEN
            RETURN public._approve_submission(v_sub.id,
                CASE WHEN v_is_admin AND v_campaign.business_id IS DISTINCT FROM p_reviewer
                     THEN 'admin' ELSE 'business' END,
                p_reviewer, p_note);
        END IF;
        -- After the window closes the worker is owed the auto-approval;
        -- only an admin can still reject.
        IF v_sub.review_deadline_at IS NOT NULL AND v_sub.review_deadline_at <= NOW() AND NOT v_is_admin THEN
            RAISE EXCEPTION 'review_window_closed';
        END IF;
        RETURN public._reject_pending(v_sub.id, p_reviewer, p_note);
    END IF;

    IF NOT p_approve AND lower(v_sub.status) = 'approved' AND v_sub.payout_status = 'held' THEN
        RETURN public._reverse_submission(v_sub.id, p_reviewer, p_note);
    END IF;
    IF NOT p_approve AND lower(v_sub.status) = 'approved' THEN
        RAISE EXCEPTION 'review_window_closed';
    END IF;

    RETURN jsonb_build_object('success', true, 'duplicate', true, 'status', v_sub.status);
END;
$$;

-- -------------------------------------------------------------------------
-- 12. WORKER: SUBMIT PROOF (+ automatic checks, routing, instant approval)
--     Old 3-argument version dropped so PostgREST sees one function; old
--     app builds still work because the new argument has a default.
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.submit_task(TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.submit_task(
    p_task_id TEXT,
    p_proof_text TEXT DEFAULT NULL,
    p_proof_url TEXT DEFAULT NULL,
    p_completion_code TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_cfg public.marketplace_settings%ROWTYPE;
    v_task public.tasks%ROWTYPE;
    v_campaign public.campaigns%ROWTYPE;
    v_secret public.campaign_secrets%ROWTYPE;
    v_start public.task_starts%ROWTYPE;
    v_completion_id UUID;
    v_text TEXT := NULLIF(left(trim(COALESCE(p_proof_text, '')), 2000), '');
    v_url TEXT := NULLIF(trim(COALESCE(p_proof_url, '')), '');
    v_code TEXT := NULLIF(left(trim(COALESCE(p_completion_code, '')), 128), '');
    v_flags TEXT[] := '{}';
    v_reasons TEXT[] := '{}';
    v_code_status TEXT;
    v_link_norm TEXT;
    v_text_hash TEXT;
    v_sha TEXT;
    v_etag TEXT;
    v_trust INT;
    v_host TEXT;
    v_target_host TEXT;
    v_deadline TIMESTAMPTZ;
    v_res JSONB;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
    SELECT * INTO v_cfg FROM public.marketplace_settings WHERE id = 1;

    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
    IF NOT FOUND OR NOT v_task.is_active THEN RAISE EXCEPTION 'task_not_available'; END IF;

    IF v_text IS NULL AND v_url IS NULL AND v_code IS NULL THEN RAISE EXCEPTION 'proof_required'; END IF;
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
    -- A text task may be answered with the completion code alone.
    IF v_text IS NULL AND v_url IS NULL AND v_campaign.completion_code_mode IS NULL THEN
        RAISE EXCEPTION 'proof_required';
    END IF;

    SELECT * INTO v_start FROM public.task_starts WHERE user_id = v_uid AND task_id = v_task.id;
    v_deadline := NOW() + make_interval(hours => v_cfg.review_window_hours);

    BEGIN
        INSERT INTO public.task_completions (
            user_id, task_id, task_title, company, reward_amount, category,
            proof_text, proof_screenshot_url, status, sla_time, campaign_id,
            started_at, review_deadline_at
        ) VALUES (
            v_uid, v_task.id, v_task.title, v_task.company, v_task.reward, v_task.category,
            v_text, v_url, 'pending', 'Awaiting review', v_task.campaign_id,
            v_start.started_at, v_deadline
        ) RETURNING id INTO v_completion_id;
    EXCEPTION
        WHEN unique_violation THEN RAISE EXCEPTION 'already_submitted';
    END;

    IF v_task.campaign_id IS NULL THEN
        RETURN jsonb_build_object('success', true, 'completion_id', v_completion_id, 'status', 'pending',
                                  'instant', false, 'review_deadline_at', v_deadline);
    END IF;

    UPDATE public.campaigns SET slots_pending = slots_pending + 1 WHERE id = v_task.campaign_id;
    UPDATE public.tasks SET spots_left = GREATEST(0, spots_left - 1) WHERE id = v_task.id;

    -- ---- Automatic checks (the campaign row is locked, so they serialise) --
    -- Minimum time since start_task()
    IF v_start.started_at IS NULL THEN
        v_flags := v_flags || 'not_started'::text;
    ELSIF NOW() - v_start.started_at < make_interval(secs => v_cfg.min_task_seconds) THEN
        v_flags := v_flags || 'too_fast'::text;
    END IF;

    -- Completion code (never stored in plain text on the submission)
    IF v_campaign.completion_code_mode IS NOT NULL THEN
        SELECT * INTO v_secret FROM public.campaign_secrets WHERE campaign_id = v_campaign.id;
        IF v_code IS NULL THEN
            v_code_status := 'missing';
        ELSIF v_campaign.completion_code_mode = 'shared' AND v_secret.code_hash IS NOT NULL
              AND public._code_hash(v_secret.code_salt, v_code) = v_secret.code_hash THEN
            v_code_status := 'match';
        ELSIF v_campaign.completion_code_mode = 'unique' AND v_secret.unique_secret IS NOT NULL
              AND v_start.start_ref IS NOT NULL
              AND public._unique_code(v_secret.unique_secret, v_start.start_ref) = upper(v_code) THEN
            v_code_status := 'match';
        ELSE
            v_code_status := 'mismatch';
        END IF;
        IF v_code_status = 'missing' THEN v_flags := v_flags || 'missing_code'::text; END IF;
        IF v_code_status = 'mismatch' THEN v_flags := v_flags || 'wrong_code'::text; END IF;
    END IF;

    -- Link proof: https, matching domain, not reused in this campaign
    IF v_task.proof_type = 'link' THEN
        v_link_norm := public._norm_link(v_text);
        v_host := public._url_host(v_text);
        IF v_text !~* '^https://' THEN v_flags := v_flags || 'link_not_https'::text; END IF;
        IF v_host IS NULL OR v_host !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' THEN
            v_flags := v_flags || 'link_invalid'::text;
        END IF;
        v_target_host := public._url_host(v_campaign.target_url);
        IF v_target_host IS NOT NULL AND v_host IS NOT NULL
           AND v_host <> v_target_host AND right(v_host, length(v_target_host) + 1) <> '.' || v_target_host THEN
            v_flags := v_flags || 'link_domain_mismatch'::text;
        END IF;
        IF EXISTS (SELECT 1 FROM public.task_completions
                    WHERE campaign_id = v_campaign.id AND id <> v_completion_id
                      AND proof_link_norm = v_link_norm) THEN
            v_flags := v_flags || 'duplicate_link'::text;
        END IF;
    END IF;

    -- Duplicate text answer
    IF v_task.proof_type = 'text' AND v_text IS NOT NULL THEN
        v_text_hash := md5(lower(regexp_replace(v_text, '\s+', ' ', 'g')));
        IF EXISTS (SELECT 1 FROM public.task_completions
                    WHERE campaign_id = v_campaign.id AND id <> v_completion_id
                      AND proof_text_hash = v_text_hash) THEN
            v_flags := v_flags || 'duplicate_text'::text;
        END IF;
    END IF;

    -- Duplicate screenshot: server-computed sha256 (/api/proof-hash) if
    -- recorded, otherwise the storage object's ETag + size.
    IF v_url IS NOT NULL THEN
        SELECT sha256 INTO v_sha FROM public.proof_hashes WHERE path = v_url AND user_id = v_uid;
        v_etag := public._proof_etag(v_url);
        IF v_sha IS NULL AND v_etag IS NULL THEN
            v_flags := v_flags || 'screenshot_unverified'::text;
        ELSIF EXISTS (SELECT 1 FROM public.task_completions
                       WHERE campaign_id = v_campaign.id AND id <> v_completion_id
                         AND ((v_sha IS NOT NULL AND proof_sha256 = v_sha)
                              OR (v_etag IS NOT NULL AND proof_etag = v_etag))) THEN
            v_flags := v_flags || 'duplicate_screenshot'::text;
        END IF;
    END IF;

    -- ---- Policy: always human review ---------------------------------------
    -- Trust score = approved, non-reversed submissions (reversed ones are 'rejected').
    SELECT COUNT(*) INTO v_trust FROM public.task_completions
     WHERE user_id = v_uid AND lower(status) = 'approved';
    IF v_trust < v_cfg.trusted_after_tasks THEN v_reasons := v_reasons || 'new_worker'::text; END IF;
    IF v_campaign.reward_per_completion > v_cfg.human_review_reward_above THEN v_reasons := v_reasons || 'high_reward'::text; END IF;
    IF v_campaign.category IN ('Field Audits', 'Product Feedback') THEN v_reasons := v_reasons || 'category_review'::text; END IF;
    IF v_campaign.approval_mode <> 'instant' THEN v_reasons := v_reasons || 'business_review'::text; END IF;
    IF v_campaign.approval_mode = 'instant' AND v_campaign.completion_code_mode IS NULL
       AND NOT (v_task.proof_type = 'link' AND public._url_host(v_campaign.target_url) IS NOT NULL) THEN
        v_reasons := v_reasons || 'no_automatic_check'::text;
    END IF;

    UPDATE public.task_completions
       SET check_flags = v_flags, review_reasons = v_reasons, code_status = v_code_status,
           proof_link_norm = v_link_norm, proof_text_hash = v_text_hash,
           proof_sha256 = v_sha, proof_etag = v_etag
     WHERE id = v_completion_id;

    IF cardinality(v_flags) = 0 AND cardinality(v_reasons) = 0 THEN
        v_res := public._approve_submission(v_completion_id, 'instant', NULL, 'Passed automatic checks');
        RETURN jsonb_build_object('success', true, 'completion_id', v_completion_id, 'status', 'approved',
                                  'instant', true, 'payout_status', v_res->>'payout_status',
                                  'credited', (v_res->>'credited')::numeric,
                                  'release_at', v_res->'release_at');
    END IF;

    RETURN jsonb_build_object('success', true, 'completion_id', v_completion_id, 'status', 'pending',
                              'instant', false, 'review_deadline_at', v_deadline);
END;
$$;

-- -------------------------------------------------------------------------
-- 13. WINDOW PROCESSING: auto-approve unreviewed + release closed windows
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._process_review_windows(p_user UUID, p_limit INT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_cfg public.marketplace_settings%ROWTYPE;
    r RECORD;
    v_auto INT := 0;
    v_released INT := 0;
    v_errors INT := 0;
    v_res JSONB;
    v_lim INT := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 5000);
BEGIN
    SELECT * INTO v_cfg FROM public.marketplace_settings WHERE id = 1;

    -- Unreviewed campaign submissions whose window closed: auto-approve
    -- (and, because the window is closed, release in the same step).
    FOR r IN
        SELECT tc.id FROM public.task_completions tc
          JOIN public.campaigns c ON c.id = tc.campaign_id
         WHERE lower(tc.status) = 'pending'
           AND tc.review_deadline_at <= NOW()
           AND (p_user IS NULL OR tc.user_id = p_user OR c.business_id = p_user)
         ORDER BY tc.review_deadline_at
         LIMIT v_lim
         FOR UPDATE OF tc SKIP LOCKED
    LOOP
        BEGIN
            PERFORM public._approve_submission(r.id, 'auto_timeout', NULL,
                'Auto-approved: not reviewed within ' || v_cfg.review_window_hours || 'h');
            v_auto := v_auto + 1;
        EXCEPTION WHEN OTHERS THEN
            v_errors := v_errors + 1;
            RAISE WARNING 'auto-approve % failed: %', r.id, SQLERRM;
        END;
    END LOOP;

    -- Approved, held, window closed: release pending -> withdrawable.
    FOR r IN
        SELECT tc.id FROM public.task_completions tc
          LEFT JOIN public.campaigns c ON c.id = tc.campaign_id
         WHERE tc.payout_status = 'held'
           AND tc.review_deadline_at <= NOW()
           AND (p_user IS NULL OR tc.user_id = p_user OR c.business_id = p_user)
         ORDER BY tc.review_deadline_at
         LIMIT v_lim
         FOR UPDATE OF tc SKIP LOCKED
    LOOP
        BEGIN
            v_res := public._release_submission(r.id);
            IF (v_res->>'released') IS NOT NULL THEN v_released := v_released + 1; END IF;
        EXCEPTION WHEN OTHERS THEN
            v_errors := v_errors + 1;
            RAISE WARNING 'release % failed: %', r.id, SQLERRM;
        END;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'auto_approved', v_auto, 'released', v_released, 'errors', v_errors);
END;
$$;

-- Service role / pg_cron / Vercel cron: everything that is due.
CREATE OR REPLACE FUNCTION public.process_review_windows(p_limit INT DEFAULT 500)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    RETURN public._process_review_windows(NULL, p_limit);
END;
$$;

-- Signed-in user: only their own submissions / their own campaigns' items.
-- Safe for clients: it only does what the scheduler would do anyway.
CREATE OR REPLACE FUNCTION public.process_my_review_windows()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
    RETURN public._process_review_windows(auth.uid(), 200);
END;
$$;

-- Release one submission (service role). Idempotent.
CREATE OR REPLACE FUNCTION public.release_submission_payout(p_completion_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    RETURN public._release_submission(p_completion_id);
END;
$$;

-- -------------------------------------------------------------------------
-- 14. REVIEW LIST: + window, flags, approval source
--     (return type changed, so drop and recreate). p_status 'held' = approved
--     and still inside the review window (can be rejected).
-- -------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.list_review_submissions(UUID, TEXT, INT);
CREATE FUNCTION public.list_review_submissions(
    p_campaign_id UUID DEFAULT NULL, p_status TEXT DEFAULT 'pending', p_limit INT DEFAULT 50
) RETURNS TABLE (
    id UUID, campaign_id UUID, campaign_title TEXT, task_id TEXT, worker_username TEXT,
    proof_text TEXT, proof_screenshot_url TEXT, reward_amount NUMERIC, status TEXT,
    review_note TEXT, completed_at TIMESTAMPTZ, reviewed_at TIMESTAMPTZ,
    approval_mode TEXT, approval_source TEXT, payout_status TEXT, review_deadline_at TIMESTAMPTZ,
    check_flags TEXT[], review_reasons TEXT[], code_status TEXT, started_at TIMESTAMPTZ
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
           COALESCE(tc.paid_amount, c.reward_per_completion, tc.reward_amount), tc.status::TEXT,
           tc.review_note, tc.completed_at, tc.reviewed_at,
           c.approval_mode::TEXT, tc.approval_source::TEXT, tc.payout_status::TEXT, tc.review_deadline_at,
           tc.check_flags, tc.review_reasons, tc.code_status::TEXT, tc.started_at
      FROM public.task_completions tc
      LEFT JOIN public.campaigns c ON c.id = tc.campaign_id
      JOIN public.profiles p ON p.id = tc.user_id
     WHERE (p_campaign_id IS NULL OR tc.campaign_id = p_campaign_id)
       AND (p_status IS NULL
            OR (lower(p_status) = 'held' AND lower(tc.status) = 'approved' AND tc.payout_status = 'held')
            OR (lower(p_status) <> 'held' AND lower(tc.status) = lower(p_status)))
       AND (v_admin OR c.business_id = v_uid)
     ORDER BY CASE WHEN lower(COALESCE(p_status, '')) IN ('pending', 'held') THEN tc.review_deadline_at END ASC NULLS LAST,
              tc.completed_at ASC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
END;
$$;

-- -------------------------------------------------------------------------
-- 15. RECONCILIATION: reversals return money to escrow
-- -------------------------------------------------------------------------
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
               COALESCE(SUM(cl.amount) FILTER (WHERE cl.entry_type = 'payout'), 0)
                 - COALESCE(SUM(cl.amount) FILTER (WHERE cl.entry_type = 'payout_reversal'), 0) AS po,
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
         WHERE tc.campaign_id IS NOT NULL AND lower(tx.status) <> 'reversed'
         GROUP BY tc.campaign_id
    )
    SELECT l.id, l.f, l.po, l.rr, l.e, l.f - l.po - l.rr - l.e,
           CASE WHEN l.f <> l.po + l.rr + l.e THEN 'funding <> net payouts + refunds + escrow'
                WHEN l.po <> COALESCE(p.credited, 0) THEN 'ledger net payouts <> wallet credits'
                WHEN l.po <> l.slots_approved * l.reward_per_completion THEN 'net payouts <> approved slots x reward'
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

-- Wallet check: every user's pending balance = legacy pending snapshot +
-- task payouts still held in a review window. Rows returned = mismatches.
CREATE OR REPLACE FUNCTION public.pending_hold_check()
RETURNS TABLE (user_id UUID, pending_balance NUMERIC, legacy_pending NUMERIC, held NUMERIC, difference NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN RAISE EXCEPTION 'admin_required'; END IF;
    RETURN QUERY
    SELECT p.id, p.pending_balance, COALESCE(s.pending_balance, 0), COALESCE(h.held, 0),
           p.pending_balance - COALESCE(s.pending_balance, 0) - COALESCE(h.held, 0)
      FROM public.profiles p
      LEFT JOIN public.legacy_balance_snapshots s ON s.user_id = p.id
      LEFT JOIN (SELECT tc.user_id AS uid, SUM(tc.paid_amount) AS held
                   FROM public.task_completions tc WHERE tc.payout_status = 'held'
                  GROUP BY tc.user_id) h ON h.uid = p.id
     WHERE p.pending_balance <> COALESCE(s.pending_balance, 0) + COALESCE(h.held, 0);
END;
$$;

-- -------------------------------------------------------------------------
-- 16. PRIVILEGES. Supabase's default privileges grant EXECUTE on new
--     functions to anon, so every function is revoked explicitly.
-- -------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._url_host(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._norm_link(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._code_hash(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._unique_code(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._proof_etag(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._maybe_pay_referral(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._release_submission(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._approve_submission(UUID, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._reject_pending(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._reverse_submission(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._review_submission_core(UUID, BOOLEAN, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._process_review_windows(UUID, INT) FROM PUBLIC, anon, authenticated;

-- service_role only
REVOKE ALL ON FUNCTION public.record_proof_hash(UUID, TEXT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_review_windows(INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_submission_payout(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approve_task_completion(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_proof_hash(UUID, TEXT, TEXT, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_review_windows(INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_submission_payout(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_task_completion(UUID) TO service_role;

-- signed-in users (identity always from auth.uid())
REVOKE ALL ON FUNCTION public.resolve_approval_mode(TEXT, TEXT, BOOLEAN, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_campaign(TEXT, TEXT, TEXT, TEXT, NUMERIC, INT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.start_task(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_task(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.process_my_review_windows() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_review_submissions(UUID, TEXT, INT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.review_submission(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.campaign_ledger_check() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pending_hold_check() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_approval_mode(TEXT, TEXT, BOOLEAN, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_campaign(TEXT, TEXT, TEXT, TEXT, NUMERIC, INT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_task(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_task(TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_my_review_windows() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_review_submissions(UUID, TEXT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_submission(UUID, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_ledger_check() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pending_hold_check() TO authenticated, service_role;

-- New tables: nothing for anon or signed-in clients (RLS on, no policies).
REVOKE ALL ON public.campaign_secrets, public.task_starts, public.proof_hashes FROM PUBLIC, anon, authenticated;

-- -------------------------------------------------------------------------
-- 17. SCHEDULE: pg_cron every 10 minutes if available; otherwise a notice
--     (use the Vercel cron route /api/process-review-windows instead).
-- -------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
       AND EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
        BEGIN
            CREATE EXTENSION IF NOT EXISTS pg_cron;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'pg_cron could not be enabled here (%); use the Vercel cron route instead', SQLERRM;
        END;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        BEGIN
            EXECUTE $c$SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'taskpulse-review-windows'$c$;
            EXECUTE $c$SELECT cron.schedule('taskpulse-review-windows', '*/10 * * * *',
                                            'SELECT public.process_review_windows(1000)')$c$;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'pg_cron schedule failed (%); use the Vercel cron route instead', SQLERRM;
        END;
    ELSE
        RAISE NOTICE 'pg_cron not available: schedule /api/process-review-windows instead';
    END IF;
END $$;

COMMIT;

-- =========================================================================
-- AFTER RUNNING (read-only checks; the SQL editor runs as postgres)
--   SELECT * FROM public.campaign_ledger_check();   -- expect 0 rows
--   SELECT * FROM public.pending_hold_check();      -- expect 0 rows
--   SELECT jobname, schedule FROM cron.job;         -- if pg_cron is enabled
-- Settings (single row):
--   UPDATE public.marketplace_settings SET review_window_hours = 24,
--          trusted_after_tasks = 3, human_review_reward_above = 1000,
--          min_task_seconds = 60 WHERE id = 1;
-- =========================================================================

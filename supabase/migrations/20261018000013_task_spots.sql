-- =========================================================================
-- TaskPulse 013: task spots (accept holds a spot; spots-left counts)
-- -------------------------------------------------------------------------
-- Idempotent: safe to run more than once. Run AFTER 012 (and after 011 if
-- feat/fast-approvals has been merged; the two do not redefine each other's
-- functions, so either order works).
--
-- What counts as a "taken" spot on a campaign task:
--     slots_approved + slots_pending + slots_held
--   * held     = accepted by a worker, not yet submitted (this migration)
--   * pending  = proof submitted, awaiting review (existing)
--   * approved = paid (existing)
-- A spot is freed when a submission is rejected (existing behaviour), when the
-- worker gives it up (abandon_task), or when an unsubmitted hold expires
-- (marketplace_settings.spot_hold_hours, default 24h; tasks have no deadline
-- column today).
--
-- Concurrency: accept_task() and the task_completions trigger both lock the
-- campaign row (SELECT ... FOR UPDATE), the same lock submit_task() already
-- takes, so two people can never take the last spot.
--
-- tasks.spots_left stays the public, client-readable number (anon/auth can
-- already read active tasks), now kept equal to
--     slots - approved - pending - held.
-- No other user's data is exposed: holds are readable only by their owner.
--
-- submit_task() is NOT redefined (feat/fast-approvals redefines it). The hold
-- is consumed / capacity is enforced by a BEFORE INSERT trigger on
-- task_completions instead, so it works with either version of submit_task.
-- Workers on old app builds who never call accept_task can still submit if a
-- spot is free (held spots are respected).
-- =========================================================================
BEGIN;

ALTER TABLE public.marketplace_settings
    ADD COLUMN IF NOT EXISTS spot_hold_hours INT NOT NULL DEFAULT 24;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_spot_hold_hours') THEN
        ALTER TABLE public.marketplace_settings ADD CONSTRAINT chk_spot_hold_hours
            CHECK (spot_hold_hours BETWEEN 1 AND 720);
    END IF;
END $$;

ALTER TABLE public.campaigns
    ADD COLUMN IF NOT EXISTS slots_held INT NOT NULL DEFAULT 0;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_campaign_slots_held') THEN
        ALTER TABLE public.campaigns ADD CONSTRAINT chk_campaign_slots_held CHECK (slots_held >= 0);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.task_spot_holds (
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    task_id VARCHAR(50) NOT NULL,
    campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (user_id, task_id)
);
CREATE INDEX IF NOT EXISTS idx_task_spot_holds_campaign ON public.task_spot_holds(campaign_id);
CREATE INDEX IF NOT EXISTS idx_task_spot_holds_expires ON public.task_spot_holds(expires_at);

ALTER TABLE public.task_spot_holds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.task_spot_holds FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.task_spot_holds TO authenticated;
DROP POLICY IF EXISTS "Workers view own spot holds" ON public.task_spot_holds;
CREATE POLICY "Workers view own spot holds" ON public.task_spot_holds
    FOR SELECT TO authenticated USING (user_id = auth.uid());

-- -------------------------------------------------------------------------
-- Internal: drop expired holds and recompute counts for ONE campaign.
-- Caller must hold the campaign row lock.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._sync_campaign_spots(p_campaign_id UUID)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_held INT;
BEGIN
    DELETE FROM public.task_spot_holds
     WHERE campaign_id = p_campaign_id AND expires_at <= NOW();
    SELECT count(*) INTO v_held FROM public.task_spot_holds WHERE campaign_id = p_campaign_id;
    UPDATE public.campaigns SET slots_held = v_held
     WHERE id = p_campaign_id AND slots_held IS DISTINCT FROM v_held;
    UPDATE public.tasks t
       SET spots_left = GREATEST(0, LEAST(t.spots_total, c.slots - c.slots_approved - c.slots_pending - v_held))
      FROM public.campaigns c
     WHERE c.id = p_campaign_id AND t.campaign_id = c.id
       AND t.spots_left IS DISTINCT FROM GREATEST(0, LEAST(t.spots_total, c.slots - c.slots_approved - c.slots_pending - v_held));
    RETURN v_held;
END;
$$;

-- -------------------------------------------------------------------------
-- Expiry sweep (lazy + scheduled). Frees spots whose hold ran out.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._release_expired_spot_holds(p_limit INT DEFAULT 200)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_cid UUID;
    v_n INT := 0;
BEGIN
    FOR v_cid IN
        SELECT DISTINCT campaign_id FROM public.task_spot_holds
         WHERE expires_at <= NOW() LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 1000))
    LOOP
        -- Skip campaigns someone else is working on right now; the next
        -- accept/submit on that campaign sweeps it anyway.
        PERFORM 1 FROM public.campaigns WHERE id = v_cid FOR UPDATE SKIP LOCKED;
        IF FOUND THEN
            PERFORM public._sync_campaign_spots(v_cid);
            v_n := v_n + 1;
        END IF;
    END LOOP;
    RETURN v_n;
END;
$$;

-- Client-callable (signed-in users): only does what the scheduler would do.
CREATE OR REPLACE FUNCTION public.release_expired_spot_holds()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.task_spot_holds WHERE expires_at <= NOW()) THEN
        RETURN 0;
    END IF;
    RETURN public._release_expired_spot_holds(50);
END;
$$;

-- -------------------------------------------------------------------------
-- WORKER: accept a task (holds one spot). Idempotent per worker + task.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_task(p_task_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_task public.tasks%ROWTYPE;
    v_campaign public.campaigns%ROWTYPE;
    v_hold public.task_spot_holds%ROWTYPE;
    v_hours INT;
    v_held INT;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
    IF NOT FOUND OR NOT v_task.is_active THEN RAISE EXCEPTION 'task_not_available'; END IF;
    IF v_task.campaign_id IS NULL THEN
        -- Platform task: no spot limit to hold.
        RETURN jsonb_build_object('success', true, 'held', false,
                                  'spots_left', v_task.spots_left, 'spots_total', v_task.spots_total);
    END IF;

    SELECT * INTO v_campaign FROM public.campaigns WHERE id = v_task.campaign_id FOR UPDATE;
    IF v_campaign.status <> 'active' THEN RAISE EXCEPTION 'task_not_available'; END IF;
    IF v_campaign.business_id = v_uid THEN RAISE EXCEPTION 'own_campaign'; END IF;
    IF EXISTS (SELECT 1 FROM public.task_completions WHERE user_id = v_uid AND task_id = v_task.id) THEN
        RAISE EXCEPTION 'already_submitted';
    END IF;

    v_held := public._sync_campaign_spots(v_campaign.id);   -- also drops expired holds

    SELECT * INTO v_hold FROM public.task_spot_holds WHERE user_id = v_uid AND task_id = v_task.id;
    IF NOT FOUND THEN
        IF v_campaign.slots_approved + v_campaign.slots_pending + v_held >= v_campaign.slots THEN
            RAISE EXCEPTION 'no_slots_left';
        END IF;
        SELECT COALESCE(spot_hold_hours, 24) INTO v_hours FROM public.marketplace_settings WHERE id = 1;
        INSERT INTO public.task_spot_holds (user_id, task_id, campaign_id, expires_at)
        VALUES (v_uid, v_task.id, v_campaign.id, NOW() + make_interval(hours => COALESCE(v_hours, 24)))
        RETURNING * INTO v_hold;
        PERFORM public._sync_campaign_spots(v_campaign.id);
    END IF;

    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
    RETURN jsonb_build_object('success', true, 'held', true,
                              'accepted_at', v_hold.accepted_at, 'expires_at', v_hold.expires_at,
                              'spots_left', v_task.spots_left, 'spots_total', v_task.spots_total);
END;
$$;

-- -------------------------------------------------------------------------
-- WORKER: give a held spot back.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.abandon_task(p_task_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_cid UUID;
    v_task public.tasks%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
    SELECT campaign_id INTO v_cid FROM public.task_spot_holds WHERE user_id = v_uid AND task_id = p_task_id;
    IF v_cid IS NULL THEN
        RETURN jsonb_build_object('success', true, 'released', false);
    END IF;
    PERFORM 1 FROM public.campaigns WHERE id = v_cid FOR UPDATE;
    DELETE FROM public.task_spot_holds WHERE user_id = v_uid AND task_id = p_task_id;
    PERFORM public._sync_campaign_spots(v_cid);
    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
    RETURN jsonb_build_object('success', true, 'released', true,
                              'spots_left', v_task.spots_left, 'spots_total', v_task.spots_total);
END;
$$;

-- -------------------------------------------------------------------------
-- Submitting consumes the worker's hold; without a hold, held spots count.
-- Runs inside submit_task() (either version) before its own slots_pending+1
-- and spots_left-1, so the sync below uses the pre-insert counts.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._task_completion_take_spot()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_campaign public.campaigns%ROWTYPE;
    v_had BOOLEAN;
    v_held INT;
BEGIN
    SELECT * INTO v_campaign FROM public.campaigns WHERE id = NEW.campaign_id FOR UPDATE;
    IF NOT FOUND THEN RETURN NEW; END IF;
    DELETE FROM public.task_spot_holds
     WHERE user_id = NEW.user_id AND task_id = NEW.task_id AND expires_at > NOW()
    RETURNING TRUE INTO v_had;
    v_held := public._sync_campaign_spots(v_campaign.id);
    IF v_had IS NOT TRUE AND v_campaign.slots_approved + v_campaign.slots_pending + v_held >= v_campaign.slots THEN
        RAISE EXCEPTION 'no_slots_left';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_completion_take_spot ON public.task_completions;
CREATE TRIGGER trg_task_completion_take_spot
    BEFORE INSERT ON public.task_completions
    FOR EACH ROW WHEN (NEW.campaign_id IS NOT NULL)
    EXECUTE FUNCTION public._task_completion_take_spot();

-- -------------------------------------------------------------------------
-- Grants
-- -------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._sync_campaign_spots(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._release_expired_spot_holds(INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._task_completion_take_spot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._release_expired_spot_holds(INT) TO service_role;
REVOKE ALL ON FUNCTION public.release_expired_spot_holds() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_task(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.abandon_task(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_expired_spot_holds() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_task(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.abandon_task(TEXT) TO authenticated;

-- Bring existing campaigns in line (no holds exist yet, so this is a no-op
-- unless spots_left has drifted from slots - approved - pending).
DO $$
DECLARE v_cid UUID;
BEGIN
    FOR v_cid IN SELECT id FROM public.campaigns WHERE status IN ('active', 'paused') FOR UPDATE LOOP
        PERFORM public._sync_campaign_spots(v_cid);
    END LOOP;
END $$;

-- -------------------------------------------------------------------------
-- Schedule the expiry sweep with pg_cron when available (every 10 min).
-- Without pg_cron, expiry still happens lazily on every accept, submit and
-- task-list load (release_expired_spot_holds()).
-- -------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        BEGIN
            EXECUTE $c$SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'taskpulse-spot-holds'$c$;
            EXECUTE $c$SELECT cron.schedule('taskpulse-spot-holds', '*/10 * * * *',
                                            'SELECT public._release_expired_spot_holds(1000)')$c$;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'pg_cron schedule failed (%); expiry runs lazily instead', SQLERRM;
        END;
    ELSE
        RAISE NOTICE 'pg_cron not enabled: spot-hold expiry runs lazily (accept, submit, task list)';
    END IF;
END $$;

COMMIT;

-- =========================================================================
-- AFTER RUNNING (read-only checks)
--   -- expect 0 rows: spots_left matches slots - approved - pending - held
--   SELECT c.id, c.slots, c.slots_approved, c.slots_pending, c.slots_held, t.spots_left
--     FROM public.campaigns c JOIN public.tasks t ON t.campaign_id = c.id
--    WHERE c.status = 'active'
--      AND t.spots_left <> GREATEST(0, c.slots - c.slots_approved - c.slots_pending - c.slots_held);
-- Hold length: UPDATE public.marketplace_settings SET spot_hold_hours = 24 WHERE id = 1;
-- =========================================================================

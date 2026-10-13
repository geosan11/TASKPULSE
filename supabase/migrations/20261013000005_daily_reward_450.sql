-- ============================================================================
-- Migration: 20261013000005_daily_reward_450.sql
-- Description: Update daily login streak reward from 100 to 450 Naira.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.claim_daily_reward()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_profile public.profiles%ROWTYPE;
    v_today DATE := (NOW() AT TIME ZONE 'Africa/Lagos')::date;
    v_streak INT;
    v_reward CONSTANT NUMERIC := 450;
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
        'Daily Login Reward', 'Day ' || v_streak || ' of your login streak (+₦450)'
    );

    UPDATE public.profiles
       SET withdrawable_balance = withdrawable_balance + v_reward,
           streak_days = v_streak,
           streak_last_claimed_date = v_today
     WHERE id = v_uid;

    RETURN jsonb_build_object(
        'success', true, 
        'streak_days', v_streak,
        'reward_amount', v_reward,
        'new_balance', v_profile.withdrawable_balance + v_reward
    );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_daily_reward() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_daily_reward() TO authenticated;

-- =========================================================================
-- TASKPULSE 016 - ONE 15% PLATFORM FEE (was 25%)
-- =========================================================================
-- Run ONCE in the Supabase SQL Editor AFTER 015 (or via `supabase db push`,
-- which uses the identical copy in
-- supabase/migrations/20261030000016_fee_15.sql). Do not run both.
-- Safe to re-run; runs in a single transaction (all or nothing).
--
-- WHAT CHANGES
--   1. marketplace_settings.platform_fee_rate 0.25 -> 0.15. create_campaign()
--      and create_package_campaign() read this, so every NEW campaign and
--      package order is priced ceil(slots x reward x 1.15).
--   2. packages.platform_fee_rate -> 0.15 for every row. packages.total_price
--      is a generated column (015: CEIL(slots * reward_per_completion *
--      (1 + platform_fee_rate))), so it recalculates itself with the same
--      ceil() rounding create_package_campaign() uses:
--        10-local-ugc-reels     10 x 3,500  -> N40,250
--        campus-feedback-panel  25 x 1,500  -> N43,125
--        product-seeding-pack    5 x 7,000  -> N40,250
--        content-test-panel     50 x   500  -> N28,750
--        event-ground-squad      4 x 10,000 -> N46,000
--   3. Column defaults for new rows are 0.15 too.
--   4. The referral bonus is NOT touched here. referral_require_fee_cover
--      stays as it is (TRUE). Sanni paused the N200 bonus; the referral
--      change ships in 017 behind a pause switch that defaults to paused.
--
-- WHAT DOES NOT CHANGE
--   * Existing campaigns keep their stored platform_fee_rate, platform_fee
--     and total_charge (paid campaigns were charged 25% and their fee
--     refunds on unused slots stay at 25% of the unused reward). This also
--     applies to campaigns created but not yet paid (pending_payment): they
--     still check out at the total they were created with.
--   * Rewards (e.g. N3,500 per UGC video) are not touched.
--   * Referral settings and referrals are not touched.
-- No row is deleted. Only marketplace_settings and packages are updated.
-- =========================================================================

BEGIN;

ALTER TABLE public.marketplace_settings ALTER COLUMN platform_fee_rate SET DEFAULT 0.15;
UPDATE public.marketplace_settings
   SET platform_fee_rate = 0.15, updated_at = NOW()
 WHERE id = 1 AND platform_fee_rate IS DISTINCT FROM 0.15;

ALTER TABLE public.packages ALTER COLUMN platform_fee_rate SET DEFAULT 0.15;
UPDATE public.packages
   SET platform_fee_rate = 0.15
 WHERE platform_fee_rate IS DISTINCT FROM 0.15;

-- total_price should be generated (015). If it is a plain column in some
-- environment, set it with the same rounding as create_package_campaign().
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_attribute
                WHERE attrelid = 'public.packages'::regclass AND attname = 'total_price'
                  AND attgenerated = '') THEN
        EXECUTE 'UPDATE public.packages
                    SET total_price = ceil(slots * reward_per_completion * (1 + platform_fee_rate))
                  WHERE total_price IS DISTINCT FROM ceil(slots * reward_per_completion * (1 + platform_fee_rate))';
    END IF;
END $$;

-- Check before committing: fee 15%, every package at
-- 15% and priced at what create_package_campaign() will charge.
DO $$
DECLARE
    v_bad TEXT;
BEGIN
    IF (SELECT platform_fee_rate FROM public.marketplace_settings WHERE id = 1) IS DISTINCT FROM 0.15 THEN
        RAISE EXCEPTION '016: marketplace_settings.platform_fee_rate is not 0.15';
    END IF;
    SELECT string_agg(slug, ', ') INTO v_bad
      FROM public.packages
     WHERE platform_fee_rate <> 0.15
        OR total_price <> ceil(slots * reward_per_completion * 1.15);
    IF v_bad IS NOT NULL THEN
        RAISE EXCEPTION '016: package price not at 15%%: %', v_bad;
    END IF;
END $$;

COMMIT;

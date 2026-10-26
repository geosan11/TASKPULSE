-- 015: Packages catalog. A package is a curated, pre-priced task bundle. Ordering
-- one creates a NORMAL pending_payment campaign (+ a purchase record) that the
-- existing Paystack flow funds unchanged (/api/initialize-deposit ->
-- settle_campaign_funding). Settlement, ledger and webhook code are not touched.
--
-- Notes:
--  * The Paystack reference is generated server-side by initialize-deposit
--    (camp_<uuid>), so package_purchases.paystack_reference stays NULL.
--  * package_purchases.status is NOT advanced by settlement; read the linked
--    campaign's status for the real state.
--  * Packages are admin-curated, so create_package_campaign() does not apply the
--    per-task reward / min-slot caps of create_campaign(). Role, whole-Naira,
--    input and prohibited-content checks (on the buyer's free text) still apply,
--    and pricing uses marketplace_settings.platform_fee_rate with ceil().

-- packages catalog
CREATE TABLE IF NOT EXISTS public.packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Community & Content',
    slots INT NOT NULL CHECK (slots > 0),
    reward_per_completion NUMERIC(14,2) NOT NULL CHECK (reward_per_completion > 0),
    platform_fee_rate NUMERIC(5,4) NOT NULL DEFAULT 0.25,
    total_price NUMERIC(14,2) GENERATED ALWAYS AS (
        ROUND(slots * reward_per_completion * (1 + platform_fee_rate), 2)
    ) STORED,
    proof_type TEXT NOT NULL DEFAULT 'link' CHECK (proof_type IN ('screenshot','text','link')),
    default_instructions TEXT NOT NULL,
    proof_requirements JSONB NOT NULL DEFAULT '{}'::jsonb,
    estimated_delivery_days INT NOT NULL DEFAULT 5,
    is_active BOOLEAN NOT NULL DEFAULT true,
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.campaigns
    ADD COLUMN IF NOT EXISTS package_id UUID REFERENCES public.packages(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS package_purchase_id UUID;

CREATE TABLE IF NOT EXISTS public.package_purchases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    package_id UUID NOT NULL REFERENCES public.packages(id),
    business_id UUID NOT NULL REFERENCES public.profiles(id),
    campaign_id UUID REFERENCES public.campaigns(id),
    status TEXT NOT NULL DEFAULT 'pending_payment'
        CHECK (status IN ('pending_payment','paid','active','completed','cancelled')),
    product_name TEXT NOT NULL,
    product_link TEXT,
    target_location TEXT DEFAULT 'Lagos / Campus Wide',
    custom_brief TEXT,
    paystack_reference TEXT UNIQUE,
    total_amount NUMERIC(14,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_package_purchases_business ON public.package_purchases(business_id);
CREATE INDEX IF NOT EXISTS idx_package_purchases_campaign ON public.package_purchases(campaign_id);

ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read active packages" ON public.packages;
CREATE POLICY "Public read active packages"
    ON public.packages FOR SELECT USING (is_active = true);

DROP POLICY IF EXISTS "Businesses view own purchases" ON public.package_purchases;
CREATE POLICY "Businesses view own purchases"
    ON public.package_purchases FOR SELECT USING (auth.uid() = business_id);

-- Read-only from the browser; writes happen only through create_package_campaign().
REVOKE ALL ON public.packages, public.package_purchases FROM anon, authenticated;
GRANT SELECT ON public.packages TO anon, authenticated;
GRANT SELECT ON public.package_purchases TO authenticated;

-- Keep package_purchases status synchronized with the underlying campaign status
CREATE OR REPLACE FUNCTION public.sync_package_purchase_status()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.package_purchase_id IS NOT NULL AND (OLD.status IS DISTINCT FROM NEW.status) THEN
        UPDATE public.package_purchases
           SET status = CASE
                   WHEN NEW.status = 'active' THEN 'paid'
                   WHEN NEW.status IN ('completed', 'cancelled') THEN NEW.status
                   ELSE status
               END,
               updated_at = NOW()
         WHERE id = NEW.package_purchase_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_sync_package_purchase_status ON public.campaigns;
CREATE TRIGGER trg_sync_package_purchase_status
    AFTER UPDATE OF status ON public.campaigns
    FOR EACH ROW EXECUTE PROCEDURE public.sync_package_purchase_status();

REVOKE ALL ON FUNCTION public.sync_package_purchase_status() FROM PUBLIC, anon, authenticated;

-- Seed (exact 5 packages)
INSERT INTO public.packages (
    slug, name, description, slots, reward_per_completion, default_instructions, proof_requirements, estimated_delivery_days, sort_order
) VALUES 
('10-local-ugc-reels', '10 Local UGC Reels & TikToks', 'Get 10 authentic vertical video reviews, unboxings, or reaction reels created by real Nigerian university creators.', 10, 3500.00, 'Create an authentic 15-30s vertical TikTok or Instagram Reel demonstrating the product. Hook viewers in first 3s, show the brand clearly, speak audibly, and share the live post link.', '{"min_duration_sec": 15, "format": "vertical_9_16", "delivery": "live_url_and_raw_clip", "tag_brand": true}'::jsonb, 4, 1),
('campus-review-burst', 'Campus Review Burst (25 Students)', '25 genuine student reviews and social footprint across university groups and product landing pages.', 25, 1500.00, 'Test out the web or mobile app, write an honest, detailed 3-sentence review on the designated platform, and post a screenshot verifying your active usage.', '{"proof": "screenshot_and_profile_link", "verification": "geo_lagos_abuja"}'::jsonb, 3, 2),
('product-seeding-pack', 'Product Seeding & Lifestyle Content', 'High-resolution lifestyle product placement photos and short reaction videos from 5 verified campus ambassadors.', 5, 7000.00, 'Take 3 high-definition lifestyle photos posing with the physical product on campus or in a creative setting, plus a 10s aesthetic B-roll clip. Submit raw drive link.', '{"min_resolution": "1080p", "lighting": "natural_daylight", "deliverables": "3_photos_1_broll"}'::jsonb, 5, 3),
('sound-trend-challenge', 'TikTok Sound & CapCut Trend Push', '50 students simultaneously utilizing your branded sound or template over a 48-hour promotional window.', 50, 800.00, 'Use the specified official TikTok sound to create a creative transition or meme reel. Ensure the sound volume is audible and hashtag is pinned.', '{"sound_id": "required", "min_retention_sec": 7, "delivery": "tiktok_live_link"}'::jsonb, 2, 4),
('event-ground-squad', 'Event Coverage Micro-Team', 'On-the-ground squad covering your activation, pop-up stall, or campus booth with live social stories and attendance buzz.', 4, 10000.00, 'Arrive at the activation venue on time, document attendee reactions, capture 5 short video clips, and post live story updates tagging the brand handle.', '{"location_checkin": true, "raw_footage_transfer": true}'::jsonb, 3, 5)
ON CONFLICT (slug) DO NOTHING;

-- Atomic RPC that creates a real pending_payment campaign
CREATE OR REPLACE FUNCTION public.create_package_campaign(
    p_package_id UUID,
    p_product_name TEXT,
    p_product_link TEXT,
    p_target_location TEXT,
    p_custom_brief TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_pkg public.packages%ROWTYPE;
    v_cfg public.marketplace_settings%ROWTYPE;
    v_profile public.profiles%ROWTYPE;
    v_user_id UUID := auth.uid();
    v_campaign_id UUID;
    v_purchase_id UUID;
    v_name TEXT := trim(COALESCE(p_product_name, ''));
    v_link TEXT := NULLIF(trim(COALESCE(p_product_link, '')), '');
    v_loc TEXT := NULLIF(trim(COALESCE(p_target_location, '')), '');
    v_brief TEXT := NULLIF(trim(COALESCE(p_custom_brief, '')), '');
    v_reason TEXT;
    v_reward_budget NUMERIC(14,2);
    v_total NUMERIC(14,2);
    v_instructions TEXT;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'not_authenticated';
    END IF;

    SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;
    IF v_profile.role NOT IN ('business', 'admin') THEN
        RAISE EXCEPTION 'business_account_required';
    END IF;

    SELECT * INTO v_pkg FROM public.packages WHERE id = p_package_id AND is_active = true;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'package_not_found';
    END IF;

    IF length(v_name) < 3 OR length(v_name) > 80 THEN RAISE EXCEPTION 'invalid_product_name'; END IF;
    IF v_link IS NOT NULL AND (v_link !~* '^https?://' OR length(v_link) > 500) THEN
        RAISE EXCEPTION 'invalid_product_link';
    END IF;
    IF v_loc IS NOT NULL AND length(v_loc) > 100 THEN RAISE EXCEPTION 'invalid_location'; END IF;
    IF v_brief IS NOT NULL AND length(v_brief) > 1500 THEN RAISE EXCEPTION 'invalid_brief'; END IF;

    -- Only the buyer's own text is screened; the curated package copy is trusted.
    v_reason := public.campaign_prohibited_reason(v_name, v_brief);
    IF v_reason IS NOT NULL THEN
        RAISE EXCEPTION 'prohibited_task:%', v_reason;
    END IF;

    -- Whole Naira only (initialize-deposit rejects fractional totals).
    IF v_pkg.reward_per_completion <> trunc(v_pkg.reward_per_completion) THEN
        RAISE EXCEPTION 'invalid_reward';
    END IF;

    SELECT * INTO v_cfg FROM public.marketplace_settings WHERE id = 1;

    -- Same pricing as create_campaign(): fee from marketplace_settings, total rounded UP.
    v_reward_budget := v_pkg.slots * v_pkg.reward_per_completion;
    v_total := ceil(v_reward_budget * (1 + v_cfg.platform_fee_rate));

    v_instructions := format(
        E'PROJECT: %s\nPRODUCT LINK: %s\nLOCATION: %s\n\nBRIEF:\n%s\n\nSPECIFICATIONS:\n%s',
        v_name,
        COALESCE(v_link, 'N/A'),
        COALESCE(v_loc, 'General'),
        COALESCE(v_brief, 'Follow standard instructions'),
        v_pkg.default_instructions
    );

    INSERT INTO public.campaigns (
        business_id, title, instructions, category, proof_type, target_url,
        reward_per_completion, slots, platform_fee_rate,
        reward_budget, platform_fee, total_charge,
        status, package_id
    ) VALUES (
        v_user_id,
        left(format('%s: %s', v_pkg.name, v_name), 120),
        left(v_instructions, 4000),
        v_pkg.category,
        v_pkg.proof_type,
        v_link,
        v_pkg.reward_per_completion,
        v_pkg.slots,
        v_cfg.platform_fee_rate,
        v_reward_budget,
        v_total - v_reward_budget,
        v_total,
        'pending_payment',
        v_pkg.id
    ) RETURNING id INTO v_campaign_id;

    INSERT INTO public.package_purchases (
        package_id, business_id, campaign_id, status,
        product_name, product_link, target_location, custom_brief, total_amount
    ) VALUES (
        v_pkg.id, v_user_id, v_campaign_id, 'pending_payment',
        v_name, v_link, v_loc, v_brief, v_total
    ) RETURNING id INTO v_purchase_id;

    UPDATE public.campaigns SET package_purchase_id = v_purchase_id WHERE id = v_campaign_id;

    RETURN jsonb_build_object(
        'success', true,
        'campaign_id', v_campaign_id,
        'purchase_id', v_purchase_id,
        'total_charge', v_total
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_package_campaign(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_package_campaign(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated;

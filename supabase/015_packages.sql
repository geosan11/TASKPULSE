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
--  * Worker-count gate: a package can only be ordered when at least `slots`
--    worker accounts exist (profiles.role = 'worker', 008). Enforced in
--    create_package_campaign() ('not_enough_workers:<slots>'); the storefront
--    reads package_availability() to disable the button.
--  * Compliance: nothing in the catalog pays for public reviews, ratings or
--    trend pushes. Feedback and content tests are private; UGC is delivered
--    as a raw file and is only posted if the business asks, labelled #ad.
--  * The funded campaign is a normal campaign: settle_campaign_funding()
--    creates its worker-feed task (spots_left / spots_total = slots), so
--    accept_task() spot holds (013) and the 011 review windows apply as usual.
--    approval_mode comes from resolve_approval_mode() like create_campaign().
--    For link-proof packages target_url stays NULL (the product link is in the
--    instructions) so 011's link-domain check does not flag every drive link.
--  * Packages use the normal platform fee. The first-campaign zero-fee offer
--    is honoured by a manual refund, like every other campaign.

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
        CEIL(slots * reward_per_completion * (1 + platform_fee_rate))
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
    slug, name, description, category, slots, reward_per_completion, proof_type, default_instructions, proof_requirements, estimated_delivery_days, sort_order
) VALUES 
('10-local-ugc-reels', '10 Local UGC Videos', 'Get 10 authentic vertical videos (unboxings, demos or reactions) made by real Nigerian university students and delivered to you as raw files.', 'Community & Content', 10, 3500.00, 'link', 'Create an authentic 15-30s vertical video demonstrating the product. Hook viewers in the first 3s, show the brand clearly and speak audibly. Upload the raw file and submit its share link (e.g. Google Drive). Deliver the raw clip to the business. Only post it if the business asks, and if you do, label it #ad.', '{"min_duration_sec": 15, "format": "vertical_9_16", "delivery": "raw_file_link", "posting": "optional_labelled_ad"}'::jsonb, 4, 1),
('campus-feedback-panel', 'Campus Feedback Panel', '25 verified Nigerian students use your product and send private, honest feedback and a short survey. Nothing is posted publicly.', 'Product Feedback', 25, 1500.00, 'screenshot', 'Use the product for at least 10 minutes. Answer the survey and write 3 honest sentences on what worked, what confused you and whether you''d use it again. Submit your answers and one screenshot showing you used it. Do not post a review anywhere.', '{"proof": "survey_answers_and_usage_screenshot", "public_posting": false}'::jsonb, 3, 2),
('product-seeding-pack', 'Product Seeding & Lifestyle Content', 'High-resolution lifestyle product placement photos and short reaction videos from 5 verified students.', 'Community & Content', 5, 7000.00, 'link', 'Take 3 high-definition lifestyle photos posing with the physical product on campus or in a creative setting, plus a 10s aesthetic B-roll clip. Submit raw drive link.', '{"min_resolution": "1080p", "lighting": "natural_daylight", "deliverables": "3_photos_1_broll"}'::jsonb, 5, 3),
('content-test-panel', 'Content Test Panel', '50 verified students watch your ad, reel or sound and rate how clear, memorable and convincing it is, before you spend on promotion.', 'Surveys', 50, 500.00, 'text', 'Watch the brand''s content twice. Rate it from 1 to 5 for clarity, memorability and how likely you are to buy, then say in one sentence what you remember. Do not post or share it.', '{"ratings": ["clarity", "memorability", "purchase_intent"], "public_posting": false}'::jsonb, 2, 4),
('event-ground-squad', 'Event Coverage Micro-Team', 'On-the-ground team of verified students covering your activation, pop-up stall, or campus booth with photos, video clips and attendance notes.', 'Community & Content', 4, 10000.00, 'link', 'Arrive at the activation venue on time, document attendee reactions, capture 5 short video clips, and submit the raw clips as a share link. Only post about the event if the business asks, and if you do, label it #ad.', '{"location_checkin": true, "raw_footage_transfer": true, "posting": "optional_labelled_ad"}'::jsonb, 3, 5)
ON CONFLICT (slug) DO NOTHING;

-- Worker-count gate: how many people could take a package's spots.
-- Eligible = worker accounts (profiles.role = 'worker', 008). Not exposed
-- directly; clients only see per-package yes/no via package_availability().
CREATE OR REPLACE FUNCTION public._package_eligible_workers()
RETURNS INT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT count(*)::int FROM public.profiles WHERE role = 'worker';
$$;
REVOKE ALL ON FUNCTION public._package_eligible_workers() FROM PUBLIC, anon, authenticated;

-- Storefront: which active packages can be ordered right now.
CREATE OR REPLACE FUNCTION public.package_availability()
RETURNS TABLE (package_id UUID, slots INT, available BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT p.id, p.slots, p.slots <= public._package_eligible_workers()
      FROM public.packages p
     WHERE p.is_active;
$$;
REVOKE ALL ON FUNCTION public.package_availability() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.package_availability() TO authenticated;

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
    v_target TEXT;
    v_mode TEXT;
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

    -- Only sell what the worker pool can fill.
    IF v_pkg.slots > public._package_eligible_workers() THEN
        RAISE EXCEPTION 'not_enough_workers:%', v_pkg.slots;
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

    -- Link proofs are share links to raw files, so no target_url (011 would
    -- flag every drive link as link_domain_mismatch). The product link is
    -- still in the instructions.
    v_target := CASE WHEN v_pkg.proof_type = 'link' THEN NULL ELSE v_link END;
    v_mode := public.resolve_approval_mode(v_pkg.category, v_pkg.proof_type, FALSE, v_target, NULL);

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
        status, approval_mode, package_id
    ) VALUES (
        v_user_id,
        left(format('%s: %s', v_pkg.name, v_name), 120),
        left(v_instructions, 4000),
        v_pkg.category,
        v_pkg.proof_type,
        v_target,
        v_pkg.reward_per_completion,
        v_pkg.slots,
        v_cfg.platform_fee_rate,
        v_reward_budget,
        v_total - v_reward_budget,
        v_total,
        'pending_payment',
        v_mode,
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

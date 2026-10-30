-- LOCAL ONLY. 016: one 15% platform fee. Runs after 95_packages_015.sql on the
-- same database (its 25% package campaigns are the "already created" ones).
-- Every check raises 'FAILED: ...' on a wrong result; prints PASS at the end.
\set ON_ERROR_STOP 1
SET client_min_messages = warning;
CREATE OR REPLACE FUNCTION pg_temp.ok(c boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
  BEGIN IF c IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', msg; END IF; END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(p_uid uuid, p_sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_uid::text, false);
  EXECUTE 'SET LOCAL ROLE authenticated';
  EXECUTE p_sql INTO v;
  EXECUTE 'RESET ROLE';
  RETURN v;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO PUBLIC;

-- Settings and catalog --------------------------------------------------------
SELECT pg_temp.ok((SELECT platform_fee_rate FROM marketplace_settings WHERE id = 1) = 0.15, 'settings fee = 15%');
SELECT pg_temp.ok((SELECT column_default FROM information_schema.columns
                    WHERE table_schema='public' AND table_name='marketplace_settings' AND column_name='platform_fee_rate') LIKE '0.15%', 'settings default 0.15');
SELECT pg_temp.ok((SELECT column_default FROM information_schema.columns
                    WHERE table_schema='public' AND table_name='packages' AND column_name='platform_fee_rate') LIKE '0.15%', 'packages default 0.15');
SELECT pg_temp.ok((SELECT bool_and(platform_fee_rate = 0.15) FROM packages), 'every package at 15%');
SELECT pg_temp.ok((SELECT total_price FROM packages WHERE slug='10-local-ugc-reels') = 40250, 'UGC N40,250');
SELECT pg_temp.ok((SELECT total_price FROM packages WHERE slug='campus-feedback-panel') = 43125, 'Campus Feedback N43,125');
SELECT pg_temp.ok((SELECT total_price FROM packages WHERE slug='product-seeding-pack') = 40250, 'Product Seeding N40,250');
SELECT pg_temp.ok((SELECT total_price FROM packages WHERE slug='content-test-panel') = 28750, 'Content Test N28,750');
SELECT pg_temp.ok((SELECT total_price FROM packages WHERE slug='event-ground-squad') = 46000, 'Event Coverage N46,000');
SELECT pg_temp.ok((SELECT reward_per_completion FROM packages WHERE slug='10-local-ugc-reels') = 3500, 'UGC reward still N3,500');
SELECT pg_temp.ok((SELECT string_agg(reward_per_completion::int::text, ',' ORDER BY sort_order) FROM packages) = '3500,1500,7000,500,10000', 'no reward changed');

-- Existing campaigns keep their rate and totals --------------------------------
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM campaigns WHERE platform_fee_rate <> 0.25), 'all pre-016 campaigns still at 25%');
SELECT pg_temp.ok(c.status = 'active' AND c.platform_fee_rate = 0.25 AND c.total_charge = 46875 AND c.platform_fee = 9375,
                  'paid 015 feedback campaign unchanged (N46,875)')
  FROM campaigns c JOIN packages p ON p.id = c.package_id
 WHERE p.slug = 'campus-feedback-panel' AND c.business_id = 'b1500000-0000-0000-0000-000000000001' AND c.funded_at IS NOT NULL;
SELECT pg_temp.ok(c.status = 'pending_payment' AND c.platform_fee_rate = 0.25 AND c.total_charge = 43750,
                  'unpaid 015 UGC campaign keeps its N43,750 total')
  FROM campaigns c JOIN packages p ON p.id = c.package_id
 WHERE p.slug = '10-local-ugc-reels' AND c.business_id = 'b1500000-0000-0000-0000-000000000001';
SELECT pg_temp.ok(public._fee_refund_for(c, 1500, FALSE) = 375, 'old campaign: fee refund on an unused N1,500 slot stays 25% (N375)')
  FROM campaigns c JOIN packages p ON p.id = c.package_id
 WHERE p.slug = 'campus-feedback-panel' AND c.business_id = 'b1500000-0000-0000-0000-000000000001' AND c.funded_at IS NOT NULL;

-- New package orders charge the catalog price at 15% ------------------------
CREATE TEMP TABLE r16 (slug text primary key, v jsonb);
GRANT ALL ON r16 TO PUBLIC;
INSERT INTO r16 SELECT p.slug, pg_temp.as_user('b1500000-0000-0000-0000-000000000001',
  format($q$SELECT create_package_campaign(%L, 'Acme 016', NULL, NULL, NULL)$q$, p.id))
  FROM packages p ORDER BY p.sort_order;
SELECT pg_temp.ok(count(*) = 5 AND bool_and(c.platform_fee_rate = 0.15 AND c.total_charge = p.total_price
                                           AND c.reward_budget = p.slots * p.reward_per_completion
                                           AND c.platform_fee = p.total_price - p.slots * p.reward_per_completion
                                           AND (r.v->>'total_charge')::numeric = p.total_price),
                  'all 5 new package orders charge catalog price at 15%')
  FROM r16 r JOIN packages p ON p.slug = r.slug JOIN campaigns c ON c.id = (r.v->>'campaign_id')::uuid;
SELECT pg_temp.ok((SELECT pp.total_amount FROM package_purchases pp JOIN r16 r ON pp.campaign_id = (r.v->>'campaign_id')::uuid
                    WHERE r.slug = 'content-test-panel') = 28750, 'purchase record N28,750');

-- Checkout amount = total_charge (what initialize-deposit sends to Paystack) --
SET ROLE service_role;
SELECT pg_temp.ok((create_campaign_payment('b1500000-0000-0000-0000-000000000001',
                    (SELECT (v->>'campaign_id')::uuid FROM r16 WHERE slug='content-test-panel'), 'ref_016_ct')->>'amount')::numeric = 28750,
                  'checkout amount N28,750');
SELECT pg_temp.ok((settle_campaign_funding('ref_016_ct', 28750)->>'success')::boolean, 'funded at N28,750');
RESET ROLE;

-- Regular campaign: 100 x N300 -> N30,000 + N4,500 = N34,500 ----------------
INSERT INTO r16 SELECT 'custom', pg_temp.as_user('b1500000-0000-0000-0000-000000000001',
  $q$SELECT create_campaign('Survey 016','Answer the 5 questions about our app and paste your answers','Surveys','text',300,100,NULL,NULL,NULL,NULL)$q$);
SELECT pg_temp.ok(c.platform_fee_rate = 0.15 AND c.reward_budget = 30000 AND c.platform_fee = 4500 AND c.total_charge = 34500, 'custom 100 x 300 = N34,500')
  FROM campaigns c WHERE c.id = (SELECT (v->>'campaign_id')::uuid FROM r16 WHERE slug='custom');
INSERT INTO r16 SELECT 'odd', pg_temp.as_user('b1500000-0000-0000-0000-000000000001',
  $q$SELECT create_campaign('Survey 016 odd','Answer the 5 questions about our app and paste your answers','Surveys','text',50,5,NULL,NULL,NULL,NULL)$q$);
SELECT pg_temp.ok(c.total_charge = 288, '5 x 50 = 250 + 37.5 rounds up to N288')
  FROM campaigns c WHERE c.id = (SELECT (v->>'campaign_id')::uuid FROM r16 WHERE slug='odd');

-- Refunds at 15%: unused slots get their reward AND their fee back -----------
SELECT pg_temp.ok(public._fee_refund_for(c, 2500, FALSE) = 375, 'new campaign: fee refund on N2,500 unused reward = 15% (N375)')
  FROM campaigns c WHERE c.id = (SELECT (v->>'campaign_id')::uuid FROM r16 WHERE slug='content-test-panel');
-- Cancel the funded content test with nothing used: full N28,750 owed back.
SELECT pg_temp.ok((pg_temp.as_user('b1500000-0000-0000-0000-000000000001',
  format($q$SELECT set_campaign_status(%L, 'cancelled')$q$, (SELECT (v->>'campaign_id')::uuid FROM r16 WHERE slug='content-test-panel')))->>'refund_due')::numeric = 28750,
  'cancel unused: refund N28,750 (N25,000 rewards + N3,750 fee)');
SELECT pg_temp.ok(c.refund_due = 28750 AND c.fee_refund_due = 3750 AND c.escrow_balance = 0, 'refund recorded incl. fee')
  FROM campaigns c WHERE c.id = (SELECT (v->>'campaign_id')::uuid FROM r16 WHERE slug='content-test-panel');

SET client_min_messages = notice;
DO $$ BEGIN RAISE NOTICE 'fee 15%% tests (016): PASS'; END $$;

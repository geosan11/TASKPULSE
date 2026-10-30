-- LOCAL ONLY. 016: one 15% platform fee; referral settings untouched (bonus paused, see 017). Runs after 95_packages_015.sql on the
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
CREATE OR REPLACE FUNCTION pg_temp.run(p_uid uuid, p_sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), false);
  EXECUTE 'SET LOCAL ROLE authenticated';
  EXECUTE p_sql INTO v;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', false);
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

-- Referral: 016 must NOT turn the fee-cover check off (the bonus is paused and
-- ships in 017). On N50 tasks the fee (3 x N7.50) is below the bonus: no pay --
SELECT pg_temp.ok((SELECT referral_require_fee_cover FROM marketplace_settings WHERE id = 1) = TRUE, 'referral fee cover still on after 016');
SELECT pg_temp.ok((SELECT column_default FROM information_schema.columns
                    WHERE table_schema='public' AND table_name='marketplace_settings' AND column_name='referral_require_fee_cover') IS DISTINCT FROM 'false',
                  'referral fee cover default unchanged by 016');
SELECT pg_temp.ok((SELECT referral_bonus_referrer = 200 AND referral_bonus_referee = 0 AND referral_qualifying_tasks = 3 FROM marketplace_settings WHERE id = 1),
                  'bonus N200 to referrer only, after 3 tasks');
SELECT pg_temp.ok(position('referral_require_fee_cover' IN pg_get_functiondef('public._maybe_pay_referral(uuid)'::regprocedure)) > 0
                  AND (SELECT count(*) FROM regexp_matches(pg_get_functiondef('public._maybe_pay_referral(uuid)'::regprocedure), 'v_qual_fee <', 'g')) = 1,
                  '_maybe_pay_referral has exactly one fee check, behind the flag');

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
 ('a1600000-0000-0000-0000-000000000001','ref16-referrer@x.com','{"username":"ref16er","phone":"08031160001"}');
INSERT INTO auth.users (id, email, raw_user_meta_data) SELECT
 'a1600000-0000-0000-0000-000000000002','ref16-friend@x.com',
 jsonb_build_object('username','ref16fr','phone','08031160002','referred_by_code',(SELECT referral_code FROM profiles WHERE username='ref16er'));
SELECT pg_temp.ok((SELECT bonus_status FROM referrals WHERE referee_id = 'a1600000-0000-0000-0000-000000000002') = 'pending', 'friend joined with code');

CREATE TEMP TABLE k16 (n int PRIMARY KEY, cid uuid, task text);
GRANT ALL ON k16 TO PUBLIC;
DO $$
DECLARE v jsonb; i int;
BEGIN
  FOR i IN 1..3 LOOP
    v := pg_temp.run('b1500000-0000-0000-0000-000000000001', format(
      $q$SELECT create_campaign('Tiny survey %s','Answer the three short questions about our app honestly and paste your answers','Surveys','text',50,5,NULL,'manual',NULL,NULL)$q$, i));
    PERFORM create_campaign_payment('b1500000-0000-0000-0000-000000000001', (v->>'campaign_id')::uuid, 'ref016_tiny_' || i);
    PERFORM settle_campaign_funding('ref016_tiny_' || i, (SELECT total_charge FROM campaigns WHERE id = (v->>'campaign_id')::uuid));
    INSERT INTO k16 SELECT i, id, task_id FROM campaigns WHERE id = (v->>'campaign_id')::uuid;
  END LOOP;
END $$;
SELECT pg_temp.ok((SELECT bool_and(c.total_charge = 288 AND c.reward_per_completion = 50) FROM campaigns c JOIN k16 ON k16.cid = c.id), 'three N50 x 5 campaigns at 15% (N288 each)');

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM k16 ORDER BY n LOOP
    PERFORM pg_temp.run('a1600000-0000-0000-0000-000000000002', format('SELECT start_task(%L)', r.task));
    UPDATE task_starts SET started_at = NOW() - interval '10 minutes'
     WHERE user_id = 'a1600000-0000-0000-0000-000000000002' AND task_id = r.task;
    PERFORM pg_temp.run('a1600000-0000-0000-0000-000000000002',
      format('SELECT submit_task(%L, %L, NULL, NULL)', r.task, 'My honest answers number ' || r.n || ': clear, quick, would use again'));
    PERFORM pg_temp.run('b1500000-0000-0000-0000-000000000001',
      format('SELECT review_submission(%L, TRUE, NULL)',
             (SELECT id FROM task_completions WHERE user_id = 'a1600000-0000-0000-0000-000000000002' AND task_id = r.task)));
  END LOOP;
END $$;
SELECT pg_temp.ok((SELECT count(*) FROM task_completions WHERE user_id = 'a1600000-0000-0000-0000-000000000002' AND lower(status) = 'approved') = 3,
                  'friend has 3 approved N50 tasks');

-- Release the first two review windows: not yet.
UPDATE task_completions SET review_deadline_at = NOW() - interval '1 second', completed_at = NOW() - interval '49 hours'
 WHERE user_id = 'a1600000-0000-0000-0000-000000000002' AND task_id IN (SELECT task FROM k16 WHERE n <= 2);
SET ROLE service_role; SELECT process_review_windows(100); RESET ROLE;
SELECT pg_temp.ok((SELECT bonus_status FROM referrals WHERE referee_id = 'a1600000-0000-0000-0000-000000000002') = 'pending', 'two tasks: no bonus yet');
SELECT pg_temp.ok((SELECT withdrawable_balance FROM profiles WHERE id = 'a1600000-0000-0000-0000-000000000001') = 0, 'referrer not paid after 2');

-- Third task released: fee earned is N22.50 < N200, so still no bonus.
UPDATE task_completions SET review_deadline_at = NOW() - interval '1 second', completed_at = NOW() - interval '49 hours'
 WHERE user_id = 'a1600000-0000-0000-0000-000000000002' AND task_id = (SELECT task FROM k16 WHERE n = 3);
SET ROLE service_role; SELECT process_review_windows(100); RESET ROLE;
SELECT pg_temp.ok((SELECT bonus_status FROM referrals WHERE referee_id = 'a1600000-0000-0000-0000-000000000002') <> 'paid',
                  'no bonus after the 3rd N50 task (016 leaves fee cover on)');
SELECT pg_temp.ok((SELECT withdrawable_balance FROM profiles WHERE id = 'a1600000-0000-0000-0000-000000000001') = 0, 'referrer not paid');
SELECT pg_temp.ok((SELECT withdrawable_balance FROM profiles WHERE id = 'a1600000-0000-0000-0000-000000000002') = 150, 'friend: 3 x N50, no own bonus');
SELECT pg_temp.ok((SELECT count(*) FROM transactions WHERE user_id = 'a1600000-0000-0000-0000-000000000001' AND type = 'referral_bonus' AND amount = 200) = 0,
                  'no N200 referral transaction');
SELECT pg_temp.ok((SELECT count(*) FROM campaign_ledger_check()) = 0, 'ledger still reconciles');

SET client_min_messages = notice;
DO $$ BEGIN RAISE NOTICE 'fee 15%% + referral tests (016): PASS'; END $$;

-- LOCAL ONLY. Packages (015): compliant catalog, worker-count gate, and a
-- purchase becomes a normal campaign whose funded task uses the 013 spots.
-- Every check raises 'FAILED: ...' on a wrong result; prints PASS at the end.
\set ON_ERROR_STOP 1
SET client_min_messages = warning;
CREATE OR REPLACE FUNCTION pg_temp.ok(c boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
  BEGIN IF c IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', msg; END IF; END $$;
CREATE OR REPLACE FUNCTION pg_temp.fails(p_uid uuid, p_role text, p_sql text, p_err text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), false);
  BEGIN
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    IF position(p_err IN SQLERRM) = 0 THEN RAISE EXCEPTION 'FAILED: % gave "%" not "%"', p_sql, SQLERRM, p_err; END IF;
    RETURN;
  END;
  EXECUTE 'RESET ROLE';
  RAISE EXCEPTION 'FAILED: expected % from %', p_err, p_sql;
END $$;
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

-- Catalog copy --------------------------------------------------------------
SELECT pg_temp.ok((SELECT count(*) FROM packages) = 5, 'five packages');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM packages WHERE slug IN ('campus-review-burst', 'sound-trend-challenge')), 'old review/trend packages gone');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM packages WHERE (name || description || default_instructions) ~* 'ambassador|live post link|tiktok sound|designated platform'), 'no ambassador / public-review / trend copy');
SELECT pg_temp.ok((SELECT slots = 25 AND reward_per_completion = 1500 AND proof_type = 'screenshot' AND category = 'Product Feedback'
                     AND description = '25 verified Nigerian students use your product and send private, honest feedback and a short survey. Nothing is posted publicly.'
                     FROM packages WHERE slug = 'campus-feedback-panel'), 'feedback panel');
SELECT pg_temp.ok((SELECT slots = 50 AND reward_per_completion = 500 AND proof_type = 'text' AND category = 'Surveys'
                     AND default_instructions LIKE '%Do not post or share it.' FROM packages WHERE slug = 'content-test-panel'), 'content test panel');
SELECT pg_temp.ok((SELECT default_instructions LIKE '%Deliver the raw clip to the business. Only post it if the business asks, and if you do, label it #ad.'
                     FROM packages WHERE slug = '10-local-ugc-reels'), 'UGC: raw clip, optional #ad post');
SELECT pg_temp.ok((SELECT description LIKE '%5 verified students.' FROM packages WHERE slug = 'product-seeding-pack'), 'seeding: verified students');

-- Users: one business, one plain worker; few workers so far ------------------
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
 ('b1500000-0000-0000-0000-000000000001','pkg-biz@x.com','{"username":"pkgbiz","phone":"08031150001","account_type":"business","business_name":"PkgCo"}'),
 ('e1500000-0000-0000-0000-000000000001','pkg-w1@x.com','{"username":"pkgw1","phone":"08031150011"}');

-- Worker-count gate -----------------------------------------------------------
-- Make the gate bite: every package needs one more worker than exist.
CREATE TEMP TABLE w15 AS SELECT count(*)::int AS n FROM profiles WHERE role = 'worker';
GRANT SELECT ON w15 TO PUBLIC;
SELECT pg_temp.ok((SELECT n FROM w15) < 50, 'fewer than 50 workers before seeding more');
SELECT pg_temp.ok((pg_temp.as_user('b1500000-0000-0000-0000-000000000001',
  $q$SELECT to_jsonb(available) FROM package_availability() a JOIN packages p ON p.id = a.package_id WHERE p.slug = 'content-test-panel'$q$))::text = 'false',
  'content test (50) not available yet');
SELECT pg_temp.fails('b1500000-0000-0000-0000-000000000001','authenticated',
  $q$SELECT create_package_campaign((SELECT id FROM packages WHERE slug='content-test-panel'), 'Acme App', NULL, NULL, NULL)$q$, 'not_enough_workers:50');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM campaigns WHERE package_id IS NOT NULL), 'gate: no campaign created');
SELECT pg_temp.fails(NULL,'anon', $q$SELECT * FROM package_availability()$q$, 'permission denied');
SELECT pg_temp.fails('b1500000-0000-0000-0000-000000000001','authenticated', $q$SELECT _package_eligible_workers()$q$, 'permission denied');

-- Seed 60 workers: now every package can be filled. Businesses do not count.
INSERT INTO auth.users (id, email, raw_user_meta_data)
SELECT ('e15000ff-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'pkgx' || n || '@x.com',
       jsonb_build_object('username', 'pkgx' || n, 'phone', '0809' || lpad(n::text, 7, '0'))
  FROM generate_series(1, 60) n;
SELECT pg_temp.ok((pg_temp.as_user('b1500000-0000-0000-0000-000000000001',
  $q$SELECT to_jsonb(bool_and(available)) FROM package_availability()$q$))::text = 'true', 'all available with 60+ workers');
SELECT pg_temp.fails('e1500000-0000-0000-0000-000000000001','authenticated',
  $q$SELECT create_package_campaign((SELECT id FROM packages WHERE slug='campus-feedback-panel'), 'Acme App', NULL, NULL, NULL)$q$, 'business_account_required');

-- Purchase -> normal campaign -------------------------------------------------
CREATE TEMP TABLE r15 (k text primary key, v jsonb);
GRANT ALL ON r15 TO PUBLIC;
INSERT INTO r15 SELECT 'fb', pg_temp.as_user('b1500000-0000-0000-0000-000000000001',
  $q$SELECT create_package_campaign((SELECT id FROM packages WHERE slug='campus-feedback-panel'), 'Acme App', 'https://acme.example/app', 'UniLag', 'Focus on sign-up')$q$);
INSERT INTO r15 SELECT 'ugc', pg_temp.as_user('b1500000-0000-0000-0000-000000000001',
  $q$SELECT create_package_campaign((SELECT id FROM packages WHERE slug='10-local-ugc-reels'), 'Acme App', 'https://acme.example/app', NULL, NULL)$q$);
CREATE TEMP TABLE c15 AS SELECT (v->>'campaign_id')::uuid AS cid, k FROM r15;
GRANT SELECT ON c15 TO PUBLIC;
SELECT pg_temp.ok(c.status = 'pending_payment' AND c.slots = 25 AND c.reward_per_completion = 1500
                  AND c.category = 'Product Feedback' AND c.proof_type = 'screenshot' AND c.approval_mode = 'auto'
                  AND c.target_url = 'https://acme.example/app'
                  AND c.reward_budget = 37500 AND c.total_charge = 46875 AND c.platform_fee = 9375
                  AND c.package_purchase_id IS NOT NULL, 'feedback campaign row')
  FROM campaigns c WHERE c.id = (SELECT cid FROM c15 WHERE k='fb');
SELECT pg_temp.ok((SELECT total_price FROM packages WHERE slug='campus-feedback-panel') = 46875, 'catalog price = charged total');
SELECT pg_temp.ok(c.target_url IS NULL AND c.proof_type = 'link' AND c.instructions LIKE '%PRODUCT LINK: https://acme.example/app%', 'UGC: no target_url, link in instructions')
  FROM campaigns c WHERE c.id = (SELECT cid FROM c15 WHERE k='ugc');

-- Fund through the normal Paystack settlement path --------------------------
SET ROLE service_role;
SELECT create_campaign_payment('b1500000-0000-0000-0000-000000000001', (SELECT cid FROM c15 WHERE k='fb'), 'ref_015_fb');
SELECT pg_temp.ok((settle_campaign_funding('ref_015_fb', 46875)->>'success')::boolean, 'funded');
RESET ROLE;
CREATE TEMP TABLE t15 AS SELECT task_id FROM campaigns WHERE id = (SELECT cid FROM c15 WHERE k='fb');
GRANT SELECT ON t15 TO PUBLIC;
SELECT pg_temp.ok(t.is_active AND t.spots_left = 25 AND t.spots_total = 25 AND t.proof_type = 'screenshot' AND t.category = 'Product Feedback',
                  'worker-feed task: 25 of 25 spots')
  FROM tasks t WHERE t.id = (SELECT task_id FROM t15);
SELECT pg_temp.ok((SELECT status FROM package_purchases WHERE campaign_id = (SELECT cid FROM c15 WHERE k='fb')) = 'paid', 'purchase synced to paid');
SELECT pg_temp.ok((pg_temp.as_user('e1500000-0000-0000-0000-000000000001', $q$SELECT accept_task((SELECT task_id FROM t15))$q$)->>'spots_left')::int = 24,
                  'accept_task holds a spot (24 left)');
SELECT pg_temp.ok((SELECT spots_left FROM tasks WHERE id = (SELECT task_id FROM t15)) = 24, 'spots_left updated');

-- Browser cannot write the catalog or purchases ------------------------------
SELECT pg_temp.fails('b1500000-0000-0000-0000-000000000001','authenticated', $q$UPDATE packages SET slots = 1$q$, 'permission denied');
SELECT pg_temp.fails('b1500000-0000-0000-0000-000000000001','authenticated', $q$INSERT INTO package_purchases (package_id, business_id, product_name, total_amount) SELECT id, auth.uid(), 'x', 1 FROM packages LIMIT 1$q$, 'permission denied');

SET client_min_messages = notice;
DO $$ BEGIN RAISE NOTICE 'packages tests (015): PASS'; END $$;

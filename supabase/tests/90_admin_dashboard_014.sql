-- LOCAL ONLY. Runs after 014 on top of the data the earlier tests left behind.
-- Checks: only admins can read the dashboard (42501 for everyone else, anon
-- cannot even execute), the functions cannot write, the books balance on the
-- existing 009/012 test data and through a fund -> approve -> cancel -> refund
-- cycle, test accounts are left out, sign-up sources bucket correctly.
-- Every check raises 'FAILED: ...'; prints PASS at the end.
\set ON_ERROR_STOP 1
SET client_min_messages = warning;
CREATE OR REPLACE FUNCTION pg_temp.act(p_uid uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), false) $$;
CREATE OR REPLACE FUNCTION pg_temp.ok(c boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
  BEGIN IF c IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', msg; END IF; END $$;
-- expect SQLSTATE p_state from running p_sql as role p_role / user p_uid
CREATE OR REPLACE FUNCTION pg_temp.fails_state(p_uid uuid, p_role text, p_sql text, p_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), false);
  PERFORM set_config('request.jwt.claim.role', p_role, false);
  BEGIN
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claim.role', '', false);
    IF SQLSTATE <> p_state THEN RAISE EXCEPTION 'FAILED: % gave % (%) not %', p_sql, SQLSTATE, SQLERRM, p_state; END IF;
    RETURN;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.role', '', false);
  RAISE EXCEPTION 'FAILED: expected % from %', p_state, p_sql;
END $$;
-- run the summary as an admin user (through the authenticated role, like the app)
CREATE OR REPLACE FUNCTION pg_temp.summary(p_admin uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_admin::text, false);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', false);
  SET LOCAL ROLE authenticated;
  v := admin_money_summary();
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.role', '', false);
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.n(v jsonb, VARIADIC p text[]) RETURNS numeric LANGUAGE sql AS $$
  SELECT (v #>> p)::numeric $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO PUBLIC;

CREATE TEMP TABLE r (k text primary key, v jsonb);
GRANT ALL ON r TO PUBLIC;

-- Users -----------------------------------------------------------------
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
 ('ad140000-0000-0000-0000-000000000001','admin14@x.com','{"username":"admin14","phone":"08031114001"}'),
 ('b1400000-0000-0000-0000-000000000001','zeta@x.com','{"username":"zetabiz","phone":"08031114002","account_type":"business","business_name":"Zeta Foods"}'),
 ('e1400000-0000-0000-0000-000000000001','w14a@x.com','{"username":"w14a","phone":"08031114011","signup_source":"telegram","signup_campaign":"launch"}'),
 ('e1400000-0000-0000-0000-000000000002','w14b@x.com','{"username":"w14b","phone":"08031114012","signup_source":"Telegram","signup_campaign":"UNILAG"}'),
 ('e1400000-0000-0000-0000-000000000003','w14c@x.com','{"username":"w14c","phone":"08031114013","signup_source":"telegram","signup_campaign":"dsn"}'),
 ('e1400000-0000-0000-0000-000000000004','w14d@x.com','{"username":"w14d","phone":"08031114014","heard_about_us":"whatsapp"}'),
 ('e1400000-0000-0000-0000-000000000005','w14e@x.com','{"username":"w14e","phone":"08031114015","signup_source":"whatsapp","signup_campaign":"status"}'),
 ('e1400000-0000-0000-0000-000000000006','w14f@x.com','{"username":"w14f","phone":"08031114016","heard_about_us":"friend"}');
UPDATE profiles SET role = 'admin' WHERE id = 'ad140000-0000-0000-0000-000000000001';

-- A. Privileges -------------------------------------------------------------
SELECT pg_temp.ok(NOT has_function_privilege('anon', p, 'EXECUTE'), 'anon cannot execute ' || p)
  FROM unnest(ARRAY['public.admin_money_summary()', 'public.admin_money_entries(text,text,integer,integer)',
                    'public.admin_business_list(text,integer,integer)', 'public.admin_business_detail(uuid)',
                    'public.admin_worker_list(text,integer,integer)', 'public.admin_worker_detail(uuid)']) p;
SELECT pg_temp.ok(has_function_privilege('authenticated', p, 'EXECUTE'), 'authenticated may call ' || p)
  FROM unnest(ARRAY['public.admin_money_summary()', 'public.admin_money_entries(text,text,integer,integer)',
                    'public.admin_business_list(text,integer,integer)', 'public.admin_business_detail(uuid)',
                    'public.admin_worker_list(text,integer,integer)', 'public.admin_worker_detail(uuid)']) p;
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', p, 'EXECUTE') AND NOT has_function_privilege('anon', p, 'EXECUTE'),
                  'internal helper is not callable: ' || p)
  FROM unnest(ARRAY['public._admin_dash_guard()', 'public._admin_dash_campaigns()', 'public._admin_dash_payments()',
                    'public._admin_dash_business_rows()', 'public._admin_dash_worker_rows()',
                    'public._admin_dash_excluded(uuid)']) p;
SELECT pg_temp.ok(NOT has_table_privilege('authenticated', 'public.admin_excluded_accounts', 'SELECT')
                  AND NOT has_table_privilege('anon', 'public.admin_excluded_accounts', 'SELECT'), 'excluded list is private');
-- read-only: every dashboard function is STABLE (Postgres refuses writes inside it)
SELECT pg_temp.ok(bool_and(provolatile IN ('s', 'i')), 'all dashboard functions are read-only (STABLE/IMMUTABLE)')
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace
   AND (proname LIKE 'admin\_money%' OR proname LIKE 'admin\_business%' OR proname LIKE 'admin\_worker%' OR proname LIKE '\_admin\_dash%');
SELECT pg_temp.ok((SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                    AND (proname LIKE 'admin\_money%' OR proname LIKE 'admin\_business%' OR proname LIKE 'admin\_worker%')) = 6,
                  'six dashboard RPCs');

-- B. Non-admins get 42501 ---------------------------------------------------
SELECT pg_temp.fails_state('e1400000-0000-0000-0000-000000000001', 'authenticated', q, '42501')
  FROM unnest(ARRAY['SELECT admin_money_summary()', $q$SELECT admin_money_entries('deposits')$q$,
                    'SELECT admin_business_list()', $q$SELECT admin_business_detail('b1400000-0000-0000-0000-000000000001')$q$,
                    'SELECT admin_worker_list()', $q$SELECT admin_worker_detail('e1400000-0000-0000-0000-000000000001')$q$]) q;
-- a business owner is not an admin either
SELECT pg_temp.fails_state('b1400000-0000-0000-0000-000000000001', 'authenticated', 'SELECT admin_money_summary()', '42501');
-- signed-in role with no user id
SELECT pg_temp.fails_state(NULL, 'authenticated', 'SELECT admin_money_summary()', '42501');
-- anon: no EXECUTE at all (permission denied is also 42501)
SELECT pg_temp.fails_state(NULL, 'anon', 'SELECT admin_money_summary()', '42501');
SELECT pg_temp.fails_state(NULL, 'anon', 'SELECT admin_worker_list()', '42501');

-- C. Books balance on the data left by earlier tests ------------------------
INSERT INTO r SELECT 's0', pg_temp.summary('ad140000-0000-0000-0000-000000000001');
SELECT pg_temp.ok((v #>> '{books,balanced}')::boolean, 'books balance on existing test data: ' || (v->'books')::text) FROM r WHERE k='s0';
SELECT pg_temp.ok(pg_temp.n(v,'deposited') = (SELECT COALESCE(SUM(COALESCE(paid_amount,0)),0) FROM campaign_payments WHERE status <> 'pending'),
                  'deposited = confirmed checkouts') FROM r WHERE k='s0';
SELECT pg_temp.ok(pg_temp.n(v,'paid_out') = (SELECT COALESCE(SUM(amount),0) FROM transactions WHERE lower(type)='cashout' AND lower(status) IN ('disbursed','settled')),
                  'paid out = completed cashouts') FROM r WHERE k='s0';
SELECT pg_temp.ok(pg_temp.n(v,'pending','withdrawals','amount') = (SELECT COALESCE(SUM(amount),0) FROM transactions WHERE lower(type)='cashout' AND lower(status)='pending'),
                  'pending withdrawals') FROM r WHERE k='s0';
SELECT pg_temp.ok(pg_temp.n(v,'referral_cost') = (SELECT COALESCE(SUM(amount),0) FROM transactions WHERE type='referral_bonus' AND status='settled'),
                  'referral cost = referral_bonus rows') FROM r WHERE k='s0';
SELECT pg_temp.ok(pg_temp.n(v,'net_earned') = pg_temp.n(v,'fees_earned') - pg_temp.n(v,'referral_cost'), 'net = fees - referral') FROM r WHERE k='s0';
SELECT pg_temp.ok(pg_temp.n(v,'settings','platform_fee_rate') = (SELECT platform_fee_rate FROM marketplace_settings)
                  AND pg_temp.n(v,'settings','referral_bonus_referrer') = (SELECT referral_bonus_referrer FROM marketplace_settings),
                  'fee rate and referral amount come from marketplace_settings') FROM r WHERE k='s0';
SELECT pg_temp.ok(pg_temp.n(v,'books','ledger_problem_campaigns') = 0, '009 per-campaign check is clean') FROM r WHERE k='s0';

-- SQL editor / psql (no JWT) may read it too
SELECT pg_temp.act(NULL);
SELECT pg_temp.ok((admin_money_summary() #>> '{books,balanced}')::boolean, 'owner (no JWT) can read');

-- D. A full business cycle moves every figure by the exact amount ----------
SELECT pg_temp.act('b1400000-0000-0000-0000-000000000001'); SET ROLE authenticated;
INSERT INTO r SELECT 'zc', create_campaign('Zeta taste survey','Answer the five questions and paste your answer code','Surveys','text',300,10,NULL);
RESET ROLE;
SET ROLE service_role;
SELECT create_campaign_payment('b1400000-0000-0000-0000-000000000001', (SELECT (v->>'campaign_id')::uuid FROM r WHERE k='zc'), 'camp_zeta_014');
SELECT settle_campaign_funding('camp_zeta_014', 3750);
RESET ROLE;
CREATE TEMP TABLE zt AS SELECT task_id FROM campaigns WHERE id = (SELECT (v->>'campaign_id')::uuid FROM r WHERE k='zc');
GRANT SELECT ON zt TO PUBLIC;
SELECT pg_temp.act('e1400000-0000-0000-0000-000000000001'); SET ROLE authenticated;
SELECT submit_task((SELECT task_id FROM zt), 'zeta answer a', NULL); RESET ROLE;
SELECT pg_temp.act('e1400000-0000-0000-0000-000000000002'); SET ROLE authenticated;
SELECT submit_task((SELECT task_id FROM zt), 'zeta answer b', NULL); RESET ROLE;
SELECT pg_temp.act('e1400000-0000-0000-0000-000000000003'); SET ROLE authenticated;
SELECT submit_task((SELECT task_id FROM zt), 'zeta answer c', NULL); RESET ROLE;
SELECT pg_temp.act('b1400000-0000-0000-0000-000000000001'); SET ROLE authenticated;
SELECT review_submission((SELECT id FROM task_completions WHERE proof_text='zeta answer a'), true, NULL);
SELECT review_submission((SELECT id FROM task_completions WHERE proof_text='zeta answer b'), true, NULL);
RESET ROLE;

INSERT INTO r SELECT 's1', pg_temp.summary('ad140000-0000-0000-0000-000000000001');
SELECT pg_temp.ok(pg_temp.n(b.v,'deposited') - pg_temp.n(a.v,'deposited') = 3750, 'deposit +3,750') FROM r a, r b WHERE a.k='s0' AND b.k='s1';
SELECT pg_temp.ok(pg_temp.n(b.v,'spent_on_workers') - pg_temp.n(a.v,'spent_on_workers') = 600, 'spend +600 (2 x 300)') FROM r a, r b WHERE a.k='s0' AND b.k='s1';
SELECT pg_temp.ok(pg_temp.n(b.v,'fees_earned') - pg_temp.n(a.v,'fees_earned') = 150, 'fee earned only on the 2 approved spots (+150)') FROM r a, r b WHERE a.k='s0' AND b.k='s1';
SELECT pg_temp.ok(pg_temp.n(b.v,'held','total') - pg_temp.n(a.v,'held','total') = 3000, 'held for business +3,000') FROM r a, r b WHERE a.k='s0' AND b.k='s1';
SELECT pg_temp.ok(pg_temp.n(b.v,'held','unearned_fee') - pg_temp.n(a.v,'held','unearned_fee') = 600, 'fee on 8 open spots is still the business''s (+600)') FROM r a, r b WHERE a.k='s0' AND b.k='s1';
SELECT pg_temp.ok(pg_temp.n(b.v,'pending','reviews','count') - pg_temp.n(a.v,'pending','reviews','count') = 1
                  AND pg_temp.n(b.v,'pending','reviews','amount') - pg_temp.n(a.v,'pending','reviews','amount') = 300, 'one reward waiting for review') FROM r a, r b WHERE a.k='s0' AND b.k='s1';
SELECT pg_temp.ok((v #>> '{books,balanced}')::boolean, 'books balance after funding + approvals') FROM r WHERE k='s1';

-- cancel with one submission still pending, then reject it
SELECT pg_temp.act('b1400000-0000-0000-0000-000000000001'); SET ROLE authenticated;
SELECT set_campaign_status((SELECT (v->>'campaign_id')::uuid FROM r WHERE k='zc'), 'cancelled');
RESET ROLE;
INSERT INTO r SELECT 's2', pg_temp.summary('ad140000-0000-0000-0000-000000000001');
SELECT pg_temp.ok((v #>> '{books,balanced}')::boolean, 'books balance after cancel (one still in review)') FROM r WHERE k='s2';
SELECT pg_temp.act('b1400000-0000-0000-0000-000000000001'); SET ROLE authenticated;
SELECT review_submission((SELECT id FROM task_completions WHERE proof_text='zeta answer c'), false, 'wrong code');
RESET ROLE;
INSERT INTO r SELECT 's3', pg_temp.summary('ad140000-0000-0000-0000-000000000001');
SELECT pg_temp.ok((v #>> '{books,balanced}')::boolean, 'books balance after the last reject') FROM r WHERE k='s3';
SELECT pg_temp.ok(pg_temp.n(b.v,'fees_earned') - pg_temp.n(a.v,'fees_earned') = 150, 'fee earned stays 150 after cancel') FROM r a, r b WHERE a.k='s0' AND b.k='s3';
SELECT pg_temp.ok(pg_temp.n(b.v,'refunds','owed') - pg_temp.n(a.v,'refunds','owed') = 3000, 'refund owed +3,000 (2,400 rewards + 600 fee)') FROM r a, r b WHERE a.k='s0' AND b.k='s3';
SELECT pg_temp.ok(pg_temp.n(b.v,'held','total') - pg_temp.n(a.v,'held','total') = 3000, 'held = the refund still owed') FROM r a, r b WHERE a.k='s0' AND b.k='s3';

-- refund 1,000 of it in Paystack and record it
SELECT pg_temp.act('ad140000-0000-0000-0000-000000000001'); SET ROLE authenticated;
SELECT record_campaign_refund((SELECT (v->>'campaign_id')::uuid FROM r WHERE k='zc'), 1000, 'RFD_zeta_1');
RESET ROLE;
INSERT INTO r SELECT 's4', pg_temp.summary('ad140000-0000-0000-0000-000000000001');
SELECT pg_temp.ok((v #>> '{books,balanced}')::boolean, 'books balance after a recorded refund') FROM r WHERE k='s4';
SELECT pg_temp.ok(pg_temp.n(b.v,'refunds','paid') - pg_temp.n(a.v,'refunds','paid') = 1000
                  AND pg_temp.n(b.v,'refunds','owed') - pg_temp.n(a.v,'refunds','owed') = -1000, 'refund moves owed -> paid') FROM r a, r b WHERE a.k='s3' AND b.k='s4';
SELECT pg_temp.ok(pg_temp.n(b.v,'held','total') - pg_temp.n(a.v,'held','total') = -1000, 'held drops by the refund') FROM r a, r b WHERE a.k='s3' AND b.k='s4';

-- E. Drill-downs, lists, details -------------------------------------------
SELECT pg_temp.act('ad140000-0000-0000-0000-000000000001'); SET ROLE authenticated;
INSERT INTO r SELECT 'dep1', admin_money_entries('deposits', NULL, 1, 0);
INSERT INTO r SELECT 'dep2', admin_money_entries('deposits', NULL, 1, 1);
INSERT INTO r SELECT 'bl', admin_business_list('zeta');
INSERT INTO r SELECT 'bd', admin_business_detail('b1400000-0000-0000-0000-000000000001');
INSERT INTO r SELECT 'wl', admin_worker_list('w14a');
INSERT INTO r SELECT 'wd', admin_worker_detail('e1400000-0000-0000-0000-000000000001');
INSERT INTO r SELECT 'fees', admin_money_entries('fees', NULL, 100, 0);
INSERT INTO r SELECT 'tg', admin_money_entries('signups', 'telegram_launch', 100, 0);
RESET ROLE;
SELECT pg_temp.ok(jsonb_array_length(v->'rows') = 1 AND (v->>'total')::int >= 2, 'pagination: 1 row per page, total counts all') FROM r WHERE k='dep1';
SELECT pg_temp.ok((a.v #>> '{rows,0,detail}') = 'camp_zeta_014' AND (b.v #>> '{rows,0,detail}') <> 'camp_zeta_014', 'newest first, page 2 differs') FROM r a, r b WHERE a.k='dep1' AND b.k='dep2';
SELECT pg_temp.ok((v->>'total')::int = 1 AND (v #>> '{rows,0,name}') = 'Zeta Foods' AND (v #>> '{rows,0,deposited}')::numeric = 3750
                  AND (v #>> '{rows,0,balance}')::numeric = 2000 AND (v #>> '{rows,0,tasks_posted}')::int = 1, 'business list row: ' || v::text) FROM r WHERE k='bl';
SELECT pg_temp.ok((v #>> '{business,spent}')::numeric = 750 AND (v #>> '{business,fees}')::numeric = 150
                  AND (v #>> '{business,refunds_paid}')::numeric = 1000 AND (v #>> '{business,refunds_owed}')::numeric = 2000
                  AND jsonb_array_length(v->'campaigns') = 1 AND (v #>> '{campaigns,0,approved}')::int = 2
                  AND jsonb_array_length(v->'deposits') = 1 AND jsonb_array_length(v->'transactions') > 0,
                  'business detail: ' || (v->'business')::text) FROM r WHERE k='bd';
SELECT pg_temp.ok((v #>> '{rows,0,username}') = 'w14a' AND (v #>> '{rows,0,tasks_done}')::int = 1, 'worker list row: ' || v::text) FROM r WHERE k='wl';
SELECT pg_temp.ok((v #>> '{worker,earned}')::numeric = 300 AND jsonb_array_length(v->'submissions') = 1, 'worker detail') FROM r WHERE k='wd';
SELECT pg_temp.ok((SELECT SUM((e->>'amount')::numeric) FROM jsonb_array_elements(v->'rows') e)
                  = (SELECT pg_temp.n(s.v,'fees_earned') + pg_temp.n(s.v,'fee_other_kept') FROM r s WHERE s.k='s4'),
                  'fee drill-down adds up to the card') FROM r WHERE k='fees';
SELECT pg_temp.ok((v->>'total')::int = 1 AND (v #>> '{rows,0,title}') = '@w14a', 'telegram/launch drill-down') FROM r WHERE k='tg';

-- F. Sign-up sources --------------------------------------------------------
SELECT pg_temp.ok(pg_temp.n(v,'signups','telegram_launch','total') >= 1 AND pg_temp.n(v,'signups','telegram_unilag','total') = 1
                  AND pg_temp.n(v,'signups','telegram_dsn','total') = 1 AND pg_temp.n(v,'signups','whatsapp','total') >= 2,
                  'sign-up buckets: ' || (v->'signups')::text) FROM r WHERE k='s4';
SELECT pg_temp.ok(_admin_dash_signup_bucket('{"signup_source":"telegram","signup_campaign":"launch"}', 'whatsapp') = 'telegram_launch', 'UTM beats the answer');
SELECT pg_temp.ok(_admin_dash_signup_bucket('{}', NULL) = 'unknown', 'nothing = unknown');
SELECT pg_temp.ok(_admin_dash_signup_bucket('{}', 'friend') = 'other', 'friend = other');

-- G. Test accounts are left out of everything -------------------------------
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
 ('9960b327-0b02-4862-91a7-f2b9fd8e9afe','geoflashsanni+tputm9381@gmail.com',
  '{"username":"prbtest9381","phone":"08031119381","account_type":"business","business_name":"PR Test","signup_source":"telegram","signup_campaign":"launch"}');
INSERT INTO r SELECT 's5', pg_temp.summary('ad140000-0000-0000-0000-000000000001');
SELECT pg_temp.act('9960b327-0b02-4862-91a7-f2b9fd8e9afe'); SET ROLE authenticated;
INSERT INTO r SELECT 'xc', create_campaign('Test only campaign','Answer the five questions and paste your answer code','Surveys','text',300,5,NULL);
RESET ROLE;
SET ROLE service_role;
SELECT create_campaign_payment('9960b327-0b02-4862-91a7-f2b9fd8e9afe', (SELECT (v->>'campaign_id')::uuid FROM r WHERE k='xc'), 'camp_test_9381');
SELECT settle_campaign_funding('camp_test_9381', 1875);
RESET ROLE;
INSERT INTO r SELECT 's6', pg_temp.summary('ad140000-0000-0000-0000-000000000001');
SELECT pg_temp.ok(pg_temp.n(a.v,'deposited') = pg_temp.n(b.v,'deposited')
                  AND pg_temp.n(a.v,'counts','businesses') = pg_temp.n(b.v,'counts','businesses')
                  AND pg_temp.n(a.v,'counts','tasks_posted') = pg_temp.n(b.v,'counts','tasks_posted')
                  AND pg_temp.n(a.v,'signups','telegram_launch','total') = pg_temp.n(b.v,'signups','telegram_launch','total'),
                  'excluded test account changes no figure') FROM r a, r b WHERE a.k='s4' AND b.k='s6';
SELECT pg_temp.ok((v #>> '{books,balanced}')::boolean, 'books still balance with the test account left out') FROM r WHERE k='s6';
SELECT pg_temp.act('ad140000-0000-0000-0000-000000000001'); SET ROLE authenticated;
SELECT pg_temp.ok((admin_business_list('PR Test')->>'total')::int = 0, 'test account not in the business list');
SELECT pg_temp.fails_state('ad140000-0000-0000-0000-000000000001', 'authenticated',
  $q$SELECT admin_business_detail('9960b327-0b02-4862-91a7-f2b9fd8e9afe')$q$, 'P0001');
RESET ROLE;
-- and the list is easy to extend
INSERT INTO admin_excluded_accounts (user_id, note) VALUES ('e1400000-0000-0000-0000-000000000006', 'local test') ON CONFLICT DO NOTHING;
INSERT INTO r SELECT 's7', pg_temp.summary('ad140000-0000-0000-0000-000000000001');
SELECT pg_temp.ok(pg_temp.n(b.v,'counts','workers') = pg_temp.n(a.v,'counts','workers') - 1, 'adding a row excludes that worker') FROM r a, r b WHERE a.k='s6' AND b.k='s7';
DELETE FROM admin_excluded_accounts WHERE user_id = 'e1400000-0000-0000-0000-000000000006';

-- H. Reading changed nothing --------------------------------------------------
SELECT pg_temp.ok((SELECT count(*) FROM admin_excluded_accounts) = 1, 'only the seeded test account is excluded');

SET client_min_messages = notice;
DO $$ BEGIN RAISE NOTICE 'admin dashboard tests (014): PASS'; END $$;

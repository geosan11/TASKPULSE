-- LOCAL ONLY. End-to-end business flow after 009: create -> fund -> submit ->
-- review -> cancel -> refunds -> referral rules -> ledger reconciliation.
-- Every check raises 'FAILED: ...' on a wrong result; prints PASS at the end.
\set ON_ERROR_STOP 1
SET client_min_messages = warning;
CREATE OR REPLACE FUNCTION pg_temp.act(p_uid uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), false) $$;
CREATE OR REPLACE FUNCTION pg_temp.ok(c boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
  BEGIN IF c IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', msg; END IF; END $$;
-- expect an exception containing p_err from running p_sql as role p_role / user p_uid
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
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO PUBLIC;

-- Users ------------------------------------------------------------------
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
 ('b1000000-0000-0000-0000-000000000001','acme@x.com','{"username":"acme","phone":"08031110001","account_type":"business","business_name":"Acme"}'),
 ('b1000000-0000-0000-0000-000000000002','other@x.com','{"username":"otherbiz","phone":"08031110002","account_type":"business"}'),
 ('a1000000-0000-0000-0000-000000000001','admin@x.com','{"username":"boss","phone":"08031110003"}'),
 ('e1000000-0000-0000-0000-000000000001','w1@x.com','{"username":"wone","phone":"08031110011"}'),
 ('e1000000-0000-0000-0000-000000000002','w2@x.com','{"username":"wtwo","phone":"08031110012"}'),
 ('e1000000-0000-0000-0000-000000000003','w3@x.com','{"username":"wthree","phone":"08031110013"}');
UPDATE profiles SET role = 'admin' WHERE username = 'boss';
-- referrer R (a worker who ALSO runs a business account) and referee F
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
 ('f1000000-0000-0000-0000-000000000001','r@x.com','{"username":"rrr","phone":"08031110021","account_type":"business"}');
INSERT INTO auth.users (id, email, raw_user_meta_data) SELECT
 'f1000000-0000-0000-0000-000000000002','f@x.com',
 jsonb_build_object('username','fff','phone','08031110022','referred_by_code',(SELECT referral_code FROM profiles WHERE username='rrr'));

SELECT pg_temp.ok((SELECT referral_bonus_referee FROM marketplace_settings) = 0, 'referee bonus defaults to 0 after 009');

CREATE TEMP TABLE r (k text primary key, v jsonb);
GRANT ALL ON r TO PUBLIC;
-- A. Pitch pricing: 100 x N300 + 25% = N37,500 ---------------------------
SELECT pg_temp.act('b1000000-0000-0000-0000-000000000001');
SET ROLE authenticated;
INSERT INTO r SELECT 'pitch', create_campaign('Pitch campaign','Follow us and send a screenshot of it','Social','text',300,100,NULL);
INSERT INTO r SELECT 'draft', create_campaign('Draft campaign','Follow us and send a screenshot of it','Social','text',300,5,NULL);
RESET ROLE;
SELECT pg_temp.ok((v->>'reward_budget')::numeric = 30000 AND (v->>'platform_fee')::numeric = 7500
                  AND (v->>'total_charge')::numeric = 37500, 'pitch total 37,500') FROM r WHERE k='pitch';

-- B. Bad inputs ---------------------------------------------------------
SELECT pg_temp.fails('b1000000-0000-0000-0000-000000000001','authenticated',
  $q$SELECT create_campaign('Bad one','Follow us and send a screenshot of it','Social','text',0,5,NULL)$q$,'invalid_reward');
SELECT pg_temp.fails('b1000000-0000-0000-0000-000000000001','authenticated',
  $q$SELECT create_campaign('Bad one','Follow us and send a screenshot of it','Social','text',-300,5,NULL)$q$,'invalid_reward');
SELECT pg_temp.fails('b1000000-0000-0000-0000-000000000001','authenticated',
  $q$SELECT create_campaign('Bad one','Follow us and send a screenshot of it','Social','text',300.5,5,NULL)$q$,'invalid_reward');
SELECT pg_temp.fails('b1000000-0000-0000-0000-000000000001','authenticated',
  $q$SELECT create_campaign('Bad one','Follow us and send a screenshot of it','Social','text',5001,5,NULL)$q$,'invalid_reward');
SELECT pg_temp.fails('b1000000-0000-0000-0000-000000000001','authenticated',
  $q$SELECT create_campaign('Bad one','Follow us and send a screenshot of it','Social','text',NULL,5,NULL)$q$,'invalid_reward');
SELECT pg_temp.fails('b1000000-0000-0000-0000-000000000001','authenticated',
  $q$SELECT create_campaign('Bad one','Follow us and send a screenshot of it','Social','text',300,4,NULL)$q$,'invalid_slots');
SELECT pg_temp.fails('b1000000-0000-0000-0000-000000000001','authenticated',
  $q$SELECT create_campaign('Bad one','Follow us and send a screenshot of it','Social','text',300,10001,NULL)$q$,'invalid_slots');
SELECT pg_temp.fails('e1000000-0000-0000-0000-000000000001','authenticated',
  $q$SELECT create_campaign('Bad one','Follow us and send a screenshot of it','Social','text',300,5,NULL)$q$,'business_account_required');
SELECT pg_temp.fails('b1000000-0000-0000-0000-000000000001','authenticated',
  $q$UPDATE campaigns SET escrow_balance = 999999$q$,'permission denied');
SELECT pg_temp.fails('b1000000-0000-0000-0000-000000000001','authenticated',
  $q$SELECT settle_campaign_funding('camp_x', 1)$q$,'permission denied');
SELECT pg_temp.fails(NULL,'anon', $q$SELECT count(*) FROM campaigns$q$,'permission denied');

-- C. Funding ------------------------------------------------------------
SET ROLE service_role;
SELECT pg_temp.fails(NULL,'service_role',
  format($q$SELECT create_campaign_payment('b1000000-0000-0000-0000-000000000002','%s','camp_steal0001')$q$,
         (SELECT v->>'campaign_id' FROM r WHERE k='pitch')),'not_campaign_owner');
SELECT create_campaign_payment('b1000000-0000-0000-0000-000000000001', (SELECT (v->>'campaign_id')::uuid FROM r WHERE k='pitch'), 'camp_pitch_under');
SELECT create_campaign_payment('b1000000-0000-0000-0000-000000000001', (SELECT (v->>'campaign_id')::uuid FROM r WHERE k='pitch'), 'camp_pitch_ok');
SELECT create_campaign_payment('b1000000-0000-0000-0000-000000000001', (SELECT (v->>'campaign_id')::uuid FROM r WHERE k='pitch'), 'camp_pitch_twice');
SELECT create_campaign_payment('b1000000-0000-0000-0000-000000000001', (SELECT (v->>'campaign_id')::uuid FROM r WHERE k='draft'), 'camp_draft_late');
SELECT pg_temp.ok((SELECT amount FROM campaign_payments WHERE reference='camp_pitch_ok') = 37500, 'checkout amount = 37,500 (3,750,000 kobo)');
SELECT pg_temp.ok((settle_campaign_funding('camp_pitch_under', 37499)->>'error') = 'underpaid', 'underpaid refused');
SELECT pg_temp.ok((SELECT status FROM campaigns WHERE id=(SELECT (v->>'campaign_id')::uuid FROM r WHERE k='pitch')) = 'pending_payment', 'not live when underpaid');
SELECT pg_temp.ok((settle_campaign_funding('camp_pitch_ok', 37500)->>'success')::boolean, 'settles');
SELECT pg_temp.ok((settle_campaign_funding('camp_pitch_ok', 37500)->>'duplicate')::boolean, 'replay is duplicate');
SELECT pg_temp.ok((settle_campaign_funding('camp_pitch_twice', 38312)->>'reason') = 'already_funded', 'second payment flagged already_funded');
RESET ROLE;
SELECT pg_temp.ok(status = 'active' AND escrow_balance = 30000, 'live + escrow 30,000')
  FROM campaigns WHERE title='Pitch campaign';
SELECT pg_temp.ok((SELECT count(*) FROM campaign_ledger WHERE entry_type='funding') = 1, 'funded once');
SELECT pg_temp.ok((SELECT reward FROM tasks WHERE campaign_id=(SELECT id FROM campaigns WHERE title='Pitch campaign')) = 300, 'worker sees N300');

-- Draft cancelled, then its checkout is paid late -> full refund listed
SELECT pg_temp.act('b1000000-0000-0000-0000-000000000001');
SET ROLE authenticated;
SELECT set_campaign_status((SELECT id FROM campaigns WHERE title='Draft campaign'), 'cancelled');
RESET ROLE;
SET ROLE service_role;
SELECT pg_temp.ok((settle_campaign_funding('camp_draft_late', 1875)->>'reason') = 'campaign_cancelled', 'late payment on cancelled draft flagged');
RESET ROLE;

-- D/E/F. Submit, approve exactly once, reject reopens slot ---------------
CREATE TEMP TABLE t AS SELECT task_id FROM campaigns WHERE title='Pitch campaign';
GRANT SELECT ON t TO PUBLIC;
SELECT pg_temp.fails('b1000000-0000-0000-0000-000000000001','authenticated',
  $q$SELECT submit_task((SELECT task_id FROM t),'done',NULL)$q$,'own_campaign');
SELECT pg_temp.act('e1000000-0000-0000-0000-000000000001'); SET ROLE authenticated;
SELECT submit_task((SELECT task_id FROM t),'done w1',NULL); RESET ROLE;
SELECT pg_temp.fails('e1000000-0000-0000-0000-000000000001','authenticated',
  $q$SELECT submit_task((SELECT task_id FROM t),'again',NULL)$q$,'already_submitted');
SELECT pg_temp.act('e1000000-0000-0000-0000-000000000002'); SET ROLE authenticated;
SELECT submit_task((SELECT task_id FROM t),'done w2',NULL); RESET ROLE;
SELECT pg_temp.act('e1000000-0000-0000-0000-000000000003'); SET ROLE authenticated;
SELECT submit_task((SELECT task_id FROM t),'done w3',NULL); RESET ROLE;
SELECT pg_temp.ok(slots_pending = 3, 'three pending') FROM campaigns WHERE title='Pitch campaign';
SELECT pg_temp.ok(spots_left = 97, 'spots 97') FROM tasks WHERE id=(SELECT task_id FROM t);

-- another business cannot review it; worker cannot either
SELECT pg_temp.fails('b1000000-0000-0000-0000-000000000002','authenticated',
  format($q$SELECT review_submission('%s', true, NULL)$q$, (SELECT id FROM task_completions WHERE proof_text='done w1')),'not_campaign_owner');
SELECT pg_temp.act('b1000000-0000-0000-0000-000000000001'); SET ROLE authenticated;
SELECT review_submission((SELECT id FROM task_completions WHERE proof_text='done w1'), true, NULL);
SELECT pg_temp.ok((review_submission((SELECT id FROM task_completions WHERE proof_text='done w1'), true, NULL)->>'duplicate')::boolean, 'double approve is a no-op');
SELECT review_submission((SELECT id FROM task_completions WHERE proof_text='done w3'), false, 'blurry');
RESET ROLE;
SELECT pg_temp.ok(withdrawable_balance = 300, 'worker credited exactly N300') FROM profiles WHERE username='wone';
SELECT pg_temp.ok((SELECT count(*) FROM transactions WHERE type='task_payout' AND user_id='e1000000-0000-0000-0000-000000000001') = 1, 'one payout row');
SELECT pg_temp.ok(withdrawable_balance = 0, 'rejected worker unpaid') FROM profiles WHERE username='wthree';
SELECT pg_temp.ok(escrow_balance = 29700 AND slots_approved = 1 AND slots_pending = 1, 'escrow after 1 approve')
  FROM campaigns WHERE title='Pitch campaign';
SELECT pg_temp.ok(spots_left = 98, 'rejected slot reopened') FROM tasks WHERE id=(SELECT task_id FROM t);

-- G. Cancel: unused rewards + their fee are owed back ---------------------
SELECT pg_temp.act('b1000000-0000-0000-0000-000000000001'); SET ROLE authenticated;
SELECT pg_temp.ok((set_campaign_status((SELECT id FROM campaigns WHERE title='Pitch campaign'),'cancelled')->>'refund_due')::numeric = 29400 + 7350,
                  'cancel refund = 98 unused slots x 375');
SELECT review_submission((SELECT id FROM task_completions WHERE proof_text='done w2'), false, 'wrong account');
RESET ROLE;
SELECT pg_temp.ok(refund_due = 37125 AND fee_refund_due = 7425 AND escrow_balance = 0,
                  'business pays 375 for its 1 approved response')
  FROM campaigns WHERE title='Pitch campaign';
SELECT pg_temp.fails('e1000000-0000-0000-0000-000000000003','authenticated',
  $q$SELECT submit_task((SELECT task_id FROM t),'late',NULL)$q$,'task_not_available');

-- H. Refund admin tools ----------------------------------------------------
SELECT pg_temp.fails('b1000000-0000-0000-0000-000000000001','authenticated', $q$SELECT * FROM admin_refunds_owed()$q$, 'admin_required');
SELECT pg_temp.act('a1000000-0000-0000-0000-000000000001');
SELECT pg_temp.ok((SELECT count(*) FROM admin_refunds_owed()) = 4, 'owed: campaign + underpaid + duplicate + late draft');
SELECT pg_temp.ok((SELECT sum(amount_owed) FROM admin_refunds_owed()) = 37125 + 37499 + 38312 + 1875, 'owed total');
SELECT pg_temp.fails('a1000000-0000-0000-0000-000000000001','authenticated',
  $q$SELECT record_campaign_refund((SELECT id FROM campaigns WHERE title='Pitch campaign'), 37126, 'RFD_1')$q$,'refund_exceeds_due');
SET ROLE authenticated;
SELECT record_campaign_refund((SELECT id FROM campaigns WHERE title='Pitch campaign'), 37125, 'RFD_1');
SELECT record_payment_refund('camp_draft_late', 'RFD_2');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM admin_refunds_owed()) = 2, 'two still owed');

-- I. Referral rules --------------------------------------------------------
-- (1) referrer's own business campaign does not count
SELECT pg_temp.act('f1000000-0000-0000-0000-000000000001'); SET ROLE authenticated;
INSERT INTO r SELECT 'self'||i, create_campaign('Self campaign '||i,'Follow us and send a screenshot of it','Social','text',300,5,NULL) FROM generate_series(1,3) i;
RESET ROLE;
-- (2) third-party N50 campaigns: fee 3 x 12.50 does not cover N200
SELECT pg_temp.act('b1000000-0000-0000-0000-000000000002'); SET ROLE authenticated;
INSERT INTO r SELECT 'cheap'||i, create_campaign('Cheap campaign '||i,'Follow us and send a screenshot of it','Social','text',50,5,NULL) FROM generate_series(1,3) i;
INSERT INTO r SELECT 'fair'||i, create_campaign('Fair campaign '||i,'Follow us and send a screenshot of it','Social','text',300,5,NULL) FROM generate_series(1,3) i;
RESET ROLE;
SET ROLE service_role;
SELECT create_campaign_payment(business_id, id, 'camp_ref_'||substr(md5(id::text),1,12)) FROM campaigns WHERE title ~ '^(Self|Cheap|Fair) campaign';
SELECT settle_campaign_funding(reference, amount) FROM campaign_payments WHERE reference LIKE 'camp_ref_%';
RESET ROLE;
CREATE OR REPLACE FUNCTION pg_temp.do_tasks(p_pattern text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c record; BEGIN
  FOR c IN SELECT id, task_id, business_id FROM campaigns WHERE title ~ p_pattern ORDER BY title LOOP
    PERFORM set_config('request.jwt.claim.sub','f1000000-0000-0000-0000-000000000002',false);
    PERFORM submit_task(c.task_id,'proof',NULL);
    PERFORM set_config('request.jwt.claim.sub',c.business_id::text,false);
    PERFORM review_submission((SELECT id FROM task_completions WHERE task_id=c.task_id AND user_id='f1000000-0000-0000-0000-000000000002'), true, NULL);
  END LOOP; END $$;
SELECT pg_temp.do_tasks('^Self campaign');
SELECT pg_temp.ok(bonus_status = 'pending', 'own-business tasks do not qualify') FROM referrals WHERE referee_username='fff';
SELECT pg_temp.do_tasks('^Cheap campaign');
SELECT pg_temp.ok(bonus_status = 'pending', 'N50 tasks do not cover the bonus yet') FROM referrals WHERE referee_username='fff';
SELECT pg_temp.do_tasks('^Fair campaign [12]');
SELECT pg_temp.ok(bonus_status = 'pending', 'fee 37.50 + 150 = 187.50 still short') FROM referrals WHERE referee_username='fff';
SELECT pg_temp.do_tasks('^Fair campaign 3');
SELECT pg_temp.ok(bonus_status = 'paid' AND bonus_referrer_amount = 200 AND bonus_referee_amount = 0,
                  'bonus paid once third-party fee covers it') FROM referrals WHERE referee_username='fff';
SELECT pg_temp.ok((SELECT count(*) FROM transactions WHERE type='referral_bonus') = 1, 'bonus paid exactly once');
SELECT pg_temp.ok(withdrawable_balance = 200, 'referrer got N200') FROM profiles WHERE username='rrr';
SELECT pg_temp.ok(withdrawable_balance = 3*300 + 3*50 + 3*300, 'referee got only task rewards') FROM profiles WHERE username='fff';

-- J. Reconciliation -------------------------------------------------------
RESET ROLE;
SELECT pg_temp.act(NULL);
SELECT pg_temp.ok((SELECT count(*) FROM campaign_ledger_check()) = 0, 'every campaign reconciles');
SELECT pg_temp.ok((SELECT count(*) FROM campaigns c WHERE c.escrow_balance <> c.reward_budget - c.slots_approved*c.reward_per_completion - (c.refund_due - c.fee_refund_due)
                   AND c.funded_at IS NOT NULL) = 0, 'escrow identity');

SET client_min_messages = notice;
DO $$ BEGIN RAISE NOTICE 'business flow tests (009): PASS'; END $$;

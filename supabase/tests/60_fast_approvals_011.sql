-- LOCAL ONLY. Runs after 011 (and after 40/50, so older campaigns exist).
-- Fast approvals: modes, Tier 1 checks, human-review routing, review window,
-- reversal, release, auto-approve, idempotency, referral timing, ledger.
-- Every check raises 'FAILED: ...' on a wrong result; prints PASS at the end.
\set ON_ERROR_STOP 1
SET client_min_messages = warning;
CREATE OR REPLACE FUNCTION pg_temp.ok(c boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
  BEGIN IF c IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', msg; END IF; END $$;
-- run SQL as a signed-in user (role authenticated) and return its jsonb result
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
-- expect an error containing p_err from p_sql run as role p_role / user p_uid
CREATE OR REPLACE FUNCTION pg_temp.fails(p_uid uuid, p_role text, p_sql text, p_err text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), false);
  BEGIN
    EXECUTE format('SET LOCAL ROLE %I', p_role);
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claim.sub', '', false);
    IF position(p_err IN SQLERRM) = 0 THEN RAISE EXCEPTION 'FAILED: % gave "%" not "%"', p_sql, SQLERRM, p_err; END IF;
    RETURN;
  END;
  EXECUTE 'RESET ROLE';
  RAISE EXCEPTION 'FAILED: expected % from %', p_err, p_sql;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO PUBLIC;

CREATE TEMP TABLE k (name text PRIMARY KEY, v text);
GRANT ALL ON k TO PUBLIC;
CREATE OR REPLACE FUNCTION pg_temp.g(p text) RETURNS text LANGUAGE sql AS $$ SELECT v FROM k WHERE name = p $$;

-- create + fund a campaign as the business; remembers campaign id and task id
CREATE OR REPLACE FUNCTION pg_temp.campaign(p_key text, p_biz uuid, p_title text, p_cat text, p_proof text,
    p_reward int, p_target text, p_mode text, p_code text, p_code_mode text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb; v_id uuid;
BEGIN
  v := pg_temp.run(p_biz, format('SELECT create_campaign(%L, %L, %L, %L, %s, 10, %L, %L, %L, %L)',
        p_title, 'Open the link, complete every step honestly and send your proof here.', p_cat, p_proof,
        p_reward, p_target, p_mode, p_code, p_code_mode));
  v_id := (v->>'campaign_id')::uuid;
  PERFORM create_campaign_payment(p_biz, v_id, 'ref011_' || p_key);
  PERFORM settle_campaign_funding('ref011_' || p_key, (SELECT total_charge FROM campaigns WHERE id = v_id));
  INSERT INTO k VALUES (p_key, v_id::text), (p_key || '_task', (SELECT task_id FROM campaigns WHERE id = v_id));
  RETURN v;
END $$;
-- start a task as a worker, back-dated so the minimum-time check passes
CREATE OR REPLACE FUNCTION pg_temp.start(p_uid uuid, p_key text, p_ago interval DEFAULT '10 minutes') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v jsonb;
BEGIN
  v := pg_temp.run(p_uid, format('SELECT start_task(%L)', pg_temp.g(p_key || '_task')));
  UPDATE task_starts SET started_at = NOW() - p_ago WHERE user_id = p_uid AND task_id = pg_temp.g(p_key || '_task');
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.submit(p_uid uuid, p_key text, p_text text, p_url text, p_code text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  RETURN pg_temp.run(p_uid, format('SELECT submit_task(%L, %L, %L, %L)', pg_temp.g(p_key || '_task'), p_text, p_url, p_code));
END $$;
CREATE OR REPLACE FUNCTION pg_temp.sub(p_uid uuid, p_key text) RETURNS task_completions LANGUAGE sql AS $$
  SELECT * FROM task_completions WHERE user_id = p_uid AND task_id = pg_temp.g(p_key || '_task') $$;
CREATE OR REPLACE FUNCTION pg_temp.review(p_biz uuid, p_uid uuid, p_key text, p_ok boolean, p_note text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  RETURN pg_temp.run(p_biz, format('SELECT review_submission(%L, %L, %L)', (pg_temp.sub(p_uid, p_key)).id, p_ok, p_note));
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expire(p_uid uuid, p_key text) RETURNS void LANGUAGE sql AS $$
  UPDATE task_completions SET review_deadline_at = NOW() - interval '1 second', completed_at = NOW() - interval '25 hours'
   WHERE user_id = p_uid AND task_id = pg_temp.g(p_key || '_task') $$;
CREATE OR REPLACE FUNCTION pg_temp.bal(p_uid uuid) RETURNS profiles LANGUAGE sql AS $$ SELECT * FROM profiles WHERE id = p_uid $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO PUBLIC;

-- =========================================================================
-- 0. Migration shape, defaults, existing data, privileges
-- =========================================================================
SELECT pg_temp.ok((SELECT review_window_auto_hours = 24 AND review_window_human_hours = 48 AND NOT hold_flagged_for_review
                     AND trusted_after_tasks = 3 AND human_review_reward_above = 1000
                     AND min_task_seconds = 60 FROM marketplace_settings), 'settings defaults 24h auto / 48h human / no hold / 3 / N1000 / 60s');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'marketplace_settings' AND column_name = 'review_window_hours'),
                  'single review_window_hours setting replaced');
SELECT pg_temp.ok(resolve_approval_mode('Surveys', 'text', FALSE, NULL, 'auto_24h') = 'auto', 'old auto_24h value from old app builds maps to auto');
SELECT pg_temp.ok((SELECT count(*) FROM task_completions WHERE lower(status) = 'approved' AND payout_status IS DISTINCT FROM 'released') = 0,
                  'pre-011 approved rows marked released');
SELECT pg_temp.ok((SELECT count(*) FROM task_completions WHERE lower(status) = 'pending'
                     AND (review_deadline_at IS NULL OR review_deadline_at < NOW() + interval '47 hours'
                          OR review_window_kind IS DISTINCT FROM 'human')) = 0,
                  'pre-011 pending rows get a full 48h human window from migration time');
SELECT pg_temp.ok((SELECT bool_and(approval_mode = 'manual') FROM campaigns), 'existing campaigns become manual');
SELECT pg_temp.ok((SELECT count(*) FROM campaign_ledger_check()) = 0, 'ledger reconciles right after migration');
SELECT pg_temp.ok((SELECT count(*) FROM pending_hold_check()) = 0, 'pending balances reconcile right after migration');

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
 ('c1000000-0000-0000-0000-000000000001','fastbiz@x.com','{"username":"fastbiz","phone":"08032220001","account_type":"business","business_name":"FastBiz"}'),
 ('d1000000-0000-0000-0000-000000000001','fw1@x.com','{"username":"fwone","phone":"08032220011"}'),
 ('d1000000-0000-0000-0000-000000000002','fw2@x.com','{"username":"fwtwo","phone":"08032220012"}'),
 ('d1000000-0000-0000-0000-000000000003','fw3@x.com','{"username":"fwthree","phone":"08032220013"}'),
 ('d1000000-0000-0000-0000-000000000010','fr@x.com','{"username":"frefer","phone":"08032220020"}');
INSERT INTO auth.users (id, email, raw_user_meta_data) SELECT
 'd1000000-0000-0000-0000-000000000011','ff@x.com',
 jsonb_build_object('username','ffriend','phone','08032220021','referred_by_code',(SELECT referral_code FROM profiles WHERE username='frefer'));
\set BIZ '''c1000000-0000-0000-0000-000000000001'''
\set W1 '''d1000000-0000-0000-0000-000000000001'''
\set W2 '''d1000000-0000-0000-0000-000000000002'''
\set W3 '''d1000000-0000-0000-0000-000000000003'''
\set RR '''d1000000-0000-0000-0000-000000000010'''
\set FF '''d1000000-0000-0000-0000-000000000011'''

-- RLS / grants: anon gets nothing, workers never see the code hash
SELECT pg_temp.fails(NULL, 'anon', $q$SELECT count(*) FROM campaign_secrets$q$, 'permission denied');
SELECT pg_temp.fails(NULL, 'anon', $q$SELECT count(*) FROM task_starts$q$, 'permission denied');
SELECT pg_temp.fails(NULL, 'anon', $q$SELECT count(*) FROM proof_hashes$q$, 'permission denied');
SELECT pg_temp.fails(NULL, 'anon', $q$SELECT start_task('x')$q$, 'permission denied');
SELECT pg_temp.fails(NULL, 'anon', $q$SELECT submit_task('x', 'a', NULL, NULL)$q$, 'permission denied');
SELECT pg_temp.fails(NULL, 'anon', $q$SELECT process_my_review_windows()$q$, 'permission denied');
SELECT pg_temp.fails(NULL, 'anon', $q$SELECT create_campaign('t','i','Surveys','text',300,10,NULL,NULL,NULL,NULL)$q$, 'permission denied');
SELECT pg_temp.fails(:W1, 'authenticated', $q$SELECT count(*) FROM campaign_secrets$q$, 'permission denied');
SELECT pg_temp.fails(:W1, 'authenticated', $q$SELECT count(*) FROM task_starts$q$, 'permission denied');
SELECT pg_temp.fails(:W1, 'authenticated', $q$SELECT process_review_windows(10)$q$, 'permission denied');
SELECT pg_temp.fails(:W1, 'authenticated', $q$SELECT release_submission_payout(gen_random_uuid())$q$, 'permission denied');
SELECT pg_temp.fails(:W1, 'authenticated', $q$SELECT _approve_submission(gen_random_uuid(), 'instant', NULL, NULL)$q$, 'permission denied');
SELECT pg_temp.fails(:W1, 'authenticated', $q$SELECT _release_submission(gen_random_uuid())$q$, 'permission denied');
SELECT pg_temp.fails(:W1, 'authenticated', $q$SELECT _code_hash('a', 'b')$q$, 'permission denied');
SELECT pg_temp.fails(:W1, 'authenticated', $q$SELECT record_proof_hash(auth.uid(), auth.uid()::text || '/x.png', repeat('a', 64), 1)$q$, 'permission denied');
SELECT pg_temp.fails(:W1, 'authenticated', $q$UPDATE profiles SET pending_balance = 0 WHERE id = auth.uid()$q$, 'permission denied');

-- =========================================================================
-- 1. Approval-mode resolution at creation
-- =========================================================================
SELECT pg_temp.ok(resolve_approval_mode('Surveys', 'text', TRUE, NULL, NULL) = 'instant', 'Surveys + code defaults to instant');
SELECT pg_temp.ok(resolve_approval_mode('App Tests', 'text', TRUE, NULL, NULL) = 'instant', 'App Tests + code defaults to instant');
SELECT pg_temp.ok(resolve_approval_mode('Surveys', 'text', FALSE, NULL, NULL) = 'auto', 'Surveys without code -> auto');
SELECT pg_temp.ok(resolve_approval_mode('App Tests', 'screenshot', FALSE, NULL, NULL) = 'auto', 'App Tests screenshot -> auto');
SELECT pg_temp.ok(resolve_approval_mode('Community & Content', 'link', FALSE, 'https://x.com', NULL) = 'auto', 'C&C link -> auto');
SELECT pg_temp.ok(resolve_approval_mode('Product Feedback', 'text', TRUE, NULL, NULL) = 'auto', 'Product Feedback forced to auto');
SELECT pg_temp.ok(resolve_approval_mode('Field Audits', 'screenshot', FALSE, NULL, 'manual') = 'manual', 'Field Audits may be manual');
SELECT pg_temp.fails(:BIZ, 'authenticated',
  $q$SELECT create_campaign('Store audit','Visit the store, check the shelf prices and send a photo','Field Audits','screenshot',300,10,NULL,'instant','CODE1',NULL)$q$,
  'instant_not_allowed_for_category');
SELECT pg_temp.fails(:BIZ, 'authenticated',
  $q$SELECT create_campaign('Feedback','Tell us honestly what you think of our new checkout page','Product Feedback','text',300,10,NULL,'instant','CODE1',NULL)$q$,
  'instant_not_allowed_for_category');
SELECT pg_temp.fails(:BIZ, 'authenticated',
  $q$SELECT create_campaign('Survey nocode','Answer the ten questions in our form honestly please','Surveys','text',300,10,NULL,'instant',NULL,NULL)$q$,
  'instant_needs_check');
SELECT pg_temp.fails(:BIZ, 'authenticated',
  $q$SELECT create_campaign('Survey short','Answer the ten questions in our form honestly please','Surveys','text',300,10,NULL,NULL,'abc',NULL)$q$,
  'invalid_completion_code');

-- Campaigns used below (all funded, 10 slots each)
SELECT pg_temp.campaign('s1', :BIZ, 'Code survey 1', 'Surveys', 'text', 300, 'https://forms.example.com/s1', NULL, 'Blue42');
SELECT pg_temp.campaign('s2', :BIZ, 'Code survey 2', 'Surveys', 'text', 300, 'https://forms.example.com/s2', NULL, 'Blue42');
SELECT pg_temp.campaign('s3', :BIZ, 'Code survey 3', 'Surveys', 'text', 300, 'https://forms.example.com/s3', NULL, 'Blue42');
SELECT pg_temp.campaign('s4', :BIZ, 'Code survey 4', 'Surveys', 'text', 300, 'https://forms.example.com/s4', NULL, 'Blue42');
SELECT pg_temp.campaign('s5', :BIZ, 'Code survey 5', 'Surveys', 'text', 300, NULL, NULL, 'Blue42');
SELECT pg_temp.campaign('s6', :BIZ, 'Code survey 6', 'Surveys', 'text', 300, NULL, NULL, 'Blue42');
SELECT pg_temp.campaign('s7', :BIZ, 'Code survey 7', 'Surveys', 'text', 300, NULL, NULL, 'Blue42');
SELECT pg_temp.campaign('cx', :BIZ, 'Code survey cancel', 'Surveys', 'text', 300, NULL, NULL, 'Blue42');
SELECT pg_temp.campaign('hi', :BIZ, 'High reward survey', 'Surveys', 'text', 1500, NULL, NULL, 'Blue42');
SELECT pg_temp.campaign('ln', :BIZ, 'Link app test', 'App Tests', 'link', 300, 'https://www.forms.example.com/start', 'instant', NULL);
SELECT pg_temp.campaign('sc', :BIZ, 'Screenshot community', 'Community & Content', 'screenshot', 200, NULL, NULL, NULL);
SELECT pg_temp.campaign('m1', :BIZ, 'Manual community', 'Community & Content', 'text', 200, NULL, 'manual', NULL);
SELECT pg_temp.campaign('fb', :BIZ, 'Feedback round', 'Product Feedback', 'text', 300, NULL, NULL, NULL);
SELECT pg_temp.campaign('un', :BIZ, 'Unique code survey', 'Surveys', 'text', 300, 'https://survey.example.org/u', NULL, 'super-secret-value-123', 'unique');
SELECT pg_temp.campaign('r1', :BIZ, 'Referral work 1', 'Community & Content', 'text', 300, NULL, NULL, NULL);
SELECT pg_temp.campaign('r2', :BIZ, 'Referral work 2', 'Community & Content', 'text', 300, NULL, NULL, NULL);
SELECT pg_temp.campaign('r3', :BIZ, 'Referral work 3', 'Community & Content', 'text', 300, NULL, NULL, NULL);

SELECT pg_temp.ok((SELECT approval_mode FROM campaigns WHERE id = pg_temp.g('s1')::uuid) = 'instant', 's1 is instant');
SELECT pg_temp.ok((SELECT approval_mode FROM campaigns WHERE id = pg_temp.g('sc')::uuid) = 'auto', 'sc is auto');
SELECT pg_temp.ok((SELECT approval_mode FROM campaigns WHERE id = pg_temp.g('fb')::uuid) = 'auto', 'fb is auto');
SELECT pg_temp.ok((SELECT approval_mode FROM campaigns WHERE id = pg_temp.g('ln')::uuid) = 'instant', 'link+target campaign may be instant');
SELECT pg_temp.ok((SELECT code_hash <> 'Blue42' AND code_hash !~* 'blue' AND length(code_hash) = 64 FROM campaign_secrets
                    WHERE campaign_id = pg_temp.g('s1')::uuid), 'code stored only as salted sha256');
-- business reads its own campaign row: mode yes, secret no (no column, no table access)
SELECT pg_temp.ok((pg_temp.run(:BIZ, format($q$SELECT to_jsonb(c) FROM campaigns c WHERE id = %L$q$, pg_temp.g('s1')))) ? 'completion_code_mode'
                  AND NOT (pg_temp.run(:BIZ, format($q$SELECT to_jsonb(c) FROM campaigns c WHERE id = %L$q$, pg_temp.g('s1')))::text ~* 'blue42'),
                  'campaign row has no code material');
SELECT pg_temp.fails(:BIZ, 'authenticated', $q$SELECT count(*) FROM campaign_secrets$q$, 'permission denied');

-- =========================================================================
-- 2. First-3 rule: correct code, but new workers always go to human review
-- =========================================================================
SELECT pg_temp.ok((pg_temp.start(:W1, 's1')->>'needs_code')::boolean, 'start_task tells the worker a code is needed');
SELECT pg_temp.ok(pg_temp.start(:W1, 's1') ? 'start_ref' AND NOT (pg_temp.start(:W1, 's1')::text ~* 'blue42'), 'start_task never returns the code');
SELECT pg_temp.ok(pg_temp.submit(:W1, 's1', NULL, NULL, 'blue42 ')->>'status' = 'pending', 'task 1 (new worker) not instant');
SELECT pg_temp.ok((pg_temp.sub(:W1, 's1')).review_reasons = ARRAY['new_worker'] AND (pg_temp.sub(:W1, 's1')).check_flags = '{}'
                  AND (pg_temp.sub(:W1, 's1')).code_status = 'match', 'reason new_worker, code matched (case-insensitive), no flags');
-- 48h path: anything a person must look at gets the human window, fixed at submit time
SELECT pg_temp.ok((pg_temp.sub(:W1, 's1')).review_window_kind = 'human'
                  AND (pg_temp.sub(:W1, 's1')).review_deadline_at BETWEEN NOW() + interval '47 hours 59 minutes' AND NOW() + interval '48 hours 1 minute',
                  'new-worker submission: 48h human window');
INSERT INTO k VALUES ('s1_deadline', (pg_temp.sub(:W1, 's1')).review_deadline_at::text);
SELECT pg_temp.review(:BIZ, :W1, 's1', TRUE);
SELECT pg_temp.ok((pg_temp.sub(:W1, 's1')).review_deadline_at = pg_temp.g('s1_deadline')::timestamptz,
                  'business approval keeps the stored 48h deadline (pending hold + reject window)');
SELECT pg_temp.ok((SELECT (metadata->>'release_at')::timestamptz FROM transactions WHERE reference = 'task_' || (pg_temp.sub(:W1, 's1')).id)
                  = pg_temp.g('s1_deadline')::timestamptz, 'payout tx release_at = stored deadline');
SELECT pg_temp.ok((pg_temp.sub(:W1, 's1')).payout_status = 'held' AND (pg_temp.sub(:W1, 's1')).approval_source = 'business', 'business approval -> held');
SELECT pg_temp.ok((pg_temp.bal(:W1)).pending_balance = 300 AND (pg_temp.bal(:W1)).withdrawable_balance = 0, 'approved = pending, not withdrawable');
SELECT pg_temp.ok((SELECT status FROM transactions WHERE reference = 'task_' || (pg_temp.sub(:W1, 's1')).id) = 'pending', 'task_payout tx pending');
SELECT pg_temp.start(:W1, 's2'); SELECT pg_temp.submit(:W1, 's2', NULL, NULL, 'BLUE42'); SELECT pg_temp.review(:BIZ, :W1, 's2', TRUE);
SELECT pg_temp.start(:W1, 's3'); SELECT pg_temp.submit(:W1, 's3', NULL, NULL, 'BLUE42');
SELECT pg_temp.ok((pg_temp.sub(:W1, 's3')).review_reasons @> ARRAY['new_worker'], 'third task still human-reviewed');
SELECT pg_temp.review(:BIZ, :W1, 's3', TRUE);

-- =========================================================================
-- 3. Instant approve: trusted worker + correct code + started long enough ago
-- =========================================================================
SELECT pg_temp.start(:W1, 's4');
SELECT pg_temp.ok((pg_temp.submit(:W1, 's4', NULL, NULL, 'Blue42')->>'instant')::boolean, '4th task instant-approved');
SELECT pg_temp.ok((pg_temp.sub(:W1, 's4')).status = 'approved' AND (pg_temp.sub(:W1, 's4')).approval_source = 'instant'
                  AND (pg_temp.sub(:W1, 's4')).payout_status = 'held'
                  AND (pg_temp.sub(:W1, 's4')).review_deadline_at BETWEEN NOW() + interval '23 hours 59 minutes' AND NOW() + interval '24 hours 1 minute',
                  'instant approval is held for 24h');
SELECT pg_temp.ok((pg_temp.sub(:W1, 's4')).review_window_kind = 'auto', '24h path: verified + instant -> auto window');
SELECT pg_temp.ok((pg_temp.bal(:W1)).pending_balance = 1200 AND (pg_temp.bal(:W1)).withdrawable_balance = 0, 'pending N1,200 after 4 approvals');
SELECT pg_temp.ok(jsonb_array_length(pg_temp.run(:BIZ, format($q$SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]') FROM list_review_submissions(%L, 'held', 50) x$q$, pg_temp.g('s4')))) = 1,
                  'instant item listed for the business in the held (reject-within) list');

-- =========================================================================
-- 4. Wrong code / missing code -> flagged, human review
-- =========================================================================
SELECT pg_temp.start(:W1, 's5');
SELECT pg_temp.ok(pg_temp.submit(:W1, 's5', NULL, NULL, 'RED99')->>'status' = 'pending', 'wrong code not instant');
SELECT pg_temp.ok((pg_temp.sub(:W1, 's5')).check_flags = ARRAY['wrong_code'] AND (pg_temp.sub(:W1, 's5')).code_status = 'mismatch', 'wrong_code flag');
SELECT pg_temp.ok((pg_temp.sub(:W1, 's5')).review_window_kind = 'human'
                  AND (pg_temp.sub(:W1, 's5')).review_deadline_at > NOW() + interval '47 hours 59 minutes', 'flagged submission: 48h window');
SELECT pg_temp.start(:W1, 's7');
SELECT pg_temp.ok(pg_temp.submit(:W1, 's7', 'I did it', NULL, NULL)->>'status' = 'pending', 'missing code not instant');
SELECT pg_temp.ok((pg_temp.sub(:W1, 's7')).check_flags @> ARRAY['missing_code'], 'missing_code flag');

-- =========================================================================
-- 5. Threshold: reward above N1,000 always human review
-- =========================================================================
SELECT pg_temp.start(:W1, 'hi');
SELECT pg_temp.ok(pg_temp.submit(:W1, 'hi', NULL, NULL, 'BLUE42')->>'status' = 'pending', 'N1,500 task not instant');
SELECT pg_temp.ok((pg_temp.sub(:W1, 'hi')).review_reasons = ARRAY['high_reward'] AND (pg_temp.sub(:W1, 'hi')).check_flags = '{}', 'high_reward reason');
SELECT pg_temp.ok((pg_temp.sub(:W1, 'hi')).review_window_kind = 'human'
                  AND (pg_temp.sub(:W1, 'hi')).review_deadline_at > NOW() + interval '47 hours 59 minutes', 'high reward: 48h window');

-- =========================================================================
-- 6. Too fast / never started
-- =========================================================================
SELECT pg_temp.start(:W1, 's6', interval '5 seconds');
SELECT pg_temp.ok(pg_temp.submit(:W1, 's6', NULL, NULL, 'BLUE42')->>'status' = 'pending', 'too-fast submission not instant');
SELECT pg_temp.ok((pg_temp.sub(:W1, 's6')).check_flags = ARRAY['too_fast'], 'too_fast flag');
SELECT pg_temp.ok(pg_temp.submit(:W2, 's6', NULL, NULL, 'BLUE42')->>'status' = 'pending', 'unstarted submission not instant');
SELECT pg_temp.ok((pg_temp.sub(:W2, 's6')).check_flags @> ARRAY['not_started'], 'not_started flag');

-- =========================================================================
-- 7. Link checks: https, domain match (www/subdomains ok), duplicates
-- =========================================================================
SELECT pg_temp.start(:W1, 'ln');
SELECT pg_temp.ok((pg_temp.submit(:W1, 'ln', 'https://forms.example.com/r/abc123', NULL, NULL)->>'instant')::boolean, 'valid matching link -> instant');
SELECT pg_temp.ok((pg_temp.sub(:W1, 'ln')).review_window_kind = 'auto'
                  AND (pg_temp.sub(:W1, 'ln')).review_deadline_at < NOW() + interval '24 hours 1 minute', 'link check passed: 24h auto window');
SELECT pg_temp.start(:W2, 'ln');
SELECT pg_temp.submit(:W2, 'ln', 'HTTPS://www.Forms.Example.com/r/abc123/#done', NULL, NULL);
SELECT pg_temp.ok((pg_temp.sub(:W2, 'ln')).check_flags @> ARRAY['duplicate_link'], 'same link (case/www/fragment/slash) -> duplicate_link');
SELECT pg_temp.start(:W3, 'ln');
SELECT pg_temp.submit(:W3, 'ln', 'http://evil.example.net/r/x', NULL, NULL);
SELECT pg_temp.ok((pg_temp.sub(:W3, 'ln')).check_flags @> ARRAY['link_not_https', 'link_domain_mismatch'], 'http + other domain flagged');
SELECT pg_temp.ok(_url_host('https://user@sub.forms.example.com:8443/x') = 'sub.forms.example.com', 'host parser');
SELECT pg_temp.ok(_url_host('https://forms.example.com.evil.io/x') = 'forms.example.com.evil.io', 'suffix trick parsed as other host');

-- =========================================================================
-- 8. Duplicate screenshot (server sha256, then storage ETag fallback) + text
-- =========================================================================
SELECT record_proof_hash(:W2, 'd1000000-0000-0000-0000-000000000002/a.png', repeat('ab', 32), 1000);
SELECT record_proof_hash(:W3, 'd1000000-0000-0000-0000-000000000003/b.png', repeat('ab', 32), 1000);
SELECT pg_temp.start(:W2, 'sc'); SELECT pg_temp.start(:W3, 'sc');
SELECT pg_temp.submit(:W2, 'sc', NULL, 'd1000000-0000-0000-0000-000000000002/a.png', NULL);
SELECT pg_temp.submit(:W3, 'sc', NULL, 'd1000000-0000-0000-0000-000000000003/b.png', NULL);
SELECT pg_temp.ok(NOT ((pg_temp.sub(:W2, 'sc')).check_flags @> ARRAY['duplicate_screenshot']), 'first screenshot not a duplicate');
SELECT pg_temp.ok((pg_temp.sub(:W3, 'sc')).check_flags @> ARRAY['duplicate_screenshot'], 'same sha256 -> duplicate_screenshot');
SELECT pg_temp.fails(NULL, 'service_role', $q$SELECT record_proof_hash('d1000000-0000-0000-0000-000000000002', 'someone-else/a.png', repeat('ab', 32), 1)$q$, 'invalid_proof_path');
INSERT INTO storage.objects (bucket_id, name, metadata) VALUES
 ('taskpulse-proofs', 'd1000000-0000-0000-0000-000000000001/c.png', '{"eTag":"\"5d41402abc4b2a76b9719d911017c592\"","size":2048}');
SELECT pg_temp.start(:W1, 'sc');
SELECT pg_temp.submit(:W1, 'sc', NULL, 'd1000000-0000-0000-0000-000000000001/c.png', NULL);
SELECT pg_temp.ok((pg_temp.sub(:W1, 'sc')).proof_etag = '5d41402abc4b2a76b9719d911017c592:2048', 'ETag fallback fingerprint recorded');
SELECT pg_temp.ok(NOT ((pg_temp.sub(:W1, 'sc')).check_flags @> ARRAY['screenshot_unverified']), 'ETag counts as verified');
SELECT pg_temp.start(:W1, 'm1'); SELECT pg_temp.start(:W2, 'm1');
SELECT pg_temp.submit(:W1, 'm1', 'Joined as   @fwone', NULL, NULL);
SELECT pg_temp.submit(:W2, 'm1', 'joined as @fwone', NULL, NULL);
SELECT pg_temp.ok((pg_temp.sub(:W2, 'm1')).check_flags @> ARRAY['duplicate_text'], 'duplicate text (case/space-insensitive)');
SELECT pg_temp.ok((pg_temp.sub(:W1, 'm1')).status = 'pending' AND (pg_temp.sub(:W1, 'm1')).review_reasons @> ARRAY['business_review'],
                  'manual mode: trusted worker still waits for the business');

-- Category rule: Product Feedback is always human-reviewed
SELECT pg_temp.start(:W1, 'fb');
SELECT pg_temp.submit(:W1, 'fb', 'The checkout button is hard to find on mobile', NULL, NULL);
SELECT pg_temp.ok((pg_temp.sub(:W1, 'fb')).review_reasons @> ARRAY['category_review'], 'Product Feedback -> category_review');
SELECT pg_temp.ok((pg_temp.sub(:W1, 'fb')).review_window_kind = 'human'
                  AND (pg_temp.sub(:W1, 'fb')).review_deadline_at > NOW() + interval '47 hours 59 minutes', 'Product Feedback: 48h window');
SELECT pg_temp.ok((pg_temp.sub(:W1, 'sc')).review_window_kind = 'human', 'screenshot proof: 48h window');

-- =========================================================================
-- 9. Per-worker unique codes
-- =========================================================================
INSERT INTO k SELECT 'w1ref', pg_temp.start(:W1, 'un')->>'start_ref';
SELECT pg_temp.ok((pg_temp.submit(:W1, 'un', NULL, NULL, lower(_unique_code('super-secret-value-123', pg_temp.g('w1ref'))))->>'instant')::boolean,
                  'unique per-worker code -> instant');
SELECT pg_temp.start(:W2, 'un');
SELECT pg_temp.submit(:W2, 'un', NULL, NULL, _unique_code('super-secret-value-123', pg_temp.g('w1ref')));
SELECT pg_temp.ok((pg_temp.sub(:W2, 'un')).check_flags @> ARRAY['wrong_code'], 'another worker''s unique code is rejected');

-- =========================================================================
-- 10. Rejection inside the window reverses the pending credit (ledger-balanced)
-- =========================================================================
CREATE TEMP TABLE before AS SELECT c.escrow_balance, c.slots_approved, p.pending_balance, p.approved_task_count
  FROM campaigns c, profiles p WHERE c.id = pg_temp.g('s4')::uuid AND p.id = :W1;
SELECT pg_temp.ok(pg_temp.review(:BIZ, :W1, 's4', FALSE, 'Code was shared publicly')->>'status' = 'rejected', 'business rejects inside window');
SELECT pg_temp.ok((pg_temp.sub(:W1, 's4')).payout_status = 'reversed' AND (pg_temp.sub(:W1, 's4')).status = 'rejected', 'submission reversed');
SELECT pg_temp.ok((SELECT c.escrow_balance = b.escrow_balance + 300 AND c.slots_approved = b.slots_approved - 1
                     FROM campaigns c, before b WHERE c.id = pg_temp.g('s4')::uuid), 'reward back in campaign escrow, slot freed');
SELECT pg_temp.ok((SELECT p.pending_balance = b.pending_balance - 300 AND p.approved_task_count = b.approved_task_count - 1
                     FROM profiles p, before b WHERE p.id = :W1), 'pending credit reversed, trust count reduced');
SELECT pg_temp.ok((SELECT status FROM transactions WHERE reference = 'task_' || (pg_temp.sub(:W1, 's4')).id) = 'reversed', 'tx marked reversed');
SELECT pg_temp.ok((SELECT count(*) FROM campaign_ledger WHERE entry_type = 'payout_reversal' AND completion_id = (pg_temp.sub(:W1, 's4')).id) = 1, 'payout_reversal ledger entry');
SELECT pg_temp.ok((SELECT spots_left FROM tasks WHERE id = pg_temp.g('s4_task')) = 10, 'slot open again for another worker');
SELECT pg_temp.ok((SELECT count(*) FROM campaign_ledger_check()) = 0, 'ledger reconciles after reversal');
SELECT pg_temp.ok(pg_temp.review(:BIZ, :W1, 's4', FALSE, 'again')->>'duplicate' = 'true', 'second reject is a no-op');
SELECT pg_temp.ok((SELECT count(*) FROM task_completions WHERE user_id = :W1 AND status = 'approved') = 5, 'trust score drops: reversed s4 no longer counts (s1 s2 s3 ln un)');

-- Reject a held item of a CANCELLED campaign: owed back to the business
SELECT pg_temp.start(:W1, 'cx');
SELECT pg_temp.ok((pg_temp.submit(:W1, 'cx', NULL, NULL, 'BLUE42')->>'instant')::boolean, 'cx instant');
SELECT pg_temp.run(:BIZ, format($q$SELECT set_campaign_status(%L, 'cancelled')$q$, pg_temp.g('cx')));
CREATE TEMP TABLE cx_before AS SELECT refund_due, escrow_balance FROM campaigns WHERE id = pg_temp.g('cx')::uuid;
SELECT pg_temp.review(:BIZ, :W1, 'cx', FALSE, 'Fraud');
SELECT pg_temp.ok((SELECT c.refund_due >= b.refund_due + 300 AND c.escrow_balance = b.escrow_balance FROM campaigns c, cx_before b
                    WHERE c.id = pg_temp.g('cx')::uuid), 'reversal on a cancelled campaign becomes refund_due');
SELECT pg_temp.ok((SELECT count(*) FROM campaign_ledger_check()) = 0, 'ledger reconciles after cancelled reversal');

-- =========================================================================
-- 11. Release after the window, and idempotency
-- =========================================================================
SELECT pg_temp.ok(release_submission_payout((pg_temp.sub(:W1, 's1')).id)->>'error' = 'window_open', 'no release while window open');
SELECT pg_temp.ok((pg_temp.bal(:W1)).withdrawable_balance = 0, 'still nothing withdrawable');
SELECT pg_temp.expire(:W1, 's1');
CREATE TEMP TABLE b2 AS SELECT pending_balance, withdrawable_balance FROM profiles WHERE id = :W1;
SET ROLE service_role;
SELECT pg_temp.ok((process_review_windows(100)->>'released')::int >= 1, 'scheduler released the closed window');
RESET ROLE;
SELECT pg_temp.ok((pg_temp.sub(:W1, 's1')).payout_status = 'released' AND (pg_temp.sub(:W1, 's1')).released_at IS NOT NULL, 's1 released');
SELECT pg_temp.ok((SELECT p.pending_balance = b.pending_balance - 300 AND p.withdrawable_balance = b.withdrawable_balance + 300
                    FROM profiles p, b2 b WHERE p.id = :W1), 'pending -> withdrawable N300');
SELECT pg_temp.ok((SELECT status FROM transactions WHERE reference = 'task_' || (pg_temp.sub(:W1, 's1')).id) = 'settled', 'tx settled on release');
-- idempotency: direct call, scheduler, and user-triggered processing do nothing more
SELECT pg_temp.ok(release_submission_payout((pg_temp.sub(:W1, 's1')).id)->>'duplicate' = 'true', 'second release is a no-op');
SET ROLE service_role;
SELECT pg_temp.ok((process_review_windows(100)->>'released')::int = 0, 'scheduler re-run releases nothing');
RESET ROLE;
SELECT pg_temp.ok((pg_temp.run(:W1, 'SELECT process_my_review_windows()')->>'released')::int = 0, 'user-triggered re-run releases nothing');
SELECT pg_temp.ok((SELECT p.withdrawable_balance = b.withdrawable_balance + 300 FROM profiles p, b2 b WHERE p.id = :W1), 'still exactly +N300');
SELECT pg_temp.fails(:BIZ, 'authenticated', format($q$SELECT review_submission(%L, false, 'too late')$q$, (pg_temp.sub(:W1, 's1')).id), 'review_window_closed');
-- held but window already closed (scheduler not run yet): reject refused too
SELECT pg_temp.expire(:W1, 's2');
SELECT pg_temp.fails(:BIZ, 'authenticated', format($q$SELECT review_submission(%L, false, 'too late')$q$, (pg_temp.sub(:W1, 's2')).id), 'review_window_closed');

-- =========================================================================
-- 12. Auto-approve after 24h (manual mode uses the same mechanism)
-- =========================================================================
SELECT pg_temp.expire(:W1, 'm1');
SELECT pg_temp.fails(:BIZ, 'authenticated', format($q$SELECT review_submission(%L, false, 'nope')$q$, (pg_temp.sub(:W1, 'm1')).id), 'review_window_closed');
CREATE TEMP TABLE b3 AS SELECT pending_balance, withdrawable_balance FROM profiles WHERE id = :W1;
SELECT pg_temp.ok((pg_temp.run(:W1, 'SELECT process_my_review_windows()')->>'auto_approved')::int = 1, 'worker-triggered processing auto-approves own item');
SELECT pg_temp.ok((pg_temp.sub(:W1, 'm1')).status = 'approved' AND (pg_temp.sub(:W1, 'm1')).approval_source = 'auto_timeout'
                  AND (pg_temp.sub(:W1, 'm1')).payout_status = 'released', 'auto-approved and released at once');
SELECT pg_temp.ok((SELECT p.withdrawable_balance >= b.withdrawable_balance + 200 AND p.pending_balance <= b.pending_balance
                    FROM profiles p, b3 b WHERE p.id = :W1), 'auto-approved reward immediately withdrawable');
-- a stranger cannot trigger someone else's items
SELECT pg_temp.expire(:W2, 'm1');
SELECT pg_temp.ok((pg_temp.run(:W3, 'SELECT process_my_review_windows()')->>'auto_approved')::int = 0, 'others'' items untouched');
SELECT pg_temp.ok((pg_temp.sub(:W2, 'm1')).status = 'pending', 'W2 m1 still pending');
-- an admin may still reject after the window
SELECT pg_temp.ok(pg_temp.run((SELECT id FROM profiles WHERE username = 'boss'),
                  format($q$SELECT review_submission(%L, false, 'duplicate text')$q$, (pg_temp.sub(:W2, 'm1')).id))->>'status' = 'rejected',
                  'admin can reject a flagged item after the window');

-- =========================================================================
-- 13. Referral bonus counts only RELEASED third-party work
-- =========================================================================
SELECT pg_temp.start(:FF, 'r1'); SELECT pg_temp.submit(:FF, 'r1', 'Joined, my handle is @ffriend one', NULL, NULL); SELECT pg_temp.review(:BIZ, :FF, 'r1', TRUE);
SELECT pg_temp.start(:FF, 'r2'); SELECT pg_temp.submit(:FF, 'r2', 'Joined, my handle is @ffriend two', NULL, NULL); SELECT pg_temp.review(:BIZ, :FF, 'r2', TRUE);
SELECT pg_temp.start(:FF, 'r3'); SELECT pg_temp.submit(:FF, 'r3', 'Joined, my handle is @ffriend three', NULL, NULL); SELECT pg_temp.review(:BIZ, :FF, 'r3', TRUE);
SELECT pg_temp.ok((SELECT approved_task_count FROM profiles WHERE id = :FF) = 3, 'referee has 3 approved (held) tasks');
SELECT pg_temp.ok((SELECT bonus_status FROM referrals WHERE referee_id = :FF) = 'pending', 'no bonus while windows are open');
SELECT pg_temp.ok((SELECT withdrawable_balance FROM profiles WHERE id = :RR) = 0, 'referrer not paid yet');
SELECT pg_temp.expire(:FF, 'r1'); SELECT pg_temp.expire(:FF, 'r2');
SET ROLE service_role; SELECT process_review_windows(100); RESET ROLE;
SELECT pg_temp.ok((SELECT bonus_status FROM referrals WHERE referee_id = :FF) = 'pending', 'two released tasks are not enough');
SELECT pg_temp.expire(:FF, 'r3');
SET ROLE service_role; SELECT process_review_windows(100); RESET ROLE;
SELECT pg_temp.ok((SELECT bonus_status = 'paid' AND bonus_referrer_amount = 200 FROM referrals WHERE referee_id = :FF), 'bonus paid after third release');
SELECT pg_temp.ok((SELECT withdrawable_balance FROM profiles WHERE id = :RR) = 200, 'referrer got N200');
SELECT pg_temp.ok((SELECT withdrawable_balance = 900 AND pending_balance = 0 FROM profiles WHERE id = :FF), 'referee: 3 x N300 withdrawable');

-- =========================================================================
-- 15. Split windows end to end + hold_flagged_for_review toggle
-- =========================================================================
SELECT pg_temp.campaign('a2', :BIZ, 'Screenshot app test', 'App Tests', 'screenshot', 300, NULL, NULL, 'Blue42');
SELECT pg_temp.campaign('a3', :BIZ, 'Code survey a3', 'Surveys', 'text', 300, NULL, NULL, 'Blue42');
SELECT pg_temp.campaign('h2', :BIZ, 'Auto community', 'Community & Content', 'text', 200, NULL, 'auto', NULL);
SELECT pg_temp.campaign('h3', :BIZ, 'Code survey h3', 'Surveys', 'text', 300, NULL, NULL, 'Blue42');
SELECT pg_temp.ok((SELECT approval_mode FROM campaigns WHERE id = pg_temp.g('a2')::uuid) = 'instant'
                  AND (SELECT approval_mode FROM campaigns WHERE id = pg_temp.g('h2')::uuid) = 'auto', 'modes instant / auto');

-- Screenshot proof with a matching code: instantly credited, but a person
-- should look at the screenshot, so it keeps the 48h window.
INSERT INTO storage.objects (bucket_id, name, metadata) VALUES
 ('taskpulse-proofs', 'd1000000-0000-0000-0000-000000000001/a2.png', '{"eTag":"\"aa11\"","size":4096}');
SELECT pg_temp.start(:W1, 'a2');
SELECT pg_temp.ok((pg_temp.submit(:W1, 'a2', NULL, 'd1000000-0000-0000-0000-000000000001/a2.png', 'BLUE42')->>'instant')::boolean,
                  'screenshot + code from a trusted worker: instant');
SELECT pg_temp.ok((pg_temp.sub(:W1, 'a2')).review_window_kind = 'human' AND (pg_temp.sub(:W1, 'a2')).payout_status = 'held'
                  AND (pg_temp.sub(:W1, 'a2')).review_deadline_at > NOW() + interval '47 hours 59 minutes', 'screenshot proof held 48h');

-- The auto window follows the setting; changing it only affects new submissions.
UPDATE marketplace_settings SET review_window_auto_hours = 12 WHERE id = 1;
SELECT pg_temp.start(:W1, 'a3');
SELECT pg_temp.ok((pg_temp.submit(:W1, 'a3', NULL, NULL, 'BLUE42')->>'instant')::boolean, 'a3 instant');
SELECT pg_temp.ok((pg_temp.sub(:W1, 'a3')).review_deadline_at < NOW() + interval '12 hours 1 minute'
                  AND (pg_temp.sub(:W1, 'a3')).review_deadline_at > NOW() + interval '11 hours 59 minutes', 'auto window read from the setting (12h)');
SELECT pg_temp.ok((pg_temp.sub(:W1, 'a2')).review_deadline_at > NOW() + interval '47 hours', 'existing deadlines unchanged by a settings edit');
UPDATE marketplace_settings SET review_window_auto_hours = 24 WHERE id = 1;
-- business can reject an instant item inside its window
SELECT pg_temp.ok(pg_temp.review(:BIZ, :W1, 'a3', FALSE, 'Shared code')->>'status' = 'rejected', 'reject inside the 24h auto window');

-- Flagged path, toggle OFF (default): auto-approved at its 48h deadline
SELECT pg_temp.expire(:W1, 's5');
SET ROLE service_role; SELECT process_review_windows(100); RESET ROLE;
SELECT pg_temp.ok((pg_temp.sub(:W1, 's5')).status = 'approved' AND (pg_temp.sub(:W1, 's5')).approval_source = 'auto_timeout'
                  AND (pg_temp.sub(:W1, 's5')).payout_status = 'released', 'flagged item auto-approved at deadline when the toggle is off');
SELECT pg_temp.ok((pg_temp.sub(:W1, 's5')).review_note LIKE '%48h review window%', 'auto-approve note names the 48h window');

-- Toggle ON: flagged items wait for a person; unflagged ones still auto-approve
UPDATE marketplace_settings SET hold_flagged_for_review = TRUE WHERE id = 1;
SELECT pg_temp.start(:W1, 'h3'); SELECT pg_temp.submit(:W1, 'h3', NULL, NULL, 'WRONG1');
SELECT pg_temp.start(:W1, 'h2'); SELECT pg_temp.submit(:W1, 'h2', 'Introduced myself in the community as fwone today', NULL, NULL);
SELECT pg_temp.ok((pg_temp.sub(:W1, 'h3')).check_flags = ARRAY['wrong_code'] AND (pg_temp.sub(:W1, 'h2')).check_flags = '{}', 'h3 flagged, h2 clean');
SELECT pg_temp.expire(:W1, 'h3'); SELECT pg_temp.expire(:W1, 'h2'); SELECT pg_temp.expire(:W1, 's6');
SET ROLE service_role; SELECT process_review_windows(100); RESET ROLE;
SELECT pg_temp.ok((pg_temp.sub(:W1, 'h3')).status = 'pending', 'toggle on: flagged h3 NOT auto-approved');
SELECT pg_temp.ok((pg_temp.sub(:W1, 's6')).status = 'pending', 'toggle on: flagged s6 NOT auto-approved');
SELECT pg_temp.ok((pg_temp.sub(:W1, 'h2')).status = 'approved' AND (pg_temp.sub(:W1, 'h2')).approval_source = 'auto_timeout',
                  'toggle on: unflagged h2 still auto-approved');
SELECT pg_temp.ok((pg_temp.run(:W1, 'SELECT process_my_review_windows()')->>'auto_approved')::int = 0, 'user-triggered processing honours the toggle');
-- the business keeps the decision on held flagged items after the deadline
SELECT pg_temp.ok(pg_temp.review(:BIZ, :W1, 'h3', TRUE)->>'status' = 'approved', 'business approves held flagged item after deadline');
SELECT pg_temp.ok((pg_temp.sub(:W1, 'h3')).payout_status = 'released', 'late approval releases at once (deadline passed)');
SELECT pg_temp.ok(pg_temp.review(:BIZ, :W1, 's6', FALSE, 'Too fast to be real')->>'status' = 'rejected', 'business rejects held flagged item after deadline');
-- unflagged items keep the normal rule: business can't reject after the deadline
SELECT pg_temp.fails(:BIZ, 'authenticated', format($q$SELECT review_submission(%L, false, 'late')$q$, (pg_temp.sub(:W1, 'h2')).id), 'review_window_closed');
UPDATE marketplace_settings SET hold_flagged_for_review = FALSE WHERE id = 1;

-- =========================================================================
-- 14. Final reconciliation
-- =========================================================================
SELECT pg_temp.ok((SELECT count(*) FROM campaign_ledger_check()) = 0, 'campaign_ledger_check: every campaign reconciles');
SELECT pg_temp.ok((SELECT count(*) FROM pending_hold_check()) = 0, 'pending_hold_check: pending = held payouts');
SELECT pg_temp.ok((SELECT count(*) FROM campaigns c WHERE c.funded_at IS NOT NULL
                   AND c.escrow_balance <> c.reward_budget - c.slots_approved * c.reward_per_completion - (c.refund_due - c.fee_refund_due)) = 0,
                  'escrow identity holds');

SET client_min_messages = notice;
DO $$ BEGIN RAISE NOTICE 'fast approvals tests (011): PASS'; END $$;

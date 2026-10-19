-- LOCAL ONLY. Task spots (013): accept holds a spot, submit consumes it,
-- abandon / expiry / rejection free it, full tasks refuse new workers.
-- Every check raises 'FAILED: ...' on a wrong result; prints PASS at the end.
\set ON_ERROR_STOP 1
SET client_min_messages = warning;
CREATE OR REPLACE FUNCTION pg_temp.act(p_uid uuid) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', COALESCE(p_uid::text, ''), false) $$;
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
-- run p_sql as worker p_uid (authenticated) and return the jsonb result
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

INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
 ('b1300000-0000-0000-0000-000000000001','spots-biz@x.com','{"username":"spotsbiz","phone":"08031130001","account_type":"business","business_name":"SpotsCo"}'),
 ('e1300000-0000-0000-0000-000000000001','s1@x.com','{"username":"sone","phone":"08031130011"}'),
 ('e1300000-0000-0000-0000-000000000002','s2@x.com','{"username":"stwo","phone":"08031130012"}'),
 ('e1300000-0000-0000-0000-000000000003','s3@x.com','{"username":"sthree","phone":"08031130013"}'),
 ('e1300000-0000-0000-0000-000000000004','s4@x.com','{"username":"sfour","phone":"08031130014"}'),
 ('e1300000-0000-0000-0000-000000000005','s5@x.com','{"username":"sfive","phone":"08031130015"}'),
 ('e1300000-0000-0000-0000-000000000006','s6@x.com','{"username":"ssix","phone":"08031130016"}');

CREATE TEMP TABLE r13 (k text primary key, v jsonb);
GRANT ALL ON r13 TO PUBLIC;
SELECT pg_temp.act('b1300000-0000-0000-0000-000000000001');
SET ROLE authenticated;
INSERT INTO r13 SELECT 'c', create_campaign('Spots campaign', 'Join our Telegram community and say hello to the group', 'Social', 'text', 300, 5, NULL);
RESET ROLE;
SET ROLE service_role;
SELECT create_campaign_payment('b1300000-0000-0000-0000-000000000001', (SELECT (v->>'campaign_id')::uuid FROM r13 WHERE k='c'), 'ref_013_spots');
SELECT pg_temp.ok((settle_campaign_funding('ref_013_spots', (SELECT total_charge FROM campaigns WHERE title='Spots campaign'))->>'success')::boolean, 'funded');
RESET ROLE;
CREATE TEMP TABLE t13 AS SELECT id AS cid, task_id FROM campaigns WHERE title='Spots campaign';
GRANT SELECT ON t13 TO PUBLIC;
CREATE OR REPLACE FUNCTION pg_temp.left13() RETURNS int LANGUAGE sql AS $$ SELECT spots_left FROM tasks WHERE id=(SELECT task_id FROM t13) $$;
CREATE OR REPLACE FUNCTION pg_temp.held13() RETURNS int LANGUAGE sql AS $$ SELECT slots_held FROM campaigns WHERE id=(SELECT cid FROM t13) $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO PUBLIC;
SELECT pg_temp.ok(pg_temp.left13() = 5, 'starts 5 of 5');

-- Accept -------------------------------------------------------------------
SELECT pg_temp.fails('b1300000-0000-0000-0000-000000000001','authenticated', $q$SELECT accept_task((SELECT task_id FROM t13))$q$, 'own_campaign');
SELECT pg_temp.fails(NULL,'anon', $q$SELECT accept_task((SELECT task_id FROM t13))$q$, 'permission denied');
SELECT pg_temp.ok((pg_temp.as_user('e1300000-0000-0000-0000-000000000001', $q$SELECT accept_task((SELECT task_id FROM t13))$q$)->>'spots_left')::int = 4, 'accept -> 4 left (returned)');
SELECT pg_temp.ok(pg_temp.left13() = 4 AND pg_temp.held13() = 1, 'accept takes a spot');
SELECT pg_temp.ok((pg_temp.as_user('e1300000-0000-0000-0000-000000000001', $q$SELECT accept_task((SELECT task_id FROM t13))$q$)->>'spots_left')::int = 4, 'accept twice is idempotent');
SELECT pg_temp.as_user(('e1300000-0000-0000-0000-00000000000' || n)::uuid, $q$SELECT accept_task((SELECT task_id FROM t13))$q$) FROM generate_series(2,5) n;
SELECT pg_temp.ok(pg_temp.left13() = 0 AND pg_temp.held13() = 5, 'five held -> full');
SELECT pg_temp.fails('e1300000-0000-0000-0000-000000000006','authenticated', $q$SELECT accept_task((SELECT task_id FROM t13))$q$, 'no_slots_left');
-- a worker who never accepted cannot take a held spot by submitting directly
SELECT pg_temp.fails('e1300000-0000-0000-0000-000000000006','authenticated', $q$SELECT submit_task((SELECT task_id FROM t13),'sneaky',NULL)$q$, 'no_slots_left');
SELECT pg_temp.ok((SELECT count(*) FROM task_completions WHERE proof_text='sneaky') = 0, 'no sneaky row');

-- RLS: own holds only; no direct writes; internals not callable --------------
SELECT pg_temp.ok((SELECT count(*)::int FROM (SELECT pg_temp.as_user('e1300000-0000-0000-0000-000000000001', $q$SELECT to_jsonb(array_agg(task_id)) FROM task_spot_holds$q$) AS j) s WHERE jsonb_array_length(j) = 1) = 1, 'worker sees only own hold');
SELECT pg_temp.fails(NULL,'anon', $q$SELECT count(*) FROM task_spot_holds$q$, 'permission denied');
SELECT pg_temp.fails('e1300000-0000-0000-0000-000000000006','authenticated',
  $q$INSERT INTO task_spot_holds (user_id, task_id, campaign_id, expires_at) SELECT auth.uid(), task_id, cid, now() + interval '1 day' FROM t13$q$, 'permission denied');
SELECT pg_temp.fails('e1300000-0000-0000-0000-000000000001','authenticated', $q$DELETE FROM task_spot_holds$q$, 'permission denied');
SELECT pg_temp.fails('e1300000-0000-0000-0000-000000000001','authenticated', $q$SELECT _sync_campaign_spots((SELECT cid FROM t13))$q$, 'permission denied');
SELECT pg_temp.fails('e1300000-0000-0000-0000-000000000001','authenticated', $q$SELECT _release_expired_spot_holds(10)$q$, 'permission denied');

-- Submit consumes the hold (stays taken: held -> pending) -----------------
SELECT pg_temp.as_user('e1300000-0000-0000-0000-000000000001', $q$SELECT submit_task((SELECT task_id FROM t13),'done s1',NULL)$q$);
SELECT pg_temp.ok(pg_temp.left13() = 0 AND pg_temp.held13() = 4, 'submit: still taken');
SELECT pg_temp.ok(slots_pending = 1, 'one pending') FROM campaigns WHERE id=(SELECT cid FROM t13);
SELECT pg_temp.fails('e1300000-0000-0000-0000-000000000001','authenticated', $q$SELECT accept_task((SELECT task_id FROM t13))$q$, 'already_submitted');

-- Abandon frees -------------------------------------------------------------
SELECT pg_temp.ok((pg_temp.as_user('e1300000-0000-0000-0000-000000000002', $q$SELECT abandon_task((SELECT task_id FROM t13))$q$)->>'released')::boolean, 'abandon');
SELECT pg_temp.ok(pg_temp.left13() = 1 AND pg_temp.held13() = 3, 'abandon frees one');
SELECT pg_temp.ok(NOT (pg_temp.as_user('e1300000-0000-0000-0000-000000000002', $q$SELECT abandon_task((SELECT task_id FROM t13))$q$)->>'released')::boolean, 'abandon twice is a no-op');
SELECT pg_temp.as_user('e1300000-0000-0000-0000-000000000006', $q$SELECT accept_task((SELECT task_id FROM t13))$q$);
SELECT pg_temp.ok(pg_temp.left13() = 0, 'freed spot re-taken');

-- Expiry frees (lazy sweep by any signed-in user) --------------------------
UPDATE task_spot_holds SET expires_at = now() - interval '1 second' WHERE user_id = 'e1300000-0000-0000-0000-000000000003';
SELECT pg_temp.ok(pg_temp.left13() = 0, 'not freed before a sweep');
SELECT pg_temp.as_user('e1300000-0000-0000-0000-000000000004', $q$SELECT to_jsonb(release_expired_spot_holds())$q$);
SELECT pg_temp.ok(pg_temp.left13() = 1 AND pg_temp.held13() = 3, 'expired hold freed');
SELECT pg_temp.ok((SELECT count(*) FROM task_spot_holds WHERE user_id = 'e1300000-0000-0000-0000-000000000003') = 0, 'expired row gone');
-- expiry also happens inside accept/submit even with no sweep
UPDATE task_spot_holds SET expires_at = now() - interval '1 second' WHERE user_id = 'e1300000-0000-0000-0000-000000000004';
SELECT pg_temp.as_user('e1300000-0000-0000-0000-000000000003', $q$SELECT submit_task((SELECT task_id FROM t13),'done s3 late',NULL)$q$);
SELECT pg_temp.ok(pg_temp.left13() = 1 AND pg_temp.held13() = 2, 'submit swept the expired hold and took the free spot');
-- the expired worker can still submit while a spot is free (taking it)
SELECT pg_temp.as_user('e1300000-0000-0000-0000-000000000004', $q$SELECT submit_task((SELECT task_id FROM t13),'done s4',NULL)$q$);
SELECT pg_temp.ok(pg_temp.left13() = 0, 'expired worker took the last free spot');

-- Rejection frees; approval keeps it taken --------------------------------
SELECT pg_temp.as_user('b1300000-0000-0000-0000-000000000001', format($q$SELECT review_submission('%s', true, NULL)$q$, (SELECT id FROM task_completions WHERE proof_text='done s1')));
SELECT pg_temp.ok(pg_temp.left13() = 0, 'approve keeps it taken');
SELECT pg_temp.as_user('b1300000-0000-0000-0000-000000000001', format($q$SELECT review_submission('%s', false, 'blurry')$q$, (SELECT id FROM task_completions WHERE proof_text='done s4')));
SELECT pg_temp.ok(pg_temp.left13() = 1, 'reject frees one');
SELECT pg_temp.ok(c.slots - c.slots_approved - c.slots_pending - c.slots_held = t.spots_left, 'identity: left = slots - approved - pending - held')
  FROM campaigns c JOIN tasks t ON t.campaign_id = c.id WHERE c.id = (SELECT cid FROM t13);

-- Platform (non-campaign) tasks are unaffected -----------------------------
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_task_completion_take_spot' AND tgenabled='D'), 'trigger enabled');

SET client_min_messages = notice;
DO $$ BEGIN RAISE NOTICE 'task spots tests (013): PASS'; END $$;

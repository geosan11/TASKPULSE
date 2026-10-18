-- LOCAL ONLY. Runs after 012: request_cashout() refuses unless the user's
-- identity is verified, locks nothing when it refuses, and still works (and
-- still replays) for a verified user. Prints PASS at the end.
\set ON_ERROR_STOP 1
SET client_min_messages = warning;
CREATE OR REPLACE FUNCTION pg_temp.ok(c boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
  BEGIN IF c IS NOT TRUE THEN RAISE EXCEPTION 'FAILED: %', msg; END IF; END $$;
CREATE OR REPLACE FUNCTION pg_temp.fails(p_sql text, p_err text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF position(p_err IN SQLERRM) = 0 THEN RAISE EXCEPTION 'FAILED: % gave "%" not "%"', p_sql, SQLERRM, p_err; END IF;
    RETURN;
  END;
  RAISE EXCEPTION 'FAILED: expected % from %', p_err, p_sql;
END $$;

CREATE TEMP TABLE r_ids (k text primary key, v uuid);
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
 ('c1200000-0000-0000-0000-000000000001','kyc1@x.com','{"username":"kycone","phone":"08031112001"}');
UPDATE profiles SET withdrawable_balance = 5000, payout_eligible_from = NOW() - interval '3 days'
 WHERE id = 'c1200000-0000-0000-0000-000000000001';
INSERT INTO bank_accounts (id, user_id, bank_code, bank_name, account_number, account_name, recipient_code)
VALUES ('c1200000-0000-0000-0000-0000000000b1','c1200000-0000-0000-0000-000000000001','058','GTBank','0123456789','KYC ONE','RCP_kyc1');

SELECT pg_temp.ok((SELECT kyc_status FROM profiles WHERE id='c1200000-0000-0000-0000-000000000001') = 'unverified', 'new users start unverified');

-- unverified, pending and rejected are all refused, and nothing is locked
SELECT pg_temp.fails($q$SELECT request_cashout('c1200000-0000-0000-0000-000000000001',1000,'c1200000-0000-0000-0000-0000000000b1','co_kyc_test_unverified_0000000001')$q$, 'identity_not_verified');
UPDATE profiles SET kyc_status = 'pending' WHERE id = 'c1200000-0000-0000-0000-000000000001';
SELECT pg_temp.fails($q$SELECT request_cashout('c1200000-0000-0000-0000-000000000001',1000,'c1200000-0000-0000-0000-0000000000b1','co_kyc_test_pending_000000000001')$q$, 'identity_not_verified');
UPDATE profiles SET kyc_status = 'rejected' WHERE id = 'c1200000-0000-0000-0000-000000000001';
SELECT pg_temp.fails($q$SELECT request_cashout('c1200000-0000-0000-0000-000000000001',1000,'c1200000-0000-0000-0000-0000000000b1','co_kyc_test_rejected_00000000001')$q$, 'identity_not_verified');
-- the ID check comes before the other rules (a tiny amount still says "verify")
UPDATE profiles SET kyc_status = 'unverified' WHERE id = 'c1200000-0000-0000-0000-000000000001';
SELECT pg_temp.fails($q$SELECT request_cashout('c1200000-0000-0000-0000-000000000001',1,'c1200000-0000-0000-0000-0000000000b1','co_kyc_test_order_0000000000001')$q$, 'identity_not_verified');
SELECT pg_temp.ok((SELECT withdrawable_balance FROM profiles WHERE id='c1200000-0000-0000-0000-000000000001') = 5000, 'refused requests lock no money');
SELECT pg_temp.ok((SELECT count(*) FROM transactions WHERE user_id='c1200000-0000-0000-0000-000000000001') = 0, 'refused requests create no row');

-- verified: works as before
UPDATE profiles SET kyc_status = 'verified' WHERE id = 'c1200000-0000-0000-0000-000000000001';
SELECT pg_temp.ok((request_cashout('c1200000-0000-0000-0000-000000000001',1000,'c1200000-0000-0000-0000-0000000000b1','co_kyc_test_verified_00000000001')->>'status') = 'pending', 'verified user can withdraw');
SELECT pg_temp.ok((SELECT withdrawable_balance FROM profiles WHERE id='c1200000-0000-0000-0000-000000000001') = 4000, 'verified withdrawal locks the amount');
-- other rules still apply after the ID check
SELECT pg_temp.fails($q$SELECT request_cashout('c1200000-0000-0000-0000-000000000001',500,'c1200000-0000-0000-0000-0000000000b1','co_kyc_test_min_00000000000001')$q$, 'min_withdrawal');

-- a retry of an already-created withdrawal still replays, even if the status changed since
UPDATE profiles SET kyc_status = 'rejected' WHERE id = 'c1200000-0000-0000-0000-000000000001';
SELECT pg_temp.ok((request_cashout('c1200000-0000-0000-0000-000000000001',1000,'c1200000-0000-0000-0000-0000000000b1','co_kyc_test_verified_00000000001')->>'duplicate')::boolean, 'replay still answers');
SELECT pg_temp.ok((SELECT withdrawable_balance FROM profiles WHERE id='c1200000-0000-0000-0000-000000000001') = 4000, 'replay locks nothing more');

-- still server-only
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.request_cashout(uuid,numeric,uuid,text)', 'EXECUTE'), 'authenticated cannot call request_cashout');
SELECT pg_temp.ok(NOT has_function_privilege('anon', 'public.request_cashout(uuid,numeric,uuid,text)', 'EXECUTE'), 'anon cannot call request_cashout');
SELECT pg_temp.ok(has_function_privilege('service_role', 'public.request_cashout(uuid,numeric,uuid,text)', 'EXECUTE'), 'service_role can call request_cashout');

-- ===== Legacy shared bank account (seeded by 65 before 012) =====
SELECT pg_temp.ok((SELECT duplicate_of IS NULL AND is_active FROM bank_accounts WHERE id='d1200000-0000-0000-0000-0000000000b1'), 'earliest row of a shared account is kept');
SELECT pg_temp.ok((SELECT duplicate_of = 'd1200000-0000-0000-0000-0000000000b1' AND NOT is_active FROM bank_accounts WHERE id='d1200000-0000-0000-0000-0000000000b2'), 'later row deactivated and marked duplicate_of');
SELECT pg_temp.ok((SELECT count(*) FROM identity_reviews WHERE status='open' AND reason='shared_bank_account' AND source='migration'
                    AND user_id IN ('d1200000-0000-0000-0000-000000000001','d1200000-0000-0000-0000-000000000002')) = 2, 'both users of a shared account queued');
SELECT pg_temp.ok((SELECT bool_and(kyc_status='pending') FROM profiles WHERE id IN ('d1200000-0000-0000-0000-000000000001','d1200000-0000-0000-0000-000000000002')), 'both shared users pending');
SELECT pg_temp.ok((SELECT kyc_status FROM profiles WHERE id='d1200000-0000-0000-0000-000000000003') = 'unverified', 'old ID-form pending with no review goes back to unverified');
SELECT pg_temp.ok((SELECT kyc_id_type FROM profiles WHERE id='d1200000-0000-0000-0000-000000000003') = 'nin', 'old ID details kept');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='uq_bank_accounts_owner'), 'unique owner index exists');
-- a name match does not auto-verify a user under shared-account review
SELECT pg_temp.ok((record_bank_identity_check('d1200000-0000-0000-0000-000000000001','d1200000-0000-0000-0000-0000000000b1','ADA OBI','Ada Obi',true,'match',NULL,'backfill')->>'kyc_status') = 'pending', 'shared-account user stays pending on match');
SELECT pg_temp.ok((SELECT reason FROM identity_reviews WHERE user_id='d1200000-0000-0000-0000-000000000001' AND status='open') = 'shared_bank_account', 'shared flag not downgraded');

-- ===== One owner per account =====
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
 ('c1200000-0000-0000-0000-000000000002','kyc2@x.com','{"username":"kyctwo","phone":"08031112002","full_name":"George Sanni"}'),
 ('c1200000-0000-0000-0000-000000000003','kyc3@x.com','{"username":"kycthree","phone":"08031112003","full_name":"Tunde Bakare"}');
SELECT pg_temp.fails($q$SELECT save_verified_bank_account('c1200000-0000-0000-0000-000000000002','058','GTBank','0123456789','KYC ONE','RCP_x')$q$, 'bank_linked_to_other_user');
SELECT pg_temp.fails($q$SELECT save_verified_bank_account('c1200000-0000-0000-0000-000000000002','058','GTBank','0099887766','ADA OBI','RCP_x')$q$, 'bank_linked_to_other_user');
SELECT pg_temp.fails($q$SELECT save_verified_bank_account('d1200000-0000-0000-0000-000000000002','058','GTBank','0099887766','ADA OBI','RCP_x')$q$, 'bank_linked_to_other_user');
UPDATE bank_accounts SET is_active = FALSE WHERE id = 'c1200000-0000-0000-0000-0000000000b1';
SELECT pg_temp.fails($q$SELECT save_verified_bank_account('c1200000-0000-0000-0000-000000000002','058','GTBank','0123456789','KYC ONE','RCP_x')$q$, 'bank_linked_to_other_user');
UPDATE bank_accounts SET is_active = TRUE WHERE id = 'c1200000-0000-0000-0000-0000000000b1';
SELECT pg_temp.fails($q$INSERT INTO bank_accounts (user_id,bank_code,bank_name,account_number,account_name) VALUES ('c1200000-0000-0000-0000-000000000002','058','GTBank','0123456789','X')$q$, 'uq_bank_accounts_owner');

-- ===== Bank-name check outcomes =====
INSERT INTO r_ids SELECT 'b2', (save_verified_bank_account('c1200000-0000-0000-0000-000000000002','044','Access Bank','2222222222','SANNI GEORGE','RCP_2')->>'id')::uuid;
SELECT pg_temp.ok((SELECT name_resolved_at IS NOT NULL FROM bank_accounts WHERE id=(SELECT v FROM r_ids WHERE k='b2')), 'save stamps name_resolved_at');
SELECT pg_temp.ok((record_bank_identity_check('c1200000-0000-0000-0000-000000000002',(SELECT v FROM r_ids WHERE k='b2'),'SANNI GEORGE','George Sanni',true,'match',NULL,'bank_link')->>'kyc_status') = 'verified', 'match -> verified');
SELECT pg_temp.ok((SELECT kyc_status='verified' AND kyc_id_type='bank_account' AND kyc_id_last4='2222' FROM profiles WHERE id='c1200000-0000-0000-0000-000000000002'), 'verified via bank account recorded');
SELECT pg_temp.ok((SELECT count(*) FROM identity_reviews WHERE user_id='c1200000-0000-0000-0000-000000000002') = 0, 'match queues nothing');

INSERT INTO r_ids SELECT 'b3', (save_verified_bank_account('c1200000-0000-0000-0000-000000000003','044','Access Bank','3333333333','ADEYEMI KUNLE','RCP_3')->>'id')::uuid;
SELECT pg_temp.ok((record_bank_identity_check('c1200000-0000-0000-0000-000000000003',(SELECT v FROM r_ids WHERE k='b3'),'ADEYEMI KUNLE','Tunde Bakare',false,'name_mismatch','{"matched":[]}','bank_link')->>'queued')::boolean, 'mismatch queued');
SELECT pg_temp.ok((SELECT kyc_status FROM profiles WHERE id='c1200000-0000-0000-0000-000000000003') = 'pending', 'mismatch -> pending');
SELECT pg_temp.ok((SELECT profile_name='Tunde Bakare' AND bank_account_name='ADEYEMI KUNLE' AND account_last4='3333' AND bank_name='Access Bank' AND reason='name_mismatch'
                     FROM identity_reviews WHERE user_id='c1200000-0000-0000-0000-000000000003' AND status='open'), 'review records both names');
-- a second check refreshes the same open item (one per user)
SELECT record_bank_identity_check('c1200000-0000-0000-0000-000000000003',(SELECT v FROM r_ids WHERE k='b3'),'ADEYEMI KUNLE','Tunde Bakare',false,'name_mismatch',NULL,'backfill');
SELECT pg_temp.ok((SELECT count(*) FROM identity_reviews WHERE user_id='c1200000-0000-0000-0000-000000000003') = 1, 'one open review per user');
SELECT pg_temp.ok((SELECT count(*) FROM list_identity_reviews(100) WHERE username='kycthree' AND account_masked='******3333' AND current_profile_name='Tunde Bakare') = 1, 'admin list shows the item masked');

-- admin decisions
SELECT pg_temp.fails($q$SELECT decide_identity_review((SELECT id FROM identity_reviews WHERE user_id='c1200000-0000-0000-0000-000000000003' AND status='open'), true, 'c1200000-0000-0000-0000-000000000002', 'x')$q$, 'admin_required');
UPDATE profiles SET role='admin' WHERE id='c1200000-0000-0000-0000-000000000002';
SELECT pg_temp.ok((decide_identity_review((SELECT id FROM identity_reviews WHERE user_id='c1200000-0000-0000-0000-000000000003' AND status='open'), false, 'c1200000-0000-0000-0000-000000000002', 'names differ')->>'status') = 'rejected', 'admin reject');
SELECT pg_temp.ok((SELECT kyc_status FROM profiles WHERE id='c1200000-0000-0000-0000-000000000003') = 'rejected', 'reject -> rejected');
SELECT pg_temp.ok((record_bank_identity_check('c1200000-0000-0000-0000-000000000003',(SELECT v FROM r_ids WHERE k='b3'),'BAKARE TUNDE','Tunde Bakare',true,'match',NULL,'bank_link')->>'kyc_status') = 'rejected', 'rejected stays rejected even on a later match');
SELECT pg_temp.ok((decide_identity_review((SELECT id FROM identity_reviews WHERE user_id='d1200000-0000-0000-0000-000000000001' AND status='open'), true, 'c1200000-0000-0000-0000-000000000002', 'owner confirmed')->>'status') = 'approved', 'admin approve');
SELECT pg_temp.ok((SELECT kyc_status FROM profiles WHERE id='d1200000-0000-0000-0000-000000000001') = 'verified', 'approve -> verified');

-- verified user re-checked with a mismatch (e.g. new name) goes back to pending
SELECT pg_temp.ok((record_bank_identity_check('c1200000-0000-0000-0000-000000000002',(SELECT v FROM r_ids WHERE k='b2'),'SANNI GEORGE','Someone Else',false,'name_mismatch',NULL,'bank_link')->>'kyc_status') = 'pending', 'verified + mismatch -> pending');

-- optional ID form no longer parks anyone in pending
UPDATE profiles SET kyc_status='unverified', kyc_id_type=NULL WHERE id='c1200000-0000-0000-0000-000000000001';
SELECT set_config('request.jwt.claim.sub', 'c1200000-0000-0000-0000-000000000001', false);
SET ROLE authenticated;
SELECT submit_kyc('nin', '9876');
RESET ROLE;
SELECT pg_temp.ok((SELECT kyc_status='unverified' AND kyc_id_type='nin' FROM profiles WHERE id='c1200000-0000-0000-0000-000000000001'), 'submit_kyc keeps details, status unchanged');

-- backfill candidates: unverified/pending with an active, non-duplicate bank
SELECT pg_temp.ok((SELECT count(*) FROM list_identity_backfill_candidates(NULL, 100) WHERE user_id='c1200000-0000-0000-0000-000000000002') = 1, 'pending user with bank is a candidate');
SELECT pg_temp.ok((SELECT count(*) FROM list_identity_backfill_candidates(NULL, 100) WHERE user_id IN ('c1200000-0000-0000-0000-000000000003','d1200000-0000-0000-0000-000000000001','d1200000-0000-0000-0000-000000000002')) = 0, 'rejected, verified and duplicate rows are not candidates');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.list_identity_backfill_candidates(uuid,int)', 'EXECUTE'), 'users cannot list candidates');

-- server-only
SELECT pg_temp.ok(NOT has_table_privilege('authenticated', 'public.identity_reviews', 'SELECT'), 'users cannot read the review queue');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.record_bank_identity_check(uuid,uuid,text,text,boolean,text,jsonb,text)', 'EXECUTE'), 'users cannot record a check');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.decide_identity_review(uuid,boolean,uuid,text)', 'EXECUTE'), 'users cannot decide reviews');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public.list_identity_reviews(int)', 'EXECUTE'), 'users cannot list reviews');

SET client_min_messages = notice;
DO $$ BEGIN RAISE NOTICE 'withdraw ID tests (012): PASS'; END $$;

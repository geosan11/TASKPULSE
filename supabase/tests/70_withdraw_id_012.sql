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

SET client_min_messages = notice;
DO $$ BEGIN RAISE NOTICE 'withdraw ID tests (012): PASS'; END $$;

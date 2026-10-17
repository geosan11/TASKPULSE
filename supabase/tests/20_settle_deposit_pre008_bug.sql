-- BEFORE migration 008: settle_deposit (003/007) writes transactions.updated_at,
-- a column that does not exist, so every settlement throws and rolls back.
\set ON_ERROR_STOP 0
SET ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role', false);
SELECT public.settle_deposit('dep_e282f2870000000000000000000000aa', 3000);   -- expect ERROR: column "updated_at" ... does not exist
SELECT public.settle_deposit('dep_e282f2870000000000000000000000aa', 3147);   -- same error (and 007 would also raise amount_mismatch)
RESET ROLE;
SELECT reference, status FROM public.transactions WHERE reference LIKE 'dep_e282%';  -- still pending

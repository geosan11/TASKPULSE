-- AFTER migration 008: settle_deposit works, accepts fee-inclusive amounts,
-- credits the amount due exactly once, and refuses underpayment.
\set ON_ERROR_STOP 1
SET ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role', false);
DO $$
DECLARE r JSONB; b0 NUMERIC; b1 NUMERIC;
BEGIN
  SELECT withdrawable_balance INTO b0 FROM public.profiles WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001';

  -- Paystack charged N3,147.21 (fee passed to customer) for a N3,000 deposit
  r := public.settle_deposit('dep_e282f2870000000000000000000000aa', 3147);
  ASSERT (r->>'success')::boolean, 'settle should succeed: ' || r;
  -- webhook replay + user clicking verify again: no second credit
  r := public.settle_deposit('dep_e282f2870000000000000000000000aa', 3147);
  ASSERT (r->>'duplicate')::boolean, 'replay must be a duplicate: ' || r;
  SELECT withdrawable_balance INTO b1 FROM public.profiles WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001';
  ASSERT b1 = b0 + 3000, format('expected +3000 once, got %s -> %s', b0, b1);

  -- underpaid is refused, nothing is credited, the row is flagged for a manual refund
  SELECT withdrawable_balance INTO b0 FROM public.profiles WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001';
  r := public.settle_deposit('dep_cf71bdcc0000000000000000000000bb', 2000);
  ASSERT r->>'error' = 'underpaid', 'underpaid expected: ' || r;
  ASSERT (SELECT description FROM public.transactions WHERE reference = 'dep_cf71bdcc0000000000000000000000bb') LIKE 'Underpaid%';
  ASSERT (SELECT withdrawable_balance FROM public.profiles WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001') = b0, 'underpaid must not credit';

  -- unknown reference is a clean refusal, not an exception (webhook returns 200)
  r := public.settle_deposit('dep_doesnotexist000000000000000000', 3000);
  ASSERT r->>'error' = 'unknown_reference', 'unknown_reference expected: ' || r;

  -- cashout failure refunds once; transfer.failed replay does not double refund
  INSERT INTO public.transactions (user_id,type,amount,status,reference,title)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000001','cashout',700,'pending','co_test_refund_once_000000000000','Cashout');
  SELECT withdrawable_balance INTO b0 FROM public.profiles WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001';
  PERFORM public.finalize_cashout('co_test_refund_once_000000000000', 'failed');
  PERFORM public.finalize_cashout('co_test_refund_once_000000000000', 'failed');
  PERFORM public.finalize_cashout('co_test_refund_once_000000000000', 'success'); -- late success after refund: flagged, not paid twice
  SELECT withdrawable_balance INTO b1 FROM public.profiles WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001';
  ASSERT b1 = b0 + 700, format('expected one refund of 700, got %s -> %s', b0, b1);
  ASSERT (SELECT description FROM public.transactions WHERE reference = 'co_test_refund_once_000000000000') LIKE '%REVIEW%';
  RAISE NOTICE 'settle/cashout regression tests: PASS';
END $$;
RESET ROLE;
-- clients can no longer call settlement functions directly
SET ROLE authenticated;
\set ON_ERROR_STOP 0
SELECT public.settle_deposit('dep_90725c330000000000000000000000cc', 3000);  -- expect: permission denied
RESET ROLE;

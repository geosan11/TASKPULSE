-- Reproduces the live state: one user, three pending activation deposits
-- created by the pre-008 create_pending_deposit(), one pending cashout.
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
 ('aaaaaaaa-0000-4000-8000-000000000001','owner@example.test','{"username":"owner","full_name":"Owner Test","phone":"08000000001"}');
UPDATE public.profiles SET withdrawable_balance = 500 WHERE id = 'aaaaaaaa-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-4000-8000-000000000001', false),
       set_config('request.jwt.claim.role','authenticated', false);
SELECT public.create_pending_deposit('aaaaaaaa-0000-4000-8000-000000000001','dep_e282f2870000000000000000000000aa',3000);
SELECT public.create_pending_deposit('aaaaaaaa-0000-4000-8000-000000000001','dep_cf71bdcc0000000000000000000000bb',3000);
SELECT public.create_pending_deposit('aaaaaaaa-0000-4000-8000-000000000001','dep_90725c330000000000000000000000cc',3000);
SELECT set_config('request.jwt.claim.sub','', false), set_config('request.jwt.claim.role','', false);
UPDATE public.transactions SET created_at = '2026-10-13 09:21+00' WHERE reference LIKE 'dep_e282%';
UPDATE public.transactions SET created_at = '2026-10-13 09:52+00' WHERE reference LIKE 'dep_cf71%';
UPDATE public.transactions SET created_at = '2026-10-16 19:49+00' WHERE reference LIKE 'dep_9072%';
SELECT reference, status, description FROM public.transactions ORDER BY created_at;

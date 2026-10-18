-- LOCAL ONLY. Runs BEFORE 012: legacy data where one bank account is linked
-- by two users (possible before 012's unique index), plus a user left
-- 'pending' by the old ID form. 70_withdraw_id_012.sql checks how 012 handles them.
\set ON_ERROR_STOP 1
SET client_min_messages = warning;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
 ('d1200000-0000-0000-0000-000000000001','dup1@x.com','{"username":"dupone","phone":"08031113001","full_name":"Ada Obi"}'),
 ('d1200000-0000-0000-0000-000000000002','dup2@x.com','{"username":"duptwo","phone":"08031113002","full_name":"Ada Obi"}'),
 ('d1200000-0000-0000-0000-000000000003','old@x.com','{"username":"oldform","phone":"08031113003","full_name":"Bola Ade"}');
INSERT INTO bank_accounts (id, user_id, bank_code, bank_name, account_number, account_name, recipient_code, created_at) VALUES
 ('d1200000-0000-0000-0000-0000000000b1','d1200000-0000-0000-0000-000000000001','058','GTBank','0099887766','ADA OBI','RCP_d1', NOW() - interval '10 days'),
 ('d1200000-0000-0000-0000-0000000000b2','d1200000-0000-0000-0000-000000000002','058','GTBank','0099887766','ADA OBI','RCP_d2', NOW() - interval '2 days');
UPDATE profiles SET kyc_status = 'pending', kyc_id_type = 'nin', kyc_id_last4 = '1234'
 WHERE id = 'd1200000-0000-0000-0000-000000000003';

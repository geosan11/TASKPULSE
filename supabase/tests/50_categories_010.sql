-- LOCAL ONLY. Runs after 40_business_flow.sql and 010: category mapping,
-- prohibited-task guard, relabelled rows, CHECK constraint, task icons.
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

-- Rows created by 40 with 'Social' were relabelled; constraint is valid
SELECT pg_temp.ok((SELECT count(*) FROM campaigns WHERE category IN ('Social','Reviews')) = 0, 'no legacy campaign labels left');
SELECT pg_temp.ok((SELECT count(*) FROM campaigns WHERE category = 'Community & Content') > 0, 'Social campaigns became Community & Content');
SELECT pg_temp.ok((SELECT count(*) FROM tasks WHERE campaign_id IS NOT NULL AND category IN ('Social','Reviews')) = 0, 'campaign tasks relabelled');
SELECT pg_temp.ok((SELECT convalidated FROM pg_constraint WHERE conname = 'chk_campaign_category'), 'category CHECK validated');
SELECT pg_temp.ok((SELECT column_default FROM information_schema.columns WHERE table_name='campaigns' AND column_name='category') LIKE '''Other''%', 'default is Other');
SELECT pg_temp.fails($q$INSERT INTO campaigns (business_id,title,instructions,category,reward_per_completion,slots,platform_fee_rate,reward_budget,platform_fee,total_charge)
  SELECT id,'Direct insert','Direct insert bypassing the function body','Reviews',300,5,0.25,1500,375,1875 FROM profiles WHERE username='acme'$q$, 'chk_campaign_category');

-- Mapping
SELECT pg_temp.ok(normalize_campaign_category('Reviews') = 'Product Feedback', 'Reviews -> Product Feedback');
SELECT pg_temp.ok(normalize_campaign_category('social') = 'Community & Content', 'Social -> Community & Content');
SELECT pg_temp.ok(normalize_campaign_category(NULL) = 'Other' AND normalize_campaign_category('  ') = 'Other', 'empty -> Other');
SELECT pg_temp.ok(normalize_campaign_category('Surveys') = 'Surveys', 'Surveys kept');

-- Guard: blocked
SELECT pg_temp.ok(campaign_prohibited_reason('Rate us', 'Leave a 5-star review for our shop') = 'public_review', '5-star');
SELECT pg_temp.ok(campaign_prohibited_reason('Reviews', 'Write a review on Google Maps for our restaurant') = 'public_review', 'review on google');
SELECT pg_temp.ok(campaign_prohibited_reason('Jumia', 'Give our product a Jumia review after you buy') = 'public_review', 'jumia review');
SELECT pg_temp.ok(campaign_prohibited_reason('Rate app', 'Rate our app on the Play Store and screenshot') = 'public_review', 'rate on play store');
SELECT pg_temp.ok(campaign_prohibited_reason('Follow', 'Follow us on Instagram and send a screenshot') = 'social_engagement', 'follow us');
SELECT pg_temp.ok(campaign_prohibited_reason('Grow', 'Help us gain 1000 followers this week please') = 'social_engagement', 'gain followers');
SELECT pg_temp.ok(campaign_prohibited_reason('Like', 'Like and share our page then screenshot it') = 'social_engagement', 'like our page');
SELECT pg_temp.ok(campaign_prohibited_reason('Sub', 'Subscribe to our YouTube channel and comment') = 'social_engagement', 'subscribe');
SELECT pg_temp.ok(campaign_prohibited_reason('Fake', 'We need fake reviews for launch day') = 'fake_engagement', 'fake reviews');

-- Guard: legitimate tasks pass
SELECT pg_temp.ok(campaign_prohibited_reason('Quick survey', 'Follow the steps below and answer 10 questions honestly') IS NULL, 'follow the steps ok');
SELECT pg_temp.ok(campaign_prohibited_reason('App test', 'Download the app from the Play Store, sign up and tell us what you like the most') IS NULL, 'app test ok');
SELECT pg_temp.ok(campaign_prohibited_reason('Feedback', 'Share your honest private feedback in our form. Do not post it publicly.') IS NULL, 'private feedback ok');
SELECT pg_temp.ok(campaign_prohibited_reason('Community', 'Join our WhatsApp community for students and introduce yourself') IS NULL, 'join community ok');
SELECT pg_temp.ok(campaign_prohibited_reason('Content', 'Watch our 2 minute video and tell us which part was confusing') IS NULL, 'content feedback ok');

-- create_campaign end to end as a business user
SELECT set_config('request.jwt.claim.sub', (SELECT id::text FROM profiles WHERE username='acme'), false);
SET ROLE authenticated;
CREATE TEMP TABLE r10 (k text primary key, v jsonb);
INSERT INTO r10 SELECT 'legacy', create_campaign('Legacy client', 'Tell us honestly what you think of the checkout page', 'Reviews', 'text', 300, 5, NULL);
INSERT INTO r10 SELECT 'social', create_campaign('Legacy social', 'Join our Telegram community and say hello to the group', 'Social', 'text', 300, 5, NULL);
SELECT pg_temp.fails($q$SELECT create_campaign('Bad review', 'Leave a 5 star review on Google for us', 'Product Feedback', 'link', 300, 5, NULL)$q$, 'prohibited_task:public_review');
SELECT pg_temp.fails($q$SELECT create_campaign('Bad follow', 'Follow us on TikTok and send a screenshot', 'Community & Content', 'screenshot', 300, 5, NULL)$q$, 'prohibited_task:social_engagement');
SELECT pg_temp.fails($q$SELECT create_campaign('Bad cat', 'Tell us honestly what you think of the checkout page', 'Crypto', 'text', 300, 5, NULL)$q$, 'invalid_category');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT pg_temp.ok((SELECT category FROM campaigns WHERE id = (SELECT (v->>'campaign_id')::uuid FROM r10 WHERE k='legacy')) = 'Product Feedback', 'legacy Reviews stored as Product Feedback');
SELECT pg_temp.ok((SELECT category FROM campaigns WHERE id = (SELECT (v->>'campaign_id')::uuid FROM r10 WHERE k='social')) = 'Community & Content', 'legacy Social stored as Community & Content');
SELECT pg_temp.ok((SELECT total_charge FROM campaigns WHERE id = (SELECT (v->>'campaign_id')::uuid FROM r10 WHERE k='legacy')) = 1875, 'pricing unchanged: 5 x 300 + 25%');

-- Funding creates a marketplace task with the new icon
SELECT create_campaign_payment(c.business_id, c.id, 'ref_010_legacy') FROM campaigns c WHERE c.id = (SELECT (v->>'campaign_id')::uuid FROM r10 WHERE k='legacy');
SELECT pg_temp.ok((settle_campaign_funding('ref_010_legacy', 1875)->>'success')::boolean, 'settle ok');
SELECT pg_temp.ok((SELECT platform_icon FROM tasks WHERE campaign_id = (SELECT (v->>'campaign_id')::uuid FROM r10 WHERE k='legacy')) = '💡', 'Product Feedback icon');
SELECT pg_temp.ok((SELECT count(*) FROM campaign_ledger_check()) = 0, 'ledger still reconciles');

SET client_min_messages = notice;
DO $$ BEGIN RAISE NOTICE 'category policy tests (010): PASS'; END $$;

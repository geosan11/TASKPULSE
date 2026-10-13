-- ============================================================================
-- Migration: 006_remove_demo_data.sql
-- Description: Remove all demo tasks, completions, and seed real referral task (1k/ref).
-- ============================================================================

-- 1. PURGE DEMO TASKS AND SAMPLE COMPLETIONS
DELETE FROM public.task_completions 
WHERE task_id = 't-soc-1' 
   OR task_title ILIKE '%tiktok%' 
   OR company ILIKE '%kuda%';

DELETE FROM public.tasks 
WHERE id = 't-soc-1' 
   OR title ILIKE '%tiktok%' 
   OR company ILIKE '%kuda%'
   OR category = 'Social';

-- 2. PURGE DEMO TRANSACTIONS (IF ANY CREATED UNDER DEMO KEYS)
DELETE FROM public.transactions 
WHERE reference ILIKE 'dep_demo_%' 
   OR reference ILIKE 'trf_demo_%'
   OR reference ILIKE '%_demo_%';

-- 3. SEED REAL PRODUCTION REFERRAL TASK (1K PER REFERRAL)
INSERT INTO public.tasks (
    id,
    title,
    company,
    reward,
    category,
    time_estimate,
    sla,
    spots_left,
    spots_total,
    description,
    steps,
    platform_icon,
    is_active
) VALUES (
    't-ref-growth',
    'Invite Friends to TaskPulse (₦1,000 Per Referral)',
    'TaskPulse Growth Network',
    1000.00,
    'Referral',
    '1m',
    'Instant Crediting & Cashout Unlock',
    3,
    3,
    'Share your personal referral link with friends. Earn ₦1,000 immediately when each friend activates with ₦3,000. Referring 3 friends unlocks ₦3,000 total bonus and permanent bank withdrawals!',
    '["Copy your unique referral invite link or tap Share on WhatsApp.", "Share with friends, family, or social media community.", "Earn ₦1,000 for each friend who joins and activates their Bronze Pulse account.", "Complete 3 referrals to permanently unlock the ₦3,000 minimum cashout threshold."]'::jsonb,
    '👥',
    TRUE
) ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    company = EXCLUDED.company,
    reward = EXCLUDED.reward,
    category = EXCLUDED.category,
    time_estimate = EXCLUDED.time_estimate,
    sla = EXCLUDED.sla,
    spots_left = EXCLUDED.spots_left,
    spots_total = EXCLUDED.spots_total,
    description = EXCLUDED.description,
    steps = EXCLUDED.steps,
    platform_icon = EXCLUDED.platform_icon,
    is_active = TRUE;

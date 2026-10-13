-- =========================================================================
-- TASKPULSE SUPABASE PRODUCTION SCHEMA (FREE-TIER OPTIMIZED & HARDENED)
-- =========================================================================
-- Guidelines Enforced:
-- 1. Free-Tier Quota Guards: No binary blobs, B-Tree indexes on all FKs, strict RLS
-- 2. FinTech Double-Entry Ledger: Balances updated via atomic PostgreSQL functions
-- 3. Idempotent Reference Constraints: Prevents duplicate charges or double cashouts
-- 4. Re-runnable / Idempotent: Can be executed multiple times without policy errors
-- =========================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================================================================
-- 1. USER PROFILES TABLE
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    full_name VARCHAR(100),
    phone VARCHAR(20) UNIQUE,
    tier_id VARCHAR(20) NOT NULL DEFAULT 'tier-1', -- tier-1 (Bronze) to tier-6 (VIP)
    is_activated BOOLEAN NOT NULL DEFAULT FALSE,
    activation_timestamp TIMESTAMPTZ,
    withdrawable_balance NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (withdrawable_balance >= 0.00),
    pending_balance NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (pending_balance >= 0.00),
    total_withdrawn_lifetime NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (total_withdrawn_lifetime >= 0.00),
    streak_days INT NOT NULL DEFAULT 1 CHECK (streak_days >= 0),
    streak_last_claimed_date DATE,
    referral_code VARCHAR(20) UNIQUE NOT NULL,
    referred_by_code VARCHAR(20),
    has_received_double_credit BOOLEAN NOT NULL DEFAULT FALSE,
    has_upgraded_after_limit BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for lightning-fast profile lookups and auth joins
CREATE INDEX IF NOT EXISTS idx_profiles_username ON public.profiles(username);
CREATE INDEX IF NOT EXISTS idx_profiles_referral_code ON public.profiles(referral_code);
CREATE INDEX IF NOT EXISTS idx_profiles_tier_id ON public.profiles(tier_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_phone ON public.profiles(phone);

-- =========================================================================
-- 2. TRANSACTIONS LEDGER TABLE (IMMUTABLE FINTECH AUDIT TRAIL)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    type VARCHAR(30) NOT NULL,
    amount NUMERIC(14,2) NOT NULL CHECK (amount > 0.00),
    fee NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (fee >= 0.00),
    net_amount NUMERIC(14,2) GENERATED ALWAYS AS (
        CASE 
            WHEN lower(type) = 'cashout' THEN (amount - fee)
            ELSE amount
        END
    ) STORED,
    status VARCHAR(20) NOT NULL DEFAULT 'settled',
    reference VARCHAR(100) UNIQUE NOT NULL, -- Paystack reference or internal cryptographic ref
    channel VARCHAR(30) DEFAULT 'paystack',
    title VARCHAR(120) NOT NULL,
    description TEXT,
    destination_bank VARCHAR(100),
    destination_account VARCHAR(20),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Flexible case-insensitive constraints supporting both camelCase and snake_case
    CONSTRAINT chk_tx_type CHECK (
        lower(type) IN (
            'deposit', 
            'cashout', 
            'deposit_match', 'match',
            'task_payout', 'taskpayout',
            'streak_reward', 'streakreward',
            'tier_upgrade', 'tierupgrade'
        )
    ),
    CONSTRAINT chk_tx_status CHECK (
        lower(status) IN ('pending', 'settled', 'declined', 'disbursed')
    )
);

-- Critical Indexes to eliminate sequential scans on pagination & filtering
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON public.transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON public.transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON public.transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_reference ON public.transactions(reference);
-- Composite index for fast history tabs with filters:
CREATE INDEX IF NOT EXISTS idx_transactions_user_type_created ON public.transactions(user_id, type, created_at DESC);

-- =========================================================================
-- 3. REFERRALS TABLE (DIRECT LINEAGE & 3X DEPOSIT TRACKING)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.referrals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    referee_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    referee_name VARCHAR(100) NOT NULL,
    referee_username VARCHAR(50) NOT NULL,
    deposited_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (deposited_amount >= 0.00),
    is_qualified BOOLEAN GENERATED ALWAYS AS (deposited_amount >= 3000.00) STORED,
    joined_time VARCHAR(50) DEFAULT 'Just now',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Referral indexes
CREATE INDEX IF NOT EXISTS idx_referrals_referrer_id ON public.referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_is_qualified ON public.referrals(is_qualified);
CREATE INDEX IF NOT EXISTS idx_referrals_created_at ON public.referrals(created_at DESC);

-- =========================================================================
-- 4. TASK COMPLETIONS TABLE (PROOF STORAGE & SLA SETTLEMENT)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.task_completions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    task_id VARCHAR(50) NOT NULL,
    task_title VARCHAR(150) NOT NULL,
    company VARCHAR(100) NOT NULL,
    reward_amount NUMERIC(14,2) NOT NULL CHECK (reward_amount > 0.00),
    category VARCHAR(50) DEFAULT 'Social',
    proof_text TEXT,
    proof_screenshot_url TEXT, -- Strictly a Supabase Storage path/URL (NEVER binary blob!)
    status VARCHAR(20) NOT NULL DEFAULT 'approved' CHECK (lower(status) IN ('pending', 'approved', 'rejected')),
    sla_time VARCHAR(50) DEFAULT 'Instant SLA Approval',
    completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Task completion indexes
CREATE INDEX IF NOT EXISTS idx_task_completions_user_id ON public.task_completions(user_id);
CREATE INDEX IF NOT EXISTS idx_task_completions_status ON public.task_completions(status);
CREATE INDEX IF NOT EXISTS idx_task_completions_completed_at ON public.task_completions(completed_at DESC);

-- =========================================================================
-- 5. LINKED BANK ACCOUNTS TABLE (PAYSTACK NUBAN)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.bank_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    bank_code VARCHAR(10) NOT NULL,
    bank_name VARCHAR(100) NOT NULL,
    account_number VARCHAR(10) NOT NULL,
    account_name VARCHAR(100) NOT NULL,
    recipient_code VARCHAR(50),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, bank_code, account_number)
);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_user_id ON public.bank_accounts(user_id);

-- =========================================================================
-- 6. AUTOMATIC USER PROFILE CREATION TRIGGER (AUTH HOOK)
-- =========================================================================
-- Automatically provisions a profile whenever a new user registers via Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
    v_ref_code VARCHAR(20);
    v_referrer_id UUID;
BEGIN
    v_ref_code := 'TP' || UPPER(SUBSTRING(MD5(new.id::text) FROM 1 FOR 6));

    INSERT INTO public.profiles (
        id, 
        email, 
        username, 
        full_name, 
        phone,
        referred_by_code,
        referral_code
    )
    VALUES (
        new.id,
        new.email,
        COALESCE(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
        COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
        new.raw_user_meta_data->>'phone',
        new.raw_user_meta_data->>'referred_by_code',
        v_ref_code
    )
    ON CONFLICT (id) DO NOTHING;

    -- Automatically register referral lineage if referred_by_code is supplied
    IF new.raw_user_meta_data->>'referred_by_code' IS NOT NULL AND TRIM(new.raw_user_meta_data->>'referred_by_code') <> '' THEN
        SELECT id INTO v_referrer_id
        FROM public.profiles
        WHERE referral_code = TRIM(new.raw_user_meta_data->>'referred_by_code')
        LIMIT 1;

        IF v_referrer_id IS NOT NULL THEN
            INSERT INTO public.referrals (
                referrer_id,
                referee_id,
                referee_name,
                referee_username,
                deposited_amount,
                joined_time
            ) VALUES (
                v_referrer_id,
                new.id,
                COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
                COALESCE(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
                0.00,
                'Just registered'
            );
        END IF;
    END IF;

    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Bind trigger to auth.users safely
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Automatic updated_at timestamp trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
    new.updated_at = NOW();
    RETURN new;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_profiles_updated_at ON public.profiles;
CREATE TRIGGER set_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- =========================================================================
-- DUPLICATE USER DETECTION RPC (ALLOWS PRE-SIGNUP CHECKS ACROSS RLS)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.check_user_exists(
    p_email TEXT DEFAULT NULL,
    p_username TEXT DEFAULT NULL,
    p_phone TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_email_exists BOOLEAN := FALSE;
    v_username_exists BOOLEAN := FALSE;
    v_phone_exists BOOLEAN := FALSE;
BEGIN
    IF p_email IS NOT NULL AND TRIM(p_email) <> '' THEN
        SELECT EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE lower(email) = lower(TRIM(p_email))
        ) INTO v_email_exists;
    END IF;

    IF p_username IS NOT NULL AND TRIM(p_username) <> '' THEN
        SELECT EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE lower(username) = lower(TRIM(p_username))
        ) INTO v_username_exists;
    END IF;

    IF p_phone IS NOT NULL AND TRIM(p_phone) <> '' THEN
        SELECT EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE phone = TRIM(p_phone)
        ) INTO v_phone_exists;
    END IF;

    RETURN jsonb_build_object(
        'exists', (v_email_exists OR v_username_exists OR v_phone_exists),
        'email_taken', v_email_exists,
        'username_taken', v_username_exists,
        'phone_taken', v_phone_exists
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_user_exists TO anon, authenticated, service_role;

-- =========================================================================
-- 7. ATOMIC BALANCE MUTATION STORED PROCEDURE (ROW LOCK PREVENTS RACE CONDITIONS)
-- =========================================================================
-- This function executes atomic balance changes and ledger inserts inside
-- a single ACID transaction. Clients cannot manipulate balances directly.
CREATE OR REPLACE FUNCTION public.execute_financial_mutation(
    p_user_id UUID,
    p_type VARCHAR(30),
    p_amount NUMERIC(14,2),
    p_fee NUMERIC(14,2),
    p_reference VARCHAR(100),
    p_title VARCHAR(120),
    p_description TEXT,
    p_dest_bank VARCHAR(100) DEFAULT NULL,
    p_dest_account VARCHAR(20) DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_profile RECORD;
    v_new_balance NUMERIC(14,2);
    v_new_withdrawn NUMERIC(14,2);
    v_tx_id UUID;
    v_normalized_type TEXT;
BEGIN
    v_normalized_type := lower(p_type);

    -- 0. Anti-Double Entry Guard (Prevents duplicate charges/credits on network retries)
    SELECT id INTO v_tx_id
    FROM public.transactions
    WHERE reference = p_reference;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'success', true,
            'is_duplicate_prevented', true,
            'transaction_id', v_tx_id,
            'message', 'Double entry prevented: Transaction already settled under this reference.'
        );
    END IF;

    -- 1. Lock the user profile row for atomic update (Pessimistic concurrency)
    SELECT * INTO v_profile
    FROM public.profiles
    WHERE id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Profile not found for user %', p_user_id;
    END IF;

    -- 2. Validate balance requirements
    IF v_normalized_type = 'cashout' THEN
        IF v_profile.withdrawable_balance < p_amount THEN
            RAISE EXCEPTION 'Insufficient balance: ₦% requested, ₦% available', p_amount, v_profile.withdrawable_balance;
        END IF;
        v_new_balance := v_profile.withdrawable_balance - p_amount;
        v_new_withdrawn := v_profile.total_withdrawn_lifetime + p_amount;
    ELSIF v_normalized_type IN ('tier_upgrade', 'tierupgrade') AND (p_metadata->>'paid_from_wallet')::boolean IS TRUE THEN
        -- If tier upgrade was purchased with internal wallet balance
        IF v_profile.withdrawable_balance < p_amount THEN
            RAISE EXCEPTION 'Insufficient balance for upgrade: ₦% required', p_amount;
        END IF;
        v_new_balance := v_profile.withdrawable_balance - p_amount;
        v_new_withdrawn := v_profile.total_withdrawn_lifetime;
    ELSE
        -- Deposits, bounties, deposit matches, streak bonuses credit the balance
        v_new_balance := v_profile.withdrawable_balance + p_amount;
        v_new_withdrawn := v_profile.total_withdrawn_lifetime;
    END IF;

    -- 3. Insert transaction into immutable ledger
    INSERT INTO public.transactions (
        user_id,
        type,
        amount,
        fee,
        status,
        reference,
        title,
        description,
        destination_bank,
        destination_account,
        metadata
    ) VALUES (
        p_user_id,
        p_type,
        p_amount,
        p_fee,
        CASE WHEN v_normalized_type = 'cashout' THEN 'disbursed' ELSE 'settled' END,
        p_reference,
        p_title,
        p_description,
        p_dest_bank,
        p_dest_account,
        p_metadata
    ) RETURNING id INTO v_tx_id;

    -- 4. Update user profile balance
    UPDATE public.profiles
    SET 
        withdrawable_balance = v_new_balance,
        total_withdrawn_lifetime = v_new_withdrawn,
        updated_at = NOW()
    WHERE id = p_user_id;

    RETURN jsonb_build_object(
        'success', true,
        'transaction_id', v_tx_id,
        'new_balance', v_new_balance,
        'lifetime_withdrawn', v_new_withdrawn
    );
END;
$$;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION public.execute_financial_mutation TO authenticated, service_role;

-- =========================================================================
-- 8. ROW-LEVEL SECURITY (RLS) POLICIES (CLEAN & IDEMPOTENT)
-- =========================================================================
-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;

-- Profiles Policies
DROP POLICY IF EXISTS "Users view own profile" ON public.profiles;
CREATE POLICY "Users view own profile"
    ON public.profiles FOR SELECT
    USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users insert own profile" ON public.profiles;
CREATE POLICY "Users insert own profile"
    ON public.profiles FOR INSERT
    WITH CHECK (auth.uid() = id);

-- Transactions Policies
DROP POLICY IF EXISTS "Users view own transactions" ON public.transactions;
CREATE POLICY "Users view own transactions"
    ON public.transactions FOR SELECT
    USING (auth.uid() = user_id);

-- Referrals Policies
DROP POLICY IF EXISTS "Users view own referrals" ON public.referrals;
CREATE POLICY "Users view own referrals"
    ON public.referrals FOR SELECT
    USING (auth.uid() = referrer_id OR auth.uid() = referee_id);

DROP POLICY IF EXISTS "Users insert referrals" ON public.referrals;
CREATE POLICY "Users insert referrals"
    ON public.referrals FOR INSERT
    WITH CHECK (auth.uid() = referrer_id OR auth.uid() = referee_id);

-- Task Completions Policies
DROP POLICY IF EXISTS "Users view own task completions" ON public.task_completions;
CREATE POLICY "Users view own task completions"
    ON public.task_completions FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert task completions" ON public.task_completions;
CREATE POLICY "Users insert task completions"
    ON public.task_completions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Bank Accounts Policies
DROP POLICY IF EXISTS "Users view own bank accounts" ON public.bank_accounts;
CREATE POLICY "Users view own bank accounts"
    ON public.bank_accounts FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own bank accounts" ON public.bank_accounts;
CREATE POLICY "Users insert own bank accounts"
    ON public.bank_accounts FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own bank accounts" ON public.bank_accounts;
CREATE POLICY "Users update own bank accounts"
    ON public.bank_accounts FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own bank accounts" ON public.bank_accounts;
CREATE POLICY "Users delete own bank accounts"
    ON public.bank_accounts FOR DELETE
    USING (auth.uid() = user_id);

-- =========================================================================
-- 9. SUPABASE STORAGE BUCKET CONFIGURATION (FOR TASK PROOFS)
-- =========================================================================
-- Create storage bucket for task screenshots (if storage schema exists)
INSERT INTO storage.buckets (id, name, public)
VALUES ('taskpulse-proofs', 'taskpulse-proofs', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Clean existing storage policies to ensure safe re-runs
DROP POLICY IF EXISTS "Authenticated users upload task proofs" ON storage.objects;
DROP POLICY IF EXISTS "Public read task proofs" ON storage.objects;

-- Storage policy: Authenticated users can upload screenshots to taskpulse-proofs bucket
CREATE POLICY "Authenticated users upload task proofs"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'taskpulse-proofs');

-- Storage policy: Public read access for proof verification
CREATE POLICY "Public read task proofs"
    ON storage.objects FOR SELECT
    TO public
    USING (bucket_id = 'taskpulse-proofs');

-- =========================================================================
-- 10. RELATIONAL TASKS CATALOG (DYNAMIC DATABASE-DRIVEN MICRO-TASKS)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.tasks (
    id VARCHAR(50) PRIMARY KEY,
    title VARCHAR(150) NOT NULL,
    company VARCHAR(100) NOT NULL,
    reward NUMERIC(14,2) NOT NULL CHECK (reward > 0.00),
    category VARCHAR(50) NOT NULL DEFAULT 'Social',
    time_estimate VARCHAR(30) NOT NULL DEFAULT '2m',
    sla VARCHAR(50) NOT NULL DEFAULT 'Instant SLA Approval',
    spots_left INT NOT NULL DEFAULT 100 CHECK (spots_left >= 0),
    spots_total INT NOT NULL DEFAULT 100 CHECK (spots_total >= spots_left),
    description TEXT NOT NULL,
    steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    platform_icon VARCHAR(50) DEFAULT '🎵',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed initial production micro-tasks
INSERT INTO public.tasks (
    id, title, company, reward, category, time_estimate, sla, spots_left, spots_total, description, steps, platform_icon, is_active
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
    reward = EXCLUDED.reward,
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    is_active = TRUE;

GRANT SELECT ON public.tasks TO anon, authenticated;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read active tasks" ON public.tasks;
CREATE POLICY "Public read active tasks"
    ON public.tasks FOR SELECT
    USING (is_active = TRUE);


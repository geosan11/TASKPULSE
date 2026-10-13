-- ============================================================================
-- TaskPulse Script 003: Financial Resilience & Key Fallbacks
-- (Run this in Supabase SQL Editor if you want to execute immediately)
-- ============================================================================

-- 1. Resilient create_pending_deposit
CREATE OR REPLACE FUNCTION public.create_pending_deposit(
    p_user_id UUID, p_reference TEXT, p_amount NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_profile public.profiles%ROWTYPE;
BEGIN
    IF auth.role() = 'authenticated' AND auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
        RAISE EXCEPTION 'unauthorized';
    END IF;

    SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;

    IF p_amount IS NULL OR p_amount <> trunc(p_amount) THEN
        RAISE EXCEPTION 'invalid_amount';
    END IF;
    IF NOT v_profile.is_activated AND p_amount <> 3000 THEN
        RAISE EXCEPTION 'activation_amount_must_be_3000';
    END IF;
    IF p_amount < 1000 OR p_amount > 500000 THEN
        RAISE EXCEPTION 'invalid_amount';
    END IF;

    INSERT INTO public.transactions (user_id, type, amount, status, reference, title, description, channel)
    VALUES (
        p_user_id, 'deposit', p_amount, 'pending', p_reference,
        CASE WHEN v_profile.is_activated THEN 'Wallet Top-up' ELSE 'Account Activation Deposit' END,
        'Awaiting Paystack confirmation', 'paystack'
    );
    RETURN jsonb_build_object('success', true, 'reference', p_reference);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_pending_deposit(UUID, TEXT, NUMERIC) TO authenticated, service_role;

-- 2. Resilient settle_deposit
CREATE OR REPLACE FUNCTION public.settle_deposit(
    p_reference TEXT, p_paid_amount NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_tx public.transactions%ROWTYPE;
    v_profile public.profiles%ROWTYPE;
    v_ref public.referrals%ROWTYPE;
    v_referrer public.profiles%ROWTYPE;
    v_qualified INT;
    v_volume NUMERIC;
    v_bonus NUMERIC;
BEGIN
    SELECT * INTO v_tx FROM public.transactions WHERE reference = p_reference FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'transaction_not_found'; END IF;

    IF auth.role() = 'authenticated' AND auth.uid() IS NOT NULL AND auth.uid() <> v_tx.user_id THEN
        RAISE EXCEPTION 'unauthorized';
    END IF;

    IF v_tx.status = 'settled' THEN
        RETURN jsonb_build_object('success', true, 'idempotent', true, 'user_id', v_tx.user_id);
    END IF;

    IF v_tx.amount <> p_paid_amount THEN
        RAISE EXCEPTION 'amount_mismatch';
    END IF;

    SELECT * INTO v_profile FROM public.profiles WHERE id = v_tx.user_id FOR UPDATE;

    UPDATE public.transactions
       SET status = 'settled', updated_at = NOW()
     WHERE id = v_tx.id;

    UPDATE public.profiles
       SET withdrawable_balance = withdrawable_balance + v_tx.amount,
           is_activated = TRUE,
           activation_timestamp = COALESCE(activation_timestamp, NOW())
     WHERE id = v_tx.user_id;

    UPDATE public.referrals
       SET deposited_amount = deposited_amount + v_tx.amount
     WHERE referee_id = v_tx.user_id
    RETURNING * INTO v_ref;

    IF FOUND THEN
        SELECT * INTO v_referrer FROM public.profiles WHERE id = v_ref.referrer_id FOR UPDATE;

        SELECT COUNT(*) FILTER (WHERE deposited_amount >= 3000), COALESCE(SUM(deposited_amount), 0)
          INTO v_qualified, v_volume
          FROM public.referrals WHERE referrer_id = v_ref.referrer_id;

        IF v_qualified >= 3 AND v_volume >= 9000
           AND NOT v_referrer.has_received_double_credit
           AND v_referrer.is_activated THEN
            SELECT stake_amount INTO v_bonus FROM public.tiers WHERE id = v_referrer.tier_id;

            INSERT INTO public.transactions (user_id, type, amount, status, reference, title, description)
            VALUES (
                v_referrer.id, 'deposit_match', v_bonus, 'settled', 'match_' || v_referrer.id::text,
                '100% Initial Deposit Double Credit',
                '3 referrals and N' || v_volume || ' volume met'
            )
            ON CONFLICT (reference) DO NOTHING;

            IF FOUND THEN
                UPDATE public.profiles
                   SET withdrawable_balance = withdrawable_balance + v_bonus,
                       has_received_double_credit = TRUE
                 WHERE id = v_referrer.id;
            END IF;
        END IF;
    END IF;

    RETURN jsonb_build_object('success', true, 'user_id', v_tx.user_id, 'credited', v_tx.amount);
END;
$$;

GRANT EXECUTE ON FUNCTION public.settle_deposit(TEXT, NUMERIC) TO authenticated, service_role;

-- 3. Profile update permission for authenticated users
GRANT UPDATE (full_name) ON public.profiles TO authenticated;

-- 4. Bank Accounts: Restore table permissions & RLS policies for authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_accounts TO authenticated, service_role;

ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own bank accounts" ON public.bank_accounts;
CREATE POLICY "Users view own bank accounts"
    ON public.bank_accounts FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own bank accounts" ON public.bank_accounts;
CREATE POLICY "Users insert own bank accounts"
    ON public.bank_accounts FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own bank accounts" ON public.bank_accounts;
CREATE POLICY "Users update own bank accounts"
    ON public.bank_accounts FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own bank accounts" ON public.bank_accounts;
CREATE POLICY "Users delete own bank accounts"
    ON public.bank_accounts FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

-- 5. Stored Procedure: save_verified_bank_account (Security Definer RPC)
CREATE OR REPLACE FUNCTION public.save_verified_bank_account(
    p_user_id UUID,
    p_bank_code TEXT,
    p_bank_name TEXT,
    p_account_number TEXT,
    p_account_name TEXT,
    p_recipient_code TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_account public.bank_accounts%ROWTYPE;
BEGIN
    IF auth.role() = 'authenticated' AND auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
        RAISE EXCEPTION 'unauthorized';
    END IF;

    INSERT INTO public.bank_accounts (
        user_id, bank_code, bank_name, account_number, account_name, recipient_code, is_active
    ) VALUES (
        p_user_id, p_bank_code, p_bank_name, p_account_number, p_account_name, p_recipient_code, true
    )
    ON CONFLICT (user_id, account_number, bank_code) DO UPDATE SET
        account_name = EXCLUDED.account_name,
        recipient_code = EXCLUDED.recipient_code,
        bank_name = EXCLUDED.bank_name,
        is_active = true,
        updated_at = NOW()
    RETURNING * INTO v_account;

    RETURN to_jsonb(v_account);
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_verified_bank_account(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;


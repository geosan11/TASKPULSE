-- ============================================================================
-- Migration: 007_referral_commission_1k.sql
-- Description: Instant ₦1,000 referral commission on referee activation deposit,
--              gated withdrawals requiring ₦3,000 activation deposit, and
--              tier-capped cashouts where remaining balance stays in wallet.
-- ============================================================================

-- 1. Resilient settle_deposit with ₦1,000 referral commission
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

    -- Settle the deposit transaction
    UPDATE public.transactions
       SET status = 'settled', updated_at = NOW()
     WHERE id = v_tx.id;

    -- Credit user's wallet and mark activated
    UPDATE public.profiles
       SET withdrawable_balance = withdrawable_balance + v_tx.amount,
           is_activated = TRUE,
           activation_timestamp = COALESCE(activation_timestamp, NOW())
     WHERE id = v_tx.user_id;

    -- Check if this user was referred by an existing member
    UPDATE public.referrals
       SET deposited_amount = deposited_amount + v_tx.amount
     WHERE referee_id = v_tx.user_id
    RETURNING * INTO v_ref;

    IF FOUND THEN
        SELECT * INTO v_referrer FROM public.profiles WHERE id = v_ref.referrer_id FOR UPDATE;

        -- Award ₦1,000 instant referral commission to the referrer
        INSERT INTO public.transactions (
            user_id, type, amount, fee, status, reference, title, description
        ) VALUES (
            v_ref.referrer_id, 'payout', 1000, 0, 'settled',
            'ref_comm_' || v_ref.id::text || '_' || v_tx.id::text,
            '₦1,000 Referral Commission',
            'Instant referral reward for friend activation deposit'
        )
        ON CONFLICT (reference) DO NOTHING;

        IF FOUND THEN
            UPDATE public.profiles
               SET withdrawable_balance = withdrawable_balance + 1000
             WHERE id = v_ref.referrer_id;
        END IF;

        -- Check if referrer qualifies for 3-referral double deposit match
        SELECT COUNT(*) FILTER (WHERE deposited_amount >= 3000), COALESCE(SUM(deposited_amount), 0)
          INTO v_qualified, v_volume
          FROM public.referrals WHERE referrer_id = v_ref.referrer_id;

        IF v_qualified >= 3 AND v_volume >= 9000
           AND NOT v_referrer.has_received_double_credit
           AND v_referrer.is_activated THEN
            SELECT stake_amount INTO v_bonus FROM public.tiers WHERE id = v_referrer.tier_id;

            INSERT INTO public.transactions (
                user_id, type, amount, fee, status, reference, title, description
            ) VALUES (
                v_referrer.id, 'deposit_match', v_bonus, 0, 'settled',
                'match_' || v_referrer.id::text,
                '100% Initial Deposit Double Credit',
                '3 referrals and ₦' || v_volume || ' volume met'
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

-- 2. Enhanced request_cashout ensuring tier limit allowance clamping and remaining balance retention
CREATE OR REPLACE FUNCTION public.request_cashout(
    p_user_id UUID, p_amount NUMERIC, p_bank_account_id UUID, p_reference TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_profile public.profiles%ROWTYPE;
    v_tier public.tiers%ROWTYPE;
    v_bank public.bank_accounts%ROWTYPE;
    v_existing public.transactions%ROWTYPE;
    v_qualified INT;
    v_volume NUMERIC;
    v_eligible BOOLEAN;
    v_remaining_allowance NUMERIC;
BEGIN
    SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found'; END IF;

    -- Idempotent replay protection
    SELECT * INTO v_existing FROM public.transactions WHERE reference = p_reference;
    IF FOUND THEN
        IF v_existing.user_id <> p_user_id THEN RAISE EXCEPTION 'reference_conflict'; END IF;
        RETURN jsonb_build_object(
            'success', true, 'duplicate', true,
            'status', v_existing.status, 'reference', p_reference
        );
    END IF;

    IF p_amount IS NULL OR p_amount < 3000 THEN RAISE EXCEPTION 'min_withdrawal'; END IF;
    IF p_amount <> trunc(p_amount) THEN RAISE EXCEPTION 'whole_naira_only'; END IF;

    SELECT * INTO v_bank FROM public.bank_accounts
     WHERE id = p_bank_account_id AND user_id = p_user_id AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'bank_not_found'; END IF;

    -- STRICT RULE: Must deposit ₦3,000 before withdrawing
    IF NOT v_profile.is_activated THEN RAISE EXCEPTION 'not_activated'; END IF;

    -- 48-hour security cooldown
    IF v_profile.activation_timestamp > NOW() - INTERVAL '48 hours' THEN
        RAISE EXCEPTION 'cooldown_active';
    END IF;

    -- Referral condition check
    SELECT COUNT(*) FILTER (WHERE deposited_amount >= 3000), COALESCE(SUM(deposited_amount), 0)
      INTO v_qualified, v_volume
      FROM public.referrals WHERE referrer_id = p_user_id;

    v_eligible := (v_qualified >= 3 AND v_volume >= 9000)
                  OR v_profile.has_received_double_credit
                  OR v_profile.has_upgraded_after_limit
                  OR v_profile.tier_id <> 'tier-1';
    IF NOT v_eligible THEN RAISE EXCEPTION 'referral_condition'; END IF;

    SELECT * INTO v_tier FROM public.tiers WHERE id = v_profile.tier_id;
    IF p_amount > v_tier.max_single_cashout THEN RAISE EXCEPTION 'single_limit'; END IF;

    -- Check remaining tier allowance
    v_remaining_allowance := GREATEST(0, v_tier.withdrawal_cap - v_profile.total_withdrawn_lifetime);
    IF p_amount > v_remaining_allowance THEN
        RAISE EXCEPTION 'tier_cap';
    END IF;

    IF v_profile.withdrawable_balance < p_amount THEN
        RAISE EXCEPTION 'insufficient_balance';
    END IF;

    -- Deduct amount requested. The rest of the balance stays in withdrawable_balance.
    INSERT INTO public.transactions (
        user_id, type, amount, fee, status, reference, title, description,
        destination_bank, destination_account, metadata
    ) VALUES (
        p_user_id, 'cashout', p_amount, 0, 'pending', p_reference,
        'Cashout to ' || v_bank.bank_name,
        'NIP transfer to ' || repeat('*', 6) || right(v_bank.account_number, 4),
        v_bank.bank_name, v_bank.account_number,
        jsonb_build_object('bank_account_id', v_bank.id)
    );

    UPDATE public.profiles
       SET withdrawable_balance = withdrawable_balance - p_amount,
           total_withdrawn_lifetime = total_withdrawn_lifetime + p_amount
     WHERE id = p_user_id;

    RETURN jsonb_build_object(
        'success', true, 'duplicate', false, 'status', 'pending',
        'reference', p_reference, 'recipient_code', v_bank.recipient_code,
        'bank_name', v_bank.bank_name, 'account_last4', right(v_bank.account_number, 4),
        'new_balance', v_profile.withdrawable_balance - p_amount,
        'remaining_tier_allowance', v_remaining_allowance - p_amount
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_cashout(UUID, NUMERIC, UUID, TEXT) TO service_role;

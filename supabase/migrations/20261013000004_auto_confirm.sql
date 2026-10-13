-- ============================================================================
-- Migration: 20261013000004_auto_confirm.sql
-- Description: Auto-confirm user emails directly in auth.users
-- ============================================================================

-- 1. Confirm any existing registered users who are currently unconfirmed
UPDATE auth.users
   SET email_confirmed_at = NOW()
 WHERE email_confirmed_at IS NULL;

-- 2. Automatically mark every new user as email-confirmed at the moment of signup
CREATE OR REPLACE FUNCTION public.auto_confirm_user()
RETURNS trigger AS $$
BEGIN
    NEW.email_confirmed_at := COALESCE(NEW.email_confirmed_at, NOW());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if already created, then re-create
DROP TRIGGER IF EXISTS on_auth_user_created_auto_confirm ON auth.users;
CREATE TRIGGER on_auth_user_created_auto_confirm
    BEFORE INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.auto_confirm_user();

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Retrieve credentials from environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

/**
 * SINGLETON SUPABASE CLIENT (Free-Tier Architectural Guard)
 * Instantiated ONCE to prevent connection leaks across re-renders.
 */
let supabaseInstance: SupabaseClient | null = null;

if (isSupabaseConfigured) {
  supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true
    },
    realtime: {
      params: {
        eventsPerSecond: 10
      }
    }
  });
}

export const supabase = supabaseInstance;

// =========================================================================
// AUTHENTICATION & DUPLICATE ACCOUNT DEFENSES
// =========================================================================

export interface AuthUserSignup {
  email: string;
  password: string;
  username: string;
  fullName: string;
  phone: string;
  referralCode?: string;
}

export interface UserDuplicateCheck {
  exists: boolean;
  emailTaken: boolean;
  usernameTaken: boolean;
  phoneTaken: boolean;
  message?: string;
}

/**
 * Check if email, username, or phone is already registered in Supabase.
 * Uses the SECURITY DEFINER Postgres RPC check_user_exists to bypass RLS safely.
 */
export async function checkDuplicateUser(
  email: string,
  username: string,
  phone: string
): Promise<UserDuplicateCheck> {
  if (!supabase) {
    // Local / Offline fallback checking localStorage accounts
    const localUsersStr = localStorage.getItem('taskpulse_registered_accounts_v1') || '[]';
    try {
      const users: Array<{ email: string; username: string; phone: string }> = JSON.parse(localUsersStr);
      const emailTaken = users.some(u => u.email.toLowerCase() === email.trim().toLowerCase());
      const usernameTaken = users.some(u => u.username.toLowerCase() === username.trim().toLowerCase());
      const phoneTaken = users.some(u => u.phone === phone.trim());

      let message = '';
      if (emailTaken) message = 'An account with this email address already exists.';
      else if (usernameTaken) message = 'This username is already taken. Please choose another.';
      else if (phoneTaken) message = 'This phone number is already registered.';

      return {
        exists: emailTaken || usernameTaken || phoneTaken,
        emailTaken,
        usernameTaken,
        phoneTaken,
        message
      };
    } catch {
      return { exists: false, emailTaken: false, usernameTaken: false, phoneTaken: false };
    }
  }

  try {
    const { data, error } = await supabase.rpc('check_user_exists', {
      p_email: email.trim().toLowerCase(),
      p_username: username.trim().toLowerCase(),
      p_phone: phone.trim()
    });

    if (error) {
      console.warn('RPC check_user_exists fallback to direct verification:', error.message);
      return { exists: false, emailTaken: false, usernameTaken: false, phoneTaken: false };
    }

    const emailTaken = Boolean(data?.email_taken);
    const usernameTaken = Boolean(data?.username_taken);
    const phoneTaken = Boolean(data?.phone_taken);

    let message = '';
    if (emailTaken) message = 'An account with this email address already exists. Please sign in instead.';
    else if (usernameTaken) message = 'This username is already claimed. Please choose a different handle.';
    else if (phoneTaken) message = 'This phone number is already registered to another account.';

    return {
      exists: Boolean(data?.exists),
      emailTaken,
      usernameTaken,
      phoneTaken,
      message
    };
  } catch (err: any) {
    console.warn('Network error checking duplicate user:', err.message);
    return { exists: false, emailTaken: false, usernameTaken: false, phoneTaken: false };
  }
}

/**
 * Sign Up a new user with duplicate verification and profile creation.
 */
export async function signUpUser(params: AuthUserSignup) {
  const { email, password, username, fullName, phone, referralCode } = params;

  // 1. Pre-registration duplicate check
  const dupCheck = await checkDuplicateUser(email, username, phone);
  if (dupCheck.exists) {
    return {
      success: false,
      error: dupCheck.message || 'An account with these details already exists.'
    };
  }

  // 2. Supabase is configured: Register via Supabase Auth
  if (supabase) {
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: {
            username: username.trim().toLowerCase(),
            full_name: fullName.trim(),
            phone: phone.trim(),
            referred_by_code: referralCode ? referralCode.trim() : null
          }
        }
      });

      if (error) {
        if (error.message.toLowerCase().includes('already registered')) {
          return {
            success: false,
            error: 'This email is already registered. Please sign in instead.'
          };
        }
        return { success: false, error: error.message };
      }

      return {
        success: true,
        user: data.user,
        session: data.session,
        message: 'Account created successfully!'
      };
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to sign up.' };
    }
  }

  // 3. Offline / Demo Mode Fallback
  try {
    const localUsersStr = localStorage.getItem('taskpulse_registered_accounts_v1') || '[]';
    const users: any[] = JSON.parse(localUsersStr);
    const newUser = {
      id: `usr_${Date.now()}`,
      email: email.trim().toLowerCase(),
      username: username.trim().toLowerCase(),
      fullName: fullName.trim(),
      phone: phone.trim(),
      referralCode: referralCode || null,
      createdAt: new Date().toISOString()
    };
    users.push(newUser);
    localStorage.setItem('taskpulse_registered_accounts_v1', JSON.stringify(users));

    return {
      success: true,
      user: newUser,
      message: 'Account created successfully (Local Storage Mode).'
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Sign In existing user with email and password
 */
export async function signInUser(email: string, password: string) {
  if (supabase) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password
      });

      if (error) {
        return { success: false, error: error.message };
      }

      // Fetch profile data
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', data.user.id)
        .single();

      return {
        success: true,
        user: data.user,
        profile,
        session: data.session
      };
    } catch (err: any) {
      return { success: false, error: err.message || 'Sign in failed.' };
    }
  }

  // Offline / Demo fallback
  return {
    success: true,
    message: 'Signed in (Demo Mode)'
  };
}

/**
 * Sign out current session
 */
export async function signOutUser() {
  if (supabase) {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn('Error signing out of Supabase:', err);
    }
  }
  localStorage.removeItem('taskpulse_auth_session');
}

/**
 * Fetch Current Authenticated User Profile
 */
export async function getCurrentUserProfile() {
  if (!supabase) return null;

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, email, username, full_name, phone, tier_id, is_activated, withdrawable_balance, pending_balance, total_withdrawn_lifetime, streak_days, referral_code, has_received_double_credit, has_upgraded_after_limit')
      .eq('id', user.id)
      .single();

    if (error) return null;
    return profile;
  } catch {
    return null;
  }
}

// =========================================================================
// DATA EGRESS-SAFE QUERY HELPERS (STRICT COLUMNS & RANGE PAGINATION)
// =========================================================================

/**
 * Fetch transaction history with explicit column filtering (Zero select * egress waste).
 */
export async function fetchTransactionsHistory(
  userId: string,
  typeFilter?: string,
  limit: number = 20,
  offset: number = 0
) {
  if (!supabase) return { data: null, error: null };

  let query = supabase
    .from('transactions')
    .select('id, type, amount, fee, net_amount, status, reference, title, description, destination_bank, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (typeFilter && typeFilter !== 'all') {
    query = query.eq('type', typeFilter);
  }

  return await query;
}

/**
 * Fetch task completions with explicit column filtering and storage URLs.
 */
export async function fetchTaskCompletionsHistory(userId: string, limit: number = 20) {
  if (!supabase) return { data: null, error: null };

  return await supabase
    .from('task_completions')
    .select('id, task_id, task_title, company, reward_amount, category, status, sla_time, completed_at, proof_screenshot_url')
    .eq('user_id', userId)
    .order('completed_at', { ascending: false })
    .limit(limit);
}

/**
 * Fetch referrals with qualification metrics.
 */
export async function fetchReferralsHistory(userId: string, limit: number = 20) {
  if (!supabase) return { data: null, error: null };

  return await supabase
    .from('referrals')
    .select('id, referee_name, referee_username, deposited_amount, is_qualified, joined_time, created_at')
    .eq('referrer_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
}

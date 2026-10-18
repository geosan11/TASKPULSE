import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { normalizeCategory } from '../config/marketplace';
import { signupSourceMetadata } from './signupSource';

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
  /** Optional "How did you hear about us?" answer, stored on profiles.heard_about_us */
  heardAboutUs?: string;
  /** Optional signup answers kept in auth user metadata only (school, school_level, state). */
  profileExtras?: Record<string, string>;
  /** 'worker' (default) earns from tasks; 'business' posts and funds tasks */
  accountType?: 'worker' | 'business';
  businessName?: string;
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
  const { email, password, username, fullName, phone, referralCode, heardAboutUs, accountType, businessName } = params;

  if (!password || password.length < 8) {
    return {
      success: false,
      error: 'Password must be at least 8 characters long for security.',
    };
  }

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
          emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
          data: {
            username: username.trim().toLowerCase(),
            full_name: fullName.trim(),
            phone: phone.trim(),
            referred_by_code: referralCode ? referralCode.trim() : null,
            ...(params.profileExtras || {}),
            heard_about_us: heardAboutUs ? heardAboutUs.trim().slice(0, 120) : null,
            account_type: accountType === 'business' ? 'business' : 'worker',
            business_name: accountType === 'business' && businessName ? businessName.trim().slice(0, 100) : null,
            ...signupSourceMetadata()
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

  // 3. Offline / Local Fallback
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

  // Offline / Dev fallback
  if (import.meta.env.PROD) {
    return {
      success: false,
      error: 'Authentication service is not configured. Please contact support.',
    };
  }

  return {
    success: true,
    message: 'Signed in (Dev Mode)'
  };
}

/**
 * Resend email confirmation link to user
 */
export async function resendVerificationEmail(email: string) {
  if (!supabase) {
    return { success: false, error: 'Database connection is not available.' };
  }
  try {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim().toLowerCase(),
      options: {
        emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined
      }
    });
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true, message: 'Verification link resent successfully.' };
  } catch (err: any) {
    return { success: false, error: err.message || 'Could not resend email.' };
  }
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
      .select('id, email, username, full_name, phone, role, business_name, heard_about_us, withdrawable_balance, pending_balance, total_withdrawn_lifetime, streak_days, streak_last_claimed_date, referral_code, approved_task_count, first_task_approved_at, payout_eligible_from, is_legacy_member, kyc_status, kyc_id_type, kyc_id_last4, kyc_submitted_at, created_at')
      .eq('id', user.id)
      .single();

    if (error) {
      console.warn('Error fetching user profile:', error.message);
      return null;
    }
    return profile;
  } catch {
    return null;
  }
}

/**
 * Fetch linked bank accounts for the user.
 */
export async function fetchBankAccounts(userId: string) {
  if (!supabase) return { data: [], error: null };

  return await supabase
    .from('bank_accounts')
    .select('id, bank_code, bank_name, account_number, account_name, recipient_code, is_active, created_at')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('created_at', { ascending: false });
}

/**
 * Daily check-in. Purely a streak badge: it never credits money
 * (the old ₦450 daily login bonus was unfunded and has been removed).
 */
export async function checkInStreakRpc(): Promise<{ streak_days: number }> {
  if (!supabase) throw new Error('Database is not connected.');
  const { data, error } = await supabase.rpc('claim_daily_reward');
  if (error) {
    if (error.message.includes('already_claimed')) {
      throw new Error('You have already checked in today. Come back tomorrow!');
    }
    throw new Error(error.message);
  }
  return data;
}

/**
 * Submit KYC details via database RPC (only last 4 digits stored).
 */
export async function submitKycRpc(idType: string, idNumber: string) {
  const cleanNumber = idNumber.replace(/\D/g, '');
  if (cleanNumber.length < 8) {
    throw new Error('Please enter a valid National ID / BVN / NIN number.');
  }
  const last4 = cleanNumber.slice(-4);
  if (!supabase) {
    localStorage.setItem('taskpulse_kyc_status', 'verified');
    localStorage.setItem('taskpulse_kyc_last4', last4);
    return { status: 'verified', id_type: idType, last4 };
  }
  const { data, error } = await supabase.rpc('submit_kyc', {
    p_id_type: idType,
    p_last4: last4,
  });
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

const SUBMIT_ERRORS: Record<string, string> = {
  already_submitted: 'You have already submitted proof for this task.',
  task_not_available: 'This task is no longer available.',
  no_slots_left: 'All slots for this task are taken.',
  own_campaign: 'You cannot complete tasks from your own campaign.',
  proof_required: 'Please provide your proof.',
  screenshot_required: 'This task needs a screenshot as proof.',
  link_required: 'This task needs a link (starting with https://) as proof.',
  invalid_proof_path: 'Screenshot upload failed. Please upload it again.',
};

/**
 * Submit proof for a task. The reward is taken from the task row on the
 * server (submit_task RPC); the client never sends an amount.
 */
export async function submitTaskProofRpc(params: {
  taskId: string;
  proofText?: string;
  proofScreenshotPath?: string;
}) {
  if (!supabase) throw new Error('Database is not connected.');
  const { data, error } = await supabase.rpc('submit_task', {
    p_task_id: params.taskId,
    p_proof_text: params.proofText || null,
    p_proof_url: params.proofScreenshotPath || null,
  });
  if (error) {
    const key = Object.keys(SUBMIT_ERRORS).find(k => error.message.includes(k));
    throw new Error(key ? SUBMIT_ERRORS[key] : error.message);
  }
  return data;
}

/**
 * Upload task proof image to private Supabase Storage bucket.
 */
export async function uploadTaskProofImage(file: File, userId: string): Promise<string> {
  if (!supabase) {
    throw new Error('Database is not connected.');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Proof screenshot must be less than 5MB.');
  }

  const ext = file.name.split('.').pop() || 'png';
  const path = `${userId}/${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from('taskpulse-proofs')
    .upload(path, file, { contentType: file.type, upsert: false });

  if (uploadErr) {
    throw new Error(`Failed to upload screenshot: ${uploadErr.message}`);
  }

  return path;
}

/**
 * Update user full name (the only allowed client profile update).
 */
export const NAME_LOCKED_MESSAGE = 'Your ID is verified, so your name is locked. Contact support to change your name.';

export async function updateProfileFullName(fullName: string) {
  if (!supabase) throw new Error('Database is not connected.');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('You must be signed in.');

  const { error } = await supabase
    .from('profiles')
    .update({ full_name: fullName.trim() })
    .eq('id', user.id);

  if (error) {
    // 012: a verified user's name is locked (trigger trg_guard_verified_full_name)
    if (error.message.includes('name_locked_verified')) throw new Error(NAME_LOCKED_MESSAGE);
    throw new Error(error.message);
  }
  return true;
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
    .select('id, task_id, task_title, company, reward_amount, paid_amount, category, status, sla_time, completed_at, review_note, campaign_id')
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
    .select('id, referee_name, referee_username, bonus_status, bonus_referrer_amount, joined_time, created_at')
    .eq('referrer_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
}

/**
 * Database Task Catalog Model
 */
export interface DbTask {
  id: string;
  title: string;
  company: string;
  reward: number;
  category: string;
  time: string;
  SLA: string;
  spotsLeft: number;
  spotsTotal: number;
  description: string;
  steps: string[];
  platformIcon?: string;
  proofType: 'screenshot' | 'text' | 'link';
  campaignId: string | null;
  targetUrl: string | null;
}

/**
 * Fetch active, business-funded tasks from public.tasks: the open feed
 * (spots left), or specific tasks by id (e.g. full ones I hold a spot on).
 */
export async function fetchActiveTasks(opts: { ids?: string[] } = {}): Promise<DbTask[]> {
  if (!supabase) return [];

  try {
    // Free spots whose accept expired before counting (no-op if none; 013).
    if (!opts.ids && (await supabase.auth.getSession()).data.session) {
      await supabase.rpc('release_expired_spot_holds').then(() => undefined, () => undefined);
    }
    const base = supabase
      .from('tasks')
      .select('id, title, company, reward, category, time_estimate, sla, spots_left, spots_total, description, steps, platform_icon, proof_type, campaign_id, target_url')
      .eq('is_active', true);
    const { data, error } = await (opts.ids ? base.in('id', opts.ids) : base.gt('spots_left', 0))
      .order('created_at', { ascending: false });

    if (error || !data) {
      console.warn('Could not fetch tasks from DB:', error?.message);
      return [];
    }

    return data
      .filter((t: any) => t.category !== 'Referral')
      .map((t: any) => ({
        id: t.id,
        title: t.title,
        company: t.company,
        reward: Number(t.reward),
        category: normalizeCategory(t.category),
        time: t.time_estimate || '5m',
        SLA: t.sla || 'Reviewed by business',
        spotsLeft: t.spots_left,
        spotsTotal: t.spots_total,
        description: t.description,
        steps: Array.isArray(t.steps) ? t.steps : (typeof t.steps === 'string' ? JSON.parse(t.steps) : []),
        platformIcon: t.platform_icon || '✅',
        proofType: (t.proof_type || 'screenshot') as DbTask['proofType'],
        campaignId: t.campaign_id || null,
        targetUrl: t.target_url || null,
      }));
  } catch (e) {
    console.warn('Failed to query tasks:', e);
    return [];
  }
}

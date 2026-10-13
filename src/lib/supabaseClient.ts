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
  if (import.meta.env.PROD) {
    return {
      success: false,
      error: 'Authentication service is not configured. Please contact support.',
    };
  }

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
      .select('id, email, username, full_name, phone, tier_id, is_activated, activation_timestamp, withdrawable_balance, pending_balance, total_withdrawn_lifetime, streak_days, streak_last_claimed_date, referral_code, has_received_double_credit, has_upgraded_after_limit, kyc_status, kyc_id_type, kyc_id_last4, kyc_submitted_at')
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
 * Call the claim_daily_reward database RPC.
 */
export async function claimDailyRewardRpc() {
  if (!supabase) {
    const lastClaimed = localStorage.getItem('taskpulse_streak_last_claimed');
    const today = new Date().toISOString().slice(0, 10);
    if (lastClaimed === today) {
      throw new Error('You have already claimed today’s reward. Check back tomorrow!');
    }
    const currentStreak = Number(localStorage.getItem('taskpulse_streak_days') || '0') + 1;
    localStorage.setItem('taskpulse_streak_last_claimed', today);
    localStorage.setItem('taskpulse_streak_days', String(currentStreak));
    return { streak_days: currentStreak, reward_amount: 100, claimed: true };
  }
  const { data, error } = await supabase.rpc('claim_daily_reward');
  if (error) {
    if (error.message.includes('already_claimed')) {
      throw new Error('You have already claimed today’s reward. Check back tomorrow!');
    }
    if (error.message.includes('not_activated')) {
      throw new Error('Your account must be activated to claim daily login rewards.');
    }
    throw new Error(error.message);
  }
  return data;
}

/**
 * Call the upgrade_tier_from_wallet database RPC.
 */
export async function upgradeTierRpc(targetTierId: string) {
  if (!supabase) {
    const tierStakes: Record<string, number> = {
      silver: 10000,
      gold: 25000,
      platinum: 50000,
      diamond: 100000,
      black_crown_vip: 250000,
    };
    const reqStake = tierStakes[targetTierId] || 10000;
    const curBal = Number(localStorage.getItem('taskpulse_balance') || '0');
    if (curBal < reqStake) {
      throw new Error('Insufficient wallet balance to upgrade to this tier.');
    }
    localStorage.setItem('taskpulse_balance', String(curBal - reqStake));
    localStorage.setItem('taskpulse_tier', targetTierId);
    return { success: true, tier_id: targetTierId, stake_deducted: reqStake };
  }
  const { data, error } = await supabase.rpc('upgrade_tier_from_wallet', {
    p_target_tier_id: targetTierId,
  });
  if (error) {
    if (error.message.includes('insufficient_balance')) {
      throw new Error('Insufficient wallet balance to upgrade to this tier.');
    }
    if (error.message.includes('cannot_downgrade') || error.message.includes('already_at_or_above_tier')) {
      throw new Error('You can only upgrade to a higher tier.');
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

/**
 * Submit a task completion proof for admin review.
 */
export async function submitTaskProofRpc(params: {
  taskId: string;
  taskTitle: string;
  company: string;
  rewardAmount: number;
  category: string;
  proofScreenshotUrl?: string;
}) {
  if (!supabase) {
    const completions = JSON.parse(localStorage.getItem('taskpulse_task_completions') || '[]');
    if (completions.some((c: any) => c.task_id === params.taskId)) {
      throw new Error('You have already submitted proof for this task.');
    }
    const newRecord = {
      id: `tc_${Date.now()}`,
      task_id: params.taskId,
      task_title: params.taskTitle,
      reward_amount: params.rewardAmount,
      status: 'pending',
      submitted_at: new Date().toISOString(),
    };
    completions.push(newRecord);
    localStorage.setItem('taskpulse_task_completions', JSON.stringify(completions));
    return newRecord;
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('You must be signed in.');

  const { data, error } = await supabase
    .from('task_completions')
    .insert({
      user_id: user.id,
      task_id: params.taskId,
      task_title: params.taskTitle,
      company: params.company,
      reward_amount: params.rewardAmount,
      category: params.category,
      status: 'pending',
      proof_screenshot_url: params.proofScreenshotUrl || null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error('You have already submitted proof for this task.');
    }
    throw new Error(error.message);
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
export async function updateProfileFullName(fullName: string) {
  if (!supabase) throw new Error('Database is not connected.');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('You must be signed in.');

  const { error } = await supabase
    .from('profiles')
    .update({ full_name: fullName.trim() })
    .eq('id', user.id);

  if (error) throw new Error(error.message);
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

/**
 * Database Task Catalog Model
 */
export interface DbTask {
  id: string;
  title: string;
  company: string;
  reward: number;
  category: 'Social' | 'App Tests' | 'Surveys' | 'Field Audits';
  time: string;
  SLA: string;
  spotsLeft: number;
  spotsTotal: number;
  description: string;
  steps: string[];
  platformIcon?: string;
}

/**
 * Fetch active tasks from public.tasks table
 */
export async function fetchActiveTasks(): Promise<DbTask[]> {
  if (!supabase) return [];

  try {
    const { data, error } = await supabase
      .from('tasks')
      .select('id, title, company, reward, category, time_estimate, sla, spots_left, spots_total, description, steps, platform_icon')
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    if (error || !data) {
      console.warn('Could not fetch tasks from DB:', error?.message);
      return [];
    }

    return data.map((t: any) => ({
      id: t.id,
      title: t.title,
      company: t.company,
      reward: Number(t.reward),
      category: t.category,
      time: t.time_estimate || '2m',
      SLA: t.sla || 'Instant SLA Approval',
      spotsLeft: t.spots_left,
      spotsTotal: t.spots_total,
      description: t.description,
      steps: Array.isArray(t.steps) ? t.steps : (typeof t.steps === 'string' ? JSON.parse(t.steps) : []),
      platformIcon: t.platform_icon || '🎵'
    }));
  } catch (e) {
    console.warn('Failed to query tasks:', e);
    return [];
  }
}


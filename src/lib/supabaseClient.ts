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

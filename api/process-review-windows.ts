import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

/**
 * GET /api/process-review-windows  (Vercel Cron)
 *
 * Calls process_review_windows() (service_role only): auto-approves campaign
 * submissions nobody reviewed within the review window and moves approved
 * rewards whose window has closed from pending to withdrawable. Idempotent
 * and row-locked, so running it often (or alongside pg_cron) is safe.
 *
 * Auth: Vercel sends "Authorization: Bearer $CRON_SECRET" when CRON_SECRET is
 * set in the project's environment variables. Requests without it are refused.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ status: false, message: 'Method Not Allowed' });
  }
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return res.status(500).json({ status: false, message: 'Server misconfiguration: set CRON_SECRET in Vercel environment variables.' });
  }
  const header = req.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (value !== `Bearer ${secret}`) {
    return res.status(401).json({ status: false, message: 'Unauthorized' });
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SERVICE_ROLE_KEY;
  if (!url || !key) {
    return res.status(500).json({ status: false, message: 'Server misconfiguration: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.' });
  }

  try {
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.rpc('process_review_windows', { p_limit: 2000 });
    if (error) throw new Error(error.message);
    return res.status(200).json({ status: true, result: data, at: new Date().toISOString() });
  } catch (err: any) {
    console.error('[API Error: process-review-windows]', err);
    return res.status(500).json({ status: false, message: 'Processing failed' });
  }
}

import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * 7-DAY INACTIVITY KEEP-ALIVE PING
 * Pings Supabase with a lightweight query to prevent Free Tier auto-pause.
 * Can be scheduled via Vercel Cron or cron-job.org every 3-4 days.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(200).json({
      status: true,
      message: 'Keep-alive ping acknowledged (Supabase URL/Key pending configuration).'
    });
  }

  try {
    // Ultra-lightweight HEAD or limit 1 select query to consume near-zero egress
    const response = await fetch(`${supabaseUrl}/rest/v1/profiles?select=id&limit=1`, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`
      }
    });

    if (response.ok) {
      return res.status(200).json({
        status: true,
        message: 'Supabase project kept warm successfully.',
        timestamp: new Date().toISOString()
      });
    } else {
      return res.status(200).json({
        status: true,
        message: 'Supabase ping completed with response code: ' + response.status
      });
    }
  } catch (error: any) {
    return res.status(500).json({
      status: false,
      message: 'Failed to ping Supabase: ' + error.message
    });
  }
}

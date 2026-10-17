import type { VercelRequest, VercelResponse } from '@vercel/node';

function isServiceRoleKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true;
  if (key.startsWith('sb_publishable_')) return false;
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return payload?.role === 'service_role';
  } catch {
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
  const paystackPublicKey = process.env.VITE_PAYSTACK_PUBLIC_KEY;

  const envReport = {
    supabase_url: Boolean(supabaseUrl),
    supabase_anon_key: Boolean(supabaseAnonKey),
    supabase_service_role_key: Boolean(serviceRoleKey),
    // Money endpoints refuse to run unless this is a real service-role key.
    // A false here means deposits/campaign payments cannot be settled.
    supabase_service_role_key_valid: Boolean(serviceRoleKey && isServiceRoleKey(serviceRoleKey)),
    supabase_service_role_key_uses_vite_name: !process.env.SUPABASE_SERVICE_ROLE_KEY && Boolean(process.env.VITE_SUPABASE_SERVICE_ROLE_KEY),
    paystack_secret_key: Boolean(paystackSecretKey),
    paystack_public_key: Boolean(paystackPublicKey),
  };

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(200).json({
      configured: false,
      status: 'pending_configuration',
      message: 'Supabase environment variables (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY) are missing in Vercel.',
      instructions: 'Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your Vercel Project Settings > Environment Variables, then redeploy.',
      env: envReport
    });
  }

  try {
    // Test query against Supabase REST endpoint
    const response = await fetch(`${supabaseUrl}/rest/v1/profiles?select=id&limit=1`, {
      method: 'GET',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      return res.status(200).json({
        configured: true,
        status: 'connected',
        url: supabaseUrl.replace(/(https:\/\/[a-z0-9]{4})[a-z0-9]+(\.supabase\.co)/, '$1****$2'),
        message: 'Successfully connected to Supabase PostgreSQL! Tables and RLS policies are accessible.',
        env: envReport,
        checked_at: new Date().toISOString()
      });
    }

    if (response.status === 404 || response.status === 400) {
      return res.status(200).json({
        configured: true,
        status: 'connected_but_schema_missing',
        message: 'Connected to Supabase project, but the "profiles" table was not found. Please run supabase/schema.sql in your Supabase SQL Editor.',
        http_status: response.status,
        env: envReport
      });
    }

    return res.status(200).json({
      configured: true,
      status: 'auth_error',
      message: `Supabase responded with HTTP ${response.status}. Please check your anon API key.`,
      http_status: response.status,
      env: envReport
    });
  } catch (error: any) {
    return res.status(500).json({
      configured: true,
      status: 'connection_failed',
      error: 'Network error connecting to Supabase.',
      env: envReport
    });
  }
}

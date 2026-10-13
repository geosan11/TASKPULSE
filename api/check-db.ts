import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_KEY;
  const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
  const paystackPublicKey = process.env.VITE_PAYSTACK_PUBLIC_KEY;

  const envReport = {
    supabase_url: Boolean(supabaseUrl),
    supabase_anon_key: Boolean(supabaseAnonKey),
    supabase_service_role_key: Boolean(serviceRoleKey),
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
      error: error.message || 'Unknown network error connecting to Supabase.',
      env: envReport
    });
  }
}

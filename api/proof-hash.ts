import type { VercelRequest, VercelResponse } from '@vercel/node';
import crypto from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * POST /api/proof-hash  { path }  (Authorization: Bearer <user access token>)
 *
 * Computes the sha256 of a worker's uploaded proof screenshot on the SERVER
 * (from the stored file, so the client cannot lie about it) and records it
 * with record_proof_hash() (service_role only, first write wins). submit_task()
 * uses it to flag the same screenshot being reused in a campaign. If this
 * route fails, submit_task falls back to the storage object's ETag + size.
 *
 * Self-contained on purpose (no relative imports), like the other /api routes.
 */

const BUCKET = 'taskpulse-proofs';
const MAX_BYTES = 6 * 1024 * 1024;

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    Object.setPrototypeOf(this, HttpError.prototype);
  }
}

function readServiceRoleKey(): string | undefined {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
    undefined
  );
}

let _admin: SupabaseClient | null = null;
function admin(): SupabaseClient {
  if (_admin) return _admin;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = readServiceRoleKey();
  if (!url || !key) throw new HttpError(500, 'Server misconfiguration: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  _admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return _admin;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ status: false, message: 'Method Not Allowed' });
  try {
    const header = req.headers.authorization;
    const value = Array.isArray(header) ? header[0] : header;
    if (!value || !value.toLowerCase().startsWith('bearer ')) throw new HttpError(401, 'Authentication required.');
    const token = value.slice(7).trim();
    const client = admin();
    const { data: auth, error: authErr } = await client.auth.getUser(token);
    if (authErr || !auth?.user) throw new HttpError(401, 'Session invalid or expired.');
    const userId = auth.user.id;

    const path = String((req.body || {}).path || '').trim();
    // Only the caller's own folder, no traversal.
    if (!path.startsWith(`${userId}/`) || path.includes('..') || path.length > 300) {
      throw new HttpError(400, 'Invalid proof path.');
    }

    const { data: file, error: dlErr } = await client.storage.from(BUCKET).download(path);
    if (dlErr || !file) throw new HttpError(404, 'Proof not found.');
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new HttpError(413, 'Proof too large.');
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');

    const { error: rpcErr } = await client.rpc('record_proof_hash', {
      p_user_id: userId,
      p_path: path,
      p_sha256: sha256,
      p_size: buf.length,
    });
    if (rpcErr) throw new Error(rpcErr.message);
    // The hash itself is not returned: the client has no use for it.
    return res.status(200).json({ status: true });
  } catch (err: any) {
    if (err instanceof HttpError) return res.status(err.status).json({ status: false, message: err.message });
    console.error('[API Error: proof-hash]', err);
    return res.status(500).json({ status: false, message: 'Internal server error' });
  }
}

/**
 * First-touch signup attribution. On app load we read utm_source /
 * utm_medium / utm_campaign from the URL and keep them in localStorage for
 * 30 days (first touch wins: a later visit with new UTMs does not overwrite
 * an unexpired record). On sign-up they ride along in Supabase user metadata
 * (auth.users.raw_user_meta_data), so no migration is needed.
 */
const KEY = 'taskpulse_signup_source_v1';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SignupSource {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  capturedAt: string;
}

function clean(v: string | null): string | null {
  if (!v) return null;
  const s = v.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 100);
  return s || null;
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readSignupSource(now = Date.now()): SignupSource | null {
  const ls = storage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw) as SignupSource;
    const at = Date.parse(rec?.capturedAt);
    if (!Number.isFinite(at) || now - at > TTL_MS) {
      ls.removeItem(KEY);
      return null;
    }
    return rec;
  } catch {
    return null;
  }
}

/** Call once on load, before anything strips the query string. */
export function captureSignupSource(search: string = typeof window !== 'undefined' ? window.location.search : '', now = Date.now()): SignupSource | null {
  const existing = readSignupSource(now);
  if (existing) return existing;
  const p = new URLSearchParams(search);
  const rec: SignupSource = {
    source: clean(p.get('utm_source')),
    medium: clean(p.get('utm_medium')),
    campaign: clean(p.get('utm_campaign')),
    capturedAt: new Date(now).toISOString(),
  };
  if (!rec.source && !rec.medium && !rec.campaign) return null;
  try {
    storage()?.setItem(KEY, JSON.stringify(rec));
  } catch {
    /* storage full / private mode: attribution is best effort */
  }
  return rec;
}

/** Flat keys for options.data on supabase.auth.signUp (empty object when unknown). */
export function signupSourceMetadata(now = Date.now()): Record<string, string | null> {
  const rec = readSignupSource(now);
  if (!rec) return {};
  return {
    signup_source: rec.source,
    signup_medium: rec.medium,
    signup_campaign: rec.campaign,
    signup_source_captured_at: rec.capturedAt,
  };
}

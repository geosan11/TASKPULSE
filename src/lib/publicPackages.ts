/**
 * Pure helpers for the public /packages page (no Supabase import, so they
 * run under tsx tests). The public page shows one all-in price; worker pay
 * (slots x reward) is only shown inside the "See breakdown" panel.
 */
export interface PublicPackage {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string | null;
  slots: number;
  totalPrice: number;
  /** Worker pay per completion. Only shown inside the price breakdown. */
  rewardPerCompletion: number;
  platformFeeRate: number;
  proofType: string | null;
  proofRequirements: Record<string, unknown> | null;
  estimatedDeliveryDays: number;
}

export type PublicPackagesResult = { status: 'ok'; packages: PublicPackage[] } | { status: 'error'; message: string };

type DeliverableInput = Pick<PublicPackage, 'proofType' | 'proofRequirements' | 'description'>;

/** Plain-English "what you get" line, derived from the proof settings. */
export function deliverableFor(p: DeliverableInput): string {
  const r = (p.proofRequirements || {}) as Record<string, unknown>;
  const desc = (p.description || '').toLowerCase();
  const isPrivate = r.public_posting === false;

  if (r.proof === 'survey_answers_and_usage_screenshot') return 'Private survey answers + usage screenshot';
  if (Array.isArray(r.ratings) && r.ratings.length) {
    const names = (r.ratings as unknown[]).map(x => String(x).replace(/_/g, ' ')).filter(Boolean);
    return `Private ratings (${names.join(', ')}) + written comments`;
  }
  if (r.deliverables === '3_photos_1_broll') return '3 photos + 1 short video per student, via share link';
  if (r.raw_footage_transfer || r.location_checkin) return 'Photos, video clips + attendance notes via share link';
  if (r.delivery === 'raw_file_link' || /video/.test(desc)) return 'Raw video files via share link';

  switch (p.proofType) {
    case 'link':
      return 'Files delivered via share link';
    case 'screenshot':
      return isPrivate ? 'Private screenshots' : 'Screenshot proof';
    case 'text':
      return isPrivate ? 'Private written answers' : 'Written answers';
    default:
      return 'Reviewed proof from each student';
  }
}

export const studentsLabel = (n: number) => `${n} ${n === 1 ? 'student' : 'students'}`;
export const daysLabel = (n: number) => (n > 0 ? `About ${n} ${n === 1 ? 'day' : 'days'}` : 'Delivery time varies');

/* ------------------------------------------------------------------ */
/* Chosen package hand-off: /packages -> sign-up -> Business storefront */
/* ------------------------------------------------------------------ */

const PENDING_KEY = 'taskpulse_pending_package_v1';
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
/** Sentinel for "open the storefront, no specific package". */
export const ANY_PACKAGE = '*';

export function cleanPackageSlug(v: string | null | undefined): string | null {
  const s = (v || '').trim().toLowerCase();
  if (s === ANY_PACKAGE) return ANY_PACKAGE;
  return /^[a-z0-9][a-z0-9-]{0,79}$/.test(s) ? s : null;
}

function store(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function setPendingPackage(slug: string | null, now = Date.now()) {
  const clean = cleanPackageSlug(slug ?? ANY_PACKAGE);
  if (!clean) return;
  try {
    store()?.setItem(PENDING_KEY, JSON.stringify({ slug: clean, at: now }));
  } catch {
    /* best effort */
  }
}

export function readPendingPackage(now = Date.now()): string | null {
  const ls = store();
  if (!ls) return null;
  try {
    const raw = ls.getItem(PENDING_KEY);
    if (!raw) return null;
    const rec = JSON.parse(raw) as { slug?: string; at?: number };
    const slug = cleanPackageSlug(rec?.slug);
    if (!slug || typeof rec.at !== 'number' || now - rec.at > PENDING_TTL_MS) {
      ls.removeItem(PENDING_KEY);
      return null;
    }
    return slug;
  } catch {
    return null;
  }
}

export function clearPendingPackage() {
  try {
    store()?.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

/** No-JS fallback link for a package CTA (the in-app handler takes over when JS runs). */
export function packageSignupHref(slug?: string | null): string {
  const clean = cleanPackageSlug(slug);
  return `/?for=business&package=${clean && clean !== ANY_PACKAGE ? encodeURIComponent(clean) : ANY_PACKAGE}`;
}

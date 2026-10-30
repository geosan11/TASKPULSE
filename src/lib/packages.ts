import { supabase } from './supabaseClient';
import type { PublicPackage, PublicPackagesResult } from './publicPackages';

/** One row of the packages catalog (015), shaped for the storefront. */
export interface PackageItem {
  id: string;
  slug: string;
  name: string;
  description: string;
  slots: number;
  rewardPerCompletion: number;
  platformFeeRate: number;
  totalPrice: number;
  estimatedDeliveryDays: number;
  /** False while fewer than `slots` students have joined (package_availability()). */
  available: boolean;
}

export type PackagesResult =
  | { status: 'ok'; packages: PackageItem[] }
  /** 015 has not been run yet (or Supabase is not configured): show nothing. */
  | { status: 'missing' }
  | { status: 'error'; message: string };

/** PostgREST / Postgres codes for "this table or function does not exist (yet)". */
export function isMissingRelation(error: { code?: string; message?: string; status?: number } | null | undefined) {
  if (!error) return false;
  return (
    ['PGRST202', 'PGRST205', '42P01', '42883'].includes(error.code || '') ||
    error.status === 404 ||
    /could not find the (function|table)|does not exist/i.test(error.message || '')
  );
}

/** True once migration 015 has been run (the packages table exists and has rows). */
export async function packagesEnabled(): Promise<boolean> {
  if (!supabase) return false;
  const { count, error } = await supabase.from('packages').select('id', { count: 'exact', head: true }).eq('is_active', true);
  if (error) return false;
  return (count ?? 0) > 0;
}

export async function fetchPackages(): Promise<PackagesResult> {
  if (!supabase) return { status: 'missing' };
  const { data, error } = await supabase
    .from('packages')
    .select('id, slug, name, description, slots, reward_per_completion, platform_fee_rate, total_price, estimated_delivery_days')
    .eq('is_active', true)
    .order('sort_order');
  if (error) {
    if (isMissingRelation(error)) return { status: 'missing' };
    return { status: 'error', message: 'Could not load packages. Please try again.' };
  }

  // Worker-count gate. The server enforces it in create_package_campaign();
  // this only drives the button. If the check itself fails, leave buying on
  // and let the server decide.
  const availability = new Map<string, boolean>();
  const { data: avail, error: availErr } = await supabase.rpc('package_availability');
  if (!availErr && Array.isArray(avail)) {
    for (const a of avail as { package_id: string; available: boolean }[]) availability.set(a.package_id, Boolean(a.available));
  }

  return {
    status: 'ok',
    packages: (data || []).map((p: any) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description,
      slots: p.slots,
      rewardPerCompletion: Number(p.reward_per_completion),
      platformFeeRate: Number(p.platform_fee_rate),
      totalPrice: Number(p.total_price),
      estimatedDeliveryDays: p.estimated_delivery_days,
      available: availability.get(p.id) ?? true,
    })),
  };
}

/**
 * Public /packages page (anon key). reward_per_completion is fetched only for
 * the "See breakdown" panel (worker pay = slots x reward); never show it elsewhere.
 */
export const PUBLIC_PACKAGE_COLUMNS =
  'id, slug, name, description, category, slots, reward_per_completion, platform_fee_rate, total_price, proof_type, proof_requirements, estimated_delivery_days';

export async function fetchPublicPackages(): Promise<PublicPackagesResult> {
  if (!supabase) return { status: 'error', message: 'Packages are not available right now. Please try again later.' };
  const { data, error } = await supabase.from('packages').select(PUBLIC_PACKAGE_COLUMNS).eq('is_active', true).order('sort_order');
  if (error) {
    // Table not there yet: treat as "no packages" rather than an error.
    if (isMissingRelation(error)) return { status: 'ok', packages: [] };
    return { status: 'error', message: 'Could not load packages. Check your connection and try again.' };
  }
  return {
    status: 'ok',
    packages: (data || []).map((p: any) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description || '',
      category: p.category ?? null,
      slots: Number(p.slots) || 0,
      totalPrice: Number(p.total_price) || 0,
      rewardPerCompletion: Number(p.reward_per_completion) || 0,
      platformFeeRate: Number(p.platform_fee_rate) || 0,
      proofType: p.proof_type ?? null,
      proofRequirements: p.proof_requirements && typeof p.proof_requirements === 'object' ? p.proof_requirements : null,
      estimatedDeliveryDays: Number(p.estimated_delivery_days) || 0,
    })),
  };
}


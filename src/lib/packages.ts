import { supabase } from './supabaseClient';

/** One row of the packages catalog (015), shaped for the storefront. */
export interface PackageItem {
  id: string;
  slug: string;
  name: string;
  description: string;
  slots: number;
  rewardPerCompletion: number;
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
    .select('id, slug, name, description, slots, reward_per_completion, total_price, estimated_delivery_days')
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
      totalPrice: Number(p.total_price),
      estimatedDeliveryDays: p.estimated_delivery_days,
      available: availability.get(p.id) ?? true,
    })),
  };
}

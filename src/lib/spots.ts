/**
 * Task spots: how many people can still take a task, and the signed-in
 * worker's own accepted ("held") spots.
 *
 * A spot is taken when a worker accepts the task (accept_task RPC), and stays
 * taken while they work, after they send proof, and once it's approved. It is
 * freed when the proof is rejected, when the worker gives it up
 * (abandon_task), or when an accepted spot is not used before it expires
 * (marketplace_settings.spot_hold_hours, 24h by default). The server keeps
 * tasks.spots_left = slots - approved - pending - held (supabase/013).
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { fetchActiveTasks, supabase, type DbTask } from './supabaseClient';

export type SpotsTone = 'normal' | 'low' | 'full';

/** Fewer than this many spots left shows the amber "Only N left". */
export const LOW_SPOTS = 10;

export function spotsState(left: number, total: number): { left: number; total: number; taken: number; tone: SpotsTone; label: string } {
  const t = Math.max(0, Math.floor(total || 0));
  const l = Math.min(t, Math.max(0, Math.floor(left || 0)));
  const tone: SpotsTone = l <= 0 ? 'full' : l < LOW_SPOTS ? 'low' : 'normal';
  const label = tone === 'full' ? 'All spots taken' : tone === 'low' ? `Only ${l} left` : `${l} of ${t} spots left`;
  return { left: l, total: t, taken: t - l, tone, label };
}

// ---------------------------------------------------------------------------
// Small shared store: my holds + fresh spots_left returned by accept/abandon
// (so the bar updates at once, before the task list is refetched).
// ---------------------------------------------------------------------------
export interface SpotHold {
  taskId: string;
  expiresAt: string | null;
}
let holds = new Map<string, SpotHold>();
let spotsOverride = new Map<string, number>();
let version = 0;
let lastTasks: DbTask[] | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  listeners.forEach(l => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Re-render when holds or counts change. */
export function useSpotsVersion() {
  return useSyncExternalStore(subscribe, () => version);
}

export function holdFor(taskId: string): SpotHold | null {
  const h = holds.get(taskId);
  if (!h) return null;
  if (h.expiresAt && new Date(h.expiresAt).getTime() <= Date.now()) return null;
  return h;
}

export function spotsLeftFor(task: Pick<DbTask, 'id' | 'spotsLeft'>): number {
  return spotsOverride.get(task.id) ?? task.spotsLeft;
}

/** The 013 migration isn't applied yet (function/table missing): degrade quietly. */
function isMissing(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return ['PGRST202', 'PGRST205', '42P01', '42883'].includes(error.code || '') || /could not find the (function|table)/i.test(error.message || '');
}

export async function loadMySpotHolds(): Promise<void> {
  if (!supabase) return;
  const { data, error } = await supabase.from('task_spot_holds').select('task_id, expires_at');
  if (error) {
    if (!isMissing(error)) console.warn('Could not load accepted tasks:', error.message);
    return;
  }
  // Keep local-only holds (pre-migration fallback) that the server can't know about.
  const next = new Map<string, SpotHold>();
  holds.forEach((h, id) => {
    if (h.expiresAt === null) next.set(id, h);
  });
  (data || []).forEach((r: any) => next.set(r.task_id, { taskId: r.task_id, expiresAt: r.expires_at }));
  holds = next;
  emit();
}

const SPOT_ERRORS: Record<string, string> = {
  no_slots_left: 'All spots for this task are taken.',
  already_submitted: 'You have already sent proof for this task.',
  own_campaign: 'You cannot take tasks from your own campaign.',
  task_not_available: 'This task is no longer available.',
  not_authenticated: 'Please sign in again.',
};

export async function acceptTaskSpot(task: DbTask): Promise<SpotHold> {
  if (!supabase) throw new Error('Database is not connected.');
  const { data, error } = await supabase.rpc('accept_task', { p_task_id: task.id });
  if (error) {
    if (isMissing(error)) {
      // Server not upgraded yet: let the worker continue; submit_task still
      // enforces the limit.
      const h = { taskId: task.id, expiresAt: null };
      holds.set(task.id, h);
      emit();
      return h;
    }
    const key = Object.keys(SPOT_ERRORS).find(k => error.message.includes(k));
    if (key === 'no_slots_left') {
      spotsOverride.set(task.id, 0);
      emit();
    }
    throw new Error(key ? SPOT_ERRORS[key] : error.message);
  }
  const h: SpotHold = { taskId: task.id, expiresAt: data?.held ? data.expires_at : null };
  holds.set(task.id, h);
  if (typeof data?.spots_left === 'number') spotsOverride.set(task.id, data.spots_left);
  emit();
  return h;
}

export async function abandonTaskSpot(task: DbTask): Promise<void> {
  if (!supabase) throw new Error('Database is not connected.');
  const { data, error } = await supabase.rpc('abandon_task', { p_task_id: task.id });
  if (error && !isMissing(error)) throw new Error(error.message);
  holds.delete(task.id);
  if (typeof data?.spots_left === 'number') spotsOverride.set(task.id, data.spots_left);
  emit();
}

/**
 * Worker feed: open tasks plus any full task I already hold a spot on, with
 * fresh counts applied. Reloads my holds whenever the task list is refetched.
 */
export function useTaskFeed(tasks: DbTask[]): DbTask[] {
  useSpotsVersion();
  const [extra, setExtra] = useState<DbTask[]>([]);
  useEffect(() => {
    let cancelled = false;
    // A refetched list is the source of truth again (remounting with the
    // same list keeps the fresh counts from accept/abandon).
    if (lastTasks !== tasks) {
      lastTasks = tasks;
      spotsOverride = new Map();
      emit();
    }
    loadMySpotHolds().then(async () => {
      const ids = Array.from(holds.keys()).filter(id => !tasks.some(t => t.id === id));
      const rows = ids.length ? await fetchActiveTasks({ ids }) : [];
      if (!cancelled) setExtra(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [tasks]);
  const held = extra.filter(t => holdFor(t.id) && !tasks.some(x => x.id === t.id));
  return [...tasks, ...held].map(t => (spotsOverride.has(t.id) ? { ...t, spotsLeft: spotsOverride.get(t.id)! } : t));
}

/** "until 3:20 PM" / "until Tue 3:20 PM" in the device's time zone. */
export function holdUntilLabel(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  const d = new Date(expiresAt);
  if (Number.isNaN(d.getTime())) return null;
  const sameDay = d.toDateString() === new Date().toDateString();
  return d.toLocaleString(undefined, sameDay ? { hour: 'numeric', minute: '2-digit' } : { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

/** Pure helpers for the going-international note (no React, unit-tested). */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Parse the configured target; null/blank/invalid means "no date" (dateless line). */
export function parseLaunchAt(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/**
 * Remaining time label. 1 day or more: "13d 4h" (or just "13d" when
 * daysOnly). Under a day: "5h 12m" (or "12m"). Returns null once passed.
 */
export function formatRemaining(ms: number, { daysOnly = false } = {}): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const d = Math.floor(ms / DAY);
  const h = Math.floor((ms % DAY) / HOUR);
  const m = Math.floor((ms % HOUR) / MIN);
  if (d >= 1) return daysOnly ? `${d}d` : `${d}d ${h}h`;
  if (h >= 1) return `${h}h ${m}m`;
  return `${Math.max(m, 1)}m`;
}

/** ms until the next whole minute, so the label ticks on the minute (min 1s). */
export function msToNextMinute(now: number): number {
  return Math.max(1000, MIN - (now % MIN));
}

export function dismissKey(audience: string, launchAt: string | null): string {
  return `taskpulse_intl_note_dismissed:${launchAt || 'soon'}:${audience}`;
}

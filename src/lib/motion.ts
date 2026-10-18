import { useEffect, useRef, useState } from 'react';

/** True when the user asked the OS for less motion. Every animation checks this. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* ------------------------------------------------------------------ */
/* "Seen" flags: each celebration plays once per event, not per load.   */
/* ------------------------------------------------------------------ */

const SEEN_KEY = 'taskpulse_seen_moments';
const MAX_SEEN = 600;

function readSeen(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function hasSeen(id: string): boolean {
  return readSeen().includes(id);
}

export function markSeen(...ids: string[]) {
  if (!ids.length) return;
  try {
    const cur = readSeen().filter(x => !ids.includes(x));
    localStorage.setItem(SEEN_KEY, JSON.stringify([...cur, ...ids].slice(-MAX_SEEN)));
  } catch {
    /* storage blocked: worst case a moment plays again */
  }
}

/** Mark the id as seen and report whether it was new. */
export function claimMoment(id: string): boolean {
  if (hasSeen(id)) return false;
  markSeen(id);
  return true;
}

/* ------------------------------------------------------------------ */
/* Count-up                                                            */
/* ------------------------------------------------------------------ */

/** Animates a number from `from` to `to` over `ms` (ease-out). Instant under reduced motion. */
export function useCountUp(to: number, { from = 0, ms = 700, run = true }: { from?: number; ms?: number; run?: boolean } = {}) {
  const [v, setV] = useState(run && !prefersReducedMotion() ? from : to);
  useEffect(() => {
    if (!run || prefersReducedMotion() || from === to) {
      setV(to);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      setV(Math.round(from + (to - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, from, ms, run]);
  return v;
}

/** Counts up from the previous value whenever `value` increases (never on first render). */
export function useAnimatedIncrease(value: number, ms = 700) {
  const [pair, setPair] = useState({ from: value, to: value });
  if (pair.to !== value) {
    // Derived state: decreases jump straight to the new value.
    setPair({ from: value > pair.to ? pair.to : value, to: value });
  }
  return useCountUp(value, { from: pair.to !== value ? value : pair.from, ms });
}

/** Returns a key that changes only when `value` changes after mount (for one-shot CSS animations). */
export function useChangeKey(value: unknown) {
  const prev = useRef(value);
  const [key, setKey] = useState(0);
  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value;
      setKey(k => k + 1);
    }
  }, [value]);
  return key;
}

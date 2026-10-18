import { useEffect, useState } from 'react';

/**
 * Tiny path router for the few public pages (no dependency needed).
 * Vercel rewrites every non-file path to index.html, so these work on a
 * direct load; navigate() switches pages without a reload.
 */
export const PUBLIC_ROUTES = ['/', '/business', '/terms', '/privacy'] as const;
export type PublicRoute = (typeof PUBLIC_ROUTES)[number];

export function normalizePath(pathname: string): string {
  const p = (pathname || '/').replace(/\/{2,}/g, '/').replace(/\/+$/, '').toLowerCase();
  return p === '' ? '/' : p;
}

export function navigate(to: string, { replace = false } = {}) {
  if (typeof window === 'undefined') return;
  const current = window.location.pathname + window.location.search;
  if (current !== to) window.history[replace ? 'replaceState' : 'pushState']({}, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function usePathname(): string {
  const [path, setPath] = useState(() => normalizePath(typeof window === 'undefined' ? '/' : window.location.pathname));
  useEffect(() => {
    const on = () => setPath(normalizePath(window.location.pathname));
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  return path;
}

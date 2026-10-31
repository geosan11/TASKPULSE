/**
 * Per-route <head> data. Pure data (no DOM) so both the browser head manager
 * (src/lib/seo.ts) and the build step in vite.config.ts (which writes
 * dist/business.html etc. for link-preview crawlers that do not run JS) use
 * the same values.
 */
export const SITE_URL = 'https://www.taskpulse.website';
export const SITE_NAME = 'TaskPulse';
export const OG_IMAGE = `${SITE_URL}/og-image.png`;

export interface RouteMeta {
  path: string;
  title: string;
  description: string;
  /**
   * sitemap.xml <lastmod> (YYYY-MM-DD, WAT): the date this page's visible content
   * last changed. Bump it by hand when you change the page's copy. Vercel builds
   * have no git history, so this is set here rather than read from git.
   */
  lastmod: string;
}

export const ROUTE_META: Record<string, RouteMeta> = {
  '/': {
    path: '/',
    lastmod: '2026-10-31',
    title: 'TaskPulse — Get paid for real tasks in Nigeria. No deposit, ever.',
    description:
      'Nigerian micro-task marketplace. Complete legit paid surveys, app tests and feedback for businesses. Paid to your bank. Free to join, no deposit ever.',
  },
  '/business': {
    path: '/business',
    lastmod: '2026-10-31',
    title: 'TaskPulse for Businesses — Real Nigerian people. Pay only for approved work.',
    description:
      'Recruit app testers in Nigeria, run surveys and usability testing. You set rewards from ₦50 + 15% fee, fund via Paystack, pay only for approved work.',
  },
  '/packages': {
    path: '/packages',
    lastmod: '2026-10-31',
    title: 'Ready-made packages for businesses — TaskPulse',
    description:
      'Fixed-price packages done by verified Nigerian students: UGC videos, private product feedback, content tests and event coverage. Pay once via Paystack and review every submission.',
  },
  '/terms': {
    path: '/terms',
    lastmod: '2026-10-30',
    title: 'Terms of Service — TaskPulse',
    description: 'The rules for workers and businesses on TaskPulse: earning, withdrawals, referral bonus, campaign fees, refunds and tasks that are not allowed.',
  },
  '/privacy': {
    path: '/privacy',
    lastmod: '2026-10-17',
    title: 'Privacy Policy (NDPA) — TaskPulse',
    description: 'How TaskPulse collects, uses and protects your personal data under the Nigeria Data Protection Act, and how to exercise your rights.',
  },
};

export const canonicalFor = (path: string) => `${SITE_URL}${path === '/' ? '/' : path}`;

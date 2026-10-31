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
  /** Include in sitemap.xml */
  sitemap?: { changefreq: 'daily' | 'weekly' | 'monthly' | 'yearly'; priority: number };
}

export const ROUTE_META: Record<string, RouteMeta> = {
  '/': {
    path: '/',
    title: 'TaskPulse — Get paid for real tasks in Nigeria. No deposit, ever.',
    description:
      'Nigerian micro-task marketplace. Complete legit paid surveys, app tests and feedback for businesses. Paid to your bank. Free to join, no deposit ever.',
    sitemap: { changefreq: 'daily', priority: 1.0 },
  },
  '/business': {
    path: '/business',
    title: 'TaskPulse for Businesses — Real Nigerian people. Pay only for approved work.',
    description:
      'Recruit app testers in Nigeria, run surveys and usability testing. You set rewards from ₦50 + 15% fee, fund via Paystack, pay only for approved work.',
    sitemap: { changefreq: 'weekly', priority: 0.9 },
  },
  '/packages': {
    path: '/packages',
    title: 'Ready-made packages for businesses — TaskPulse',
    description:
      'Fixed-price packages done by verified Nigerian students: UGC videos, private product feedback, content tests and event coverage. Pay once via Paystack and review every submission.',
    sitemap: { changefreq: 'weekly', priority: 0.8 },
  },
  '/terms': {
    path: '/terms',
    title: 'Terms of Service — TaskPulse',
    description: 'The rules for workers and businesses on TaskPulse: earning, withdrawals, referral bonus, campaign fees, refunds and tasks that are not allowed.',
    sitemap: { changefreq: 'monthly', priority: 0.3 },
  },
  '/privacy': {
    path: '/privacy',
    title: 'Privacy Policy (NDPA) — TaskPulse',
    description: 'How TaskPulse collects, uses and protects your personal data under the Nigeria Data Protection Act, and how to exercise your rights.',
    sitemap: { changefreq: 'monthly', priority: 0.3 },
  },
};

export const canonicalFor = (path: string) => `${SITE_URL}${path === '/' ? '/' : path}`;

/**
 * Verification test for build-time SEO prerendering, real 404s, and sitemap.
 * Run: npm run test:prerender
 */
import fs from 'fs';
import path from 'path';
import { canonicalFor, ROUTE_META } from '../../src/lib/seo-routes';

let failed = 0;
const check = (name: string, ok: boolean, info?: unknown) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' ' + JSON.stringify(info)}`);
  if (!ok) failed++;
};

const distDir = path.resolve('dist');

const CORE_PAGES = [
  { path: '/', file: 'index.html', minWords: 300 },
  { path: '/business', file: 'business.html', minWords: 300 },
  { path: '/packages', file: 'packages.html', minWords: 250 },
  { path: '/terms', file: 'terms.html', minWords: 200 },
  { path: '/privacy', file: 'privacy.html', minWords: 100 },
];

for (const { path: routePath, file, minWords } of CORE_PAGES) {
  const filePath = path.join(distDir, file);
  check(`file exists: dist/${file}`, fs.existsSync(filePath));
  if (!fs.existsSync(filePath)) continue;

  const html = fs.readFileSync(filePath, 'utf8');
  const meta = ROUTE_META[routePath];
  const canonicalUrl = canonicalFor(routePath);

  // Canonical tag check
  const hasCanonical = html.includes(`<link rel="canonical" href="${canonicalUrl}"`);
  check(`${file} has canonical www URL ${canonicalUrl}`, hasCanonical);

  // Title check
  const titleMatch = /<title>([^<]*)<\/title>/.exec(html);
  check(`${file} has matching title`, titleMatch?.[1] === meta.title, { got: titleMatch?.[1], want: meta.title });

  // Description check
  const hasDesc = html.includes(`name="description" content="${meta.description}"`);
  check(`${file} has meta description`, hasDesc);

  // Robots index, follow check
  const hasRobots = /<meta name="robots" content="index, follow" \/>/.test(html);
  check(`${file} has robots index, follow`, hasRobots);

  // Body text word count inside #root
  const rootStart = html.indexOf('<div id="root">');
  const rootEnd = html.lastIndexOf('</div>');
  const rootMarkup = rootStart >= 0 && rootEnd > rootStart ? html.slice(rootStart + '<div id="root">'.length, rootEnd) : '';
  const textContent = rootMarkup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const wordCount = textContent.split(' ').filter(Boolean).length;
  check(`${file} has > ${minWords} words inside #root (${wordCount} words)`, wordCount >= minWords, { wordCount, minWords });

  // Links to other core pages
  const targets = ['/', '/business', '/packages', '/terms', '/privacy'];
  for (const t of targets) {
    const hasLink = html.includes(`href="${t}"`);
    check(`${file} has link to ${t}`, hasLink);
  }
}

// 404.html checks
const html404Path = path.join(distDir, '404.html');
check('file exists: dist/404.html', fs.existsSync(html404Path));
if (fs.existsSync(html404Path)) {
  const html404 = fs.readFileSync(html404Path, 'utf8');
  check('404.html has noindex meta', /<meta name="robots" content="noindex, follow" \/>/.test(html404));
  check('404.html has link to /', html404.includes('href="/"'));
  check('404.html has link to /business', html404.includes('href="/business"'));
  check('404.html has link to /packages', html404.includes('href="/packages"'));
  check('404.html has 404 text', html404.includes('404') && /not found/i.test(html404));
}

// sitemap.xml checks
const sitemapPath = path.join(distDir, 'sitemap.xml');
check('file exists: dist/sitemap.xml', fs.existsSync(sitemapPath));
if (fs.existsSync(sitemapPath)) {
  const sitemap = fs.readFileSync(sitemapPath, 'utf8');
  const locs = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map(m => m[1]);
  const expectedLocs = [
    'https://www.taskpulse.website/',
    'https://www.taskpulse.website/business',
    'https://www.taskpulse.website/packages',
    'https://www.taskpulse.website/terms',
    'https://www.taskpulse.website/privacy',
  ];
  check('sitemap.xml has exactly 5 urls', locs.length === 5, locs);
  check('sitemap.xml urls match expected canonical www URLs', JSON.stringify(locs) === JSON.stringify(expectedLocs), locs);

  // Accurate lastmod
  const lastmods = [...sitemap.matchAll(/<lastmod>([^<]*)<\/lastmod>/g)].map(m => m[1]);
  check('sitemap.xml has 5 lastmod dates', lastmods.length === 5);
  check('sitemap.xml all lastmods are YYYY-MM-DD', lastmods.every(d => /^\d{4}-\d{2}-\d{2}$/.test(d)), lastmods);

  // Dropped changefreq and priority
  check('sitemap.xml has no changefreq', !sitemap.includes('<changefreq>'));
  check('sitemap.xml has no priority', !sitemap.includes('<priority>'));
}

// vercel.json checks
const vercel = JSON.parse(fs.readFileSync(path.resolve('vercel.json'), 'utf8'));
const rw = vercel.rewrites || [];
check('vercel.json has trailingSlash: false', vercel.trailingSlash === false);
check('vercel.json has no catch-all rewrite to index.html', !rw.some((r: any) => r.source === '/(.*)'));
check('vercel.json rewrites /business to /business.html', rw.some((r: any) => r.source === '/business' && r.destination === '/business.html'));
check('vercel.json rewrites /packages to /packages.html', rw.some((r: any) => r.source === '/packages' && r.destination === '/packages.html'));
check('vercel.json rewrites /terms to /terms.html', rw.some((r: any) => r.source === '/terms' && r.destination === '/terms.html'));
check('vercel.json rewrites /privacy to /privacy.html', rw.some((r: any) => r.source === '/privacy' && r.destination === '/privacy.html'));

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nAll prerender and SEO checks passed!');

/** Public /packages page helpers. Run: npm run test:public-packages */
import fs from 'fs';
import path from 'path';
import { ANY_PACKAGE, cleanPackageSlug, daysLabel, deliverableFor, packageSignupHref, studentsLabel } from '../../src/lib/publicPackages';
import { normalizePath, PUBLIC_ROUTES } from '../../src/lib/router';
import { ROUTE_META } from '../../src/lib/seo-routes';

let failed = 0;
const check = (name: string, ok: boolean, info?: unknown) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' ' + JSON.stringify(info)}`);
  if (!ok) failed++;
};

// Same proof settings as the live 015 catalog rows.
const cases: [string, Parameters<typeof deliverableFor>[0], string][] = [
  ['UGC videos', { proofType: 'link', description: 'authentic vertical videos', proofRequirements: { format: 'vertical_9_16', delivery: 'raw_file_link' } }, 'Raw video files via share link'],
  ['feedback panel', { proofType: 'screenshot', description: '', proofRequirements: { proof: 'survey_answers_and_usage_screenshot', public_posting: false } }, 'Private survey answers + usage screenshot'],
  ['product seeding', { proofType: 'link', description: '', proofRequirements: { deliverables: '3_photos_1_broll' } }, '3 photos + 1 short video per student, via share link'],
  ['content test', { proofType: 'text', description: '', proofRequirements: { ratings: ['clarity', 'purchase_intent'], public_posting: false } }, 'Private ratings (clarity, purchase intent) + written comments'],
  ['event team', { proofType: 'link', description: '', proofRequirements: { location_checkin: true, raw_footage_transfer: true } }, 'Photos, video clips + attendance notes via share link'],
  ['unknown link', { proofType: 'link', description: '', proofRequirements: null }, 'Files delivered via share link'],
  ['unknown private text', { proofType: 'text', description: '', proofRequirements: { public_posting: false } }, 'Private written answers'],
  ['nothing known', { proofType: null, description: '', proofRequirements: null }, 'Reviewed proof from each student'],
];
for (const [name, input, want] of cases) check(`deliverable: ${name}`, deliverableFor(input) === want, deliverableFor(input));

check('students label', studentsLabel(25) === '25 students' && studentsLabel(1) === '1 student');
check('days label', daysLabel(3) === 'About 3 days' && daysLabel(1) === 'About 1 day' && daysLabel(0) === 'Delivery time varies');

check('slug ok', cleanPackageSlug(' Campus-Feedback-Panel ') === 'campus-feedback-panel');
check('slug any', cleanPackageSlug('*') === ANY_PACKAGE);
check('slug junk rejected', cleanPackageSlug('<script>') === null && cleanPackageSlug('') === null && cleanPackageSlug(null) === null && cleanPackageSlug('a/b') === null);
check('signup href with slug', packageSignupHref('10-local-ugc-reels') === '/?for=business&package=10-local-ugc-reels');
check('signup href without slug', packageSignupHref(null) === '/?for=business&package=*');

check('/packages is a public route', (PUBLIC_ROUTES as readonly string[]).includes('/packages'));
check('/packages normalizes', normalizePath('/Packages/') === '/packages');
check('/packages has head meta', ROUTE_META['/packages']?.path === '/packages');

const vercel = JSON.parse(fs.readFileSync(path.resolve('vercel.json'), 'utf8'));
const rw: { source: string; destination: string }[] = vercel.rewrites;
const iPk = rw.findIndex(r => r.source === '/packages');
const iAll = rw.findIndex(r => r.source === '/(.*)');
check('vercel rewrite /packages -> /packages.html before catch-all', iPk >= 0 && rw[iPk].destination === '/packages.html' && iPk < iAll);

// Never show worker pay on the public page.
const page = fs.readFileSync(path.resolve('src/components/PublicPackagesPage.tsx'), 'utf8');
const lib = fs.readFileSync(path.resolve('src/lib/packages.ts'), 'utf8');
const cols = /PUBLIC_PACKAGE_COLUMNS =\s*'([^']+)'/.exec(lib)?.[1] || '';
check('public query has no reward column', cols.length > 0 && !/reward/.test(cols), cols);
check('public page never mentions reward', !/reward/i.test(page));
check('no urgency / income copy', !/hurry|only \d+ left|limited time|countdown|72h|earn up to|guaranteed/i.test(page));

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall passed');

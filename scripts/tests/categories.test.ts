/** Category mapping + prohibited-task guard (client mirror of 010). Run: npm run test:categories */
import { normalizeCategory, prohibitedTaskReason, TASK_CATEGORIES, CATEGORY_HINTS } from '../../src/config/marketplace';

let failed = 0;
const check = (name: string, ok: boolean, info?: unknown) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' ' + JSON.stringify(info)}`);
  if (!ok) failed++;
};

check('Reviews and Social retired', !(TASK_CATEGORIES as readonly string[]).includes('Reviews') && !(TASK_CATEGORIES as readonly string[]).includes('Social'));
check('every category has a hint', TASK_CATEGORIES.every(c => CATEGORY_HINTS[c]?.length > 10));
check('Reviews -> Product Feedback', normalizeCategory('Reviews') === 'Product Feedback');
check('social -> Community & Content', normalizeCategory('social') === 'Community & Content');
check('empty -> Other', normalizeCategory('') === 'Other' && normalizeCategory(null) === 'Other');
check('Surveys kept', normalizeCategory('Surveys') === 'Surveys');

// Same cases as supabase/tests/50_categories_010.sql
const blocked: [string, string, string][] = [
  ['Rate us', 'Leave a 5-star review for our shop', 'public_review'],
  ['Reviews', 'Write a review on Google Maps for our restaurant', 'public_review'],
  ['Jumia', 'Give our product a Jumia review after you buy', 'public_review'],
  ['Rate app', 'Rate our app on the Play Store and screenshot', 'public_review'],
  ['Follow', 'Follow us on Instagram and send a screenshot', 'social_engagement'],
  ['Grow', 'Help us gain 1000 followers this week please', 'social_engagement'],
  ['Like', 'Like and share our page then screenshot it', 'social_engagement'],
  ['Sub', 'Subscribe to our YouTube channel and comment', 'social_engagement'],
  ['Fake', 'We need fake reviews for launch day', 'fake_engagement'],
];
for (const [t, i, want] of blocked) check(`blocked: ${i}`, prohibitedTaskReason(t, i) === want, prohibitedTaskReason(t, i));

const allowed: [string, string][] = [
  ['Quick survey', 'Follow the steps below and answer 10 questions honestly'],
  ['App test', 'Download the app from the Play Store, sign up and tell us what you like the most'],
  ['Feedback', 'Share your honest private feedback in our form. Do not post it publicly.'],
  ['Community', 'Join our WhatsApp community for students and introduce yourself'],
  ['Content', 'Watch our 2 minute video and tell us which part was confusing'],
];
for (const [t, i] of allowed) check(`allowed: ${i}`, prohibitedTaskReason(t, i) === null, prohibitedTaskReason(t, i));

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log('category tests: PASS');

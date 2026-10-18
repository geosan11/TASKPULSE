/** Approval-mode rules (client mirror of resolve_approval_mode() in 011). Run: npm run test:approvals */
import { approvalModeCopy, approvalModeOptions, instantWindowHours, reviewWindowsFrom, timeLeftLabel, DEFAULT_MARKETPLACE_SETTINGS } from '../../src/config/marketplace';

let failed = 0;
const check = (name: string, ok: boolean, info?: unknown) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' ' + JSON.stringify(info)}`);
  if (!ok) failed++;
};

const o = (category: any, proofType: any, hasCode: boolean, hasTargetUrl = false) =>
  approvalModeOptions({ category, proofType, hasCode, hasTargetUrl });

check('Surveys + code -> instant default', o('Surveys', 'text', true).defaultMode === 'instant');
check('App Tests + code -> instant default', o('App Tests', 'screenshot', true).defaultMode === 'instant');
check('App Tests screenshot, no code -> auto', o('App Tests', 'screenshot', false).defaultMode === 'auto');
check('App Tests screenshot, no code -> instant not allowed', !o('App Tests', 'screenshot', false).allowed.includes('instant'));
check('Community link + target -> auto default, instant allowed', o('Community & Content', 'link', false, true).defaultMode === 'auto' && o('Community & Content', 'link', false, true).allowed.includes('instant'));
for (const c of ['Product Feedback', 'Field Audits', 'Other']) {
  const r = o(c, 'text', true, true);
  check(`${c}: never instant, default auto`, !r.allowed.includes('instant') && r.defaultMode === 'auto' && !!r.instantBlockedReason, r);
}
check('manual always allowed', ['Surveys', 'Field Audits', 'Other'].every(c => o(c, 'text', false).allowed.includes('manual')));

check('auto window default 24h', DEFAULT_MARKETPLACE_SETTINGS.reviewWindowAutoHours === 24);
check('human window default 48h', DEFAULT_MARKETPLACE_SETTINGS.reviewWindowHumanHours === 48);
check('hold flagged default off', DEFAULT_MARKETPLACE_SETTINGS.holdFlaggedForReview === false);
const W = reviewWindowsFrom(DEFAULT_MARKETPLACE_SETTINGS);
check('instant text/link -> 24h, screenshot -> 48h', instantWindowHours('text', W) === 24 && instantWindowHours('link', W) === 24 && instantWindowHours('screenshot', W) === 48);
check('mode names have no hours', !JSON.stringify(approvalModeOptions({ category: 'Surveys', proofType: 'text', hasCode: true, hasTargetUrl: false })).includes('24'));
check('trusted after 3', DEFAULT_MARKETPLACE_SETTINGS.trustedAfterTasks === 3);
check('human review above 1000', DEFAULT_MARKETPLACE_SETTINGS.humanReviewRewardAbove === 1000);
check('auto copy uses the human window', approvalModeCopy('auto', W).body.includes('48h'));
check('instant copy names both windows', approvalModeCopy('instant', W).body.includes('24h') && approvalModeCopy('instant', W).body.includes('48h'));
check('copy follows settings', approvalModeCopy('manual', { autoHours: 6, humanHours: 12, holdFlagged: false }).body.includes('12h'));
check('manual copy says same rule', /same/i.test(approvalModeCopy('manual', W).body));
check('flagged copy: auto-approve when off', /also approved after 48h/.test(approvalModeCopy('auto', W).body));
check('flagged copy: wait when on', /never approved automatically/.test(approvalModeCopy('auto', { ...W, holdFlagged: true }).body));

const now = Date.parse('2026-10-18T12:00:00Z');
check('timeLeft 23h30m -> 24h', timeLeftLabel('2026-10-19T11:30:00Z', now) === '24h');
check('timeLeft 45m', timeLeftLabel('2026-10-18T12:45:00Z', now) === '45m');
check('timeLeft past -> now', timeLeftLabel('2026-10-18T11:00:00Z', now) === 'now');
check('timeLeft null -> empty', timeLeftLabel(null, now) === '');

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log('approval tests: PASS');

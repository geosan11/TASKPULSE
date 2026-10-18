/** Approval-mode rules (client mirror of resolve_approval_mode() in 011). Run: npm run test:approvals */
import { approvalModeCopy, approvalModeOptions, timeLeftLabel, DEFAULT_MARKETPLACE_SETTINGS } from '../../src/config/marketplace';

let failed = 0;
const check = (name: string, ok: boolean, info?: unknown) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' ' + JSON.stringify(info)}`);
  if (!ok) failed++;
};

const o = (category: any, proofType: any, hasCode: boolean, hasTargetUrl = false) =>
  approvalModeOptions({ category, proofType, hasCode, hasTargetUrl });

check('Surveys + code -> instant default', o('Surveys', 'text', true).defaultMode === 'instant');
check('App Tests + code -> instant default', o('App Tests', 'screenshot', true).defaultMode === 'instant');
check('App Tests screenshot, no code -> auto', o('App Tests', 'screenshot', false).defaultMode === 'auto_24h');
check('App Tests screenshot, no code -> instant not allowed', !o('App Tests', 'screenshot', false).allowed.includes('instant'));
check('Community link + target -> auto default, instant allowed', o('Community & Content', 'link', false, true).defaultMode === 'auto_24h' && o('Community & Content', 'link', false, true).allowed.includes('instant'));
for (const c of ['Product Feedback', 'Field Audits', 'Other']) {
  const r = o(c, 'text', true, true);
  check(`${c}: never instant, default auto`, !r.allowed.includes('instant') && r.defaultMode === 'auto_24h' && !!r.instantBlockedReason, r);
}
check('manual always allowed', ['Surveys', 'Field Audits', 'Other'].every(c => o(c, 'text', false).allowed.includes('manual')));

check('window default 24h', DEFAULT_MARKETPLACE_SETTINGS.reviewWindowHours === 24);
check('trusted after 3', DEFAULT_MARKETPLACE_SETTINGS.trustedAfterTasks === 3);
check('human review above 1000', DEFAULT_MARKETPLACE_SETTINGS.humanReviewRewardAbove === 1000);
check('copy uses the setting', approvalModeCopy('auto_24h', 24).body.includes('24h') && approvalModeCopy('manual', 12).body.includes('12h'));
check('manual copy says same rule', /same/i.test(approvalModeCopy('manual', 24).body));

const now = Date.parse('2026-10-18T12:00:00Z');
check('timeLeft 23h30m -> 24h', timeLeftLabel('2026-10-19T11:30:00Z', now) === '24h');
check('timeLeft 45m', timeLeftLabel('2026-10-18T12:45:00Z', now) === '45m');
check('timeLeft past -> now', timeLeftLabel('2026-10-18T11:00:00Z', now) === 'now');
check('timeLeft null -> empty', timeLeftLabel(null, now) === '');

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log('approval tests: PASS');

/** Going-international note + signup source. Run: npx tsx scripts/tests/intl-launch.test.ts */
import { dismissKey, formatRemaining, msToNextMinute, parseLaunchAt } from '../../src/lib/launchCountdown';
import { INTERNATIONAL_LAUNCH_AT, INTL_COPY } from '../../src/config/launch';

let failed = 0;
const check = (name: string, ok: boolean, info?: unknown) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : ' ' + JSON.stringify(info)}`);
  if (!ok) failed++;
};

// Minimal localStorage + window for signupSource (node has neither).
const mem = new Map<string, string>();
(globalThis as any).window = {
  localStorage: {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
  },
  location: { search: '' },
};
const { captureSignupSource, readSignupSource, signupSourceMetadata } = await import('../../src/lib/signupSource');

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
check('default launch date is null (dateless line)', INTERNATIONAL_LAUNCH_AT === null);
check('parse null -> null', parseLaunchAt(null) === null && parseLaunchAt('') === null && parseLaunchAt('nope') === null);
const target = parseLaunchAt('2026-11-01T00:00:00+01:00')!;
check('parse WAT target', target === Date.UTC(2026, 9, 31, 23, 0, 0), target);
const from = Date.parse('2026-10-18T19:16:00+01:00');
check('13d 4h from 18 Oct 19:16 WAT', formatRemaining(target - from) === '13d 4h', formatRemaining(target - from));
check('business days only', formatRemaining(target - from, { daysOnly: true }) === '13d');
check('under a day -> h m', formatRemaining(5 * HOUR + 12 * MIN + 30_000) === '5h 12m');
check('under an hour -> m', formatRemaining(12 * MIN) === '12m' && formatRemaining(10_000) === '1m');
check('exactly 1 day', formatRemaining(DAY) === '1d 0h');
check('passed -> null', formatRemaining(0) === null && formatRemaining(-5) === null);
check('next minute alignment', msToNextMinute(Date.UTC(2026, 0, 1, 0, 0, 59, 500)) === 1000 && msToNextMinute(Date.UTC(2026, 0, 1, 0, 0, 15)) === 45_000);
check('dismiss key differs by date and audience',
  dismissKey('worker', null) !== dismissKey('worker', '2026-11-01T00:00:00+01:00') && dismissKey('worker', null) !== dismissKey('business', null));

// Copy guard: no promises we must not make.
const all = Object.values(INTL_COPY).map(c => `${c.line} ${c.lineCompact ?? ''} ${c.countdownLine} ${c.sheetTitle} ${c.sheetBody}`).join(' ').toLowerCase();
check('copy: no dollar payouts', !/dollar|usd|\$/.test(all));
check('copy: no foreign workers', !/workers? (from|outside|abroad)|join from anywhere/.test(all));
check('copy: exact lines', INTL_COPY.worker.line === 'TaskPulse is going international' && INTL_COPY.business.line === 'TaskPulse is opening to businesses worldwide');
check('copy: exact titles', INTL_COPY.worker.sheetTitle === 'TaskPulse is going international' && INTL_COPY.business.sheetTitle === 'TaskPulse is going international');
check('copy: no dates in dateless copy', !/november|two weeks|\b\d+\s*(d|days?)\b/i.test(all));
check('business compact line', INTL_COPY.business.lineCompact === 'Going worldwide' && INTL_COPY.worker.lineCompact === undefined);
check('countdown template has {time}', INTL_COPY.worker.countdownLine.includes('{time}') && INTL_COPY.business.countdownLine.includes('{time}'));

// Signup source: first touch, 30 days.
const t0 = Date.parse('2026-10-18T12:00:00Z');
check('no utm -> nothing stored', captureSignupSource('?ref=TP-X', t0) === null && mem.size === 0);
check('no record -> empty metadata', Object.keys(signupSourceMetadata(t0)).length === 0);
captureSignupSource('?utm_source=telegram&utm_medium=bot&utm_campaign=launch%20oct', t0);
const r = readSignupSource(t0)!;
check('captured', r.source === 'telegram' && r.medium === 'bot' && r.campaign === 'launch oct', r);
captureSignupSource('?utm_source=x.com', t0 + DAY);
check('first touch wins', readSignupSource(t0 + DAY)!.source === 'telegram');
const md = signupSourceMetadata(t0 + DAY);
check('metadata keys', md.signup_source === 'telegram' && md.signup_medium === 'bot' && md.signup_campaign === 'launch oct' && !!md.signup_source_captured_at, md);
check('expires after 30 days', readSignupSource(t0 + 31 * DAY) === null);
captureSignupSource('?utm_source=x.com', t0 + 31 * DAY);
check('new touch after expiry', readSignupSource(t0 + 31 * DAY)!.source === 'x.com');
mem.clear();
captureSignupSource('?utm_source=%3Cscript%3E' + 'a'.repeat(300), t0);
const s = readSignupSource(t0)!.source!;
check('sanitised + capped', !s.includes('<') && s.length <= 100, s);
mem.set('taskpulse_signup_source_v1', '{bad json');
check('corrupt record ignored', readSignupSource(t0) === null);

console.log(failed ? `\n${failed} FAILED` : '\nAll intl-launch checks passed');
process.exit(failed ? 1 : 0);

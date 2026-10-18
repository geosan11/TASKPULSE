/**
 * "Going international" note (worker Home + /business). All copy lives here.
 *
 * INTERNATIONAL_LAUNCH_AT is null for now, which shows the quiet, dateless
 * line. Set it to an ISO timestamp with an offset, e.g.
 * '2026-11-01T00:00:00+01:00' (WAT), to turn the dormant countdown on
 * ("Going international in 13d 4h"); once that moment passes the line hides
 * itself. Changing the value also resets earlier dismissals.
 */
export const INTERNATIONAL_LAUNCH_AT: string | null = null;

export type IntlAudience = 'worker' | 'business';

export const INTL_COPY: Record<
  IntlAudience,
  {
    /** Line shown while INTERNATIONAL_LAUNCH_AT is null (sm and up when lineCompact is set). */
    line: string;
    /** Optional shorter dateless line used below the sm breakpoint (640px). */
    lineCompact?: string;
    /** Line shown when a date is set; {time} becomes "13d 4h" (worker) or "13d" (business). */
    countdownLine: string;
    readMore: string;
    sheetTitle: string;
    sheetBody: string;
    sheetButton: string;
  }
> = {
  worker: {
    line: 'TaskPulse is going international',
    countdownLine: 'Going international in {time}',
    readMore: 'Read more',
    sheetTitle: 'TaskPulse is going international',
    sheetBody:
      "Soon, businesses outside Nigeria will post tasks here too, so there'll be more tasks and more ways to earn, still paid to your Nigerian bank. " +
      'You got us here. Every task you finish and every friend you invite brings it closer. No deposit, ever.',
    sheetButton: 'Got it',
  },
  business: {
    line: 'TaskPulse is opening to businesses worldwide',
    lineCompact: 'Going worldwide',
    countdownLine: 'Going international in {time}',
    readMore: 'Read more',
    sheetTitle: 'TaskPulse is going international',
    sheetBody:
      'Reach real Nigerian users for app tests, surveys and market feedback, and pay only for approved work. ' +
      'Join early and your first campaign has zero platform fee.',
    sheetButton: 'Got it',
  },
};

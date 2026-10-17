/** Fire a full-screen success moment (mascot + confetti). Handled by <Celebration /> in App. */
export interface CelebrationDetail {
  title: string;
  subtitle?: string;
}

export const CELEBRATE_EVENT = 'taskpulse:celebrate';

export function celebrate(title: string, subtitle?: string) {
  window.dispatchEvent(new CustomEvent<CelebrationDetail>(CELEBRATE_EVENT, { detail: { title, subtitle } }));
}

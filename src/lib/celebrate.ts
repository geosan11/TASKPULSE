import type { EmoteName } from '../components/PulseEmote';
import { claimMoment } from './motion';

/** Fire a full-screen success moment. Handled by <Celebration /> in App. */
export interface CelebrationDetail {
  title: string;
  subtitle?: string;
  /** Emote shown first. */
  emote?: EmoteName;
  /** Optional second emote it pops into (e.g. excited, then clap). */
  then?: EmoteName;
  effect?: 'confetti' | 'hearts' | 'check' | 'bob' | 'none';
}

export const CELEBRATE_EVENT = 'taskpulse:celebrate';

/**
 * Show a celebration. With `id`, it plays at most once per event
 * (seen flag in localStorage), so reloads never replay it.
 */
export function celebrate(title: string, subtitle?: string, opts: Omit<CelebrationDetail, 'title' | 'subtitle'> & { id?: string } = {}): boolean {
  const { id, ...rest } = opts;
  if (id && !claimMoment(`celebrate:${id}`)) return false;
  window.dispatchEvent(new CustomEvent<CelebrationDetail>(CELEBRATE_EVENT, { detail: { title, subtitle, ...rest } }));
  return true;
}

/** Reward / approval toast: count-up of the ₦ amount and a coin into the balance. */
export interface RewardDetail {
  title: string;
  subtitle?: string;
  amount: number;
  emote?: EmoteName;
}

export const REWARD_EVENT = 'taskpulse:reward';

export function showReward(detail: RewardDetail, id?: string): boolean {
  if (id && !claimMoment(`reward:${id}`)) return false;
  window.dispatchEvent(new CustomEvent<RewardDetail>(REWARD_EVENT, { detail }));
  return true;
}

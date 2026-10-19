import { useCallback, useEffect, useState } from 'react';
import type { DbTask } from './supabaseClient';
import type { MySubmission, TxItem } from '../types';
import { hasSeen, markSeen } from './motion';
import { celebrate, showReward } from './celebrate';
import { formatNaira } from '../config/marketplace';

const SETTLED = ['settled', 'success', 'successful', 'completed', 'paid'];

/**
 * Turns fresh account data into one-time moments: approval toasts, the
 * referral-bonus celebration and the "proof rejected" notice. The very first
 * load on a device only records what already exists, so nothing old replays.
 */
export function useMoments({
  userId,
  ready,
  submissions,
  transactions,
}: {
  userId: string | null;
  ready: boolean;
  submissions: MySubmission[];
  transactions: TxItem[];
}) {
  const [rejected, setRejected] = useState<MySubmission[]>([]);

  useEffect(() => {
    if (!userId || !ready) return;
    const approved = submissions.filter(s => s.status === 'approved');
    const rejectedAll = submissions.filter(s => s.status === 'rejected');
    const referrals = transactions.filter(t => t.type.toLowerCase() === 'referral_bonus' && SETTLED.includes(t.status.toLowerCase()) && t.amount > 0);
    const aId = (s: MySubmission) => `approved:${s.id}`;
    const rId = (s: MySubmission) => `rejected:${s.id}`;
    const fId = (t: TxItem) => `referral:${t.id}`;

    const initKey = `moments-init:${userId}`;
    if (!hasSeen(initKey)) {
      markSeen(initKey, ...approved.map(aId), ...rejectedAll.map(rId), ...referrals.map(fId));
      setRejected([]);
      return;
    }

    const newApproved = approved.filter(s => !hasSeen(aId(s)));
    if (newApproved.length) {
      markSeen(...newApproved.map(aId));
      const total = newApproved.reduce((n, s) => n + (s.paidAmount ?? s.reward), 0);
      showReward({
        title: newApproved.length === 1 ? 'Task approved!' : `${newApproved.length} tasks approved!`,
        subtitle: newApproved.length === 1 ? newApproved[0].taskTitle : 'Added to your balance',
        amount: total,
        emote: 'success',
      });
    }

    const newRefs = referrals.filter(t => !hasSeen(fId(t)));
    if (newRefs.length) {
      markSeen(...newRefs.map(fId));
      const total = newRefs.reduce((n, t) => n + t.amount, 0);
      celebrate(`${formatNaira(total)} referral bonus!`, 'Someone you invited finished their tasks. Thanks for spreading the word.', {
        emote: 'love',
        effect: 'hearts',
      });
    }

    setRejected(rejectedAll.filter(s => !hasSeen(rId(s))));
  }, [userId, ready, submissions, transactions]);

  const dismissRejected = useCallback((id: string) => {
    markSeen(`rejected:${id}`);
    setRejected(r => r.filter(x => x.id !== id));
  }, []);

  return { rejected, dismissRejected };
}

const TASKS_KEY = (uid: string) => `taskpulse_seen_tasks:${uid}`;

/** How many open tasks appeared since this device last saw the task list (0 on first visit). */
export function useNewTaskCount(userId: string | null, tasksLoaded: boolean, tasks: DbTask[]) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!userId || !tasksLoaded) return;
    let stored: string[] | null = null;
    try {
      const raw = localStorage.getItem(TASKS_KEY(userId));
      stored = raw ? JSON.parse(raw) : null;
    } catch {
      stored = null;
    }
    const ids = tasks.map(t => t.id);
    const fresh = stored ? ids.filter(id => !stored!.includes(id)) : [];
    if (fresh.length) setCount(c => c + fresh.length);
    try {
      localStorage.setItem(TASKS_KEY(userId), JSON.stringify(Array.from(new Set([...(stored || []), ...ids])).slice(-300)));
    } catch {
      /* storage blocked */
    }
  }, [userId, tasksLoaded, tasks]);
  return [count, () => setCount(0)] as const;
}

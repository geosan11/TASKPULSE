import { useEffect, useState } from 'react';
import { primaryButtonClass } from './ui';
import { PulseEmote, type EmoteAnimation } from './PulseEmote';
import { triggerConfetti } from '../utils/confetti';
import { prefersReducedMotion } from '../lib/motion';
import { CELEBRATE_EVENT, type CelebrationDetail } from '../lib/celebrate';

const HEARTS = [
  { left: '18%', dx: '-14px', delay: '0ms' },
  { left: '34%', dx: '6px', delay: '120ms' },
  { left: '52%', dx: '-6px', delay: '60ms' },
  { left: '68%', dx: '12px', delay: '180ms' },
  { left: '82%', dx: '-10px', delay: '90ms' },
];

/** Full-screen success moment: a Pulse emote that pops in, plus a short effect. */
export function Celebration() {
  const [detail, setDetail] = useState<CelebrationDetail | null>(null);
  const [second, setSecond] = useState(false);
  const [run, setRun] = useState(0);

  useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent<CelebrationDetail>).detail;
      const reduced = prefersReducedMotion();
      setDetail(d);
      setSecond(Boolean(d.then) && reduced);
      setRun(r => r + 1);
      if (d.effect === 'confetti') triggerConfetti({ y: 0.38 });
    };
    window.addEventListener(CELEBRATE_EVENT, handler);
    return () => window.removeEventListener(CELEBRATE_EVENT, handler);
  }, []);

  // Excited -> Clapping style hand-off, ~0.5s in.
  useEffect(() => {
    if (!detail?.then || second) return;
    const t = window.setTimeout(() => setSecond(true), 520);
    return () => window.clearTimeout(t);
  }, [detail, second, run]);

  if (!detail) return null;
  const close = () => setDetail(null);
  const emote = second && detail.then ? detail.then : detail.emote || 'success';
  const showCheck = detail.effect === 'check' && emote === 'done';
  const anim: EmoteAnimation = showCheck ? 'draw-check' : detail.effect === 'bob' ? 'bob' : 'pop';

  return (
    <div className="fixed inset-0 z-[90] bg-ink/70 backdrop-blur-sm flex items-center justify-center p-6" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={detail.title}
        onClick={e => e.stopPropagation()}
        className="animate-pop-in w-full max-w-xs rounded-[32px] bg-white dark:bg-ink border border-zinc-200 dark:border-zinc-800 p-6 text-center space-y-3"
      >
        <div className="relative mx-auto w-36 h-36">
          <PulseEmote key={`${run}-${emote}`} name={emote} size={144} animate={anim} eager className={showCheck ? 'pe-pop' : ''} />
          {/* Preload the second emote so the hand-off doesn't flash. */}
          {detail.then && !second && <PulseEmote name={detail.then} size={1} eager alt="" className="absolute opacity-0" />}
          {detail.effect === 'hearts' &&
            HEARTS.map((h, i) => (
              <svg
                key={`${run}-${i}`}
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="heart-float absolute bottom-6 w-5 h-5 text-pulse-500"
                style={{ left: h.left, animationDelay: h.delay, ['--dx' as string]: h.dx }}
              >
                <path fill="currentColor" d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 5 6.4 5c2 0 3.5 1.1 4.3 2.5h2.6C14.1 6.1 15.6 5 17.6 5 21 5 23.1 8.4 21.6 11.8 19.5 16.4 12 21 12 21z" />
              </svg>
            ))}
        </div>
        <h3 className="text-2xl font-extrabold text-ink dark:text-white">{detail.title}</h3>
        {detail.subtitle && <p className="text-sm text-zinc-500 dark:text-zinc-400">{detail.subtitle}</p>}
        <div className="pt-2">
          <button type="button" className={primaryButtonClass} onClick={close}>
            Nice!
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Mascot, primaryButtonClass } from './ui';
import { triggerConfetti } from '../utils/confetti';
import { CELEBRATE_EVENT, type CelebrationDetail } from '../lib/celebrate';

/** Full-screen success moment: mascot-celebrating + green/black/white confetti. */
export function Celebration() {
  const [detail, setDetail] = useState<CelebrationDetail | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      setDetail((e as CustomEvent<CelebrationDetail>).detail);
      triggerConfetti();
    };
    window.addEventListener(CELEBRATE_EVENT, handler);
    return () => window.removeEventListener(CELEBRATE_EVENT, handler);
  }, []);

  if (!detail) return null;
  return (
    <div className="fixed inset-0 z-[90] bg-ink/70 backdrop-blur-sm flex items-center justify-center p-6" onClick={() => setDetail(null)}>
      <div
        onClick={e => e.stopPropagation()}
        className="animate-pop-in w-full max-w-xs rounded-[32px] bg-white dark:bg-ink border border-zinc-200 dark:border-zinc-800 p-6 text-center space-y-3"
      >
        <Mascot pose="celebrating" className="w-36 h-36 mx-auto" bob />
        <h3 className="text-2xl font-extrabold text-ink dark:text-white">{detail.title}</h3>
        {detail.subtitle && <p className="text-sm text-zinc-500 dark:text-zinc-400">{detail.subtitle}</p>}
        <div className="pt-2">
          <button type="button" className={primaryButtonClass} onClick={() => setDetail(null)}>
            Nice!
          </button>
        </div>
      </div>
    </div>
  );
}

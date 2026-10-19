import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { PulseEmote } from './PulseEmote';
import { REWARD_EVENT, type RewardDetail } from '../lib/celebrate';
import { prefersReducedMotion, useCountUp } from '../lib/motion';
import { formatNaira } from '../config/marketplace';

const SPARKS = [
  { dx: '-26px', dy: '-22px' },
  { dx: '24px', dy: '-26px' },
  { dx: '30px', dy: '8px' },
  { dx: '-30px', dy: '10px' },
  { dx: '2px', dy: '-34px' },
  { dx: '14px', dy: '28px' },
];

/** Fly a small ₦ coin from `from` into the first visible balance on screen. */
function flyCoin(from: DOMRect) {
  if (prefersReducedMotion()) return;
  const target = Array.from(document.querySelectorAll<HTMLElement>('[data-coin-target]')).find(el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.bottom > 0 && r.top < window.innerHeight;
  });
  if (!target || typeof document.body.animate !== 'function') return;
  const to = target.getBoundingClientRect();
  const coin = document.createElement('div');
  coin.setAttribute('aria-hidden', 'true');
  coin.textContent = '₦';
  Object.assign(coin.style, {
    position: 'fixed',
    left: `${from.left + from.width / 2 - 14}px`,
    top: `${from.top + from.height / 2 - 14}px`,
    width: '28px',
    height: '28px',
    borderRadius: '9999px',
    background: 'radial-gradient(circle at 35% 30%, #b9f6ca, #00c853 60%, #00702e)',
    color: '#0a0a0a',
    font: '800 14px/28px "Plus Jakarta Sans", sans-serif',
    textAlign: 'center',
    boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
    zIndex: '101',
    pointerEvents: 'none',
  });
  document.body.appendChild(coin);
  const dx = to.left + Math.min(to.width, 120) / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const anim = coin.animate(
    [
      { transform: 'translate(0,0) scale(0.6)', opacity: 0.6, easing: 'cubic-bezier(0.2, 0.8, 0.4, 1)' },
      { transform: `translate(${dx * 0.3}px, ${dy * 0.25 + 18}px) scale(1.15)`, opacity: 1, offset: 0.3, easing: 'cubic-bezier(0.6, 0, 0.8, 0.4)' },
      { transform: `translate(${dx}px, ${dy}px) scale(0.55)`, opacity: 0.35 },
    ],
    { duration: 750, delay: 120, fill: 'both' }
  );
  anim.onfinish = () => {
    coin.remove();
    target.animate?.([{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
  };
}

function CountNaira({ amount }: { amount: number }) {
  return <>{formatNaira(useCountUp(amount, { from: 0, ms: 750 }))}</>;
}

/** Top toast for "task approved" / "reward credited": emote, ₦ count-up, sparkles, coin. */
export function RewardToast() {
  const [detail, setDetail] = useState<RewardDetail | null>(null);
  const [run, setRun] = useState(0);
  const [show, setShow] = useState(false);
  const emoteRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const on = (e: Event) => {
      setDetail((e as CustomEvent<RewardDetail>).detail);
      setRun(r => r + 1);
      setShow(true);
      window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setShow(false), 4800);
    };
    window.addEventListener(REWARD_EVENT, on);
    return () => window.removeEventListener(REWARD_EVENT, on);
  }, []);

  useEffect(() => {
    if (!run || !emoteRef.current) return;
    flyCoin(emoteRef.current.getBoundingClientRect());
  }, [run]);

  if (!detail) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      aria-hidden={!show}
      className={`fixed top-3 left-1/2 -translate-x-1/2 z-[100] w-full max-w-sm px-4 transition-all duration-300 ease-out motion-reduce:transition-none ${
        show ? 'translate-y-0 opacity-100' : '-translate-y-6 opacity-0 pointer-events-none'
      }`}
    >
      <div className="bg-ink text-white dark:bg-white dark:text-ink rounded-2xl py-2.5 pl-2.5 pr-3 shadow-xl flex items-center gap-3">
        <div ref={emoteRef} className="relative w-14 h-14 shrink-0">
          <PulseEmote key={run} name={detail.emote || 'success'} size={56} animate="pop" eager alt="" />
          {SPARKS.map((s, i) => (
            <span
              key={`${run}-${i}`}
              aria-hidden="true"
              className="sparkle absolute left-1/2 top-1/2 -ml-1 -mt-1 w-2 h-2 rotate-45 rounded-[2px] bg-pulse-400"
              style={{ ['--dx' as string]: s.dx, ['--dy' as string]: s.dy, animationDelay: `${i * 40}ms` }}
            />
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold leading-tight truncate">{detail.title}</p>
          {detail.subtitle && <p className="text-xs text-zinc-400 dark:text-zinc-500 leading-snug truncate mt-0.5">{detail.subtitle}</p>}
        </div>
        <p className="text-lg font-extrabold text-pulse-400 dark:text-pulse-700 tabular-nums shrink-0" aria-label={`plus ${formatNaira(detail.amount)}`}>
          +<CountNaira key={run} amount={detail.amount} />
        </p>
        <button type="button" onClick={() => setShow(false)} aria-label="Dismiss" tabIndex={show ? 0 : -1} className="w-7 h-7 rounded-full flex items-center justify-center text-zinc-400 shrink-0 cursor-pointer">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

import { prefersReducedMotion } from '../lib/motion';

/**
 * Tiny canvas confetti burst (no dependency). About 0.9s end to end,
 * Pulse green / black / white. Does nothing under reduced motion.
 */
export function triggerConfetti({ x = 0.5, y = 0.4, count = 46 }: { x?: number; y?: number; count?: number } = {}) {
  if (typeof document === 'undefined' || prefersReducedMotion()) return;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: '99999' });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return;
  }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  ctx.scale(dpr, dpr);

  const colors = ['#00C853', '#00C853', '#1FCE69', '#0A0A0A', '#FFFFFF'];
  const ox = window.innerWidth * x;
  const oy = window.innerHeight * y;
  const parts = Array.from({ length: count }, () => {
    const a = Math.random() * Math.PI * 2;
    const v = 4 + Math.random() * 7;
    return {
      x: ox,
      y: oy,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v - 4,
      s: 4 + Math.random() * 6,
      r: Math.random() * 360,
      vr: (Math.random() - 0.5) * 14,
      c: colors[(Math.random() * colors.length) | 0],
    };
  });

  const DURATION = 900;
  const start = performance.now();
  const frame = (now: number) => {
    const t = now - start;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    const alpha = t < 500 ? 1 : Math.max(0, 1 - (t - 500) / (DURATION - 500));
    for (const p of parts) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.32;
      p.vx *= 0.97;
      p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.r * Math.PI) / 180);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.c;
      ctx.strokeStyle = 'rgba(10,10,10,0.25)';
      ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
      if (p.c === '#FFFFFF') ctx.strokeRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
      ctx.restore();
    }
    if (t < DURATION) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

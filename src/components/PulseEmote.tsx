/**
 * Pulse, the TaskPulse mascot, as small transparent WebP emotes
 * (public/brand/emotes, about 15 KB each). Lazy-loaded, fixed width/height
 * so nothing shifts, and every animation is off under prefers-reduced-motion.
 */
export const EMOTES = {
  wink: 'Pulse winking',
  excited: 'Pulse looking excited',
  success: 'Pulse celebrating a finished task',
  tired: 'Pulse looking tired',
  idea: 'Pulse with a lightbulb idea',
  clap: 'Pulse clapping',
  love: 'Pulse with heart eyes',
  shocked: 'Pulse looking surprised',
  determined: 'Pulse looking determined',
  searching: 'Pulse checking with a magnifier',
  sad: 'Pulse looking sad',
  done: 'Pulse with a check mark',
} as const;

export type EmoteName = keyof typeof EMOTES;

/** Natural pixel size of each file (all are 288px on the long side). */
const DIMS: Record<EmoteName, [number, number]> = {
  wink: [287, 288],
  excited: [267, 288],
  success: [288, 287],
  tired: [265, 288],
  idea: [285, 288],
  clap: [257, 288],
  love: [279, 288],
  shocked: [274, 288],
  determined: [285, 288],
  searching: [270, 288],
  sad: [245, 288],
  done: [269, 288],
};

export type EmoteAnimation = 'none' | 'pop' | 'bob' | 'blink' | 'draw-check';

export function PulseEmote({
  name,
  size = 96,
  animate = 'none',
  alt,
  className = '',
  eager = false,
}: {
  name: EmoteName;
  size?: number;
  animate?: EmoteAnimation;
  /** Pass "" for purely decorative use next to text that says the same thing. */
  alt?: string;
  className?: string;
  eager?: boolean;
}) {
  const [w, h] = DIMS[name];
  const label = alt ?? EMOTES[name];
  const motionClass = animate === 'pop' ? 'pe-pop' : animate === 'bob' ? 'pe-bob' : '';
  const img = (
    <img
      src={`/brand/emotes/${name}.webp`}
      width={size}
      height={size}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      alt={label}
      aria-hidden={label === '' ? true : undefined}
      draggable={false}
      className={`object-contain select-none ${animate === 'draw-check' || animate === 'blink' ? '' : `${motionClass} ${className}`}`}
      style={{ width: size, height: size }}
    />
  );
  if (animate !== 'draw-check' && animate !== 'blink') return img;

  // Overlays are drawn in the image's own pixel space, so they line up at any size.
  return (
    <span className={`relative inline-block shrink-0 ${className}`} style={{ width: size, height: size }}>
      {img}
      <svg aria-hidden="true" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 w-full h-full pointer-events-none">
        {animate === 'draw-check' ? (
          <g className="pe-check">
            {/* Repaint the badge, then draw its tick in. */}
            <circle cx="213" cy="200" r="41" fill="#27c85d" />
            <path d="M191 201 L206 216 L235 185" fill="none" stroke="#fff" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" pathLength={1} />
          </g>
        ) : (
          <>
            <defs>
              <radialGradient id="pe-bulb-glow">
                <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
                <stop offset="0.45" stopColor="#b9f6ca" stopOpacity="0.7" />
                <stop offset="1" stopColor="#00c853" stopOpacity="0" />
              </radialGradient>
            </defs>
            <circle className="pe-blink" cx="236" cy="46" r="40" fill="url(#pe-bulb-glow)" />
          </>
        )}
      </svg>
    </span>
  );
}

/**
 * Mono — the Monolith mascot, as a static inline SVG for in-app empty states.
 *
 * The geometry is the landing mascot's (`landing/assembly-mono/avatar.js`):
 * the same shell, screen and belt curves, the same eye positions and tilt, in
 * its own coordinate space. The canvas gradients and glow are dropped — every
 * fill here is a semantic token, so Mono follows each theme preset and both
 * light and dark with no per-theme art.
 *
 * Decorative (`aria-hidden`) and server-renderable. It belongs in empty states
 * only — never in tables, toolbars or dialogs.
 */
const EYES = [
  { x: -37, y: -7 },
  { x: 30, y: -9 },
] as const;

export function Mono({
  mood = "idle",
  size = 48,
  className,
}: {
  mood?: "idle" | "happy";
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="-109 -109 224 224"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      data-mood={mood}
      className={className}
    >
      {/* body */}
      <path
        d="M-91 -49C-87 -72 -53 -81 -15 -85C23 -89 69 -84 85 -71C101 -58 109 -11 108 22C109 58 97 78 71 86C37 96 -53 94 -79 75C-101 59 -103 -11 -91 -49Z"
        className="fill-surface-muted stroke-border-bright"
        strokeWidth={5}
        strokeLinejoin="round"
      />
      {/* screen */}
      <path
        d="M-84 -40C-78 -58 -44 -65 -12 -67C22 -71 61 -67 76 -54C88 -43 95 -9 90 18C86 42 56 54 19 58C-23 62 -65 52 -76 36C-89 19 -91 -17 -84 -40Z"
        className="fill-background stroke-border"
        strokeWidth={3}
        strokeLinejoin="round"
      />
      {/* belt */}
      <path
        d="M-92 53C-73 73 -26 80 19 77C61 76 90 65 101 47"
        className="stroke-primary/60"
        strokeWidth={6}
        strokeLinecap="round"
      />
      {/* face — tilted a few degrees, as on the landing page */}
      <g transform="rotate(-4.3)" strokeLinecap="round">
        {EYES.map(({ x, y }) =>
          mood === "happy" ? (
            <path
              key={x}
              data-eye="arc"
              d={`M${x - 11} ${y + 5}Q${x} ${y - 15} ${x + 11} ${y + 5}`}
              className="stroke-primary"
              strokeWidth={7}
            />
          ) : (
            <ellipse
              key={x}
              data-eye="round"
              cx={x}
              cy={y}
              rx={9}
              ry={16}
              className="fill-primary"
            />
          ),
        )}
        <path
          data-smile=""
          d="M-16 24Q-1 39 13 22"
          className="stroke-primary"
          strokeWidth={6}
        />
      </g>
    </svg>
  );
}

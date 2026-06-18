// src/components/landing/mono/mono-wisp.tsx

/**
 * "mono" — a small, luminous monochrome WISP. Inline SVG group meant to be
 * dropped inside a parent <svg> or the .mono overlay element. Parts are tagged
 * with `data-part` so the scene + CSS idle loops can animate them.
 *
 * Construction (back-to-front, layered for depth):
 *  - `glow`   : a wide, soft-blurred halo behind everything (feGaussianBlur).
 *  - `aura`   : a translucent radial bloom hugging the body.
 *  - `body`   : the flame/teardrop silhouette, filled with a vertical gradient
 *               from off-white core (#f4f4f6) down toward brand indigo (#bcc4ff),
 *               with semi-transparent feathered edges.
 *  - `core`   : a bright inner radial-gradient hotspot.
 *  - `tail`   : a tapering, flowing wisp tail trailing below.
 *  - `eye` ×2 : two soft, small dot eyes.
 *
 * Drawn around a 60x74 box, origin top-center. The "hook point" (where mono
 * latches the O) sits near the top-center of the box; the .mono overlay margins
 * center that point on the offset-path. Unique gradient/filter ids are scoped
 * with a constant prefix so multiple instances won't collide in this one-shot
 * scene.
 */
const ID = "mono-wisp";

export function MonoWisp() {
  return (
    <g aria-hidden>
      <defs>
        {/* Soft blur for the outer glow halo. Generous region so the blur
            isn't clipped. */}
        <filter
          id={`${ID}-blur`}
          x="-80%"
          y="-80%"
          width="260%"
          height="260%"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur stdDeviation="6" />
        </filter>

        {/* Body fill: off-white crown fading to indigo at the tail. */}
        <linearGradient id={`${ID}-body`} x1="30" y1="6" x2="30" y2="62">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="35%" stopColor="#f4f4f6" />
          <stop offset="100%" stopColor="#bcc4ff" />
        </linearGradient>

        {/* Inner hotspot. */}
        <radialGradient
          id={`${ID}-core`}
          cx="0.5"
          cy="0.38"
          r="0.6"
          fx="0.5"
          fy="0.34"
        >
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="55%" stopColor="#eef0ff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#bcc4ff" stopOpacity="0" />
        </radialGradient>

        {/* Aura + halo bloom. */}
        <radialGradient id={`${ID}-aura`} cx="0.5" cy="0.42" r="0.55">
          <stop offset="0%" stopColor="#dfe3ff" stopOpacity="0.75" />
          <stop offset="60%" stopColor="#bcc4ff" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#bcc4ff" stopOpacity="0" />
        </radialGradient>

        {/* Tail gradient: fades to indigo and out. */}
        <linearGradient id={`${ID}-tail`} x1="30" y1="48" x2="30" y2="74">
          <stop offset="0%" stopColor="#cdd2f6" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#bcc4ff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Outer glow halo — wide, blurred, low opacity. */}
      <ellipse
        data-part="glow"
        cx="30"
        cy="30"
        rx="26"
        ry="30"
        fill={`url(#${ID}-aura)`}
        filter={`url(#${ID}-blur)`}
        opacity="0.9"
      />

      {/* Aura bloom hugging the body. */}
      <ellipse
        data-part="aura"
        cx="30"
        cy="30"
        rx="20"
        ry="24"
        fill={`url(#${ID}-aura)`}
        opacity="0.85"
      />

      {/* Flowing tapering tail (rendered under the body so it trails out the
          bottom). */}
      <path
        data-part="tail"
        d="M30 40
           C 24 50, 20 58, 22 68
           C 24 73, 27 74, 30 71
           C 33 74, 36 73, 38 68
           C 40 58, 36 50, 30 40 Z"
        fill={`url(#${ID}-tail)`}
        opacity="0.9"
      />

      {/* Flame / teardrop body silhouette. Semi-transparent edges via the
          gradient + a feathered stroke. */}
      <path
        data-part="body"
        d="M30 5
           C 19 8, 13 17, 13 28
           C 13 38, 19 45, 24 50
           C 27 53, 28 55, 30 57
           C 32 55, 33 53, 36 50
           C 41 45, 47 38, 47 28
           C 47 17, 41 8, 30 5 Z"
        fill={`url(#${ID}-body)`}
        stroke="#eef0ff"
        strokeOpacity="0.25"
        strokeWidth="1"
      />

      {/* Bright inner core hotspot. */}
      <ellipse
        data-part="core"
        cx="30"
        cy="26"
        rx="13"
        ry="16"
        fill={`url(#${ID}-core)`}
      />

      {/* Two soft dot eyes. */}
      <circle
        data-part="eye"
        cx="24.5"
        cy="26"
        r="2.4"
        fill="#0a0a0c"
        opacity="0.82"
      />
      <circle
        data-part="eye"
        cx="35.5"
        cy="26"
        r="2.4"
        fill="#0a0a0c"
        opacity="0.82"
      />
    </g>
  );
}

// src/components/landing/mono/mono-wisp.tsx

/**
 * "mono" — a small monochrome wisp. Inline SVG group meant to be dropped inside
 * a parent <svg> or the .mono overlay element. Parts are tagged with `data-part`
 * so the scene can animate them. Drawn around a 32x36 box, origin top-center.
 */
export function MonoWisp() {
  return (
    <g aria-hidden>
      {/* soft glow behind the body */}
      <ellipse
        data-part="glow"
        cx="16"
        cy="16"
        rx="16"
        ry="16"
        fill="#bcc4ff"
        opacity="0.35"
      />
      {/* rounded body with a wispy tail merged into one path */}
      <path
        data-part="body"
        d="M16 2c-7 0-11 5-11 12 0 4 1 6 1 9 0 2-2 3-2 5 1 1 3-1 4-1s2 2 3 2 2-2 3-2 2 2 3 1 0-3 0-5c0-3 1-5 1-9 0-7-4-12-5-12z"
        fill="#f4f4f6"
      />
      {/* tail flourish (kept separate so it can curl/trail) */}
      <path
        data-part="tail"
        d="M11 26c2 2 4 2 5 2s3 0 5-2c-1 3-3 4-5 4s-4-1-5-4z"
        fill="#d7daf0"
      />
      <circle data-part="eye" cx="12" cy="14" r="1.6" fill="#0a0a0c" />
      <circle data-part="eye" cx="20" cy="14" r="1.6" fill="#0a0a0c" />
    </g>
  );
}

// src/components/landing/mono/sequence.ts

/** A single Motion sequence segment: [selector, keyframes, options?]. */
export type MonoSegment = [
  string,
  Record<string, unknown>,
  Record<string, unknown>?,
];
export type MonoSequence = MonoSegment[];

export interface SequenceInput {
  /** Vertical px from the O down to the subtitle line (mono's climb). */
  climbDistance: number;
}

/**
 * The six-beat reveal as a Motion sequence array. The rope draws on while mono
 * rides the (separately set) offsetPath down to the O; mono latches, climbs to
 * the subtitle, pulls it into view, then floats back to perch on the O.
 *
 * Note: `.mono`'s offsetPath is set imperatively on the element before this runs
 * (see mono-scene); here we only animate offsetDistance/transform keyframes.
 */
// A soft, expressive ease used throughout for fluid, non-mechanical motion.
const SMOOTH = [0.22, 1, 0.36, 1] as const;

export function buildSequence({ climbDistance }: SequenceInput): MonoSequence {
  return [
    // 1+2. Born + descent: rope draws while mono rides the path down to the O.
    // Unhurried so the drape reads as a deliberate descent.
    [".rope", { pathLength: [0.001, 1] }, { duration: 2.0, ease: SMOOTH }],
    [
      ".mono",
      { offsetDistance: ["0%", "100%"], opacity: [0, 1] },
      { duration: 2.0, ease: "easeInOut", at: "<" },
    ],
    // 3. Hook the O: a slow, settling overshoot — a soft latch, not a snap.
    [
      ".mono",
      { rotate: [0, -7, 2, 0] },
      { duration: 1.0, ease: SMOOTH, at: "-0.2" },
    ],
    // 4. Lower to the subtitle line, with a faint trailing sway in the rotation.
    [
      ".mono",
      { y: [0, climbDistance], rotate: [0, -3, 0] },
      { duration: 1.8, ease: SMOOTH, at: "-0.15" },
    ],
    // 5. The pull: subtitle slides out from behind the wordmark, overlapping the
    // tail of the descent so the two beats flow into one another.
    [
      ".subtitle",
      { opacity: [0, 1], y: [18, 0] },
      { duration: 1.2, ease: SMOOTH, at: "-0.55" },
    ],
    // 6. Float back up and perch on the O — gentle and buoyant.
    [
      ".mono",
      { y: [climbDistance, 0], rotate: [0, 3, 0] },
      { duration: 1.4, ease: SMOOTH, at: "-0.15" },
    ],
  ];
}

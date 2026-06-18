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
export function buildSequence({ climbDistance }: SequenceInput): MonoSequence {
  return [
    // 1+2. Born + descent: rope draws while mono rides the path down to the O.
    [".rope", { pathLength: [0.001, 1] }, { duration: 0.9, ease: "easeInOut" }],
    [
      ".mono",
      { offsetDistance: ["0%", "100%"], opacity: [0, 1] },
      { duration: 0.9, ease: "easeIn", at: "<" },
    ],
    // 3. Hook the O: small overshoot/settle.
    [".mono", { rotate: [0, -8, 0] }, { duration: 0.4, at: "+0.05" }],
    // 4. Lower to the subtitle line.
    [".mono", { y: [0, climbDistance] }, { duration: 0.7, ease: "easeIn" }],
    // 5. The pull: subtitle slides out from behind the wordmark.
    [
      ".subtitle",
      { opacity: [0, 1], y: [16, 0] },
      { duration: 0.6, ease: "easeOut", at: "-0.2" },
    ],
    // 6. Float back up and perch on the O.
    [".mono", { y: [climbDistance, 0] }, { duration: 0.6, ease: "easeOut" }],
  ];
}

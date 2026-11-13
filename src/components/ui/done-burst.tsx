"use client";

import { use, useEffect } from "react";

/**
 * The done celebration (visual refresh spec 4.7): a pill pop on a status
 * change and a small burst when an item is completed.
 *
 * Everything here is IMPERATIVE on purpose. The board table is virtualized and
 * hot, so the celebration owns no React state, no per-cell effect and no
 * subscription: the status cell's commit handler calls
 * {@link celebrateStatusEdit} once, on the user's own edit, and that is the
 * only entry point. A realtime update from someone else, a first render and a
 * row re-mounting as it scrolls back into the window never pass through a
 * commit handler, so none of them can replay it.
 *
 * The user's preference rides `<html data-celebrate>` (stamped by
 * {@link CelebrateDoneSync}) rather than a context, so reading it costs one
 * attribute lookup at edit time and nothing at render time.
 */

export const CELEBRATE_ATTR = "data-celebrate";

/** Tailwind utility backed by `--animate-pill-pop` in globals.css. */
export const PILL_POP_CLASS = "animate-pill-pop";

/** Marks the element the pop plays on (the status cell's pill). */
export const STATUS_PILL_ATTR = "data-status-pill";

const MAX_PARTICLES = 12;
const BURST_MS = 680;
const EASE_KEYSTONE = "cubic-bezier(0.16, 1, 0.3, 1)";
/** The two accents plus two status colours — semantic tokens only. */
const BURST_COLORS = [
  "var(--brand)",
  "var(--brand-2)",
  "var(--status-green)",
  "var(--status-yellow)",
] as const;

/** Stamp the account's preference on `<html>` — takes effect immediately. */
export function applyCelebrateDone(enabled: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute(CELEBRATE_ATTR, enabled ? "on" : "off");
}

/**
 * Back to "unstamped" — the state before any account's value arrived, which
 * {@link isCelebrationEnabled} reads as off. Called at sign-out so the
 * preference does not outlive the session on a shared browser.
 */
export function forgetCelebrateDone(): void {
  if (typeof document === "undefined") return;
  document.documentElement.removeAttribute(CELEBRATE_ATTR);
}

/**
 * True only once the account's value has been stamped AND it is on. An
 * unstamped page (the preference still streaming, or a frame that never mounts
 * the sync) stays quiet: a missed flourish is invisible, an unwanted one is a
 * broken promise to someone who turned it off.
 */
export function isCelebrationEnabled(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.getAttribute(CELEBRATE_ATTR) === "on";
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function canCelebrate(): boolean {
  return isCelebrationEnabled() && !prefersReducedMotion();
}

/**
 * Play the done burst from the centre of `el`: at most 12 squares (7px, radius
 * 2px) flung 28–64px outwards with the Web Animations API — opaque for the
 * throw, fading over the last third of 680ms — each removed when its
 * animation ends. A no-op when the celebration is off, under
 * `prefers-reduced-motion`, or where `element.animate` does not exist.
 *
 * The squares are `position: fixed` children of `<body>`, not of the cell: the
 * cell clips its overflow (`truncate`), and a fixed box — unlike an absolute
 * one — cannot grow the page's scrollable area while its transform carries it
 * past the viewport edge.
 */
export function fireDoneBurst(
  el: HTMLElement,
  opts?: { count?: number },
): void {
  if (typeof document === "undefined" || !canCelebrate()) return;
  if (typeof el.animate !== "function") return;

  const count = Math.max(
    0,
    Math.min(MAX_PARTICLES, Math.floor(opts?.count ?? MAX_PARTICLES)),
  );
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  for (let i = 0; i < count; i++) {
    const square = document.createElement("span");
    square.setAttribute("data-done-burst", "");
    square.setAttribute("aria-hidden", "true");
    const s = square.style;
    s.position = "fixed";
    s.left = `${x}px`;
    s.top = `${y}px`;
    s.width = "7px";
    s.height = "7px";
    s.borderRadius = "2px";
    s.background = BURST_COLORS[i % BURST_COLORS.length];
    s.pointerEvents = "none";
    s.zIndex = "60";
    document.body.appendChild(square);

    // Evenly fanned, with a deterministic wobble in angle so the ring does not
    // read as a clock face; the throw (28–64px), the tumble and the start
    // are randomised per square so no two bursts are the same shape.
    const angle = (i / count) * Math.PI * 2 + (i % 3) * 0.21;
    const reach = 28 + Math.random() * 36;
    const dx = Math.cos(angle) * reach;
    const dy = Math.sin(angle) * reach;
    const spin = (i % 2 === 0 ? 1 : -1) * (40 + Math.random() * 50);
    // One function list for every keyframe, so each function interpolates on
    // its own: anchor on the centre, drift straight down, throw, tumble, grow.
    const pose = (throwN: number, drift: number, turn: number, scale: number) =>
      `translate(-50%, -50%) translate(0px, ${drift}px) ` +
      `translate(${(dx * throwN).toFixed(1)}px, ${(dy * throwN).toFixed(1)}px) ` +
      `rotate(${(spin * turn).toFixed(1)}deg) scale(${scale})`;

    // The timing function is LINEAR and the easing lives on the keyframes:
    // offsets are fractions of eased progress, so easing the whole run (as
    // the first version did) put "65%" about 60ms in and faded the squares
    // out before they had moved. Here they are fully opaque for the whole
    // throw — most of it inside the first 150ms, on the keystone
    // curve — and only then fade, sinking a little, over the last 35%.
    const animation = square.animate(
      [
        {
          offset: 0,
          transform: pose(0, 0, 0, 0.4),
          opacity: "1",
          easing: EASE_KEYSTONE,
        },
        {
          offset: 0.65,
          transform: pose(0.94, 3, 0.8, 1),
          opacity: "1",
          easing: "ease-in",
        },
        { offset: 1, transform: pose(1, 10, 1, 0.7), opacity: "0" },
      ],
      {
        duration: BURST_MS,
        delay: Math.round(Math.random() * 40),
        easing: "linear",
        fill: "both",
      },
    );
    const remove = () => square.remove();
    animation.onfinish = remove;
    animation.oncancel = remove;
  }
}

/**
 * Play `pill-pop` once on the status pill inside `root`. The class is removed
 * when the run ends, so the next change can replay it.
 */
export function popStatusPill(root: HTMLElement): void {
  if (!canCelebrate()) return;
  const pill = root.querySelector<HTMLElement>(`[${STATUS_PILL_ATTR}]`);
  if (!pill) return;
  pill.classList.remove(PILL_POP_CLASS);
  // Reading layout restarts the animation when a pop is already in flight.
  void pill.offsetWidth;
  pill.classList.add(PILL_POP_CLASS);
  const done = () => pill.classList.remove(PILL_POP_CLASS);
  pill.addEventListener("animationend", done, { once: true });
  pill.addEventListener("animationcancel", done, { once: true });
}

/**
 * The single entry point for a status cell: call it from the commit handler of
 * the CURRENT USER's edit. Waits one frame so the cell has swapped its editor
 * for the new pill, then pops the pill and — when `becameDone` — fires the
 * burst. `getCell` is read inside the frame because the cell may have
 * re-rendered (or unmounted) by then.
 */
export function celebrateStatusEdit(
  getCell: () => HTMLElement | null,
  becameDone: boolean,
): void {
  if (typeof window === "undefined" || !canCelebrate()) return;
  window.requestAnimationFrame(() => {
    const cell = getCell();
    if (!cell || !cell.isConnected) return;
    popStatusPill(cell);
    if (becameDone) fireDoneBurst(cell);
  });
}

/**
 * Stamps the account's "Celebrate completed items" preference on `<html>`.
 * Same shape as `ThemePresetSync`: the server value arrives as an UNAWAITED
 * promise behind a null-fallback Suspense boundary, so it never delays page
 * content. Renders nothing.
 */
export function CelebrateDoneSync({
  enabled,
}: {
  enabled: Promise<boolean>;
}): null {
  const resolved = use(enabled);
  useEffect(() => {
    applyCelebrateDone(resolved);
  }, [resolved]);
  return null;
}

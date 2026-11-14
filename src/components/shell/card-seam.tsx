"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { seamPath, type SeamSide } from "@/lib/ui/seam-path";
import { cn } from "@/lib/utils";

/** Half of the 30px tick the seam shows at rest — one half per path. */
const REST = 15;

type Box = { width: number; height: number; radius: number };

/**
 * The lit seam: the content card's own hairline, brightened, as the control
 * for the panel on that side.
 *
 * At rest it is a 30px tick at the middle of the edge. On hover or keyboard
 * focus of whatever `children` puts in the hit area, the tick opens from its
 * own middle in both directions, runs the whole edge, rounds both corners and
 * takes a soft bloom (`.seam-line` / `.seam-cap` in globals.css — the state
 * lives in CSS so a pointer crossing the gutter costs no React render).
 *
 * This component owns only the geometry. The control — what it is called, what
 * it toggles, whether it also resizes — is `children`, because the two edges
 * answer those differently: the sidebar's is a plain button, the dock's is a
 * resize separator that folds on click.
 *
 * Mount it inside the positioned wrapper around `<main>`; it lays itself over
 * the card and carries `rounded-xl` purely so its computed radius IS the card's
 * radius, whatever `--radius` becomes.
 */
export function CardSeam({
  side,
  className,
  children,
}: {
  side: SeamSide;
  /** For hiding the whole seam where its panel does not exist (below `md`). */
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const rect = el.getBoundingClientRect();
      const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
      // A post-mount DOM measure is the one correct time to read layout. The
      // equality guard is what keeps a ResizeObserver callback from looping:
      // an unchanged box returns the same object and React bails out.
      setBox((prev) =>
        prev &&
        prev.width === rect.width &&
        prev.height === rect.height &&
        prev.radius === radius
          ? prev
          : { width: rect.width, height: rect.height, radius },
      );
    };
    read();
    // The card is a flex child between two animated widths: its box is wrong at
    // first paint and changes on every frame of a fold. A one-shot measure here
    // lit only the top corner of a 56px-tall card. Observing is the only thing
    // that knows the real box at every moment — and it costs two paths redrawn.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const seam =
    box && box.width > 0 && box.height > 0 ? seamPath({ ...box, side }) : null;

  return (
    <div
      ref={ref}
      data-seam={side}
      // `rounded-xl` declares the card's radius; nothing here is painted.
      // `chrome-scope`: the seam lies over the card's outline but lights
      // against the frame beside it, so in light mode its stroke and bloom
      // take the frame's white values rather than the root's ink (inert in
      // dark). The opaque cap hands them back with `chrome-reset`.
      className={cn(
        "seam chrome-scope pointer-events-none absolute inset-0 z-10 rounded-xl",
        className,
      )}
    >
      {seam ? (
        <svg
          aria-hidden
          className="absolute inset-0 overflow-visible"
          width={box!.width}
          height={box!.height}
          viewBox={`0 0 ${box!.width} ${box!.height}`}
        >
          {[seam.up, seam.down].map((half, i) => (
            <path
              key={i}
              className="seam-line"
              d={half.d}
              style={
                {
                  "--seam-rest": `${REST}px`,
                  "--seam-len": `${half.length}px`,
                  // A gap at least as long as the path keeps exactly one dash
                  // on screen at every point of the reveal.
                  "--seam-gap": `${half.length + 1}px`,
                } as React.CSSProperties
              }
            />
          ))}
        </svg>
      ) : null}
      {children}
    </div>
  );
}

/**
 * The hit area for a seam: a thin full-height strip centred on the edge, which
 * on a coarse pointer shrinks to a 44px target at the middle instead.
 *
 * Full height is right for a mouse — the whole edge is the control — but wrong
 * for touch, where it would swallow the card's left gutter from board scrolling
 * and dragging. Compose it onto whichever element owns the semantics.
 */
export function seamHitClasses(side: SeamSide): string {
  return cn(
    "seam-hit group/hit pointer-events-auto absolute z-20 outline-none",
    // 12px, centred ON the edge: 6px of the 4px gutter (and a sliver of the
    // rail's own padding, which is inert) and 6px of the card's inner padding,
    // so it never eats a board row's content. Centred is also what puts the cap
    // exactly on the lit line rather than beside it.
    "inset-y-0 w-3 cursor-pointer",
    side === "left" ? "-left-1.5" : "-right-1.5",
    "pointer-coarse:inset-y-auto pointer-coarse:top-1/2 pointer-coarse:size-11 pointer-coarse:-translate-y-1/2",
  );
}

/**
 * The edge nub: a small pill centred ON the seam carrying a `PanelGlyph`. It is
 * visible at rest on every pointer — a control that only appears on hover had
 * to be discovered — and brightens on approach (`.seam-cap` in globals.css).
 * It is also the carrier of the focus ring: the hit strip runs the whole edge,
 * so a ring on IT would outline the entire card.
 *
 * A class rather than a component because the two edges need it on different
 * elements: a `<span>` inside the sidebar's button, and the dock's own
 * `<button>` nested inside a resize separator.
 */
export const SEAM_CAP =
  // Opaque, and centred ON the line: the nub breaks the lit seam where the
  // control is, rather than letting the stroke run through the glyph.
  // `chrome-reset`: an opaque pill inside the seam's chrome scope — its glyph,
  // hairline and focus ring stay the root's dark-on-light values.
  "seam-cap chrome-reset bg-surface text-muted-foreground absolute top-1/2 left-1/2 flex h-11 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border pointer-coarse:w-7 " +
  // Lit on approach: the hit strip's hover/focus, or the nub's own focus (the
  // dock's nub is the focusable button itself).
  "group-hover/hit:border-border-bright group-hover/hit:text-foreground group-hover/hit:h-13 " +
  "group-focus-visible/hit:border-border-bright group-focus-visible/hit:text-foreground group-focus-visible/hit:h-13 " +
  "focus-visible:border-border-bright focus-visible:text-foreground focus-visible:h-13";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The shared status pill — the single sanctioned rendering of app-level
 * status semantics (on-track / at-risk / off-track, feedback triage states,
 * member active/deactivated, …) on the `--status-*` design tokens.
 *
 * Geometry matches the boards' `OptionPill` (the canonical pill spec):
 * `rounded-md px-2.5 py-0.5 text-xs font-medium`. Dense call sites may
 * override via `className` (merged with tailwind-merge, so later wins).
 *
 * Never hand-roll `bg-status-* text-white` — white text fails WCAG AA on the
 * pale dark-mode fills (yellow/green/orange are oklch L 0.74–0.85 in `.dark`).
 */

export type StatusColor =
  | "gray"
  | "blue"
  | "green"
  | "yellow"
  | "orange"
  | "red"
  | "purple"
  | "teal";

/** All eight status tokens, for exhaustive iteration (tests, pickers). */
export const STATUS_COLORS: readonly StatusColor[] = [
  "gray",
  "blue",
  "green",
  "yellow",
  "orange",
  "red",
  "purple",
  "teal",
] as const;

/** A pill tone: one of the status tokens, or the brand accent (e.g. "Done"). */
export type StatusPillColor = StatusColor | "primary";

/** Solid `bg-status-*` utility per color (static strings so Tailwind sees them). */
export const STATUS_BG: Record<StatusColor, string> = {
  gray: "bg-status-gray",
  blue: "bg-status-blue",
  green: "bg-status-green",
  yellow: "bg-status-yellow",
  orange: "bg-status-orange",
  red: "bg-status-red",
  purple: "bg-status-purple",
  teal: "bg-status-teal",
};

/**
 * Text color on a *solid* token fill. `#1a1a1d` is `DARK_FG` from
 * `src/lib/boards/contrast.ts`; these are `pillTextColor()`'s WCAG choices
 * pre-computed against the actual `--status-*` values in `globals.css`:
 * near-black beats white on every fill in both themes (white is 1.6–3.3:1 on
 * the pale dark-mode fills) except light-mode purple, where white edges it
 * (4.32:1 vs 4.02:1).
 */
const SOLID_TEXT: Record<StatusColor, string> = {
  gray: "text-[#1a1a1d]",
  blue: "text-[#1a1a1d]",
  green: "text-[#1a1a1d]",
  yellow: "text-[#1a1a1d]",
  orange: "text-[#1a1a1d]",
  red: "text-[#1a1a1d]",
  purple: "text-white dark:text-[#1a1a1d]",
  teal: "text-[#1a1a1d]",
};

/**
 * Soft tone: 15% token tint + text derived from the same token. Light mode
 * darkens the token 35% toward black (≥5.09:1 on white across all eight
 * hues); dark mode uses the token directly (≥5.19:1 on `--background`).
 * Deriving both from the token keeps this correct if the reskin retunes hues.
 */
const SOFT: Record<StatusColor, string> = {
  gray: "bg-status-gray/15 text-[color:color-mix(in_oklab,var(--status-gray)_65%,black)] dark:text-status-gray",
  blue: "bg-status-blue/15 text-[color:color-mix(in_oklab,var(--status-blue)_65%,black)] dark:text-status-blue",
  green:
    "bg-status-green/15 text-[color:color-mix(in_oklab,var(--status-green)_65%,black)] dark:text-status-green",
  yellow:
    "bg-status-yellow/15 text-[color:color-mix(in_oklab,var(--status-yellow)_65%,black)] dark:text-status-yellow",
  orange:
    "bg-status-orange/15 text-[color:color-mix(in_oklab,var(--status-orange)_65%,black)] dark:text-status-orange",
  red: "bg-status-red/15 text-[color:color-mix(in_oklab,var(--status-red)_65%,black)] dark:text-status-red",
  purple:
    "bg-status-purple/15 text-[color:color-mix(in_oklab,var(--status-purple)_65%,black)] dark:text-status-purple",
  teal: "bg-status-teal/15 text-[color:color-mix(in_oklab,var(--status-teal)_65%,black)] dark:text-status-teal",
};

/**
 * Tone classes (fill + AA text) without the pill geometry — for non-`<span>`
 * hosts like the feedback triage dropdown trigger button.
 */
export function statusToneClasses(
  color: StatusPillColor,
  variant: "solid" | "soft" = "solid",
): string {
  if (color === "primary")
    return variant === "solid"
      ? "bg-primary text-primary-foreground"
      : "bg-primary/15 text-primary";
  return variant === "solid"
    ? `${STATUS_BG[color]} ${SOLID_TEXT[color]}`
    : SOFT[color];
}

export function StatusPill({
  color,
  variant = "solid",
  className,
  children,
}: {
  color: StatusPillColor;
  /** `solid` = filled token pill (boards look); `soft` = 15% tint + colored text. */
  variant?: "solid" | "soft";
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center truncate rounded-md px-2.5 py-0.5 text-xs font-medium",
        statusToneClasses(color, variant),
        className,
      )}
    >
      {children}
    </span>
  );
}

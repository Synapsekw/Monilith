/**
 * Map a 0–100 percent to its progress-bar fill band class.
 *
 * Six bands walk red → green so completion reads at a glance: 0–19 red,
 * 20–39 orange, 40–59 amber, 60–79 lime, 80–99 green, 100 a deeper
 * "complete" green. Each class is a full literal (Tailwind JIT must see it)
 * backed by an OKLCH token defined in globals.css (light + dark). Color is
 * redundant with the numeric label — never the sole signal.
 */
export function percentBandColor(percent: number): string {
  const p = Math.max(0, Math.min(100, percent));
  if (p >= 100) return "bg-[var(--progress-complete)]";
  if (p >= 80) return "bg-[var(--progress-green)]";
  if (p >= 60) return "bg-[var(--progress-lime)]";
  if (p >= 40) return "bg-[var(--progress-amber)]";
  if (p >= 20) return "bg-[var(--progress-orange)]";
  return "bg-[var(--progress-red)]";
}

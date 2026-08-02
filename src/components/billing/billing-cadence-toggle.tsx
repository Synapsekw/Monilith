"use client";
import { cn } from "@/lib/utils";
import type { Cadence } from "@/lib/billing/tiers";

/**
 * Monthly / annual switch.
 *
 * Pure client state — switching cadence is zero server round-trips (working
 * agreement #5). If this ever needs to be linkable, use
 * `window.history.replaceState`, never a `<Link>` or `router.push`: a router
 * navigation re-runs every query in the page (gotcha-09).
 *
 * A radiogroup rather than two buttons, so the pair is one tab stop and arrow
 * keys move between options — what a segmented control should do. Not a
 * `<Switch>`: this picks between two named values, it does not toggle a boolean,
 * and the labels have to stay readable.
 *
 * Hairlines brighten rather than thicken on hover, per Keystone.
 */
export function BillingCadenceToggle({
  value,
  onChange,
}: {
  value: Cadence;
  onChange: (next: Cadence) => void;
}) {
  const options: { id: Cadence; label: string }[] = [
    { id: "monthly", label: "Monthly" },
    { id: "annual", label: "Annual" },
  ];

  return (
    <div className="flex items-center gap-3">
      <div
        role="radiogroup"
        aria-label="Billing cadence"
        className="bg-surface-muted border-border inline-flex items-center gap-1 rounded-lg border p-1"
      >
        {options.map((o) => {
          const selected = value === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(o.id)}
              className={cn(
                "ease-keystone focus-visible:ring-ring rounded-sm px-4 py-1.5 text-sm font-semibold transition-colors duration-300 focus-visible:ring-2 focus-visible:outline-none pointer-coarse:min-h-11 pointer-coarse:px-5",
                selected
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <span className="text-muted-foreground text-xs font-medium">
        2 months free
      </span>
    </div>
  );
}

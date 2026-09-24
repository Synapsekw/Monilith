"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { KPI_KEYS, type KpiKey } from "@/lib/validations/folder-layout";

const KPI_LABEL: Record<KpiKey, string> = {
  complete: "Complete",
  gap: "Gap to plan",
  overdue: "Overdue",
  dueThisWeek: "Due this week",
  blocked: "Blocked",
  stale: "Stale",
};

const MAX_CARDS = 6;
const MIN_CARDS = 1;

/**
 * The `kpis` section's card picker: every `KPI_KEYS` entry as a checkbox, plus
 * Move up/down for the chosen ones — order here is render order. Capped at 6
 * (the panel's grid is 6-up at xl) and refuses to drop below 1 (an empty KPI
 * row is a dead section).
 */
export function KpiPicker({
  cards,
  onChange,
}: {
  cards: KpiKey[];
  onChange: (cards: KpiKey[]) => void;
}) {
  function toggle(key: KpiKey, checked: boolean) {
    if (checked) {
      if (cards.includes(key) || cards.length >= MAX_CARDS) return;
      onChange([...cards, key]);
    } else {
      if (cards.length <= MIN_CARDS) return;
      onChange(cards.filter((k) => k !== key));
    }
  }

  function move(key: KpiKey, dir: "up" | "down") {
    const idx = cards.indexOf(key);
    const target = dir === "up" ? idx - 1 : idx + 1;
    if (idx === -1 || target < 0 || target >= cards.length) return;
    const next = cards.slice();
    const tmp = next[idx]!;
    next[idx] = next[target]!;
    next[target] = tmp;
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-xs">
        {cards.length} of {MAX_CARDS} cards
      </p>
      <ul className="flex flex-col gap-1">
        {KPI_KEYS.map((key) => {
          const checked = cards.includes(key);
          const idx = cards.indexOf(key);
          return (
            <li key={key} className="flex items-center justify-between gap-2">
              <Label className="flex-1 gap-2 text-xs font-normal">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={
                    (!checked && cards.length >= MAX_CARDS) ||
                    (checked && cards.length <= MIN_CARDS)
                  }
                  onChange={(e) => toggle(key, e.target.checked)}
                  className="size-4 pointer-coarse:size-6"
                />
                {KPI_LABEL[key]}
              </Label>
              {checked ? (
                <div className="flex items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Move ${KPI_LABEL[key]} up`}
                    disabled={idx === 0}
                    onClick={() => move(key, "up")}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Move ${KPI_LABEL[key]} down`}
                    disabled={idx === cards.length - 1}
                    onClick={() => move(key, "down")}
                  >
                    <ArrowDown />
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

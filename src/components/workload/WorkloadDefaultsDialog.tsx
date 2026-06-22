"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Settings2 } from "lucide-react";

import { setWorkloadDefaults } from "@/lib/workload/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: "Mo" },
  { value: 2, label: "Tu" },
  { value: 3, label: "We" },
  { value: 4, label: "Th" },
  { value: 5, label: "Fr" },
  { value: 6, label: "Sa" },
  { value: 7, label: "Su" },
];

/**
 * Org-level workload defaults (hours/day, per-item fallback effort, working
 * days). Seeds capacity for members who haven't customized. Org-admin only —
 * the page renders this trigger only when isOrgAdmin. RLS is the real boundary.
 */
export function WorkloadDefaultsDialog({
  defaultHoursPerDay,
  defaultPerItemHours,
  defaultWorkingDays,
}: {
  defaultHoursPerDay: number;
  defaultPerItemHours: number;
  defaultWorkingDays: number[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState(String(defaultHoursPerDay));
  const [perItem, setPerItem] = useState(String(defaultPerItemHours));
  const [days, setDays] = useState<Set<number>>(new Set(defaultWorkingDays));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggleDay(d: number) {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }

  function submit() {
    setError(null);
    const hpd = Number(hours.trim());
    const pih = Number(perItem.trim());
    if (Number.isNaN(hpd) || hpd < 0 || hpd > 24) {
      setError("Hours per day must be between 0 and 24.");
      return;
    }
    if (Number.isNaN(pih) || pih < 0) {
      setError("Per-item hours must be 0 or more.");
      return;
    }
    startTransition(async () => {
      const res = await setWorkloadDefaults({
        defaultHoursPerDay: hpd,
        defaultPerItemHours: pih,
        defaultWorkingDays: [...days].sort((a, b) => a - b),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Settings2 className="size-4" />
          Defaults
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Workload defaults</DialogTitle>
          <DialogDescription>
            Used for members who haven&apos;t customized their capacity, and to
            estimate effort for dated items with no time estimate.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wl-default-hours">Hours per working day</Label>
            <Input
              id="wl-default-hours"
              type="number"
              inputMode="decimal"
              min={0}
              max={24}
              step={0.5}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              aria-invalid={error ? true : undefined}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="wl-default-per-item">
              Effort per dated item without an estimate (h)
            </Label>
            <Input
              id="wl-default-per-item"
              type="number"
              inputMode="decimal"
              min={0}
              step={0.5}
              value={perItem}
              onChange={(e) => setPerItem(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Working days</span>
            <div
              className="flex gap-1"
              role="group"
              aria-label="Default working days"
            >
              {WEEKDAYS.map((d) => {
                const active = days.has(d.value);
                return (
                  <button
                    key={d.value}
                    type="button"
                    aria-pressed={active}
                    disabled={isPending}
                    onClick={() => toggleDay(d.value)}
                    className={cn(
                      "focus-visible:ring-ring size-8 rounded-md text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "bg-surface-muted text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>

          {error ? <p className="text-destructive text-sm">{error}</p> : null}

          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : "Save defaults"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

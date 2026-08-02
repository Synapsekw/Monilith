"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";

import { upsertMemberCapacity } from "@/lib/workload/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
 * Per-member capacity editor (hours/day + working-day mask). Mutates server data
 * via the upsertMemberCapacity Server Action, then refreshes so the grid
 * recolors against the new capacity. Only rendered when the caller can edit
 * (self or org admin) — see the page's `canEdit` gate.
 */
export function CapacityEditor({
  userId,
  memberName,
  hoursPerDay,
  workingDays,
  customized,
}: {
  userId: string;
  memberName: string;
  hoursPerDay: number;
  workingDays: number[];
  customized: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState(String(hoursPerDay));
  const [days, setDays] = useState<Set<number>>(new Set(workingDays));
  const [error, setError] = useState<string | null>(null);

  function toggleDay(d: number) {
    setDays((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }

  function save() {
    setError(null);
    const hpd = Number(hours.trim());
    if (Number.isNaN(hpd) || hpd < 0 || hpd > 24) {
      setError("Hours per day must be between 0 and 24.");
      return;
    }
    startTransition(async () => {
      const res = await upsertMemberCapacity({
        userId,
        hoursPerDay: hpd,
        workingDays: [...days].sort((a, b) => a - b),
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7"
          aria-label={`Edit capacity for ${memberName}`}
        >
          <SlidersHorizontal aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <div className="flex flex-col gap-3 text-left">
          <div>
            <p className="text-sm font-medium">Capacity</p>
            <p className="text-muted-foreground text-xs">
              {customized ? "Customized" : "Using org default"}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`hpd-${userId}`} className="text-xs">
              Hours per day
            </Label>
            <Input
              id={`hpd-${userId}`}
              type="number"
              inputMode="decimal"
              min={0}
              max={24}
              step={0.5}
              value={hours}
              disabled={isPending}
              onChange={(e) => setHours(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">Working days</span>
            <div className="flex gap-1" role="group" aria-label="Working days">
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
                      "focus-visible:ring-ring text-2xs size-7 rounded-md font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
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

          {error ? <p className="text-destructive text-xs">{error}</p> : null}

          <Button
            type="button"
            size="sm"
            className="w-full"
            disabled={isPending}
            onClick={save}
          >
            {isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

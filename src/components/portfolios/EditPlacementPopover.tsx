"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Trash2 } from "lucide-react";

import {
  removePortfolioBoard,
  updatePortfolioPlacement,
} from "@/lib/portfolios/actions";
import type {
  PortfolioHealth,
  PortfolioPriority,
  PortfolioRow,
  RowOwner,
} from "@/lib/portfolios/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const SELECT_CLASS =
  "border-input bg-transparent focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border px-2.5 text-sm transition-colors outline-none focus-visible:ring-3 disabled:opacity-50 dark:bg-input/30";

const PRIORITIES: PortfolioPriority[] = ["low", "medium", "high", "critical"];
const PRIORITY_LABEL: Record<PortfolioPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};
const HEALTH_LABEL: Record<PortfolioHealth, string> = {
  on_track: "On track",
  at_risk: "At risk",
  off_track: "Off track",
};

type PlacementPatch = Parameters<typeof updatePortfolioPlacement>[0];

export function EditPlacementPopover({
  portfolioId,
  row,
  members,
}: {
  portfolioId: string;
  row: PortfolioRow;
  members: RowOwner[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Local, uncommitted draft for the free-text fields (budget / status note) so
  // typing doesn't fire a server round-trip per keystroke — we patch on blur.
  const [budgetDraft, setBudgetDraft] = useState(
    row.budget === null ? "" : String(row.budget),
  );
  const [noteDraft, setNoteDraft] = useState(row.statusNote ?? "");

  function patch(p: Omit<PlacementPatch, "placementId" | "portfolioId">) {
    startTransition(async () => {
      await updatePortfolioPlacement({
        ...p,
        placementId: row.id,
        portfolioId,
      });
      router.refresh();
    });
  }

  function commitBudget() {
    const trimmed = budgetDraft.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (next !== null && Number.isNaN(next)) {
      setBudgetDraft(row.budget === null ? "" : String(row.budget));
      return;
    }
    if (next === row.budget) return;
    patch({ budget: next });
  }

  function commitNote() {
    const next = noteDraft.trim() === "" ? null : noteDraft;
    if (next === row.statusNote) return;
    patch({ statusNote: next });
  }

  function remove() {
    startTransition(async () => {
      await removePortfolioBoard({ placementId: row.id, portfolioId });
      router.refresh();
    });
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7"
          aria-label={`Edit ${row.name} placement`}
          disabled={isPending}
        >
          <MoreHorizontal aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="flex flex-col gap-3 text-left">
          <p className="text-sm font-medium">Edit placement</p>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`owner-${row.id}`} className="text-xs">
              Owner
            </Label>
            <select
              id={`owner-${row.id}`}
              className={SELECT_CLASS}
              value={row.ownerUserId ?? ""}
              disabled={isPending}
              onChange={(e) =>
                patch({ ownerUserId: e.target.value === "" ? null : e.target.value })
              }
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.fullName ?? "Unnamed member"}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`priority-${row.id}`} className="text-xs">
              Priority
            </Label>
            <select
              id={`priority-${row.id}`}
              className={SELECT_CLASS}
              value={row.priority ?? ""}
              disabled={isPending}
              onChange={(e) =>
                patch({
                  priority:
                    e.target.value === ""
                      ? null
                      : (e.target.value as PortfolioPriority),
                })
              }
            >
              <option value="">None</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`health-${row.id}`} className="text-xs">
              Health
            </Label>
            <select
              id={`health-${row.id}`}
              className={SELECT_CLASS}
              value={row.healthOverride ?? ""}
              disabled={isPending}
              onChange={(e) =>
                patch({
                  healthOverride:
                    e.target.value === ""
                      ? null
                      : (e.target.value as PortfolioHealth),
                })
              }
            >
              <option value="">Auto (from pace)</option>
              <option value="on_track">{HEALTH_LABEL.on_track}</option>
              <option value="at_risk">{HEALTH_LABEL.at_risk}</option>
              <option value="off_track">{HEALTH_LABEL.off_track}</option>
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`budget-${row.id}`} className="text-xs">
              Budget
            </Label>
            <Input
              id={`budget-${row.id}`}
              type="number"
              inputMode="numeric"
              placeholder="None"
              value={budgetDraft}
              disabled={isPending}
              onChange={(e) => setBudgetDraft(e.target.value)}
              onBlur={commitBudget}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`note-${row.id}`} className="text-xs">
              Status note
            </Label>
            <Input
              id={`note-${row.id}`}
              placeholder="Add a note…"
              value={noteDraft}
              disabled={isPending}
              onChange={(e) => setNoteDraft(e.target.value)}
              onBlur={commitNote}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                }
              }}
            />
          </div>

          <div className="border-t pt-2">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="w-full"
              disabled={isPending}
              onClick={remove}
            >
              <Trash2 aria-hidden />
              Remove from portfolio
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

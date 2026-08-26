"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { createGoal } from "@/lib/goals/actions";
import type { GoalProgressMode, RowOwner } from "@/lib/goals/types";
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
import { FieldStatus, useFieldStatus } from "@/components/ui/field-status";
import { useRestoreFocusAfterPending } from "@/lib/hooks/use-restore-focus-after-pending";

const MODE_LABEL: Record<GoalProgressMode, string> = {
  manual_number: "A number (current → target)",
  manual_percent: "A percentage I set",
  auto_subgoals: "Automatically from sub-goals",
  auto_boards: "Automatically from linked boards",
};

export function NewGoalDialog({
  members,
  parentGoalId,
  triggerLabel = "New goal",
}: {
  members: RowOwner[];
  parentGoalId?: string;
  triggerLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [mode, setMode] = useState<GoalProgressMode>("manual_percent");
  const [percent, setPercent] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [currentValue, setCurrentValue] = useState("");
  const [unit, setUnit] = useState("");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // The create error belongs to the name field: it is what the user retypes.
  const nameStatus = useFieldStatus(error);
  // The dialog stays mounted on failure, so the submit button that disabled
  // itself is still there to take focus back.
  const submitRef = useRestoreFocusAfterPending<HTMLButtonElement>(isPending);

  function reset() {
    setName("");
    setOwnerId("");
    setMode("manual_percent");
    setPercent("");
    setTargetValue("");
    setCurrentValue("");
    setUnit("");
    setStartDate("");
    setDueDate("");
    setError(null);
  }

  function submit() {
    setError(null);
    const num = (s: string): number | null =>
      s.trim() === "" ? null : Number(s);
    startTransition(async () => {
      const res = await createGoal({
        name,
        progressMode: mode,
        ownerId: ownerId || undefined,
        parentGoalId: parentGoalId ?? null,
        status: "on_track",
        startValue: mode === "manual_number" ? 0 : null,
        currentValue: mode === "manual_number" ? num(currentValue) : null,
        targetValue: mode === "manual_number" ? num(targetValue) : null,
        unit: mode === "manual_number" ? unit || null : null,
        percent: mode === "manual_percent" ? num(percent) : null,
        startDate: startDate || null,
        dueDate: dueDate || null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant={parentGoalId ? "outline" : "default"}
        >
          <Plus className="size-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {parentGoalId ? "Add sub-goal" : "New goal"}
          </DialogTitle>
          <DialogDescription>
            {parentGoalId
              ? "Sub-goal progress rolls up into its parent."
              : "Define a measurable objective for your org."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="goal-name">Goal name</Label>
            <Input
              id="goal-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Grow ARR to $1M"
              {...nameStatus.controlProps}
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="goal-owner">Owner</Label>
            <select
              id="goal-owner"
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              className="border-input h-9 rounded-md border bg-transparent px-2 text-sm"
            >
              <option value="">Me</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.fullName ?? m.email ?? m.userId}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="goal-measure">How is progress measured?</Label>
            <select
              id="goal-measure"
              value={mode}
              onChange={(e) => setMode(e.target.value as GoalProgressMode)}
              className="border-input h-9 rounded-md border bg-transparent px-2 text-sm"
            >
              {(Object.keys(MODE_LABEL) as GoalProgressMode[]).map((m) => (
                <option key={m} value={m}>
                  {MODE_LABEL[m]}
                </option>
              ))}
            </select>
          </div>

          {mode === "manual_percent" ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="goal-percent">Percent complete</Label>
              <Input
                id="goal-percent"
                type="number"
                min={0}
                max={100}
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
                placeholder="0"
              />
            </div>
          ) : null}

          {mode === "manual_number" ? (
            <div className="grid grid-cols-3 gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="goal-current">Current</Label>
                <Input
                  id="goal-current"
                  type="number"
                  value={currentValue}
                  onChange={(e) => setCurrentValue(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="goal-target">Target</Label>
                <Input
                  id="goal-target"
                  type="number"
                  value={targetValue}
                  onChange={(e) => setTargetValue(e.target.value)}
                  placeholder="100"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="goal-unit">Unit</Label>
                <Input
                  id="goal-unit"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder="signups"
                />
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="goal-start">Start date</Label>
              <Input
                id="goal-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="goal-due">Due date</Label>
              <Input
                id="goal-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>

          <FieldStatus field={nameStatus} />
          <DialogFooter>
            <Button
              ref={submitRef}
              type="submit"
              disabled={isPending || !name.trim()}
            >
              {isPending ? "Creating…" : "Create goal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

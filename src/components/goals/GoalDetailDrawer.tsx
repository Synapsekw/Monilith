"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Trash2, X } from "lucide-react";

import {
  deleteGoal,
  getStatusColumnsForBoard,
  setGoalLinks,
  updateGoal,
} from "@/lib/goals/actions";
import type { GoalLink } from "@/lib/goals/queries";
import type { GoalNode, GoalStatus, RowOwner } from "@/lib/goals/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { NewGoalDialog } from "./NewGoalDialog";

const STATUSES: GoalStatus[] = ["on_track", "at_risk", "off_track", "done"];
const STATUS_LABEL: Record<GoalStatus, string> = {
  on_track: "On track",
  at_risk: "At risk",
  off_track: "Off track",
  done: "Done",
};

function flatten(nodes: GoalNode[]): GoalNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

const DONE_HINTS = ["done", "complete", "closed", "shipped"];

function GoalEditor({
  goal,
  members,
  boards,
  links,
  onClose,
}: {
  goal: GoalNode;
  members: RowOwner[];
  boards: { id: string; name: string }[];
  links: GoalLink[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState(goal.name);
  const [percent, setPercent] = useState(goal.percent?.toString() ?? "");
  const [current, setCurrent] = useState(goal.currentValue?.toString() ?? "");
  const [target, setTarget] = useState(goal.targetValue?.toString() ?? "");
  const [unit, setUnit] = useState(goal.unit ?? "");
  const [addBoard, setAddBoard] = useState("");
  const boardName = (id: string) => boards.find((b) => b.id === id)?.name ?? id;

  const num = (s: string): number | null => (s.trim() === "" ? null : Number(s));
  function patch(input: Parameters<typeof updateGoal>[0]) {
    startTransition(async () => {
      const res = await updateGoal(input);
      if (res.ok) router.refresh();
    });
  }

  function saveLinks(next: GoalLink[]) {
    startTransition(async () => {
      const res = await setGoalLinks({
        goalId: goal.id,
        links: next.map((l) => ({
          boardId: l.boardId,
          doneColumnId: l.doneColumnId,
          doneOptionIds: l.doneOptionIds,
        })),
      });
      if (res.ok) router.refresh();
    });
  }

  function onAddBoard() {
    if (!addBoard) return;
    const boardId = addBoard;
    setAddBoard("");
    startTransition(async () => {
      const res = await getStatusColumnsForBoard(boardId);
      const col = res.ok ? res.data.columns[0] : undefined;
      const done = col
        ? col.options
            .filter((o) => DONE_HINTS.some((h) => o.label.toLowerCase().includes(h)))
            .map((o) => o.id)
        : [];
      const link: GoalLink = {
        boardId,
        doneColumnId: col?.id ?? null,
        doneOptionIds: done.length > 0 ? done : (col?.options.map((o) => o.id) ?? []),
      };
      const saved = await setGoalLinks({
        goalId: goal.id,
        links: [...links, link].map((l) => ({
          boardId: l.boardId,
          doneColumnId: l.doneColumnId,
          doneOptionIds: l.doneOptionIds,
        })),
      });
      if (saved.ok) router.refresh();
    });
  }

  const linkedBoardIds = new Set(links.map((l) => l.boardId));
  const addable = boards.filter((b) => !linkedBoardIds.has(b.id));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="edit-name">Name</Label>
        <Input
          id="edit-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== goal.name && patch({ goalId: goal.id, name })}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="edit-status">Status</Label>
        <select
          id="edit-status"
          value={goal.status}
          onChange={(e) => patch({ goalId: goal.id, status: e.target.value as GoalStatus })}
          className="border-input bg-transparent h-9 rounded-md border px-2 text-sm"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="edit-owner">Owner</Label>
        <select
          id="edit-owner"
          value={goal.ownerId}
          onChange={(e) => patch({ goalId: goal.id, ownerId: e.target.value })}
          className="border-input bg-transparent h-9 rounded-md border px-2 text-sm"
        >
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.fullName ?? m.email ?? m.userId}
            </option>
          ))}
        </select>
      </div>

      {goal.progressMode === "manual_percent" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-percent">Percent complete</Label>
          <Input
            id="edit-percent"
            type="number"
            min={0}
            max={100}
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
            onBlur={() => patch({ goalId: goal.id, percent: num(percent) })}
          />
        </div>
      ) : null}

      {goal.progressMode === "manual_number" ? (
        <div className="grid grid-cols-3 gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-current">Current</Label>
            <Input
              id="edit-current"
              type="number"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              onBlur={() => patch({ goalId: goal.id, currentValue: num(current) })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-target">Target</Label>
            <Input
              id="edit-target"
              type="number"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              onBlur={() => patch({ goalId: goal.id, targetValue: num(target) })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-unit">Unit</Label>
            <Input
              id="edit-unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              onBlur={() => patch({ goalId: goal.id, unit: unit || null })}
            />
          </div>
        </div>
      ) : null}

      {goal.progressMode === "auto_boards" ? (
        <div className="flex flex-col gap-2">
          <Label>Contributing boards</Label>
          {links.length === 0 ? (
            <p className="text-muted-foreground text-xs">No boards linked yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {links.map((l) => (
                <li
                  key={l.boardId}
                  className="bg-muted/40 flex items-center justify-between rounded px-2 py-1 text-sm"
                >
                  <span>{boardName(l.boardId)}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${boardName(l.boardId)}`}
                    onClick={() => saveLinks(links.filter((x) => x.boardId !== l.boardId))}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {addable.length > 0 ? (
            <div className="flex items-center gap-2">
              <select
                aria-label="Add a board"
                value={addBoard}
                onChange={(e) => setAddBoard(e.target.value)}
                className="border-input bg-transparent h-8 flex-1 rounded-md border px-2 text-sm"
              >
                <option value="">Add a board…</option>
                {addable.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <Button type="button" size="sm" variant="outline" disabled={!addBoard} onClick={onAddBoard}>
                Add
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-start">Start date</Label>
          <Input
            id="edit-start"
            type="date"
            defaultValue={goal.startDate ?? ""}
            onBlur={(e) => patch({ goalId: goal.id, startDate: e.target.value || null })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-due">Due date</Label>
          <Input
            id="edit-due"
            type="date"
            defaultValue={goal.dueDate ?? ""}
            onBlur={(e) => patch({ goalId: goal.id, dueDate: e.target.value || null })}
          />
        </div>
      </div>

      <div className="flex items-center justify-between border-t pt-4">
        <NewGoalDialog members={members} parentGoalId={goal.id} triggerLabel="Add sub-goal" />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const res = await deleteGoal({ goalId: goal.id });
              if (res.ok) {
                onClose();
                router.refresh();
              }
            })
          }
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="size-4" />
          Delete
        </Button>
      </div>
    </div>
  );
}

export function GoalDetailDrawer({
  tree,
  members,
  boards,
  links,
}: {
  tree: GoalNode[];
  members: RowOwner[];
  boards: { id: string; name: string }[];
  links: Record<string, GoalLink[]>;
}) {
  const params = useSearchParams();
  const goalId = params.get("goal");
  const goal = goalId ? flatten(tree).find((n) => n.id === goalId) ?? null : null;

  function close() {
    const url = new URL(window.location.href);
    url.searchParams.delete("goal");
    window.history.pushState(null, "", url);
  }

  return (
    <Sheet open={goal !== null} onOpenChange={(o) => !o && close()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {goal ? (
          <>
            <SheetHeader>
              <SheetTitle>{goal.name}</SheetTitle>
              <SheetDescription>Edit this goal, its links, and its sub-goals.</SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-6">
              <GoalEditor
                key={goal.id}
                goal={goal}
                members={members}
                boards={boards}
                links={links[goal.id] ?? []}
                onClose={close}
              />
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

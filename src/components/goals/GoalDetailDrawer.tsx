"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronRight, Trash2, X } from "lucide-react";

import {
  deleteGoal,
  getStatusColumnsForBoard,
  setGoalLinks,
  updateGoal,
} from "@/lib/goals/actions";
import type { GoalLink } from "@/lib/goals/queries";
import type { StatusColumn } from "@/lib/portfolios/queries";
import type { GoalNode, GoalStatus, RowOwner } from "@/lib/goals/types";
import {
  DoneMappingFields,
  defaultDoneOptionIds,
} from "@/components/goals/DoneMappingFields";
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
  const [expandedBoardId, setExpandedBoardId] = useState<string | null>(null);
  const [columnsByBoard, setColumnsByBoard] = useState<
    Record<string, StatusColumn[]>
  >({});
  const [loadingBoardId, setLoadingBoardId] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const boardName = (id: string) => boards.find((b) => b.id === id)?.name ?? id;

  const num = (s: string): number | null =>
    s.trim() === "" ? null : Number(s);

  // Revert the controlled fields to the server truth (the goal prop is unchanged
  // until a successful patch triggers router.refresh()). Selects/date inputs read
  // straight from `goal`, so resetting the text inputs is enough to undo a failed
  // edit.
  function resetFields() {
    setName(goal.name);
    setPercent(goal.percent?.toString() ?? "");
    setCurrent(goal.currentValue?.toString() ?? "");
    setTarget(goal.targetValue?.toString() ?? "");
    setUnit(goal.unit ?? "");
  }

  function patch(input: Parameters<typeof updateGoal>[0]) {
    setSaveError(null);
    startTransition(async () => {
      const res = await updateGoal(input);
      if (res.ok) {
        router.refresh();
      } else {
        // Undo the optimistic field edit and tell the user it didn't save.
        resetFields();
        setSaveError(res.error);
      }
    });
  }

  function saveLinks(next: GoalLink[]) {
    setLinkError(null);
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
      else setLinkError(res.error);
    });
  }

  function toggleExpand(boardId: string) {
    setLinkError(null);
    if (expandedBoardId === boardId) {
      setExpandedBoardId(null);
      return;
    }
    setExpandedBoardId(boardId);
    if (columnsByBoard[boardId]) return; // cached — no refetch
    setLoadingBoardId(boardId);
    startTransition(async () => {
      const res = await getStatusColumnsForBoard(boardId);
      setLoadingBoardId(null);
      if (!res.ok) {
        setLinkError(res.error);
        return;
      }
      setColumnsByBoard((prev) => ({ ...prev, [boardId]: res.data.columns }));
    });
  }

  function setColumnForBoard(boardId: string, columnId: string | null) {
    const cols = columnsByBoard[boardId] ?? [];
    const col = columnId ? cols.find((c) => c.id === columnId) : undefined;
    const next = links.map((l) =>
      l.boardId === boardId
        ? {
            ...l,
            doneColumnId: columnId,
            doneOptionIds: defaultDoneOptionIds(col),
          }
        : l,
    );
    saveLinks(next);
  }

  function toggleOptionForBoard(boardId: string, optionId: string) {
    const next = links.map((l) =>
      l.boardId === boardId
        ? {
            ...l,
            doneOptionIds: l.doneOptionIds.includes(optionId)
              ? l.doneOptionIds.filter((id) => id !== optionId)
              : [...l.doneOptionIds, optionId],
          }
        : l,
    );
    saveLinks(next);
  }

  function onAddBoard() {
    if (!addBoard) return;
    const boardId = addBoard;
    setAddBoard("");
    startTransition(async () => {
      const res = await getStatusColumnsForBoard(boardId);
      const col = res.ok ? res.data.columns[0] : undefined;
      const guessed = defaultDoneOptionIds(col);
      const link: GoalLink = {
        boardId,
        doneColumnId: col?.id ?? null,
        doneOptionIds:
          guessed.length > 0 ? guessed : (col?.options.map((o) => o.id) ?? []),
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
      {saveError ? (
        <p role="alert" className="text-destructive text-xs">
          {saveError}
        </p>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="edit-name">Name</Label>
        <Input
          id="edit-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() =>
            name.trim() &&
            name !== goal.name &&
            patch({ goalId: goal.id, name })
          }
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="edit-status">Status</Label>
        <select
          id="edit-status"
          value={goal.status}
          onChange={(e) =>
            patch({ goalId: goal.id, status: e.target.value as GoalStatus })
          }
          className="border-input h-9 rounded-md border bg-transparent px-2 text-sm"
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
          className="border-input h-9 rounded-md border bg-transparent px-2 text-sm"
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
              onBlur={() =>
                patch({ goalId: goal.id, currentValue: num(current) })
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="edit-target">Target</Label>
            <Input
              id="edit-target"
              type="number"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              onBlur={() =>
                patch({ goalId: goal.id, targetValue: num(target) })
              }
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
            <p className="text-muted-foreground text-xs">
              No boards linked yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {links.map((l) => {
                const open = expandedBoardId === l.boardId;
                const panelId = `done-map-${l.boardId}`;
                return (
                  <li key={l.boardId} className="bg-muted/40 rounded">
                    <div className="flex items-center justify-between px-2 py-1 text-sm">
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-controls={panelId}
                        aria-label={`Edit done mapping for ${boardName(l.boardId)}`}
                        onClick={() => toggleExpand(l.boardId)}
                        className="text-muted-foreground hover:text-foreground flex flex-1 items-center gap-1.5 text-left"
                      >
                        {open ? (
                          <ChevronDown className="size-3.5" aria-hidden />
                        ) : (
                          <ChevronRight className="size-3.5" aria-hidden />
                        )}
                        <span className="text-foreground">
                          {boardName(l.boardId)}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${boardName(l.boardId)}`}
                        onClick={() =>
                          saveLinks(
                            links.filter((x) => x.boardId !== l.boardId),
                          )
                        }
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                    {open ? (
                      <div
                        id={panelId}
                        className="border-border/60 border-t px-2 pt-1.5 pb-2"
                      >
                        <DoneMappingFields
                          idPrefix={panelId}
                          columns={columnsByBoard[l.boardId] ?? []}
                          loading={loadingBoardId === l.boardId}
                          doneColumnId={l.doneColumnId}
                          doneOptionIds={l.doneOptionIds}
                          onColumnChange={(columnId) =>
                            setColumnForBoard(l.boardId, columnId)
                          }
                          onToggleOption={(optionId) =>
                            toggleOptionForBoard(l.boardId, optionId)
                          }
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {linkError ? (
            <p role="alert" className="text-destructive text-xs">
              {linkError}
            </p>
          ) : null}
          {addable.length > 0 ? (
            <div className="flex items-center gap-2">
              <select
                aria-label="Add a board"
                value={addBoard}
                onChange={(e) => setAddBoard(e.target.value)}
                className="border-input h-8 flex-1 rounded-md border bg-transparent px-2 text-sm"
              >
                <option value="">Add a board…</option>
                {addable.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!addBoard}
                onClick={onAddBoard}
              >
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
            onBlur={(e) =>
              patch({ goalId: goal.id, startDate: e.target.value || null })
            }
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-due">Due date</Label>
          <Input
            id="edit-due"
            type="date"
            defaultValue={goal.dueDate ?? ""}
            onBlur={(e) =>
              patch({ goalId: goal.id, dueDate: e.target.value || null })
            }
          />
        </div>
      </div>

      <div className="flex items-center justify-between border-t pt-4">
        <NewGoalDialog
          members={members}
          parentGoalId={goal.id}
          triggerLabel="Add sub-goal"
        />
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
  const goal = goalId
    ? (flatten(tree).find((n) => n.id === goalId) ?? null)
    : null;

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
              <SheetDescription>
                Edit this goal, its links, and its sub-goals.
              </SheetDescription>
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

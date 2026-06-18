"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { CacheColumn } from "@/lib/boards/cache";
import type { ColumnOption } from "@/lib/validations/boards";
import type {
  AutomationAction,
  AutomationTrigger,
} from "@/lib/validations/automations";
import type { Automation } from "@/lib/boards/queries";
import {
  createAutomation,
  deleteAutomation,
  getAutomations,
  updateAutomation,
} from "@/lib/boards/automation-actions";
import {
  AutomationBuilder,
  columnOptions,
  type BuilderMember,
} from "@/components/boards/automations/AutomationBuilder";
import {
  recipeNotifyOwner,
  recipeSetOption,
  type Draft,
} from "@/components/boards/automations/recipes";

function automationsKey(boardId: string) {
  return ["automations", boardId] as const;
}

/** Resolve a column name (falls back to a generic label). */
function colName(columns: CacheColumn[], id: string): string {
  return columns.find((c) => c.id === id)?.name ?? "a column";
}

/** Resolve an option label within a column's settings. */
function optName(
  columns: CacheColumn[],
  columnId: string,
  optionId: string,
): string {
  const col = columns.find((c) => c.id === columnId);
  const opts: ColumnOption[] = col ? columnOptions(col) : [];
  return opts.find((o) => o.id === optionId)?.label ?? optionId;
}

function memberName(members: BuilderMember[], userId: string): string {
  const m = members.find((x) => x.userId === userId);
  return m?.fullName ?? m?.email ?? "someone";
}

/** One-line, human-readable summary of an automation rule. */
function summarize(
  rule: Automation,
  columns: CacheColumn[],
  members: BuilderMember[],
): string {
  const trigger = rule.trigger as unknown as AutomationTrigger;
  const actions = rule.actions as unknown as AutomationAction[];

  const when =
    trigger.toOptionId == null
      ? `When ${colName(columns, trigger.columnId)} changes`
      : `When ${colName(columns, trigger.columnId)} changes to ${optName(
          columns,
          trigger.columnId,
          trigger.toOptionId,
        )}`;

  const thens = actions.map((a) => {
    if (a.type === "notify") {
      return a.recipient.kind === "owner"
        ? `notify the owner (${colName(columns, a.recipient.peopleColumnId)})`
        : `notify ${memberName(members, a.recipient.userId)}`;
    }
    return `set ${colName(columns, a.columnId)} to ${optName(
      columns,
      a.columnId,
      a.optionId,
    )}`;
  });

  return `${when}, ${thens.join(" and ")}.`;
}

export function AutomationsDialog({
  boardId,
  columns,
  members,
  open,
  onOpenChange,
}: {
  boardId: string;
  columns: CacheColumn[];
  members: BuilderMember[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"list" | "build">("list");
  const [initialDraft, setInitialDraft] = useState<Draft | undefined>();
  const [error, setError] = useState<string | null>(null);

  const { data: rules = [], isLoading } = useQuery({
    queryKey: automationsKey(boardId),
    enabled: open,
    staleTime: 30_000,
    queryFn: () => getAutomations(boardId),
  });

  const create = useMutation({
    mutationFn: async (draft: Draft) => {
      const res = await createAutomation({ boardId, ...draft });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: automationsKey(boardId) });
      setMode("list");
      setInitialDraft(undefined);
    },
    onError: (e: Error) => setError(e.message),
  });

  const toggle = useMutation({
    mutationFn: async (vars: { id: string; enabled: boolean }) => {
      const res = await updateAutomation(vars);
      if (!res.ok) throw new Error(res.error);
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: automationsKey(boardId) });
      const previous = qc.getQueryData<Automation[]>(automationsKey(boardId));
      qc.setQueryData<Automation[]>(automationsKey(boardId), (prev) =>
        (prev ?? []).map((r) =>
          r.id === vars.id ? { ...r, enabled: vars.enabled } : r,
        ),
      );
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(automationsKey(boardId), ctx.previous);
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await deleteAutomation({ id });
      if (!res.ok) throw new Error(res.error);
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: automationsKey(boardId) });
      const previous = qc.getQueryData<Automation[]>(automationsKey(boardId));
      qc.setQueryData<Automation[]>(automationsKey(boardId), (prev) =>
        (prev ?? []).filter((r) => r.id !== id),
      );
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(automationsKey(boardId), ctx.previous);
    },
  });

  // Recipe availability: which quick-starts can be offered given the board.
  const statusColumns = useMemo(
    () => columns.filter((c) => c.kind === "status" || c.kind === "dropdown"),
    [columns],
  );
  const peopleColumns = useMemo(
    () => columns.filter((c) => c.kind === "people"),
    [columns],
  );
  const canNotifyOwner = statusColumns.length > 0 && peopleColumns.length > 0;
  const canSetOption = statusColumns.length >= 2;

  function startBuild(draft?: Draft) {
    setError(null);
    setInitialDraft(draft);
    setMode("build");
  }

  function closeAll(next: boolean) {
    if (!next) {
      setMode("list");
      setInitialDraft(undefined);
      setError(null);
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={closeAll}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="size-4" /> Automations
          </DialogTitle>
          <DialogDescription>
            Run actions automatically when a status or dropdown changes.
          </DialogDescription>
        </DialogHeader>

        {mode === "build" ? (
          <div className="flex flex-col gap-4">
            {/* Recipe quick-starts */}
            {(canNotifyOwner || canSetOption) && !initialDraft ? (
              <div className="flex flex-col gap-2">
                <p className="text-muted-foreground text-xs font-medium">
                  Start from a recipe
                </p>
                <div className="flex flex-wrap gap-2">
                  {canNotifyOwner ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        startBuild(
                          recipeNotifyOwner(
                            statusColumns[0].id,
                            null,
                            peopleColumns[0].id,
                          ),
                        )
                      }
                    >
                      Notify owner on status change
                    </Button>
                  ) : null}
                  {canSetOption ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const target = statusColumns[1];
                        const toOpt = columnOptions(target)[0]?.id ?? "";
                        startBuild(
                          recipeSetOption(
                            statusColumns[0].id,
                            null,
                            target.id,
                            toOpt,
                          ),
                        );
                      }}
                    >
                      Set another column on status change
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {error ? (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            ) : null}

            <AutomationBuilder
              columns={columns}
              members={members}
              initial={initialDraft}
              onSubmit={(draft) => create.mutate(draft)}
              onCancel={() => {
                setMode("list");
                setInitialDraft(undefined);
                setError(null);
              }}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex max-h-[50vh] flex-col gap-2 overflow-auto">
              {isLoading ? (
                <p className="text-muted-foreground text-sm">Loading…</p>
              ) : rules.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No automations yet. Create one to react to status changes.
                </p>
              ) : (
                rules.map((rule) => (
                  <div
                    key={rule.id}
                    className="bg-surface flex items-center gap-3 rounded-md border p-3"
                  >
                    <button
                      type="button"
                      role="switch"
                      aria-checked={rule.enabled}
                      aria-label={
                        rule.enabled
                          ? "Disable automation"
                          : "Enable automation"
                      }
                      onClick={() =>
                        toggle.mutate({ id: rule.id, enabled: !rule.enabled })
                      }
                      className={cn(
                        "focus-visible:ring-ring relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none",
                        rule.enabled ? "bg-primary" : "bg-muted",
                      )}
                    >
                      <span
                        className={cn(
                          "bg-background inline-block size-4 rounded-full shadow transition-transform",
                          rule.enabled ? "translate-x-4" : "translate-x-0.5",
                        )}
                      />
                    </button>
                    <p
                      className={cn(
                        "flex-1 text-sm",
                        !rule.enabled && "text-muted-foreground",
                      )}
                    >
                      {rule.name ? (
                        <span className="font-medium">{rule.name}: </span>
                      ) : null}
                      {summarize(rule, columns, members)}
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Delete automation"
                      onClick={() => remove.mutate(rule.id)}
                    >
                      <Trash2 className="text-destructive size-3.5" />
                    </Button>
                  </div>
                ))
              )}
            </div>

            <div>
              <Button onClick={() => startBuild()}>
                <Plus className="size-4" /> New automation
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

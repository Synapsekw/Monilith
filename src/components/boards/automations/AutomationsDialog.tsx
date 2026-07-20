"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Sparkles, Trash2, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { showMutationError } from "@/lib/ui/mutation-toast";
import { OPERATOR_LABEL } from "@/lib/dashboards/filter-meta";
import type { ListFilter } from "@/lib/validations/dashboards";
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
  getBoardAdminStatus,
  updateAutomation,
} from "@/lib/boards/automation-actions";
import { generateAutomationDraft } from "@/lib/ai/automation-gen-actions";
import {
  AutomationBuilder,
  columnOptions,
  type BuilderGroup,
  type BuilderMember,
} from "@/components/boards/automations/AutomationBuilder";
import { RecentRuns } from "./RecentRuns";
import {
  recipeNotifyOwner,
  recipeSetOption,
  recipeItemCreatedSetOption,
  recipePersonAssignedNotify,
  recipeDateReachedSetOption,
  recipeDueSoonNotifyOwner,
  recipeStatusChangedWebhook,
  recipeCompletedSetsPercent,
  recipePercentSetsCompleted,
  type Draft,
} from "@/components/boards/automations/recipes";

/** The completeness vocabulary shared with the overdue tint (spec §1). */
const DONE_LABEL = /done|complete/i;

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

/** Resolve a group name (falls back to a generic label). */
function groupName(groups: BuilderGroup[], id: string): string {
  return groups.find((g) => g.id === id)?.name ?? "a group";
}

function condClause(
  condition: ListFilter | null,
  columns: CacheColumn[],
): string {
  if (!condition?.conditions?.length) return "";
  const parts = condition.conditions.map((c) => {
    const name = colName(columns, c.columnId);
    const op = OPERATOR_LABEL[c.operator] ?? c.operator;
    // optName resolves option labels for status columns; for text/number/date it
    // falls back to the raw value, which is what we want.
    const val =
      c.value == null || `${c.value}` === ""
        ? ""
        : ` ${optName(columns, c.columnId, String(c.value))}`;
    return `${name} ${op}${val}`;
  });
  const joiner = condition.combinator === "or" ? " or " : " and ";
  return ` if ${parts.join(joiner)}`;
}

/** One-line, human-readable summary of an automation rule. */
function summarize(
  rule: Automation,
  columns: CacheColumn[],
  members: BuilderMember[],
  groups: BuilderGroup[],
): string {
  const trigger = rule.trigger as unknown as AutomationTrigger;
  const actions = rule.actions as unknown as AutomationAction[];
  const condition = rule.condition as unknown as ListFilter | null;

  let when: string;
  if (trigger.type === "item_created") {
    when = "When an item is created";
  } else if (trigger.type === "person_assigned") {
    when = `When someone is assigned in ${colName(columns, trigger.columnId)}`;
  } else if (trigger.type === "date_reached") {
    const col = colName(columns, trigger.columnId);
    const n = Math.abs(trigger.offsetDays);
    when =
      trigger.offsetDays === 0
        ? `When ${col} is reached`
        : trigger.offsetDays < 0
          ? `When ${col} is in ${n} day${n === 1 ? "" : "s"}`
          : `When ${col} is ${n} day${n === 1 ? "" : "s"} overdue`;
  } else if (trigger.type === "percent_reached") {
    when = `When ${colName(columns, trigger.columnId)} reaches ${trigger.percent}%`;
  } else {
    when =
      trigger.toOptionId == null
        ? `When ${colName(columns, trigger.columnId)} changes`
        : `When ${colName(columns, trigger.columnId)} changes to ${optName(
            columns,
            trigger.columnId,
            trigger.toOptionId,
          )}`;
  }

  const thens = actions.map((a) => {
    if (a.type === "notify") {
      return a.recipient.kind === "owner"
        ? `notify the owner (${colName(columns, a.recipient.peopleColumnId)})`
        : `notify ${memberName(members, a.recipient.userId)}`;
    }
    if (a.type === "call_webhook") {
      return "call a webhook";
    }
    if (a.type === "set_option") {
      return `set ${colName(columns, a.columnId)} to ${optName(
        columns,
        a.columnId,
        a.optionId,
      )}`;
    }
    if (a.type === "move_to_group") {
      return `move to ${groupName(groups, a.groupId)}`;
    }
    if (a.type === "set_percent") {
      return `set ${colName(columns, a.columnId)} to ${a.percent}%`;
    }
    return "do nothing";
  });

  return `${when}${condClause(condition, columns)}, ${thens.join(" and ")}.`;
}

export function AutomationsDialog({
  boardId,
  columns,
  members,
  groups = [],
  open,
  onOpenChange,
}: {
  boardId: string;
  columns: CacheColumn[];
  members: BuilderMember[];
  groups?: BuilderGroup[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"list" | "build">("list");
  const [initialDraft, setInitialDraft] = useState<Draft | undefined>();
  const [builderKey, setBuilderKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);

  const { data: rules = [], isLoading } = useQuery({
    queryKey: automationsKey(boardId),
    enabled: open,
    staleTime: 30_000,
    queryFn: () => getAutomations(boardId),
  });

  const { data: isAdmin = false } = useQuery({
    queryKey: ["board-admin", boardId] as const,
    enabled: open,
    staleTime: 60_000,
    queryFn: () => getBoardAdminStatus(boardId),
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

  // NL → automation draft. Never persists: it seeds the builder (the recipe
  // seam) so the human reviews and clicks Save (createAutomation) — the sole
  // write path, unchanged.
  const generate = useMutation({
    mutationFn: async (prompt: string) => {
      const res = await generateAutomationDraft({ boardId, prompt });
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
    onSuccess: (data) => {
      startBuild(data.draft);
      setAiWarnings(data.warnings);
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
    onError: (err, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(automationsKey(boardId), ctx.previous);
      showMutationError(
        "Couldn't update the automation — your change was undone.",
        err,
      );
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
    onError: (err, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(automationsKey(boardId), ctx.previous);
      showMutationError(
        "Couldn't delete the automation — it was restored.",
        err,
      );
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
  const dateColumns = useMemo(
    () => columns.filter((c) => c.kind === "date"),
    [columns],
  );
  // Percent-sync recipes need a real status column (the completeness column,
  // matching the overdue tint's definition) plus a percent column.
  const pureStatusColumns = useMemo(
    () => columns.filter((c) => c.kind === "status"),
    [columns],
  );
  const percentColumns = useMemo(
    () => columns.filter((c) => c.kind === "percent"),
    [columns],
  );
  const canNotifyOwner = statusColumns.length > 0 && peopleColumns.length > 0;
  const canSetOption = statusColumns.length >= 2;
  const canDateReachedSetOption =
    dateColumns.length > 0 && statusColumns.length > 0;
  const canDueSoonNotify = dateColumns.length > 0 && peopleColumns.length > 0;
  const canPercentSync =
    pureStatusColumns.length > 0 && percentColumns.length > 0;

  /** First /done|complete/i-labeled option of the first status column
   *  (fallback: its first option — the builder's picker lets the user correct it). */
  function doneOptionId(): string {
    const opts = pureStatusColumns[0]
      ? columnOptions(pureStatusColumns[0])
      : [];
    return (opts.find((o) => DONE_LABEL.test(o.label)) ?? opts[0])?.id ?? "";
  }

  function startBuild(draft?: Draft) {
    setError(null);
    setAiWarnings([]);
    setAiPrompt("");
    setInitialDraft(draft);
    setBuilderKey((k) => k + 1);
    setMode("build");
  }

  function closeAll(next: boolean) {
    if (!next) {
      setMode("list");
      setInitialDraft(undefined);
      setError(null);
      setAiWarnings([]);
      setAiPrompt("");
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
            Run actions automatically when items change, are created, or are
            assigned.
          </DialogDescription>
        </DialogHeader>

        {mode === "build" ? (
          <div className="flex flex-col gap-4">
            {/* Describe an automation (NL → draft; seeds the builder for review) */}
            {!initialDraft ? (
              <div className="flex flex-col gap-2">
                <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
                  <Sparkles className="size-3.5" /> Describe an automation
                </p>
                <div className="flex gap-2">
                  <Input
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    maxLength={1000}
                    aria-label="Describe an automation"
                    placeholder="e.g. When status changes to Done, notify the owner"
                    disabled={generate.isPending}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        aiPrompt.trim().length >= 3 &&
                        !generate.isPending
                      ) {
                        e.preventDefault();
                        generate.mutate(aiPrompt.trim());
                      }
                    }}
                  />
                  <Button
                    type="button"
                    onClick={() => generate.mutate(aiPrompt.trim())}
                    disabled={aiPrompt.trim().length < 3 || generate.isPending}
                  >
                    {generate.isPending ? "Generating…" : "Generate"}
                  </Button>
                </div>
              </div>
            ) : null}

            {aiWarnings.length > 0 ? (
              <div className="bg-surface-muted text-muted-foreground rounded-md border p-3 text-xs">
                <p className="mb-1 font-medium">Adjusted a few things:</p>
                <ul className="list-disc space-y-0.5 pl-4">
                  {aiWarnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* Recipe quick-starts */}
            {(canNotifyOwner ||
              canSetOption ||
              statusColumns.length > 0 ||
              peopleColumns.length > 0 ||
              canDateReachedSetOption ||
              canDueSoonNotify ||
              canPercentSync) &&
            !initialDraft ? (
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
                  {statusColumns.length > 0 ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const target = statusColumns[0];
                        const toOpt = columnOptions(target)[0]?.id ?? "";
                        startBuild(
                          recipeItemCreatedSetOption(target.id, toOpt),
                        );
                      }}
                    >
                      Set a column when an item is created
                    </Button>
                  ) : null}
                  {peopleColumns.length > 0 ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        startBuild(
                          recipePersonAssignedNotify(peopleColumns[0].id),
                        )
                      }
                    >
                      Notify on assignment
                    </Button>
                  ) : null}
                  {canDateReachedSetOption ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const target = statusColumns[0];
                        const toOpt = columnOptions(target)[0]?.id ?? "";
                        startBuild(
                          recipeDateReachedSetOption(
                            dateColumns[0].id,
                            target.id,
                            toOpt,
                          ),
                        );
                      }}
                    >
                      Set status when date is reached
                    </Button>
                  ) : null}
                  {canDueSoonNotify ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        startBuild(
                          recipeDueSoonNotifyOwner(
                            dateColumns[0].id,
                            peopleColumns[0].id,
                          ),
                        )
                      }
                    >
                      Notify owner before due date
                    </Button>
                  ) : null}
                  {canPercentSync ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        startBuild(
                          recipeCompletedSetsPercent(
                            pureStatusColumns[0].id,
                            doneOptionId(),
                            percentColumns[0].id,
                          ),
                        )
                      }
                    >
                      Completed sets 100%
                    </Button>
                  ) : null}
                  {canPercentSync ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        startBuild(
                          recipePercentSetsCompleted(
                            percentColumns[0].id,
                            pureStatusColumns[0].id,
                            doneOptionId(),
                          ),
                        )
                      }
                    >
                      100% sets Completed
                    </Button>
                  ) : null}
                  {isAdmin && statusColumns.length > 0 ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        startBuild(
                          recipeStatusChangedWebhook(
                            statusColumns[0].id,
                            null,
                            "",
                          ),
                        )
                      }
                    >
                      Call a webhook on status change
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
              key={builderKey}
              columns={columns}
              members={members}
              groups={groups}
              initial={initialDraft}
              canWebhook={isAdmin}
              boardId={boardId}
              onSubmit={(draft) => create.mutate(draft)}
              onCancel={() => {
                setMode("list");
                setInitialDraft(undefined);
                setError(null);
                setAiWarnings([]);
                setAiPrompt("");
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
                    className="bg-surface flex flex-col gap-2 rounded-md border p-3"
                  >
                    <div className="flex items-center gap-3">
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
                        {summarize(rule, columns, members, groups)}
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
                    <RecentRuns automationId={rule.id} />
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

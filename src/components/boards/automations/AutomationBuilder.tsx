"use client";

import { useState } from "react";
import { Trash2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  FilterBuilder,
  type FilterColumn,
} from "@/components/dashboards/FilterBuilder";
import { valueControlFor } from "@/lib/dashboards/filter-meta";
import type { CacheColumn } from "@/lib/boards/cache";
import type { ColumnOption } from "@/lib/validations/boards";
import type { ListFilter, FilterCondition } from "@/lib/validations/dashboards";
import type {
  AutomationAction,
  AutomationTrigger,
} from "@/lib/validations/automations";
import type { Draft } from "@/components/boards/automations/recipes";

export type BuilderMember = {
  userId: string;
  fullName: string | null;
  email: string | null;
};

/** Read the option list off a column's JSON settings (status/dropdown only). */
export function columnOptions(column: CacheColumn): ColumnOption[] {
  const settings = column.settings as { options?: ColumnOption[] } | null;
  return settings?.options ?? [];
}

const selectClass =
  "bg-background mt-1 w-full rounded-md border px-2 py-1.5 text-sm";

const ANY = "__any__";
const CONDITION_KINDS = ["status", "text", "numbers", "date"];
type TriggerType = AutomationTrigger["type"];

type DraftAction = AutomationAction & { _id: string };

let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `a${idCounter}`;
}
function withIds(actions: AutomationAction[]): DraftAction[] {
  return actions.map((a) => ({ ...a, _id: nextId() }));
}
function stripId(a: DraftAction): AutomationAction {
  const { _id, ...rest } = a;
  void _id;
  return rest;
}
function isActionComplete(a: AutomationAction): boolean {
  if (a.type === "notify") {
    return a.recipient.kind === "owner"
      ? !!a.recipient.peopleColumnId
      : !!a.recipient.userId;
  }
  return !!a.columnId && !!a.optionId;
}
function memberLabel(m: BuilderMember): string {
  return m.fullName ?? m.email ?? m.userId;
}
function isConditionComplete(c: FilterCondition, kind: string): boolean {
  if (valueControlFor(kind, c.operator) === "none") return true;
  return c.value !== undefined && c.value !== null && `${c.value}` !== "";
}

export function AutomationBuilder({
  columns,
  members,
  initial,
  onSubmit,
  onCancel,
}: {
  columns: CacheColumn[];
  members: BuilderMember[];
  initial?: Draft;
  onSubmit: (draft: Draft) => void;
  onCancel: () => void;
}) {
  const statusColumns = columns.filter(
    (c) => c.kind === "status" || c.kind === "dropdown",
  );
  const peopleColumns = columns.filter((c) => c.kind === "people");
  const conditionColumns: FilterColumn[] = columns
    .filter((c) => CONDITION_KINDS.includes(c.kind))
    .map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      options: columnOptions(c),
    }));

  const it = initial?.trigger;
  const [triggerType, setTriggerType] = useState<TriggerType>(
    it?.type ?? (statusColumns[0] ? "status_changed" : "item_created"),
  );
  const [statusColId, setStatusColId] = useState<string>(
    it?.type === "status_changed" ? it.columnId : (statusColumns[0]?.id ?? ""),
  );
  const [statusOptId, setStatusOptId] = useState<string>(
    it?.type === "status_changed" ? (it.toOptionId ?? ANY) : ANY,
  );
  const [peopleColId, setPeopleColId] = useState<string>(
    it?.type === "person_assigned" ? it.columnId : (peopleColumns[0]?.id ?? ""),
  );
  const [actions, setActions] = useState<DraftAction[]>(() =>
    initial ? withIds(initial.actions) : [],
  );
  const [condition, setCondition] = useState<ListFilter>(() => ({
    combinator: initial?.condition?.combinator ?? "and",
    conditions: initial?.condition?.conditions ?? [],
  }));
  const [showCondition, setShowCondition] = useState<boolean>(
    () => (initial?.condition?.conditions?.length ?? 0) > 0,
  );

  const trigger: AutomationTrigger =
    triggerType === "status_changed"
      ? {
          type: "status_changed",
          columnId: statusColId,
          toOptionId: statusOptId === ANY ? null : statusOptId,
        }
      : triggerType === "person_assigned"
        ? { type: "person_assigned", columnId: peopleColId }
        : { type: "item_created" };

  const triggerValid =
    triggerType === "status_changed"
      ? !!statusColId
      : triggerType === "person_assigned"
        ? !!peopleColId
        : true;

  const valid =
    triggerValid && actions.length > 0 && actions.every(isActionComplete);

  const triggerColumn = statusColumns.find((c) => c.id === statusColId);
  const triggerOpts = triggerColumn ? columnOptions(triggerColumn) : [];

  function updateAction(id: string, next: AutomationAction) {
    setActions((prev) =>
      prev.map((a) => (a._id === id ? { ...next, _id: id } : a)),
    );
  }
  function removeAction(id: string) {
    setActions((prev) => prev.filter((a) => a._id !== id));
  }
  function addNotify() {
    setActions((prev) => [
      ...prev,
      {
        _id: nextId(),
        type: "notify",
        recipient: {
          kind: "owner",
          peopleColumnId: peopleColumns[0]?.id ?? "",
        },
      },
    ]);
  }
  function addSetOption() {
    setActions((prev) => [
      ...prev,
      { _id: nextId(), type: "set_option", columnId: "", optionId: "" },
    ]);
  }

  function submit() {
    if (!valid) return;
    const cleaned = condition.conditions.filter((c) => {
      const col = columns.find((x) => x.id === c.columnId);
      return col && isConditionComplete(c, col.kind);
    });
    const cond =
      showCondition && cleaned.length > 0
        ? { combinator: condition.combinator ?? "and", conditions: cleaned }
        : undefined;
    onSubmit({ trigger, actions: actions.map(stripId), condition: cond });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* When */}
      <fieldset className="bg-surface flex flex-col gap-2 rounded-md border p-3">
        <legend className="text-muted-foreground px-1 text-xs font-medium">
          When
        </legend>
        <label className="text-sm">
          <span className="text-muted-foreground">Trigger</span>
          <select
            aria-label="Trigger type"
            className={selectClass}
            value={triggerType}
            onChange={(e) => setTriggerType(e.target.value as TriggerType)}
          >
            <option value="status_changed">A status or dropdown changes</option>
            <option value="item_created">An item is created</option>
            <option value="person_assigned">A person is assigned</option>
          </select>
        </label>

        {triggerType === "status_changed" ? (
          statusColumns.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Add a Status or Dropdown column to use this trigger.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm">
                <span className="text-muted-foreground">Column</span>
                <select
                  aria-label="Trigger column"
                  className={selectClass}
                  value={statusColId}
                  onChange={(e) => {
                    setStatusColId(e.target.value);
                    setStatusOptId(ANY);
                  }}
                >
                  {statusColumns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="text-muted-foreground">Changes to</span>
                <select
                  aria-label="Trigger value"
                  className={selectClass}
                  value={statusOptId}
                  onChange={(e) => setStatusOptId(e.target.value)}
                >
                  <option value={ANY}>Any value</option>
                  {triggerOpts.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )
        ) : null}

        {triggerType === "person_assigned" ? (
          peopleColumns.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Add a People column to use this trigger.
            </p>
          ) : (
            <label className="text-sm">
              <span className="text-muted-foreground">People column</span>
              <select
                aria-label="People column"
                className={selectClass}
                value={peopleColId}
                onChange={(e) => setPeopleColId(e.target.value)}
              >
                {peopleColumns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )
        ) : null}

        {triggerType === "item_created" ? (
          <p className="text-muted-foreground text-sm">
            Runs when a new item is added. Tip: cells are empty at creation —
            pair with &ldquo;Set a column&rdquo;.
          </p>
        ) : null}
      </fieldset>

      {/* If (optional) */}
      <fieldset className="bg-surface flex flex-col gap-2 rounded-md border p-3">
        <legend className="text-muted-foreground px-1 text-xs font-medium">
          If (optional)
        </legend>
        {conditionColumns.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Add a status, text, number, or date column to filter.
          </p>
        ) : showCondition ? (
          <>
            <FilterBuilder
              columns={conditionColumns}
              value={condition}
              onChange={setCondition}
            />
            <div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowCondition(false);
                  setCondition({ combinator: "and", conditions: [] });
                }}
              >
                Remove condition
              </Button>
            </div>
          </>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowCondition(true)}
          >
            <Plus className="size-3.5" /> Add condition
          </Button>
        )}
      </fieldset>

      {/* Then */}
      <fieldset className="bg-surface flex flex-col gap-2 rounded-md border p-3">
        <legend className="text-muted-foreground px-1 text-xs font-medium">
          Then
        </legend>

        {actions.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Add at least one action.
          </p>
        ) : (
          actions.map((action) => (
            <div
              key={action._id}
              className="flex items-start gap-2 rounded-md border p-2"
            >
              <div className="grid flex-1 grid-cols-2 gap-2">
                {action.type === "notify" ? (
                  <NotifyRow
                    action={action}
                    peopleColumns={peopleColumns}
                    members={members}
                    onChange={(next) => updateAction(action._id, next)}
                  />
                ) : (
                  <SetOptionRow
                    action={action}
                    statusColumns={statusColumns}
                    onChange={(next) => updateAction(action._id, next)}
                  />
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Remove action"
                onClick={() => removeAction(action._id)}
              >
                <Trash2 className="text-muted-foreground size-3.5" />
              </Button>
            </div>
          ))
        )}

        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={addNotify}>
            <Plus className="size-3.5" /> Notify
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addSetOption}
          >
            <Plus className="size-3.5" /> Set a column
          </Button>
        </div>
      </fieldset>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!valid}>
          Save
        </Button>
      </div>
    </div>
  );
}

function NotifyRow({
  action,
  peopleColumns,
  members,
  onChange,
}: {
  action: Extract<AutomationAction, { type: "notify" }>;
  peopleColumns: CacheColumn[];
  members: BuilderMember[];
  onChange: (next: AutomationAction) => void;
}) {
  const kind = action.recipient.kind;
  return (
    <>
      <label className="text-sm">
        <span className="text-muted-foreground">Notify</span>
        <select
          aria-label="Recipient type"
          className={selectClass}
          value={kind}
          onChange={(e) => {
            const k = e.target.value as "owner" | "member";
            onChange({
              type: "notify",
              recipient:
                k === "owner"
                  ? {
                      kind: "owner",
                      peopleColumnId: peopleColumns[0]?.id ?? "",
                    }
                  : { kind: "member", userId: members[0]?.userId ?? "" },
            });
          }}
        >
          <option value="owner">The item owner</option>
          <option value="member">A specific person</option>
        </select>
      </label>
      {kind === "owner" ? (
        <label className="text-sm">
          <span className="text-muted-foreground">From column</span>
          <select
            aria-label="Owner people column"
            className={selectClass}
            value={action.recipient.peopleColumnId}
            onChange={(e) =>
              onChange({
                type: "notify",
                recipient: { kind: "owner", peopleColumnId: e.target.value },
              })
            }
          >
            <option value="">Select…</option>
            {peopleColumns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label className="text-sm">
          <span className="text-muted-foreground">Person</span>
          <select
            aria-label="Member"
            className={selectClass}
            value={action.recipient.userId}
            onChange={(e) =>
              onChange({
                type: "notify",
                recipient: { kind: "member", userId: e.target.value },
              })
            }
          >
            <option value="">Select…</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {memberLabel(m)}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

function SetOptionRow({
  action,
  statusColumns,
  onChange,
}: {
  action: Extract<AutomationAction, { type: "set_option" }>;
  statusColumns: CacheColumn[];
  onChange: (next: AutomationAction) => void;
}) {
  const column = statusColumns.find((c) => c.id === action.columnId);
  const opts = column ? columnOptions(column) : [];
  return (
    <>
      <label className="text-sm">
        <span className="text-muted-foreground">Set column</span>
        <select
          aria-label="Set column"
          className={selectClass}
          value={action.columnId}
          onChange={(e) =>
            onChange({
              type: "set_option",
              columnId: e.target.value,
              optionId: "",
            })
          }
        >
          <option value="">Select…</option>
          {statusColumns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="text-muted-foreground">To</span>
        <select
          aria-label="Set value"
          className={selectClass}
          value={action.optionId}
          disabled={!action.columnId}
          onChange={(e) =>
            onChange({
              type: "set_option",
              columnId: action.columnId,
              optionId: e.target.value,
            })
          }
        >
          <option value="">Select…</option>
          {opts.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

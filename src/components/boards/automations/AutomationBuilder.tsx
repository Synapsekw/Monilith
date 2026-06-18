"use client";

import { useState } from "react";
import { Trash2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { CacheColumn } from "@/lib/boards/cache";
import type { ColumnOption } from "@/lib/validations/boards";
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

/** A draft action with a stable client id so React keys survive edits. */
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

  const [triggerColumnId, setTriggerColumnId] = useState<string>(
    initial?.trigger.columnId ?? statusColumns[0]?.id ?? "",
  );
  const [triggerOptionId, setTriggerOptionId] = useState<string>(
    initial?.trigger.toOptionId ?? ANY,
  );
  const [actions, setActions] = useState<DraftAction[]>(() =>
    initial ? withIds(initial.actions) : [],
  );

  if (statusColumns.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm">
          Add a Status or Dropdown column to this board to create automations.
        </p>
        <div className="flex justify-end">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  const triggerColumn = statusColumns.find((c) => c.id === triggerColumnId);
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

  const trigger: AutomationTrigger = {
    type: "status_changed",
    columnId: triggerColumnId,
    toOptionId: triggerOptionId === ANY ? null : triggerOptionId,
  };

  const valid =
    !!triggerColumnId &&
    actions.length > 0 &&
    actions.every((a) => isActionComplete(a));

  function submit() {
    if (!valid) return;
    onSubmit({ trigger, actions: actions.map(stripId) });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Trigger */}
      <fieldset className="bg-surface flex flex-col gap-2 rounded-md border p-3">
        <legend className="text-muted-foreground px-1 text-xs font-medium">
          When
        </legend>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm">
            <span className="text-muted-foreground">Column</span>
            <select
              aria-label="Trigger column"
              className={selectClass}
              value={triggerColumnId}
              onChange={(e) => {
                setTriggerColumnId(e.target.value);
                setTriggerOptionId(ANY);
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
              value={triggerOptionId}
              onChange={(e) => setTriggerOptionId(e.target.value)}
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
      </fieldset>

      {/* Actions */}
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

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

export type BuilderGroup = { id: string; name: string };

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
type DateDirection = "on" | "before" | "after";

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
  if (a.type === "call_webhook") {
    return /^https:\/\/.+/.test(a.url);
  }
  if (a.type === "set_option") {
    return !!a.columnId && !!a.optionId;
  }
  if (a.type === "move_to_group") {
    return !!a.groupId;
  }
  if (a.type === "set_percent") {
    return !!a.columnId && a.percent >= 0 && a.percent <= 100;
  }
  return false;
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
  groups = [],
  initial,
  canWebhook = false,
  onSubmit,
  onCancel,
}: {
  columns: CacheColumn[];
  members: BuilderMember[];
  groups?: BuilderGroup[];
  initial?: Draft;
  canWebhook?: boolean;
  onSubmit: (draft: Draft) => void;
  onCancel: () => void;
}) {
  const statusColumns = columns.filter(
    (c) => c.kind === "status" || c.kind === "dropdown",
  );
  const peopleColumns = columns.filter((c) => c.kind === "people");
  const dateColumns = columns.filter((c) => c.kind === "date");
  const percentColumns = columns.filter((c) => c.kind === "percent");
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
  const [dateColId, setDateColId] = useState<string>(
    it?.type === "date_reached" ? it.columnId : (dateColumns[0]?.id ?? ""),
  );
  const [percentColId, setPercentColId] = useState<string>(
    it?.type === "percent_reached"
      ? it.columnId
      : (percentColumns[0]?.id ?? ""),
  );
  const [percentThreshold, setPercentThreshold] = useState<number>(
    it?.type === "percent_reached" ? (it.percent ?? 100) : 100,
  );
  const [dateDirection, setDateDirection] = useState<DateDirection>(() => {
    if (it?.type === "date_reached") {
      if (it.offsetDays === 0) return "on";
      return it.offsetDays < 0 ? "before" : "after";
    }
    return "before";
  });
  const [dateCount, setDateCount] = useState<number>(() => {
    if (it?.type === "date_reached" && it.offsetDays !== 0) {
      return Math.abs(it.offsetDays);
    }
    return 3;
  });
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
        : triggerType === "date_reached"
          ? {
              type: "date_reached",
              columnId: dateColId,
              offsetDays:
                dateDirection === "on"
                  ? 0
                  : dateDirection === "before"
                    ? -Math.abs(dateCount)
                    : Math.abs(dateCount),
            }
          : triggerType === "percent_reached"
            ? {
                type: "percent_reached",
                columnId: percentColId,
                percent: percentThreshold,
              }
            : { type: "item_created" };

  const triggerValid =
    triggerType === "status_changed"
      ? !!statusColId
      : triggerType === "person_assigned"
        ? !!peopleColId
        : triggerType === "date_reached"
          ? !!dateColId
          : triggerType === "percent_reached"
            ? !!percentColId
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
  function addWebhook() {
    setActions((prev) => [
      ...prev,
      { _id: nextId(), type: "call_webhook", url: "" },
    ]);
  }
  function addMoveToGroup() {
    setActions((prev) => [
      ...prev,
      { _id: nextId(), type: "move_to_group", groupId: "" },
    ]);
  }
  function addSetPercent() {
    setActions((prev) => [
      ...prev,
      {
        _id: nextId(),
        type: "set_percent",
        columnId: percentColumns[0]?.id ?? "",
        percent: 100,
      },
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
            <option value="date_reached">Date reached</option>
            <option value="percent_reached">
              A percent reaches a threshold
            </option>
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

        {triggerType === "date_reached" ? (
          dateColumns.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Add a Date column to use this trigger.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <label className="text-sm">
                <span className="text-muted-foreground">Date column</span>
                <select
                  aria-label="Date column"
                  className={selectClass}
                  value={dateColId}
                  onChange={(e) => setDateColId(e.target.value)}
                >
                  {dateColumns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-sm">
                  <span className="text-muted-foreground">Direction</span>
                  <select
                    aria-label="Direction"
                    className={selectClass}
                    value={dateDirection}
                    onChange={(e) =>
                      setDateDirection(e.target.value as DateDirection)
                    }
                  >
                    <option value="before">N days before</option>
                    <option value="on">On the date</option>
                    <option value="after">N days after</option>
                  </select>
                </label>
                <label className="text-sm">
                  <span className="text-muted-foreground">Days</span>
                  <input
                    aria-label="Days count"
                    type="number"
                    min={1}
                    max={365}
                    className={selectClass}
                    value={dateCount}
                    disabled={dateDirection === "on"}
                    onChange={(e) =>
                      setDateCount(
                        Math.max(1, parseInt(e.target.value, 10) || 1),
                      )
                    }
                  />
                </label>
              </div>
            </div>
          )
        ) : null}

        {triggerType === "percent_reached" ? (
          percentColumns.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Add a Percent column to use this trigger.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm">
                <span className="text-muted-foreground">Percent column</span>
                <select
                  aria-label="Percent column"
                  className={selectClass}
                  value={percentColId}
                  onChange={(e) => setPercentColId(e.target.value)}
                >
                  {percentColumns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="text-muted-foreground">Reaches (%)</span>
                <input
                  aria-label="Percent threshold"
                  type="number"
                  min={1}
                  max={100}
                  className={selectClass}
                  value={percentThreshold}
                  onChange={(e) =>
                    setPercentThreshold(
                      Math.min(
                        100,
                        Math.max(1, parseInt(e.target.value, 10) || 100),
                      ),
                    )
                  }
                />
              </label>
            </div>
          )
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
                ) : action.type === "call_webhook" ? (
                  <WebhookRow
                    action={action}
                    onChange={(next) => updateAction(action._id, next)}
                  />
                ) : action.type === "set_option" ? (
                  <SetOptionRow
                    action={action}
                    statusColumns={statusColumns}
                    onChange={(next) => updateAction(action._id, next)}
                  />
                ) : action.type === "move_to_group" ? (
                  <MoveToGroupRow
                    action={action}
                    groups={groups}
                    onChange={(next) => updateAction(action._id, next)}
                  />
                ) : action.type === "set_percent" ? (
                  <SetPercentRow
                    action={action}
                    percentColumns={percentColumns}
                    onChange={(next) => updateAction(action._id, next)}
                  />
                ) : null}
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addMoveToGroup}
          >
            <Plus className="size-3.5" /> Move to group
          </Button>
          {percentColumns.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addSetPercent}
            >
              <Plus className="size-3.5" /> Set percent
            </Button>
          ) : null}
          {canWebhook ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addWebhook}
            >
              <Plus className="size-3.5" /> Call a webhook
            </Button>
          ) : null}
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

function MoveToGroupRow({
  action,
  groups,
  onChange,
}: {
  action: Extract<AutomationAction, { type: "move_to_group" }>;
  groups: BuilderGroup[];
  onChange: (next: AutomationAction) => void;
}) {
  return (
    <label className="col-span-2 text-sm">
      <span className="text-muted-foreground">Move to group</span>
      <select
        aria-label="Target group"
        className={selectClass}
        value={action.groupId}
        onChange={(e) =>
          onChange({ type: "move_to_group", groupId: e.target.value })
        }
      >
        <option value="">Select…</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function SetPercentRow({
  action,
  percentColumns,
  onChange,
}: {
  action: Extract<AutomationAction, { type: "set_percent" }>;
  percentColumns: CacheColumn[];
  onChange: (next: AutomationAction) => void;
}) {
  return (
    <>
      <label className="text-sm">
        <span className="text-muted-foreground">Set percent column</span>
        <select
          aria-label="Set percent column"
          className={selectClass}
          value={action.columnId}
          onChange={(e) =>
            onChange({
              type: "set_percent",
              columnId: e.target.value,
              percent: action.percent,
            })
          }
        >
          <option value="">Select…</option>
          {percentColumns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="text-muted-foreground">To (%)</span>
        <input
          aria-label="Percent value"
          type="number"
          min={0}
          max={100}
          className={selectClass}
          value={action.percent}
          onChange={(e) =>
            onChange({
              type: "set_percent",
              columnId: action.columnId,
              percent: Math.min(
                100,
                Math.max(0, parseInt(e.target.value, 10) || 0),
              ),
            })
          }
        />
      </label>
    </>
  );
}

function WebhookRow({
  action,
  onChange,
}: {
  action: Extract<AutomationAction, { type: "call_webhook" }>;
  onChange: (next: AutomationAction) => void;
}) {
  const urlInvalid = action.url.length > 0 && !/^https:\/\/.+/.test(action.url);
  const header = action.authHeader;
  function patch(
    next: Partial<Extract<AutomationAction, { type: "call_webhook" }>>,
  ) {
    const merged = {
      type: "call_webhook" as const,
      url: action.url,
      authHeader: action.authHeader,
      ...next,
    };
    if (merged.authHeader === undefined) {
      const { authHeader: _ah, ...withoutHeader } = merged;
      void _ah;
      onChange(withoutHeader);
    } else {
      onChange(merged);
    }
  }
  return (
    <>
      <label className="col-span-2 text-sm">
        <span className="text-muted-foreground">Webhook URL</span>
        <input
          aria-label="Webhook URL"
          type="url"
          inputMode="url"
          placeholder="https://hooks.example.com/…"
          className={selectClass}
          value={action.url}
          onChange={(e) => patch({ url: e.target.value })}
        />
        {urlInvalid ? (
          <span className="text-destructive mt-1 block text-xs">
            Must start with https://
          </span>
        ) : null}
      </label>
      <label className="text-sm">
        <span className="text-muted-foreground">Header name (optional)</span>
        <input
          aria-label="Auth header name"
          className={selectClass}
          placeholder="Authorization"
          value={header?.name ?? ""}
          onChange={(e) => {
            const name = e.target.value;
            patch({
              authHeader:
                name || header?.value
                  ? { name, value: header?.value ?? "" }
                  : undefined,
            });
          }}
        />
      </label>
      <label className="text-sm">
        <span className="text-muted-foreground">Header value (optional)</span>
        <input
          aria-label="Auth header value"
          className={selectClass}
          placeholder="Bearer …"
          value={header?.value ?? ""}
          onChange={(e) => {
            const value = e.target.value;
            patch({
              authHeader:
                value || header?.name
                  ? { name: header?.name ?? "", value }
                  : undefined,
            });
          }}
        />
      </label>
    </>
  );
}

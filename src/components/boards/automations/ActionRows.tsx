"use client";

import type { CacheColumn } from "@/lib/boards/cache";
import type { AutomationAction } from "@/lib/validations/automations";
import {
  columnOptions,
  memberLabel,
  selectClass,
  type BuilderGroup,
  type BuilderMember,
} from "@/components/boards/automations/builder-utils";

export function NotifyRow({
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

export function SetOptionRow({
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

export function MoveToGroupRow({
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

export function SetPercentRow({
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

export function WebhookRow({
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

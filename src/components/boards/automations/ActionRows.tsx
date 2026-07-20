"use client";

import { useState, useTransition } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import type { CacheColumn } from "@/lib/boards/cache";
import {
  AI_STEP_ALLOWED_ACTIONS,
  type AutomationAction,
  type AiStepAllowedAction,
} from "@/lib/validations/automations";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { previewAiStep, type AiStepPreview } from "@/lib/ai/agentic/actions";
import {
  columnOptions,
  memberLabel,
  selectClass,
  type BuilderGroup,
  type BuilderMember,
} from "@/components/boards/automations/builder-utils";

/** Human labels for the bounded, reversible actions an AI step may choose. */
const AI_ALLOW_LABELS: Record<AiStepAllowedAction, string> = {
  set_option: "Set a status",
  set_percent: "Set percent",
  move_to_group: "Move to group",
  notify: "Notify",
};

/** One-line summary of the action the dry-run chose, for the preview panel. */
function describeChosen(action: AutomationAction): string {
  switch (action.type) {
    case "set_option":
      return "Set a status option";
    case "set_percent":
      return `Set percent to ${action.percent}%`;
    case "move_to_group":
      return "Move the item to a group";
    case "notify":
      return action.recipient.kind === "owner"
        ? "Notify the item owner"
        : "Notify a specific member";
    default:
      return action.type;
  }
}

export function AiStepRow({
  action,
  boardId,
  onChange,
}: {
  action: Extract<AutomationAction, { type: "ai_step" }>;
  boardId?: string;
  onChange: (next: AutomationAction) => void;
}) {
  const [preview, setPreview] = useState<AiStepPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [pending, startTest] = useTransition();

  function toggleAllow(kind: AiStepAllowedAction) {
    const has = action.allow.includes(kind);
    const next = has
      ? action.allow.filter((k) => k !== kind)
      : [...action.allow, kind];
    // Keep at least one allowed action (the schema requires min 1).
    if (next.length === 0) return;
    onChange({ ...action, allow: next });
  }

  const canTest =
    !!boardId &&
    action.instruction.trim().length >= 3 &&
    action.allow.length > 0;

  function runTest() {
    if (!boardId) return;
    setPreviewError(null);
    setPreview(null);
    startTest(async () => {
      const res = await previewAiStep({
        boardId,
        instruction: action.instruction,
        allow: action.allow,
      });
      if (res.ok) setPreview(res.data);
      else setPreviewError(res.error);
    });
  }

  return (
    <div className="col-span-2 flex flex-col gap-3">
      <label className="text-sm">
        <span className="text-muted-foreground">AI instruction</span>
        <Textarea
          aria-label="AI instruction"
          className="mt-1 min-h-16"
          placeholder="e.g. Pick the most fitting status for this item"
          value={action.instruction}
          maxLength={500}
          onChange={(e) => onChange({ ...action, instruction: e.target.value })}
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-muted-foreground text-sm">The AI may only</span>
        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-label="Allowed actions"
        >
          {AI_STEP_ALLOWED_ACTIONS.map((kind) => {
            const active = action.allow.includes(kind);
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={active}
                onClick={() => toggleAllow(kind)}
                className={cn(
                  "rounded-sm border px-2.5 py-0.5 text-xs font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground border-transparent"
                    : "text-muted-foreground hover:border-border-hover hover:text-foreground",
                )}
              >
                {AI_ALLOW_LABELS[kind]}
              </button>
            );
          })}
        </div>
      </div>

      {boardId ? (
        <div className="flex flex-col gap-2">
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canTest || pending}
              onClick={runTest}
            >
              {pending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              Test this step
            </Button>
          </div>

          {previewError ? (
            <p role="alert" className="text-destructive text-xs">
              {previewError}
            </p>
          ) : null}

          {preview ? (
            <div className="bg-surface-muted rounded-md border p-2.5 text-xs">
              {preview.sampleItem ? (
                <p className="text-muted-foreground mb-1">
                  Tested against{" "}
                  <span className="text-foreground font-medium">
                    {preview.sampleItem.name}
                  </span>
                </p>
              ) : (
                <p className="text-muted-foreground">
                  No items on this board yet to test against.
                </p>
              )}
              {preview.action ? (
                <p className="text-foreground font-medium">
                  Would {describeChosen(preview.action).toLowerCase()} (not
                  applied)
                </p>
              ) : preview.sampleItem ? (
                <p className="text-muted-foreground">
                  The AI chose to take no action.
                </p>
              ) : null}
              {preview.warnings.length > 0 ? (
                <ul className="text-muted-foreground mt-1 list-inside list-disc">
                  {preview.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

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

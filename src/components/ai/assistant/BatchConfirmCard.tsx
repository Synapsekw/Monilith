"use client";

import { useId, useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kicker } from "@/components/ui/kicker";
import type { ConfirmState } from "@/components/ai/actions/ActionConfirmCard";
import type { StagedCall } from "@/lib/assistant/staged";

/** Longest value shown in Details, so one huge field cannot swamp the card. */
const MAX_VALUE_CHARS = 200;

function showValue(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > MAX_VALUE_CHARS
    ? `${text.slice(0, MAX_VALUE_CHARS)}…`
    : text;
}

/**
 * What a row will actually do: the tool and every input it will run with.
 * The summary line names no target and no values, so thirty identical rows
 * cannot be told apart without this. Values render as text, never as HTML.
 * Destructive rows open by default.
 */
function CallDetails({ call }: { call: StagedCall }) {
  const entries = Object.entries(call.input);
  return (
    <details open={call.destructive} className="group ml-8 pb-1">
      <summary className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 w-fit cursor-pointer rounded-sm px-1.5 py-0.5 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none pointer-coarse:min-h-11">
        Details
      </summary>
      <dl className="bg-surface-sunken mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-sm border px-2.5 py-1.5 text-xs">
        <dt className="text-kicker font-mono">tool</dt>
        <dd className="text-foreground font-mono break-all">{call.tool}</dd>
        {entries.map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-kicker font-mono break-all">{key}</dt>
            <dd className="text-foreground font-mono break-all whitespace-pre-wrap">
              {showValue(value)}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/**
 * One card for every change the assistant lined up in a turn. Presentational:
 * the parent owns the Server Action call and the resolved state. Sits beside
 * ActionConfirmCard and shares its surface, hairline and button language.
 */
export function BatchConfirmCard({
  calls,
  state,
  resultNote,
  onApply,
  onDismiss,
}: {
  calls: StagedCall[];
  state: ConfirmState;
  resultNote?: string;
  onApply: (selectedIds: string[]) => void;
  onDismiss: () => void;
}) {
  const baseId = useId();
  // Destructive rows start unticked: the user opts in to each one.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(calls.filter((c) => !c.destructive).map((c) => c.id)),
  );
  const resolved = state === "done" || state === "error";
  const locked = state === "running" || resolved;
  const count = selected.size;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section
      aria-label="Changes waiting for your confirmation"
      className="bg-surface hover:border-border-hover rounded-lg border p-3 text-sm transition-colors"
    >
      <Kicker>
        {calls.length} {calls.length === 1 ? "change" : "changes"} waiting
      </Kicker>
      <ul className="mt-2 flex flex-col gap-0.5">
        {calls.map((call) => {
          const id = `${baseId}-${call.id}`;
          return (
            <li key={call.id}>
              <label
                htmlFor={id}
                className={`hover:bg-state-hover flex cursor-pointer items-start gap-2.5 rounded-sm px-1.5 py-1.5 transition-colors pointer-coarse:min-h-11 ${
                  call.destructive ? "text-destructive" : "text-foreground"
                } ${locked ? "cursor-default" : ""}`}
              >
                <input
                  id={id}
                  type="checkbox"
                  className="accent-primary focus-visible:ring-ring/50 mt-0.5 size-4 shrink-0 cursor-pointer rounded-sm focus-visible:ring-2 disabled:cursor-default disabled:opacity-50"
                  checked={selected.has(call.id)}
                  disabled={locked}
                  onChange={() => toggle(call.id)}
                />
                <span>
                  {call.summary}
                  {call.destructive ? (
                    <span className="text-muted-foreground ml-1.5 text-xs">
                      {" (cannot be undone here)"}
                    </span>
                  ) : null}
                </span>
              </label>
              <CallDetails call={call} />
            </li>
          );
        })}
      </ul>
      {resolved ? (
        <p
          role="status"
          aria-live="polite"
          className={`mt-2 text-xs ${state === "error" ? "text-destructive" : "text-muted-foreground"}`}
        >
          {resultNote}
        </p>
      ) : (
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={locked}
            onClick={onDismiss}
          >
            <X className="size-3.5" /> Dismiss
          </Button>
          <Button
            size="sm"
            disabled={locked || count === 0}
            onClick={() =>
              onApply(calls.filter((c) => selected.has(c.id)).map((c) => c.id))
            }
          >
            <Check className="size-3.5" />
            {state === "running"
              ? "Applying…"
              : `Apply ${count} ${count === 1 ? "change" : "changes"}`}
          </Button>
        </div>
      )}
    </section>
  );
}

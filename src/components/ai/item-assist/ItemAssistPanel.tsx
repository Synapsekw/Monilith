"use client";

import { type ReactNode, useState, useTransition } from "react";
import { FileText, ListChecks, Tag } from "lucide-react";
import { generateItemAssist } from "@/lib/ai/item-assist/actions";
import { upsertCell } from "@/lib/boards/actions/cell";
import { addSubitem } from "@/lib/boards/actions/item";
import type { Column } from "@/lib/collaboration/activity";
import type { ColumnOption } from "@/lib/validations/boards";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ColorChip } from "@/components/ui/color-chip";
import { Kicker } from "@/components/ui/kicker";
import { cn } from "@/lib/utils";

/** Local phase for a single assist entry's propose→review→apply flow. */
type Phase = "idle" | "loading" | "review" | "applying";

const SELECT_CLASS = cn(
  "border-border bg-background text-foreground hover:bg-state-hover hover:border-border-hover",
  "focus-visible:ring-ring/50 focus-visible:border-ring h-7 min-w-0 flex-1 truncate rounded-md",
  "border px-2 text-xs transition-colors focus-visible:ring-3 focus-visible:outline-none",
  "disabled:pointer-events-none disabled:opacity-50",
);

function optionsFor(column: Column | undefined): ColumnOption[] {
  const settings = column?.settings as { options?: ColumnOption[] } | null;
  return settings?.options ?? [];
}

/**
 * F7 item-assist panel: three independent propose→review→apply entries
 * (draft description / suggest subtasks / set status). Opening the panel and
 * switching entries is local state only — a server call happens ONLY on
 * Draft/Suggest/Propose or Apply (spec perf budget, gotcha-09). Apply reuses
 * the existing board write actions (`upsertCell` / `addSubitem`) — this
 * panel never writes directly.
 */
export function ItemAssistPanel({
  itemId,
  columns,
  isSubitem = false,
}: {
  itemId: string;
  boardId: string;
  columns: readonly Column[];
  isSubitem?: boolean;
}) {
  const textColumns = columns.filter((c) => c.kind === "text");
  const statusColumns = columns.filter(
    (c) => c.kind === "status" || c.kind === "dropdown",
  );

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Kicker index="AI">Item assist</Kicker>
        <p className="text-muted-foreground text-xs">
          Uses this item&rsquo;s text to draft with AI.
        </p>
      </div>
      <div className="space-y-3">
        <DescriptionEntry itemId={itemId} textColumns={textColumns} />
        <SubtasksEntry itemId={itemId} isSubitem={isSubitem} />
        <StatusEntry itemId={itemId} statusColumns={statusColumns} />
      </div>
    </div>
  );
}

/** Shared chrome for one assist entry: icon + title, and either a hint (when
 * disabled) or the entry's own controls. */
function AssistEntryCard({
  icon,
  title,
  disabled,
  hint,
  children,
}: {
  icon: ReactNode;
  title: string;
  disabled: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "bg-surface ease-keystone rounded-lg border p-3 transition-colors",
        disabled ? "opacity-60" : "hover:border-border-hover",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground" aria-hidden="true">
          {icon}
        </span>
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      {disabled && hint ? (
        <p className="text-muted-foreground mt-1.5 text-xs">{hint}</p>
      ) : (
        <div className="mt-2 space-y-2">{children}</div>
      )}
    </div>
  );
}

function EntryError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-destructive text-xs">
      {message}
    </p>
  );
}

// ── Entry 1: draft description ────────────────────────────────────────────

function DescriptionEntry({
  itemId,
  textColumns,
}: {
  itemId: string;
  textColumns: Column[];
}) {
  const disabled = textColumns.length === 0;
  const [columnId, setColumnId] = useState(textColumns[0]?.id ?? "");
  const [phase, setPhase] = useState<Phase>("idle");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function draft() {
    if (disabled || !columnId) return;
    setError(null);
    startTransition(async () => {
      setPhase("loading");
      const res = await generateItemAssist({
        itemId,
        want: { description: { columnId } },
      });
      if (!res.ok) {
        setError(res.error);
        setPhase("idle");
        return;
      }
      setText(res.data.proposal.description ?? "");
      setPhase("review");
    });
  }

  function apply() {
    setError(null);
    startTransition(async () => {
      setPhase("applying");
      const res = await upsertCell({ itemId, columnId, value: { text } });
      if (!res.ok) {
        setError(res.error);
        setPhase("review");
        return;
      }
      setText("");
      setPhase("idle");
    });
  }

  function discard() {
    setText("");
    setError(null);
    setPhase("idle");
  }

  return (
    <AssistEntryCard
      icon={<FileText className="size-4" />}
      title="Draft description"
      disabled={disabled}
      hint="Add a text column to draft a description into."
    >
      <div className="flex items-center gap-2">
        <select
          aria-label="Description column"
          value={columnId}
          onChange={(e) => setColumnId(e.target.value)}
          disabled={phase !== "idle"}
          className={SELECT_CLASS}
        >
          {textColumns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          onClick={draft}
          disabled={phase === "loading" || phase === "applying"}
        >
          {phase === "loading" ? "Drafting…" : "Draft"}
        </Button>
      </div>

      {phase === "review" || phase === "applying" ? (
        <div className="space-y-2">
          <Textarea
            aria-label="Proposed description"
            rows={4}
            value={text}
            disabled={phase === "applying"}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={discard}
              disabled={phase === "applying"}
            >
              Discard
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={apply}
              disabled={phase === "applying" || text.trim().length === 0}
            >
              {phase === "applying" ? "Applying…" : "Apply"}
            </Button>
          </div>
        </div>
      ) : null}

      <EntryError message={error} />
    </AssistEntryCard>
  );
}

// ── Entry 2: suggest subtasks ─────────────────────────────────────────────

type SubtaskProposal = { name: string; accepted: boolean };

function SubtasksEntry({
  itemId,
  isSubitem,
}: {
  itemId: string;
  isSubitem: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [items, setItems] = useState<SubtaskProposal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function suggest() {
    if (isSubitem) return;
    setError(null);
    startTransition(async () => {
      setPhase("loading");
      const res = await generateItemAssist({
        itemId,
        want: { subtasks: true },
      });
      if (!res.ok) {
        setError(res.error);
        setPhase("idle");
        return;
      }
      setItems(
        (res.data.proposal.subtasks ?? []).map((name) => ({
          name,
          accepted: true,
        })),
      );
      setPhase("review");
    });
  }

  function apply() {
    const accepted = items.filter(
      (i) => i.accepted && i.name.trim().length > 0,
    );
    if (accepted.length === 0) {
      discard();
      return;
    }
    setError(null);
    startTransition(async () => {
      setPhase("applying");
      for (const s of accepted) {
        const res = await addSubitem({ parentId: itemId, name: s.name.trim() });
        if (!res.ok) {
          setError(res.error);
          setPhase("review");
          return;
        }
      }
      setItems([]);
      setPhase("idle");
    });
  }

  function discard() {
    setItems([]);
    setError(null);
    setPhase("idle");
  }

  function update(index: number, patch: Partial<SubtaskProposal>) {
    setItems((prev) =>
      prev.map((it, i) => (i === index ? { ...it, ...patch } : it)),
    );
  }

  return (
    <AssistEntryCard
      icon={<ListChecks className="size-4" />}
      title="Suggest subtasks"
      disabled={isSubitem}
      hint="Subtasks can't be added to a subitem."
    >
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={suggest}
          disabled={phase === "loading" || phase === "applying"}
        >
          {phase === "loading" ? "Suggesting…" : "Suggest"}
        </Button>
      </div>

      {phase === "review" || phase === "applying" ? (
        <div className="space-y-2">
          {items.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              No subtasks suggested.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {items.map((it, i) => (
                <li key={i} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={it.accepted}
                    disabled={phase === "applying"}
                    onChange={(e) => update(i, { accepted: e.target.checked })}
                    aria-label={`Accept subtask ${i + 1}`}
                    className="accent-primary size-4 shrink-0"
                  />
                  <input
                    type="text"
                    value={it.name}
                    disabled={phase === "applying"}
                    onChange={(e) => update(i, { name: e.target.value })}
                    aria-label={`Subtask ${i + 1} name`}
                    className="border-border bg-background focus-visible:ring-ring/50 focus-visible:border-ring h-7 min-w-0 flex-1 rounded-md border px-2 text-xs transition-colors focus-visible:ring-3 focus-visible:outline-none disabled:opacity-50"
                  />
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={discard}
              disabled={phase === "applying"}
            >
              Discard
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={apply}
              disabled={phase === "applying"}
            >
              {phase === "applying" ? "Applying…" : "Apply"}
            </Button>
          </div>
        </div>
      ) : null}

      <EntryError message={error} />
    </AssistEntryCard>
  );
}

// ── Entry 3: set status ───────────────────────────────────────────────────

function StatusEntry({
  itemId,
  statusColumns,
}: {
  itemId: string;
  statusColumns: Column[];
}) {
  const disabled = statusColumns.length === 0;
  const [columnId, setColumnId] = useState(statusColumns[0]?.id ?? "");
  const [phase, setPhase] = useState<Phase>("idle");
  const [optionId, setOptionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const column = statusColumns.find((c) => c.id === columnId);
  const proposedOption = optionsFor(column).find((o) => o.id === optionId);

  function propose() {
    if (disabled || !columnId) return;
    setError(null);
    startTransition(async () => {
      setPhase("loading");
      const res = await generateItemAssist({
        itemId,
        want: { status: { columnId } },
      });
      if (!res.ok) {
        setError(res.error);
        setPhase("idle");
        return;
      }
      setOptionId(res.data.proposal.status?.optionId ?? null);
      setPhase("review");
    });
  }

  function apply() {
    if (!optionId || !column) return;
    setError(null);
    startTransition(async () => {
      setPhase("applying");
      // Status columns store `{ optionId }`; dropdown columns store
      // `{ optionIds: [optionId] }` (single-element array) — branch on the
      // chosen column's kind or the write is rejected by cellValueSchema.
      const value =
        column.kind === "dropdown" ? { optionIds: [optionId] } : { optionId };
      const res = await upsertCell({ itemId, columnId, value });
      if (!res.ok) {
        setError(res.error);
        setPhase("review");
        return;
      }
      setOptionId(null);
      setPhase("idle");
    });
  }

  function discard() {
    setOptionId(null);
    setError(null);
    setPhase("idle");
  }

  return (
    <AssistEntryCard
      icon={<Tag className="size-4" />}
      title="Set status"
      disabled={disabled}
      hint="Add a status or dropdown column to set a status."
    >
      <div className="flex items-center gap-2">
        <select
          aria-label="Status column"
          value={columnId}
          onChange={(e) => setColumnId(e.target.value)}
          disabled={phase !== "idle"}
          className={SELECT_CLASS}
        >
          {statusColumns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          onClick={propose}
          disabled={phase === "loading" || phase === "applying"}
        >
          {phase === "loading" ? "Proposing…" : "Propose"}
        </Button>
      </div>

      {phase === "review" || phase === "applying" ? (
        <div className="space-y-2">
          {proposedOption ? (
            <ColorChip color={proposedOption.color}>
              {proposedOption.label}
            </ColorChip>
          ) : (
            <p className="text-muted-foreground text-xs">No option proposed.</p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={discard}
              disabled={phase === "applying"}
            >
              Discard
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={apply}
              disabled={phase === "applying" || !optionId}
            >
              {phase === "applying" ? "Applying…" : "Apply"}
            </Button>
          </div>
        </div>
      ) : null}

      <EntryError message={error} />
    </AssistEntryCard>
  );
}

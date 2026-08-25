"use client";

import {
  documentBudget,
  estimateTokens,
  ASSUMED_PREFIX_TOKENS,
  NULL_CONTEXT_FALLBACK,
} from "@/lib/agents/document-budget";
import type { AgentDocumentRow } from "@/lib/agents/documents-db";

/**
 * The attach picker + live budget meter for one agent's reference documents.
 *
 * PURE CLIENT STATE. `documents` (metadata + `token_estimate`, never `body`)
 * and `instructions` are already in the parent form's hands — every render
 * recomputes {@link documentBudget} from them, so selecting a document,
 * deselecting one, and editing the instructions field all cost ZERO server
 * round-trips (working agreement #5). `onChange` is the only thing this
 * component does — no Server Action fires here. `AgentEditor` holds
 * `selectedDocumentIds` as its own form state and calls `setAgentDocuments`
 * once, on save, exactly like every other field in that form.
 *
 * `ASSUMED_PREFIX_TOKENS` is imported from `document-budget.ts`, never
 * re-declared — the run loop's own injection call site (Task 6) imports the
 * SAME constant, and this meter's entire guarantee is that it never promises
 * room the run doesn't have. A local `9_000` here would be exactly the
 * silent-drift bug that constant exists to prevent.
 *
 * Selecting is never blocked for a document that is ALREADY selected, even
 * when the total is over budget — only unselected documents that would push
 * the total over are disabled. An owner who is already over budget (a model
 * swap can do this without touching a single document) must always have a
 * way back under; a control that disables its own escape hatch is the one
 * failure mode worse than the overrun itself.
 */
export function DocumentPicker({
  documents,
  selectedIds,
  onChange,
  contextLength,
  instructions,
}: {
  documents: AgentDocumentRow[];
  selectedIds: string[];
  onChange: (next: string[]) => void;
  /** From the currently-selected `ModelOption.contextLength` (null while
   *  unpinned or when the catalog hasn't backfilled it for that model). */
  contextLength: number | null;
  /** The form's live instructions text — the budget reserves room for it, so
   *  it must react to every keystroke, not just what was last saved. */
  instructions: string;
}) {
  const { budget, usable, assumedContext } = documentBudget({
    contextLength,
    prefixTokens: ASSUMED_PREFIX_TOKENS,
    instructionTokens: estimateTokens(instructions),
  });

  const selected = new Set(selectedIds);
  const used = documents
    .filter((d) => selected.has(d.id))
    .reduce((sum, d) => sum + d.tokenEstimate, 0);

  function toggle(id: string, checked: boolean) {
    onChange(
      checked ? [...selectedIds, id] : selectedIds.filter((i) => i !== id),
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="bg-surface-muted flex items-center justify-between gap-3 rounded-lg border p-3 text-xs">
        <span className="text-muted-foreground">Reference budget</span>
        <span className="font-mono">
          <span>{used.toLocaleString()}</span> used ·{" "}
          <span>{budget.toLocaleString()}</span> tokens available
        </span>
      </div>

      {assumedContext ? (
        <p className="text-muted-foreground text-xs">
          Assuming a {NULL_CONTEXT_FALLBACK.toLocaleString()}-token context —
          this model doesn&apos;t report one.
        </p>
      ) : null}

      {!usable ? (
        <p className="text-muted-foreground text-xs">
          This model&apos;s context is too small for reference documents.
        </p>
      ) : documents.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          No reference documents yet. Add one from the library to give this
          agent context it can&apos;t get from your boards.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {documents.map((doc) => {
            const isSelected = selected.has(doc.id);
            const wouldOverrun = used + doc.tokenEstimate > budget;
            const disabled = !isSelected && wouldOverrun;
            const fieldId = `agent-document-${doc.id}`;
            return (
              <li
                key={doc.id}
                className="bg-surface hover:border-border-hover flex items-center gap-3 rounded-lg border p-3"
              >
                <input
                  id={fieldId}
                  type="checkbox"
                  checked={isSelected}
                  disabled={disabled}
                  aria-label={doc.title}
                  onChange={(e) => toggle(doc.id, e.target.checked)}
                  className="accent-primary size-3.5 shrink-0 cursor-pointer disabled:cursor-not-allowed"
                />
                <label
                  htmlFor={fieldId}
                  className={
                    disabled
                      ? "text-muted-foreground flex min-w-0 flex-1 flex-col"
                      : "flex min-w-0 flex-1 cursor-pointer flex-col"
                  }
                >
                  <span className="truncate font-medium">{doc.title}</span>
                  {disabled ? (
                    <span className="text-muted-foreground text-xs">
                      {doc.tokenEstimate.toLocaleString()} tokens — won&apos;t
                      fit the remaining budget
                    </span>
                  ) : null}
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

"use server";
import { z } from "zod";
import { requireUser, getUserOrgs } from "@/lib/auth/session";
import { runAi } from "@/lib/ai/gateway";
import { requireAiEntitlement } from "@/lib/ai/entitlement";
import { MODEL } from "@/lib/ai/providers/anthropic";
import { classifyColumn as classifyColumnWithAi } from "@/lib/ai/column-fill/classify";
import { validateClassifications } from "@/lib/ai/column-fill/validate";
import {
  COLUMN_FILL_MAX,
  type Classification,
  type ClassifyRow,
  type TargetOption,
} from "@/lib/ai/column-fill/schema";
import { ProviderNotCapableError } from "@/lib/ai/errors";
import { mapAiError } from "@/lib/ai/action-guard";
import { createClient } from "@/lib/supabase/server";
import { bulkSetCell, type BulkOutcome } from "@/lib/boards/bulk-actions";
import { fail, type ActionResult } from "@/lib/actions/result";

const classifyColumnSchema = z.object({
  boardId: z.string().uuid(),
  sourceColumnId: z.string().uuid(),
  targetColumnId: z.string().uuid(),
});

// optionId is a settings-generated id, not a uuid (matches optionSchema in
// src/lib/validations/boards.ts — `z.string().min(1)`).
const applyColumnFillSchema = z.object({
  targetColumnId: z.string().uuid(),
  assignments: z
    .array(z.object({ itemId: z.string().uuid(), optionId: z.string().min(1) }))
    .min(1)
    .max(COLUMN_FILL_MAX),
});

type PreviewRow = {
  itemId: string;
  itemName: string;
  sourceText: string;
  proposedOptionId: string | null;
};

type ColumnOptionRow = { id: string; label: string };

/** `columns.settings` is untyped `Json` — this is the subset every column-fill
 *  caller reads (status/dropdown share `options: [{id,label,color}]`). */
function readTargetOptions(settings: unknown): TargetOption[] {
  const options = (settings as { options?: ColumnOptionRow[] } | null)?.options;
  if (!Array.isArray(options)) return [];
  return options.map((o) => ({ id: o.id, label: o.label }));
}

/**
 * Preview a Smart Fill classification: reads a bounded set of source-column
 * text cells, classifies them against the target status/dropdown column's
 * options via one metered `runAi("column_fill")` call, and returns a
 * client-reviewable preview — no writes happen here (see `applyColumnFill`).
 * Entitlement is gated and the source is checked for emptiness BEFORE any
 * token spend.
 */
export async function classifyColumn(input: {
  boardId: string;
  sourceColumnId: string;
  targetColumnId: string;
}): Promise<ActionResult<{ preview: PreviewRow[]; warnings: string[] }>> {
  const parsed = classifyColumnSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input.");
  const { boardId, sourceColumnId, targetColumnId } = parsed.data;

  try {
    const user = await requireUser();
    const org = (await getUserOrgs())[0];
    if (!org) return fail("No organization.");

    await requireAiEntitlement(org.id, "column_fill");

    const supabase = await createClient();

    // Verify the target column belongs to this board (RLS-scoped read) and is
    // a status/dropdown column before reading its options.
    const { data: targetColumn, error: targetColErr } = await supabase
      .from("columns")
      .select("id, kind, settings")
      .eq("id", targetColumnId)
      .eq("board_id", boardId)
      .maybeSingle();
    if (targetColErr) throw targetColErr;
    if (!targetColumn) return fail("Target column not found.");
    if (targetColumn.kind !== "status" && targetColumn.kind !== "dropdown") {
      return fail("Pick a status or dropdown column to fill.");
    }

    const targetOptions = readTargetOptions(targetColumn.settings);
    const targetOptionIds = new Set(targetOptions.map((o) => o.id));

    // Bounded, indexed read of the source column's cells (cell_values_column_id_idx)
    // — never the whole board.
    const { data: cellRows, error: cellErr } = await supabase
      .from("cell_values")
      .select("item_id, value")
      .eq("column_id", sourceColumnId)
      .limit(COLUMN_FILL_MAX);
    if (cellErr) throw cellErr;

    const textByItemId = new Map<string, string>();
    const rows: ClassifyRow[] = [];
    for (const row of cellRows ?? []) {
      const text = (row.value as { text?: unknown } | null)?.text;
      if (typeof text === "string" && text.trim().length > 0) {
        rows.push({ itemId: row.item_id, text });
        textByItemId.set(row.item_id, text);
      }
    }
    if (rows.length === 0)
      return fail("This column has no text to classify yet.");

    // Bounded read of the matching item names (same id set as the rows above).
    const { data: items, error: itemsErr } = await supabase
      .from("items")
      .select("id, name")
      .in(
        "id",
        rows.map((r) => r.itemId),
      );
    if (itemsErr) throw itemsErr;
    const nameByItemId = new Map((items ?? []).map((i) => [i.id, i.name]));

    const classifications = await runAi<Classification[]>(
      { orgId: org.id, userId: user.id, feature: "column_fill" },
      async ({ adapter, apiKey }) => {
        if (adapter.id !== "anthropic")
          throw new ProviderNotCapableError("column_fill");
        const r = await classifyColumnWithAi({
          apiKey,
          rows,
          targetOptions,
        });
        return { result: r.classifications, usage: r.usage, model: MODEL };
      },
    );

    const { classifications: validated, warnings } = validateClassifications(
      classifications,
      { targetOptionIds },
    );

    const preview: PreviewRow[] = validated.map((c) => ({
      itemId: c.itemId,
      itemName: nameByItemId.get(c.itemId) ?? "",
      sourceText: textByItemId.get(c.itemId) ?? "",
      proposedOptionId: c.optionId,
    }));

    return { ok: true, data: { preview, warnings } };
  } catch (e) {
    return fail(
      mapAiError(e, {
        fallback: "Couldn't classify this column. Please try again.",
        notConfigured: "Add an AI provider key in Settings to use Smart Fill.",
        providerNotCapable: "Smart Fill needs an Anthropic key.",
      }),
    );
  }
}

/**
 * Apply accepted Smart Fill assignments. Re-validates every `optionId`
 * against the target column's CURRENT options server-side (never trusts the
 * client-held preview) and writes via the existing `bulkSetCell`, batched per
 * distinct option id so each write is one bulk call instead of N single-item
 * writes. Status columns store `{optionId}`; dropdown columns store
 * `{optionIds:[optionId]}` — column-fill only ever proposes a single option
 * per row, so a dropdown assignment is written as a one-element array
 * (see `statusValueSchema`/`dropdownValueSchema` in
 * src/lib/validations/boards.ts).
 */
export async function applyColumnFill(input: {
  targetColumnId: string;
  assignments: { itemId: string; optionId: string }[];
}): Promise<ActionResult<BulkOutcome>> {
  const parsed = applyColumnFillSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input.");
  const { targetColumnId, assignments } = parsed.data;

  try {
    // RLS-scoped: requireUser gates auth; the cookie-bound client below scopes
    // every read/write to the caller's org, same as upsertCell/bulkSetCell.
    await requireUser();
    const supabase = await createClient();

    const { data: targetColumn, error: targetColErr } = await supabase
      .from("columns")
      .select("id, kind, settings")
      .eq("id", targetColumnId)
      .maybeSingle();
    if (targetColErr) throw targetColErr;
    if (!targetColumn) return fail("Target column not found.");
    if (targetColumn.kind !== "status" && targetColumn.kind !== "dropdown") {
      return fail("Pick a status or dropdown column to fill.");
    }

    const validOptionIds = new Set(
      readTargetOptions(targetColumn.settings).map((o) => o.id),
    );

    const itemIdsByOption = new Map<string, string[]>();
    for (const a of assignments) {
      if (!validOptionIds.has(a.optionId)) continue;
      const itemIds = itemIdsByOption.get(a.optionId) ?? [];
      itemIds.push(a.itemId);
      itemIdsByOption.set(a.optionId, itemIds);
    }
    if (itemIdsByOption.size === 0) return fail("No rows to apply.");

    const succeeded: string[] = [];
    const failed: { itemId: string; error: string }[] = [];
    for (const [optionId, itemIds] of itemIdsByOption) {
      const value =
        targetColumn.kind === "dropdown"
          ? { optionIds: [optionId] }
          : { optionId };
      const res = await bulkSetCell({
        itemIds,
        columnId: targetColumnId,
        value,
      });
      if (res.ok) {
        succeeded.push(...res.data.succeeded);
        failed.push(...res.data.failed);
      } else {
        // Whole-batch malformed (bad ids / over the cap) — surface every item
        // in this group as failed rather than dropping the group silently.
        failed.push(...itemIds.map((itemId) => ({ itemId, error: res.error })));
      }
    }

    return { ok: true, data: { succeeded, failed } };
  } catch (e) {
    return fail(
      mapAiError(e, {
        fallback: "Couldn't apply Smart Fill. Please try again.",
      }),
    );
  }
}

"use server";

import {
  moveItem,
  upsertCell,
  clearCell,
  archiveItem,
  restoreItem,
} from "@/lib/boards/actions";
import type { ActionResult } from "@/lib/actions/result";
import {
  bulkMoveItemsSchema,
  bulkSetCellSchema,
  bulkArchiveItemsSchema,
  bulkRestoreItemsSchema,
} from "@/lib/validations/board-actions";

/**
 * Outcome of a bulk operation: which item ids the server applied and which
 * failed (with the per-item reason). A partial failure is NOT a thrown error —
 * the caller surfaces "N of M failed" and reconciles the optimistic cache. The
 * envelope is `ok:false` ONLY when the whole request is malformed (bad ids /
 * over the cap), which the Zod parse rejects before any per-item work runs.
 */
export type BulkOutcome = {
  succeeded: string[];
  failed: { itemId: string; error: string }[];
};

/**
 * Run a per-item server action across a bounded id list, SERVER-SIDE in one
 * action call (fewer client round-trips than N mutations), reusing the existing
 * per-item function so its RLS-scoped authorization + Zod validation apply to
 * every item unchanged — a bulk op can never do something a single-item op
 * couldn't. Failures are collected, not thrown, so one bad row doesn't abort the
 * batch (partial-success semantics; spec: surface which failed, never silently drop).
 */
async function runBulk(
  itemIds: string[],
  perItem: (itemId: string) => Promise<ActionResult>,
): Promise<BulkOutcome> {
  const succeeded: string[] = [];
  const failed: { itemId: string; error: string }[] = [];
  for (const itemId of itemIds) {
    // Sequential on purpose: several per-item moves append to the SAME target
    // group and each reads the current last position — running them in parallel
    // would race that read and collide positions. The batch is bounded (≤500).
    const res = await perItem(itemId);
    if (res.ok) succeeded.push(itemId);
    else failed.push({ itemId, error: res.error });
  }
  return { succeeded, failed };
}

/** Archive every selected item (reversible; reuses the single-item archiveItem,
 *  which cascades to each item's live subitems). Undo restores via bulkRestoreItems. */
export async function bulkArchiveItems(input: {
  itemIds: string[];
}): Promise<ActionResult<BulkOutcome>> {
  const parsed = bulkArchiveItemsSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const data = await runBulk(parsed.data.itemIds, (itemId) =>
    archiveItem({ itemId }),
  );
  return { ok: true, data };
}

/** Restore every selected archived item (reuses the single-item restoreItem). */
export async function bulkRestoreItems(input: {
  itemIds: string[];
}): Promise<ActionResult<BulkOutcome>> {
  const parsed = bulkRestoreItemsSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const data = await runBulk(parsed.data.itemIds, (itemId) =>
    restoreItem({ itemId }),
  );
  return { ok: true, data };
}

/** Move every selected top-level item to a group (reuses per-item moveItem). */
export async function bulkMoveItems(input: {
  itemIds: string[];
  groupId: string;
}): Promise<ActionResult<BulkOutcome>> {
  const parsed = bulkMoveItemsSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const data = await runBulk(parsed.data.itemIds, (itemId) =>
    moveItem({ itemId, groupId: parsed.data.groupId }),
  );
  return { ok: true, data };
}

/**
 * Set (or clear) one column's cell across every selected item. `value: null`
 * clears; an object sets. Reuses upsertCell/clearCell per item, so the column
 * kind's value validation AND the People-assign notification fan-out apply to
 * each item exactly as a single edit would.
 */
export async function bulkSetCell(input: {
  itemIds: string[];
  columnId: string;
  value: Record<string, unknown> | null;
}): Promise<ActionResult<BulkOutcome>> {
  const parsed = bulkSetCellSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  const { itemIds, columnId, value } = parsed.data;
  const data = await runBulk(itemIds, (itemId) =>
    value === null
      ? clearCell({ itemId, columnId })
      : upsertCell({ itemId, columnId, value }),
  );
  return { ok: true, data };
}

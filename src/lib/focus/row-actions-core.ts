import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database.types";
import { fail, type ActionResult } from "@/lib/actions/result";
import { upsertCellCore } from "@/lib/boards/actions/cell-core";
import { parseColumnOptions } from "@/lib/boards/column-options";
import { resolveWorkRule, type WorkRule } from "@/lib/boards/work-guess";
import { pickDoneOption, withDueDate } from "./row-actions";

type RuleColumn = Pick<
  Tables<"columns">,
  "id" | "name" | "kind" | "position" | "settings"
>;

/**
 * The work rule of the board an item lives on: two bounded, RLS-scoped round
 * trips (the item, then its board's settings and columns together). The rule
 * is resolved by `resolveWorkRule`, the TypeScript twin of `public.item_facts`,
 * so the column an action writes to is the one the Today list read from.
 */
async function loadItemRule(
  supabase: SupabaseClient<Database>,
  itemId: string,
): Promise<ActionResult<WorkRule<RuleColumn>>> {
  const { data: item, error: itemErr } = await supabase
    .from("items")
    .select("board_id")
    .eq("id", itemId)
    .maybeSingle();
  if (itemErr || !item) return fail("Item not found.");

  const [{ data: board, error: boardErr }, { data: columns, error: colErr }] =
    await Promise.all([
      supabase
        .from("boards")
        .select(
          "work_status_column_id, work_done_option_ids, work_due_column_id",
        )
        .eq("id", item.board_id)
        .maybeSingle(),
      supabase
        .from("columns")
        .select("id, name, kind, position, settings")
        .eq("board_id", item.board_id)
        .in("kind", ["status", "date"]),
    ]);
  if (boardErr || !board) return fail("Board not found.");
  if (colErr) return fail(colErr.message);
  return { ok: true, data: resolveWorkRule(columns ?? [], board) };
}

/**
 * Mark an item done: set its board's status column to the board's done option
 * (Work tracking settings, else the label guess). The write itself is
 * `upsertCellCore`, the one cell-write path, so the board-integrity guard, the
 * value validation and RLS (`can_edit_board`) are exactly those of editing the
 * status cell on the board. A view-only member is refused there.
 */
export async function markItemDoneCore(
  supabase: SupabaseClient<Database>,
  input: { itemId: string },
  actorId: string | null,
): Promise<ActionResult<{ optionLabel: string }>> {
  const rule = await loadItemRule(supabase, input.itemId);
  if (!rule.ok) return rule;
  const column = rule.data.statusColumn;
  if (!column)
    return fail(
      "This board has no status column, so nothing can be marked done.",
    );
  const option = pickDoneOption(parseColumnOptions(column.settings), rule.data);
  if (!option)
    return fail(
      "This board has no done status. Choose one in the board's Work tracking settings.",
    );
  const res = await upsertCellCore(
    supabase,
    {
      itemId: input.itemId,
      columnId: column.id,
      value: { optionId: option.id },
    },
    actorId,
  );
  if (!res.ok) return res;
  return { ok: true, data: { optionLabel: option.label } };
}

/**
 * Change an item's due date: write the board's due date column (Work tracking
 * settings, else the name guess) through `upsertCellCore`. A date range keeps
 * its start (see `withDueDate`).
 */
export async function setItemDueDateCore(
  supabase: SupabaseClient<Database>,
  input: { itemId: string; dueDate: string },
  actorId: string | null,
): Promise<ActionResult<{ dueDate: string }>> {
  const rule = await loadItemRule(supabase, input.itemId);
  if (!rule.ok) return rule;
  const column = rule.data.dueColumn;
  if (!column)
    return fail(
      "This board has no due date column, so the date cannot be changed here.",
    );

  const { data: cell, error: cellErr } = await supabase
    .from("cell_values")
    .select("value")
    .eq("item_id", input.itemId)
    .eq("column_id", column.id)
    .maybeSingle();
  if (cellErr) return fail(cellErr.message);

  const res = await upsertCellCore(
    supabase,
    {
      itemId: input.itemId,
      columnId: column.id,
      value: withDueDate(cell?.value ?? null, input.dueDate),
    },
    actorId,
  );
  if (!res.ok) return res;
  return { ok: true, data: { dueDate: input.dueDate } };
}

import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";
import { optionSchema, type ColumnOption } from "@/lib/validations/boards";
import { serverToday } from "@/lib/portfolios/rollup";
import {
  bucketMyWork,
  type MyWorkGroup,
  type MyWorkItem,
  type MyWorkStatus,
} from "@/lib/my-work/bucket";

/**
 * Hot-path caps (AGENTS.md: bounded reads over indexed columns). The item cap
 * bounds the whole page; the column cap bounds the people-column pre-filter.
 * Both truncate silently — raise alongside pagination if a user ever approaches
 * them (a single person assigned to 500 open items is already far past useful).
 */
export const MY_WORK_ITEM_LIMIT = 500;
export const MY_WORK_COLUMN_LIMIT = 2000;

function readDate(value: unknown): string | null {
  if (value && typeof value === "object") {
    const d = (value as Record<string, unknown>).date;
    if (typeof d === "string" && d) return d;
  }
  return null;
}

function readOptionId(value: unknown): string | null {
  if (value && typeof value === "object") {
    const o = (value as Record<string, unknown>).optionId;
    if (typeof o === "string" && o) return o;
  }
  return null;
}

function parseOptions(settings: unknown): ColumnOption[] {
  const raw = (settings as { options?: unknown } | null)?.options ?? [];
  return optionSchema.array().safeParse(raw).data ?? [];
}

/**
 * Every item assigned to the current user across every board they can read,
 * enriched with board name, group, status and due date.
 *
 * Query approach (all RLS-scoped via the cookie-bound client — `cell_values`,
 * `columns`, `items` and `boards` all carry `can_read_board` read policies, so
 * the candidate set is inherently the caller's readable boards, no cross-tenant
 * leak):
 *
 *  1. Read the caller's visible **people** columns (indexed by board_id + kind).
 *     This scopes the assignment scan to an indexed `column_id` set instead of a
 *     full jsonb containment scan over every cell.
 *  2. Read people cells whose value CONTAINS my id — `value @> {"userIds":[me]}`
 *     — restricted to those column ids and capped at {@link MY_WORK_ITEM_LIMIT}.
 *     Bounded + indexed on `cell_values_column_id_idx`.
 *  3. In one batch: the items (+ their group), the boards, and each board's
 *     first date/status column (ordered by position, matching workload's "first
 *     date column per board" rule).
 *  4. In one batch: the due-date cells and status cells for those items, keyed
 *     to the resolved first-column ids.
 *
 * Index follow-up: no GIN index on `cell_values.value` is required because step
 * 1 narrows to an indexed `column_id` set before the containment filter. If the
 * assigned set ever needs to grow past the cap, add
 * `create index … using gin (value jsonb_path_ops)` and paginate.
 */
export async function getMyWorkItems(): Promise<MyWorkItem[]> {
  const user = await getUser();
  if (!user) return [];
  const supabase = await createClient();

  // 1) People columns the caller can see.
  const { data: peopleCols } = await supabase
    .from("columns")
    .select("id")
    .eq("kind", "people")
    .limit(MY_WORK_COLUMN_LIMIT);
  const peopleColIds = (peopleCols ?? []).map((c) => c.id);
  if (peopleColIds.length === 0) return [];

  // 2) People cells that include me → candidate (item, board) set.
  const { data: assigned } = await supabase
    .from("cell_values")
    .select("item_id, board_id")
    .in("column_id", peopleColIds)
    .contains("value", { userIds: [user.id] })
    .limit(MY_WORK_ITEM_LIMIT);
  const assignedRows = assigned ?? [];
  if (assignedRows.length === 0) return [];

  const itemIds = [...new Set(assignedRows.map((r) => r.item_id))];
  const boardIds = [...new Set(assignedRows.map((r) => r.board_id))];

  // 3) Items (+ group), boards, and per-board date/status columns.
  const [itemsRes, boardsRes, dateColsRes, statusColsRes] = await Promise.all([
    supabase
      .from("items")
      .select("id, name, board_id, group_id, groups(id, name)")
      .in("id", itemIds)
      .limit(MY_WORK_ITEM_LIMIT),
    supabase.from("boards").select("id, name").in("id", boardIds),
    supabase
      .from("columns")
      .select("id, board_id, position")
      .in("board_id", boardIds)
      .eq("kind", "date")
      .order("position", { ascending: true }),
    supabase
      .from("columns")
      .select("id, board_id, position, settings")
      .in("board_id", boardIds)
      .eq("kind", "status")
      .order("position", { ascending: true }),
  ]);

  // First (lowest-position) date/status column per board.
  const firstDateCol = new Map<string, string>();
  for (const c of dateColsRes.data ?? []) {
    if (!firstDateCol.has(c.board_id)) firstDateCol.set(c.board_id, c.id);
  }
  const firstStatusCol = new Map<
    string,
    { id: string; options: ColumnOption[] }
  >();
  for (const c of statusColsRes.data ?? []) {
    if (!firstStatusCol.has(c.board_id)) {
      firstStatusCol.set(c.board_id, {
        id: c.id,
        options: parseOptions(c.settings),
      });
    }
  }

  const dateColIds = [...firstDateCol.values()];
  const statusColIds = [...firstStatusCol.values()].map((v) => v.id);

  // 4) Due-date and status cells for these items over the resolved columns.
  const [dateCellsRes, statusCellsRes] = await Promise.all([
    dateColIds.length > 0
      ? supabase
          .from("cell_values")
          .select("item_id, value")
          .in("item_id", itemIds)
          .in("column_id", dateColIds)
      : null,
    statusColIds.length > 0
      ? supabase
          .from("cell_values")
          .select("item_id, value")
          .in("item_id", itemIds)
          .in("column_id", statusColIds)
      : null,
  ]);

  const dueByItem = new Map<string, string>();
  for (const cell of dateCellsRes?.data ?? []) {
    const d = readDate(cell.value);
    if (d) dueByItem.set(cell.item_id, d);
  }
  const statusOptByItem = new Map<string, string>();
  for (const cell of statusCellsRes?.data ?? []) {
    const optId = readOptionId(cell.value);
    if (optId) statusOptByItem.set(cell.item_id, optId);
  }

  const boardName = new Map((boardsRes.data ?? []).map((b) => [b.id, b.name]));

  const rows: MyWorkItem[] = [];
  for (const it of itemsRes.data ?? []) {
    const group = it.groups as { name: string } | null;
    let status: MyWorkStatus | null = null;
    const statusCol = firstStatusCol.get(it.board_id);
    const optId = statusOptByItem.get(it.id);
    if (statusCol && optId) {
      const opt = statusCol.options.find((o) => o.id === optId);
      if (opt) status = { label: opt.label, color: opt.color };
    }
    rows.push({
      itemId: it.id,
      itemName: it.name,
      boardId: it.board_id,
      boardName: boardName.get(it.board_id) ?? "Unknown board",
      groupName: group?.name ?? null,
      status,
      dueDate: dueByItem.get(it.id) ?? null,
    });
  }
  return rows;
}

/**
 * Page-level read: the assigned items, bucketed by due date, plus the server
 * clock the UI uses to tint overdue rows. `Date.now()` and the bucketing live
 * here (a server module) so the RSC page stays a pure render — mirrors how
 * workload/goals compute their clock inside the query layer.
 */
export async function getMyWorkPageData(): Promise<{
  today: string;
  groups: MyWorkGroup[];
}> {
  const today = serverToday(Date.now());
  const items = await getMyWorkItems();
  return { today, groups: bucketMyWork(items, today) };
}

import "server-only";
import { getBoardAccess, deriveBoardAccess } from "@/lib/boards/queries";
import { getUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  resolveReportBoardIds,
  type ReportRow,
  type ReportScope,
} from "@/lib/reports/queries";

/** Returns the caller's access level for a board, or null if none. */
export async function reportBoardAccess(boardId: string) {
  return getBoardAccess(boardId);
}

/** True if the caller may edit reports for the board (owner/editor). */
export function canEditReports(
  access: "owner" | "editor" | "viewer" | null,
): boolean {
  return access === "owner" || access === "editor";
}

export type BoardAccessLevel = "owner" | "editor" | "viewer" | null;

export type ReportAccess = {
  /** All boards bound to the report, in binding order. */
  boardIds: string[];
  /** The subset of `boardIds` this caller can read. */
  readableBoardIds: string[];
  /** `boardIds.length - readableBoardIds.length` — the disclosure count. */
  omittedCount: number;
  canRead: boolean;
  canEdit: boolean;
};

/**
 * The report-access rules for a report that can span MANY boards. Pure —
 * unit-testable without a DB (see access.test.ts).
 *
 * - `readableBoardIds` — bound boards whose access is non-null.
 * - `canRead` — `scope === "template"` (a template carries no board data, so any
 *   org member may read one) OR the caller created the report OR at least one
 *   bound board is readable. **A report bound only to boards you cannot read is
 *   NOT readable** — that is the leak gate: without it, a roll-up would become a
 *   side channel into boards you were never granted.
 * - `canEdit` — creator OR org owner/admin OR (there is ≥1 bound board AND the
 *   caller is owner/editor on EVERY one). This mirrors the house
 *   `can_edit_portfolio` precedent (creator OR org owner/admin) so an exec who
 *   owns a roll-up is not locked out by one board they only view; conversely an
 *   editor on 2 of 3 boards cannot edit a document that renders all 3. An empty
 *   board set on a non-template scope must NOT vacuously grant edit.
 *   For `scope === "template"`, `canEdit` is `isCreator || isOrgAdmin` only.
 * - `omittedCount` is what the rendered document uses to disclose
 *   "N boards omitted (no access)".
 */
export function deriveReportAccess(input: {
  scope: ReportScope;
  boardIds: string[];
  accessByBoardId: Map<string, BoardAccessLevel>;
  isCreator: boolean;
  isOrgAdmin: boolean;
}): ReportAccess {
  const { scope, boardIds, accessByBoardId, isCreator, isOrgAdmin } = input;

  const readableBoardIds = boardIds.filter(
    (id) => (accessByBoardId.get(id) ?? null) !== null,
  );
  const omittedCount = boardIds.length - readableBoardIds.length;

  const canRead =
    scope === "template" || isCreator || readableBoardIds.length > 0;

  const writableEverywhere =
    boardIds.length > 0 &&
    boardIds.every((id) => canEditReports(accessByBoardId.get(id) ?? null));

  const canEdit =
    scope === "template"
      ? isCreator || isOrgAdmin
      : isCreator || isOrgAdmin || writableEverywhere;

  return {
    // Copy: the returned shape is handed to renderers, never aliased to input.
    boardIds: [...boardIds],
    readableBoardIds,
    omittedCount,
    canRead,
    canEdit,
  };
}

/**
 * Resolves the report's boards, batch-reads the caller's access to them, and
 * derives {@link ReportAccess}. Fails closed (everything false) when there is
 * no authenticated caller.
 *
 * **Batched, not N+1**: board access for the whole id set comes from exactly two
 * reads (`boards.created_by` and this user's `board_members` rows), fed through
 * the existing pure `deriveBoardAccess` helper — never N sequential
 * `getBoardAccess()` calls. A board the caller cannot see is filtered out by
 * RLS, so it simply has no row and derives to `null` access.
 *
 * `createdBy` may be passed in when the caller already has it (the report row
 * read); otherwise it costs one extra PK read, issued in parallel.
 */
export async function resolveReportAccess(
  report: ReportRow & { createdBy?: string | null },
): Promise<ReportAccess> {
  const user = await getUser();
  if (!user) {
    return {
      boardIds: [],
      readableBoardIds: [],
      omittedCount: 0,
      canRead: false,
      canEdit: false,
    };
  }

  const supabase = await createClient();

  // Round trip 1: membership + creator + org role, all independent.
  const [boardIds, createdBy, isOrgAdmin] = await Promise.all([
    resolveReportBoardIds(report),
    report.createdBy !== undefined
      ? Promise.resolve(report.createdBy)
      : supabase
          .from("reports")
          .select("created_by")
          .eq("id", report.id)
          .maybeSingle()
          .then(({ data }) => data?.created_by ?? null),
    // `isOrgAdmin()` in @/lib/org/guard resolves the ACTIVE org; a report
    // carries its own org_id, so read the role for THAT org. Fails closed.
    supabase
      .from("org_members")
      .select("role")
      .eq("org_id", report.orgId)
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => data?.role === "owner" || data?.role === "admin"),
  ]);

  // Round trip 2: two batched reads for the whole board set (skipped when the
  // report binds no boards — a template, or an empty roll-up).
  const accessByBoardId = new Map<string, BoardAccessLevel>();
  if (boardIds.length > 0) {
    const [boardsRes, grantsRes] = await Promise.all([
      supabase.from("boards").select("id, created_by").in("id", boardIds),
      supabase
        .from("board_members")
        .select("board_id, user_id, access_level")
        .in("board_id", boardIds)
        .eq("user_id", user.id),
    ]);

    const boardsById = new Map(
      (boardsRes.data ?? []).map((b) => [b.id, b] as const),
    );
    const grantsByBoard = new Map<
      string,
      { userId: string; access: "editor" | "viewer" }[]
    >();
    for (const g of grantsRes.data ?? []) {
      const list = grantsByBoard.get(g.board_id) ?? [];
      list.push({ userId: g.user_id, access: g.access_level });
      grantsByBoard.set(g.board_id, list);
    }

    for (const id of boardIds) {
      const board = boardsById.get(id);
      accessByBoardId.set(
        id,
        board
          ? deriveBoardAccess(board, grantsByBoard.get(id) ?? [], user.id)
          : null,
      );
    }
  }

  return deriveReportAccess({
    scope: report.scope,
    boardIds,
    accessByBoardId,
    isCreator: createdBy !== null && createdBy === user.id,
    isOrgAdmin,
  });
}

/**
 * Zod schemas for the report server actions.
 *
 * SERVER-SIDE ONLY: this module imports `REPORT_BOARDS_LIMIT` from the
 * `server-only` `@/lib/reports/queries`, so importing it from a client
 * component would fail the build. That is deliberate — the limit has exactly
 * one home, and these schemas exist to gate a mutation, not to drive a form.
 *
 * The scope/binding combination is validated as a UNIT (a discriminated union
 * on `scope`), so an impossible pairing — `scope:'board'` with no board,
 * `scope:'portfolio'` with a board list — is rejected here rather than bouncing
 * off the DB's `reports_scope_binding_ck` with an unreadable Postgres error.
 */
import { z } from "zod";
import { reportConfigSchema } from "@/lib/reports/config";
import { REPORT_BOARDS_LIMIT, type ReportScope } from "@/lib/reports/queries";

const uuid = z.string().uuid();
const reportName = z.string().trim().min(1).max(200);

/**
 * A roll-up's board set. Bounded by the same constant the read path uses, so a
 * report can never be *created* wider than it can be *rendered*. Duplicates are
 * collapsed (the `report_boards` unique index would reject them anyway).
 */
export const boardIdsSchema = z
  .array(uuid)
  .min(1)
  .max(REPORT_BOARDS_LIMIT)
  .transform((ids) => [...new Set(ids)]);

/**
 * Build a `scope` + binding discriminated union with extra fields merged in, so
 * every action that takes a binding validates it identically.
 */
function withBinding<T extends z.ZodRawShape>(extra: T) {
  return z.discriminatedUnion("scope", [
    z.object({ ...extra, scope: z.literal("board"), boardId: uuid }),
    z.object({
      ...extra,
      scope: z.literal("boards"),
      boardIds: boardIdsSchema,
    }),
    z.object({ ...extra, scope: z.literal("portfolio"), portfolioId: uuid }),
    z.object({ ...extra, scope: z.literal("template") }),
  ]);
}

export const reportBindingSchema = withBinding({});
export type ReportBinding = z.infer<typeof reportBindingSchema>;

export const createReportSchema = withBinding({ name: reportName });
export const setReportScopeSchema = withBinding({ reportId: uuid });
export const createReportFromTemplateSchema = withBinding({
  templateId: uuid,
  name: reportName,
});

export const saveReportSchema = z.object({
  reportId: uuid,
  name: reportName,
  config: reportConfigSchema,
});

export const reportIdSchema = z.object({ reportId: uuid });

export const saveReportAsTemplateSchema = z.object({
  reportId: uuid,
  name: reportName,
});

/**
 * Boards that get a `report_boards` row for this binding.
 *
 * `portfolio` → none: the report follows `portfolio_boards`, and duplicating
 * that set here would let the two drift. `template` → none by construction.
 */
export function bindingBoardIds(binding: ReportBinding): string[] {
  if (binding.scope === "board") return [binding.boardId];
  if (binding.scope === "boards") return binding.boardIds;
  return [];
}

/** The `reports` columns this binding writes — shaped to satisfy `reports_scope_binding_ck`. */
export function bindingColumns(binding: ReportBinding): {
  scope: ReportScope;
  board_id: string | null;
  portfolio_id: string | null;
} {
  return {
    scope: binding.scope,
    board_id: binding.scope === "board" ? binding.boardId : null,
    portfolio_id: binding.scope === "portfolio" ? binding.portfolioId : null,
  };
}

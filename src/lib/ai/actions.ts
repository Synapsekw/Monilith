"use server";

import { updateTag } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { dashboardsTag } from "@/lib/cache/tags";
import { getBoardPayload, listMyBoards } from "@/lib/boards/queries";
import { buildBoardSnapshot } from "@/lib/ai/board-snapshot";
import {
  validateProposal,
  type ValidatedProposal,
} from "@/lib/ai/proposal-schema";
import { generateProposal } from "@/lib/ai/generate";
import { AiNotConfiguredError } from "@/lib/ai/anthropic";
import {
  configSchemaForKind,
  widgetKindSchema,
} from "@/lib/validations/dashboards";
import type { Json } from "@/types/database.types";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string): ActionResult<never> => ({ ok: false, error });

const boardSnapshotInputSchema = z.object({ boardId: z.string().uuid() });

const generateProposalInputSchema = z.object({
  boardId: z.string().uuid(),
  // Bound free-text feedback: it flows verbatim into the Anthropic prompt, so
  // an unbounded string is a token/cost-abuse vector.
  feedback: z.string().max(2000).optional(),
});

/** Dimension kinds the model can chart over — also gates the empty-board check. */
const CHARTABLE_KINDS = new Set([
  "status",
  "dropdown",
  "people",
  "date",
  "numbers",
]);

/** Boards the current user can build an AI dashboard from. */
export async function listAiBoards(): Promise<
  ActionResult<{ boards: { id: string; name: string; workspaceId: string }[] }>
> {
  const boards = await listMyBoards();
  return {
    ok: true,
    data: {
      boards: boards.map((b) => ({
        id: b.id,
        name: b.name,
        workspaceId: b.workspace_id,
      })),
    },
  };
}

/** Slim schema + size summary for the "approve this snapshot" wizard step. */
export async function getBoardSnapshotSummary(input: {
  boardId: string;
}): Promise<
  ActionResult<{
    boardName: string;
    rowCount: number;
    columns: { name: string; kind: string }[];
    estimatedTokens: number;
  }>
> {
  const parsed = boardSnapshotInputSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid board.");

  const payload = await getBoardPayload(parsed.data.boardId);
  if (!payload) return fail("Board not found.");

  const snap = buildBoardSnapshot({
    board: { id: payload.board.id, name: payload.board.name },
    columns: payload.columns,
    items: payload.items,
    cellValues: payload.cellValues,
  });

  return {
    ok: true,
    data: {
      boardName: snap.board.name,
      rowCount: snap.rowCount,
      columns: snap.columns.map((c) => ({ name: c.name, kind: c.kind })),
      estimatedTokens: snap.meta.estimatedTokens,
    },
  };
}

/** Call the LLM and validate/repair the proposal. Blocks empty/unchartable boards
 *  before spending any tokens. */
export async function generateDashboardProposal(input: {
  boardId: string;
  feedback?: string;
}): Promise<ActionResult<{ proposal: ValidatedProposal }>> {
  const parsed = generateProposalInputSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input.");

  const payload = await getBoardPayload(parsed.data.boardId);
  if (!payload) return fail("Board not found.");

  const snap = buildBoardSnapshot({
    board: { id: payload.board.id, name: payload.board.name },
    columns: payload.columns,
    items: payload.items,
    cellValues: payload.cellValues,
  });

  const hasChartable = snap.columns.some((c) => CHARTABLE_KINDS.has(c.kind));
  if (snap.rowCount === 0 || !hasChartable)
    return fail("This board has no data to build a dashboard from yet.");

  try {
    const proposal = await generateProposal(snap, {
      feedback: parsed.data.feedback,
    });
    const validated = validateProposal(proposal, snap);
    if (validated.widgets.length === 0)
      return fail("Couldn't generate a usable layout — try Regenerate.");
    return { ok: true, data: { proposal: validated } };
  } catch (e) {
    if (e instanceof AiNotConfiguredError)
      return fail("AI generation isn't configured.");
    return fail("AI generation failed. Please try again.");
  }
}

const proposalLayoutSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(20),
});

const createDashboardFromProposalSchema = z.object({
  workspaceId: z.string().uuid(),
  proposal: z.object({
    name: z.string().min(1).max(100),
    sourceBoardId: z.string().uuid(),
    widgets: z
      .array(
        z.object({
          kind: widgetKindSchema,
          title: z.string().max(100),
          config: z.record(z.string(), z.unknown()),
          layout: proposalLayoutSchema,
        }),
      )
      .min(1),
  }),
});

/** Materialize a validated proposal into a real dashboard + widgets + layout. */
export async function createDashboardFromProposal(input: {
  workspaceId: string;
  proposal: {
    name: string;
    sourceBoardId: string;
    widgets: {
      kind: z.infer<typeof widgetKindSchema>;
      title: string;
      config: Record<string, unknown>;
      layout: { x: number; y: number; w: number; h: number };
    }[];
  };
}): Promise<ActionResult<{ dashboardId: string }>> {
  const parsed = createDashboardFromProposalSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const { workspaceId, proposal } = parsed.data;

  // The schema above only checks each widget config is a generic record. Run the
  // real per-kind config schema on every widget before persisting anything, so
  // an LLM-produced (or tampered) proposal can't write malformed widget configs.
  const invalidWidgets: string[] = [];
  const validatedWidgets = proposal.widgets.map((widget) => {
    const cfg = configSchemaForKind(widget.kind).safeParse(widget.config);
    if (!cfg.success) {
      invalidWidgets.push(widget.title || widget.kind);
      return widget;
    }
    return { ...widget, config: cfg.data as Record<string, unknown> };
  });
  if (invalidWidgets.length > 0)
    return fail(`Invalid widget config: ${invalidWidgets.join(", ")}`);

  const supabase = await createClient();

  const { data: dashboard, error: dashErr } = await supabase.rpc(
    "create_dashboard",
    { p_workspace_id: workspaceId, p_name: proposal.name },
  );
  if (dashErr || !dashboard)
    return fail(dashErr?.message ?? "Could not create dashboard.");
  const dashboardId = dashboard.id;

  const layouts: { id: string; x: number; y: number; w: number; h: number }[] =
    [];
  for (const widget of validatedWidgets) {
    const { data: created, error: widgetErr } = await supabase.rpc(
      "create_dashboard_widget",
      {
        p_dashboard_id: dashboardId,
        p_kind: widget.kind,
        p_source_board_id: proposal.sourceBoardId,
        p_title: widget.title,
        p_config: widget.config as Json,
        p_layout: widget.layout as Json,
      },
    );
    if (widgetErr || !created)
      return fail(widgetErr?.message ?? "Could not add widget.");
    layouts.push({ id: created.id, ...widget.layout });
  }

  const { error: layoutErr } = await supabase.rpc("set_widget_layouts", {
    p_dashboard_id: dashboardId,
    p_layouts: layouts,
  });
  if (layoutErr) return fail(layoutErr.message);

  // Read-your-own-writes: invalidate the cached org dashboards list so the new
  // dashboard shows in the sidebar / command palette / index immediately. The
  // org is derived from the just-created dashboard row (never trusted from the
  // client) — mirrors createDashboard in src/lib/dashboards/actions.ts.
  updateTag(dashboardsTag(dashboard.org_id));
  return { ok: true, data: { dashboardId } };
}

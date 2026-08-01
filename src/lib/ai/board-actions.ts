"use server";

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import { generateBoardProposal as generateBoardProposalLLM } from "@/lib/ai/board-generate";
import {
  validateBoardProposal,
  type ValidatedBoardProposal,
} from "@/lib/ai/board-gen-schema";
import { runAi } from "@/lib/ai/gateway";
import { modelFor } from "@/lib/ai/model-map";
import { requireAiEntitlement } from "@/lib/ai/entitlement";
import {
  AiDisabledError,
  AiQuotaExceededError,
  ByoKeyMissingError,
  AiNotConfiguredError,
} from "@/lib/ai/errors";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import {
  columnKindSchema,
  columnSettingsSchema,
  cellValueSchema,
  type ColumnKind,
} from "@/lib/validations/boards";
import { invalidateMyBoards } from "@/lib/boards/actions/internal";
import { fail, type ActionResult } from "@/lib/actions/result";

const generateInputSchema = z.object({
  workspaceId: z.string().uuid(),
  // Free-text flows verbatim into the model prompt — an unbounded string is a
  // token/cost-abuse vector, so bound it at the boundary.
  prompt: z.string().trim().min(3).max(2000),
  feedback: z.string().max(2000).optional(),
});

/**
 * F10 — generate a board proposal from a free-text description. Entitlement is
 * gated BEFORE any token spend; the proposal is validated and returned but
 * NEVER persisted here — persistence happens only in createBoardFromProposal
 * (the human's explicit "Create board"). Mirrors generateDashboardProposal.
 */
export async function generateBoardProposal(input: {
  workspaceId: string;
  prompt: string;
  feedback?: string;
}): Promise<ActionResult<{ proposal: ValidatedBoardProposal }>> {
  const parsed = generateInputSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input.");

  try {
    const org = await resolveActiveOrg();
    if (!org) return fail("No organization.");
    await requireAiEntitlement(org.id, "board_gen");
    const user = await requireUser();
    const choice = modelFor("board_gen");
    const proposal = await runAi(
      { orgId: org.id, userId: user.id, feature: "board_gen" },
      async ({ adapter, apiKey }) => {
        const { proposal, usage } = await generateBoardProposalLLM(
          parsed.data.prompt,
          { adapter, apiKey, feedback: parsed.data.feedback, choice },
        );
        return { result: proposal, usage, model: choice.model };
      },
    );
    const validated = validateBoardProposal(proposal);
    if (validated.templatePayload.columns.length === 0)
      return fail("Couldn't generate a usable board — try again.");
    return { ok: true, data: { proposal: validated } };
  } catch (e) {
    return fail(mapAiError(e));
  }
}

// --- create-from-proposal ---

const cellSchema = z.object({
  columnId: z.string().min(1),
  value: z.record(z.string(), z.unknown()),
});
const templatePayloadSchema = z.object({
  groups: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        color: z.string().min(1),
        position: z.number().int().min(0),
      }),
    )
    .min(1),
  columns: z
    .array(
      z.object({
        id: z.string().min(1),
        kind: columnKindSchema,
        name: z.string().min(1),
        settings: z.record(z.string(), z.unknown()),
        position: z.number().int().min(0),
      }),
    )
    .min(1),
  items: z.array(
    z.object({
      id: z.string().min(1),
      groupId: z.string().min(1),
      name: z.string().min(1),
      position: z.number().int().min(0),
      cells: z.array(cellSchema),
    }),
  ),
});
const createInputSchema = z.object({
  workspaceId: z.string().uuid(),
  proposal: z.object({
    name: z.string().min(1).max(100),
    templatePayload: templatePayloadSchema,
  }),
});

type ParsedTemplatePayload = z.infer<typeof templatePayloadSchema>;

/**
 * Defensive structural re-check before the RPC write: every column's settings
 * must satisfy its per-kind schema, every cell must reference a real column and
 * validate against that column's cellValueSchema, and every item must reference
 * a real group. Returns an error string or null. Mirrors the re-validation in
 * createDashboardFromProposal — an LLM-produced (or tampered) proposal can't
 * write malformed board data.
 */
function structuralError(tp: ParsedTemplatePayload): string | null {
  const columnById = new Map(tp.columns.map((c) => [c.id, c]));
  const groupIds = new Set(tp.groups.map((g) => g.id));

  for (const col of tp.columns) {
    const kind = col.kind as ColumnKind;
    if (!columnSettingsSchema(kind).safeParse(col.settings).success)
      return `Invalid settings for column "${col.name}".`;
  }
  for (const item of tp.items) {
    if (!groupIds.has(item.groupId))
      return `Item "${item.name}" references an unknown group.`;
    for (const cell of item.cells) {
      const col = columnById.get(cell.columnId);
      if (!col) return `A cell references an unknown column.`;
      if (
        !cellValueSchema(col.kind as ColumnKind).safeParse(cell.value).success
      )
        return `Invalid ${col.kind} cell value on "${item.name}".`;
    }
  }
  return null;
}

/**
 * Materialize a validated proposal into a real board via the atomic
 * create_board_from_template RPC. This is the ONLY persistence path for F10 —
 * the human's explicit approval gate.
 */
export async function createBoardFromProposal(input: {
  workspaceId: string;
  proposal: { name: string; templatePayload: unknown };
}): Promise<ActionResult<{ boardId: string }>> {
  const parsed = createInputSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid proposal.");

  const err = structuralError(parsed.data.proposal.templatePayload);
  if (err) return fail(err);

  const supabase = await createClient();
  const { data, error } = await typedRpc(
    supabase,
    "create_board_from_template",
    {
      p_workspace_id: parsed.data.workspaceId,
      p_name: parsed.data.proposal.name,
      p_template: parsed.data.proposal.templatePayload,
    },
  );
  if (error || !data) return fail(error?.message ?? "Could not create board.");

  await invalidateMyBoards();
  return { ok: true, data: { boardId: data.id } };
}

/** Canonical E1 error → user-facing message mapping (see ai/actions.ts). */
function mapAiError(e: unknown): string {
  if (e instanceof AiDisabledError)
    return "AI is turned off for your organization.";
  if (e instanceof AiQuotaExceededError)
    return "You've used this month's AI allowance.";
  if (e instanceof ByoKeyMissingError)
    return "Your organization's AI key is missing — ask an admin to update Settings.";
  if (e instanceof AiNotConfiguredError)
    return "AI generation isn't configured.";
  return "AI generation failed. Please try again.";
}

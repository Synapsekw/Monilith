"use server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { runAi } from "@/lib/ai/gateway";
import { modelFor } from "@/lib/ai/model-map";
import { requireAiEntitlement } from "@/lib/ai/entitlement";
import {
  generateImportMapping,
  type ImportMappingPayload,
} from "@/lib/ai/import-mapping-generate";
import type { MappingSuggestion } from "@/lib/ai/import-mapping-schema";
import { IMPORTABLE_KINDS } from "@/lib/boards/spreadsheet/types";
import {
  AiDisabledError,
  AiQuotaExceededError,
  ByoKeyMissingError,
  AiNotConfiguredError,
  ProviderNotCapableError,
} from "@/lib/ai/errors";
import { fail, type ActionResult } from "@/lib/actions/result";

// Egress caps (F12 is a NEW raw-data egress class — verbatim cell values leave
// the workspace). Bounded here, server-side, so the client can never enlarge
// the sample sent to the model.
const MAX_MAPPING_COLUMNS = 40;
const MAX_SAMPLES_PER_COLUMN = 5;
const MAX_SAMPLE_CHARS = 500;
const MAX_HEADER_CHARS = 200;

const suggestImportMappingSchema = z.object({
  columns: z
    .array(
      z.object({
        sourceIndex: z.number().int().min(0),
        header: z.string(),
        sampleValues: z.array(z.string()).default([]),
      }),
    )
    .min(1),
  boardColumns: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        kind: z.string(),
      }),
    )
    .optional(),
});

const IMPORTABLE_KIND_SET = new Set<string>(IMPORTABLE_KINDS);

/**
 * Suggest a per-column import mapping for the spreadsheet Map step. This is a
 * NEW raw-data egress class: column headers plus a CAPPED sample of verbatim
 * cell values are sent to the model. The caps are enforced HERE (truncate), the
 * Map step shows an inline disclosure, and the result only ever patches CLIENT
 * state — this action performs NO database mutation. The existing Confirm step
 * gates the real commit.
 */
export async function suggestImportMapping(input: {
  columns: { sourceIndex: number; header: string; sampleValues: string[] }[];
  boardColumns?: { id: string; name: string; kind: string }[];
}): Promise<
  ActionResult<{ suggestions: MappingSuggestion[]; warnings: string[] }>
> {
  const parsed = suggestImportMappingSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Nothing to map.");

  // Enforce the raw-egress caps: truncate to ≤40 columns, ≤5 samples/column,
  // each sample length-bounded. Truncation (not rejection) keeps a large sheet
  // usable while still bounding what leaves the workspace.
  const boardColumns = parsed.data.boardColumns?.map((c) => ({
    id: c.id,
    name: c.name.slice(0, MAX_HEADER_CHARS),
    kind: c.kind,
  }));
  const payload: ImportMappingPayload = {
    columns: parsed.data.columns.slice(0, MAX_MAPPING_COLUMNS).map((c) => ({
      sourceIndex: c.sourceIndex,
      header: c.header.slice(0, MAX_HEADER_CHARS),
      sampleValues: c.sampleValues
        .slice(0, MAX_SAMPLES_PER_COLUMN)
        .map((v) => v.slice(0, MAX_SAMPLE_CHARS)),
    })),
    boardColumns,
  };

  const validSourceIndexes = new Set(payload.columns.map((c) => c.sourceIndex));
  const boardColIds = new Set((boardColumns ?? []).map((c) => c.id));

  try {
    const org = await resolveActiveOrg();
    if (!org) return fail("No organization.");
    await requireAiEntitlement(org.id, "import_mapping");
    const user = await requireUser();
    const choice = modelFor("import_mapping");

    const raw = await runAi(
      { orgId: org.id, userId: user.id, feature: "import_mapping" },
      async ({ adapter, apiKey }) => {
        const { suggestions, usage } = await generateImportMapping(payload, {
          adapter,
          apiKey,
          choice,
        });
        return { result: suggestions, usage, model: choice.model };
      },
    );

    // Clamp/filter the model output against the caller's real columns before it
    // is handed back to client state.
    const warnings: string[] = [];
    const suggestions: MappingSuggestion[] = [];
    for (const s of raw ?? []) {
      if (!validSourceIndexes.has(s?.sourceIndex)) {
        warnings.push(`Ignored a mapping for an unknown column.`);
        continue;
      }
      if (!IMPORTABLE_KIND_SET.has(s?.kind as string)) {
        warnings.push(
          `Ignored an unrecognized type for column ${s.sourceIndex}.`,
        );
        continue;
      }
      if (s?.role !== "name" && s?.role !== "data") {
        warnings.push(`Ignored an invalid role for column ${s.sourceIndex}.`);
        continue;
      }
      let targetColumnId = s.targetColumnId;
      if (targetColumnId && !boardColIds.has(targetColumnId)) {
        warnings.push(
          `Column ${s.sourceIndex} will create a new column (no confident match).`,
        );
        targetColumnId = undefined;
      }
      suggestions.push({
        sourceIndex: s.sourceIndex,
        kind: s.kind,
        role: s.role,
        ...(targetColumnId ? { targetColumnId } : {}),
      });
    }

    if (suggestions.length === 0)
      return fail("Couldn't suggest a mapping — set the columns manually.");

    return { ok: true, data: { suggestions, warnings } };
  } catch (e) {
    if (e instanceof ProviderNotCapableError)
      return fail("This AI provider can't suggest a mapping.");
    if (e instanceof AiDisabledError)
      return fail("AI is turned off for your organization.");
    if (e instanceof AiQuotaExceededError)
      return fail("You've used this month's AI allowance.");
    if (e instanceof ByoKeyMissingError)
      return fail(
        "Your organization's AI key is missing — ask an admin to update Settings.",
      );
    if (e instanceof AiNotConfiguredError)
      return fail("AI mapping isn't configured.");
    return fail("Couldn't suggest a mapping. Please try again.");
  }
}

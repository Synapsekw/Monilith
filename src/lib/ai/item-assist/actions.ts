"use server";
import { z } from "zod";
import { requireUser, getUserOrgs } from "@/lib/auth/session";
import { runAi } from "@/lib/ai/gateway";
import { requireAiEntitlement } from "@/lib/ai/entitlement";
import { MODEL } from "@/lib/ai/providers/anthropic";
import { generateItemAssist as generateItemAssistWithAi } from "@/lib/ai/item-assist/assist";
import { validateItemAssist } from "@/lib/ai/item-assist/validate";
import type {
  ItemAssistProposal,
  ItemAssistWant,
} from "@/lib/ai/item-assist/schema";
import { ProviderNotCapableError } from "@/lib/ai/errors";
import { mapAiError } from "@/lib/ai/action-guard";
import { createClient } from "@/lib/supabase/server";
import { getBoardPayload } from "@/lib/boards/queries";
import { fail, type ActionResult } from "@/lib/actions/result";
import type { ColumnOption } from "@/lib/validations/boards";

// Bounded prompt context: only THIS item's own TEXT-column cell values ever
// feed the model (never the rest of the board), and the joined string is
// capped so a pathological item with many long text columns can't blow up
// the prompt / token spend.
const TEXT_CONTEXT_MAX = 4000;

// `columnId` is optional here (unlike the strict ItemAssistWant lib type) so
// a caller can omit it and rely on the top-level `targetColumnId` convenience
// alias instead — resolved below, then re-assembled into a strict
// ItemAssistWant before it ever reaches the lib.
const columnRefSchema = z.object({ columnId: z.string().uuid().optional() });

const wantSchema = z
  .object({
    description: columnRefSchema.optional(),
    subtasks: z.boolean().optional(),
    status: columnRefSchema.optional(),
  })
  .refine(
    (w) => Boolean(w.description) || w.subtasks === true || Boolean(w.status),
    { message: "Pick something to generate." },
  );

const inputSchema = z.object({
  itemId: z.string().uuid(),
  want: wantSchema,
  targetColumnId: z.string().uuid().optional(),
});

/**
 * Item-assist proposal generation ("draft description" / "suggest subtasks"
 * / "propose status") for a single board item. Entitlement-gated before any
 * token spend; reads the item + board server-side (RLS — client-supplied
 * board data is never trusted). Returns a PROPOSAL ONLY — applying it is the
 * caller's job via the existing `upsertCell` / `addSubitem` actions, never
 * this one.
 */
export async function generateItemAssist(input: {
  itemId: string;
  want: ItemAssistWant;
  targetColumnId?: string;
}): Promise<
  ActionResult<{ proposal: ItemAssistProposal; warnings: string[] }>
> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid request.");
  const { itemId, want, targetColumnId } = parsed.data;

  const descriptionColumnId = want.description
    ? (want.description.columnId ?? targetColumnId)
    : undefined;
  const statusColumnId = want.status
    ? (want.status.columnId ?? targetColumnId)
    : undefined;

  try {
    const user = await requireUser();
    const org = (await getUserOrgs())[0];
    if (!org) return fail("No organization.");

    // Gate BEFORE any read/spend.
    await requireAiEntitlement(org.id, "item_assist");

    const supabase = await createClient();
    const { data: item, error: itemErr } = await supabase
      .from("items")
      .select("id, board_id, name, parent_id")
      .eq("id", itemId)
      .maybeSingle();
    if (itemErr) throw itemErr;
    if (!item) return fail("Item not found.");

    const payload = await getBoardPayload(item.board_id);
    if (!payload) return fail("Item not found.");

    let statusOptions: { id: string; label: string }[] | undefined;
    let statusOptionIds: Set<string> | undefined;
    if (want.status) {
      const statusColumn = statusColumnId
        ? payload.columns.find((c) => c.id === statusColumnId)
        : undefined;
      if (
        !statusColumn ||
        (statusColumn.kind !== "status" && statusColumn.kind !== "dropdown")
      ) {
        return fail("Pick a status column to propose into.");
      }
      const options =
        (statusColumn.settings as { options?: ColumnOption[] } | null)
          ?.options ?? [];
      statusOptions = options.map((o) => ({ id: o.id, label: o.label }));
      statusOptionIds = new Set(statusOptions.map((o) => o.id));
    }

    if (want.description) {
      const descriptionColumn = descriptionColumnId
        ? payload.columns.find((c) => c.id === descriptionColumnId)
        : undefined;
      if (!descriptionColumn || descriptionColumn.kind !== "text") {
        return fail("Pick a text column to draft into.");
      }
    }

    if (want.subtasks && item.parent_id !== null) {
      return fail("Subtasks can't be added to a subitem.");
    }

    // Bounded, item-scoped text context — only this item's own TEXT-column
    // cell values, never the rest of the board's data.
    const textColumnIds = new Set(
      payload.columns.filter((c) => c.kind === "text").map((c) => c.id),
    );
    const textContext = payload.cellValues
      .filter((c) => c.item_id === itemId && textColumnIds.has(c.column_id))
      .map((c) => (c.value as { text?: string } | null)?.text ?? "")
      .filter((t) => t.length > 0)
      .join("\n")
      .slice(0, TEXT_CONTEXT_MAX);

    // Re-assemble into the strict lib shape now that every requested target
    // column has been resolved and validated above.
    const effectiveWant: ItemAssistWant = {};
    if (want.description && descriptionColumnId) {
      effectiveWant.description = { columnId: descriptionColumnId };
    }
    if (want.subtasks) effectiveWant.subtasks = true;
    if (want.status && statusColumnId) {
      effectiveWant.status = { columnId: statusColumnId };
    }

    const proposal = await runAi(
      { orgId: org.id, userId: user.id, feature: "item_assist" },
      async ({ adapter, apiKey }) => {
        if (adapter.id !== "anthropic")
          throw new ProviderNotCapableError("item_assist");
        const r = await generateItemAssistWithAi({
          apiKey,
          item: { name: item.name, textContext: textContext || undefined },
          statusOptions,
          want: effectiveWant,
        });
        return { result: r.proposal, usage: r.usage, model: MODEL };
      },
    );

    const { proposal: validated, warnings } = validateItemAssist(proposal, {
      statusOptionIds,
    });

    return { ok: true, data: { proposal: validated, warnings } };
  } catch (e) {
    return fail(
      mapAiError(e, {
        fallback: "Couldn't generate a suggestion. Please try again.",
        notConfigured: "Add an AI provider key in Settings to use AI assist.",
        providerNotCapable: "AI assist needs an Anthropic key.",
      }),
    );
  }
}

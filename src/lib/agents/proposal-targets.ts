import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { ToolScope } from "@/lib/mcp/tools/descriptor";
import { descriptorsFor } from "./tool-descriptors";
import { AGENT_ONLY_DESCRIPTORS } from "./agent-only-tools";
import {
  toPendingProposal,
  type PendingProposal,
  type ProposalRow,
  type ProposalTarget,
  type ProposalTargetKind,
} from "./proposals-db";

/**
 * WHICH item. WHICH board. WHICH group.
 *
 * `proposal-summary.ts` can say `Rename an item to "X".` and nothing more: it
 * is PURE by design, holds only ids, and a DB read inside it would put a query
 * on a run's refusal path. That purity binds the RUN path. It does not bind the
 * READ path — and the module's whole stated property is that the owner reads a
 * description of what will really run. Every id in a proposal's payload is
 * MODEL-CHOSEN, and under prompt injection the attacker chooses it; "an item"
 * is precisely the word an attacker wants there.
 *
 * So the name is resolved HERE, where proposals are read for display, on the
 * READER's own RLS-scoped client. Two consequences, both deliberate:
 *
 *   - a resolution can never reveal a name the reader could not already read;
 *     an id they have lost access to simply resolves to nothing.
 *   - it is ONE bounded, indexed read per object kind for the whole page of
 *     proposals (working agreement #5) — never one query per card.
 *
 * WHICH id names the object is not re-derived here: it is the descriptor's own
 * `scope`, the same field `board-scope-guard.ts` reads, whose contract is that
 * the input field is named after the value (`"itemId"` ⇒ `input.itemId`). One
 * declaration, so a tool cannot be scoped one way and described another.
 */

type Client = SupabaseClient<Database>;

/** `scope` → the object that scope names. `"none"` tools address no single
 *  object and get no target line at all. */
const KIND_BY_SCOPE: Partial<Record<ToolScope, ProposalTargetKind>> = {
  itemId: "item",
  boardId: "board",
  groupId: "group",
};

/** The table each kind lives in. Both columns are on the primary key / a
 *  covering select, so every read below is an indexed `id IN (…)`. */
const TABLE_BY_KIND: Record<ProposalTargetKind, "items" | "boards" | "groups"> =
  {
    item: "items",
    board: "boards",
    group: "groups",
  };

/**
 * The scope of every tool a proposal can name, keyed by tool name.
 *
 * Built from `descriptorsFor({ extra: AGENT_ONLY_DESCRIPTORS })` — the SAME
 * composition the run's tool set, its grant gate and the decide path derive
 * from, so a tool that can be proposed is a tool this can describe. Module
 * scope: the composition is static, and a duplicate name throws there.
 */
const SCOPE_BY_TOOL: Map<string, ToolScope> = new Map(
  descriptorsFor({ extra: AGENT_ONLY_DESCRIPTORS }).map((d) => [
    d.name,
    d.scope,
  ]),
);

/** The kind and id one proposal addresses, or null when it addresses none —
 *  a `"none"` tool, an optional id the model omitted, or a tool that no longer
 *  exists. */
function targetIdOf(
  row: ProposalRow,
): { kind: ProposalTargetKind; id: string } | null {
  const scope = SCOPE_BY_TOOL.get(row.toolName);
  if (!scope) return null;
  const kind = KIND_BY_SCOPE[scope];
  if (!kind) return null;
  // The descriptor contract: the input field is named after the scope.
  const id = row.input[scope];
  return typeof id === "string" && id.length > 0 ? { kind, id } : null;
}

/**
 * Names for one kind, in ONE indexed read. Returns an empty map on failure
 * rather than throwing: a page of proposals must still render, and the caller
 * turns "no entry" into "no target line" rather than into a false claim that
 * the object is gone (see `withResolvedTargets`).
 */
async function readNames(
  client: Client,
  kind: ProposalTargetKind,
  ids: string[],
): Promise<Map<string, string> | null> {
  const { data, error } = await client
    .from(TABLE_BY_KIND[kind])
    .select("id, name")
    .in("id", ids)
    // Bounded by construction (`ids` is deduped from an already-bounded page of
    // proposals), and bounded again here so this cannot become the unbounded
    // read working agreement #5 forbids if a caller ever widens the page.
    .limit(ids.length);
  if (error) {
    console.error(`[agents] proposal ${kind} name read failed`, error);
    return null;
  }
  return new Map((data ?? []).map((r) => [r.id, r.name]));
}

/**
 * Project a page of proposal rows for display, WITH the name of the object each
 * one would act on.
 *
 * At most three round trips for the whole page regardless of how many cards it
 * holds, and none at all for a page whose proposals address no object.
 *
 * DEGRADATION, in two distinct shapes, because conflating them would lie:
 *   - the read SUCCEEDED and the id was not in it ⇒ `name: null`. The object is
 *     genuinely gone or no longer visible to this reader, and the card says so.
 *   - the read FAILED ⇒ `target: null`, i.e. no claim at all. Telling the owner
 *     their item was deleted because Postgres blinked would be worse than the
 *     id-less sentence they had before.
 */
export async function withResolvedTargets(
  client: Client,
  rows: ProposalRow[],
): Promise<PendingProposal[]> {
  const idsByKind = new Map<ProposalTargetKind, Set<string>>();
  for (const row of rows) {
    const target = targetIdOf(row);
    if (!target) continue;
    const set = idsByKind.get(target.kind) ?? new Set<string>();
    set.add(target.id);
    idsByKind.set(target.kind, set);
  }

  const resolved = new Map<ProposalTargetKind, Map<string, string> | null>();
  await Promise.all(
    [...idsByKind].map(async ([kind, ids]) => {
      resolved.set(kind, await readNames(client, kind, [...ids]));
    }),
  );

  return rows.map((row) => {
    const base = toPendingProposal(row);
    const target = targetIdOf(row);
    if (!target) return base;
    const names = resolved.get(target.kind);
    // The read failed: make no claim about this object at all.
    if (!names) return base;
    const resolvedTarget: ProposalTarget = {
      kind: target.kind,
      name: names.get(target.id) ?? null,
    };
    return { ...base, target: resolvedTarget };
  });
}

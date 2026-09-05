import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { ToolDescriptor } from "@/lib/mcp/tools/descriptor";
import type { ToolResult } from "@/lib/mcp/tools/shared";
import type { AgentCapability } from "./capabilities";
import { getUserAgentById, type UserAgentRow } from "./agents-db";
import {
  executeAgentRun,
  newRunProgress,
  type ExecuteRunResult,
  type RunProgress,
} from "./execute-run";
import {
  claimAgentRun,
  CLAIM_REFUSAL_COPY,
  DELEGATE_FANOUT_MAX,
} from "./run-claim";

/** How much of a child's report the parent is shown. A report is a summary,
 *  not a transcript; past this the child is spending the PARENT's context on
 *  text the parent asked for one paragraph of. */
export const DELEGATE_REPORT_MAX_CHARS = 4000;
/** How much of each teammate's instructions the roster line quotes — enough to
 *  choose between agents, not enough to re-teach them. */
const ROSTER_BLURB_CHARS = 120;
/** The same bound the agents settings page reads the roster with, over
 *  `user_agents_owner_enabled_idx`. */
const ROSTER_LIMIT = 20;
/** The longest task a parent may hand a child. Long enough for a real brief;
 *  short enough that a runaway parent cannot paste its whole context in. */
const TASK_MAX_CHARS = 2000;

export type DelegateRosterEntry = {
  id: string;
  handle: string;
  name: string;
  instructions: string;
};

/** Neutralise owner-authored text bound for a single line of a tool
 *  DESCRIPTION: strip newlines (which could start a line the model reads as a
 *  new rule) and angle brackets (which could open or close a delimiter). The
 *  same function `persona.ts` applies to an agent name — kept identical on
 *  purpose; if one hardens, both should. */
function sanitizeInline(text: string): string {
  return text.replace(/[\r\n]+/g, " ").replace(/[<>]/g, "");
}

function ok(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}
function err(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * The other agents this one may delegate to: the SAME owner, the SAME org,
 * enabled, and never itself.
 *
 * Bounded and index-ordered by construction (working agreement #5) — this runs
 * inside a live agent run, and an owner with a hundred agents must not turn one
 * delegation into an unbounded scan or a tool description the size of a
 * context window.
 *
 * A read failure degrades to an EMPTY roster rather than throwing: the worst
 * case is a run that cannot delegate, which is strictly better than a run that
 * dies before it starts.
 */
export async function listDelegateRoster(
  client: SupabaseClient<Database>,
  agent: Pick<UserAgentRow, "id" | "org_id" | "owner_id">,
): Promise<DelegateRosterEntry[]> {
  const { data, error } = await client
    .from("user_agents")
    .select("id, handle, name, instructions")
    .eq("owner_id", agent.owner_id)
    .eq("org_id", agent.org_id)
    .eq("enabled", true)
    .neq("id", agent.id)
    .order("handle")
    .limit(ROSTER_LIMIT);
  if (error) {
    console.error("[agents] listDelegateRoster failed:", error.message);
    return [];
  }
  return (data ?? []) as DelegateRosterEntry[];
}

/**
 * Write a CHILD run's outcome onto its own row, BY ID.
 *
 * The same field set `route.ts`'s `finalizeRun` writes, because a delegated run
 * is a run: it appears in the owner's history, it carries its own tokens, and
 * "what did my agent do" must answer for it exactly as it does for a scheduled
 * one. Keyed on `id` rather than the (agent, date, hour) slot — a nested run
 * has no fire slot at all (`fire_hour` is null for it).
 *
 * BEST EFFORT: a failure here is logged, never thrown. The parent is mid-run
 * and holding a report the child really produced; losing the whole parent run
 * over a bookkeeping write would be a strictly worse outcome than an
 * unfinalized child row.
 */
async function finalizeChildRun(
  svc: SupabaseClient<Database>,
  runId: string,
  status: "ran" | "error",
  result: ExecuteRunResult | null,
  progress: RunProgress,
  errorMessage?: string,
): Promise<void> {
  const { error } = await svc
    .from("user_agent_runs")
    .update({
      status,
      error: errorMessage ?? null,
      input_tokens: result?.usage.inputTokens ?? null,
      output_tokens: result?.usage.outputTokens ?? null,
      // Off the RESULT on the success path and off `progress` on the error
      // path — exactly what `route.ts` does. A child that died mid-loop still
      // did whatever its completed steps did, and `progress` is the only
      // record of it once the promise rejected.
      grants: progress.grants,
      steps: result?.steps ?? progress.steps,
      tools_used: result?.toolsUsed ?? progress.toolsUsed,
      model_substituted: progress.modelSubstituted,
      output: result?.text ?? null,
      documents_omitted: result?.documentsOmitted ?? false,
      memory_notes_dropped: result?.memoryNotesDropped ?? 0,
    })
    .eq("id", runId);
  if (error)
    console.error("[agents] finalizeChildRun failed:", {
      runId,
      status,
      cause: error.message,
    });
}

/**
 * ONE tool, not one per agent.
 *
 * A tool named after a handle would make the TOOL NAMESPACE a function of
 * user-authored text, and `descriptorsFor` throws `DuplicateToolNameError` on
 * any collision — deliberately, because silent shadowing is how an extra write
 * tool once executed ungated. That turns "two awkward handles" into a run that
 * dies at construction. A single tool with a server-built enum makes the
 * collision unrepresentable, keeps the schema cost O(1), and keeps fan-out
 * enforcement in one handler.
 *
 * Returns [] for an empty roster: no teammates means no tool, no context spent,
 * and no `z.enum([])` (which is not a valid schema).
 *
 * MUST be passed as `buildAgentRuntime`'s `extra` — the SAME array reaching
 * both `buildAgentTools` and `makeGrantGate`, or the tool is offered and then
 * denied "Unknown tool." on every call.
 *
 * `capability: "agent.delegate"` means this is gated by the two-key grant gate
 * like every other write: the agent must hold it AND the org ceiling must allow
 * it. The ceiling backfill was deliberately not run, so delegation is inert on
 * every existing org until an admin ticks it — that is the intended default.
 */
export function makeDelegateDescriptors(args: {
  svc: SupabaseClient<Database>;
  ownerClient: SupabaseClient<Database>;
  parentRunId: string;
  ceiling: AgentCapability[];
  roster: DelegateRosterEntry[];
}): ToolDescriptor[] {
  if (args.roster.length === 0) return [];

  const byHandle = new Map(args.roster.map((r) => [r.handle, r]));
  const handles = args.roster.map((r) => r.handle) as [string, ...string[]];
  const lines = args.roster.map(
    (r) =>
      `@${r.handle} — ${sanitizeInline(r.name)}: ` +
      sanitizeInline(r.instructions).slice(0, ROSTER_BLURB_CHARS),
  );

  const shape = {
    handle: z.enum(handles),
    task: z.string().trim().min(1).max(TASK_MAX_CHARS),
  };

  return [
    {
      name: "delegate",
      title: "Delegate",
      description:
        "Hand ONE self-contained task to one of your teammates and get their " +
        "written report back. Say everything they need in `task` — they cannot " +
        "see this conversation. They act under THEIR OWN permissions, not " +
        `yours. You may delegate at most ${DELEGATE_FANOUT_MAX} times in one ` +
        "run, and a teammate cannot delegate onward, so do the simple lookups " +
        "yourself.\nYour teammates:\n" +
        lines.join("\n"),
      inputSchema: shape,
      capability: "agent.delegate",
      scope: "none",
      invoke: async (_ctx, raw): Promise<ToolResult> => {
        // PARSED, not cast. Both transports validate against `inputSchema`
        // first, but the refusal message is the model's only route back to a
        // valid call, so this handler produces it itself.
        const parsed = z.object(shape).safeParse(raw);
        if (!parsed.success)
          return err(parsed.error.issues[0]?.message ?? "Invalid delegation.");
        const entry = byHandle.get(parsed.data.handle);
        if (!entry)
          return err(`You have no teammate called @${parsed.data.handle}.`);

        // THE claim — depth, fan-out, the cooldown, the daily cap, ownership
        // and the kill switch are all decided here, in SQL, under a row lock.
        // Nothing below re-checks them, because a second copy is a copy that
        // can disagree.
        const claim = await claimAgentRun(args.svc, {
          agentId: entry.id,
          trigger: "delegation",
          parentRunId: args.parentRunId,
        });
        if (claim.outcome !== "claimed" || !claim.runId) {
          return err(
            CLAIM_REFUSAL_COPY[
              claim.outcome as Exclude<typeof claim.outcome, "claimed">
            ],
          );
        }

        const child = await getUserAgentById(args.svc, entry.id);
        if (!child) return err(`@${entry.handle} is no longer available.`);

        const progress = newRunProgress();
        try {
          const r = await executeAgentRun({
            svc: args.svc,
            // The parent's client, REUSED. Parent and child share an owner by
            // construction (agent_run_claim enforces it), and minting a second
            // bridge secret calls generateLink, which GoTrue rate-limits.
            ownerClient: args.ownerClient,
            agent: child,
            // The CHILD's own run id, never the parent's — that is what makes
            // the child's spend attributable and its history row its own.
            runId: claim.runId,
            // The ORG CEILING, not the parent's effective grants.
            // `executeAgentRun` intersects it with the CHILD's own
            // capabilities, so a delegated agent can only ever do less than it
            // could on its own schedule — delegation never widens.
            ceiling: args.ceiling,
            task: parsed.data.task,
            // THE DEPTH CAP, second layer. The DB CHECK is the guarantee; this
            // is why the model is never even offered the tool one level down.
            allowDelegation: false,
            progress,
          });
          await finalizeChildRun(args.svc, claim.runId, "ran", r, progress);
          const body =
            r.text.length > DELEGATE_REPORT_MAX_CHARS
              ? `${r.text.slice(0, DELEGATE_REPORT_MAX_CHARS)}\n… (truncated)`
              : r.text;
          return ok(`Report from @${entry.handle}:\n${body}`);
        } catch (e) {
          const message = e instanceof Error ? e.message : "unknown";
          await finalizeChildRun(
            args.svc,
            claim.runId,
            "error",
            null,
            progress,
            message,
          );
          // A dead child must never kill the parent — same posture as a denied
          // write: hand it back as a tool result and let the loop continue.
          return err(`@${entry.handle} could not finish: ${message}`);
        }
      },
    },
  ];
}

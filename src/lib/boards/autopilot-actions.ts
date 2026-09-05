"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { fail, type ActionResult } from "@/lib/actions/result";
import {
  boardAgentSettingsSchema,
  type BoardAgentSettings,
} from "@/lib/ai/agentic/autopilot-config";
import {
  getBoardAgentByBoard,
  upsertBoardAgent,
} from "@/lib/ai/agentic/board-agents-db";
import { readOrgAiSettings } from "@/lib/ai/org-settings";
import { DEFAULT_ASSISTANT_NAME } from "@/lib/org/assistant-name";

/** The default (disabled) agent shape shown before one is configured. */
const DEFAULT_SETTINGS: BoardAgentSettings = {
  enabled: false,
  cadence: "daily",
  runAtLocalHour: 8,
  tasks: [],
};

export type BoardAutopilotState = {
  settings: BoardAgentSettings;
  /** Only org admins may change the agent (RLS enforces; this gates the UI). */
  isAdmin: boolean;
  /** Whether a row already exists (vs. the default template). */
  configured: boolean;
  /**
   * What THIS org calls the built-in assistant — the identity the agent's
   * comments and notifications are posted as. Resolved server-side so the card
   * never has to know the product default.
   */
  assistantName: string;
};

async function isOrgAdmin(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();
  return data?.role === "owner" || data?.role === "admin";
}

/**
 * Load the board's Autopilot configuration for the settings card. RLS scopes the
 * `board_agents` read to org members; a board with no agent yet returns the
 * disabled default template so the card renders a clean "off" state.
 */
export async function getBoardAutopilot(
  boardId: string,
): Promise<BoardAutopilotState> {
  const supabase = await createClient();
  const { data: board } = await supabase
    .from("boards")
    .select("org_id")
    .eq("id", boardId)
    .maybeSingle();
  if (!board)
    return {
      settings: DEFAULT_SETTINGS,
      isAdmin: false,
      configured: false,
      assistantName: DEFAULT_ASSISTANT_NAME,
    };

  // Three bounded reads, all on the primary/indexed key, run together — the
  // assistant name is one more column on a one-row-per-org table the member
  // can already select (`org_ai_settings_select_member`), not a new round-trip
  // per interaction: the card holds it as client state from here on.
  const [agent, isAdmin, assistantName] = await Promise.all([
    getBoardAgentByBoard(supabase, boardId),
    isOrgAdmin(supabase, board.org_id),
    // Non-fatal: `readOrgAiSettings` THROWS on a read error, and this whole
    // card — kill switch included — would go down with it over a label. The
    // name is the only thing taken from that read, so a failure degrades to
    // the product default instead.
    readOrgAiSettings(supabase, board.org_id)
      .then((s) => s.assistantName)
      .catch(() => DEFAULT_ASSISTANT_NAME),
  ]);

  if (!agent)
    return {
      settings: DEFAULT_SETTINGS,
      isAdmin,
      configured: false,
      assistantName,
    };
  return {
    settings: {
      enabled: agent.enabled,
      cadence: agent.cadence,
      runAtLocalHour: agent.run_at_local_hour,
      tasks: agent.config?.tasks ?? [],
    },
    isAdmin,
    configured: true,
    assistantName,
  };
}

/**
 * Persist the board's Autopilot settings (admin-only — the app gate here mirrors
 * the `board_agents` admin-write RLS policy, which is the real boundary). The
 * enable flag is the kill switch: `enabled=false` stops the sweep from firing.
 */
export async function saveBoardAutopilot(input: {
  boardId: string;
  settings: unknown;
}): Promise<ActionResult> {
  const parsed = boardAgentSettingsSchema.safeParse(input.settings);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid settings");

  const supabase = await createClient();
  const { data: board } = await supabase
    .from("boards")
    .select("org_id")
    .eq("id", input.boardId)
    .maybeSingle();
  if (!board) return fail("Board not found.");

  if (!(await isOrgAdmin(supabase, board.org_id))) {
    return fail("Only an organization admin can configure Autopilot.");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  const error = await upsertBoardAgent(supabase, {
    orgId: board.org_id,
    boardId: input.boardId,
    createdBy: user.id,
    settings: parsed.data,
  });
  if (error) return fail(error.message);

  revalidatePath(`/boards/${input.boardId}`);
  return { ok: true, data: undefined };
}

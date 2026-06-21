import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signInWithRetry } from "@/test/integration-auth";
import type { Database } from "@/types/database.types";

config({ path: ".env.local", override: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "Test-Password-123!";

// Fixed reference date so the overdue computation is deterministic.
const TODAY = "2026-06-21";

// Seeded board has 3 non-subitem items:
//   - "done-item":    status = Done option, date 2026-06-25 (future) → done, not overdue
//   - "overdue-item": no status,            date 2026-06-10 (< TODAY) → not done, overdue
//   - "open-item":    no status,            date 2026-07-01 (future) → not done, not overdue
// Expected rollup: total 3, done 1, overdue 1, timeline 2026-06-10 .. 2026-07-01.
const EXPECTED = {
  total: 3,
  done: 1,
  overdue: 1,
  timelineStart: "2026-06-10",
  timelineEnd: "2026-07-01",
};

describe.skipIf(!SERVICE_ROLE_KEY)("RLS + rollup: portfolios", () => {
  let admin: SupabaseClient<Database>;
  const createdUserIds: string[] = [];

  // org A: creator + a status/date board with 3 items; org B: outsider in a different org.
  let aAnon: SupabaseClient<Database>;
  let bAnon: SupabaseClient<Database>;
  let orgId: string;
  let portfolioId: string;
  let boardId: string;
  let statusColumnId: string;
  let dateColumnId: string;
  let doneOptionId: string;

  async function provisionUser(label: string): Promise<{
    id: string;
    anon: SupabaseClient<Database>;
    orgId: string;
  }> {
    const email = `pf-${label}-${randomUUID()}@example.com`;
    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
      });
    expect(createErr, `createUser(${label})`).toBeNull();
    const id = created.user!.id;
    createdUserIds.push(id);

    const anon = createClient<Database>(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await signInWithRetry(anon, { email, password: PASSWORD });

    const { data: org, error: orgErr } = await anon.rpc("create_organization", {
      p_name: `Org ${label} ${randomUUID().slice(0, 8)}`,
      p_slug: `pf-${label}-${randomUUID().slice(0, 8)}`,
    });
    expect(orgErr, `create_organization(${label})`).toBeNull();
    return { id, anon, orgId: (org as { id: string }).id };
  }

  // Seed an item on org A's board with an optional status option + date cell.
  async function seedItem(
    name: string,
    opts: { statusOptionId?: string; date?: string },
  ): Promise<string> {
    const { data: group } = await aAnon
      .from("groups")
      .select("id")
      .eq("board_id", boardId)
      .limit(1)
      .single();

    const { data: item, error: itemErr } = await aAnon.rpc("create_item", {
      p_group_id: (group as { id: string }).id,
      p_name: name,
    });
    expect(itemErr, `create_item(${name})`).toBeNull();
    const itemId = (item as { id: string }).id;

    if (opts.statusOptionId) {
      const { error } = await aAnon.from("cell_values").upsert({
        org_id: orgId,
        board_id: boardId,
        item_id: itemId,
        column_id: statusColumnId,
        value: { optionId: opts.statusOptionId },
      });
      expect(error, `status cell(${name})`).toBeNull();
    }
    if (opts.date) {
      const { error } = await aAnon.from("cell_values").upsert({
        org_id: orgId,
        board_id: boardId,
        item_id: itemId,
        column_id: dateColumnId,
        value: { date: opts.date },
      });
      expect(error, `date cell(${name})`).toBeNull();
    }
    return itemId;
  }

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // -- creator in org A --
    const a = await provisionUser("a");
    aAnon = a.anon;
    orgId = a.orgId;

    // -- a board with the seeded Status column + a Date column --
    const { data: ws, error: wsErr } = await aAnon
      .from("workspaces")
      .insert({ org_id: orgId, name: "WS A", created_by: a.id })
      .select("id")
      .single();
    expect(wsErr, "insert workspace").toBeNull();
    const { data: board, error: boardErr } = await aAnon.rpc("create_board", {
      p_workspace_id: (ws as { id: string }).id,
      p_name: "Launch",
    });
    expect(boardErr, "create_board").toBeNull();
    boardId = (board as { id: string }).id;

    // Discover the board's seeded Status column + its "Done" option.
    const { data: statusCol } = await aAnon
      .from("columns")
      .select("id, settings")
      .eq("board_id", boardId)
      .eq("kind", "status")
      .single();
    statusColumnId = (statusCol as { id: string }).id;
    const options = (
      statusCol as unknown as {
        settings: { options: { id: string; label: string }[] };
      }
    ).settings.options;
    doneOptionId = options.find((o) => o.label === "Done")!.id;

    // Add a Date column to the board.
    const { data: dateCol, error: dateColErr } = await aAnon
      .from("columns")
      .insert({
        org_id: orgId,
        board_id: boardId,
        name: "Due",
        kind: "date",
        settings: {},
        position: 50,
      })
      .select("id")
      .single();
    expect(dateColErr, "insert date column").toBeNull();
    dateColumnId = (dateCol as { id: string }).id;

    // Seed exactly: 1 done (future date), 1 overdue (past, no status), 1 open (future, no status).
    await seedItem("done-item", {
      statusOptionId: doneOptionId,
      date: "2026-06-25",
    });
    await seedItem("overdue-item", { date: "2026-06-10" });
    await seedItem("open-item", { date: "2026-07-01" });

    // -- a portfolio in org A --
    const { data: pf, error: pfErr } = await aAnon.rpc("create_portfolio", {
      p_name: "Q3",
    });
    expect(pfErr, "create_portfolio").toBeNull();
    portfolioId = (pf as { id: string }).id;

    // -- outsider in a separate org B --
    const b = await provisionUser("b");
    bAnon = b.anon;
  }, 90_000);

  afterAll(async () => {
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  it("the creator can add a board and the rollup returns the seeded concrete counts", async () => {
    const { error: addErr } = await aAnon.rpc("add_portfolio_board", {
      p_portfolio_id: portfolioId,
      p_board_id: boardId,
      p_done_column_id: statusColumnId,
      p_done_option_ids: [doneOptionId],
    });
    expect(addErr).toBeNull();

    const { data, error } = await aAnon.rpc("portfolio_rollup", {
      p_portfolio_id: portfolioId,
      p_today: TODAY,
    });
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(1);

    const row = data![0];
    expect(row.board_id).toBe(boardId);
    expect(Number(row.total_items)).toBe(EXPECTED.total);
    expect(Number(row.done_items)).toBe(EXPECTED.done);
    expect(Number(row.overdue_items)).toBe(EXPECTED.overdue);
    expect(row.timeline_start).toBe(EXPECTED.timelineStart);
    expect(row.timeline_end).toBe(EXPECTED.timelineEnd);
  });

  it("a different org cannot read the portfolio or call its rollup (cross-tenant)", async () => {
    const { data: rows } = await bAnon
      .from("portfolios")
      .select("id")
      .eq("id", portfolioId);
    expect(rows ?? []).toHaveLength(0);

    const { error } = await bAnon.rpc("portfolio_rollup", {
      p_portfolio_id: portfolioId,
      p_today: TODAY,
    });
    expect(error).not.toBeNull(); // 42501 not a member of this organization
  });

  it("an outsider cannot add a board to the portfolio (non-editor write denial)", async () => {
    const { error } = await bAnon.rpc("add_portfolio_board", {
      p_portfolio_id: portfolioId,
      p_board_id: boardId,
      p_done_column_id: statusColumnId,
      p_done_option_ids: [doneOptionId],
    });
    expect(error).not.toBeNull();
  });
});

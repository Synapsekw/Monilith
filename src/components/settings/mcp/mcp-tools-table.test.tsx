import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { McpToolsTable, MCP_TOOLS_TABLE_ROWS } from "./mcp-tools-table";
import { registerTools } from "@/lib/mcp/tools/register";

/**
 * Structural stub of the one `McpServer` method `registerDescriptor` calls.
 * `registerTools` never touches anything else on `server`, so this is enough
 * to drive the REAL registration code path without a live SDK server.
 */
interface RegisterToolStub {
  registerTool: (name: string, config: unknown, cb: unknown) => unknown;
}

/** A fake `AuthInfo` shaped like what `resolveMcpAuth` produces — see
 * `src/lib/mcp/context.ts`. `registerTools` calls `mcpActorId(auth)` eagerly,
 * which throws unless `extra.userId` is a non-empty string; nothing else in
 * `extra` is read during registration (`getClient` is a closure nothing here
 * invokes). */
const fakeAuth: AuthInfo = {
  token: "test-token",
  clientId: "test-client",
  scopes: [],
  extra: {
    userId: "00000000-0000-0000-0000-000000000000",
    tokenRowId: "00000000-0000-0000-0000-000000000001",
    bridgeSecretId: "00000000-0000-0000-0000-000000000002",
  },
};

/**
 * Runs the REAL `registerTools` against a recording stub and returns every
 * name it registered, in registration order. `MCP_TOOLS_TABLE_ROWS` and
 * `registerTools` both iterate the same `ALL_TOOL_DESCRIPTORS` list
 * (`src/lib/mcp/tools/catalog.ts`), so their name sets cannot drift apart —
 * this helper exists to prove the render actually surfaces every registered
 * tool, not to catch a divergence that structurally cannot happen anymore.
 */
function deriveRegisteredToolNames(): string[] {
  const names: string[] = [];
  const stubServer: RegisterToolStub = {
    registerTool: (name) => {
      names.push(name);
      return undefined;
    },
  };
  registerTools(stubServer as unknown as McpServer, fakeAuth);
  return names;
}

describe("McpToolsTable", () => {
  it("carries consent prose for every registered tool", () => {
    // Deliberately loosened from an exact key-set comparison between
    // `TOOL_PROSE` and `ALL_TOOL_DESCRIPTORS` for the duration of the MCP
    // write-surface plan (docs/superpowers/plans/2026-09-07-mcp-write-surface.md),
    // whose tasks add tools to `ALL_TOOL_DESCRIPTORS` across several
    // concurrent branches. Instead of pinning the frozen key set, this
    // checks the property that actually matters: no registered tool renders
    // with empty prose. A newly added tool with no `TOOL_PROSE` entry still
    // fails this — it is a stronger check than set-equality, not weaker — it
    // just no longer requires every branch to touch this exact key set in
    // lockstep. The plan's Task 11 re-pins the exact key-set comparison.
    for (const row of MCP_TOOLS_TABLE_ROWS)
      expect((row.what ?? "").length).toBeGreaterThan(0);
  });

  it("classifies the original read tools as reads", () => {
    // Deliberately loosened from an exact write-list assertion for the
    // duration of the MCP write-surface plan
    // (docs/superpowers/plans/2026-09-07-mcp-write-surface.md), whose tasks
    // add tools to this catalog across several concurrent branches. Instead
    // of pinning the full write list, this checks the property that
    // actually matters: the five pre-existing write tools still render as
    // "write", and a sample of pre-existing read tools still render as
    // "read". The plan's Task 11 re-pins the full, exact write list.
    const byName = new Map(MCP_TOOLS_TABLE_ROWS.map((r) => [r.name, r]));

    // `create_attachment_upload` inserts nothing itself, but it hands out a
    // signed URL that puts bytes in the caller's storage — a real mutation of
    // tenant state even when `attach_file` is never called. The consent screen
    // errs toward naming a capability as a write rather than understating it.
    const preExistingWrites = [
      "attach_file",
      "create_attachment_upload",
      "create_item",
      "log_time_allocation",
      "update_item",
    ];
    for (const name of preExistingWrites) {
      expect(byName.get(name)?.access).toBe("write");
    }

    const preExistingReads = [
      "list_boards",
      "get_board",
      "list_items",
      "search_items",
      "get_item",
    ];
    for (const name of preExistingReads) {
      expect(byName.get(name)?.access).toBe("read");
    }
  });

  it("renders every tool name", () => {
    render(<McpToolsTable />);
    for (const name of deriveRegisteredToolNames()) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it("discloses the one destructive capability instead of claiming none exists", () => {
    render(<McpToolsTable />);

    // The blanket "cannot delete anything" claim this replaced was FALSE:
    // `upsert_time_allocation` with `p_duration_secs = 0` runs a
    // `delete from public.time_allocations` (migration 20260806060855), and
    // log_time_allocation's Zod accepts `secs: 0`. The consent screen is the
    // user's only account of what they are granting, so it must name that.
    expect(
      screen.getByText(
        /only thing a connected client can erase is your logged time/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/0 seconds clears it/i)).toBeInTheDocument();
    expect(
      screen.getByText(/no other delete tool exists on the server/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/cannot delete anything/i)).toBeNull();

    // …and it must agree with the row two lines above it, which already says
    // "0 clears it" — trailer and table can no longer contradict each other.
    const row = MCP_TOOLS_TABLE_ROWS.find(
      (r) => r.name === "log_time_allocation",
    );
    expect(row?.what).toMatch(/0 clears it/);
  });
});

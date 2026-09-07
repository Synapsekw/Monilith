import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import {
  McpToolsTable,
  MCP_TOOLS_TABLE_ROWS,
  TOOL_PROSE,
} from "./mcp-tools-table";
import { registerTools } from "@/lib/mcp/tools/register";
import { ALL_TOOL_DESCRIPTORS } from "@/lib/mcp/tools/catalog";

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
    // Exact key-set comparison: `TOOL_PROSE` must have exactly one entry per
    // descriptor in `ALL_TOOL_DESCRIPTORS` — no missing entry (which the type
    // annotation alone cannot catch, see the comment on `TOOL_PROSE`) and no
    // stale entry left behind for a tool that no longer exists.
    const proseNames = Object.keys(TOOL_PROSE).sort();
    const descriptorNames = ALL_TOOL_DESCRIPTORS.map((d) => d.name).sort();
    expect(proseNames).toEqual(descriptorNames);

    for (const row of MCP_TOOLS_TABLE_ROWS)
      expect((row.what ?? "").length).toBeGreaterThan(0);
  });

  it("derives every tool's access from its capability, in both directions", () => {
    // Independent of the frozen write-list check below: this derives the
    // expected classification directly from each descriptor's `capability`
    // (`access` in `mcp-tools-table.tsx` is computed FROM `capability`, not
    // hand-written) and asserts every row agrees: a descriptor whose
    // capability is `null`, or whose capability map (a grouped-dispatch tool,
    // keyed by action) has `null` for every action, must render as "read";
    // every other descriptor must render as "write". Looping over
    // `ALL_TOOL_DESCRIPTORS` means this needs no update when a tool is added
    // and catches misclassification in EITHER direction — strictly stronger
    // than the frozen list, which only ever pins the tools already on it.
    const byName = new Map(MCP_TOOLS_TABLE_ROWS.map((r) => [r.name, r]));
    for (const d of ALL_TOOL_DESCRIPTORS) {
      const isAlwaysRead =
        d.capability === null ||
        (typeof d.capability === "object" &&
          Object.values(d.capability).every((v) => v === null));
      const expected = isAlwaysRead ? "read" : "write";
      expect(
        byName.get(d.name)?.access,
        `expected "${d.name}" to render as "${expected}"`,
      ).toBe(expected);
    }
  });

  it("classifies the original read tools as reads", () => {
    // Second, independent check that pins the specific pre-existing
    // classifications that were reasoned about by hand (the derived test
    // above covers every tool structurally; this one is a cheap, targeted
    // pin on top of it).
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

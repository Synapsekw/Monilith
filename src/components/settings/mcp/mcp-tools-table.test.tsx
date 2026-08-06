import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { McpToolsTable, MCP_TOOLS_TABLE_ROWS } from "./mcp-tools-table";
import { registerTools } from "@/lib/mcp/tools/register";

/**
 * Structural stub of the one `McpServer` method every `register…Tool` helper
 * calls. `registerTools` never touches anything else on `server`, so this is
 * enough to drive the REAL registration code path without a live SDK server.
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
 * name it registered, in registration order. This is the derivation the sync
 * test relies on — it fails if a tool is registered without a table row (or
 * vice versa), because it reads the actual registration call, not a second
 * hand-maintained list that could drift in lockstep with the table.
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
  it("lists exactly the registered tools — no more, no fewer", () => {
    // This table is the user's ONLY account of what a connected client may do.
    // A tool registered without a row here understates the access being granted.
    const registered = deriveRegisteredToolNames();
    expect([...MCP_TOOLS_TABLE_ROWS.map((r) => r.name)].sort()).toEqual(
      [...registered].sort(),
    );
  });

  it("marks exactly the three write tools as writes", () => {
    const writes = MCP_TOOLS_TABLE_ROWS.filter((r) => r.access === "write").map(
      (r) => r.name,
    );
    expect(writes.sort()).toEqual([
      "create_item",
      "log_time_allocation",
      "update_item",
    ]);
  });

  it("renders every tool name", () => {
    render(<McpToolsTable />);
    for (const name of deriveRegisteredToolNames()) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it("states that no tool can delete", () => {
    render(<McpToolsTable />);
    expect(screen.getByText(/cannot delete/i)).toBeInTheDocument();
  });
});

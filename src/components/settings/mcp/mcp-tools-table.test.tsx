import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { McpToolsTable, MCP_TOOLS_TABLE_ROWS } from "./mcp-tools-table";
import { MCP_TOOL_NAMES } from "@/lib/mcp/tools/register";

describe("McpToolsTable", () => {
  it("lists exactly the registered tools — no more, no fewer", () => {
    // This table is the user's ONLY account of what a connected client may do.
    // A tool registered without a row here understates the access being granted.
    expect([...MCP_TOOLS_TABLE_ROWS.map((r) => r.name)].sort()).toEqual(
      [...MCP_TOOL_NAMES].sort(),
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
    for (const name of MCP_TOOL_NAMES) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });
});

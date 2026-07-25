import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { McpToolsTable } from "./mcp-tools-table";

describe("McpToolsTable", () => {
  it("lists all six registered tools", () => {
    render(<McpToolsTable />);
    for (const name of [
      "list_boards",
      "get_board",
      "search_items",
      "get_item",
      "create_item",
      "update_item",
    ]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it("marks exactly two tools as write access and four as read", () => {
    render(<McpToolsTable />);
    expect(screen.getAllByText("Write")).toHaveLength(2);
    expect(screen.getAllByText("Read")).toHaveLength(4);
  });

  it("states that no tool can delete", () => {
    render(<McpToolsTable />);
    expect(screen.getByText(/cannot delete/i)).toBeInTheDocument();
  });
});

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddColumnMenu } from "./AddColumnMenu";

describe("AddColumnMenu", () => {
  it("lists every column kind from metadata", async () => {
    render(<AddColumnMenu onAdd={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /add column/i }));
    for (const label of [
      "Checkbox",
      "Rating",
      "Link",
      "Email",
      "Phone",
      "Files",
    ]) {
      expect(screen.getByRole("menuitem", { name: label })).toBeInTheDocument();
    }
  });

  it("calls onAdd with the chosen kind", async () => {
    const onAdd = vi.fn();
    render(<AddColumnMenu onAdd={onAdd} />);
    await userEvent.click(screen.getByRole("button", { name: /add column/i }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Rating" }));
    expect(onAdd).toHaveBeenCalledWith("rating");
  });
});

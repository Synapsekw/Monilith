import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { StatusOptionList, parsePercentInput } from "./status-options";

const options = [
  { id: "o1", label: "Done", color: "#00854d" },
  { id: "o2", label: "Stuck", color: "#d83a52" },
];

describe("parsePercentInput", () => {
  it("clears on empty/whitespace", () => {
    expect(parsePercentInput("")).toEqual({ kind: "clear" });
    expect(parsePercentInput("   ")).toEqual({ kind: "clear" });
  });
  it("rejects non-numbers", () => {
    expect(parsePercentInput("abc")).toEqual({ kind: "invalid" });
  });
  it("clamps to 0..100", () => {
    expect(parsePercentInput("150")).toEqual({ kind: "commit", percent: 100 });
    expect(parsePercentInput("-3")).toEqual({ kind: "commit", percent: 0 });
  });
  it("passes valid values through", () => {
    expect(parsePercentInput("42")).toEqual({ kind: "commit", percent: 42 });
  });
});

describe("StatusOptionList", () => {
  it("renders a pill per option with aria-selected on the current one", () => {
    render(
      <StatusOptionList
        options={options}
        selected="o1"
        onSelect={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByRole("option", { name: "Done" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("option", { name: "Stuck" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });
  it("fires onSelect with the option id", () => {
    const onSelect = vi.fn();
    render(
      <StatusOptionList
        options={options}
        selected={null}
        onSelect={onSelect}
        onClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("option", { name: "Stuck" }));
    expect(onSelect).toHaveBeenCalledWith("o2");
  });
  it("fires onClear from the Clear affordance and keeps 44px coarse targets", () => {
    const onClear = vi.fn();
    render(
      <StatusOptionList
        options={options}
        selected={null}
        onSelect={vi.fn()}
        onClear={onClear}
      />,
    );
    const clear = screen.getByRole("button", { name: "Clear" });
    expect(clear.className).toContain("pointer-coarse:");
    fireEvent.click(clear);
    expect(onClear).toHaveBeenCalledOnce();
    expect(screen.getByRole("option", { name: "Done" }).className).toContain(
      "pointer-coarse:min-h-11",
    );
  });
});

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TimeCell } from "./TimeCell";

describe("TimeCell", () => {
  it("shows the formatted manual hours as the input value", () => {
    render(
      <TimeCell
        manualSecs={9000}
        timerSecs={0}
        onCommit={vi.fn()}
        onClear={vi.fn()}
        ariaLabel="cell"
      />,
    );
    expect(screen.getByLabelText("cell")).toHaveValue("2.5");
  });

  it("commits parsed hours on blur", () => {
    const onCommit = vi.fn();
    render(
      <TimeCell
        manualSecs={0}
        timerSecs={0}
        onCommit={onCommit}
        onClear={vi.fn()}
        ariaLabel="cell"
      />,
    );
    const input = screen.getByLabelText("cell");
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(3);
  });

  it("calls onClear when the value is emptied", () => {
    const onClear = vi.fn();
    render(
      <TimeCell
        manualSecs={3600}
        timerSecs={0}
        onCommit={vi.fn()}
        onClear={onClear}
        ariaLabel="cell"
      />,
    );
    const input = screen.getByLabelText("cell");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onClear).toHaveBeenCalled();
  });

  it("does not commit an invalid value", () => {
    const onCommit = vi.fn();
    render(
      <TimeCell
        manualSecs={0}
        timerSecs={0}
        onCommit={onCommit}
        onClear={vi.fn()}
        ariaLabel="cell"
      />,
    );
    const input = screen.getByLabelText("cell");
    fireEvent.change(input, { target: { value: "99" } });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("shows a tracked sub-label when timerSecs > 0", () => {
    render(
      <TimeCell
        manualSecs={0}
        timerSecs={5400}
        onCommit={vi.fn()}
        onClear={vi.fn()}
        ariaLabel="cell"
      />,
    );
    expect(screen.getByText(/tracked/i)).toBeInTheDocument();
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ColumnOptionsDialog } from "@/components/boards/ColumnOptionsDialog";
import type { CacheColumn } from "@/lib/boards/cache";

function statusCol(): CacheColumn {
  return {
    id: "c1",
    kind: "status",
    name: "Status",
    settings: { options: [{ id: "a", label: "Done", color: "#00c875" }] },
    position: 0,
  } as unknown as CacheColumn;
}

describe("ColumnOptionsDialog", () => {
  it("Add option then Save persists a new option labelled 'New label'", () => {
    const onSave = vi.fn();
    render(
      <ColumnOptionsDialog
        open
        column={statusCol()}
        usageOf={() => 0}
        onSave={onSave}
        onRemoveOption={vi.fn()}
        onOpenChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Add option"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const arg = onSave.mock.calls[0][0] as {
      options: { label: string }[];
    };
    expect(arg.options.some((o) => o.label === "New label")).toBe(true);
  });

  it("removing an option that is in use shows a confirm with the usage count", () => {
    render(
      <ColumnOptionsDialog
        open
        column={statusCol()}
        usageOf={() => 3}
        onSave={vi.fn()}
        onRemoveOption={vi.fn()}
        onOpenChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("remove Done"));
    expect(screen.getByText(/3 items use/i)).toBeInTheDocument();
  });

  it("removing a 0-usage option then Save drops it without an RPC", () => {
    const onSave = vi.fn();
    const onRemoveOption = vi.fn();
    render(
      <ColumnOptionsDialog
        open
        column={statusCol()}
        usageOf={() => 0}
        onSave={onSave}
        onRemoveOption={onRemoveOption}
        onOpenChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("remove Done"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onRemoveOption).not.toHaveBeenCalled();
    const arg = onSave.mock.calls[0][0] as {
      options: { id: string }[];
    };
    expect(arg.options.some((o) => o.id === "a")).toBe(false);
  });
});

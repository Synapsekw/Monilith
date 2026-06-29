import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ColumnOptionsDialog } from "@/components/boards/ColumnOptionsDialog";
import type { CacheColumn } from "@/lib/boards/cache";

// Spy on the shared touch-aware sensor hook (still delegating to the real
// implementation). Asserts the option-reorder DndContext consumes it.
const touchSensorsSpy = vi.fn();
vi.mock("@/lib/dnd/sensors", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/dnd/sensors")>(
      "@/lib/dnd/sensors",
    );
  return {
    useTouchAwareSensors: () => {
      touchSensorsSpy();
      return actual.useTouchAwareSensors();
    },
  };
});

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

  // ── TOUCH Batch-2 (iPad) ────────────────────────────────────────────────
  it("uses the shared touch-aware sensors for option reorder", () => {
    touchSensorsSpy.mockReset();
    render(
      <ColumnOptionsDialog
        open
        column={statusCol()}
        usageOf={() => 0}
        onSave={vi.fn()}
        onRemoveOption={vi.fn()}
        onOpenChange={vi.fn()}
      />,
    );
    expect(touchSensorsSpy).toHaveBeenCalled();
  });

  it("gives each OptionRow control a 44px coarse-pointer target", () => {
    render(
      <ColumnOptionsDialog
        open
        column={statusCol()}
        usageOf={() => 0}
        onSave={vi.fn()}
        onRemoveOption={vi.fn()}
        onOpenChange={vi.fn()}
      />,
    );
    const handle = screen.getByLabelText("Reorder Done");
    const swatch = screen.getByLabelText("Color for Done");
    const remove = screen.getByLabelText("remove Done");
    for (const el of [handle, swatch, remove]) {
      expect(el.className).toContain("pointer-coarse:size-11");
    }
  });
});

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KpiPicker } from "./KpiPicker";

describe("KpiPicker", () => {
  it("gives every card row a 44px hit target on a coarse pointer", () => {
    // The row (not just the checkbox glyph) carries the target, matching
    // `DropdownMenuCheckboxItem`'s `pointer-coarse:min-h-11 pointer-coarse:py-2.5`
    // convention (src/components/ui/dropdown-menu.tsx).
    const { container } = render(
      <KpiPicker cards={["complete", "overdue"]} onChange={vi.fn()} />,
    );
    const rows = container.querySelectorAll("li");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of Array.from(rows)) {
      expect(row.className).toContain("pointer-coarse:min-h-11");
      expect(row.className).toContain("pointer-coarse:py-2.5");
    }
  });
});

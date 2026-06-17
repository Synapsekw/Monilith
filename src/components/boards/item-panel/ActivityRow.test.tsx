import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActivityRow } from "@/components/boards/item-panel/ActivityRow";
import type { ActivityDescriptor } from "@/lib/collaboration/activity";

describe("ActivityRow", () => {
  it("renders a status from→to with both labels", () => {
    const d: ActivityDescriptor = {
      kind: "cell_changed",
      columnName: "Status",
      columnKind: "status",
      from: { label: "Working on it", color: "#fdab3d" },
      to: { label: "Done", color: "#00c875" },
    };
    render(
      <ActivityRow
        descriptor={d}
        actorName="Ada"
        when="2026-06-17T00:00:00Z"
      />,
    );
    expect(screen.getByText("Working on it")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText(/Status/)).toBeInTheDocument();
  });

  it("renders item_created", () => {
    render(
      <ActivityRow
        descriptor={{ kind: "item_created" }}
        actorName="Ada"
        when="2026-06-17T00:00:00Z"
      />,
    );
    expect(screen.getByText(/created/i)).toBeInTheDocument();
  });
});

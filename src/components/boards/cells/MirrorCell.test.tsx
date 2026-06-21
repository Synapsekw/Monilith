import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MirrorCell } from "./MirrorCell";

describe("MirrorCell", () => {
  it("renders each mirrored value via the target kind's renderer", () => {
    render(
      <MirrorCell
        values={[
          { linkedItemId: "b1", value: { text: "alpha" } },
          { linkedItemId: "b2", value: { text: "beta" } },
        ]}
        targetKind="text"
        targetSettings={{}}
      />,
    );
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
  });

  it("renders a status pill using the TARGET column's options", () => {
    render(
      <MirrorCell
        values={[{ linkedItemId: "b1", value: { optionId: "o1" } }]}
        targetKind="status"
        targetSettings={{
          options: [{ id: "o1", label: "Done", color: "#22c55e" }],
        }}
      />,
    );
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("omits absent (RLS-filtered) values and shows blank when all absent", () => {
    const { container } = render(
      <MirrorCell
        values={[{ linkedItemId: "b1", value: null }]}
        targetKind="text"
        targetSettings={{}}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("caps display with +K more", () => {
    render(
      <MirrorCell
        maxItems={1}
        values={[
          { linkedItemId: "b1", value: { text: "alpha" } },
          { linkedItemId: "b2", value: { text: "beta" } },
        ]}
        targetKind="text"
        targetSettings={{}}
      />,
    );
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText(/\+1 more/)).toBeInTheDocument();
  });

  it("shows a muted dash for a non-renderable target kind", () => {
    render(
      <MirrorCell
        values={[{ linkedItemId: "b1", value: {} }]}
        targetKind="files"
        targetSettings={{}}
      />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

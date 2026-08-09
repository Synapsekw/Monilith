import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FileTypeChip } from "@/components/boards/FileTypeChip";

describe("FileTypeChip", () => {
  it("renders the family label for a deck", () => {
    render(<FileTypeChip fileName="q3.pptx" mimeType="application/x" />);
    expect(screen.getByText("PPT")).toBeInTheDocument();
  });

  it("renders PDF for a pdf", () => {
    render(<FileTypeChip fileName="a.pdf" mimeType="application/pdf" />);
    expect(screen.getByText("PDF")).toBeInTheDocument();
  });

  it("uses monochrome tokens only — never a raw color class", () => {
    const { container } = render(
      <FileTypeChip fileName="a.xlsx" mimeType="application/x" />,
    );
    const cls = container.firstElementChild?.className ?? "";
    expect(cls).not.toMatch(/\b(bg|text|border)-(red|green|blue|orange)-/);
    expect(cls).toContain("font-mono");
  });
});

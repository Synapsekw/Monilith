import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FileTypeChip } from "@/components/boards/FileTypeChip";

function chipFor(fileName: string, mimeType = "application/octet-stream") {
  const { container } = render(
    <FileTypeChip fileName={fileName} mimeType={mimeType} />,
  );
  return container.firstElementChild as HTMLElement;
}

describe("FileTypeChip labels", () => {
  it("renders the family label for a deck", () => {
    render(<FileTypeChip fileName="q3.pptx" mimeType="application/x" />);
    expect(screen.getByText("PPT")).toBeInTheDocument();
  });

  it("renders PDF for a pdf", () => {
    render(<FileTypeChip fileName="a.pdf" mimeType="application/pdf" />);
    expect(screen.getByText("PDF")).toBeInTheDocument();
  });

  // No `title` here on purpose: every consumer already renders the filename
  // (the cell button's title, the card/row label), and a nested tooltip both
  // duplicates it and breaks title-based queries.
  it("does not set its own title", () => {
    expect(chipFor("quarterly-report.pdf")).not.toHaveAttribute("title");
  });
});

describe("FileTypeChip colours", () => {
  // The conventional per-format colours users already know from Finder /
  // Drive / Office. A deliberate exception to pulse-ui's monochrome-chrome
  // rule — see the component doc comment.
  it.each([
    ["report.pdf", "bg-file-pdf"],
    ["notes.docx", "bg-file-doc"],
    ["budget.xlsx", "bg-file-xls"],
    ["rows.csv", "bg-file-xls"],
    ["deck.pptx", "bg-file-ppt"],
    ["bundle.zip", "bg-file-zip"],
    ["clip.mp4", "bg-file-media"],
    ["thing.bin", "bg-file-generic"],
  ])("paints %s with %s", (name, expected) => {
    expect(chipFor(name).className).toContain(expected);
  });

  it("uses palette tokens, never a raw Tailwind colour", () => {
    expect(chipFor("a.pdf").className).not.toMatch(
      /\bbg-(red|green|blue|orange|amber)-\d/,
    );
  });

  it("never conveys type by colour alone — the label is always present", () => {
    // Colourblind / greyscale readers rely on this.
    for (const name of ["a.pdf", "a.docx", "a.xlsx", "a.pptx"]) {
      const chip = chipFor(name);
      expect(chip.textContent?.trim()).toBeTruthy();
    }
  });
});

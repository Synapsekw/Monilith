import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarkdownPreview } from "./MarkdownPreview";

describe("MarkdownPreview", () => {
  it("renders bold text in a <strong>", () => {
    const { container } = render(<MarkdownPreview markdown="**hi**" />);
    expect(container.querySelector("strong")?.textContent).toBe("hi");
  });

  it("renders italic text in an <em>", () => {
    const { container } = render(<MarkdownPreview markdown="*hi*" />);
    expect(container.querySelector("em")?.textContent).toBe("hi");
  });

  it("renders strikethrough in a <del>", () => {
    const { container } = render(<MarkdownPreview markdown="~~hi~~" />);
    expect(container.querySelector("del")?.textContent).toBe("hi");
  });

  it("renders an inline code span in a <code>", () => {
    const { container } = render(<MarkdownPreview markdown="`x`" />);
    expect(container.querySelector("code")?.textContent).toBe("x");
  });

  it("renders a bullet list as a <ul> with one <li> per item", () => {
    const { container } = render(<MarkdownPreview markdown={"- a\n- b"} />);
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
  });

  it("renders a numbered list as an <ol>", () => {
    const { container } = render(<MarkdownPreview markdown={"1. a\n2. b"} />);
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
  });

  it("renders a heading at the right level", () => {
    render(<MarkdownPreview markdown="## Title" />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "Title",
    );
  });

  it("renders a quote as a <blockquote>", () => {
    const { container } = render(<MarkdownPreview markdown="> q" />);
    expect(container.querySelector("blockquote")?.textContent).toBe("q");
  });

  it("renders a safe link with noopener and a blank target", () => {
    render(<MarkdownPreview markdown="[x](https://example.com)" />);
    const a = screen.getByRole("link", { name: "x" });
    expect(a).toHaveAttribute("href", "https://example.com");
    expect(a).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(a).toHaveAttribute("target", "_blank");
  });

  it("does not render an anchor for a javascript: url", () => {
    render(<MarkdownPreview markdown="[x](javascript:alert(1))" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText(/javascript:alert\(1\)/)).toBeInTheDocument();
  });

  it("shows an empty-state line for empty markdown", () => {
    render(<MarkdownPreview markdown="" />);
    expect(screen.getByText(/nothing to preview/i)).toBeInTheDocument();
  });

  it("shows an empty-state line for whitespace-only markdown", () => {
    render(<MarkdownPreview markdown="   " />);
    expect(screen.getByText(/nothing to preview/i)).toBeInTheDocument();
  });

  it("preserves paragraph order", () => {
    const { container } = render(
      <MarkdownPreview markdown={"first\n\nsecond"} />,
    );
    expect(container.textContent).toBe("firstsecond");
  });

  it("does not wrap a text leaf in an extra element — its parent is the mark itself", () => {
    render(<MarkdownPreview markdown="**bold**" />);
    expect(screen.getByText("bold").tagName).toBe("STRONG");
  });
});

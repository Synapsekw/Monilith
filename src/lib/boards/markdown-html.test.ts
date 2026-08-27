import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./markdown";
import { renderBlocksToHtml } from "./markdown-html";

/** The real parser, so these tests pin the PAIR — a node kind the parser can
 *  emit that the renderer drops would pass a hand-built-AST test. */
const html = (md: string) => renderBlocksToHtml(parseMarkdown(md));

describe("renderBlocksToHtml", () => {
  it("renders every block kind", () => {
    expect(html("# Title")).toBe("<h1>Title</h1>");
    expect(html("## Sub")).toBe("<h2>Sub</h2>");
    expect(html("### Minor")).toBe("<h3>Minor</h3>");
    expect(html("plain words")).toBe("<p>plain words</p>");
    expect(html("> quoted")).toBe("<blockquote>quoted</blockquote>");
    expect(html("- a\n- b")).toBe("<ul><li>a</li><li>b</li></ul>");
    expect(html("1. a\n2. b")).toBe("<ol><li>a</li><li>b</li></ol>");
  });

  it("renders every inline kind, nested", () => {
    expect(html("**bold *inner* end**")).toBe(
      "<p><strong>bold <em>inner</em> end</strong></p>",
    );
    expect(html("~~gone~~")).toBe("<p><del>gone</del></p>");
    expect(html("`code`")).toBe("<p><code>code</code></p>");
    expect(html("[label](https://example.com/x)")).toBe(
      '<p><a href="https://example.com/x">label</a></p>',
    );
  });

  it("escapes markup in text so authored HTML can never execute", () => {
    expect(html("<script>alert(1)</script>")).toBe(
      "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
    );
    expect(html('<img src=x onerror="alert(1)">')).not.toContain("<img");
    expect(html("a & b")).toBe("<p>a &amp; b</p>");
    expect(html('say "hi"')).toBe("<p>say &quot;hi&quot;</p>");
  });

  it("escapes inside code spans too", () => {
    expect(html("`<b>&</b>`")).toBe(
      "<p><code>&lt;b&gt;&amp;&lt;/b&gt;</code></p>",
    );
  });

  // parseMarkdown downgrades an unsafe scheme to literal text (markdown.ts:470)
  // before the renderer sees it. This pins that the PAIR holds the property.
  it("never emits a javascript: or data: href", () => {
    const js = html("[x](javascript:alert(1))");
    expect(js).not.toContain("<a");
    expect(js).toContain("javascript:alert(1)");
    expect(html("[x](data:text/html;base64,PHNjcmlwdD4=)")).not.toContain("<a");
  });

  it("escapes a quote injected into an http href", () => {
    const out = html('[x](https://e.com/?a="onmouseover="alert(1))');
    expect(out).not.toContain('onmouseover="');
    expect(out).toContain("&quot;");
  });

  it("returns an empty string for no blocks", () => {
    expect(renderBlocksToHtml([])).toBe("");
  });
});

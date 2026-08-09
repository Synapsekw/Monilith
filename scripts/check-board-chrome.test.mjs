import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  extractChrome,
  chromeHash,
  verifyChrome,
} from "./check-board-chrome.mjs";

/** Minimal stand-in with the same data/design split as vault/board.html. */
function board({ data = '{"schema": 2}', css = "body { color: red; }" } = {}) {
  return [
    "<title>Monolith — Mission Control</title>",
    '<script type="application/json" id="board-data">',
    data,
    "</script>",
    `<style>${css}</style>`,
    '<div class="wrap" id="app"></div>',
  ].join("\n");
}

describe("extractChrome", () => {
  it("blanks the island body and keeps every byte of design", () => {
    const chrome = extractChrome(board());
    assert.ok(chrome.includes("{{BOARD_DATA}}"));
    assert.ok(!chrome.includes('"schema": 2'));
    assert.ok(chrome.includes("body { color: red; }"));
    assert.ok(chrome.includes('<div class="wrap" id="app"></div>'));
  });

  it("throws when the island is gone — a broken split, not a drift", () => {
    assert.throws(
      () => extractChrome("<title>no island here</title>"),
      /no <script type="application\/json" id="board-data"> island found/,
    );
  });
});

describe("chromeHash", () => {
  it("is stable across a full data rewrite", () => {
    const before = chromeHash(board({ data: '{"schema": 2, "next": []}' }));
    const after = chromeHash(
      board({ data: '{"schema": 2, "next": [{"title": "ship it"}]}' }),
    );
    assert.equal(before, after);
  });

  it("changes when the CSS changes", () => {
    assert.notEqual(
      chromeHash(board({ css: "body { color: red; }" })),
      chromeHash(board({ css: "body { color: blue; }" })),
    );
  });

  it("changes when markup is added outside the island", () => {
    assert.notEqual(
      chromeHash(board()),
      chromeHash(board() + "\n<footer>extra</footer>"),
    );
  });
});

describe("verifyChrome", () => {
  it("passes a data-only refresh against its baseline", () => {
    const baseline = chromeHash(board({ data: "{}" }));
    const result = verifyChrome({
      html: board({ data: '{"schema": 2, "risks": []}' }),
      baseline,
    });
    assert.equal(result.ok, true);
    assert.equal(result.reason, undefined);
  });

  it("fails a design edit that rides along with a data edit", () => {
    const baseline = chromeHash(board({ data: "{}" }));
    const result = verifyChrome({
      html: board({ data: '{"schema": 2}', css: "body { color: blue; }" }),
      baseline,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "drift");
  });

  it("tolerates a trailing newline in the recorded baseline", () => {
    const baseline = chromeHash(board()) + "\n";
    assert.equal(verifyChrome({ html: board(), baseline }).ok, true);
  });

  it("reports a missing baseline distinctly from drift", () => {
    const result = verifyChrome({ html: board(), baseline: null });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "missing-baseline");
  });
});

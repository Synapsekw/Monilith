import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  shouldDraftSession,
  buildDraftFilename,
  needsNorthStarBumpWarning,
} from "./maybe-write-session.mjs";

describe("shouldDraftSession", () => {
  it("returns true when changed files >= 10", () => {
    assert.equal(shouldDraftSession({ changedFiles: 10, toolCalls: 0 }), true);
    assert.equal(shouldDraftSession({ changedFiles: 25, toolCalls: 0 }), true);
  });

  it("returns true when tool calls >= 20", () => {
    assert.equal(shouldDraftSession({ changedFiles: 0, toolCalls: 20 }), true);
    assert.equal(shouldDraftSession({ changedFiles: 1, toolCalls: 50 }), true);
  });

  it("returns false when both below threshold", () => {
    assert.equal(shouldDraftSession({ changedFiles: 0, toolCalls: 0 }), false);
    assert.equal(shouldDraftSession({ changedFiles: 9, toolCalls: 19 }), false);
  });
});

describe("buildDraftFilename", () => {
  it("uses YYYY-MM-DD-HHmm timestamp", () => {
    const now = new Date("2026-05-26T14:30:00Z");
    assert.equal(
      buildDraftFilename(now),
      "vault/sessions/_draft-2026-05-26-1430.md",
    );
  });

  it("pads single-digit values", () => {
    const now = new Date("2026-01-05T09:05:00Z");
    assert.equal(
      buildDraftFilename(now),
      "vault/sessions/_draft-2026-01-05-0905.md",
    );
  });
});

describe("needsNorthStarBumpWarning", () => {
  it("warns when CHANGELOG changed but north-star did not", () => {
    assert.equal(needsNorthStarBumpWarning(["CHANGELOG.md"]), true);
  });

  it("warns when a design spec changed but north-star did not", () => {
    assert.equal(
      needsNorthStarBumpWarning([
        "docs/superpowers/specs/2026-06-14-pulse-design.md",
      ]),
      true,
    );
  });

  it("warns when the platform-roadmap MOC changed but north-star did not", () => {
    assert.equal(
      needsNorthStarBumpWarning(["vault/moc/platform-roadmap.md"]),
      true,
    );
  });

  it("does NOT warn when north-star is also in the changed list", () => {
    assert.equal(
      needsNorthStarBumpWarning(["CHANGELOG.md", "vault/00-north-star.md"]),
      false,
    );
  });

  it("does NOT warn when changes are unrelated", () => {
    assert.equal(needsNorthStarBumpWarning(["src/components/x.tsx"]), false);
  });

  it("does NOT warn on empty list", () => {
    assert.equal(needsNorthStarBumpWarning([]), false);
  });
});

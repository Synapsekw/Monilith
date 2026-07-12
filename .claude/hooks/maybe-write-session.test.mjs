import { describe, it, afterAll } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  shouldDraftSession,
  buildDraftFilename,
  needsNorthStarBumpWarning,
  countToolCallsFromTranscript,
  filterRelevantPaths,
  isLinkedWorktreeGitDir,
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

describe("countToolCallsFromTranscript", () => {
  const dir = mkdtempSync(join(tmpdir(), "stop-hook-test-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function writeTranscript(name, lines) {
    const path = join(dir, name);
    writeFileSync(path, lines.join("\n") + "\n", "utf8");
    return path;
  }

  it("counts tool_use blocks in assistant messages only", () => {
    const path = writeTranscript("basic.jsonl", [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "hi" },
            { type: "tool_use", name: "Bash" },
            { type: "tool_use", name: "Read" },
          ],
        },
      }),
      // user message quoting "tool_use" must not count
      JSON.stringify({
        type: "user",
        message: { content: [{ type: "tool_use", name: "spoof" }] },
      }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Edit" }] },
      }),
    ]);
    assert.equal(countToolCallsFromTranscript(path), 3);
  });

  it("tolerates malformed lines and non-array content", () => {
    const path = writeTranscript("malformed.jsonl", [
      "{not json",
      JSON.stringify({ type: "assistant", message: { content: "plain" } }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use" }] },
      }),
    ]);
    assert.equal(countToolCallsFromTranscript(path), 1);
  });

  it("returns 0 for missing path or unreadable file", () => {
    assert.equal(countToolCallsFromTranscript(undefined), 0);
    assert.equal(countToolCallsFromTranscript(""), 0);
    assert.equal(
      countToolCallsFromTranscript(join(dir, "does-not-exist.jsonl")),
      0,
    );
  });
});

describe("filterRelevantPaths", () => {
  it("drops .obsidian/* and vault/sessions/_draft-*.md", () => {
    assert.deepEqual(
      filterRelevantPaths([
        ".obsidian/workspace.json",
        ".obsidian/app.json",
        "vault/sessions/_draft-2026-07-12-0900.md",
        "src/app/page.tsx",
        "vault/sessions/2026-07-11-real-note.md",
      ]),
      ["src/app/page.tsx", "vault/sessions/2026-07-11-real-note.md"],
    );
  });

  it("does not drop lookalikes outside those directories", () => {
    assert.deepEqual(
      filterRelevantPaths(["docs/.obsidian/x.json", "vault/_draft-other.md"]),
      ["docs/.obsidian/x.json", "vault/_draft-other.md"],
    );
  });

  it("returns empty for empty input", () => {
    assert.deepEqual(filterRelevantPaths([]), []);
  });
});

describe("isLinkedWorktreeGitDir", () => {
  it("detects a linked worktree git-dir", () => {
    assert.equal(
      isLinkedWorktreeGitDir(
        "/Users/x/Dev/Monolith/.git/worktrees/process-hardening-2",
      ),
      true,
    );
  });

  it("does not flag the main checkout", () => {
    assert.equal(isLinkedWorktreeGitDir(".git"), false);
    assert.equal(isLinkedWorktreeGitDir("/Users/x/Dev/Monolith/.git"), false);
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

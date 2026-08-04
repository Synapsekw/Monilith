import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// finish-task.sh clears stop-hook session drafts before its clean-tree check.
// It did that with a naked `rm -f vault/sessions/_draft-*.md`, which also
// deleted a *committed* draft — dirtying the tree and failing the very check it
// runs before, for every session in the repo (one was committed in 023b4676).
// A tracked file is real content: only UNTRACKED drafts are generated noise.

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "clear-untracked-drafts.sh",
);

let repo;

function git(...args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
}

function draft(name, body = "draft\n") {
  writeFileSync(join(repo, "vault", "sessions", name), body);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "pulse-drafts-"));
  mkdirSync(join(repo, "vault", "sessions"), { recursive: true });
  git("init", "-q");
  git("config", "user.email", "info@synapse-solutions.ai");
  git("config", "user.name", "Danijel Jovanovic");
  writeFileSync(join(repo, "README.md"), "seed\n");
  git("add", "README.md");
  git("commit", "-qm", "seed");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

const exists = (name) => existsSync(join(repo, "vault", "sessions", name));

describe("clear-untracked-drafts.sh", () => {
  it("removes an untracked draft", () => {
    draft("_draft-2026-08-04-1007.md");
    execFileSync(SCRIPT, [repo]);
    assert.equal(exists("_draft-2026-08-04-1007.md"), false);
  });

  it("leaves a COMMITTED draft alone and the tree clean", () => {
    draft("_draft-2026-08-03-1007.md");
    git("add", "vault/sessions/_draft-2026-08-03-1007.md");
    git("commit", "-qm", "committed draft");

    execFileSync(SCRIPT, [repo]);

    assert.equal(
      exists("_draft-2026-08-03-1007.md"),
      true,
      "a tracked draft is real content — removing it breaks the clean-tree check",
    );
    assert.equal(git("status", "--porcelain").trim(), "");
  });

  it("removes only the untracked draft when both kinds are present", () => {
    draft("_draft-tracked.md");
    git("add", "vault/sessions/_draft-tracked.md");
    git("commit", "-qm", "committed draft");
    draft("_draft-untracked.md");

    execFileSync(SCRIPT, [repo]);

    assert.equal(exists("_draft-tracked.md"), true);
    assert.equal(exists("_draft-untracked.md"), false);
    assert.equal(git("status", "--porcelain").trim(), "");
  });

  it("never touches a real session note", () => {
    writeFileSync(
      join(repo, "vault", "sessions", "2026-08-04-1907-real.md"),
      "x",
    );
    execFileSync(SCRIPT, [repo]);
    assert.equal(exists("2026-08-04-1907-real.md"), true);
  });

  it("is a no-op with no drafts at all", () => {
    execFileSync(SCRIPT, [repo]);
    assert.equal(git("status", "--porcelain").trim(), "");
  });
});

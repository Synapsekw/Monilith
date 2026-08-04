import { describe, it, afterEach } from "vitest";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// finish-task.sh could exit 0 while vitest workers from `pnpm test` were still
// alive and still pointed at the LIVE dev project. Empirically (macOS, pnpm 10,
// vitest 4) the runner AND every worker carry the worktree's absolute
// node_modules path in their argv, so a sweep keyed on that path is scoped to
// exactly the processes this worktree started — never a sibling worktree's run,
// never the main checkout's.

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "sweep-orphaned-vitest.sh",
);

const SLEEPER = "setTimeout(() => {}, 60_000);\n";

let root;
const spawned = [];

function stub(relPath) {
  const file = join(root, relPath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, SLEEPER);
  const child = spawn(process.execPath, [file], { stdio: "ignore" });
  spawned.push(child);
  return child;
}

const alive = (child) => {
  try {
    process.kill(child.pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Give the OS a moment to reap the signalled processes. */
const settle = () => new Promise((r) => setTimeout(r, 400));

afterEach(() => {
  for (const c of spawned.splice(0)) {
    try {
      process.kill(c.pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("sweep-orphaned-vitest.sh", () => {
  it("kills a surviving vitest process belonging to the given worktree", async () => {
    root = mkdtempSync(join(tmpdir(), "pulse-wt-"));
    const orphan = stub("node_modules/.pnpm/vitest@4.1.8/worker.mjs");

    execFileSync(SCRIPT, [root]);
    await settle();

    assert.equal(alive(orphan), false, "the orphan must not survive the sweep");
  });

  it("leaves another worktree's vitest process running", async () => {
    root = mkdtempSync(join(tmpdir(), "pulse-wt-"));
    const sibling = mkdtempSync(join(tmpdir(), "pulse-other-"));
    const mine = stub("node_modules/.pnpm/vitest@4.1.8/worker.mjs");

    const siblingFile = join(sibling, "node_modules", "vitest", "worker.mjs");
    mkdirSync(dirname(siblingFile), { recursive: true });
    writeFileSync(siblingFile, SLEEPER);
    const theirs = spawn(process.execPath, [siblingFile], { stdio: "ignore" });
    spawned.push(theirs);

    execFileSync(SCRIPT, [root]);
    await settle();

    assert.equal(alive(mine), false, "my worktree's orphan should be swept");
    assert.equal(
      alive(theirs),
      true,
      "a sibling worktree's run must be left alone — the sweep is path-scoped",
    );

    rmSync(sibling, { recursive: true, force: true });
  });

  it("leaves a non-vitest process in the same worktree alone", async () => {
    root = mkdtempSync(join(tmpdir(), "pulse-wt-"));
    const unrelated = stub("node_modules/.bin/next-dev-server.mjs");

    execFileSync(SCRIPT, [root]);
    await settle();

    assert.equal(alive(unrelated), true);
  });

  it("exits 0 and prints nothing when there is no orphan", () => {
    root = mkdtempSync(join(tmpdir(), "pulse-wt-"));
    assert.equal(execFileSync(SCRIPT, [root], { encoding: "utf8" }), "");
  });

  it("names the pids it killed, so a silent kill can't hide", async () => {
    root = mkdtempSync(join(tmpdir(), "pulse-wt-"));
    const orphan = stub("node_modules/.pnpm/vitest@4.1.8/worker.mjs");

    const out = execFileSync(SCRIPT, [root], { encoding: "utf8" });
    await settle();

    assert.match(out, /orphaned vitest/i);
    assert.ok(
      out.includes(String(orphan.pid)),
      `expected the pid ${orphan.pid} in: ${out}`,
    );
  });
});

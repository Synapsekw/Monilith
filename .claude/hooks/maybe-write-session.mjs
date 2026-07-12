#!/usr/bin/env node
// Stop hook: on substantial sessions, drop a `_draft-*.md` stub in vault/sessions/
// so work isn't lost before /wrapup runs, and warn when a phase/spec doc changed
// but the north-star wasn't bumped. Pure functions are exported for unit testing.
//
// Design decisions (2026-07-12 transcript-audit fixes):
//   - Activity signal: the Stop-hook stdin payload carries `session_id`,
//     `transcript_path`, `stop_hook_active` — there is NO `tool_calls` field
//     (the old code read one and always got 0, making the threshold branch
//     dead). We derive real activity from `transcript_path`: parse the JSONL
//     line-by-line and count `tool_use` blocks in assistant messages. This was
//     chosen over deleting the branch because file-count alone misses
//     substantial read/debug sessions; the parse is ~15 lines, tolerant of
//     malformed lines, and returns 0 on any failure (fails toward "quiet").
//   - Changed-file count excludes `.obsidian/*` (workspace churn from having
//     the vault open) and `vault/sessions/_draft-*` (this hook's own output —
//     counting it made every later stop look "substantial").
//   - User-visible output goes to stdout as `{"systemMessage": ...}` JSON —
//     Stop-hook stderr with exit 0 is invisible, so the old north-star
//     staleness warning never reached anyone.
//   - No drafts inside task worktrees: a linked-worktree session ends via
//     finish-task + the orchestrator's /wrapup, and a stray draft in the
//     worktree tree used to block finish-task (now auto-removed there, but
//     not creating it is cleaner). Detected via `git rev-parse --git-dir`,
//     which is `<main>/.git/worktrees/<name>` for linked worktrees.
import { execSync } from "node:child_process";
import {
  writeFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";

const FILE_THRESHOLD = 10;
const TOOL_CALL_THRESHOLD = 20;
const RECENT_DRAFT_WINDOW_MS = 2 * 60 * 60 * 1000;
const SESSIONS_DIR = "vault/sessions";

export function shouldDraftSession({ changedFiles, toolCalls }) {
  return changedFiles >= FILE_THRESHOLD || toolCalls >= TOOL_CALL_THRESHOLD;
}

// Count tool_use blocks in assistant messages by streaming the session
// transcript JSONL. Any unreadable file or malformed line counts as 0 —
// the hook must never throw on a missing/odd transcript.
export function countToolCallsFromTranscript(transcriptPath) {
  if (!transcriptPath) return 0;
  let raw;
  try {
    raw = readFileSync(transcriptPath, "utf8");
  } catch {
    return 0;
  }
  let count = 0;
  for (const line of raw.split("\n")) {
    if (!line || !line.includes('"tool_use"')) continue; // cheap pre-filter
    try {
      const event = JSON.parse(line);
      if (event?.type !== "assistant") continue;
      const content = event?.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block?.type === "tool_use") count += 1;
      }
    } catch {
      // malformed line — skip
    }
  }
  return count;
}

// Paths that don't indicate real session work: Obsidian workspace churn and
// this hook's own previously-written draft stubs.
const IGNORED_PATH_RE = [
  /^\.obsidian\//,
  /^vault\/sessions\/_draft-[^/]*\.md$/,
];

export function filterRelevantPaths(paths) {
  return paths.filter((p) => {
    const normalized = p.replace(/\\/g, "/");
    return !IGNORED_PATH_RE.some((re) => re.test(normalized));
  });
}

// A linked worktree's git-dir lives under the main repo's .git/worktrees/.
export function isLinkedWorktreeGitDir(gitDir) {
  return /(^|\/)\.git\/worktrees\//.test(gitDir.replace(/\\/g, "/"));
}

function isInsideLinkedWorktree() {
  try {
    const gitDir = execSync("git rev-parse --git-dir", {
      encoding: "utf8",
    }).trim();
    return isLinkedWorktreeGitDir(gitDir);
  } catch {
    return false;
  }
}

export function hasRecentDraft(dir = SESSIONS_DIR, now = Date.now()) {
  if (!existsSync(dir)) return false;
  try {
    const entries = readdirSync(dir).filter(
      (f) => f.startsWith("_draft-") && f.endsWith(".md"),
    );
    for (const name of entries) {
      const mtime = statSync(join(dir, name)).mtimeMs;
      if (now - mtime < RECENT_DRAFT_WINDOW_MS) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

export function buildDraftFilename(date) {
  const y = date.getUTCFullYear();
  const mo = pad(date.getUTCMonth() + 1);
  const d = pad(date.getUTCDate());
  const h = pad(date.getUTCHours());
  const mi = pad(date.getUTCMinutes());
  return `vault/sessions/_draft-${y}-${mo}-${d}-${h}${mi}.md`;
}

const NORTH_STAR_PATH = "vault/00-north-star.md";
// A change to any of these is a strong signal a build phase moved and the
// north-star §2/§3 + last-updated should be bumped.
const BUMP_TRIGGERS = [
  /^CHANGELOG\.md$/,
  /^docs\/superpowers\/specs\//,
  /^vault\/moc\/platform-roadmap\.md$/,
];

export function needsNorthStarBumpWarning(changedPaths) {
  const normalized = changedPaths.map((p) => p.replace(/\\/g, "/"));
  const triggered = normalized.some((p) =>
    BUMP_TRIGGERS.some((re) => re.test(p)),
  );
  if (!triggered) return false;
  return !normalized.includes(NORTH_STAR_PATH);
}

function listChangedPaths() {
  try {
    const out = execSync("git status --porcelain", { encoding: "utf8" });
    return out
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(3));
  } catch {
    return [];
  }
}

function getBranch() {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

function getDiffStat() {
  try {
    return execSync("git diff --stat HEAD~5..HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"], // <5 commits of history is fine — don't leak git's stderr
    });
  } catch {
    return "(no diff available)";
  }
}

function readStdin() {
  try {
    const data = readFileSync(0, "utf8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

// Emit collected user-visible messages the only way a Stop hook can:
// stdout JSON with `systemMessage`. Then exit 0 (never block the stop).
function finish(messages) {
  if (messages.length > 0) {
    // writeFileSync(1, …) not console.log: process.exit() can drop unflushed
    // async stdout when it's a pipe (which it is, under the hook runner).
    writeFileSync(
      1,
      JSON.stringify({ systemMessage: messages.join("\n") }) + "\n",
    );
  }
  exit(0);
}

function main() {
  const payload = readStdin();
  const toolCalls = countToolCallsFromTranscript(payload?.transcript_path);
  const changedPaths = filterRelevantPaths(listChangedPaths());
  const changedFiles = changedPaths.length;
  const messages = [];

  if (needsNorthStarBumpWarning(changedPaths)) {
    messages.push(
      "[wrapup-hook] Reminder: CHANGELOG.md or a spec/roadmap doc changed, " +
        "but vault/00-north-star.md was not bumped. Consider updating it (or run /wrapup).",
    );
  }

  if (!shouldDraftSession({ changedFiles, toolCalls })) {
    finish(messages);
  }

  // Worktree sessions close via finish-task + orchestrator /wrapup; a draft
  // written inside the worktree tree is noise (and used to block finish-task).
  if (isInsideLinkedWorktree()) {
    finish(messages);
  }

  if (hasRecentDraft()) {
    finish(messages);
  }

  const now = new Date();
  const path = buildDraftFilename(now);

  if (existsSync(path)) finish(messages);

  mkdirSync(dirname(path), { recursive: true });

  const tsMatch = path.match(/_draft-(.+)\.md$/);
  const tsLabel = tsMatch ? tsMatch[1] : "unknown";
  const body = `---
type: session
date: ${tsLabel}
branch: ${getBranch()}
trigger: auto
status: draft
tags: [session, draft]
related: []
---

# DRAFT — auto-generated session stub

> **Stop hook fired** with ${changedFiles} changed file(s) and ${toolCalls} tool call(s).
> **Next session: either flesh this out via \`/wrapup\` or delete this file.**

## Git state at stop

\`\`\`
${getDiffStat().trim()}
\`\`\`

## What changed
- (fill in)

## Why
- (fill in)

## Open threads
- (fill in)

## Next session entry point
- (fill in)
`;

  writeFileSync(path, body, "utf8");
  messages.push(
    `[wrapup-hook] Substantial session (${changedFiles} changed file(s), ${toolCalls} tool call(s)) ` +
      `— wrote draft stub ${path}. Flesh it out via /wrapup or delete it.`,
  );
  finish(messages);
}

const isMain = (() => {
  try {
    return fileURLToPath(import.meta.url) === argv[1];
  } catch {
    return false;
  }
})();

if (isMain) main();

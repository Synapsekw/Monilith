#!/usr/bin/env node
// Stop hook: on substantial sessions, drop a `_draft-*.md` stub in vault/sessions/
// so work isn't lost before /wrapup runs, and warn when a phase/spec doc changed
// but the north-star wasn't bumped. Pure functions are exported for unit testing.
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
    return execSync("git diff --stat HEAD~5..HEAD", { encoding: "utf8" });
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

function main() {
  const payload = readStdin();
  const toolCalls = Array.isArray(payload?.tool_calls)
    ? payload.tool_calls.length
    : 0;
  const changedPaths = listChangedPaths();
  const changedFiles = changedPaths.length;

  if (needsNorthStarBumpWarning(changedPaths)) {
    console.error(
      "[wrapup-hook] ⚠️  Reminder: CHANGELOG.md or a spec/roadmap doc changed,\n" +
        "             but vault/00-north-star.md was not bumped. Consider updating last-updated.",
    );
  }

  if (!shouldDraftSession({ changedFiles, toolCalls })) {
    exit(0);
  }

  if (hasRecentDraft()) {
    console.error(
      "[wrapup-hook] recent draft exists within 2h window — skipping new draft",
    );
    exit(0);
  }

  const now = new Date();
  const path = buildDraftFilename(now);

  if (existsSync(path)) exit(0);

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
  console.error(`[wrapup-hook] wrote draft: ${path}`);
  exit(0);
}

const isMain = (() => {
  try {
    return fileURLToPath(import.meta.url) === argv[1];
  } catch {
    return false;
  }
})();

if (isMain) main();

---
type: session
date: 2026-07-12-0938
branch: develop
trigger: wrapup
status: complete
tags: [session]
related: ["[[2026-07-11-2116-ai-e1-hybrid-gateway-ask-pulse]]"]
---

# Claude-usage audit + process hardening (items 1–5)

## What changed

- **Three-agent audit** of how we build with Claude Code: mined all 160 transcripts (~316MB),
  audited the process machinery (commands/skills/hooks/scripts/61 ADRs), and reviewed the codebase
  (grade A−; full findings in the chat report). Top signals: pulse-ui skill stale post-Keystone,
  CONTRIBUTING contradicted AGENTS.md, migration-ledger pain ×4 ADRs unautomated, /wrapup
  edit-before-read failures (119 errors), /promote CI-watch improvisation.
- Shipped audit items 1–5 via `task/process-hardening` (merged `6547ee5`):
  - `.claude/skills/pulse-ui/SKILL.md` rewritten for Keystone, verified token-by-token against
    `globals.css` (rows are 36px, dark glow is white — code won over the decision record).
  - `CONTRIBUTING.md` branching section now defers to AGENTS.md #1 (worktree/task-branch model).
  - New `scripts/new-migration.sh` (real UTC stamp + cross-worktree collision checks) and
    `scripts/reconcile-migration-version.sh` (prints the ledger-repair SQL from
    [[2026-07-11-gotcha-55-mcp-apply-migration-version-drifts-from-committed-file]]).
  - `scripts/finish-task.sh` hardened: draft auto-remove, machine-wide gate lock (gotcha-54),
    install-after-rebase (gotcha-39), `.next/types` purge (cacheLife trap), dup-migration gate
    (gotcha-43), author-email assert (Vercel silent-skip).
  - New `scripts/wrapup-context.sh` + `scripts/watch-ci.sh`; `/wrapup` and `/promote` rewired to
    use them (read-before-edit rule added to /wrapup).
- North-star §1 accent wording fixed (indigo → Keystone periwinkle).

## Why

The audit showed our biggest inefficiencies are self-inflicted process drift, not code quality:
rules living in prose get re-derived or contradicted, and recorded gotchas without tooling recur.
These five items encode the loudest recurring pains into scripts and fix the two actively-wrong
instruction sources.

## How to test (for the user)

1. Pull `develop`. Run `scripts/wrapup-context.sh` from the repo root — expect one labeled dump
   (date, branch, status, north-star §3, drafts, recent notes).
2. Run `scripts/watch-ci.sh branch develop --max-seconds 60 --interval 10` — expect it to find the
   latest CI run and exit 0 (green) with the run URL.
3. Run `scripts/new-migration.sh test_probe` — expect a new stamped file under
   `supabase/migrations/` with apply/types next-steps printed; delete the file after.
4. Open `.claude/skills/pulse-ui/SKILL.md` — tokens should match `src/app/globals.css`
   (periwinkle, radius 0.875rem, Nunito Sans/JetBrains Mono).
5. The finish-task hardening was verified live: this very branch merged through the hardened
   script (lock → rebase → install → gates → author assert → merge).

## Open threads

- Audit items 6–10 not yet built: SessionStart context hook; allowlist promotion into project
  `settings.json` (+ prune settings.local debris); Stop-hook dead `tool_calls` logic +
  `.obsidian` noise in its file count; `ActionResult`/typed-RPC canonical modules;
  gardening (split `BoardTable.tsx`/`use-board-mutations.ts`, retire `lib/ai/anthropic.ts`,
  ESLint `max-lines`); nightly integration-suite CI. Also: duplicate gotcha numbers (10, 43),
  `/whats-next` emoji contradiction + stale §3 field names, dead `/develop`+`/goal` commands.
- MCP `apply_migration` may still self-stamp versions — new-migration.sh prints the verify query
  and the reconcile fallback rather than promising the name pin holds.

## Next session entry point

Either promote `develop → main` (E1 + this batch are unpromoted) or continue audit items 6–10 —
the SessionStart hook + settings.json allowlist are the highest-leverage quick wins.

---
type: session
date: 2026-07-12-1759
branch: develop
trigger: wrapup
status: complete
tags: [session]
related: ["[[2026-07-12-0938-usage-audit-process-hardening]]"]
---

# Claude-usage audit items 6–10: harness, canonical modules, gardening

## What changed

- Shipped audit items 6–10 via `task/process-hardening-2` (17 commits, merged `b1d27c4`), two
  parallel batches + focused review:
  - **SessionStart hook** (`.claude/hooks/session-context.sh`): branch/status/worktrees/north-star
    §3 auto-injected each session (replaces ~5 boot calls + north-star read).
  - **Stop hook rewritten**: real activity signal from the transcript (dead `tool_calls` branch
    removed), `.obsidian`/draft noise excluded, `systemMessage` output, no drafts in worktrees,
    cwd pinned to project dir; 20 tests now run under `pnpm test`.
  - **Allowlists**: workflow commands promoted into tracked `.claude/settings.json`
    (user-approved); `settings.local.json` pruned 178 → 41 entries, MCP names fixed.
  - **Canonical modules**: `src/lib/actions/result.ts` (31 files migrated, 5 divergent shapes
    reconciled) + `src/lib/supabase/typed-rpc.ts` (all 30 RPC casts eliminated); legacy
    `lib/ai/anthropic.ts` retired; orphaned drag-handle deleted; `shadcn` → devDeps.
  - **Docs de-dup**: `/develop` 156→102 lines (points at AGENTS.md), `/whats-next` emoji
    contradiction + stale §3 field names fixed, AGENTS.md gains migration-minting +
    canonical-modules invariants, [[00-gotcha-index]] disambiguates duplicate gotcha 10/43.
  - **Gardening**: `BoardTable.tsx` 2,802 → 9-line entry + 20 modules under
    `boards/table/` (byte-identical slicing); `use-board-mutations.ts` 1,420 → 221-line facade +
    10 domain modules (API proven identical key-by-key). Both off the new ESLint `max-lines`
    (warn 800) list.
  - **CI**: nightly integration workflow (skips green until secrets exist; refuses DEV/PROD URLs)
    - author-email guard on develop pushes.
- Review pass found 2 should-fixes, applied pre-merge: `typed-rpc` Json conditional
  (`[Json] extends [A[K] | null]` — the `NonNullable` form never fired), oversized-transcript
  short-circuit in the Stop hook (fails toward "draft"), plus cwd/stderr/lock nits.

## Why

Completes the transcript-audit remediation: encode recurring pains into tooling, make rules
importable instead of prose, and give god-files a gate that pushes back.

## How to test (for the user)

1. Pull `develop`, start a NEW Claude Code session in the repo — the first message should show
   auto-injected "Pulse session context" (branch, status, north-star §3) with zero tool calls.
2. Boards regression check: open any board — table renders/edits/drags exactly as before (pure
   refactor; 591 board tests + full suite green, but a human eye on the hot surface is owed).
3. `pnpm lint` — expect 0 errors and max-lines warnings only for GanttBoard, AutomationBuilder,
   boards/actions.ts (the remaining candidates).
4. GitHub → Actions: the develop push shows the new `author-email` job green; "Nightly
   integration" appears under workflows (it will skip-with-notice until secrets are added).
5. To activate nightly integration: add repo secrets `PULSE_TEST_SUPABASE_URL`,
   `PULSE_TEST_SUPABASE_ANON_KEY`, `PULSE_TEST_SUPABASE_SERVICE_ROLE_KEY` (a dedicated test
   project — DEV/PROD refs are refused).

## Open threads

- Nightly integration CI inert until the three `PULSE_TEST_*` secrets are added (step 5 above).
- Remaining max-lines offenders: `GanttBoard.tsx`, `AutomationBuilder.tsx`, `boards/actions.ts`
  (the reviewer-noted catch-all; splitting it was out of scope).
- Other repo docs still cite "gotcha-10"/"gotcha-43" by bare number; the index is the resolution
  key.
- `decision-NN` and `gotcha-NN` sequences collide on 22–26 (documented in the index, not renamed).

## Next session entry point

Promote `develop → main` (E1 + both hardening batches unpromoted), or pick from §3 Next
(Phase 10 Batch 2, Ask Pulse full-page, PF, Landing).

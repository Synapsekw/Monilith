---
type: session
date: 2026-06-20-2024
branch: develop
trigger: wrapup
status: complete
tags: [session, boards, sharing, planning]
related:
  - "[[2026-06-20-gotcha-26-per-board-privacy-all-board-scoped-tables]]"
---

# Board-level sharing — spec + implementation plan

## What changed

- Wrote spec `docs/superpowers/specs/2026-06-20-board-level-sharing-design.md` and plan `docs/superpowers/plans/2026-06-20-board-level-sharing.md` (commits `edf7d79`, `cbb4778`; pushed to `develop`).
- Established via subagent search that **org-level invites already shipped** (org_members/org_invitations/roles, `/settings` InvitePanel — just buried in a dropdown + non-default tab); the real gap is **per-board sharing**, which the PRD §9 flagged as open.
- Researched Monday/Asana/ClickUp: all are org-membership + per-board guest grants; per-board is org membership _scoped down_, not a separate system.
- Locked decisions (brainstorming): per-board unit, **private-by-default**, Viewer/Editor, **private even from admins**, share to existing org members only, owner-only sharing, back-fill existing boards as Editor-to-all so nothing disappears, nav label "Shared with me".
- Architecture: `board_members` grant table + `can_read_board`/`can_edit_board` SECURITY DEFINER helpers; sidebar split (My boards + shared-out indicator / Shared with me); owner-only Share dialog.
- **Scope finding** (→ [[2026-06-20-gotcha-26-per-board-privacy-all-board-scoped-tables]]): privacy requires rewriting reads on **all ~15 board-scoped tables** + guarding **6 write RPCs**, not the 5 the spec first listed; updated spec §6/§11/§12 accordingly. User chose the full sweep.
- No source/migration changes — design + plan only. Deleted the stale `_draft-2026-06-20-1542.md` stub (its time-tracking content already lives in [[2026-06-20-1954-phase6c-time-tracking]]).

## Why

We're about to start multi-person collaboration. The open question was whether to invite per-org or per-board; research + the existing org spine showed per-board sharing should layer on top of org membership (not replace it), and "private boards" is exactly what the user wants for personal work.

## Open threads

- **Not built.** Plan Task 1 applies a real cloud migration + runs integration tests (auth-gated) — watch for migration-ledger drift ([[supabase-migration-ledger-drift]]) and the integration auth rate-limit ([[2026-06-20-gotcha-24-integration-suite-auth-rate-limit]]).
- Execution approach chosen conceptually (subagent-driven, 5-wide Wave 2 in worktrees) but user deferred the build to later.
- Residual: per-board storage-object scoping + dashboards still org-scoped (documented follow-ups).

## Next session entry point

Execute `docs/superpowers/plans/2026-06-20-board-level-sharing.md` starting at **Task 1** (migration + helpers + RPC hardening + back-fill + core RLS suite) — the sole critical-path root; Tasks 2–6 then run in parallel.

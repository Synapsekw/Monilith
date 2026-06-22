---
type: adr
status: accepted
date: 2026-06-22
tags: [adr, gotcha, worktrees, pnpm, finish-task, dependencies, typecheck]
related:
  - "[[2026-06-21-gotcha-31-worktree-needs-real-install]]"
  - "[[worktree-gates-binaries-turbopack]]"
  - "[[2026-06-22-1602-whats-next-batch-7c-7b-6h]]"
---

# Gotcha 39 — Rebasing onto a develop with a new dependency leaves the worktree's node_modules stale

## Context

`start-task.sh` runs `pnpm install` once when a worktree is created (gotcha-31). During a long
parallel session, a **sibling** session can merge a **new dependency** into `develop` — this batch:
the `date-cell-calendar` session added `react-day-picker ^10.0.1` (custom calendar for Safari).

## The trap

`finish-task.sh` rebases the task branch onto the latest `develop`, which brings the updated
`package.json` (now listing `react-day-picker`) — but a rebase does **not** run `pnpm install`, so
the worktree's `node_modules` still lacks the package. The gate then fails at **typecheck**, far
from the obvious cause, with errors in files you never touched:

```
src/components/ui/calendar.tsx: error TS2307: Cannot find module 'react-day-picker'
src/components/boards/cells/editors/index.tsx: error TS7006: Parameter 'picked' implicitly has 'any'
```

(The `implicitly any` errors are downstream — the untyped missing module poisons inference in the
new caller.) Reads like a code regression; it's a missing install.

## The fix / rule

- **After any rebase that changes `package.json`, run `pnpm install --prefer-offline` in the
  worktree before re-gating.** (~2s warm, hardlinked.) Then re-run `finish-task.sh`.
- Quick tell: typecheck fails on `Cannot find module 'X'` for a package you didn't add →
  `grep X package.json` (present after rebase) + `ls node_modules/X` (missing) → install.
- **Tooling follow-up:** `finish-task.sh` should `pnpm install` right after its rebase step so this
  is automatic (sibling complement to gotcha-31's create-time install). Until then it's a manual
  step in the serialized-finish flow.

This is distinct from gotcha-31 (no install at all → bins missing): here the create-time install
ran, but a mid-session dependency drift from another branch invalidated it.

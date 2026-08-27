---
type: session
date: 2026-08-27-0913
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-08-26-0900-carryover-batch-and-promote-99]]"
  - "[[2026-08-26-1705-sidebar-board-folders]]"
  - "[[2026-08-11-1501-provider-model-layer-spec-1]]"
  - "[[2026-08-14-0808-agent-runtime-spec-2a]]"
---

# Carryover batch, promote #100, and the first full prod sync since July

## What changed

- **Four carryover worktrees built in parallel, merged one at a time** (`/whats-next` triage → 4
  dispatched build agents → serialized `finish-task.sh`): `pickmodel-ladder` (`6e9a3066`),
  `agent-hardening-2a` (`f596f89a`), `provider-verify-sweep` (`2bb74156`), `a11y-propagation`
  (`749fb0f7`). All four gates green per merge; every branch and worktree cleaned up.
- **a11y propagation sweep** — new shared `useFieldStatus` / `<FieldStatus>` primitive owning
  error-id wiring, `aria-describedby` and `aria-invalid`; applied across 44 files (repo-wide
  `aria-describedby` coverage 7 → 44), focus-restore at 26 new call sites, and a live region for
  the previously-silent `ProposalCard` outcome.
- **AI provider sweep health** — additive migration `20260826104103_ai_provider_sweep_health` (4
  nullable columns on `ai_providers`) + a freshness badge on `/settings/ai`, including the
  org-managed / org-BYO modes where the personal key list is hidden.
- **Spec 2a hardening** — wider quote-lookalike and `\p{Cf}` invisible-character stripping in
  proposal summaries, deep-frozen `DEFAULT_ORG_AI_SETTINGS`, a live-DB `(run_id, tool_call_id)`
  redelivery test, and the two shared test fakes made argument-aware.
- **Promoted `develop → main` as PR #100** (25 commits) — `main` @ `169c6b56`, Vercel `success`,
  verified live by all five of the promotion's `/updates` entries rendering on
  `www.monolith.works`. Squash divergence healed (`develop` tree byte-identical before/after).
- **First dev → prod data sync since 2026-07-17** — 27 migrations pushed to PROD (149/149 parity),
  full data replace, storage 26/42. Backup taken first: `prod-backup-20260827-083353.sql`.
- **Announced** the a11y sweep and the provider badge on `/updates` (dated 2026-08-26); the
  date-bucket check read that day as covered because two *other* announcements landed on it.

## Why

Three carryover rows had sat in the vault as "open defects" for weeks without anyone checking
whether they still were. Two of them weren't. Clearing the backlog mattered less than discovering
that the backlog itself was partly fiction — and the sync closed a five-week drift between the
mirror and the database production actually runs.

## How to test (for the user)

1. Pull `develop`, `pnpm install`, `pnpm dev`. Turn on VoiceOver (⌘F5) — the announcements are
   the point.
2. `/login` → submit a bad email. The error is announced, and Shift-Tab back to Email reads
   "Email, edit text, **invalid data**, Enter a valid email address" (previously just "edit text").
3. Settings → General → change the org name → Save. "Saved." is announced **politely**, not as an
   alert, and focus returns to the Save button instead of dropping to `<body>`.
4. Agents → a run with a pending proposal → Tab to **Approve**, Enter. "Agent action approved." is
   announced; previously the buttons vanished silently.
5. Open any board → quick-add row → type, Enter, type again. The caret stays in the input.
6. `/settings/ai` → "Your AI providers". Each row shows a freshness pill. All five read **"Never
   checked"** until the nightly sweep runs — correct, not a bug. To force the other states, the
   DEV SQL is in [[2026-08-26-1705-sidebar-board-folders]]'s sibling report or re-derive from
   `ai_providers.last_verify_status` (`ok` / `failed` / `skipped`).
7. Sighted regression pass: Settings, auth pages, a few dialogs should look pixel-identical — the
   a11y work is semantics only.

## Open threads

- **Storage sync is 26/42.** The 16 missing objects are the 1.0.0/1.0.1 desktop DMGs and zips
  (113–118 MB each). Bucket limits are identical on both projects (200 MB); the blocker is PROD's
  **project-level** upload limit (Storage → Settings), which DEV has raised and PROD hasn't —
  PROD's largest object ever is 28 MB. Raise it above 128 MB and re-run `pnpm sync:storage` (it
  upserts, so it skips the 26 already there). Low value: the desktop track is blocked on the Apple
  purchase and PROD serves no traffic.
- **`develop` is ahead of `main` again** — sidebar board folders (unpromoted, never run in a
  browser) plus this session's announcement commits.
- **Two prod-write commands were blocked by Claude Code's permission classifier** (`supabase db
  push`, `restore-prod.sh`) and the owner ran them. Unattended `/sync-prod` needs a Bash permission
  rule; verbal permission does not reach the classifier.
- Flagged but not fixed by the a11y sweep: `WorkloadDefaultsDialog`'s two range guards are
  unreachable (native `min`/`max` blocks submit first — proven with a harness); `SubmitFeedbackForm`
  Title/Body have no accessible name at all; `AgentEditor`'s provider error can't be wired until
  `ModelPicker` accepts a describedby prop; `admin/user-row-actions` errors render nowhere.
- `saveAiKey` / `setOrgByoKey` verify on save but write no health row, so a newly-added key reads
  "Never checked" until the nightly sweep. One `recordProviderVerification` call each closes it.
- Dependabot backlog is now **11** branches (vault said 8). The lockfile is free — this is the
  clean window, before E6's Stripe install.

## Next session entry point

**Brainstorm Spec 2c (agent memory)** — still the owner-chosen next slice, and it must consume
`document-budget.ts` rather than re-derive it. Before the next promotion, walk the sidebar
board-folders manual pass (does board *reorder* still survive a click after
`MeasuringStrategy.Always`?). E6 Stripe remains the other open, unblocked epic.

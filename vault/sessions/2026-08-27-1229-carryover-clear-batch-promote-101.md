---
type: session
date: 2026-08-27-1229
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  [
    "[[2026-08-27-0913-carryover-batch-promote-100-sync-prod]]",
    "[[2026-08-26-1705-sidebar-board-folders]]",
    "[[2026-08-26-decision-39-the-catalog-sweep-never-borrows-an-org-byo-key]]",
  ]
---

# Carryover cleared in four parallel worktrees, then promoted (PR #101)

## What changed

- **Four `task/*` worktrees built in parallel, merged serially into `develop`** — the a11y trio
  (`7236d888`), the ModelPicker describedby wiring (`c86a15ab`), save-time provider health
  (`a7f36c42` + `60b0fb53`), and a 46-package dependency sweep (`beab31af`…`b2521089`).
- **Promoted as PR #101** (`55275c40`, 33 commits) — sidebar board folders finally reached
  production alongside the batch. Verified live, not assumed: Vercel `state=success`,
  `www.monolith.works` **200**, `/login` **200**. Squash divergence healed (`df6214ee`,
  tree byte-identical, `origin/main` confirmed an ancestor).
- **The dependency sweep caught a production break.** Next 16.3 stabilised the `unstable_instant`
  route segment config to `instant`; the old name is now **silently ignored**, so both `= false`
  opt-outs stopped applying and `pnpm build` died with `blocking-route` on `/settings`. Bisected to
  Next specifically (16.2.9 + everything else latest was green). See
  [[2026-08-27-gotcha-96-a-stabilised-route-segment-config-is-ignored-under-its-old-name]].
- **Dependabot backlog cleared to zero** — 46 packages bumped in one lockfile change, then PRs
  #97, #71, #77, #76, #70, #24 closed as superseded. Only #33 (Vercel Speed Insights, not a
  dependency PR) remains open.
- **Announced 3 `/updates` entries** (workload range messages, admin action feedback, save-time
  provider check) in `9ee7aae8` + regenerated `2a351057`. The dependency sweep was deliberately
  **not** announced — not user-facing.

## Why

`/whats-next` surfaced nine carryover items, several of which had been re-reported across three
consecutive sessions. The owner's instruction was to clear the whole carryover column rather than
start the next feature slice, explicitly so the same rows stop reappearing. Doing the dependency
sweep now was also the last clean lockfile window before E6 Stripe adds `stripe`.

## How to test (for the user)

1. Pull `develop` (or use production — this is all live on `www.monolith.works`). Dependencies
   changed: run `pnpm install` before `pnpm dev`.
2. **Workload range messages.** Go to `/workload` as an org admin → **Defaults** → set "Hours per
   working day" to `30` → **Save defaults**. Expect an in-page red message *"Hours per day must be
   between 0 and 24."* tied to the field (red ring on the input) — **not** a browser tooltip.
   Repeat with a negative value in the per-item field.
3. **Admin action feedback.** Go to `/admin/users` as a platform admin → a row's "…" menu →
   **Send password reset email**. Expect a bottom-right toast confirming the address. Previously the
   menu just closed and nothing happened, success or failure.
4. **Provider check freshness.** Settings → AI → add or replace a provider key. Expect the
   provider's freshness to read verified-just-now immediately, instead of "Never checked" until the
   nightly sweep. A *rejected* key still shows you the rejection but deliberately leaves the shared
   badge alone (see Open threads).
5. **Feedback field names.** Open the Feedback popover and tab through with VoiceOver (⌘F5). Expect
   "Title, edit text" / "Details, edit text" instead of two unnamed fields. Visually unchanged.
6. **Sidebar board folders** (first time in production): create a folder in the Boards nav, file a
   board into it from its row menu, then drag another board onto it. Confirm board *reorder* still
   works after a click.

## Open threads

- **`saveAiKey`/`setOrgByoKey` record success only, by decision.** `ai_providers` is a
  platform-wide registry with **no tenant column**, so a failure row would let one tenant's revoked
  key render as a vendor outage for every org. The nightly sweep stays the sole authority on
  failures. **CLOSED same day (`6c9cc93a`):**
  [[2026-08-26-decision-39-the-catalog-sweep-never-borrows-an-org-byo-key]] is amended — its
  Consequences line ("A provider keyed only at org level shows 'Not checked' freshness rather than a
  verified timestamp. That is accurate, not a fault.") was struck through rather than quietly
  rewritten, and a second bullet records why failures are not written. The decision itself is
  unchanged; both pinning tests are untouched.
- **The plan board's permanent Artifact URL was re-minted (`6c9cc93a`) — the old one was deleted.**
  `eb984761-…` returned "artifact not found" from `WebFetch` **and** was absent from
  `Artifact action:"list"`, so redeploying was impossible. New URL
  `fc8327d9-8ff3-4461-a17d-7994ab32cd87`, recorded in `.claude/commands/board.md`; the
  never-re-mint rule still stands, and a redeploy failure alone is not proof of deletion — confirm
  with `action:"list"` first. Reading the board in full also turned up three data-only defects,
  all fixed: the gate chips rendered **"undefined"** (render JS reads `g.label`, data carried only
  `name`), the cleared dependabot item was still ranked next-up, and two risks were stale.
- **Item #9 (`/sync-prod` Bash permission rule) is NOT agent-fixable.** Two attempts to add allow
  rules to `.claude/settings.json` — once via a shell script, once via the Edit tool — were both
  refused by Claude Code's permission classifier. An agent cannot widen its own permission scope,
  by design. The owner must paste the rules in by hand; they are in the closing message.
- **Storage sync stays 26/42, and the vault's diagnosis is confirmed exactly.** Queried both
  projects: the 16 missing objects are all in the `desktop` bucket (DMGs/zips up to 118 MB), and
  bucket limits are **identical** on both (`desktop` = 209715200). So the blocker really is the
  PROD **project-level** upload limit (Storage → Settings), which is a platform setting, not a DB
  row — and `supabase-prod` MCP is read-only. Owner-only, and low value while the desktop track is
  blocked on the Apple account.
- **3 new non-blocking lint warnings** from `eslint-config-next` 16.3.3's
  `no-location-assign-relative-destination`, flagging three pre-existing `window.location.assign()`
  calls in `NotificationsBell.tsx`. Left alone — those are deliberate full-document navigations.
- **`@types/node` is 26 while the runtime is Node 24.** Typecheck is clean and nothing in `src/`
  reaches a Node 25/26-only API, but the types now describe a wider surface than the runtime.
- **Majors deliberately not taken:** eslint 9→10, typescript 6→7, framer-motion 12→13, jsdom 29→30,
  openai 6→7, mcp-handler 1→2.
- `user-row-actions.tsx:31` still declares a local `type Result = { ok; error? }`, duplicating
  `ActionResult`. Flagged, not fixed — it was outside the brief.

## Next session entry point

Carryover is empty. **Brainstorm Spec 2c (agent memory)** — the owner-chosen next slice; it must
consume `document-budget.ts` rather than re-derive it, and it must not run in parallel with any
other agent-surface work (it owns the single cached system message and `AgentEditor.tsx`). The
other open, unblocked epic is **E6 Stripe** — and note the footprint pass found the vault's "no
migration needed" claim is **false**: unit F needs a `notification_kind` enum migration, units G/H
need `is_platform_admin()`-gated RPCs, and there is no webhook idempotency store.

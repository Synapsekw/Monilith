---
type: session
date: 2026-07-31-1559
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-07-31-gotcha-64-changelog-drift-check-cannot-see-a-missing-trailer]]"
---

# Changelog backfill — 19 entries for July 17-27 on /updates

## What changed

- Backfilled **19 `Changelog:` trailers** covering **2026-07-17 → 2026-07-27**, the entire gap
  since the last announcement (`1c16f31`): Timeline zoom/nesting/timestamp sources and the report
  fixes (07-17), E5's four user-facing surfaces incl. Autopilot (07-20), the Claude connector
  (07-24), Settings redesign + account deletion + `?next=` (07-25), report charts + Ask write
  actions (07-26), the digest fix + Ask turn persistence (07-27).
- **Six announcement commits, one per ship date, author-date pinned** to that date so `groupByDate`
  renders six accurate headings instead of lumping ten days under today — then one
  `chore(changelog): regenerate generated.ts`. Pushed `354541d7..e69e6f0c`.
- **Omitted the invisible hardening** on purpose (definer ACL lockdown, `/api/oauth/register`
  rate limit, ledger drift gate, open-redirect fix) — nothing there changes what a user sees.
- Gates: typecheck / lint / build / drift-check green. `pnpm test` = 3671 passed, **1 failed —
  not ours**: a Windows-checkout CRLF artifact, below.

## Why

`/updates` had gone ten days and two promotions without a trailer, and the drift check cannot see
that — it only proves `generated.ts` matches history, never that history carries the trailers it
should. The gap was self-evidencing: the already-published 07-27 entries ("Read a whole board over
MCP in one call", "Consent screen and MCP setup say Monolith") both referenced a connector whose
own announcement had never been written. See
[[2026-07-31-gotcha-64-changelog-drift-check-cannot-see-a-missing-trailer]].

## How to test (for the user)

1. Pull `develop`, `pnpm dev`, open `/updates`.
2. Expect six new date headings — July 27 down to July 17 — newest first.
3. Under **July 27**, your two new fixes appear above the four already-published entries (one
   merged group, not two).
4. Spot-check **July 20 → "Autopilot, a scheduled agent for your board"** and **July 24 →
   "Connect Claude to your workspace"** — the two that were most conspicuously missing.
5. Nothing is public until `develop → main` is promoted; `/updates` deploys only from `main`.

## Open threads

- **Two entries announce something inert.** "Find similar items" and "Ask AI searches by meaning"
  go live on the next promotion, but `item_embeddings` is still 0 against 439 prod items. Drain
  `item_embed_queue` **before** promoting, or the changelog advertises a feature that returns
  nothing. This upgrades an existing Owed item into a promotion blocker.
- Two false starts worth not repeating, both cost a full rebuild of the work:
  **(a)** the session-start context claimed `develop` was current when it was ~40 commits stale —
  the first pass was authored against `cc00c66` and had to be reset onto `354541d7`;
  **(b)** `git show --stat` **truncates long paths**, which hid `AutopilotCard.tsx` and led to the
  wrong conclusion that F14 had no UI. Use `--name-only` when deciding whether something is
  user-facing.
- **`pnpm test` fails 2 suites on this Windows checkout** and will keep doing so: `core.autocrlf=true`
  leaves `database.types.ts` with CRLF, and `parsePublicTableNames` anchors `/^ {4}Tables: \{$/`,
  which cannot match a line ending in `\r`. Verified as the cause (strip the `\r`, it matches once).
  CI is Linux/LF and unaffected — but `finish-task.sh` gates on the full suite, so a worktree
  session on this machine will be blocked by it.
- Deleted two stale `_draft-*.md` stubs (07-24 was already written up as
  [[2026-07-24-1950-mcp-server-oauth]]).

## Next session entry point

Unblock the embeddings before anything else: enqueue prod items into `item_embed_queue` via the
prod SQL editor (`supabase-prod` MCP is read-only), let `embed-sweep` drain, then promote
`develop → main` to publish all 19 entries. Otherwise Report Builder v2 roll-ups + org templates
remains the critical path.

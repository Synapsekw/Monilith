---
type: session
date: 2026-07-07-1022
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-07-07-gotcha-52-managed-postgres-set-param-denied-use-set-config]]"
---

# Batch A — 3 migration-gated deferrals scoped, built, merged (soft-delete, avatar, ⌘K search)

## What changed

- `/whats-next` triage on a clean tree → picked **Batch A**: the three migration-gated deferrals. Scoped each to a spec+plan in its own worktree (parallel), then built them sequentially and merged all three to `develop`.
- **⌘K similarity search** (`1eeff8c`) — `search_items` RPC (SECURITY INVOKER, `word_similarity` + ILIKE hybrid, threshold 0.3, capped 25) over the existing `items_name_trgm_idx`; no UI change. Migration `20260707120000`.
- **Avatar upload** (`28ccfe0`) — public `avatars` bucket + owner-scoped `storage.objects` RLS; Profile-card uploader with client auto-normalize (center-crop → 512px → webp); action mirrors to auth metadata + `updateTag`s every org's roster. Migration `20260707130000`.
- **Soft-delete / undo** (`ad137da`) — `archived_at`/`archived_by` on boards/groups/items, partial live+trash indexes, 4 SECURITY-INVOKER cascade RPCs, `archived_at is null` added to all 10 aggregation RPCs **+ `search_items`**; 8s Undo toast + per-board Trash dialog + `/boards` archived section; realtime folds archive-UPDATE as removal. Migration `20260707140000`.
- New ADR: [[2026-07-07-gotcha-52-managed-postgres-set-param-denied-use-set-config]].

## Why

These were the queued "migration-gated deferrals" from the north-star Owed list — write schema → apply → build. Doing all three now clears the backlog before the Phase 10 AI push, and the parallel-scope/sequential-build loop kept them safe against the two shared-state edges (one dev DB, one generated `database.types.ts`) that the disjoint-footprint scoping DAG didn't capture.

## How to test (for the user)

Pull `develop`, `pnpm dev` (all three migrations already applied to **dev**; prod untouched).

1. **⌘K:** press ⌘K, type a typo (`desing`, `raodmap`) → your `Design…`/`Roadmap…` items still surface, exact matches first.
2. **Avatar:** Settings → Profile → Upload a non-square image → cropped 512px webp shows in card, member roster, header menu; Remove reverts everywhere. `.gif`/>5 MB → inline error.
3. **Soft-delete:** delete an item → 8s Undo toast restores it; delete a group/board → board Trash dialog (or `/boards` → Archived boards) → Restore / Delete-permanently; archive items on a dashboard's board → widget counts drop, restore brings them back; two browsers → archive echoes as a live removal.

## Open threads

- **No top-level nav link** to the `/boards` archived-boards Trash — discovery relies on landing on `/boards`. Small follow-up.
- `archived_by` stored but intentionally **not surfaced** in Trash UI (deferred) — ready to show "archived by X, 2h ago" when wanted.
- Still owed: **dev migration-ledger drift** (`20260705120000`). Two stale `_draft-*.md` (07-05 1038/1606) remain for their own blocks.

## Next session entry point

Roadmap thrust is **Phase 10 — AI & Agents, Epic 1** (foundation + Ask Monolith) — already planned; build via `/develop` in `task/ai-foundation-ask-pulse` (Task 0 migration user-applied). Repair the dev ledger drift first. A `develop → main` promote is due to ship this Batch A to prod when ready.

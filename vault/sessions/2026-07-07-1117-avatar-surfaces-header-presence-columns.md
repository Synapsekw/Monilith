---
type: session
date: 2026-07-07-1117
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-07-07-1022-batch-a-soft-delete-avatar-kbar-search]]"
  - "[[2026-07-07-gotcha-53-getuserorgs-filters-deactivated-but-roster-cache-doesnt]]"
---

# Avatar surfaces: header + presence + board columns, and a stale-roster cache fix

## What changed

- Debugging follow-up to the Batch-A avatar-upload feature (user: header still shows initial "D"; board avatars appear >10s late; absent on some boards). Systematic-debugging (2 read-only traces) found the image-optimizer hypothesis was a red herring — avatars are `unoptimized`/stable-URL.
- Built + merged `task/avatar-surfaces` (feature `700d96b`, merge `f9359cb`), four fixes:
  - **A Header** — new `src/components/ui/avatar.tsx`; `user-menu.tsx` renders `<AvatarImage>` + initial fallback; `header-user-data.tsx` plumbs `user_metadata.avatar_url` (first paint, from session).
  - **B Presence** — `presence-reducer.ts` seeds the current user first so their face renders at first paint instead of after the websocket handshake; dedupes on sync.
  - **C Cache** — `invalidateProfileEverywhere` now invalidates `orgMembersTag` for every `org_members` row (active + deactivated) read via service client. See [[2026-07-07-gotcha-53-getuserorgs-filters-deactivated-but-roster-cache-doesnt]].
  - **D Board columns** — created-by cells + People cells now render avatars from the cached payload (initials fallback), not just the presence bar.
- Gates green (2505 tests, 0 fail); no migration (bucket + column already existed).

## Why

The avatar feature only truly rendered on the realtime presence bar (post-handshake) and not the header or board grid — so the identity was slow, inconsistent, and missing where users look first. Correction to record: last session's Batch-A "How to test" overstated that avatars appeared in board columns; they were text-only until this session made it true.

## How to test (for the user)

Pull `develop`, `pnpm dev`.

1. **Header:** upload an avatar in Settings → top-right chip shows your photo (not "D"), immediately on reload.
2. **Presence face:** open any board → your face in the presence bar shows instantly, no ~10s wait.
3. **Board grid:** the Created-by column + People cells now show avatars (initials fallback), row height unchanged.
4. **Previously-absent board:** change avatar, return to a board that was stale → it's current (no up-to-1h stale window).

## Open threads

- Batch-A + this fix are on `develop`, not yet promoted — a `develop → main` promote is due.
- Still owed (unchanged): dev migration-ledger drift (`20260705120000`); the two small Batch-A follow-ups (nav link to `/boards` Trash; surface `archived_by`).

## Next session entry point

Roadmap thrust remains **Phase 10 — AI & Agents, Epic 1** (planned; build via `/develop` in `task/ai-foundation-ask-pulse`, Task 0 migration user-applied). Promote `develop → main` when smoke-tested; repair the dev ledger drift first.

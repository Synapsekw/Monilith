---
type: adr
status: accepted
date: 2026-08-06
tags: [project/monolith, adr, decision, offline, service-worker, boards, desktop]
related:
  - "docs/superpowers/specs/2026-08-05-desktop-app-macos-windows-design.md"
  - "[[00-north-star]]"
---

# Decision 35 — Read-only offline reverses `manifest.ts`'s "no service worker" stance

## Context

`src/app/manifest.ts` carried a deliberate, load-bearing comment: _"Offline is out of scope — no
service worker references here."_ That was a real decision, made so the manifest could stay pure
and synchronous (no env, no Supabase, no request-time API) and keep prerendering statically with
zero boot-time requirements. It was not an oversight to leave unreversed.

`docs/superpowers/specs/2026-08-05-desktop-app-macos-windows-design.md` (the desktop-app spec) puts
offline back in scope, and names its own reversal explicitly under "ADRs owed": _"This reverses
`src/app/manifest.ts`'s stated position … That was a deliberate call and its reversal must be
written down, not left as silent drift."_ This note is that record, plus two more decisions made in
the same build (tasks 1–10 of the offline-read-only plan) that belong next to it rather than as
silent implementation detail.

## Decision

**1. Offline is now in scope — read-only, boards only.** A service worker (`public/sw.js`)
registers after load, on idle, and is referenced from `src/components/offline/ServiceWorkerRegistrar.tsx`
(mounted from `(app)/layout.tsx`). `manifest.ts` itself stays untouched in shape — still pure and
synchronous — but its comment now says offline **is** in scope, pointing at this spec and this ADR
instead of asserting the old absence. Scope is deliberately narrow: boards already visited, reading
only. No offline writes, no queue, no conflict resolution — a write attempted offline is refused,
never deferred (`assertOnline()` in every mutation module throws `OFFLINE_MESSAGE`, which is the
existing optimistic-mutation error path, not a new one).

**2. Read-only reuses the board's existing `access="viewer"`, not a parallel mode.** `OfflineBoard.tsx`
renders `<BoardViews access="viewer" grants={[]} />` against the persisted snapshot. The board
already threads `BoardAccess` through all four view renderers and derives `canEdit = access !==
"viewer"` for shared read-only links — offline read-only is that same viewer state, reached by a
different route, not a second notion of "read-only" that the two paths would have to be kept in
sync by hand.

**3. The local cache is namespaced-and-wiped, not encrypted at rest.** The IndexedDB persister
(`src/lib/offline/persister.ts`) keys every entry by user id (`monolith-offline:<userId>`), and
`wipeOfflineData()` clears the store, the identity markers, and every service-worker cache — called
on sign-out before the redirect, and on stale-session detection at boot. There is no at-rest
encryption of the cached board data.

## Why viewer reuse over a parallel mode

The alternative was a second `access="offline-readonly"` (or similar) value threaded through
`BoardTable`, `KanbanBoard`, `CalendarBoard`, `GanttBoard` alongside the existing `owner` /
`editor` / `viewer`. That would have meant every future check against `BoardAccess` — and every
future affordance gated on it — needs to remember there are now two ways to mean "cannot write,"
which is exactly the kind of drift a single canonical gate is supposed to prevent. Reusing `viewer`
means offline read-only automatically inherits whatever the viewer-access story already does or
will do, for free, with no separate code path to keep honest.

## Why wipe-on-sign-out over encryption at rest

An app that can render a board with the device asleep and no user present needs a key it can read
without a human unlocking anything — which means the key has to live somewhere the app can reach
unattended. At that point encryption has not removed the exposure, it has relocated it to "protect
the key" instead of "protect the data," and the relocated problem is no easier: whoever can read the
key can read the cache anyway. Wiping is a strictly simpler and more provable property: sign out (or
switch org, or let the 7-day grace window lapse) and the store is empirically empty — checkable in
DevTools, and exactly what the manual acceptance script for this plan verifies. macOS still gives the
data the per-user app container's OS-level protection; this decision only says the app does not add a
second, self-managed layer on top of that.

## What would reverse this back

- **The manifest reversal (1):** if offline is pulled from scope entirely — e.g. the desktop app
  ships without it, or usage shows read-only offline isn't used — `manifest.ts`'s comment and the
  service-worker registration should revert together, not drift apart.
- **Viewer reuse (2):** if `access="viewer"` ever needs to mean something offline-specific that
  online viewers must NOT get (or vice versa), the shared gate becomes wrong by construction and the
  two need to split back into distinct values — but that is a real product requirement to justify,
  not a convenience.
- **Wipe-not-encrypt (3):** if the cache scope grows beyond boards into something more sensitive
  (e.g. draft messages, unresolved billing detail) where a 7-day unencrypted local copy stops being
  an acceptable trade even with wipe-on-sign-out, encryption at rest — and the key-custody problem
  that comes with it — should be revisited on its own merits.

## Consequences

- `manifest.ts`'s "offline is out of scope" comment is gone; any future agent reading it should find
  this ADR and the desktop-app spec instead of assuming offline is still unaddressed.
- Any future change to `BoardAccess` semantics must be checked against both the online shared-viewer
  path and the offline path, since they are now the same code, not parallel implementations that
  could be changed independently.
- A security review of the offline cache should check "is it wiped," not "is it encrypted" — that is
  the property this decision commits to being provable.
- Tracked in [[00-north-star]] alongside the offline-read-only and desktop-app work.

---
type: adr
date: 2026-06-22
status: accepted
tags: [decision, gotcha, testing, realtime, jsdom, integration-tests]
related:
  - "[[2026-06-22-1208-phase-6h-realtime-collaboration]]"
  - "[[2026-06-20-gotcha-24-integration-suite-auth-rate-limit]]"
  - "[[worktree-gates-binaries-turbopack]]"
---

# Gotcha 36: live Realtime socket tests fail under jsdom until native Event/EventTarget globals are restored

## Context

6h's live authorization test (`presence.rls.integration.test.ts`) is the first
test in the repo to open an actual Realtime **WebSocket** (every prior
`*.integration.test.ts` only does query-based RLS). The Vitest `integration`
project runs under the **jsdom** environment.

The chain that breaks: Supabase Realtime uses Node's native `WebSocket` (undici),
which dispatches **native `Event`** instances. jsdom **replaces** the global
`Event`/`EventTarget` with its own DOM implementations, and jsdom's
`EventTarget.dispatchEvent` rejects a non-jsdom event with
`ERR_INVALID_ARG_TYPE: The "event" argument must be an instance of Event`. The
socket dies before it ever reaches `SUBSCRIBED`, so the channel never connects —
with a misleading error far from the real cause.

We could not just switch the file to the `node` environment: the shared
`vitest.setup.ts` needs jsdom globals (`Element`, etc.), and editing shared setup
was out of scope.

Other env facts that matter: Node 24 exposes a global `WebSocket` (no `ws`
package needed); the `.env.local` symlink must exist in the worktree or the suite
**silently skips** (`describe.skipIf(!SERVICE_ROLE_KEY)`); per-test timeouts must
be raised (a real RLS denial takes ~5s, past Vitest's 5s default).

## Decision

For a Realtime socket test under jsdom, **restore Node's native `Event` /
`EventTarget` as globals for that test file**, then restore jsdom's in `afterAll`.
Recover the native constructors from objects whose prototypes stay native even
under jsdom — e.g. `EventTarget` via a `MessagePort`'s chain, `Event` via an
`AbortSignal` "abort" event — install them in `beforeAll`. Keep this scoped to the
single socket test file; don't mutate shared setup.

Companion requirements baked in: symlink `.env.local` into the worktree first
(or it skips); bump per-test timeout (~30s); `await client.realtime.setAuth()`
before subscribing; and in `afterAll` call `removeAllChannels()` +
`realtime.disconnect()` on every client so the suite exits without a hanging
socket.

## Consequences

- A reliable, repeatable live proof of private-channel authorization
  (non-member denied / member allowed / presence syncs).
- A reusable recipe for any future socket-level Realtime test in this jsdom-based
  suite. If such tests proliferate, consider a dedicated `node`-environment Vitest
  project for them instead of per-file global surgery.

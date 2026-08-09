---
type: adr
date: 2026-08-09
status: accepted
tags: [decision, gotcha, offline, service-worker, turbopack, dev-environment]
related:
  [
    "[[2026-08-09-gotcha-84-a-dmg-only-update-feed-is-inert]]",
  ]
---

# Gotcha 85 — a cache-first service worker poisons Turbopack dev, and the error blames everything else

## Context

`public/sw.js` serves every `/_next/static/**` request cache-first. Its own rule #1 justified that:

> Only content-hashed assets are cache-first. `/_next/static/**` filenames change whenever their
> contents change, so a stale entry is impossible.

That premise is correct for a **production build** and false for **Turbopack dev**, which reuses a
chunk's filename across recompiles. Measured directly — edit a source file, re-request the *same*
URL:

```
/_next/static/chunks/src_0hajv86._.js   md5 50b0b7… → 75d9e7…   76,036b → 76,124b
```

Same name, different bytes. `ServiceWorkerRegistrar.tsx` registered the worker unconditionally, so
a dev browser cached a set of chunks and then served them forever.

The result is a module graph half-stale and half-fresh, which surfaces as:

```
Module [project]/src/lib/boards/data:5d4ff0 [app-client] was instantiated because it was
required from module .../BoardTableInner.tsx [app-client], but the module factory is not available.
```

## The reason this is expensive to diagnose

Every signal points away from the cause:

- **The error text names three wrong causes** — browser cache, `Cache-Control` headers, service
  worker configuration — with the actual one third and phrased as boilerplate advice. The literal
  suggested workaround ("try hard-reloading") does not fix it, which reads as evidence that the
  service worker is *not* involved.
- **It survives every instinct.** Restart the dev server, `rm -rf .next`, rebuild — no change,
  because the staleness lives in the browser. That strongly implies a code or build defect.
- **The named modules are innocent and unrelated.** `relation-candidates`, `boards/actions`,
  `NewBoardDialog`, `sidebar-nav` — whichever chunks happened to be cached, not whatever was
  actually edited. In our case the reported files had nothing to do with the merge that triggered it.
- **The failing modules are `data:<hash>` synthetics**, not files on disk, so grepping for them
  finds nothing and invites a theory about server-action proxies.
- **A large merge is a perfect false lead.** It changed 23 files and added a dependency, and it also
  aborted `finish-task.sh` before its `pnpm install` — a real, simultaneous, *different* bug
  ([[2026-08-09-gotcha-86-bash-3-2-swallows-a-multibyte-char-into-a-variable-name]]). Two plausible
  culprits at once, one of them genuine but unrelated to the symptom.

The first diagnosis here was wrong for exactly that reason: environmental staleness from the merge
explained the timing perfectly and was still not the cause.

## What settles it

Not reasoning — measurement. Fetch a chunk URL, edit a file that feeds it, fetch the *same* URL
again, and compare bytes. One command distinguishes "content-addressed" from "stable name,
mutable content", and that single fact collapses the entire search.

## Decision

**Never register a caching service worker outside production**, and **unregister** in dev rather
than merely skipping:

```ts
if (process.env.NODE_ENV !== "production") {
  void navigator.serviceWorker.getRegistrations()
    .then((regs) => Promise.all(regs.map((r) => r.unregister())));
  // …plus caches.delete() for every `monolith-offline*` store
  return;
}
```

Skipping alone is insufficient: a browser that installed the worker in an earlier session keeps
serving stale chunks forever, and nothing in the app will ever tell the developer why. Teardown is
what makes an already-poisoned machine heal itself on the next load.

Note the ordering trap this creates: the self-healing code ships *inside* a chunk the poisoned
worker may serve stale, so the first machine to hit it still needs one manual **Clear site data**.
The fix prevents recurrence; it cannot retroactively un-poison a browser that will not load it.

`sw.js`'s rule #1 now states the production-only precondition inline, so the next reader does not
inherit the false premise. `ServiceWorkerRegistrar.tsx` joins `web-vitals.tsx` in the eslint
`process.env` exemption list — `NODE_ENV` is a build-mode flag Next inlines, not configuration, so
it has no place in the env schemas.

## Consequences

- **Offline support is untestable via `pnpm dev`.** It was already only meaningfully testable
  against a production build (dev chunk names being unstable is precisely why), so this removes a
  capability that never actually worked rather than one being given up. Exercise offline behaviour
  with `pnpm build && pnpm start`.
- Four tests in `ServiceWorkerRegistrar.test.tsx` pin both directions: dev tears down and does not
  register; production registers and tears nothing down. The production assertion matters most —
  it is the one an over-eager "disable the worker" change would silently break.

## The generalisable rule

**A caching layer is only as safe as its cache key, and a cache key's guarantees are a property of
the build mode — not of the framework.** Content-addressed filenames make cache-first correct;
stable filenames make it a permanent-staleness machine. Any invariant a cache depends on must be
stated *with the environment it holds in*, because the same code path runs under both.

Corollary, and the more portable lesson: **when a symptom survives destroying and rebuilding all
server state, stop investigating the server.** That single observation ruled out the build, the
merge, the dependency and the module graph, and it was available in the first thirty seconds.

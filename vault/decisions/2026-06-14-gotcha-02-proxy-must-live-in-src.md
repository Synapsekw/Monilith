---
type: adr
status: active
date: 2026-06-14
tags: [decision, gotcha]
related:
  [
    "[[2026-06-15-phase1-auth-tenancy]]",
    "[[2026-06-14-gotcha-01-next16-not-next15]]",
  ]
---

# Gotcha 02 — `proxy.ts` must live under `src/` for Next 16 to register it

## Symptom

The Supabase session-refresh proxy at the **project root** (`proxy.ts`) was silently not running —
sessions weren't being refreshed on requests.

## Context

This project uses a `src/` directory. In Next 16, the request-proxy file (the successor to
middleware) is resolved relative to the app's source root, so a root-level `proxy.ts` is simply not
picked up. See [[2026-06-14-gotcha-01-next16-not-next15]] — Next 16 conventions differ from older
versions and from training data.

## Decision

Move the proxy to `src/proxy.ts` (commit `6a3ef4b`, "move proxy.ts into src/ so Next 16 registers it").

## Rationale

When a `src/` dir is used, Next 16 expects framework entry files under it. The root copy was dead.

## Consequences

- Positive: session refresh actually runs.
- Negative: another "looks fine, silently does nothing" trap — easy to lose time on.
- Open follow-ups: when adding any Next 16 special file (proxy, instrumentation, etc.), confirm the
  expected path against `node_modules/next/dist/docs/` given the `src/` layout.

## Related

- [[2026-06-15-phase1-auth-tenancy]]

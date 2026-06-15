---
type: adr
status: active
date: 2026-06-14
tags: [decision, gotcha]
related: ["[[2026-06-14-phase0-setup]]", "[[00-north-star]]"]
---

# Gotcha 01 — Scaffold is Next 16, not the Next 15 the brief specified

## Symptom

The master brief specified Next.js **15**. `create-next-app@latest` actually shipped **Next 16.2.9**
(React 19.2, Tailwind v4). APIs, conventions, and file structure differ from Next 15 — and from
model training data.

## Context

The whole point of `AGENTS.md` / `CLAUDE.md`: "This is NOT the Next.js you know." Assuming Next 15
(or older) behavior will produce code that's subtly or outright wrong.

## Decision

Stay on **Next 16.2.9** — approved by Danijel 2026-06-14. It's a superset of 15's capabilities and
the current stable release.

## Rationale

Downgrading to 15 would mean fighting the scaffold for no benefit. 16 is stable and current; the
cost is only that we must check the real docs rather than rely on memory.

## Consequences

- Positive: on the current stable release; no downgrade churn.
- Negative: training-data knowledge of Next is unreliable here.
- Open follow-ups: **always read `node_modules/next/dist/docs/` before writing framework code.**
  Heed deprecation notices. (This is also why `proxy.ts` lives where it does — see
  [[2026-06-14-gotcha-02-proxy-must-live-in-src]].)

## Related

- [[2026-06-14-phase0-setup]]

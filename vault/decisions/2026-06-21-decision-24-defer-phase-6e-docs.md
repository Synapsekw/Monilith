---
type: decision
date: 2026-06-21
status: accepted
tags: [decision, roadmap, phase-6, docs, architecture]
related:
  [
    "[[2026-06-16-decision-08-dark-first-monday-reskin]]",
    "[[2026-06-21-2335-phase-6d3-mirror-aggregation-footer]]",
  ]
---

# decision-24: Defer Phase 6e (Docs) — too complex, not fully cloud-native

## Context

Phase 6 (ClickUp depth) was specced as five slices: A subitems · B custom fields/statuses ·
C time tracking · D relations+mirror · E **Docs**. A–D and 6f/6g are shipped. 6e (a ClickUp-style
rich-text Docs feature) was the last unbuilt slice and the standing "Next" after 6d-3.

A footprint scan (during the 6d-3 `/whats-next` triage) flagged that Docs is the heaviest remaining
slice and needs a new rich-text editor dependency (TipTap/Lexical).

## Decision

**Defer 6e (Docs) indefinitely.** It is not the next thing we build.

## Why

- **Too complex for current value.** The full ClickUp-Docs experience (rich blocks, real-time
  collaborative editing, presence, comments-in-doc, import/export) is a large surface relative to
  what the product needs right now.
- **Not fully cloud-native within our architecture.** Pulse's invariant is **Postgres + RLS +
  Server Actions/Storage, no standing non-Supabase infra** (cf. automations "no Edge Functions",
  PDF preview "bucket-only, no third-party egress"). The full Docs feature breaks that:
  collaborative editing realistically needs a **CRDT/OT sync layer** (Yjs + a persistent websocket
  provider such as Hocuspocus, or a dedicated realtime-doc service) and document conversion needs a
  **server-side conversion engine** — both are standing services outside Supabase. We are not
  standing those up now.

## Consequences / scope

- Phase 6 is treated as **complete except the deferred 6e**. Next work is **Phase 7** (7b Goals —
  plan-staged in `task/goals-7b`; 7c Workload — unspec'd).
- **Not permanently closed.** A _minimal, non-collaborative_ rich-text note (TipTap → JSON in a
  Postgres column, RLS-scoped, no realtime) WOULD be cloud-native and could be revisited later as a
  smaller slice. The deferral is specifically about the **full** collaborative Docs feature and its
  non-Supabase infra, not about ever having documents.

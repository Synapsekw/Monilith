---
type: adr
date: 2026-06-16
status: accepted
aliases: [myday-clone-donor]
tags: [decision, donor, collaboration, phase/4, reference]
related:
  - "[[00-north-star]]"
  - "[[2026-06-16-phase-4-collaboration-design]]"
  - "[[2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch]]"
---

# Decision 11 — `idandavid1/My-Day` as a Phase-4 UX donor (not a code donor)

## Context

While scoping Phase 4 (Collaboration) we surveyed two public Monday.com clones as potential donors.

- `ayushgupta1324/monday.com-clone` — **rejected outright**: vanilla HTML/CSS/JS + json-server, weekend
  prototype, no boards/views, no license. Nothing transferable; we're already well past it.
- `idandavid1/My-Day` — **a real clone** (React+Redux SPA, Node/Express + MongoDB, Socket.io). 383
  commits, deployed. Worth studying. Clone lives at `/tmp/myday-study` during the study (not in-tree).

Both are **unlicensed → all-rights-reserved**, so no code may be copied regardless. The value is
design/UX reference only.

## Decision

Treat My-Day as a **UX/taxonomy donor for Phase 4**, never an architecture or code donor. Its
data-flow model is a near-perfect catalogue of the pitfalls our invariants exist to prevent.

**Steal (UX ideas, reimplemented Pulse-native):**

- The item panel's **two-tab split**: _Updates_ (human discussion) vs _Activity Log_ (system events).
- The **activity taxonomy** + per-action **from→to** rendering (status/date/person/number diffs) —
  reimplemented data-driven by our column kinds, resolved at render time from the board cache.
- Composer affordances: collapsed "Write an update" → expand, empty states, comment overflow menu.

**Reject (architecture — these are the traps):**

- Activities as a **30-item capped array on the board doc** (`activities.pop()`) → silent history loss
  - full-board re-save per event. → Pulse: append-only `item_activities` rows, paginated, never capped.
- **Comments nested on the task** → no pagination/permissions, board re-save per comment. → Pulse:
  `item_updates` table, RLS, optimistic per-row.
- **Full-board socket broadcast** on every change → heaviest sync + double-apply bugs. → Pulse:
  row-level Supabase Realtime deltas filtered by item/recipient (already our pattern).
- `contentEditable` title with no validation → Pulse: Zod-validated Server Action.

## How to apply

The green-check items above are realized in the Phase-4 spec
([[2026-06-16-phase-4-collaboration-design]] §4–§6, §10). When building 4a, mine My-Day for _layout and
interaction detail only_; take nothing from its `store/`, `services/`, or socket wiring. The reject-list
maps 1:1 to the spec's anti-pattern call-outs (§10).

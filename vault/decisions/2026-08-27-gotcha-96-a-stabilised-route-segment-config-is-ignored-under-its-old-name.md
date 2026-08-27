---
type: adr
date: 2026-08-27
status: accepted
tags: [decision, gotcha, nextjs, dependencies, build]
related:
  - "[[2026-08-27-1229-carryover-clear-batch-promote-101]]"
  - "[[2026-08-27-gotcha-97-a-layouts-instant-false-does-not-cover-the-pages-beneath-it]]"
---

# Gotcha 96 — a stabilised route segment config is ignored under its old name

## What happened

A routine minor-version dependency sweep (Next 16.2.9 → 16.3.3, inside a 46-package batch) broke
`pnpm build` with `blocking-route` on `/settings`.

Next 16.3 **stabilised** the `unstable_instant` route segment config to `instant`. The old export
name is not deprecated-with-a-warning and it is not an error — it is **silently ignored**. Both
`src/app/(app)/layout.tsx` and `src/app/admin/layout.tsx` carried `export const unstable_instant =
false` as a deliberate opt-out, and after the bump those opt-outs simply stopped existing. The
config had not changed value, had not moved file, and threw nothing; it just stopped being read.

The failure surfaced two hops from its cause: a *build* error about route blocking, from a
*dependency* bump, in a batch of 46 packages where `radix-ui` (1.5 → 1.6.7) was the more obvious
suspect. It was isolated by bisecting the package, not the code — pinning `next@16.2.9` with
everything else at latest built green (exit 0), which named Next and exonerated radix in one step.

## The general shape

A renamed export that throws is a five-minute fix. A renamed export that is **silently ignored** is
a behaviour change disguised as a no-op, and the blast radius is whatever the config was protecting
— here, an opt-out, so the failure was loud. Had it been an opt-*in* to something safe, the build
would have stayed green and the behaviour would have quietly regressed into production.

The `unstable_` prefix is the tell. Every `unstable_*` API in the tree is a **scheduled rename**:
the day it stabilises, the old name becomes dead code that still looks live. Grep for `unstable_`
before any Next minor bump and check each hit against
`node_modules/next/dist/docs/` — the installed docs are the source of truth, and they carry the
stabilised name (`.../route-segment-config/instant.md`).

## What we do about it

- Both layouts now export `instant`, each with a docblock warning against renaming it back.
- **Before any Next minor/major bump:** `grep -rn 'unstable_' src/` and verify every hit still
  exists under that name in `node_modules/next/dist/docs/`. A hit that has stabilised is a silent
  behaviour change, not a lint nit.
- A dependency sweep that breaks the build is bisected **by package**, not by reading the diff. One
  pin-and-rebuild names the culprit; reading 46 changelogs does not.

## What this is not

This is not an argument for pinning Next or for smaller sweeps. The batch is what surfaced it, and
it surfaced at build time in a worktree with all four gates — which is exactly where it should. The
lesson is the grep, not the caution.

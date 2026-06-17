---
type: adr
date: 2026-06-16
status: accepted
tags: [decision, design, reskin, reuse]
related:
  - "[[00-north-star]]"
  - "[[product]]"
  - "[[2026-06-14-pulse-design]]"
---

# Decision 08 — dark-first Monday reskin; reuse the in-repo prototype

## Context

A separate, self-contained prototype exists on disk (NOT a git repo, not a submodule):

```
/Users/danijeljovanovic/Dev/Monolith 2/Untitled folder/monolith/
```

It is a **Vite + React 18 + TypeScript + Tailwind v3** SPA — a faithful, dark-monochromatic
Monday.com clone. State is **Zustand + localStorage** (single-user, no backend), drag-and-drop via
**@dnd-kit**, charts via **Recharts**. It implements Table / Kanban / Calendar / Timeline / Dashboard
views plus a filter builder, automations, label editor, item panel (updates/@mentions/activity +
subitems), export/import, templates, undo/redo and keyboard grid nav.

The owner likes this look and wants Pulse to adopt it. Pulse already commits to the same _philosophy_
(monochromatic + single accent) and already has the whole feature set in the roadmap (Phases 3b–9).
The gap is (a) the **visual lead** was light-default; the prototype is dark-first, and (b) there was
no **reskin** workstream to apply the look to already-shipped surfaces.

## Decision

1. **Dark-first.** The dark near-black theme becomes Pulse's primary/reference look; light mode stays
   fully supported but secondary. Recorded in PRD §2 + §5.4 (X-3), master spec §6, `product.md`.
2. **Reskin workstream (RS).** A cross-cutting pass — **not** a renumber of phases 0–9 — sequenced
   first among current near-term work, aligning shipped surfaces to the dark look before/while feature
   phases continue. Recorded in PRD §8, master spec §7, north-star §2.
3. **Reuse the prototype as a UI/feature donor, never an architecture donor.** Keep Pulse's spine
   (Supabase + RLS, Server Actions + Zod, immutable TanStack-Query cache, Supabase Realtime,
   `cell_values` EAV model). Do **not** port the prototype's Zustand store, localStorage persistence,
   or module-array undo/redo.
4. **Translate, don't copy, tokens.** The prototype is Tailwind v3 with a `tailwind.config.js` hex
   palette. Pulse is **Tailwind v4** (no config file — `@theme` in `globals.css`, OKLch vars). Port the
   palette by translating hex → OKLch `@theme` tokens; never hardcode hex. (The "we're not using
   Tailwind" worry was a false alarm: Pulse _is_ on Tailwind v4, which simply has no `tailwind.config.js`.)

## Prototype palette (translate into `globals.css` `@theme` / `.dark`)

| Role            | Prototype hex | Notes                                  |
| --------------- | ------------- | -------------------------------------- |
| background/base | `#0d0d0f`     | near-black body                        |
| surface         | `#16161a`     | primary panel                          |
| surface2        | `#1f1f24`     | elevated                               |
| surface3        | `#26262c`     | interactive hover                      |
| border          | `#2a2a30`     | standard                               |
| border-light    | `#34343c`     | emphasized/hover                       |
| accent          | `#6366f1`     | ≈ `oklch(0.62 0.19 263)` (Pulse brand) |
| accent-hover    | `#7c7ff5`     |                                        |
| accent-dim      | `#2d2e54`     | accent background tint                 |
| txt             | `#e7e7ea`     | primary text                           |
| txt-dim         | `#a1a1aa`     | secondary                              |
| txt-faint       | `#6b6b73`     | tertiary/disabled                      |

Shadows: panel `0 8px 30px rgba(0,0,0,.5)`, card `0 1px 3px rgba(0,0,0,.4)`. Font Inter. Custom
animations `fadein` (.15s), `slidein` (.2s), `shimmer` (skeleton); dark custom scrollbar.

## Reuse map (prototype → Pulse)

Prototype root abbreviated as `…/monolith/src`.

**Tier 1 — drop-in (pure code / design):**

- Design tokens (`tailwind.config.js` + `index.css`) → translate into `@theme` / `.dark`.
- `lib/exporters.ts` (JSON/CSV export + file import) → wire to Pulse cache/actions. _(satisfies PRD X-6)_
- `lib/templates.ts` (Sprint / Content / CRM / blank board builders) → wire to `create_board`.
- `lib/boardData.ts` (pure `applyFilters`, `evalCondition`, `cellSortKey`, `groupItems`) + `lib/util.ts`
  (`evalFormula`, `findLabel`, `textOn`, date helpers, `PALETTE`).

**Tier 2 — port rendering, rewire data source (Zustand → `useBoardCache` + `useBoardMutations`):**

- `views/CalendarView.tsx`, `views/TimelineView.tsx`, `views/DashboardView.tsx` (Recharts) — Pulse has
  none of these yet (Calendar/Timeline = Phase 3b; Dashboard = Phase 8).
- `components/FilterPanel.tsx` (stacked conditions, match all/any), `views/LabelEditor.tsx`,
  `components/AutomationsModal.tsx` (Phase 5).
- `components/ItemPanel.tsx` (slide-in detail: updates/@mentions/activity + subitems) — Phase 4;
  `parent_id` already exists in schema.

**Tier 3 — needs schema work first (new `column_kind` enum values + Zod cell schema + renderer + editor):**

- `timeline`, `progress`, `rating`, `link`, `files`, `formula`, `longtext`, `checkbox`, `priority`.
  Pulse currently supports only `text | status | people | date | numbers | dropdown`.

**Do NOT port:** the Zustand store (`store.ts`), localStorage persistence, undo/redo-via-module-arrays,
`Sidebar.tsx` / `TopBar.tsx` (Pulse has its own nav + `ViewSwitcher`), and the bespoke `ui.tsx`
Popover/Modal (Pulse uses Radix/shadcn equivalents).

## Consequences

- The reskin re-skins existing Table/Kanban first, then feature phases land on the dark surface.
- WCAG AA must be re-verified for accent-on-near-black and status pills (north-star/PRD success metrics).
- The prototype lives outside version control — treat this ADR + its reuse map as the durable record;
  the prototype folder may move or disappear.

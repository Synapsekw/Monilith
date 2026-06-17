---
type: product-context
status: active
last-updated: 2026-06-15
tags: [project/pulse, product, design-context]
related:
  - "[[00-north-star]]"
---

# Product

## Register

product

## What it is

**Pulse** — a cloud-native **"Work OS"**: a flexible, visual platform for teams to plan, track, and
run any kind of work. Monday.com's color-coded board experience as the foundation, ClickUp's depth
folded in, Asana's polish on top. One coherent product, not a clone — the goal is the _ultimate_
version of the category.

## Users

- **Team members (primary)** — people doing the work. Live in boards/items, update statuses, leave
  comments, track time. Want speed, clarity, and to never lose context.
- **Team leads / PMs** — structure the work: build boards, set up views, define automations, watch
  timelines and workload. Want flexibility without fragility.
- **Executives** — read-mostly. Live in Portfolios, Goals/OKRs, dashboards. Want roll-up health at
  a glance, not raw task lists.
- **Org admins** — manage workspaces, membership, roles (owner/admin/member/guest), tenancy. Want
  control and a clean security boundary.

## Product purpose

Give a team one place where every layer of work connects — from a single subitem up through goals
and portfolios — with realtime collaboration, no-code automations, and views that fit how each
person thinks (table, kanban, calendar, timeline, workload). Multi-tenant from day one; performance
that stays smooth at 10k-item boards.

## Brand personality

Three words: **Calm. Capable. Crisp.**

- **Calm** — a colorful category (Monday especially) tends toward visual noise. Pulse stays
  monochromatic by default; color carries _meaning_ (status, labels), not decoration. The lead look
  is **dark-first**: layered near-black surfaces, hairline borders, a single indigo accent (light
  mode supported but secondary).
- **Capable** — depth is there when you reach for it (nesting, formulas, automations, time tracking)
  but never thrown at you up front.
- **Crisp** — Linear-grade restraint. Generous whitespace, sharp typography, subtle 150–250ms motion.

## Anti-references

- **Maximalist Work-OS chrome** — rainbow gradients on every surface, dense toolbars, color for its
  own sake. Pulse keeps chrome strictly monochrome; status/label colors are the one controlled palette.
- **Feature-soup UI** — exposing every advanced capability at once. Depth is progressive.
- **Heavy, janky tables** — anything that stutters past a few hundred rows. Virtualize, paginate,
  index, stream.
- **AI-marketing slop** — "Powered by AI" badges, glow-everything. AI assist is _seams only_ for now,
  no build yet.

## Design principles

1. **Monochrome chrome, meaningful color.** Neutrals + one configurable accent build the interface;
   color is reserved for status and labels — the data, not the frame.
2. **Progressive depth.** Monday-simple on the surface, ClickUp-deep on demand. Never overwhelm.
3. **Realtime and optimistic.** Edits feel instant; presence and live updates via Supabase Realtime.
4. **Performance is a feature.** Smooth at 10k items — virtualization, indexes, streaming are baseline.
5. **RLS is the security boundary.** Multi-tenant, org-scoped, default-deny. The client is never trusted.
6. **Accessible by default.** WCAG AA contrast, full keyboard nav, focus rings, SR labels, reduced-motion.

## Design system (from spec §6)

Semantic CSS variables in `globals.css` for both themes (`--background`, `--surface`,
`--surface-muted`, `--border`, `--foreground`, `--muted-foreground`, plus a single configurable
`--accent`). next-themes, class-based dark mode, no flash, respect system pref + manual toggle. One
clean sans (Geist/Inter), 4px grid, `rounded-md`, soft shadows for elevation / hairline borders for
separation. **Dark-first** — the dark near-black theme is the reference look; light is secondary.
The concrete palette/density target is the in-repo prototype reskin (reuse map:
[[2026-06-16-decision-08-dark-first-monday-reskin]]); its hex tokens are translated into the
`@theme`/OKLch variables (never hardcoded). App-level primitives: `BoardTable`, `StatusCell`,
`PersonCell`, `ItemPanel`, `ViewSwitcher`, `CommandPalette`.

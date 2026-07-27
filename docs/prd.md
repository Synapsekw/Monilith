# Monolith — Product Requirements Document (PRD)

> **Status:** Living document · **Last updated:** 2026-06-15 · **Audience:** contributors (human + AI)
>
> This PRD is the product-lens view of Monolith: the _why_, _for whom_, and _what_ (as
> prioritized requirements). It is deliberately thin where other docs already say it well and
> links out to them. The **engineering source-of-truth** is the
> [master design spec](superpowers/specs/2026-06-14-pulse-design.md); the **phased build plan**
> lives in that spec (§7) and in the vault ([`platform-roadmap`](../vault/moc/platform-roadmap.md),
> [`00-north-star`](../vault/00-north-star.md) §2). When product scope changes, update this file
> and the north-star together.

---

## 1. Problem & opportunity

Teams run their work across a sprawl of disconnected tools: a board app for tasks, a doc app
for specs, a spreadsheet for tracking, a separate place for goals, and yet another for time and
capacity. Context is lost in the seams. The dominant "Work OS" products each lean one way and
pay for it:

- **Monday.com** nails the visual, color-coded board experience but trends toward _visual noise_
  and shallow depth — color for its own sake, limited nesting, weak docs/time.
- **ClickUp** has the depth (nesting, docs, time tracking, custom fields) but the surface is a
  _feature-soup_: everything exposed at once, performance that stutters.
- **Asana** has the polish and the goals/portfolio story but is comparatively shallow on the
  flexible-board and customization axis.

The opportunity: **one coherent product that connects every layer of work — from a single
subitem up through goals and portfolios — without the noise, the soup, or the jank.** Monday's
board foundation, ClickUp's depth folded in on demand, Asana's polish on top. Not a clone: the
_ultimate_ version of the category, with Linear-grade restraint applied to a colorful space.

## 2. Vision & positioning

**Monolith** is a cloud-native **"Work OS"**: a flexible, visual platform for teams to plan, track,
and run any kind of work. Multi-tenant from day one; performance that stays smooth at
10k-item boards.

**Brand personality — Calm. Capable. Crisp.** Monochromatic by default (color carries _meaning_
— status and labels — not decoration); depth available when you reach for it but never thrown at
you; Linear-grade restraint.

**Visual lead: dark-first.** The primary, reference look is a **near-black monochromatic surface
set with a single indigo accent** — color reserved strictly for meaning (status pills, priority
tags, charts, the active nav item, primary actions). Light mode is fully supported but secondary.
The concrete visual target is the in-repo prototype reskin captured in
[`2026-06-16-decision-08-dark-first-monday-reskin`](../vault/decisions/2026-06-16-decision-08-dark-first-monday-reskin.md)
and its reuse map; tokens/components are being aligned to it (see Release plan §8).

See the master spec [§1 Product vision](superpowers/specs/2026-06-14-pulse-design.md#1-product-vision)
and [`vault/product.md`](../vault/product.md) for the full positioning, anti-references, and
design principles.

## 3. Personas

Condensed from [`vault/product.md`](../vault/product.md#users); see there for the full picture.

| Persona                   | Role                | Lives in                               | Wants                               |
| ------------------------- | ------------------- | -------------------------------------- | ----------------------------------- |
| **Team member** (primary) | Does the work       | Boards & items                         | Speed, clarity, never lose context  |
| **Team lead / PM**        | Structures the work | Boards, views, automations, timelines  | Flexibility without fragility       |
| **Executive**             | Read-mostly         | Portfolios, Goals/OKRs, dashboards     | Roll-up health at a glance          |
| **Org admin**             | Manages the org     | Workspaces, membership, roles, tenancy | Control + a clean security boundary |

## 4. Jobs-to-be-done

Per persona, the core jobs Monolith must serve ("when I…, I want to…, so I can…"):

- **Team member**
  - When work lands on me, I want to see what's mine and its status at a glance, so I can act
    without digging.
  - When something changes, I want to update a cell or status inline and have it stick instantly,
    so I stay in flow.
  - When I need context, I want the discussion, files, and history attached to the item itself,
    so I never hunt across tools.
- **Team lead / PM**
  - When a process is new, I want to shape a board (groups, columns, views) without code, so the
    tool fits the work — not the reverse.
  - When work is repetitive, I want no-code rules to move/notify/update automatically, so the team
    doesn't babysit it.
  - When I plan, I want the same data as a table, kanban, calendar, or timeline, so I can think in
    whatever frame fits.
- **Executive**
  - When I check in, I want portfolio/goal health rolled up, so I see status without reading task
    lists.
- **Org admin**
  - When I run the org, I want to manage members, roles, and workspaces with a hard tenant
    boundary, so data never leaks across orgs.

## 5. Functional requirements

Capabilities reframed from the master spec [§4 Feature set](superpowers/specs/2026-06-14-pulse-design.md#4-feature-set)
as prioritized requirements. **Priority** is product importance, independent of sequencing;
**Phase** is when the [roadmap](superpowers/specs/2026-06-14-pulse-design.md#7-phased-build-plan-commit--checkpoint-after-each)
delivers it.

- **P0** — core to the product being itself; must ship for a credible v1.
- **P1** — strong differentiator / expected by the target user; ships once the core is solid.
- **P2** — depth & polish that complete the category-ultimate ambition.

### 5.1 Foundation (Monday core)

| ID   | Requirement                                                                                                                                          | Priority | Phase |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----- |
| F-1  | Multi-tenant org model with roles (owner/admin/member/guest); org-scoped isolation                                                                   | P0       | 1     |
| F-2  | Hierarchy: Workspaces → (Folders) → Boards → Groups → Items → Subitems                                                                               | P0       | 2 / 6 |
| F-3  | Table view with core column types (Text, Status, People, Date, Numbers, Dropdown)                                                                    | P0       | 2     |
| F-4  | Inline editing with optimistic updates + realtime sync                                                                                               | P0       | 2     |
| F-5  | Extended column-type system (Timeline, Rating, Checkbox, Priority, Tags, Progress, Files, Link, Email, Phone, Formula, Connect-boards, Mirror, etc.) | P1       | 3 / 6 |
| F-6  | Additional views: Kanban, Calendar, Timeline/Gantt (dependencies); view switcher + saved config                                                      | P1       | 3     |
| F-7  | Collaboration: item panel, updates/comments, @mentions, attachments, activity log                                                                    | P1       | 4     |
| F-8  | Notifications: in-app inbox + email digests; subscription, mute/snooze, batching                                                                     | P1       | 4     |
| F-9  | No-code automations (When/If/Then) via Postgres triggers + Edge Functions                                                                            | P1       | 5     |
| F-10 | Forms (intake → items), Cards, Chart/Dashboard, Map views                                                                                            | P2       | 8     |

### 5.2 ClickUp depth

| ID  | Requirement                                                        | Priority | Phase |
| --- | ------------------------------------------------------------------ | -------- | ----- |
| D-1 | Subitems / multi-level nesting                                     | P1       | 6     |
| D-2 | Native time tracking (timer, manual entries, timesheets, billable) | P2       | 6     |
| D-3 | Docs/Wiki (rich text, slash commands, embeds, reference items)     | P2       | 6     |
| D-4 | Custom statuses & fields; saved filters/view configs               | P1       | 6     |
| D-5 | Relations / dependencies with blocking logic; mirror columns       | P2       | 6     |

### 5.3 Asana polish

| ID  | Requirement                                                                   | Priority | Phase |
| --- | ----------------------------------------------------------------------------- | -------- | ----- |
| A-1 | Goals/OKRs (company→team→individual) with auto roll-up from contributing work | P2       | 7     |
| A-2 | Portfolios (exec grid: status/owner/timeline/priority/health/budget)          | P2       | 7     |
| A-3 | Workload/capacity with over-allocation flags                                  | P2       | 7     |

### 5.4 Cross-cutting

| ID  | Requirement                                                                                                                    | Priority | Phase  |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | -------- | ------ |
| X-1 | Performance: virtualize/paginate/index/stream — smooth at 10k-item boards                                                      | P0       | 2 / 9  |
| X-2 | RLS as the security boundary — default-deny, org-scoped, client never trusted                                                  | P0       | 1      |
| X-3 | Monochrome design system + single configurable accent; **dark-first** (near-black surfaces), light also; WCAG AA, keyboard nav | P0       | 0 / RS |
| X-4 | Command palette (⌘K)                                                                                                           | P1       | 0 / 8  |
| X-5 | Templates; mobile-responsive PWA-ready layout                                                                                  | P2       | 8      |
| X-6 | Board export / import (CSV + JSON) and duplicate                                                                               | P2       | 8      |

## 6. Non-goals / out of scope

Explicitly **not** building (now), to keep scope honest:

- **AI features.** Reserve _seams_ only (placement, affordances). No AI build, no "Powered by AI"
  chrome. (Master spec §4.4.)
- **Native mobile apps.** Responsive, PWA-ready web only.
- **Billing / seat enforcement.** The data model avoids artificial seat minimums, but billing is
  not in scope for the phased build.
- **Third-party integrations marketplace.** OAuth app registrations are a later manual concern
  (master spec §9); no integration platform now.
- **Self-hosting / on-prem.** Cloud-native on Vercel + Supabase Cloud.
- **Decorative color.** Not a stylistic non-goal but a hard product rule: chrome stays
  monochrome; color is reserved for status/labels.

## 7. Success metrics

What "good" looks like for the product. (Adoption/business metrics are out of scope while
pre-launch; these are the build-quality and experience signals we hold ourselves to.)

- **Performance:** a 10k-item board scrolls, filters, and edits smoothly (virtualized; no
  jank past a few hundred rows). Inline edits feel instant (optimistic, sub-100ms perceived).
- **Correctness & security:** org isolation proven by RLS integration tests on every
  tenant-scoped table; default-deny verified; zero cross-org access. No phase ships with failing
  tests or advisor warnings.
- **Realtime:** edits, presence, and notifications propagate live across sessions.
- **Accessibility:** WCAG AA contrast, full keyboard navigation, focus rings, SR labels,
  reduced-motion honored.
- **Coherence:** progressive depth holds — the surface stays Monday-simple while ClickUp-depth is
  reachable, not thrown at the user.

## 8. Release plan

Monolith ships in **10 phases (0 → 9)**, each committed and checkpointed (tests + advisors +
regenerated types + CHANGELOG, then review) before the next. The authoritative plan is the
master spec [§7 Phased build plan](superpowers/specs/2026-06-14-pulse-design.md#7-phased-build-plan-commit--checkpoint-after-each);
current status is tracked in [`00-north-star`](../vault/00-north-star.md) §2 and
[`platform-roadmap`](../vault/moc/platform-roadmap.md).

**Design refresh (RS) — dark-first reskin, near-term cross-cutting pass.** Beyond the numbered
phases, a visual reskin aligns the existing surfaces (app shell, sidebar, board Table/Kanban,
cells, editors) to the dark-first near-black monochromatic look (§2). It runs as its own
workstream against the current build (not a renumber of 0–9) and is sequenced **first** among the
current near-term work. The concrete target and a component-by-component reuse map from the in-repo
prototype are recorded in
[`2026-06-16-decision-08-dark-first-monday-reskin`](../vault/decisions/2026-06-16-decision-08-dark-first-monday-reskin.md).
Feature phases (Calendar/Timeline, collaboration, automations, dashboards, export) then land on
the reskinned surface, reusing prototype view/logic code where portable.

**Where we are (2026-06-16):** Phases 0 (Setup), 1 (Auth & tenancy), 2 (Boards core) done; Phase 3
(Views) in progress — 3a (view switcher + Kanban) built, 3b (Calendar + Timeline/Gantt +
dependencies) next. Dark-first reskin (RS) queued as the immediate near-term pass. Live status:
[`00-north-star`](../vault/00-north-star.md) §2.

## 9. Risks & open questions

- **EAV cell-values vs. performance.** The flexible `cell_values` (item × column × jsonb) model
  buys arbitrary column types but complicates sorting/filtering at scale. _Open:_ where do we need
  generated/typed columns or materialized projections to keep 10k-item boards smooth? (Master spec
  §5.)
- **Realtime fan-out.** Live updates on items/cell_values/comments at board scale — what are the
  subscription granularity and batching strategies before they become a bottleneck?
- **Automations engine surface.** Postgres triggers + Edge Functions give power; the open question
  is how much rule complexity to expose without becoming feature-soup.
- **Formula & mirror columns.** Computed/derived columns across boards are high-value but
  high-complexity; sequencing and evaluation model are unsettled.
- **Offline / conflict resolution.** Optimistic updates assume connectivity; conflict and
  reconciliation behavior is not yet specified.
- **Permissions granularity.** Org roles exist (F-1); board/item-level sharing and guest scoping
  beyond the org boundary are open.

---

## Related documents

- [`docs/README.md`](README.md) — documentation index / map
- [Master design spec](superpowers/specs/2026-06-14-pulse-design.md) — engineering source-of-truth
- [`vault/00-north-star.md`](../vault/00-north-star.md) — canonical "where are we" entry point
- [`vault/product.md`](../vault/product.md) — full product context
- [`AGENTS.md`](../AGENTS.md) · [`CONTRIBUTING.md`](../CONTRIBUTING.md) — how we build here

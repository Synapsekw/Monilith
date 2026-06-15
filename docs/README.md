# Pulse — Documentation

Start here. This is the map of Pulse's documentation for contributors (human and AI). It does
not duplicate content — it points to the canonical home of each topic.

## The two-layer model

Pulse keeps documentation in two complementary places:

- **`docs/`** (this tree) — the **front door**: the product requirements (PRD), the master
  design spec, and per-phase specs/plans. Browsable on GitHub with standard Markdown links.
- **`vault/`** — a tracked **Obsidian dev-memory vault**: the north-star ("where are we"), live
  product/architecture/ops maps, the decision log (ADRs), and session notes. Uses Obsidian
  `[[wikilinks]]`; best viewed in Obsidian but readable as plain Markdown.

> **Rule of thumb:** _stable product & design intent_ lives in `docs/`; _live state, navigation,
> decisions, and working notes_ live in `vault/`. The [north-star](../vault/00-north-star.md) is
> the single "open this first" entry point for current status.

## Product & requirements

- **[Product Requirements (PRD)](prd.md)** — problem, personas, jobs-to-be-done, prioritized
  functional requirements, non-goals, success metrics, risks. _Product-lens, start here for "what
  and why."_
- [`vault/product.md`](../vault/product.md) — full product context: users, purpose, brand
  personality, anti-references, design principles.

## Design & architecture

- **[Master design spec](superpowers/specs/2026-06-14-pulse-design.md)** — the engineering
  source-of-truth. Product vision, tech stack, environment/MCP, feature set, data model & Supabase
  conventions, design system, phased build plan, engineering guardrails.
  - [§2 Tech stack](superpowers/specs/2026-06-14-pulse-design.md#2-tech-stack-decided)
  - [§5 Data model & Supabase conventions](superpowers/specs/2026-06-14-pulse-design.md#5-data-model--supabase-conventions)
  - [§6 Design system](superpowers/specs/2026-06-14-pulse-design.md#6-design-system)
  - [§8 Engineering guardrails](superpowers/specs/2026-06-14-pulse-design.md#8-engineering-guardrails)
- [`vault/moc/architecture.md`](../vault/moc/architecture.md) — architecture map: tech stack,
  current code layout, data model navigation.

## Roadmap & current state

- [Master spec §7 — Phased build plan](superpowers/specs/2026-06-14-pulse-design.md#7-phased-build-plan-commit--checkpoint-after-each)
  — the authoritative phase 0→9 plan.
- [`vault/moc/platform-roadmap.md`](../vault/moc/platform-roadmap.md) — roadmap map with the phase
  table and per-phase sessions.
- [`vault/00-north-star.md`](../vault/00-north-star.md) — **where we are right now**, the decision
  log, and entry points.

## Per-phase specs & plans

- [`docs/superpowers/specs/`](superpowers/specs/) — design specs (master + per-phase).
- [`docs/superpowers/plans/`](superpowers/plans/) — implementation plans derived from specs.

## How we build here

- [`AGENTS.md`](../AGENTS.md) — the working agreement (branch lifecycle, skills, tests mandatory).
  This is **NOT the Next.js you know** — read the framework docs in `node_modules/next/dist/docs/`
  before writing framework code.
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — full contributor workflow.
- [`SECURITY.md`](../SECURITY.md) — security policy.
- [`CHANGELOG.md`](../CHANGELOG.md) — release notes.

## Operations & decisions

- [`vault/moc/operations.md`](../vault/moc/operations.md) — runbooks: Supabase, MCP, deploy.
- [`vault/decisions/`](../vault/decisions/) — Architecture Decision Records (ADRs) and gotchas.
- [`vault/sessions/`](../vault/sessions/) — working-session notes.

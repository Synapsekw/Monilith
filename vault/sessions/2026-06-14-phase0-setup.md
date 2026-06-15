---
type: session
date: 2026-06-14-2000
branch: main
trigger: backfill
status: complete
tags: [session]
related: ["[[2026-06-14-gotcha-01-next16-not-next15]]"]
---

# Phase 0 — Setup

> Backfilled from git history + CHANGELOG when the vault was created (2026-06-15).

## What changed

- Scaffolded **Next.js 16.2.9** (App Router, RSC, TS strict, Tailwind v4, `src/` dir, `@/*` alias,
  Turbopack) + master spec checked in (`25c3e04`).
- Added the dependency stack (`c54bf1d`): Supabase (`supabase-js`, `ssr`), TanStack Query/Table/
  Virtual, Zod, react-hook-form, dnd-kit, Zustand, Framer Motion, Lucide, next-themes, cmdk; dev
  tooling Vitest + RTL, Playwright, Prettier, Husky, lint-staged, Supabase CLI. shadcn/ui
  (radix, neutral base, Lucide) + base components.
- Env templates + Supabase MCP config + Supabase CLI workspace (`9fd24f9`): `.env.local` (blank),
  `.env.example`, `.mcp.json` (read-only, placeholder ref), `supabase/`.
- Themed app shell + theming system + ⌘K palette + test tooling (`fea23fa`): monochromatic design
  system in `globals.css` (neutral surfaces, single configurable `--brand`/accent, status palette,
  light/dark, reduced-motion), sidebar + topbar shell, theme toggle (no flash), cmdk ⌘K stub,
  Zustand UI store, TanStack Query provider, Vitest config + smoke tests, Playwright home e2e.

## Why

Deliver the spec §7 phase-0 outcome: a themed empty app shell with dark/light toggle and a ⌘K stub,
on the full decided stack, with quality gates wired (Husky pre-commit, tests, e2e) so every later
phase ships behind them.

## Open threads

- 🧑 **Manual (Danijel):** create the Supabase project; paste URL/anon/service-role keys into
  `.env.local`; set the real `project_ref` in `.mcp.json`; `claude /mcp` → OAuth.
- Brief said Next 15; scaffold is Next 16 — kept 16. See [[2026-06-14-gotcha-01-next16-not-next15]].

## Next session entry point

Phase 1 — Auth & tenancy: Supabase Auth + org creation/membership + protected routes on top of the
RLS baseline. See [[2026-06-15-phase1-auth-tenancy]].

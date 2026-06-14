# Changelog

All notable changes to Pulse are documented here, grouped by build phase (see
`docs/superpowers/specs/2026-06-14-pulse-design.md` §7).

## Phase 0 — Setup (2026-06-14)

Themed empty app shell with dark/light toggle and ⌘K command-palette stub.

### Added

- Next.js 16.2.9 scaffold (App Router, RSC, TS strict, Tailwind v4, src dir, `@/*`
  alias, Turbopack). _Note: brief specified Next 15; approved to stay on current 16._
- Dependency stack (§2): Supabase (`supabase-js`, `ssr`), TanStack Query/Table/Virtual,
  Zod, react-hook-form, dnd-kit, Zustand, Framer Motion, Lucide, next-themes, cmdk;
  dev tooling Vitest + RTL, Playwright, Prettier, Husky, lint-staged, Supabase CLI.
- shadcn/ui (radix-nova, neutral base, Lucide) + base components.
- Monochromatic design system in `globals.css`: neutral surfaces, single configurable
  highlight (`--brand` → `--primary`/`--ring`), surface aliases, controlled status palette,
  light/dark themes, reduced-motion handling.
- App shell (sidebar + topbar), theme toggle (light/dark/system, no flash), ⌘K command
  palette stub (cmdk) with keyboard shortcut, Zustand UI store, TanStack Query provider.
- Env templates (`.env.local` blank, `.env.example`), Supabase MCP config (`.mcp.json`,
  read-only, placeholder ref), Supabase CLI workspace (`supabase/`).
- Tooling: Vitest config + setup, smoke tests (UI store, app shell), Playwright config +
  home e2e, Prettier config, Husky pre-commit running lint-staged.

### Pending (🧑 manual — Danijel)

- Create the Supabase project; paste URL/anon key/service-role key into `.env.local`.
- Set the real `project_ref` in `.mcp.json`, then `claude /mcp` → authenticate (OAuth).

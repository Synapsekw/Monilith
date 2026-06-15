# Changelog

All notable changes to Pulse are documented here, grouped by build phase (see
`docs/superpowers/specs/2026-06-14-pulse-design.md` §7).

## Phase 1 — Auth & tenancy (2026-06-15)

Email/password authentication and multi-tenant foundation: organizations,
workspaces, and Postgres RLS enforcing tenant isolation.

### Added

- Schema + RLS baseline (`supabase/migrations/…_init_auth_tenancy.sql`):
  `profiles`, `organizations`, `org_members` (with `org_role` enum), and
  `workspaces`, each with RLS enabled and default-deny. `SECURITY DEFINER`
  helper functions (`is_org_member`, `has_org_role`, `shares_org_with`,
  `auth_user_orgs`) back the policies and avoid recursive RLS lookups.
- `create_organization(p_name, p_slug)` RPC (`SECURITY DEFINER`) — atomically
  inserts an org and the caller's `owner` membership, sidestepping the RLS
  chicken-and-egg on first membership.
- `@supabase/ssr` clients: `@/lib/supabase/{client (browser/anon), server
(RSC/action), service (service-role, bypasses RLS)}`. `src/proxy.ts` (Next 16
  renames the `middleware` convention to `proxy`) refreshes the Supabase session
  on every request and redirects unauthenticated users to `/login`.
- Email/password auth: `/login` and `/signup` pages, `/auth/callback` route,
  and `@/app/auth/actions` server actions (`signIn`/`signUp`) with Zod-validated
  inputs via `@/components/auth/auth-form`.
- Onboarding: `@/components/onboarding/onboarding-form` + `@/app/onboarding/actions`
  create an organization and first workspace; authed app shell with sign-out.

### Tests

- RTL render tests for `AuthForm` (login/signup field coverage) and
  `OnboardingForm` (org + workspace fields).
- RLS tenant-isolation integration test (`src/lib/supabase/rls.integration.test.ts`):
  provisions two confirmed users, creates an org + workspace for each, and
  asserts each user reads only their own `organizations`, `org_members`, and
  `workspaces` rows. Loads `.env.local` via `dotenv` and `describe.skipIf`s when
  the service-role secret is absent, so the suite stays hermetic in CI.
- Rewrote the home e2e (`e2e/home.spec.ts`) for the auth flow: `/` redirects
  unauthenticated users to `/login`; `/login` and `/signup` render their forms.

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

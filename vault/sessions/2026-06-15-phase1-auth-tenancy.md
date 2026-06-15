---
type: session
date: 2026-06-15-0640
branch: main
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-06-14-gotcha-01-next16-not-next15]]"
  - "[[2026-06-14-gotcha-02-proxy-must-live-in-src]]"
---

# Phase 1 — Auth & tenancy (complete)

Built with subagent-driven development: one implementer subagent per task (clients → auth UI →
onboarding/shell → tests), each verified (typecheck/lint/test/build) before commit, with the
orchestrator reviewing and reconciling between tasks.

## What changed

- **Schema + RLS baseline** migrated via `supabase db push` (`d9fc02c`):
  `supabase/migrations/20260614174043_init_auth_tenancy.sql` — `profiles`, `organizations`,
  `org_members` (`org_role` enum), `workspaces`. RLS default-deny on all; `SECURITY DEFINER`
  helpers (`is_org_member`, `has_org_role`, `shares_org_with`, `auth_user_orgs`) keep policies
  from recursing; `create_organization(p_name, p_slug)` RPC inserts org + owner membership
  atomically. Types regenerated → `src/types/database.types.ts`; advisor-style SQL lint clean.
- **Supabase SSR clients** (`6bc1409`): `src/lib/supabase/{client,server,service}.ts`, env
  validation `src/lib/env.ts` (Zod). Session-refresh + route-protection in **`src/proxy.ts`**
  (moved from root, `6a3ef4b`) — see [[2026-06-14-gotcha-02-proxy-must-live-in-src]].
- **Email/password auth** (`255a40e`): `/login`, `/signup`, `/auth/callback`, server actions
  (`signIn`/`signUp`/`signOut`) with Zod, `AuthForm` via `useActionState`.
- **Onboarding + authed shell** (`6b665de`): create org + first workspace via the RPC, session
  wiring (`src/lib/auth/session.ts`: `requireUser`/`getUserOrgs`), route gating (unauth→/login,
  authed+no-org→/onboarding), user menu + sign-out.
- **Tests** (`31336e5`): RTL render tests (AuthForm, OnboardingForm); **RLS isolation
  integration test** that provisions two real users and proves each reads only their own
  org/members/workspaces (skips without service key); rewrote home e2e for the auth flow.
  Final: 32 unit tests pass, Playwright 3/3, build registers `ƒ Proxy (Middleware)`.

## Why

Tenancy + auth is the foundation the whole product sits on: RLS as the real security boundary,
org-scoped from day one, auth-aware clients and validated config before any feature touches the DB.

## Gotchas hit

- Next 16 renamed `middleware`→`proxy` AND it must live in `src/` (not repo root) with a `src/`
  dir, else it silently never runs. [[2026-06-14-gotcha-02-proxy-must-live-in-src]]
- ESLint flat config doesn't read `.gitignore` — the in-repo Obsidian vault's plugin JS broke
  `pnpm lint` until excluded in `eslint.config.mjs`.
- One subagent committed to a feature branch; reconciled by fast-forwarding `main`.

## Open threads

- MCP feature set lacks `debugging`, so `get_advisors` isn't available — used an equivalent SQL
  lint instead. Add `debugging` to `.mcp.json` features if the official advisor is wanted.
- Email confirmation: flow handles both on/off; confirm the dashboard setting for dev UX.

## Next session entry point

**Phase 2 — Boards core.** Workspaces→boards→groups→items hierarchy + EAV cell-values model;
Table view with the essential column types (Text/Status/People/Date/Numbers/Dropdown); inline
editing with optimistic updates; Supabase Realtime on items/cell_values. New migration → regen
types → advisor-lint. Reuse `is_org_member`/`has_org_role` for board RLS.

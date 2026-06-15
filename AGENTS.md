<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# Where things live

Pulse is a Next.js 16 (App Router) + Supabase multi-tenant "Work OS". Orientation map:

| Path                          | What's there                                                        |
| ----------------------------- | ------------------------------------------------------------------- |
| `src/app/`                    | Routes (RSC). `(auth)` group, `auth/`, `onboarding/`, `boards/`     |
| `src/components/`             | `ui/` (shadcn primitives) + feature folders (`boards/`, `auth/`, …) |
| `src/lib/`                    | `supabase/` (clients), `boards/`, `auth/`, `validations/` (Zod)     |
| `src/stores/`                 | Zustand client state                                                |
| `src/types/database.types.ts` | Generated Supabase types — **never hand-edit**                      |
| `supabase/migrations/`        | Versioned schema (source of truth for the DB)                       |
| `docs/`                       | `prd.md`, docs index (`README.md`), bundled `superpowers/`          |
| `vault/`                      | Dev-memory: `sessions/`, `decisions/` (ADRs), `00-north-star.md`    |

# Engineering invariants (the things agents get wrong)

`CONTRIBUTING.md` is the full reference — these are the non-negotiables to internalize up front:

- **Server Components by default.** Client components only when interactive; **Server Actions for
  all mutations**. This is Next.js 16 — confirm APIs against `node_modules/next/dist/docs/`.
- **Validate at boundaries with Zod.** TypeScript strict; avoid `any` (justify when unavoidable).
- **RLS is the security boundary** — default-deny, org-scoped, no cross-tenant access. Never trust
  the client. `SUPABASE_SERVICE_ROLE_KEY` is server-only and must never reach the browser.
- **Schema changes are versioned migrations** in `supabase/migrations/` (never dashboard
  click-ops). After a migration, regenerate types with `pnpm db:types` and commit them in the same
  PR — stale types are the main source of `any` creep.

# Dev memory

This repo keeps a tracked dev-memory vault. At the end of a working block, run `/wrapup` to log a
session note in `vault/sessions/` and bump `vault/00-north-star.md`. Record non-obvious traps as
ADRs in `vault/decisions/`.

# Working agreement (how to build in this repo)

These rules are mandatory for agents and humans. See `CONTRIBUTING.md` for the full workflow.

1. **Branch lifecycle.** Work on a `feat/…` or `chore/…` branch off `main`; open a PR; merge once
   CI is green. Branches are **deleted on merge** (GitHub auto-deletes them — never leave stale
   branches around). `main` is protected: no direct pushes.

2. **Use Superpowers skills for non-trivial work — but don't overthink trivial changes.** For
   anything beyond a simple/obvious edit (new features, components, behavior changes, debugging,
   multi-file work), leverage the relevant Superpowers skill (`brainstorming` before building,
   `test-driven-development`, `verification-before-completion`, `subagent-driven-development`,
   `systematic-debugging`, etc.). For a one-line fix, typo, or trivial tweak, just do it.

3. **UI work requires the design skills.** Before building or styling any UI, load the front-end
   design skills — the project `pulse-ui` skill (Pulse's monochromatic + single-accent system,
   tokens, app primitives) and the generic `frontend-design` skill. This is not optional for
   visual/component work.

4. **Tests are mandatory.** Every feature — at spec time and at build time — ships with tests that
   are **written and executed**. This is the Superpowers `test-driven-development` +
   `verification-before-completion` discipline: evidence before claims. A feature is not "done"
   until all of the following pass and behavior is verified:

   ```bash
   pnpm typecheck   # tsc --noEmit
   pnpm lint        # ESLint
   pnpm test        # Vitest
   pnpm build       # production build
   ```

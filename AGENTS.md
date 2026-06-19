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
- **In-page state must not refetch server data.** View toggles, tabs, filters, and sorts over data
  already loaded are **client state + the History API** (`window.history.pushState`/`replaceState`,
  which Next.js 16 syncs into `useSearchParams()` with no RSC re-run) — never a `<Link>`/`router`
  navigation, which re-runs the whole page (every query in it) on each interaction. Reserve RSC
  navigation / Server Actions for changes to server data. Hot-path list/board reads must be
  **bounded** (pagination/virtualization) over **indexed** filter columns — no unbounded `select *`
  on growing tables. See `vault/decisions/2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch.md`.

# Dev memory

This repo keeps a tracked dev-memory vault. At the end of a working block, run `/wrapup` to log a
session note in `vault/sessions/` and bump `vault/00-north-star.md`. Record non-obvious traps as
ADRs in `vault/decisions/`.

# Working agreement (how to build in this repo)

These rules are mandatory for agents and humans. See `CONTRIBUTING.md` for the full workflow.

1. **Two long-lived branches: `develop` (integration) and `main` (production).** All day-to-day
   work — features, fixes, debugging, every session — happens on **`develop`**. Do **not** create
   per-feature branches. Commit and push to `develop`; CI runs there. When `develop` is green and
   you're happy with it, **promote to `main`** (open a `develop → main` PR, merge once CI passes) —
   that, and only that, deploys production on Vercel. `develop` never deploys to production.

   - **One working directory, one branch.** A git branch belongs to the checkout, not to a
     terminal/agent — two sessions in the same folder share one branch and one set of files. So:
     **never `git checkout` to a different branch or `git stash`-and-switch in a shared checkout**
     (it clobbers other live sessions). All sessions simply stay on `develop`. If you genuinely
     need isolation for parallel work, use a **git worktree** (a separate folder per branch), not a
     branch switch in the shared checkout.
   - **Commit your own work only.** That same shared checkout may hold changes from other
     concurrent sessions, the editor, or tooling. **Stage explicitly by path** (`git add <paths>`)
     — never `git add -A` / `git add .` / `git commit -a`, which sweep in everything in the tree.
     Run `git status` first and confirm every staged path is yours; leave unrelated changes
     unstaged (don't `git stash` or revert them — that clobbers live work). Sweep in unrelated
     changes **only** when I explicitly ask. Full reference: `CONTRIBUTING.md` → "Commit hygiene".
   - `main` is protected: no direct pushes — it only advances via the promotion PR.

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

5. **Specs and plans state a performance & data-fetching budget.** When `brainstorming` or
   `writing-plans` (agent or human) designs any UI with **multiple views, tabs, filters, or sorts
   over the same data**, the spec/plan MUST answer: (a) what loads on **first paint** vs. each
   **interaction** — in-page toggles should be **0 new server round-trips**; (b) does the
   interaction change **server data** (yes → Server Action + targeted revalidation; no → client
   state + History API); (c) is the hot-path read **bounded** (pagination/virtualization) over
   **indexed** columns. A plan that can't answer these isn't ready to build. Rationale:
   `vault/decisions/2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch.md`.

6. **Plans and specs state a parallelization plan (execution DAG).** Every spec and plan for
   multi-task work MUST make concurrency explicit, not implicit. Concretely:

   - **Spec (`brainstorming`):** name the independent units — pieces with no shared state and no
     sequential dependency on each other — so the plan can schedule them concurrently.
   - **Plan (`writing-plans`):** the per-task `Interfaces: Consumes / Produces` blocks ARE a
     dependency edge list. The plan MUST add an **Execution DAG** section that synthesizes them
     into: (a) a dependency graph (Task N depends on Tasks …); (b) **parallel batches** — sets of
     tasks with no unmet dependency that can run at the same time, each batch a wave of concurrent
     agents; (c) the critical path (longest dependency chain = the real wall-clock floor).
   - **Execution:** when ≥2 tasks share a batch, dispatch them with
     `superpowers:dispatching-parallel-agents` (or parallel `subagent-driven-development`
     subagents), not one-at-a-time. Tasks that mutate files in parallel get isolated **git
     worktrees** (`superpowers:using-git-worktrees`) to avoid clobbering the shared `develop`
     checkout — see working agreement #1.

   A plan whose tasks are a flat sequential list with no DAG isn't ready to build. Rationale:
   `vault/decisions/2026-06-19-decision-21-plans-must-state-execution-dag.md`.

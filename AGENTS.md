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
- **Migrations are minted only via `scripts/new-migration.sh <slug>`** — never hand-invent a
  version stamp (hand-stamped hour-24/25 versions have shipped). Apply to DEV via the
  `supabase-dev` MCP with the **same version + name** as the committed file, verify the ledger
  (`list_migrations`), and run `scripts/reconcile-migration-version.sh` on any drift.
- **Reuse canonical modules — grep before writing a helper.** Server actions use `ActionResult` /
  `fail` imported from `src/lib/actions/result.ts`; typed RPC calls go through the helper in
  `src/lib/supabase/typed-rpc.ts`. Never re-declare these shapes locally — and in general, before
  writing any small helper, grep for an existing one first.
- **In-page state must not refetch server data; hot-path reads must be bounded over indexed
  columns** — the performance & data-fetching budget in working agreement #5 below is the
  canonical statement.

# Dev memory

This repo keeps a tracked dev-memory vault. At the end of a working block, run `/wrapup` to log a
session note in `vault/sessions/` and bump `vault/00-north-star.md`. Record non-obvious traps as
ADRs in `vault/decisions/`.

# Working agreement (how to build in this repo)

These rules are mandatory for agents and humans. See `CONTRIBUTING.md` for the full workflow.

1. **Two long-lived branches (`develop` = integration, `main` = production); every building
   session works in its own worktree on a temporary `task/<name>` branch.** The main checkout
   (`/Users/danijeljovanovic/Dev/Monolith`) stays parked on `develop` and is the **integration
   home** — you do not build directly in it. Each building session creates its own **git worktree**
   — a folder **nested at `.claude/worktrees/<name>`** (separate files on disk) — on a short-lived
   `task/<name>` branch cut from `develop`. This is what lets multiple parallel sessions build
   different things at once
   without stomping each other's files. When `develop` is green, **promote to `main`** (open a
   `develop → main` PR, merge once CI passes) — that, and only that, deploys production on Vercel.
   `develop` never deploys to production.

   - **One folder per session — use the helpers.** A git branch belongs to a _folder_, not a
     terminal/agent: two sessions in one folder share one branch and one set of files, so **never
     `git checkout` to another branch or `git stash`-and-switch in the main checkout** (it clobbers
     live sessions). Instead, start a building session with **`scripts/start-task.sh <name>`** (cuts
     `task/<name>` in a fresh worktree `.claude/worktrees/<name>` off the latest `origin/develop`
     and pins the commit identity), then `cd` into that folder and build there.
   - **The worktree is nested inside the project on purpose — so subagent-driven development works.**
     A worktree at `.claude/worktrees/<name>` is **inside** the primary working dir, hence inside the
     subagent sandbox, so dispatched subagents can read/write into it (a sibling `../Monolith-<name>`
     cannot — that was [[2026-06-21-gotcha-28-subagents-cant-write-outside-primary-dir]]). For a
     subagent-driven session, call **`EnterWorktree({ path: ".claude/worktrees/<name>" })`** to
     re-root the session into the worktree, so the orchestrator and all subagents operate on the one
     `task/<name>` branch with natural relative paths. **`start-task.sh` runs `pnpm install` in the
     worktree** (≈6s warm, hardlinked into pnpm's global store → cheap real disk) and symlinks
     `.env.local`. This is required, not optional: Node's _import_ resolution walks up to the main
     checkout's `node_modules`, but pnpm does **not** add an ancestor `node_modules/.bin` to a
     script's PATH — so without the install, bare `vitest`/`tsc`/`eslint`/`next` in `package.json`
     scripts fail with "command not found" and the gates can't run.
   - **Your worktree is an isolated snapshot — you see a frozen `develop`, not other sessions' work.**
     When you explore or learn the codebase, your search/read tools only see **this worktree's
     files**: `develop` as it was when the worktree was created, plus your own changes. You do **not**
     see the in-flight, unmerged work in other task worktrees — once you re-root into your own
     worktree (via `EnterWorktree`, recommended for subagent-driven work), it and its subagents are
     sandboxed to that folder. This is deliberate: reason about one
     coherent snapshot, never a mix of half-finished branches. The trade-off is you can be slightly
     **behind** (never ahead): if another task merges into `develop` mid-session and you need that
     just-landed code, run `git -C <main-checkout> fetch origin develop` then rebase your branch
     (`git rebase origin/develop`). Truly dependent work should run **after** its dependency merges,
     not in parallel — this is the execution-DAG thinking in rule #6.
   - **A task is NOT complete until it is merged into `develop` AND cleaned up.** "Done" =
     `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass → the `task/<name>` branch is
     **merged directly into `develop`**, pushed → **the worktree is removed and the branch deleted**.
     Run **`scripts/finish-task.sh`** from inside the worktree; it does all of this. **It now
     auto-integrates**: before gating it fetches and rebases your `task/<name>` onto the latest
     `develop` (so the gates run against the _merged_ state, not your branch in isolation), and uses
     `pull --rebase` so a diverged main checkout no longer breaks the finish. You do **not** hand-rebase
     anymore — the only time it stops is a real rebase conflict, where it aborts cleanly and tells you
     to resolve `git rebase develop` and re-run. An agent that leaves a `task/*` branch un-merged or a
     worktree lying around has **not finished its job and must say so explicitly** — never report a
     task as complete with the branch still open.
   - **After a successful merge, hand the user a "How to test this" walkthrough.** The very last
     step of closure — once `finish-task.sh` has merged to `develop` — is a **numbered, concrete
     manual-test guide for the user**: where to go (URL/page), what to click/enter, and the expected
     result at each step (mention any setup like "pull `develop`" / which env). Put it **both** in
     your closing message and in the `/wrapup` session note ("How to test" section). If the change
     is **not user-observable** (pure refactor, infra, internal lib), say so in one line instead
     ("No user-facing behavior to test — verified by the test suite"). This is the automated gate
     (`typecheck/lint/test/build`) **plus** a human acceptance path, not a replacement for it.
   - **Trivial edits are exempt.** A typo, one-liner, or other obviously-trivial change can go
     straight on `develop` in the main checkout — no worktree needed.
   - **Commit identity is pinned.** Every commit must be authored as
     **`Danijel Jovanovic <info@synapse-solutions.ai>`** — that email is verified on the
     **Synapsekw** GitHub account that Vercel deploys from. Committing under any other email (e.g.
     `danijel@…`) makes Vercel **silently skip the deploy**. `start-task.sh` re-asserts this in
     every worktree; do not override it.
   - **Commit your own work only.** **Stage explicitly by path** (`git add <paths>`) — never
     `git add -A` / `git add .` / `git commit -a`, which sweep in everything in the tree. Run
     `git status` first and confirm every staged path is yours. Sweep in unrelated changes **only**
     when I explicitly ask. Full reference: `CONTRIBUTING.md` → "Commit hygiene".
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
   state + the History API — `window.history.pushState`/`replaceState`, which Next.js 16 syncs
   into `useSearchParams()` with no RSC re-run — never a `<Link>`/`router` navigation, which
   re-runs every query in the page); (c) is the hot-path read **bounded**
   (pagination/virtualization) over **indexed** columns — no unbounded `select *` on growing
   tables. A plan that can't answer these isn't ready to build. Rationale:
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

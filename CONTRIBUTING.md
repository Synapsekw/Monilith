# Contributing to Monolith

Thanks for working on Monolith. This guide covers the conventions the project enforces.

## Prerequisites

- **Node** 24 (see `.nvmrc` — `nvm use`) and **pnpm** 10 (pinned via `packageManager`; `corepack enable`).
- Copy `.env.example` → `.env.local` and fill in Supabase keys (see `README` / `vault/moc/operations.md`).

## Setup

```bash
pnpm install        # also installs Husky git hooks
pnpm dev            # start the app
```

## Scripts

| Script                  | Purpose                                     |
| ----------------------- | ------------------------------------------- |
| `pnpm dev`              | Run the app (Turbopack)                     |
| `pnpm build`            | Production build                            |
| `pnpm typecheck`        | `tsc --noEmit`                              |
| `pnpm lint`             | ESLint                                      |
| `pnpm test`             | Vitest — unit + conformance + fixtures      |
| `pnpm test:conformance` | Live anon-reachability probes (see Testing) |
| `pnpm test:fixtures`    | Live cross-tenant isolation probes (DEV)    |
| `pnpm test:integration` | Opt-in live-DB suites (needs `.env.test`)   |
| `pnpm e2e`              | Playwright end-to-end tests                 |
| `pnpm format`           | Prettier write                              |

## Branching & promotion workflow

**The canonical statement of the rules is `AGENTS.md` → working agreement #1.** If this section
and `AGENTS.md` ever disagree, `AGENTS.md` wins. What follows is the day-to-day operational
detail.

Two long-lived branches:

- **`develop`** — the integration branch. Task branches merge here. CI
  (typecheck · lint · test · build) runs on every push. `develop` never deploys to production.
- **`main`** — production. Protected, **no direct pushes**. Vercel's production branch; it only
  advances via the `develop → main` promotion PR, and every merge to `main` deploys live.

**Every building session works in its own git worktree on a short-lived `task/<name>` branch.**
The main checkout (`/Users/danijeljovanovic/Dev/Monolith`) stays parked on `develop` as the
integration home — you do not build directly in it, and you never `git checkout` another branch
or `git stash`-and-switch there (multiple parallel sessions share it; switching clobbers live
work).

Day-to-day:

1. **Start:** run `scripts/start-task.sh <name>` from the main checkout. It cuts `task/<name>`
   from the latest `origin/develop` in a fresh worktree at `.claude/worktrees/<name>`, runs
   `pnpm install` there, symlinks `.env.local`, and pins the commit identity
   (`Danijel Jovanovic <info@synapse-solutions.ai>` — required for Vercel to deploy; do not
   override it). `cd` into the worktree and build there.
2. **Build:** commit in the worktree using **Conventional Commits** (enforced by a `commit-msg`
   hook), staging explicitly by path (see "Commit hygiene" below).
3. **Finish:** a task is **not done** until all four gates pass —
   `pnpm typecheck && pnpm lint && pnpm test && pnpm build` — and the branch is merged and
   cleaned up. Run `scripts/finish-task.sh` from inside the worktree: it rebases `task/<name>`
   onto the latest `develop`, runs the gates against the merged state, merges into `develop`,
   pushes, and removes the worktree + branch. A lingering `task/*` branch or worktree means the
   task is not finished.
4. **Promote:** when `develop` is green and you're happy with it, open a `develop → main` PR and
   merge once CI passes. That, and only that, ships production.

> **Trivial edits are exempt.** A typo, one-liner, or other obviously-trivial change can go
> straight on `develop` in the main checkout — no worktree needed.

## Commit hygiene (stage your own work only)

The working tree at any moment may hold changes you didn't make — in the shared main checkout
(other concurrent sessions, the editor, tooling like `.obsidian/*`), and even in a private
worktree (generated files, tooling artifacts). A commit must contain **only the work this
session actually did**.

- **Stage explicitly by path.** `git add <specific/paths>` for the files you created or changed.
  **Never** `git add -A`, `git add .`, `git add --all`, or `git commit -a` — they sweep in
  everything in the tree, including other sessions' work.
- **Inspect before you commit.** Run `git status` (and `git diff --staged`) and confirm every
  staged path is yours. If something you didn't touch is staged, unstage it (`git restore
--staged <path>`).
- **Leave unrelated changes alone.** Don't stage, `git stash`, `git checkout --`, or otherwise
  revert files another session may be editing — you'd clobber live work. Just don't include them.
- **Only exception:** the user **explicitly** asks you to include everything / commit unrelated
  changes. Absent that, your commit is scoped to your own edits.

## Commit messages (Conventional Commits)

```
type(optional-scope): short imperative summary
```

- **Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- **Scopes** (free-form): `auth`, `db`, `tenancy`, `boards`, `vault`, `ci`, …
- Enforced locally (Husky `commit-msg`) and on PRs (commitlint job). Config: `commitlint.config.mjs`.

### Changelog entries (`/updates`)

The public `/updates` page is generated from opt-in git trailers — no manual
list to maintain. To surface a change to users, add a trailer to that commit's
body:

```
Changelog: <kind> | <title> | <description>
```

- `kind` is one of `new`, `improved`, `fixed`.
- `title` is required; `description` is optional (`Changelog: new | Board automations` is valid).
- Use **user-facing** wording — no scopes, milestone codes (e.g. `(5b-1)`), or file names.
- The entry's date is the commit's author date.

After adding or changing a trailer, run `pnpm changelog:gen` and commit the
updated `src/lib/changelog/generated.ts`. CI (on develop) fails if it is stale.
Pre-convention history lives in `src/lib/changelog/seed.ts`.

## Code style

- TypeScript **strict**; avoid `any` (justify when unavoidable). Validate inputs with **Zod** at boundaries.
- **Server Components by default**; Client only when interactive; **Server Actions** for mutations.
- Prettier + ESLint run on staged files via `lint-staged` (Husky `pre-commit`).

## Database & RLS

- All schema changes are **versioned migrations** in `supabase/migrations/` (never dashboard click-ops).
- After a migration: regenerate `src/types/database.types.ts` with `pnpm db:types` (or the
  Supabase MCP `generate_typescript_types` tool) and review advisors. Commit the regenerated
  types in the same PR as the migration — stale types are the main source of `any` creep.
- **Verify the ledger against the files, in both directions**, with `pnpm db:ledger-check` (DEV;
  `--env prod` for production). The two directions are not equivalent:
  - a **committed file that is not applied** is the ordinary mid-task state — a warning, exit 0;
  - a **ledger row with no committed file** is drift, exit 2, and always a defect. `supabase db push`
    reads files, so that change can never reach production; it is lost. A `revoke`/`grant` on a
    `SECURITY DEFINER` function nearly shipped that way — see
    `vault/decisions/2026-07-25-gotcha-57-dev-applied-migration-with-no-committed-file.md`.

  `finish-task.sh` runs this automatically (blocking on drift, warning if the DB is unreachable), and
  `/sync-prod` + `/promote` run it before any production step. Fix drift by **backfilling the file at
  the ledger's version** — the one sanctioned exception to "never hand-write a version stamp",
  because the stamp is copied from the ledger, not invented. `reconcile-migration-version.sh` is the
  _other_ repair (a version label that drifted while the file exists — gotcha-55).

  The check shells out to `psql`, so it needs `psql` on `PATH` — or `PG_BIN` pointing at your
  PostgreSQL `bin/` in the main checkout's (gitignored) `.env.prod.local`; without either it exits 3
  and the drift is never checked. `PG_BIN` is one plain directory path, no trailing slash, quoted if
  it contains spaces. On Windows write the **MSYS form** (`PG_BIN="/c/Program Files/PostgreSQL/17/bin"`):
  the `scripts/sync-prod/*.sh` scripts run under Git Bash and use it verbatim, while this check
  converts it to `C:\…` and joins it onto `PATH` with the platform delimiter itself.

- **RLS is the security boundary**: default-deny, org-scoped, no cross-tenant access. Never trust the client.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only and must never reach the browser.

## Testing

Every feature ships with at least basic tests. Don't merge with failing checks. RLS-sensitive changes
should include an isolation test.

There are four vitest projects (`vitest.config.ts`). **`pnpm test` runs three of them** —
`unit`, `conformance` and `fixtures`. `integration` is **opt-in** (`pnpm test:integration`).

| Project       | Tier | Files                      | Needs                                | In `pnpm test`? |
| ------------- | ---- | -------------------------- | ------------------------------------ | --------------- |
| `unit`        | —    | `*.test.ts(x)`             | nothing                              | yes             |
| `integration` | 1    | `*.integration.test.ts(x)` | a dedicated test project (below)     | **no** — opt-in |
| `fixtures`    | 2    | `*.fixtures.test.ts`       | DEV URL + anon key + seeded fixtures | yes             |
| `conformance` | 3    | `*.conformance.test.ts`    | just a URL + anon key                | yes             |

**Why `integration` is not in the default run.** All 70 of those suites provision throwaway
`@example.com` users, so `integrationTargetReady()` demands a privileged key **and** a sacrificial
project. Decision-25 ruled that we will not provision one — so every suite reported "skipped" on
every run, which reads as coverage that does not exist. They are not deleted and the wiring is
untouched: create `.env.test` (below) and `pnpm test:integration` runs them exactly as before.
Tiers 2 and 3 are what actually gate the security boundary now.

### Tenant-isolation fixtures (`pnpm test:fixtures`)

**Tier 2 is the AUTHENTICATED half of the boundary that the conformance probes cover for `anon`:**
can one logged-in tenant reach another's rows? It asserts against **two permanent tenants** seeded
into DEV by `supabase/migrations/20260727094033_seed_tier2_tenant_fixtures.sql` and never mutated,
so isolation is a **read-only** assertion — sign in as one, ask for the other's rows, expect
nothing. It covers `organizations`, `org_members`, `workspaces`, `boards`, `groups`, `profiles`,
`ai_conversations` and `ai_messages`, including the two Ask Monolith Phase 2 `tool_trace` assertions.

Like the conformance probes, it needs **no test project**:

- **No privileged key, no provisioning, no teardown.** It signs in as two ordinary users with the
  publishable anon key. A unit test in `src/test/tenant-fixtures.test.ts` fails if the suite or its
  helper so much as names a privileged key or the GoTrue admin API.
- **Three assertions are write ATTEMPTS that RLS must refuse**, each followed by a re-read proving
  the fixture is unchanged. A refused write leaves nothing behind; one that landed is the emergency
  the tier exists to surface.
- **DEV only, no override.** `allowsTier2Fixtures()` (`src/lib/supabase/project-refs.ts`) is the
  deliberate inverse of the Tier-1 deny-list: DEV is denied to the destructive integration purge and
  is the only target Tier 2 may aim at. PROD must never grow a pair of known-password accounts, and
  an unknown ref has no fixtures — every assertion would pass vacuously. With no credentials it
  **skips cleanly**, so CI stays green.

Two details are load-bearing and must not be undone:

1. **`global-teardown.ts` exempts the fixture accounts by name.** They use the same `@example.com`
   domain as every throwaway user, so the age-based purge would delete them 30 minutes after seeding
   and cascade away their orgs — silently emptying the suite rather than failing it.
   `isPermanentFixtureEmail()` in `src/test/tenant-fixtures.ts` is the single source of truth.
2. **The anti-vacuity block is not decoration.** "Returned no rows" is only evidence if the rows
   exist and the owner CAN see them, so the suite asserts the corpus is present from each tenant's
   own side before asserting the other side sees nothing.

**Re-seeding a fresh DEV:** run `supabase/fixtures/tier2-fixture-users.dev-only.sql` (deliberately
_not_ in `migrations/`, so `supabase db push` can never carry it to production), then re-apply the
seed migration. The migration itself only attaches rows to accounts that already exist, so it is a
clean no-op anywhere those two are absent.

### Conformance probes (`pnpm test:conformance`)

**Conformance probes ask a LIVE Supabase project what a logged-out visitor can reach, and assert the
answer is "nothing".** They are the standing regression gate for the incident that
`supabase/migrations/20260725102610_definer_acl_lockdown.sql` fixed: 8 `SECURITY DEFINER` functions
were `anon`-executable in production, two of them able to delete rows from `vault.secrets`.

Two probe families, both self-maintaining — **a new function or table is covered automatically**:

- **Functions** — every `public` function is parsed out of `supabase/migrations/*.sql` and called as
  `anon` via `POST /rest/v1/rpc/<name>`. Only `42501` (permission denied) or `PGRST202` (PostgREST
  does not expose it to `anon` at all) count as denial. Anything else, above all a `200`, fails.
- **Tables** — every table name is read out of the generated `src/types/database.types.ts` and
  `select`-ed as `anon`. Only empty or denied passes; a returned row is a live data leak.

**They need no test project, unlike the integration suites.** That is the whole point:

- **Zero writes, zero provisioning.** Every probe is a read that is expected to be refused or empty.
- **No privileged key is ever loaded** — only the publishable anon key that already ships to every
  browser. A unit test in `src/test/anon-conformance.test.ts` fails if the suite so much as names
  one. That absence is what makes the probes safe to point at production.
- They therefore skip the integration gate in `src/test/integration-env.ts` (which demands a
  privileged key **and** a throwaway project) and never run the destructive `@example.com` teardown.

**Target:** by default whatever `.env.local` points at, i.e. **DEV**. There is no way to reach
production by accident. With no credentials at all (CI without secrets) the suite **skips cleanly**,
so CI stays green.

**Aiming at production** — what `/promote` and `/sync-prod` do, and safe to run by hand:

```bash
CONFORMANCE_TARGET_URL=https://<prod-ref>.supabase.co \
CONFORMANCE_TARGET_ANON_KEY=<prod anon/publishable key> \
  pnpm test:conformance
```

Both variables are required together; setting only one skips rather than quietly probing DEV. Each
run prints which target it hit and the verdict tally, e.g.:

```
[conformance] probing DEV (ambient) — 129 function signatures, 53 tables
[conformance] functions: 109 denied (42501), 20 not exposed (PGRST202), 0 REACHABLE — tables: 13 denied, 40 empty, 0 READABLE
```

If something genuinely must be reachable by a logged-out visitor, add it to
`ANON_REACHABLE_FUNCTION_ALLOWLIST` / `ANON_REACHABLE_TABLE_ALLOWLIST` in
`src/test/anon-conformance.ts` **with a comment saying why** — never by loosening an assertion. Both
are currently empty, and a test asserts that.

### Running integration tests (`.env.test`)

These are **opt-in** — `pnpm test:integration`, not `pnpm test`. The
`*.integration.test.ts(x)` suites and the `global-teardown` sweeper provision throwaway
`@example.com` users + orgs against a **real remote Supabase project** (there is no local stack).
They run against a **dedicated test-only project** via a gitignored `.env.test` file, and a hard
safety guard (`src/test/integration-env.ts`) ensures the destructive purge can **never** touch DEV
or PROD.

**Default behavior:** with **no `.env.test`**, every integration suite **skips cleanly** (`pnpm test`
runs unit tests only) and the teardown sweeper refuses to purge — so DEV is never polluted. Running
the integration suites is therefore **opt-in** and requires a one-time test-project setup:

1. **Create a dedicated Supabase project** (e.g. "Monolith TEST") in the dashboard. Note its project
   ref, URL, anon/publishable key, and service-role key.
2. **Apply the schema** — the migrations in `supabase/migrations/` are the source of truth:

   ```bash
   supabase link --project-ref <test-project-ref>
   supabase db push                                 # applies all migrations to the test project
   supabase link --project-ref <dev-project-ref>    # relink back to DEV afterwards
   ```

   Relinking back to DEV keeps `pnpm db:types` (`--linked`) pointed at DEV.

3. **Create `.env.test`** (gitignored) in the repo root with the **test** project's creds:

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<test-project-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<test anon/publishable key>
   SUPABASE_SERVICE_ROLE_KEY=<test service-role key>
   PULSE_TEST_DB=1
   ```

   `PULSE_TEST_DB=1` is the **required** opt-in marker the safety guard checks before any
   destructive purge. Without it, the suites skip and the teardown refuses to delete.

With `.env.test` present, `pnpm test:integration` exercises the integration suites against the test
project; the `@example.com` users appear there, not in DEV, and the teardown purges them there.
Note the teardown **never** purges the two permanent Tier-2 fixture accounts, wherever it runs.
`pnpm test` (and `finish-task.sh`'s gate) do **not** run these suites either way — that is the point
of `test:integration` being its own script. **CI stays unit-only** — wiring `.env.test` secrets into
GitHub Actions is a separate follow-up.

## Dev memory

At the end of a working block, run `/wrapup` to log a session note in `vault/sessions/` and bump
`vault/00-north-star.md`. Record non-obvious traps as ADRs in `vault/decisions/`.

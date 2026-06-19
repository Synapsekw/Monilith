# Contributing to Pulse

Thanks for working on Pulse. This guide covers the conventions the project enforces.

## Prerequisites

- **Node** 24 (see `.nvmrc` — `nvm use`) and **pnpm** 10 (pinned via `packageManager`; `corepack enable`).
- Copy `.env.example` → `.env.local` and fill in Supabase keys (see `README` / `vault/moc/operations.md`).

## Setup

```bash
pnpm install        # also installs Husky git hooks
pnpm dev            # start the app
```

## Scripts

| Script           | Purpose                       |
| ---------------- | ----------------------------- |
| `pnpm dev`       | Run the app (Turbopack)       |
| `pnpm build`     | Production build              |
| `pnpm typecheck` | `tsc --noEmit`                |
| `pnpm lint`      | ESLint                        |
| `pnpm test`      | Vitest unit/integration tests |
| `pnpm e2e`       | Playwright end-to-end tests   |
| `pnpm format`    | Prettier write                |

## Branching & promotion workflow

Two long-lived branches, **no per-feature branches**:

- **`develop`** — the integration branch. All day-to-day work (features, fixes, debugging, every
  session) is committed and pushed here. CI (typecheck · lint · test · build) runs on every push.
  `develop` never deploys to production.
- **`main`** — production. Protected, **no direct pushes**. Only Vercel's production branch; every
  merge to `main` deploys live.

Day-to-day:

1. Stay on `develop` (`git switch develop`). Don't create `feat/…` or `fix/…` branches.
2. Commit using **Conventional Commits** (enforced by a `commit-msg` hook) and push to `develop`.
3. When `develop` is green and you're happy with it, **promote**: open a `develop → main` PR and
   merge once CI passes. That, and only that, ships production.

> **One checkout = one branch.** A branch belongs to the working directory, not to a
> terminal/agent — two sessions in the same folder share one branch and one set of files. Never
> `git checkout` to another branch (or `git stash`-and-switch) in a shared checkout; it clobbers
> other live sessions. For genuinely parallel, isolated work use a **git worktree** (a separate
> folder per branch), not a branch switch.

## Commit hygiene (stage your own work only)

Because every session shares one `develop` checkout (above), the working tree at any moment may
hold changes from **other concurrent sessions, the editor, or tooling** (e.g. `.obsidian/*`,
generated files). A commit must contain **only the work this session actually did**.

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
- **RLS is the security boundary**: default-deny, org-scoped, no cross-tenant access. Never trust the client.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only and must never reach the browser.

## Testing

Every feature ships with at least basic tests. Don't merge with failing checks. RLS-sensitive changes
should include an isolation test.

## Dev memory

At the end of a working block, run `/wrapup` to log a session note in `vault/sessions/` and bump
`vault/00-north-star.md`. Record non-obvious traps as ADRs in `vault/decisions/`.

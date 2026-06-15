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

## Branching & PR workflow

`main` is protected — **no direct pushes**. All changes go through a PR:

1. Branch from `main`: `git switch -c feat/<short-slug>`.
2. Commit using **Conventional Commits** (enforced by a `commit-msg` hook).
3. Open a PR; fill in the template. CI (`typecheck · lint · test · build` + commit lint) must be green.
4. Squash/merge once checks pass.

## Commit messages (Conventional Commits)

```
type(optional-scope): short imperative summary
```

- **Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- **Scopes** (free-form): `auth`, `db`, `tenancy`, `boards`, `vault`, `ci`, …
- Enforced locally (Husky `commit-msg`) and on PRs (commitlint job). Config: `commitlint.config.mjs`.

## Code style

- TypeScript **strict**; avoid `any` (justify when unavoidable). Validate inputs with **Zod** at boundaries.
- **Server Components by default**; Client only when interactive; **Server Actions** for mutations.
- Prettier + ESLint run on staged files via `lint-staged` (Husky `pre-commit`).

## Database & RLS

- All schema changes are **versioned migrations** in `supabase/migrations/` (never dashboard click-ops).
- After a migration: regenerate `src/types/database.types.ts` and review advisors.
- **RLS is the security boundary**: default-deny, org-scoped, no cross-tenant access. Never trust the client.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only and must never reach the browser.

## Testing

Every feature ships with at least basic tests. Don't merge with failing checks. RLS-sensitive changes
should include an isolation test.

## Dev memory

At the end of a working block, run `/wrapup` to log a session note in `vault/sessions/` and bump
`vault/00-north-star.md`. Record non-obvious traps as ADRs in `vault/decisions/`.

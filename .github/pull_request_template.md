<!-- Title must follow Conventional Commits, e.g. `feat(boards): add group reordering`. -->

## Summary

<!-- What does this PR do and why? Link the phase/spec or issue. -->

## Type of change

- [ ] feat — new feature
- [ ] fix — bug fix
- [ ] refactor / perf / style
- [ ] docs / chore / ci
- [ ] test

## How it was tested

<!-- Commands run + what you verified. -->

- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] Manual / e2e (describe)

## Database / RLS (if applicable)

- [ ] Schema change is a versioned migration in `supabase/migrations/`
- [ ] Types regenerated (`src/types/database.types.ts`)
- [ ] RLS reviewed (default-deny, org-scoped, no cross-tenant access)

## Checklist

- [ ] Conventional Commit messages
- [ ] No secrets committed (`.env.local` stays local)
- [ ] Docs / `CHANGELOG.md` / dev-memory `vault/` updated where relevant

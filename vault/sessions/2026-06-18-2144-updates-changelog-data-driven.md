---
type: session
date: 2026-06-18-2144
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-06-18-1946-public-updates-page-landing-note]]"
---

# Data-driven /updates changelog (from git trailers)

## What changed

- **Diagnosed the "/updates shows no latest updates" report** (systematic-debugging): the render pipeline (sort → group → format) is correct; root cause is two-fold — the `CHANGELOG` is a **hand-curated array** (3 entries, untouched since its initial commit) and the whole `/updates` feature **lives only on `develop`** (only `main` deploys, so production reflects none of it).
- **Brainstorm → spec → plan → subagent build** to make it data-driven. Spec `docs/superpowers/specs/2026-06-18-data-driven-changelog-design.md`, plan `docs/superpowers/plans/2026-06-18-data-driven-changelog.md` (`01513af`, `c1eebe6`).
- **Implemented Tasks 1–5** (`da5c255..673f810`, 6 commits, changelog-scope only): pure `parseChangelogTrailers` + exported `RECORD_SEP/FIELD_SEP/VALUE_SEP` (format contract) + Zod kind/date validation + `parse.test.ts`; frozen 5-entry `seed.ts`; committed empty `generated.ts`; `tsx` generator `scripts/generate-changelog.ts` + `changelog:gen` (derives git `%xNN` escapes from the shared separators, writes + prettifies); `entries.ts` → `CHANGELOG = [...SEED, ...GENERATED]`.
- **Two-stage review of the 6 commits:** spec compliance ✅ + code quality **approved** (3 minor, non-blocking notes). 12 changelog tests pass; generator runs with zero drift.

## Why

The `/updates` page silently goes stale because it's a manual list nobody remembers to edit. Sourcing it from opt-in `Changelog:` commit trailers makes "what shipped" self-maintaining. The design hinges on one constraint: **`main` is squashed**, so per-commit trailers never reach production — hence a **committed `generated.ts` artifact** (guarded by a develop-scoped CI drift check, mirroring the Supabase type-drift guard) rather than a build-time `git log`.

## Open threads

- **Tasks 6 + 7 not done:** develop-scoped `changelog` drift-guard job in `ci.yml` (`fetch-depth: 0`) + `Changelog:` trailer docs in `CONTRIBUTING.md` (Task 6); changelog-scoped verification gate (Task 7).
- **Parser hardening (code-review note #1):** a description containing a literal `|` is truncated — small `rest.join("|")` fix + test pending before completion.
- **`develop` global typecheck is RED** from the **concurrent 5b-2 automations session** (`AutomationsDialog.tsx` `date_reached` union narrowing) — not this work; our changelog scope is green. User chose to scope the gate to changelog.
- **Shared-checkout caution:** the Task-4 probe ran `git reset --hard HEAD~1` while the concurrent session had uncommitted files; no visible lasting damage (untracked files survived; their work is now committed), but reset/stash in a shared checkout is risky — cf. [[2026-06-17-2155-gotcha-15-subagent-scope-overstep-shared-checkout]].
- Feature still only on `develop`; nothing pushed.

## Next session entry point

Finish Task 6 (CI drift guard + CONTRIBUTING trailer docs) and Task 7 (run `pnpm test src/lib/changelog`, lint, build — changelog scope), apply the `|`-in-description parser fix, then the data-driven changelog is complete on `develop`. Global `pnpm typecheck` will stay red until the concurrent 5b-2 `AutomationsDialog` narrowing lands.

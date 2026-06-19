# Data-driven changelog (`/updates`) — design

**Date:** 2026-06-18
**Status:** Approved (brainstorming) — pending implementation plan
**Author:** Danijel Jovanovic + Claude

## Problem

The public `/updates` page renders a hand-curated array (`CHANGELOG` in
`src/lib/changelog/entries.ts`). The render pipeline (sort → group → format →
display) is correct, but the page shows stale content for two reasons:

1. **Manual curation drifts.** The array has only 3 entries and was last touched
   in its initial commit. Recently shipped work (automations, landing, etc.) was
   never added because nothing forces it.
2. **Feature lives only on `develop`.** The `/updates` feature has not been
   promoted to `main`, and only `main` deploys to production — so production
   reflects none of it. (Out of scope here; resolved by the normal promotion.)

This spec addresses (1): make the changelog **data-driven so it never silently
goes stale**, sourced from git commits.

## Key constraint: `main` is squashed

The `develop → main` promotion **squashes** (promotion `#16` is a single-parent
commit; its body states "Full granular history on develop"; `origin/main` is a
linear history of one squash commit per PR). Therefore **per-commit trailers
never reach `main`**, and reading `git log` at production build time would see
only squash commits. The generated data must be a **committed artifact** that
rides to `main` via promotion, not regenerated at production build.

## Approach

Commits opt into the changelog via a git **trailer**. A generator parses these
trailers from `git log`, merges them with a frozen seed of pre-convention
history, and writes a committed TypeScript file the page imports. A CI drift
guard keeps the committed file honest.

### 1. Trailer convention

Commits opt in with a trailer in the commit **body** (compatible with the
repo's commitlint, which gates the header, not the body):

```
Changelog: <kind> | <title> | <description>
```

- `kind` ∈ `new | improved | fixed`.
- `title` — required, short, user-facing.
- `description` — optional. `Changelog: new | Board automations` is valid.
- Entry **date** = commit author date via `git log --date=short` (`YYYY-MM-DD`).
- Multiple `Changelog:` trailers in one commit are allowed (each → one entry),
  though one per commit is the norm.
- **Parser contract:** the generator invokes `git log` with a fixed
  machine-readable `--format` that emits, per commit, the short author date plus
  that commit's body/trailers separated by an unambiguous record/field delimiter
  (e.g. NUL or a sentinel line). `parseChangelogTrailers` parses exactly that
  format, so each emitted entry's date is the date of the commit the trailer came
  from. The format string is the contract shared between generator and parser
  and is fixed in the implementation plan.
- **Malformed trailers are skipped with a `console.warn`, not fatal.** A typo in
  already-merged history must never wedge CI. The exact format is documented in
  `CONTRIBUTING.md` so authors get it right up front.

Wording rule (carried from the current changelog): user-facing only — no
internal jargon, scopes, milestone codes (e.g. `(5b-1)`), or file names.

### 2. Components

Each unit has one purpose, a clear interface, and is testable in isolation.

| Unit      | Path                             | Purpose                                                                                                                              | Depends on        |
| --------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| Seed      | `src/lib/changelog/seed.ts`      | Frozen `ChangelogEntry[]` for pre-convention history. Hand-edited rarely.                                                            | `types.ts`        |
| Parser    | `src/lib/changelog/parse.ts`     | **Pure** `parseChangelogTrailers(gitLog: string): ChangelogEntry[]`. Zod-validated. No git, no I/O.                                  | `types.ts`, `zod` |
| Generator | `scripts/generate-changelog.mjs` | Thin wrapper: runs `git log`, pipes raw output to the pure parser, writes `generated.ts` (prettier-formatted, mirroring `db:types`). | `parse.ts`, git   |
| Generated | `src/lib/changelog/generated.ts` | `export const GENERATED: ChangelogEntry[] = [...]`. **Committed**, never hand-edited.                                                | `types.ts`        |
| Entries   | `src/lib/changelog/entries.ts`   | `CHANGELOG = [...SEED, ...GENERATED]`. `groupByDate`/`formatDate` unchanged.                                                         | seed, generated   |

The page (`src/app/updates/page.tsx`), `ChangelogTimeline`,
`ChangelogDateGroup`, and `ChangelogItemBadge` are **unchanged** — only the
_source_ of `CHANGELOG` changes. Seed and generated never overlap by
construction (seed = pre-convention, generated = post-convention trailers), so
no dedup is needed; `groupByDate` merges them by date.

### 3. Data flow

```
commit w/ Changelog: trailer
        │  (author authors clean, user-facing trailer)
        ▼
pnpm changelog:gen ── git log --date=short ──▶ parseChangelogTrailers()
        │                                              │ (Zod validate, skip malformed)
        ▼                                              ▼
src/lib/changelog/generated.ts  ◀── prettier ──  ChangelogEntry[]
        │  (committed to develop)
        ▼
develop → main promotion (squash carries the committed file)
        ▼
production build imports generated.ts (NO git access)  ──▶  /updates (static)
```

### 4. Freshness guarantee (anti-stale mechanism)

- `package.json` script `changelog:gen` regenerates + formats the committed file
  (pattern mirrors `db:types`).
- **New CI job `changelog`** in `.github/workflows/ci.yml`, with its own checkout
  at `fetch-depth: 0` (the `verify` job is a shallow checkout and cannot see full
  history; `commitlint` already uses `fetch-depth: 0` — same pattern). The job:
  1. installs deps,
  2. runs `pnpm changelog:gen`,
  3. `git diff --exit-code src/lib/changelog/generated.ts` — **fails if stale.**

  **Scoped to develop only** (`if: github.ref == 'refs/heads/develop' ||
github.base_ref == 'develop'`). On `main` the squashed history contains no
  trailers, so regenerating there would emit an empty `generated.ts` and the diff
  check would falsely fail against the committed artifact that rode in from
  develop. On `main`, `generated.ts` is simply consumed as committed.

  This directly mirrors the repo's Supabase type-drift guard intent: a generated
  artifact that CI refuses to let drift.

- Authoring stays zero-extra-step at write time (just add the trailer); the
  committed file is regenerated by the author/`changelog:gen` and guarded by CI.
  No husky/pre-commit hook (keeps commits fast).

### 5. Performance & data-fetching budget (AGENTS.md rule 5)

- The `/updates` page remains **fully static (SSG)**.
- **First paint:** prerendered HTML. **Per interaction:** none — no views, tabs,
  filters, or sorts over server data.
- **Runtime server round-trips: 0. Client fetches: 0.** All "data fetching"
  happens at generation/build time via `git log`, never at request time.
- Read is trivially bounded (small repo history; static output). No DB, no RLS
  surface, no growing-table hot path.

### 6. Seeded content (initial `seed.ts`)

Existing 3 entries, plus two recent user-facing wins (approved defaults):

- `2026-06-18` · `new` · Board automations — _Set up rules that react to changes
  on your board — a guided builder with ready-made recipes._
- `2026-06-10` · `improved` · Faster board loads — _Large boards open noticeably
  quicker._
- `2026-06-02` · `new` · Command palette — _Press ⌘K to jump anywhere and run
  actions without the mouse._
- New landing page / hero (date + final copy to confirm at build).
- Interactive boards table (inline edit, realtime) (date + final copy to confirm
  at build).

Exact dates/wording for the two backfilled items are finalized during
implementation; they are user-facing summaries, not commit subjects.

## Testing

- **Unit — `parse.ts`** (pure, no git): no description; bad/unknown `kind`;
  multiple trailers in one commit; blank/whitespace fields; `|` or unicode in
  title; trailer absent → empty; malformed → skipped + warned (not thrown).
- **Unit — `entries.ts`**: `groupByDate` correctly merges and orders
  seed + generated by date (newest first), preserving authored order within a
  date.
- Existing `verify` gates apply: `pnpm typecheck && pnpm lint && pnpm test &&
pnpm build`.

## Out of scope

- Promoting the `/updates` feature to `main` (normal promotion workflow).
- Any DB-backed or admin-authored changelog.
- Rewriting history to backfill trailers onto past commits (shared-branch
  history is not rewritten; pre-convention history is covered by the seed).

## Files touched

- **New:** `src/lib/changelog/seed.ts`, `src/lib/changelog/parse.ts`,
  `src/lib/changelog/generated.ts`, `scripts/generate-changelog.mjs`,
  `src/lib/changelog/parse.test.ts` (+ entries test).
- **Edited:** `src/lib/changelog/entries.ts` (compose `CHANGELOG`),
  `package.json` (`changelog:gen` script), `.github/workflows/ci.yml`
  (`changelog` drift-guard job), `CONTRIBUTING.md` (trailer convention).

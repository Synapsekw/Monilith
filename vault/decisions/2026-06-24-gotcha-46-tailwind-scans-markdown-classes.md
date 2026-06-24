---
type: adr
date: 2026-06-24
status: accepted
tags: [decision, gotcha, tailwind, build, docs]
related:
  - "[[2026-06-24-2112-percent-color-and-group-rollup]]"
---

# Gotcha 46: Tailwind v4 scans committed .md docs — placeholder classes break the build

## Context

While building the percent-column colorization, the spec and plan (`docs/superpowers/specs|plans/…md`)
were committed to `develop` with **placeholder** arbitrary-value classes written in prose, e.g.
`` `bg-[var(--progress-…)]` `` (ellipsis) and `` `bg-[var(--progress-*)]` ``. The main-checkout dev
server then threw `Parsing CSS source code failed … Unexpected token Delim('*')`, with a generated
rule `.bg-[var(--progress-*)] { background-color: var(--progress-*) }`.

Root cause: **Tailwind v4 automatic content detection scans every non-gitignored file — including
`.md`/`.mdx`** (it only excludes `.gitignore`d paths, `node_modules`, binaries, CSS, lockfiles). A
class-shaped string in a doc becomes a real utility. Valid concrete classes (`bg-[var(--progress-red)]`)
compile to a valid rule and are harmless; an invalid placeholder (`*`, `…`) compiles to invalid CSS and
breaks `pnpm dev`/`build` wherever those docs are scanned.

## Decision / what to do

- **Never put placeholder/wildcard arbitrary-value classes in committed docs.** Describe them in prose
  (e.g. `` `var(--progress-<band>)`-backed utility ``) or show only valid concrete classes.
- The `.superpowers/` SDD scratch (briefs/ledger) is gitignored, so it's safe to scan-skip — but its
  content must not be promoted verbatim into `docs/`.
- Symptom-to-cause shortcut next time: a CSS parse error naming a token that only exists in a doc =
  this. Mojibake note: the build-error pipeline transcoded the `…` ellipsis to `*`, so the reported
  char may not be the literal in the file.

## Rationale

The plan/spec docs legitimately need to show the exact class strings the code uses; the trap is only
the _non-valid_ placeholder forms. Keeping concrete examples valid and placeholders non-class-shaped
gets both: useful docs and a build that can't be broken by prose.

## Consequences

- Positive: `develop` build restored (`a54b582`); the convention costs nothing.
- Watch: any future doc with a `bg-[…]`/arbitrary-value example that isn't a _valid_ class can re-break
  the build. A repo-wide hardening (Tailwind `@source not "docs"` / exclude `*.md`) would prevent the
  whole class of bug but is a separate, broader change — not done here.

## Related

- [[2026-06-24-2112-percent-color-and-group-rollup]]

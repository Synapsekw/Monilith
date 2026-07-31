---
type: adr
status: accepted
date: 2026-07-31
tags: [project/monolith, adr, gotcha, changelog, ci, process]
related:
  - "[[2026-07-31-1559-changelog-backfill-updates-page]]"
---

# Gotcha 64 — The changelog drift check cannot see a trailer that was never written

## Context

`/updates` is generated from `Changelog:` commit trailers, and CI enforces it:

```yaml
- run: pnpm changelog:gen
- run: git diff --exit-code src/lib/changelog/generated.ts
```

That reads as "the changelog is enforced". It is not. The check proves `generated.ts` **matches**
git history — it is a _consistency_ check, not a _coverage_ check. A commit that ships a feature
and writes no trailer produces no diff, so the gate is green precisely when the changelog is
wrong. The failure mode is silent by construction, and its likelihood scales with how well the
rest of the process works: the more branches that merge cleanly, the more shipped features slip by.

Discovered 2026-07-31, when `/updates` was found to have gone **ten days and two promotions**
(#72, #73) without a single entry — 19 user-facing changes, including the Claude connector, the
Settings redesign and self-serve account deletion.

The gap was **self-evidencing and still nobody saw it**. Two entries published on 07-27 —
"Read a whole board over MCP in one call" and "Consent screen and MCP setup say Monolith" — both
describe refinements to a connector whose own announcement had never been written. The changelog
was internally contradictory on its face: it improved a feature it had never shipped.

## Decision

Treat the drift check as necessary but **not** sufficient, and put the coverage question where a
human already looks: **the promotion PR**. Before `develop → main`, diff the shipped range against
the trailers in it —

```bash
git log --format='%h %s%n%(trailers:key=Changelog,valueonly)' main..develop
```

— and ask of every `feat`/`fix` with a user-visible surface: _is it in there?_ Backfill with a
dated announcement commit (see below) before promoting, not after.

## Rationale

Fixing this at commit time is the obvious move and the wrong one. A `commit-msg` hook demanding a
trailer on every `feat`/`fix` cannot tell a user-facing change from an internal one — the answer
lives in intent, not in the diff — so it would fire constantly on refactors, tests and infra, and
be reflexively skipped. A gate that is usually wrong trains people to bypass it.

Promotion is the right seam because it is where "what did we ship" is _already_ the question being
asked, on a batch large enough to be worth reviewing and small enough to still remember.

**Backfilling is cheap and lossless, which is what makes the deferred check acceptable.** A
`Changelog:` trailer is not required to ride the commit that implemented the feature — an empty
commit carrying only trailers regenerates identically. Backdating its **author** date
(`git commit --allow-empty --date=<ship-date>`) puts the entry in the right `groupByDate` bucket,
so a changelog reconstructed weeks later is indistinguishable from one written as it shipped.
This differs from the precedent (`1c16f31`, `64595fd`), which dated announcements at write time —
fine for same-day batches, wrong across a ten-day gap.

## Consequences

- Positive: no new hook, no false positives, and the check runs on the batch a human is already
  reviewing. Backdating keeps the public page honest regardless of when anyone notices.
- Negative: still a manual step, so still forgettable — it moves the failure from invisible to
  merely deferred. A `main..develop` coverage report in the promotion workflow would close it
  properly.
- Open follow-up: `/promote` should print the trailer-vs-commit diff above, so the question is
  asked automatically instead of remembered.
- Watch for: entries that go live **before the feature works**. This backfill announced E5
  semantic search while `item_embeddings` is still empty on prod — backfilled entries publish on
  the next promotion whether or not their feature is provisioned.

## Related

- [[2026-07-31-1559-changelog-backfill-updates-page]]
- `CONTRIBUTING.md` → "Changelog entries (`/updates`)"

---
type: adr
date: 2026-08-06
status: accepted
tags: [decision, gotcha, testing, indexeddb]
related: ["[[2026-08-06-1423-offline-boards-work-end-to-end]]"]
---

# Gotcha 79 — a test probe can manufacture the bug it is hunting

## Context

`e2e/offline.spec.ts` had to wait until a board snapshot was genuinely in IndexedDB before cutting
the network. Its helper opened idb-keyval's `keyval-store` and, if `onupgradeneeded` fired, aborted
the version-change transaction — documented in a long comment as making the probe "observe state,
never create it", with a claim that an earlier unguarded version had been measured winning the race.

The offline feature was then failing with two symptoms: sometimes a `ChunkLoadError`, sometimes
`/offline` reporting a just-cached board as never visited.

## Decision

Never let a test probe open a database that does not already exist. Use `indexedDB.databases()` —
which reports existence with no connection at all — and only open once the application itself has
created the store, at which point `onupgradeneeded` cannot fire for the probe.

Before trusting any measurement from an instrument that touches the system under test, run a
**control with the instrument removed entirely**.

## Rationale

Aborting a version-change transaction that was *creating* the database does not leave the database
untouched — it rolls it back to version 0, destroying the object store and everything in it. The
probe was not observing the second symptom, it was **causing** it.

Measured directly: `indexedDB.databases()` reported `keyval-store` **absent** immediately after the
probe had just confirmed the snapshot present, and the offline route then reported the board as
never visited. The abort had been reasoned about carefully and documented confidently, and was
still wrong.

The control run is what separated instrument from product: with all probing removed, the snapshot
was *still* absent — proving a genuine second defect underneath
(`persistQueryClientSubscribe` performs no initial save). Had the control not been run, the real bug
would have been "fixed" by changing the test.

## Consequences

- Positive: the E2E helper is now non-destructive; the two symptoms were separated and both fixed.
- Positive: generalises past IndexedDB — any probe that opens, locks, seeds or migrates shared state
  is a participant in the system, not a neutral observer.
- Negative: `indexedDB.databases()` is not available in every engine; acceptable here because
  `playwright.config.ts` declares only a `chromium` project.
- Open follow-up: the same discipline is not yet applied to other suites that touch browser storage.

## Related

- [[2026-08-06-1423-offline-boards-work-end-to-end]]
- [[2026-08-03-gotcha-72-a-global-regex-with-test-makes-a-guard-silently-blind]] — the same shape:
  a guard that looks rigorous while silently not measuring what it claims.

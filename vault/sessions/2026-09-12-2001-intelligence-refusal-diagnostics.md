---
type: session
date: 2026-09-12-2001
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-09-12-0820-intelligence-latency-effort-fix]]"
  - "[[2026-09-12-gotcha-104-an-adapter-routed-feature-silently-inherits-adaptive-thinking]]"
  - "[[2026-09-12-1957-name-rule-width-and-promote-123]]"
---

# Board Intelligence: the refusal log learns to talk

## What changed

- **The latency fix is MEASURED, by the owner, on a real run**: 5284 → **1334 output tokens**, ~120s
  → **21s**, and the stored payload got *bigger* (2614 → 3046 chars). Caveat kept honest: different
  boards, so not a strict A/B — but useful output rose while billed output fell three quarters.
- That run fired `[intelligence] dropped suggestions`, and the log could not say why. Merged
  `8f0f5160` (2 commits): `toActionParse` returns a reason — **17 constant strings**, one per failing
  check — with `toAction` kept as the null-returning wrapper `apply-core` and ~20 tests already use.
  "Missing" and "invented" are separate reasons: a null `optionId` is a structured-output failure, a
  wrong one is a grounding failure, and they call for opposite fixes.
- The run log now carries `model`, `tokensOut`, `kept`, `proposed` — a drop rate is meaningless
  without its denominator.
- Both shipped to production in **PR #123**, promoted by a parallel session.
- Nothing announced on `/updates`: this is a server log, invisible to users.

## Why

Latency was the owner's one standing complaint, and the effort fix answered it. But the first real
run traded a known problem for an unreadable one — `dropped 1 invalid action(s)` cannot distinguish a
hallucinated item id from a column of the wrong kind, which is exactly the distinction that decides
whether to lower effort further or fix the prompt. A measurement you cannot interpret is not a
measurement.

## How to test

No user-facing behaviour — the change is a server log. Verified by the suite (7639 tests).
The *diagnostic* is exercised by reading it: on `develop`, edit a cell and set it back (the Refresh
control needs a 30-minute-old run, so this is how to force a fresh one), click "Catch me up", and
read the warning block in the dev terminal. Reasons naming `itemId is not on this board` would
indict `effort: "low"`; `columnId is not a … column` is a prompt problem and lowering effort further
would be the wrong fix.

## Open threads

- **The `low` vs `medium` A/B on one board was never run** — that was the point of the diagnostics
  and it is the next cheap thing. This board has two date columns (`Start`/`Finish`) and two status
  columns (`Wave`/`Status`), the exact shape that produces column-kind confusion.
- **Two of my own guard tests were vacuous, caught by review, one after the other.** A coverage test
  asserting `size === 17` against a hardcoded 17 while never referencing the union it claimed to
  cover; and an "agrees with `toAction`" test that was a tautology over the shared code path. Fixed
  by keying the case table on `ActionRejection` (exhaustive at compile time — verified by injecting a
  probe member and watching tsc fail). **The lesson is the shape, not the instance: a test whose
  assertion never names the thing it guards cannot guard it.** Candidate for its own ADR.
- The review also found the log lying twice over: denominators taken *after* `cappedArray` truncated
  (so a model proposing 9 suggestions logged 5, and a clean-looking run hid four dropped cards), and
  `dropped 0 of 3` printed while one of three had in fact been dropped. Both fixed; both were
  invisible to every gate.
- Still open from before: `requestShapeFor` is wrong about five active models (gotcha-104), and six
  other `toRequestArgs` callers run at effort `"high"` unmeasured.

## Next session entry point

Run the `low` vs `medium` comparison on board `81612541-…` and read the reasons — the tooling for it
is now in production. Then Phase 3 (Act) from spec §5.

---
type: adr
date: 2026-08-25
status: accepted
tags: [decision, gotcha, process, planning]
related:
  - "[[2026-08-25-1932-agent-reference-documents-spec-2b]]"
  - "[[2026-06-19-decision-21-plans-must-state-execution-dag]]"
---

# gotcha-94 — a plan is right about intent and wrong about signatures

## Context

Spec 2b's implementation plan was written the careful way: read the real modules first, quote real
file:line references, verify claims against the live catalog rather than recalling them. Its §0
explicitly re-verified five facts before writing a line, and its self-review pass checked type
consistency across tasks.

It was still wrong about a real signature **nine times**.

| # | The plan said | The truth |
| --- | --- | --- |
| 1 | `parseWorkbookSheets` returns `{ name, rows }` | `RawSheet` is `{ name, grid }` (`types.ts:63`) |
| 2 | `doc.destroy()` on a pdf.js document | teardown is `loadingTask.destroy()` in pdfjs v6 |
| 3 | `new URL("./fixture", import.meta.url)` in a test | Vite rewrites it to an http dev-server URL |
| 4 | `makeFakeClient` from `@/test/adapter-fakes` | does not exist; that file has AI-SDK fakes only |
| 5 | `isSheetParseable(null, name)` | takes `(mime: string, name: string)` |
| 6 | `resolveActiveOrg()` returning an org | returns `UserOrg \| null` |
| 7 | `resolved.contextLength` at the run-loop call site | `resolvedFrom` drops it from `ResolvedModel` |
| 8 | `ModelOption.contextLength` | `buildModelOptions` drops it too |
| 9 | budget test expecting `87,7xx`; UUID fixtures | wrong constant (`87,498`); RFC-invalid under zod v4 |

Plus two arithmetic errors in the plan's own test expectations, each of which made a test unable to
fail for the reason its name claimed.

## Decision

**Treat a plan's prose as intent and its signatures as hypotheses.** Every dispatch brief for an
implementer must instruct: *verify each symbol against the real code before transcribing, and report
what the plan got wrong.*

That instruction was in this plan's briefs from Task 4 onward, escalating with a running count
("the brief has been materially wrong five times now"). Every one of the nine was caught — most by
the implementer at transcription time, two by the orchestrator scouting before dispatch, one by a
reviewer. **None shipped.**

## Rationale

The tempting conclusion is "write better plans", and it is wrong. The plan was written by reading
the code, and the errors are not carelessness — they are the predictable decay of prose about an
interface the author is not currently compiling against. Detail that is *close enough to look right*
is exactly what survives a careful read.

What actually works is cheap: the implementer has the file open and the compiler running. Verifying
a signature costs them one read; inventing a plausible one costs a fix round. Making "check, then
report the discrepancy" an explicit part of the contract converts an invisible failure mode into a
routine, logged one — the running count in each brief measurably raised how loudly implementers
reported deviations.

Note the severity spread. Most were caught by `tsc` and would have cost minutes. Two would not have
been: #9's stale constant produced a *passing* test asserting the wrong number, and #7 was
load-bearing for the whole budget feature. The typecheck gate is a real backstop for this class —
finding #1 was initially reported as a silent production bug and the reviewer correctly downgraded
it, because the code typed the result as `Awaited<ReturnType<typeof parseWorkbookSheets>>` rather
than `any`. **Typing a result from its own function rather than restating its shape is what turned
five of these into compile errors instead of runtime ones.**

## Consequences

- Positive: nine defects found pre-merge at roughly one extra read each.
- Negative: briefs get longer, and an implementer that over-corrects can "fix" something the plan
  meant deliberately. Countered by asking them to *report* every deviation, not just apply it — the
  `resolveActiveOrg` override was accepted only because the report explained it and a reviewer
  checked the sibling convention.
- **For `writing-plans`:** prefer `Awaited<ReturnType<typeof fn>>` over restating a return shape;
  prefer naming the module to read over transcribing its helper. A plan that says *"use whatever
  `agents-db.test.ts` uses"* cannot be wrong the way *"import `makeFakeClient`"* was.
- Related: [[verify-external-api-details-before-planning]] made this point for *external* APIs. This
  is the same failure against the repo's own code, which is if anything easier to get wrong because
  it feels known.

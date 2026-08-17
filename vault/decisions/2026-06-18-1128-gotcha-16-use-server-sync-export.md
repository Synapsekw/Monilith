---
type: adr
date: 2026-06-18
status: accepted
tags: [decision, gotcha]
related:
  - "[[2026-06-18-1128-phase8-board-templates]]"
---

# gotcha-16 — a "use server" module may export only async functions

## Context

The templates plan put the pure helper `buildTemplatePayload` (synchronous) as an `export` in
`src/lib/boards/actions.ts`, which begins with `"use server"`. Unit tests (Vitest) and `tsc
--noEmit` both passed. But the Next.js compiler rejects any **non-async value export** from a
`"use server"` module:

```
src/lib/boards/actions.ts:67  Server Actions must be async functions.
```

Because the board pages import that module, every `/boards/[boardId]` request 500'd at
runtime/build — a failure neither the test runner nor the type-checker surfaces.

## Decision

Keep `"use server"` action files to **async server actions only**. Any synchronous helper — even one
you want to unit-test in isolation — lives in a separate plain module and is imported by the action.
Here: `buildTemplatePayload` + `TemplatePayload` moved to `src/lib/boards/template-payload.ts`;
`actions.ts` imports it.

> **⚠️ CORRECTED 2026-08-17.** This sentence originally ended "(plus type exports, which are
> erased)". That is true only of type **alias declarations** (`export type Foo = { … }`, which are
> fine and used widely here). It is **false** of type **re-export clauses**: `export type { Foo };`
> and `export { type Foo };` are export clauses, and Next's server-actions transform enumerates
> clauses without regard for the `type` modifier — producing `registerServerReference(Foo, …)`
> against a binding the type pass erases, i.e. a `ReferenceError` at module evaluation. That shipped
> to production and broke the boards page for three days. `pnpm build` exits 0 on it. See
> [[2026-08-17-gotcha-92-a-fix-merged-to-develop-is-not-a-fix-in-production]]; the guard is
> `src/test/use-server-exports.test.ts`.

## Rationale

`"use server"` marks every export as a callable server action exposed to the client, so the contract
is "async function" — the compiler enforces it. Vitest imports the module as plain JS and `tsc`
doesn't model the directive, so the only gate that catches this is `next build` / the dev runtime.
Add `pnpm build` to the verification gate for any change that touches a `"use server"` file.

## Consequences

- Positive: helpers stay pure + unit-testable; actions files stay a clean list of mutations.
- Negative: one extra module per helper cluster.
- Follow-up: when a plan adds an exported helper to an actions file, flag it at plan-review time and
  route it to a sibling module from the start.

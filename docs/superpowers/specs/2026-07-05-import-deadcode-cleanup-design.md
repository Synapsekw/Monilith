# Import-wizard dead-code cleanup — design/spec

- **Date:** 2026-07-05
- **Branch/worktree:** `task/import-deadcode-cleanup`
- **Type:** Pure deletion / internal-lib cleanup (no user-facing behavior change)
- **Origin:** 2026-07-05 import-wizard-structure-step session, "Open threads" →
  `vault/sessions/2026-07-05-1458-import-wizard-structure-step.md` (lines 53–54); north-star "Owed".

## Goal

Remove the now-dead import-payload helpers that were superseded when the wizard's **Structure**
step shipped. When Structure landed, per-row item/subitem + group derivation moved from the old
marker/group-column inference (`splitRows2` → `buildImportPayloadV2`) to explicit structure
resolution (`resolveStructuredRows` → `buildImportPayloadV3`). The V2 lineage is no longer called
from any production path — only from its own unit tests. Deleting it removes confusing dead
surface area and prevents future callers from wiring up the obsolete builder.

## Scope

Everything lives in one module and its tests:
`src/lib/boards/spreadsheet/build-import-payload.ts` (+ `build-import-payload.test.ts`).

### In scope — remove (the dead V2 cluster)

Evidence gathered by grepping `src/` for each symbol (references outside the definition and the
symbol's own tests):

| Symbol                 | Location                          | Live call sites (non-test, non-self)                                         | Verdict                      |
| ---------------------- | --------------------------------- | ---------------------------------------------------------------------------- | ---------------------------- |
| `buildImportPayloadV2` | `build-import-payload.ts:235–305` | **0** — referenced only in `build-import-payload.test.ts`                    | dead → remove                |
| `splitRows2`           | `build-import-payload.ts:128–160` | **0** — called only inside `buildImportPayloadV2` (line 246) and in the test | dead once V2 goes → remove   |
| `Split2` type          | `build-import-payload.ts:122–126` | **0** — used only as the return/aux type of `splitRows2`                     | dead cluster member → remove |

Cascade cleanup (orphaned by the removals above — must go too, or lint/tsc fail on unused
imports/vars):

- **`SUBTASK_MARKER` import** in `build-import-payload.ts:9`. Inside this file it is used **only**
  by `splitRows2` (lines 144, 149, 154). It stays exported/used elsewhere in the codebase
  (`detect.ts`, `export-workbook.ts`, `import-wizard-state.ts`, `types.ts` …) — the intentional
  `↳` round-trip — so only the **import in this one file** is removed, not the marker itself.
- **Stale doc-comment reference** to `splitRows2` in the `resolveStructuredRows` JSDoc
  (`build-import-payload.ts:185`, "Replaces the marker-driven `splitRows2`…"). Reword so it no
  longer names a deleted symbol (e.g. "Replaces the old marker-driven row split…").
- **Test file `build-import-payload.test.ts`:**
  - Remove `splitRows2` and `buildImportPayloadV2` from the import (lines 4–5); keep
    `buildImportPayload`.
  - Remove the `describe("splitRows2", …)` block (lines 176–188) and the
    `describe("buildImportPayloadV2", …)` block (lines 190–208).
  - Remove the now-orphaned `table` / `specs` fixtures (lines 155–174) — used **only** by those two
    describes (verified by grep).
  - Remove the now-orphaned type imports `ParsedTable` and `ColumnSpec` (lines 11–12) — used **only**
    by the `table`/`specs` fixtures (`parsed`/`mappings`, which survive, are typed `ParsedSheet` /
    `ColumnMapping`).

### Explicitly OUT of scope (still live / intentional — do NOT touch)

- **`buildImportPayloadV3`** — LIVE. Called from `spreadsheet-actions.ts:524` (new-board import).
- **`resolveStructuredRows`** — LIVE. Called by `buildImportPayloadV3` and by
  `build-append-payload.ts:96` (existing-board append).
- **The `↳` export→import marker round-trip asymmetry** — INTENTIONAL per the session note
  (`export-workbook.ts` still writes `↳`). This cleanup does **not** attempt to "fix" it.
- **`SUBTASK_MARKER` itself** — stays; only the unused import in `build-import-payload.ts` is dropped.

### Excluded candidate flagged for the reviewer

- **`buildImportPayload`** (the original, no suffix, `build-import-payload.ts:30–120`) also appears
  to have **0 production call sites** — grep finds it only in `build-import-payload.test.ts`. It is
  a _separate_ lineage (it consumes `splitRows` from `detect.ts`, not `splitRows2`), it is **not** a
  `*2`/`*V2`-suffixed member of the superseded cluster, and it is **outside this task's brief**.
  This spec **does not remove it** to avoid scope creep and the risk of deleting something a
  reviewer knows is still wired up elsewhere (e.g. a not-yet-searched entrypoint). **Open question
  for the reviewer:** should a follow-up task also retire the original `buildImportPayload` +
  `splitRows`, or is it intentionally retained? Recommend handling separately if at all.

## Success criteria / verification budget

Pure code removal — the proof is that nothing else broke. All four gates must pass against the
rebased-onto-`develop` state:

```bash
pnpm typecheck   # no unused-import / unresolved-symbol errors after the deletions
pnpm lint        # no @typescript-eslint/no-unused-vars from orphaned imports/fixtures
pnpm test        # remaining build-import-payload / v3 / resolve-structured-rows suites still green
pnpm build       # production build clean
```

No new tests are added — the removed tests only ever covered the deleted helpers. The surviving
suites (`buildImportPayload` original, `buildImportPayloadV3`, `resolveStructuredRows`,
`build-append-payload`) continue to protect the live import path.

## Risks

- **Low.** Single-module, delete-only change. The main failure mode is leaving an orphaned import or
  fixture behind → caught by `typecheck`/`lint`. Mitigated by the cascade-cleanup list above.
- The only non-mechanical judgment is the excluded `buildImportPayload` question — deliberately
  deferred to the reviewer rather than actioned.

## No user-facing behavior to test

This is an internal-lib deletion. There is no user-observable change — verification is the automated
gate suite, not a manual walkthrough.

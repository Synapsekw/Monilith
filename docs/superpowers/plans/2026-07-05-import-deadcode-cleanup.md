# Import-wizard Dead-Code Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the superseded import-payload helpers `buildImportPayloadV2`, `splitRows2`, and the `Split2` type (plus their orphaned imports, fixtures, and tests), leaving the live `buildImportPayloadV3` / `resolveStructuredRows` path and all four gates green.

**Architecture:** Pure deletion inside one module + its test file. There is no new code — this is a "TDD in reverse" task: the _existing_ test suite (minus the tests that only covered the deleted helpers) is the safety net, and the four gates prove nothing else broke. No behavior changes, no user-facing surface.

**Tech Stack:** TypeScript (strict), Vitest, ESLint (`eslint-config-next/typescript`), Next.js 16 build.

**Spec:** `docs/superpowers/specs/2026-07-05-import-deadcode-cleanup-design.md`

---

## File Structure

Two files change, both under `src/lib/boards/spreadsheet/`:

- `build-import-payload.ts` — remove `Split2` (122–126), `splitRows2` (128–160), `buildImportPayloadV2` (235–305), the now-unused `SUBTASK_MARKER` import (line 9), and de-stale the `resolveStructuredRows` JSDoc that names `splitRows2` (line 185). Keep `buildImportPayload`, `resolveStructuredRows`, `buildImportPayloadV3`, and all their supporting types.
- `build-import-payload.test.ts` — remove the `splitRows2` + `buildImportPayloadV2` describes, the imports that fed them, the `table`/`specs` fixtures, and the orphaned `ParsedTable`/`ColumnSpec` type imports. Keep the `buildImportPayload` describe.

No other files reference the deleted symbols (verified by grep across `src/`).

---

### Task 1: Remove the dead V2 cluster and its tests

**Files:**

- Modify: `src/lib/boards/spreadsheet/build-import-payload.ts`
- Modify (test): `src/lib/boards/spreadsheet/build-import-payload.test.ts`

This is a single atomic deletion task — the source deletion and the test deletion must land
together (removing the source without the test breaks `pnpm test`; removing the test without the
source leaves dead code). Do all edits, then run the gates as the verification step.

- [ ] **Step 1: Re-confirm the symbols are still dead (guard against drift since scoping)**

Run:

```bash
grep -rn "buildImportPayloadV2\|splitRows2\|\bSplit2\b" src/
```

Expected: hits ONLY in `build-import-payload.ts` (definitions + the internal `splitRows2` call
inside `buildImportPayloadV2` + the JSDoc mention) and in `build-import-payload.test.ts`. If any
OTHER file appears, STOP — a new caller landed; revisit the spec before deleting.

- [ ] **Step 2: Delete the `SUBTASK_MARKER` import from `build-import-payload.ts`**

Remove line 9:

```ts
import { SUBTASK_MARKER } from "./types";
```

Rationale: inside this file `SUBTASK_MARKER` is used only by `splitRows2`. It remains exported from
`./types` and used by other files (`detect.ts`, `export-workbook.ts`, …) — do NOT touch those.

- [ ] **Step 3: Delete the `Split2` type and `splitRows2` function**

Remove the whole block, `build-import-payload.ts` lines 122–160 (from `export type Split2 = {`
through the closing `}` of `splitRows2`, i.e. up to and including line 160):

```ts
export type Split2 = {
  groups: string[];
  items: { group: string; name: string; row: string[] }[];
  subitems: { parentIndex: number; name: string; row: string[] }[];
};

export function splitRows2(
  rows: string[][],
  nameIndex: number,
  groupIndex: number | null,
): Split2 {
  // …full body…
  return { groups, items, subitems };
}
```

- [ ] **Step 4: Delete `buildImportPayloadV2`**

Remove the whole function, `build-import-payload.ts` lines 235–305 (from
`export function buildImportPayloadV2(` through its closing `}`). It is the only caller of
`splitRows2`, so this must go in the same edit.

- [ ] **Step 5: De-stale the `resolveStructuredRows` JSDoc**

In the `resolveStructuredRows` doc comment (was line ~185), the sentence names the deleted symbol:

```ts
 * Resolve explicit per-row structure into items + subitems. Replaces the
 * marker-driven `splitRows2`: item/subitem type and group come from
```

Change `marker-driven \`splitRows2\``to`old marker-driven row split` (or similar) so the comment
no longer references a symbol that no longer exists:

```ts
 * Resolve explicit per-row structure into items + subitems. Replaces the
 * old marker-driven row split: item/subitem type and group come from
```

- [ ] **Step 6: Trim the test imports in `build-import-payload.test.ts`**

Change the value import (lines 2–6) from:

```ts
import {
  buildImportPayload,
  splitRows2,
  buildImportPayloadV2,
} from "./build-import-payload";
```

to:

```ts
import { buildImportPayload } from "./build-import-payload";
```

Change the type import (lines 7–13) from:

```ts
import type {
  ParsedSheet,
  ColumnMapping,
  SynthOption,
  ParsedTable,
  ColumnSpec,
} from "./types";
```

to (drop `ParsedTable` and `ColumnSpec` — only the deleted fixtures used them):

```ts
import type { ParsedSheet, ColumnMapping, SynthOption } from "./types";
```

- [ ] **Step 7: Delete the orphaned `table`/`specs` fixtures and the two dead describes**

Remove `build-import-payload.test.ts` lines 155–208 in one go — the `table` fixture, the `specs`
fixture, `describe("splitRows2", …)`, and `describe("buildImportPayloadV2", …)`. The file ends
after these blocks, so the `buildImportPayload` describe (lines 41–153) becomes the last content.
The surviving `parsed`/`mappings` fixtures are untouched (typed `ParsedSheet`/`ColumnMapping`).

- [ ] **Step 8: Run the focused test file — surviving suite still green**

Run:

```bash
pnpm test -- src/lib/boards/spreadsheet/build-import-payload.test.ts
```

Expected: PASS — only the `buildImportPayload` describe runs; no reference-error to the deleted
imports. If it fails with "splitRows2 is not defined" or an unused-import complaint, a deletion in
Steps 2–7 was incomplete.

- [ ] **Step 9: Run the full gate suite**

Run:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all four PASS.

- `typecheck`: no "cannot find name" / no unused-symbol errors.
- `lint`: no `@typescript-eslint/no-unused-vars` from a leftover import or fixture.
- `test`: `build-import-payload`, `build-import-payload-v3`, `resolve-structured-rows`, and
  `build-append-payload` suites all green (the live path is fully covered).
- `build`: clean production build.

If any gate fails, fix the specific leftover (most likely a stray import) and re-run this step.
Do NOT add new tests — there is no new behavior to cover.

- [ ] **Step 10: Commit (stage by path only)**

```bash
git add src/lib/boards/spreadsheet/build-import-payload.ts \
        src/lib/boards/spreadsheet/build-import-payload.test.ts \
        docs/superpowers/specs/2026-07-05-import-deadcode-cleanup-design.md \
        docs/superpowers/plans/2026-07-05-import-deadcode-cleanup.md
git status   # confirm ONLY these paths are staged
git commit -m "refactor(import): drop dead buildImportPayloadV2/splitRows2 helpers"
```

Commit identity is pinned by the worktree to `Danijel Jovanovic <info@synapse-solutions.ai>` — do
not override it. Never `git add -A`.

---

## Execution DAG

- **Task 1** — no dependencies, no dependents. Single node.

```
[Task 1: remove dead V2 cluster + tests]
```

- **Dependency graph:** none (one task).
- **Parallel batches:** Batch 1 = {Task 1}. Nothing to parallelize — the source and test deletions
  are one atomic unit (splitting them would red the gates mid-way), so this is deliberately a single
  task, not a batch of concurrent agents.
- **Critical path:** Task 1 (the whole job). Wall-clock floor = one delete-and-gate pass.

## Performance & data-fetching budget

Not applicable — no UI, no views/tabs/filters, no data fetching. Pure internal-lib deletion; zero
runtime paths change (the deleted `buildImportPayloadV2`/`splitRows2` had no live callers).

## Self-review notes

- **Spec coverage:** every "in scope — remove" row of the spec maps to a step here (SUBTASK_MARKER
  import → Step 2; Split2 + splitRows2 → Step 3; buildImportPayloadV2 → Step 4; JSDoc → Step 5;
  test imports → Step 6; fixtures + describes → Step 7). The excluded `buildImportPayload` candidate
  is intentionally NOT actioned (deferred to reviewer per spec).
- **No new symbols introduced;** all referenced names already exist in the codebase.
- **Line numbers** are as of the scoping snapshot — if a rebase onto `develop` shifts them, match by
  symbol name, not by line.

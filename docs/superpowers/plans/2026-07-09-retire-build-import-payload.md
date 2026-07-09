# Retire unsuffixed `buildImportPayload` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the dead, unsuffixed `buildImportPayload` function (0 non-test production call sites; superseded by `buildImportPayloadV3`) along with its dedicated test file and its now-orphaned imports, leaving all shared and V3 symbols intact.

**Architecture:** Pure deletion, no new behavior. `src/lib/boards/spreadsheet/build-import-payload.ts` currently hosts three concerns: (1) the legacy `buildImportPayload` path, (2) shared types (`ImportPayload`, `SubitemSeed`), and (3) the live V3 path (`resolveStructuredRows` + `buildImportPayloadV3`). We excise concern (1) and its exclusive imports; concerns (2) and (3) stay untouched. The dedicated legacy test file is removed. Correctness is proven by the existing gate (typecheck/lint/test/build), which must stay green because nothing outside the deleted function referenced it.

**Tech Stack:** TypeScript (strict), Vitest, Next.js 16, pnpm.

---

## Verified footprint (fresh grep, this worktree)

Re-confirmed against live files on 2026-07-09 in worktree `.claude/worktrees/retire-build-import-payload`:

- **0 non-test production call sites** for the unsuffixed `buildImportPayload`. The ONLY references are:
  - Definition: `src/lib/boards/spreadsheet/build-import-payload.ts:29`
  - Its dedicated test: `src/lib/boards/spreadsheet/build-import-payload.test.ts` (import at line 2 + 6 calls at lines 33, 87, 96, 110, 127, 140)
- The live successor `buildImportPayloadV3` is called from production at `src/lib/boards/spreadsheet-actions.ts:524` (imported at line 10) and tested in `build-import-payload-v3.test.ts`.

### What gets DELETED

1. Function `buildImportPayload` — `build-import-payload.ts:29-119` (the whole `export function buildImportPayload(...) { ... }` block, spanning the blank line before `export type ResolvedItem` on line 121).
2. Three imports that become orphaned once the function is gone (each used ONLY inside that function within this file):
   - `ParsedSheet` (import line 2; sole non-import use was the deleted param at line 30)
   - `ColumnMapping` (import line 3; sole non-import use was the deleted param at line 31)
   - `splitRows` (import line 10; sole non-import use was line 33 inside the deleted body)
3. Dedicated test file `src/lib/boards/spreadsheet/build-import-payload.test.ts` — entirely.

### What STAYS (do NOT touch)

- **`SubitemSeed` type (lines 15-22) — KEEP.** The scouting note that called it a removable orphan is WRONG. It is referenced by the kept `ImportPayload` type at line 26 (`subitems: SubitemSeed[]`). Deleting it would break `ImportPayload`. Its other reference (line 98) is inside the deleted function and disappears with it, but the line-26 reference keeps it live.
- **`ImportPayload` type (lines 24-27) — KEEP.** Return type of `buildImportPayloadV3` (line 199) and imported by `spreadsheet-actions.ts:11` (used at line 282).
- **`textToCell` import (line 9) — KEEP.** Still used by V3 at line 223.
- **`TemplatePayload` (line 11) and `Json` (line 12) imports — KEEP.** Used by kept types (`SubitemSeed`, `ImportPayload`) and V3.
- **`ParsedTable`, `ColumnSpec`, `ImportGroup`, `RowStructureEntry` imports (lines 4-7) — KEEP.** Used by `resolveStructuredRows`/`buildImportPayloadV3` and the `Resolved*` types (lines 137, 152-155, 195-198).
- **`GROUP_COLORS` import (line 13) — KEEP.** Used by V3 at line 238.
- **All V3-path symbols — KEEP:** `ResolvedItem`, `ResolvedSubitem`, `ResolvedStructure`, `resolveStructuredRows`, `buildImportPayloadV3`.
- **Sibling test / consumer files — NO cleanup needed.** `build-import-payload-v3.test.ts`, `resolve-structured-rows.test.ts`, and `build-append-payload.ts` import only kept symbols (`buildImportPayloadV3` / `resolveStructuredRows`). The only importer of the unsuffixed function is the test file being deleted, so no dangling import remains anywhere.

### Data-fetching / performance budget

Not applicable — no UI, no views/tabs/filters, no server round-trips, no queries. This is a pure code deletion in a lib module.

### Parallelization plan (Execution DAG)

Single-task, single-file-cluster deletion. No independent units to parallelize. Critical path = Task 1 alone. Dispatch one agent; no worktree fan-out.

---

## Task 1: Delete the legacy `buildImportPayload` path and its dedicated test

**Files:**

- Modify: `src/lib/boards/spreadsheet/build-import-payload.ts` (remove function lines 29-119 + orphaned imports `ParsedSheet`, `ColumnMapping`, `splitRows`)
- Delete: `src/lib/boards/spreadsheet/build-import-payload.test.ts`

- [ ] **Step 1: Delete the dedicated legacy test file**

```bash
git rm src/lib/boards/spreadsheet/build-import-payload.test.ts
```

Expected: file staged for deletion. This test is the sole importer of the unsuffixed function; removing it first means the very next steps can't leave a broken import.

- [ ] **Step 2: Remove the orphaned imports from `build-import-payload.ts`**

The current top-of-file import block (lines 1-13) is:

```ts
import type {
  ParsedSheet,
  ColumnMapping,
  ParsedTable,
  ColumnSpec,
  ImportGroup,
  RowStructureEntry,
} from "./types";
import { textToCell } from "./cell-codec";
import { splitRows } from "./detect";
import type { TemplatePayload } from "@/lib/boards/template-payload";
import type { Json } from "@/types/database.types";
import { GROUP_COLORS } from "@/lib/boards/group-colors";
```

Replace it with (drop `ParsedSheet`, `ColumnMapping`, and the entire `splitRows` line):

```ts
import type {
  ParsedTable,
  ColumnSpec,
  ImportGroup,
  RowStructureEntry,
} from "./types";
import { textToCell } from "./cell-codec";
import type { TemplatePayload } from "@/lib/boards/template-payload";
import type { Json } from "@/types/database.types";
import { GROUP_COLORS } from "@/lib/boards/group-colors";
```

- [ ] **Step 3: Delete the `buildImportPayload` function body**

Remove the entire block from the `export function buildImportPayload(` line through its closing `}` (currently lines 29-119), INCLUDING the trailing blank line so that the kept `export type SubitemSeed = { ... }` / `export type ImportPayload = { ... }` block (lines 15-27) is followed directly by the kept `export type ResolvedItem = {` block. Do NOT touch lines 15-27 (`SubitemSeed` + `ImportPayload`) — they stay. Do NOT touch anything from line 121 onward (`ResolvedItem` and everything below).

After this edit, the file should read, in order: the import block (from Step 2) → `export type SubitemSeed` → `export type ImportPayload` → `export type ResolvedItem` → `export type ResolvedSubitem` → `export type ResolvedStructure` → `export function resolveStructuredRows` → `export function buildImportPayloadV3`.

- [ ] **Step 4: Verify no residual reference to the deleted symbol**

Run: `git -C . grep -n "buildImportPayload\b" -- 'src/**/*.ts' 'src/**/*.tsx'`

Expected: matches ONLY for `buildImportPayloadV3` (in `build-import-payload.ts`, `build-import-payload-v3.test.ts`, and `spreadsheet-actions.ts`). ZERO matches for a bare `buildImportPayload(` call or a `buildImportPayload` import. Also confirm `SubitemSeed` and `ImportPayload` still resolve:

Run: `grep -rn "SubitemSeed\|ImportPayload\b" src/lib/boards/spreadsheet/build-import-payload.ts src/lib/boards/spreadsheet-actions.ts`

Expected: `SubitemSeed` at its definition + inside `ImportPayload`; `ImportPayload` at its definition, both V3 return sites, and the `spreadsheet-actions.ts` import/usage.

- [ ] **Step 5: Run the full verification gate**

```bash
pnpm typecheck   # tsc --noEmit — must pass (catches any missed orphaned import as TS6133 / unused, and any dangling reference)
pnpm lint        # ESLint — must pass (catches unused imports as errors)
pnpm test        # Vitest — must pass; the legacy test file is gone, v3/resolve/append suites unaffected
pnpm build       # production build — must pass
```

Expected: all four green. If typecheck or lint flags an unused import, it means an import was kept that should have been dropped (or vice versa) — reconcile against the "What STAYS" list above; do NOT silence with `// eslint-disable` or `any`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/boards/spreadsheet/build-import-payload.ts src/lib/boards/spreadsheet/build-import-payload.test.ts
git commit -m "refactor(spreadsheet): retire dead unsuffixed buildImportPayload

Remove the legacy buildImportPayload (0 non-test call sites, superseded by
buildImportPayloadV3) plus its dedicated test and now-orphaned imports
(ParsedSheet, ColumnMapping, splitRows). Shared ImportPayload/SubitemSeed
types and the full V3 path are kept."
```

Note: `build-import-payload.test.ts` was `git rm`'d in Step 1; staging it here records the deletion in the same commit. Stage by explicit path only — do not `git add -A`.

---

## Verification gate (definition of done)

Per the working agreement, this task is done only when, from inside the worktree:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

all pass, then `scripts/finish-task.sh` merges `task/retire-build-import-payload` into `develop`, pushes, and removes the worktree + branch.

**How to test (user-facing):** No user-facing behavior to test — this is an internal-lib dead-code deletion, verified by the test suite (typecheck/lint/test/build all green) and by the grep confirming `buildImportPayloadV3` remains the sole import path used by `spreadsheet-actions.ts`.

---

## Self-review

- **Spec coverage:** The single spec requirement (retire the unsuffixed function + its exclusive dependencies, keep shared/V3 symbols, gate stays green) is covered by Task 1 Steps 1-5, with the gate restated in "Definition of done."
- **Placeholder scan:** No TBD/TODO/"handle edge cases"; every edit shows exact before/after code and exact commands.
- **Type consistency:** Symbol names used throughout (`buildImportPayload`, `buildImportPayloadV3`, `SubitemSeed`, `ImportPayload`, `ParsedSheet`, `ColumnMapping`, `splitRows`) match the verified live file. The plan's key correction — `SubitemSeed` stays because `ImportPayload` (kept) references it — is explicitly reconciled against the grep evidence.

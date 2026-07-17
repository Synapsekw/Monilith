# Report Builder Follow-up Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two independent Report Builder bugs — (1) the report cover displays the org's UUID instead of its display name, and (2) `draftReportNarrativeAction` lets a read-only viewer spend AI credits.

**Architecture:** Both are small, surgical server-side fixes with test-first coverage. Bug 1 resolves the org display name via the existing React-`cache()`-wrapped `resolveActiveOrg()` on the two upstream sources that feed the cover (the in-app preview RSC and the PDF export server action); the render sink `CoverBlock` is unchanged. Bug 2 swaps a permissive `if (!access)` guard for the canonical `canEditReports(access)` edit-gate used by every sibling report mutation, placed before any entitlement/`runAi` call so no credits are spent.

**Tech Stack:** Next.js 16 (App Router, RSC + Server Actions), TypeScript strict, Vitest, Zod, Supabase RLS.

## Global Constraints

- **Server Actions for all mutations; Server Components by default.** (AGENTS.md)
- **Validate at boundaries with Zod.** Both actions already parse input with `z.object({ boardId: z.string().uuid() })` / uuid schemas — preserve that; do not weaken it.
- **RLS is the security boundary.** These fixes tighten an app-layer credit gate and fix a display value; they do not replace RLS. `reportBoardAccess` / `getBoardAccess` remain the access source of truth.
- **Reuse canonical modules — grep before writing a helper.** `canEditReports` is already exported from `src/lib/reports/access.ts`; `resolveActiveOrg` from `src/lib/org/active.ts`. Do **not** re-declare either. `ActionResult` / `fail` come from `src/lib/actions/result.ts`.
- **Commit identity pinned:** `Danijel Jovanovic <info@synapse-solutions.ai>`. Commit subjects lowercase after `type(scope):`; include a body + `Co-Authored-By` trailer. Stage explicitly by path — never `git add -A`.
- **Gates before done:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green.

## Performance & Data-Fetching Budget

Neither fix adds a UI view/tab/filter/sort, so there are **0 new in-page round trips**.

- **Bug 1 (preview, `page.tsx`):** `resolveActiveOrg()` is `cache()`-wrapped and already resolved elsewhere in the same render (sidebar/guards), so calling it here is **0 additional DB round trips** in the shared request — it replaces a call to `getActiveOrgId()`, which internally already calls `resolveActiveOrg()`. Net query count is unchanged.
- **Bug 1 (export, `exportReportPdf`):** adds one `resolveActiveOrg()` resolve on the server action path; the org list read is RLS-scoped and bounded (a user's org membership list, not a growing hot-path table). Acceptable for an on-demand export.
- **Bug 2:** removes work on the viewer path (short-circuits before the AI gateway call) — strictly cheaper.

## Assumptions

- The active org (from `resolveActiveOrg()`) is the org that owns the board being previewed/exported. This mirrors the existing `createReport` behavior, which already stamps `org_id` from `getActiveOrgId()` (the active org). The board access check (`reportBoardAccess`) still gates the caller. If a board could ever belong to a non-active org in this UX, a follow-up would resolve the name by `board.org_id`; that is out of scope here and consistent with current code.
- Viewers may still **export** a report (`exportReportPdf` keeps its `if (!access)` any-access guard) — only the AI **draft** action is edit-gated. This matches the bug report: the gap is credit-spend, not read access.

## File Structure

| File                                                         | Responsibility                                | Change                                               |
| ------------------------------------------------------------ | --------------------------------------------- | ---------------------------------------------------- |
| `src/lib/reports/ai-actions.ts`                              | `draftReportNarrativeAction` server action    | Modify: import `canEditReports`, swap guard          |
| `src/lib/reports/ai-actions.test.ts`                         | Unit test for the edit-gate                   | Create                                               |
| `src/lib/reports/actions.ts`                                 | Report server actions incl. `exportReportPdf` | Modify: resolve org name for `buildReportHtml`       |
| `src/lib/reports/actions.export-orgname.test.ts`             | Unit test proving export cover gets a name    | Create                                               |
| `src/app/(app)/boards/[boardId]/reports/[reportId]/page.tsx` | In-app preview RSC                            | Modify: pass `resolveActiveOrg()?.name` as `orgName` |

Two tasks. They touch disjoint files (Task 1 → `ai-actions.*`; Task 2 → `actions.ts` + `page.tsx`) and share no state, so they are independent.

---

### Task 1: Edit-gate `draftReportNarrativeAction` (Bug 2)

**Files:**

- Modify: `src/lib/reports/ai-actions.ts:9` (import) and `:20-21` (guard)
- Test: `src/lib/reports/ai-actions.test.ts` (create)

**Interfaces:**

- Consumes: `reportBoardAccess(boardId): Promise<"owner"|"editor"|"viewer"|null>` and `canEditReports(access): boolean` from `src/lib/reports/access.ts`; `fail` from `src/lib/actions/result.ts`; `runAi` from `src/lib/ai/gateway.ts`; `requireAiEntitlement` from `src/lib/ai/entitlement.ts`.
- Produces: `draftReportNarrativeAction({ boardId }): Promise<ActionResult<ReportNarrative>>` — same signature; behavior change only (viewer/`null` now rejected before any AI cost).

- [ ] **Step 1: Write the failing test**

Create `src/lib/reports/ai-actions.test.ts`. The test mocks the access layer to return `"viewer"` and spies on the two AI-cost calls to prove they never run.

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const reportBoardAccess = vi.fn(async () => "viewer" as string | null);
const requireAiEntitlement = vi.fn(async () => {});
const runAi = vi.fn(async () => ({}) as never);

// Keep the REAL canEditReports (owner/editor only); override only the async
// access lookup so no DB is touched.
vi.mock("@/lib/reports/access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/reports/access")>()),
  reportBoardAccess: (...a: unknown[]) => reportBoardAccess(...(a as [])),
}));
vi.mock("@/lib/ai/entitlement", () => ({ requireAiEntitlement }));
vi.mock("@/lib/ai/gateway", () => ({ runAi }));
vi.mock("@/lib/org/active", () => ({
  resolveActiveOrg: async () => ({ id: "org-1", name: "Acme Inc" }),
}));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({ id: "u1" }),
}));
vi.mock("@/lib/boards/queries", () => ({ getBoardPayload: async () => null }));

describe("draftReportNarrativeAction edit-gate", () => {
  beforeEach(() => {
    reportBoardAccess.mockReset().mockResolvedValue("viewer");
    requireAiEntitlement.mockReset();
    runAi.mockReset();
  });

  it("rejects a viewer and spends no AI credits", async () => {
    const { draftReportNarrativeAction } =
      await import("@/lib/reports/ai-actions");
    const res = await draftReportNarrativeAction({
      boardId: "00000000-0000-0000-0000-000000000000",
    });
    expect(res.ok).toBe(false);
    // The whole point: no entitlement check and no gateway call on the viewer path.
    expect(requireAiEntitlement).not.toHaveBeenCalled();
    expect(runAi).not.toHaveBeenCalled();
  });

  it("passes the edit-gate for an editor (reaches the entitlement step)", async () => {
    reportBoardAccess.mockResolvedValue("editor");
    const { draftReportNarrativeAction } =
      await import("@/lib/reports/ai-actions");
    await draftReportNarrativeAction({
      boardId: "00000000-0000-0000-0000-000000000000",
    });
    // getBoardPayload returns null after entitlement, so the action fails later —
    // but it got PAST the edit-gate, proving the gate is edit-level not any-access.
    expect(requireAiEntitlement).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/reports/ai-actions.test.ts`
Expected: FAIL. With the current `if (!access)` guard, a `"viewer"` is truthy so the action proceeds past the guard → `requireAiEntitlement`/`runAi` get called → `not.toHaveBeenCalled()` assertions fail.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/reports/ai-actions.ts`, add `canEditReports` to the existing access import (line 9):

```ts
import { reportBoardAccess, canEditReports } from "@/lib/reports/access";
```

Replace the guard (current lines 20-21):

```ts
const access = await reportBoardAccess(parsed.data.boardId);
if (!access) return fail("You don't have access to this board.");
```

with the canonical edit-gate (identical wording style to `createReport`/`saveReport`):

```ts
const access = await reportBoardAccess(parsed.data.boardId);
if (!canEditReports(access))
  return fail("You can't draft narratives on this board.");
```

Leave the rest of the action untouched — the gate stays **before** the `try { … resolveActiveOrg / requireAiEntitlement / runAi … }` block, so no credits are reachable for a viewer.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/reports/ai-actions.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reports/ai-actions.ts src/lib/reports/ai-actions.test.ts
git commit -m "fix(reports): edit-gate draftReportNarrativeAction against viewers"
```

Commit body: note that a read-only viewer could previously spend AI credits on a draft they can't save; now gated by `canEditReports` (owner/editor) before any entitlement/gateway call. Include the `Co-Authored-By` trailer.

---

### Task 2: Resolve org display name for the report cover (Bug 1)

**Files:**

- Modify: `src/lib/reports/actions.ts:5` (import) and `:146` (`orgName` passed to `buildReportHtml`)
- Modify: `src/app/(app)/boards/[boardId]/reports/[reportId]/page.tsx:5,23,33` (import + `orgName` value)
- Test: `src/lib/reports/actions.export-orgname.test.ts` (create)

**Interfaces:**

- Consumes: `resolveActiveOrg(): Promise<UserOrg | null>` (where `UserOrg` has `.id` and `.name`) from `src/lib/org/active.ts`; `buildReportHtml({ …, orgName: string })` from `src/lib/reports/export-html`.
- Produces: no signature changes. `exportReportPdf` and the preview page now feed `CoverBlock` a human-readable org name string instead of the raw `org_id` UUID.

- [ ] **Step 1: Write the failing test**

Create `src/lib/reports/actions.export-orgname.test.ts`. It exercises the real `exportReportPdf` with its collaborators mocked, and asserts `buildReportHtml` received the org **name**, not the UUID.

```ts
import { describe, expect, it, vi } from "vitest";

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const BOARD_ID = "22222222-2222-2222-2222-222222222222";
const REPORT_ID = "33333333-3333-3333-3333-333333333333";

const buildReportHtml = vi.fn(async () => "<!doctype html><html></html>");

vi.mock("@/lib/org/active", () => ({
  getActiveOrgId: async () => ORG_ID,
  resolveActiveOrg: async () => ({ id: ORG_ID, name: "Acme Inc" }),
}));
vi.mock("@/lib/reports/access", () => ({
  reportBoardAccess: async () => "owner",
  canEditReports: () => true,
}));
vi.mock("@/lib/boards/queries", () => ({
  getBoardPayload: async () => ({
    board: { id: BOARD_ID, name: "Roadmap", org_id: ORG_ID },
    columns: [],
    items: [],
    cellValues: [],
  }),
}));
vi.mock("@/lib/reports/queries", () => ({
  getReport: async () => ({
    id: REPORT_ID,
    boardId: BOARD_ID,
    name: "Q3",
    config: { blocks: [] },
  }),
}));
vi.mock("@/lib/boards/people-names", () => ({
  resolvePeopleNames: async () => ({}),
}));
vi.mock("@/lib/reports/shape", () => ({
  shapeReport: () => ({ columns: [], groups: [] }),
  computeKpis: () => ({
    itemCount: 0,
    percentComplete: 0,
    overdueCount: 0,
    statusTally: [],
  }),
  computeGroupSummaries: () => [],
}));
vi.mock("@/lib/reports/export-html", () => ({ buildReportHtml }));
vi.mock("@/lib/reports/pdf", () => ({
  renderHtmlToPdf: async () => Buffer.from("pdf"),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async () => ({ id: "u1" }),
}));

describe("exportReportPdf cover org name", () => {
  it("passes the org display name to buildReportHtml, not the org UUID", async () => {
    const { exportReportPdf } = await import("@/lib/reports/actions");
    const res = await exportReportPdf({
      reportId: REPORT_ID,
      boardId: BOARD_ID,
    });
    expect(res.ok).toBe(true);
    expect(buildReportHtml).toHaveBeenCalledOnce();
    const arg = buildReportHtml.mock.calls[0][0] as { orgName: string };
    expect(arg.orgName).toBe("Acme Inc");
    expect(arg.orgName).not.toBe(ORG_ID);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/reports/actions.export-orgname.test.ts`
Expected: FAIL. Current line 146 passes `orgName: payload.board.org_id` → `arg.orgName` equals `ORG_ID`, so `expect(arg.orgName).toBe("Acme Inc")` fails.

- [ ] **Step 3: Write minimal implementation**

**3a — `src/lib/reports/actions.ts`.** Add `resolveActiveOrg` to the existing org import (line 5):

```ts
import { getActiveOrgId, resolveActiveOrg } from "@/lib/org/active";
```

In `exportReportPdf`, resolve the org name and pass it. Change the `buildReportHtml` call (line 140-147) so `orgName` is the display name. Insert the resolve just before the call and update the field:

```ts
const names = await resolvePeopleNames(payload);
const orgName = (await resolveActiveOrg())?.name ?? payload.board.name;
const html = await buildReportHtml({
  config: report.config,
  model: shapeReport(payload, names),
  kpis: computeKpis(payload, names),
  groupSummaries: computeGroupSummaries(payload),
  boardName: payload.board.name,
  orgName,
});
```

(Fallback to the board name — never the UUID — on the impossible `null`-org path; `CoverBlock` only shows this when `showLogo` is on.)

**3b — `src/app/(app)/boards/[boardId]/reports/[reportId]/page.tsx`.** Swap the import (line 5) from `getActiveOrgId` to `resolveActiveOrg` (it is the only use of that module in the file):

```ts
import { resolveActiveOrg } from "@/lib/org/active";
```

Replace line 22-23:

```ts
// Org display name for the cover — the human-readable name, never the id.
const orgName = (await resolveActiveOrg())?.name ?? "";
```

`orgName` continues to be passed to `<ReportBuilder … orgName={orgName} />` on line 33 unchanged (it is already typed `orgName: string`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/reports/actions.export-orgname.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reports/actions.ts src/lib/reports/actions.export-orgname.test.ts "src/app/(app)/boards/[boardId]/reports/[reportId]/page.tsx"
git commit -m "fix(reports): show org display name on report cover, not the uuid"
```

Commit body: note both upstream sources (in-app preview RSC + PDF export) resolved the raw `org_id` into the cover; both now use `resolveActiveOrg()?.name`. `CoverBlock` (the render sink) is unchanged. Include the `Co-Authored-By` trailer.

---

## Execution DAG

- **Nodes:** Task 1 (edit-gate), Task 2 (org name).
- **Edges:** none. Task 1 touches only `src/lib/reports/ai-actions.*`; Task 2 touches `src/lib/reports/actions.ts` + `page.tsx`. Disjoint files, no shared state, no signature dependency.
- **Parallel batches:** **Batch 1 = { Task 1, Task 2 }** — both runnable immediately.
- **Critical path:** 1 task deep (either task alone). Both are S/XS.

Because both tasks share one batch, dispatch them concurrently (e.g. `superpowers:dispatching-parallel-agents` or two parallel `subagent-driven-development` subagents). They live in the same worktree and edit disjoint files, so no additional worktree isolation is needed; if run by fully autonomous parallel agents, isolate per `superpowers:using-git-worktrees`.

## Final Gate (after both tasks merge)

Run from the worktree root:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

All four must be green before `scripts/finish-task.sh`.

## Manual Test Guide (post-merge, pull `develop`; DEV env)

**Fix 1 — org name on the cover:**

1. Open any board → **Reports** → open or create a report.
2. In the builder preview, enable the **Cover** block and turn on its **Show logo/organization** option (and keep "Prepared for/by" empty so the Organization row shows).
3. Expected: the cover's **Organization** row reads your org's display name (e.g. "Acme Inc") — **not** a `xxxxxxxx-xxxx-…` UUID.
4. Click **Export PDF**. Open the downloaded PDF. Expected: the same human-readable org name on the cover, not a UUID.

**Fix 2 — viewer can't spend AI credits on a draft:**

1. As an **owner/editor**, share a board with a second user at **viewer** (read-only) access.
2. Sign in as that viewer, open the shared board → **Reports** → open the report → try **Draft with AI** (narrative).
3. Expected: the action is **rejected** with "You can't draft narratives on this board." and **no AI credits are consumed** (no usage recorded for that viewer). As an owner/editor the same action still works.

```

```

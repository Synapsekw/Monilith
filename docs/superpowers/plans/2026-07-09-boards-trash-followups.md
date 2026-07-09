# Boards Trash follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a top-level "Trash" sidebar link that jumps to the `/boards#archived` workspace Trash, and surface each archived board's `archived_by` as "archived by {name}, {timeAgo}".

**Architecture:** Pure read/render + navigation. `getArchivedBoards()` gains the already-typed `archived_by` column and resolves it to a display name via the existing `profiles` Map pattern (one extra query, mirroring `listSharedBoards`). `ArchivedBoardsSection` gains a two-line row (name + caption), an `id="archived"` hash target, and auto-expand on that hash. The sidebar gains a `Trash` link. No migration, no new Server Action, no type regeneration.

**Tech Stack:** Next.js 16 (App Router, RSC + Server Actions), Supabase Postgres + RLS, lucide-react, Vitest + Testing Library. Tokens/components per the `pulse-ui` skill (monochrome chrome, semantic tokens only).

**Design spec:** `docs/superpowers/specs/2026-07-09-boards-trash-followups-design.md`

---

## File structure (what each unit owns)

| File                                                   | Responsibility                                                             | Task |
| ------------------------------------------------------ | -------------------------------------------------------------------------- | ---- |
| `src/lib/boards/trash-queries.ts`                      | `getArchivedBoards()` selects `archived_by` + resolves name via `profiles` | 1    |
| `src/lib/boards/trash-queries.test.ts`                 | Assert column selected, one profiles lookup, name attached, null-safe      | 1    |
| `src/components/boards/ArchivedBoardsSection.tsx`      | Wider row type; name + "archived by …" caption; `id="archived"`; auto-open | 2    |
| `src/components/boards/ArchivedBoardsSection.test.tsx` | Assert caption + fallback + `id` anchor (+ optional auto-open)             | 2    |
| `src/app/(app)/boards/page.tsx`                        | Type passthrough only (verify wider row shape flows through)               | 2    |
| `src/components/shell/sidebar-nav.tsx`                 | `TRASH` NavLink in `ALL_LINKS` (rail) + standalone expanded link           | 3    |
| `src/components/shell/sidebar-nav.test.tsx`            | Assert Trash link href + presence in both modes                            | 3    |

**Interfaces:**

- **Task 1 Produces:** `ArchivedBoard` row shape `{ id, name, workspace_id, archived_at, archived_by, archived_by_name }` returned by `getArchivedBoards()`.
- **Task 2 Consumes:** Task 1's row shape (the `ArchivedBoardsSection` prop). **Produces:** `id="archived"` anchor on the section.
- **Task 3 Consumes:** the `id="archived"` anchor from Task 2 (its `href="/boards#archived"` lands there). Touches only `sidebar-nav.tsx`.

---

## Execution DAG (working-agreement #6)

- **Dependency graph:** Task 2 depends on Task 1 (consumes the wider row shape). Task 3 depends on Task 2 (its hash target is the `id` Task 2 adds, and Task 3 must not race edits to `ArchivedBoardsSection.tsx` — but Task 3 does not itself edit that file, so the dependency is logical/anchor-only).
- **Parallel batches:** none. `ArchivedBoardsSection.tsx` is the serialization point (only Task 2 edits it; Task 1 feeds it; Task 3 targets its anchor). Run **1 → 2 → 3** sequentially, single agent.
- **Critical path:** 1 → 2 → 3 (the whole plan). Size S; no concurrency to exploit.

**Data-fetching budget:** `archived_by` rides the existing `getArchivedBoards()` select (0 extra round-trips for the column); name resolution adds exactly one `profiles` query, only when a non-null `archived_by` exists, on the cold `/boards` load, bounded by the existing `limit 200`. The nav link is a real page navigation (RSC) when off `/boards`, and a 0-round-trip same-page hash change when already on `/boards`. Expand/collapse and auto-open are client state only. Full rationale: spec §5.

---

## Task 1: `getArchivedBoards()` selects and resolves `archived_by`

**Files:**

- Modify: `src/lib/boards/trash-queries.ts` (lines ~46–61, `getArchivedBoards`)
- Test: `src/lib/boards/trash-queries.test.ts`

**Context:** `boards.archived_by` is `string | null` and already typed in
`src/types/database.types.ts` — no regeneration. The name-resolution pattern to copy is in
`src/lib/boards/queries.ts` `listSharedBoards` (~lines 84–89): distinct ids →
`profiles.select("id, full_name").in("id", ids)` → `Map` → look up. Board archive is
owner-only so `archived_by` is the current user today, but resolve generically.

**Test-harness note:** the existing mock in `trash-queries.test.ts` returns `calls.rows` for
_every_ `from()` and its chain has **no `in()`** method. To test the profiles lookup you must
extend the mock: add `in()` to the chain, and have `then` return board rows vs profile rows
based on the last captured table name (`calls.from`). Steps below do this.

- [ ] **Step 1: Extend the test mock chain to support `in()` and per-table rows**

In `src/lib/boards/trash-queries.test.ts`, add an `in` recorder to the `calls` object and a
`profileRows` bucket, add `in()` to `makeChain()`, and make `then` resolve per table. Replace
the `calls` hoisted object, `makeChain`, and `afterEach` reset with:

```ts
const calls = vi.hoisted(() => ({
  from: [] as string[],
  eq: [] as [string, unknown][],
  is: [] as [string, unknown][],
  not: [] as [string, string, unknown][],
  in: [] as [string, unknown][],
  order: [] as unknown[],
  limit: [] as number[],
  rows: [] as unknown[], // boards rows
  profileRows: [] as unknown[], // profiles rows
}));

function makeChain(table: string) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      calls.eq.push([col, val]);
      return chain;
    },
    is: (col: string, val: unknown) => {
      calls.is.push([col, val]);
      return chain;
    },
    not: (col: string, op: string, val: unknown) => {
      calls.not.push([col, op, val]);
      return chain;
    },
    in: (col: string, val: unknown) => {
      calls.in.push([col, val]);
      return chain;
    },
    order: (o: unknown) => {
      calls.order.push(o);
      return chain;
    },
    limit: (n: number) => {
      calls.limit.push(n);
      return chain;
    },
    then: (onF: (r: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({
        data: table === "profiles" ? calls.profileRows : calls.rows,
        error: null,
      }).then(onF),
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    from: (table: string) => {
      calls.from.push(table);
      return makeChain(table);
    },
  })),
}));
```

And extend the `afterEach` reset to clear the new buckets:

```ts
afterEach(() => {
  vi.clearAllMocks();
  calls.from.length = 0;
  calls.eq.length = 0;
  calls.is.length = 0;
  calls.not.length = 0;
  calls.in.length = 0;
  calls.order.length = 0;
  calls.limit.length = 0;
  calls.rows.length = 0;
  calls.profileRows.length = 0;
  getUser.mockResolvedValue({ id: "u1", email: "u@x.com" } as unknown);
});
```

- [ ] **Step 2: Write the failing tests for `archived_by` selection + name resolution**

Update the existing "filters to the current user's archived boards" test's fixture to include
`archived_by`, and add two new tests. Replace the first `it(...)` body's fixture + assertions
and append the new cases:

```ts
it("selects archived_by and resolves it to a display name via one profiles lookup", async () => {
  calls.rows.push({
    id: "b1",
    name: "Old board",
    workspace_id: "w1",
    archived_at: "2026-07-06T00:00:00Z",
    archived_by: "u1",
  });
  calls.profileRows.push({ id: "u1", full_name: "Ada Lovelace" });

  const result = await getArchivedBoards();

  expect(calls.from).toContain("boards");
  expect(calls.from).toContain("profiles");
  // exactly one profiles lookup, keyed by the distinct archived_by ids
  expect(calls.from.filter((t) => t === "profiles")).toHaveLength(1);
  expect(calls.in).toContainEqual(["id", ["u1"]]);
  expect(result).toEqual([
    {
      id: "b1",
      name: "Old board",
      workspace_id: "w1",
      archived_at: "2026-07-06T00:00:00Z",
      archived_by: "u1",
      archived_by_name: "Ada Lovelace",
    },
  ]);
});

it("skips the profiles lookup when no board has a non-null archived_by", async () => {
  calls.rows.push({
    id: "b1",
    name: "Old board",
    workspace_id: "w1",
    archived_at: "2026-07-06T00:00:00Z",
    archived_by: null,
  });

  const result = await getArchivedBoards();

  expect(calls.from).not.toContain("profiles");
  expect(result[0]!.archived_by_name).toBeNull();
});
```

Also update the pre-existing first test so its fixture carries `archived_by: null` and its
expected object includes `archived_by: null, archived_by_name: null` (so it still passes once
the shape widens).

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test src/lib/boards/trash-queries.test.ts`
Expected: FAIL — result objects lack `archived_by`/`archived_by_name`; `profiles` never queried.

- [ ] **Step 4: Implement `archived_by` selection + name resolution**

Replace `getArchivedBoards` in `src/lib/boards/trash-queries.ts` with:

```ts
export type ArchivedBoardRow = Pick<
  Tables<"boards">,
  "id" | "name" | "workspace_id" | "archived_at" | "archived_by"
> & { archived_by_name: string | null };

/**
 * Workspace Trash: the archived boards the current user owns. Scoped to
 * `created_by = me` (board archive is owner-only, so Trash is the owner's list),
 * bounded (`limit 200`), served by the boards archived partial index. Resolves
 * `archived_by` -> display name via one bounded `profiles` lookup (mirrors
 * `listSharedBoards`); skipped entirely when nothing is archived-by anyone.
 */
export async function getArchivedBoards(): Promise<ArchivedBoardRow[]> {
  const user = await getUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("boards")
    .select("id, name, workspace_id, archived_at, archived_by")
    .eq("created_by", user.id)
    .not("archived_at", "is", null)
    .order("archived_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  const rows = data ?? [];

  const archiverIds = [
    ...new Set(
      rows.map((b) => b.archived_by).filter((id): id is string => !!id),
    ),
  ];
  const nameById = new Map<string, string | null>();
  if (archiverIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", archiverIds);
    for (const p of profiles ?? []) nameById.set(p.id, p.full_name);
  }

  return rows.map((b) => ({
    id: b.id,
    name: b.name,
    workspace_id: b.workspace_id,
    archived_at: b.archived_at,
    archived_by: b.archived_by,
    archived_by_name: b.archived_by
      ? (nameById.get(b.archived_by) ?? null)
      : null,
  }));
}
```

Leave `getBoardTrash` above it unchanged.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test src/lib/boards/trash-queries.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. (If `page.tsx` errors on the wider shape, that's fixed in Task 2 Step 6 — but
it should not, since `ArchivedBoardsSection` still accepts the same field names plus extras.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/boards/trash-queries.ts src/lib/boards/trash-queries.test.ts
git commit -m "feat(boards): resolve archived_by name in getArchivedBoards"
```

---

## Task 2: `ArchivedBoardsSection` — caption, hash anchor, auto-open

**Files:**

- Modify: `src/components/boards/ArchivedBoardsSection.tsx` (type ~22–27; `<section>` ~87; row ~108–118; add mount effect)
- Modify: `src/app/(app)/boards/page.tsx` (verify passthrough only)
- Test: `src/components/boards/ArchivedBoardsSection.test.tsx`

**Context:** `timeAgo` is in `src/lib/boards/automation-runs.ts`; `BoardTrashDialog.tsx`'s
`TrashRow` (~lines 359–364) is the caption pattern: a `truncate text-sm font-medium` name over
a `text-muted-foreground text-xs` caption. Use `pulse-ui` tokens only (no raw colors). The
section currently renders `board.name` in a single `<span>` (lines ~116–118).

- [ ] **Step 1: Write the failing tests for the caption, fallback, and anchor**

In `src/components/boards/ArchivedBoardsSection.test.tsx`, widen the `boards` fixture and add
assertions. Update the fixture to include `archived_by`/`archived_by_name`:

```ts
const boards = [
  {
    id: "b1",
    name: "Old roadmap",
    workspace_id: "w1",
    archived_at: "2026-07-06T00:00:00Z",
    archived_by: "u1",
    archived_by_name: "Ada Lovelace",
  },
  {
    id: "b2",
    name: "Q1 plan",
    workspace_id: "w1",
    archived_at: "2026-07-05T00:00:00Z",
    archived_by: null,
    archived_by_name: null,
  },
];
```

Then add a test (the section starts collapsed, so open it first to see rows):

```ts
it("captions each row with archiver + relative time, falling back when unknown", async () => {
  const user = userEvent.setup();
  render(<ArchivedBoardsSection boards={boards} />);
  await user.click(screen.getByRole("button", { name: /archived boards/i }));

  expect(screen.getByText(/archived by Ada Lovelace,/i)).toBeInTheDocument();
  // b2 has no archiver name -> "archived {timeAgo}" with no "by"
  const q1 = screen.getByText("Q1 plan").closest("li")!;
  expect(within(q1).getByText(/^archived /i)).toBeInTheDocument();
  expect(within(q1).queryByText(/archived by/i)).not.toBeInTheDocument();
});

it("exposes an #archived hash target on the section", () => {
  const { container } = render(<ArchivedBoardsSection boards={boards} />);
  expect(container.querySelector("section#archived")).not.toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test src/components/boards/ArchivedBoardsSection.test.tsx`
Expected: FAIL — no caption text, no `section#archived`; TS errors on new fixture fields.

- [ ] **Step 3: Widen the `ArchivedBoard` type + import `timeAgo`**

In `ArchivedBoardsSection.tsx`, add the import (top of file, with the other `@/lib` imports):

```ts
import { timeAgo } from "@/lib/boards/automation-runs";
```

Replace the `ArchivedBoard` type (lines ~22–27) with:

```ts
export type ArchivedBoard = {
  id: string;
  name: string;
  workspace_id: string;
  archived_at: string | null;
  archived_by: string | null;
  archived_by_name: string | null;
};
```

- [ ] **Step 4: Add the hash anchor + auto-open effect**

Add `useEffect` to the existing React import:

```ts
import { useEffect, useState, useTransition } from "react";
```

Inside `ArchivedBoardsSection`, after the `useState`/`useTransition` hooks and **before** the
`if (rows.length === 0) return null;` guard, add:

```ts
// Landing on /boards#archived (the sidebar Trash link) opens the list. Handles
// both a fresh mount and a same-page hash change (Link to the current pathname
// doesn't remount the RSC), so clicking Trash while already on /boards expands it.
useEffect(() => {
  const openIfHash = () => {
    if (window.location.hash === "#archived") setOpen(true);
  };
  openIfHash();
  window.addEventListener("hashchange", openIfHash);
  return () => window.removeEventListener("hashchange", openIfHash);
}, []);
```

Add `id="archived"` and a scroll offset to the `<section>` (line ~87):

```tsx
<section id="archived" className="bg-surface scroll-mt-4 rounded-md border">
```

- [ ] **Step 5: Render the name + caption in each row**

Replace the single name `<span>` (lines ~116–118) with a two-line cell:

```tsx
<div className="min-w-0 flex-1">
  <p className="truncate text-sm">{board.name}</p>
  {board.archived_at ? (
    <p className="text-muted-foreground truncate text-xs">
      {board.archived_by_name
        ? `archived by ${board.archived_by_name}, ${timeAgo(board.archived_at)}`
        : `archived ${timeAgo(board.archived_at)}`}
    </p>
  ) : null}
</div>
```

- [ ] **Step 6: Verify `page.tsx` passthrough**

Open `src/app/(app)/boards/page.tsx`. It passes `getArchivedBoards()` straight into
`<ArchivedBoardsSection boards={archivedBoards} />` with no local annotation, so the wider
shape flows through with no edit needed. Only touch it if `pnpm typecheck` flags a mismatch
(it should not). Do **not** commit an unchanged file.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm test src/components/boards/ArchivedBoardsSection.test.tsx`
Expected: PASS (caption, fallback, anchor).

- [ ] **Step 8: Typecheck + lint the touched files**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/components/boards/ArchivedBoardsSection.tsx src/components/boards/ArchivedBoardsSection.test.tsx
git commit -m "feat(boards): show archived_by in Trash rows + #archived anchor"
```

---

## Task 3: Sidebar "Trash" nav link

**Files:**

- Modify: `src/components/shell/sidebar-nav.tsx` (imports ~5; consts ~28–35; expanded render ~190–200)
- Test: `src/components/shell/sidebar-nav.test.tsx`

**Context:** `ALL_LINKS` drives the **collapsed** icon rail; **expanded** mode renders groups
individually (`HOME` link, `Planning` section, `BoardsNav`, `DashboardsNav`, `Personal`
section). To appear in both, `TRASH` goes into `ALL_LINKS` (rail) **and** gets a standalone
`ExpandedLink` at the bottom of expanded mode.

- [ ] **Step 1: Write the failing test for the Trash link**

In `src/components/shell/sidebar-nav.test.tsx`, add (adapt `renderNav` + any required props
from the existing tests in the file — reuse the same `SidebarNav` props the other tests use):

```ts
it("renders a Trash link to the workspace archived-boards hash", () => {
  useUIStore.setState({ sidebarCollapsed: false, hasHydrated: true });
  renderNav(
    <SidebarNav
      boards={[]}
      sharedBoards={[]}
      workspaces={[]}
      dashboards={[]}
    />,
  );
  const trash = screen.getByRole("link", { name: /trash/i });
  expect(trash).toHaveAttribute("href", "/boards#archived");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/components/shell/sidebar-nav.test.tsx`
Expected: FAIL — no link named "Trash".

- [ ] **Step 3: Add the `TRASH` const + `Trash2` import**

In `sidebar-nav.tsx`, add `Trash2` to the lucide import (line ~5):

```ts
import {
  BarChart3,
  Clock,
  Gauge,
  ListTodo,
  Target,
  Trash2,
} from "lucide-react";
```

Add the const and append to `ALL_LINKS` (after `PERSONAL`, ~line 34–35):

```ts
const TRASH: NavLink = {
  label: "Trash",
  href: "/boards#archived",
  icon: Trash2,
};
const ALL_LINKS: NavLink[] = [HOME, ...PLANNING, ...PERSONAL, TRASH];
```

- [ ] **Step 4: Render the expanded standalone Trash link**

In expanded mode, add a standalone `ExpandedLink` at the **bottom** of the nav — immediately
after the closing of the `Personal` `NavSection` block (the last `!isCollapsed ? (...) : null`
around lines ~190–200), still inside the outer `<div>`:

```tsx
{
  !isCollapsed ? (
    <nav className="flex flex-col gap-0.5 px-2 pb-2">
      <ExpandedLink item={TRASH} active={isActive(TRASH.href)} />
    </nav>
  ) : null;
}
```

(The collapsed rail already renders `TRASH` via `ALL_LINKS.map(...)` — no change there.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test src/components/shell/sidebar-nav.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/shell/sidebar-nav.tsx src/components/shell/sidebar-nav.test.tsx
git commit -m "feat(shell): add top-level Trash nav link to /boards#archived"
```

---

## Task 4: Full gate + finish

**Files:** none (verification only).

- [ ] **Step 1: Run the full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all PASS. If `build` fails on a stale `.next/types` after typecheck (known repo
trap), re-run `pnpm build` once, then continue.

- [ ] **Step 2: Manual smoke (optional but recommended)**

Start the app, archive a board, go to `/boards`, click the sidebar **Trash** link: the
Archived boards list should auto-expand and show "archived by {you}, {time} ago". See the
"How to test" walkthrough handed to the user at closure.

- [ ] **Step 3: Finish the task**

Run `scripts/finish-task.sh` from inside the worktree (rebases onto latest `develop`, runs the
gates against the merged state, merges `task/trash-followups` into `develop`, removes the
worktree + branch). Do not report done until it has merged.

---

## Self-review (against the spec)

- **Spec §2 (nav link):** Task 3. ✔ href `/boards#archived`, both modes, bottom placement.
- **Spec §3 (archived_by):** Task 1 (query+resolve) + Task 2 (type+caption). ✔
- **Spec §3.2 (hash anchor):** Task 2 Step 4 (`id="archived"`). ✔
- **Spec §4 (auto-open):** Task 2 Step 4 (mount + `hashchange`). ✔
- **Spec §5 (budget):** DAG section + no extra hot-path reads; one bounded profiles query. ✔
- **Spec §7 (tests):** Task 1 (query), Task 2 (caption+fallback+anchor), Task 3 (nav). ✔
- **Type consistency:** `archived_by_name` used identically in Tasks 1–2; `ArchivedBoardRow`
  (query) is structurally the same field set as `ArchivedBoard` (component prop). ✔
- **No placeholders:** every code step shows full code. ✔

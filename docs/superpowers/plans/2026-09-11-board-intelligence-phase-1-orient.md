# Board Intelligence — Phase 1 (Orient) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a deterministic "Intelligence" strip under every board header — overdue / blocked / overloaded / stalled / changed-since chips computed client-side from the payload already in memory — whose chips filter all four views, plus a `board_visits` last-seen stamp that powers "changed since".

**Architecture:** A pure signals engine (`src/lib/boards/intelligence/`) computes `Signal[]` from the live board cache. A client provider mounted in `BoardViews` memoizes the signals, reads the active chip from a new `intel=<kind>[:<subject>]` URL param in the existing board filter state (History API, zero RSC re-runs), and exposes a stable `intelItemIds` set. Views narrow their item list with one shared helper; row components read a per-row `boolean | null` and paint a 2px tone rule / 35% dim. The only server work is one PK read on `board_visits` at first paint and one Server Action write per visit.

**Tech Stack:** Next.js 16 App Router (RSC + Server Actions), Supabase (Postgres RLS, versioned migrations), Zod, Zustand-free React context, Tailwind v4 + pulse-ui tokens, Vitest + RTL.

**Scope of this plan:** spec §2.1 strip (chips + kicker + clear only — the "Catch me up" pill and "updated Xm ago" meta belong to Phase 2 and are NOT built here), §3 (signals, filter integration, `board_visits`), the Phase-1 rows of §7, §8, §10. The dock (§2.2) is untouched. Phases 2–4 are out of scope.

## Global Constraints

- **Next.js 16** — confirm any framework API against `node_modules/next/dist/docs/` before using it. Relevant pages, already verified: `01-app/01-getting-started/04-linking-and-navigating.md` §"Native History API" (`window.history.pushState/replaceState` sync into `useSearchParams()` with no RSC re-run) and `01-app/01-getting-started/07-mutating-data.md` (`"use server"` file-level directive; always verify auth inside the function — RLS does that here).
- **Server Components by default; Server Actions for all mutations; Zod at the boundary.** The one mutation (`touchBoardVisit`) is a `"use server"` module returning `ActionResult` from `src/lib/actions/result.ts` (`fail()` for errors), calling the DB through `typedRpc` from `src/lib/supabase/typed-rpc.ts`. Never re-declare these shapes.
- **`"use server"` modules export ONLY async functions** — no `export type { … }` clauses (`src/test/use-server-exports.test.ts` fails the build otherwise). Types live in a plain module.
- **RLS is the security boundary**: `board_visits` is default-deny, own rows only, AND `public.can_read_board(board_id)` (the existing org+membership predicate, `supabase/migrations/20260621000000_board_access_require_membership_and_returning.sql`). Every new SQL function gets `revoke execute … from public, anon; grant execute … to authenticated;` in the SAME migration (the anon conformance probe in `src/test/anon-conformance.ts` calls every public function as `anon` and fails on anything but 42501/PGRST202).
- **Migrations are minted ONLY via `scripts/new-migration.sh <slug>`**, applied to DEV via the `supabase-dev` MCP `apply_migration` with the **same version + name** as the file, then verified with `pnpm db:ledger-check`. In a task worktree `pnpm db:types` throws `LegacyProjectNotLinkedError` — regenerate with the `supabase-dev` MCP `generate_typescript_types`, write the output to `src/types/database.types.ts`, run `pnpm prettier --write src/types/database.types.ts`, commit types with the migration. **Never hand-edit `database.types.ts`.**
- **DEV holds the live user-facing data** (AGENTS.md) — the migration is additive only; no destructive statements.
- **Stage by path only** (`git add <paths>`); never `git add -A` / `-a`. Commit identity is pinned by `scripts/start-task.sh` (`Danijel Jovanovic <info@synapse-solutions.ai>`) — do not override. Conventional commit messages (`feat(boards): …`, `test: …`, `db: …`).
- **pulse-ui design system** (`.claude/skills/pulse-ui/SKILL.md`): semantic tokens only (no raw Tailwind colours, no `text-[NNpx]` — `scripts/check-px-text.mjs` fails lint; no `hover:bg-accent|muted|secondary` — `scripts/check-hover-tokens.mjs` fails lint; use `hover:bg-state-hover`). Chips are `rounded-sm` hairline pills; hairlines brighten (`hover:border-border-hover`) never thicken; kicker via `<Kicker>` (`src/components/ui/kicker.tsx`); status colour only via the `--status-*` tokens; **no AI badge, no glow, no sparkle icon**; label is "Intelligence" everywhere. Icons: lucide-react.
- **Performance budget (spec §8, Phase 1 rows)** — see the section below; every task's requirements implicitly include it.
- **Tests are mandatory** and co-located (`*.test.ts(x)`, Vitest + RTL, jsdom). Gates before every commit of a task and again at the end: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- **Worktree discipline**: build in a `task/<name>` worktree cut by `scripts/start-task.sh board-intelligence-orient`; finish with `scripts/finish-task.sh` (merges into `develop`, removes the worktree). A task is not done until merged and cleaned up.

## Performance & data-fetching budget (spec §8, restricted to Phase 1)

- **First paint**: the board payload exactly as today (`getBoardPayload`, `src/lib/boards/queries.ts:194`) **plus one primary-key point read** on `board_visits` (`(board_id, user_id)` PK) issued inside the page's existing `Promise.all` (`src/app/(app)/boards/[boardId]/page.tsx:28-49`). Signals are computed client-side from the payload/cache and memoized (`useMemo` over the cache object identity) alongside the existing filter derivations. Zero LLM calls, zero additional list reads.
- **In-page interactions**: chip activate / clear = client state mirrored to the URL with `window.history.replaceState` → `useSearchParams()` re-renders the client tree; **0 server round-trips, no `<Link>`/`router` navigation**. Narrowing is an in-memory filter over the already-loaded cache, exactly like quick search.
- **Server-touching interactions**: none in-page. The visit write is one Server Action (`touchBoardVisit`) fired **once per visit** (on `visibilitychange → hidden`, `pagehide`, or unmount; a `sent` ref prevents duplicates until the tab is visible again). Failure is silent. It does NOT call `revalidatePath` (per-user chrome — the gotcha-09 regression).
- **Bounded reads**: `board_visits` read is a PK point lookup; the write is a PK upsert. No new list reads, no new indexes needed beyond the PK.
- **Render cost guard**: row components subscribe to a dedicated `IntelMatchContext` whose value is `null` when no chip is active and a Set whose identity only changes when its contents change — so the existing `BoardTable.render-count.test.tsx` invariant (foreign cell edits don't re-render every row) still holds.

## File structure

**Create**

| File                                                               | Responsibility                                                                                                                          |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/boards/intelligence/types.ts`                             | `SignalKind`, `SignalTone`, `Signal`, `IntelSelection` (plain module; safe for client + server + `"use server"` importers)              |
| `src/lib/boards/intelligence/constants.ts`                         | `STALL_DAYS`, `OVERLOAD_RATIO`, `MAX_CHIPS`, `SIGNAL_ORDER`, `SIGNAL_TONE`, label/column regexes                                        |
| `src/lib/boards/intelligence/signals.ts`                           | pure `computeSignals`, `stripSignals`, `narrowItemsToSignal`, `findActiveSignal`, `signalSelection`, `latestActivityISO`, `formatSince` |
| `src/lib/boards/intelligence/signals.test.ts`                      | table tests per kind, ordering, truncation, narrowing                                                                                   |
| `src/lib/validations/board-intelligence.ts`                        | Zod `touchBoardVisitSchema`                                                                                                             |
| `src/lib/boards/intelligence/visits.ts`                            | `getBoardLastSeenAt(supabase, boardId, userId)` — PK point read (mirrors `src/lib/boards/view-prefs.ts`)                                |
| `src/lib/boards/intelligence/visits.test.ts`                       | read helper tests (mocked client)                                                                                                       |
| `src/lib/boards/intelligence/visit-actions.ts`                     | `"use server"` `touchBoardVisit(boardId)`                                                                                               |
| `src/lib/boards/intelligence/visit-actions.test.ts`                | action tests (mocked client)                                                                                                            |
| `src/lib/boards/intelligence/use-board-visit.ts`                   | client hook `useBoardVisitTouch(boardId, enabled)`                                                                                      |
| `src/lib/boards/intelligence/use-board-visit.test.tsx`             | hook tests                                                                                                                              |
| `src/lib/boards/intelligence/board-visits.rls.integration.test.ts` | RLS probes (skips unless `PULSE_TEST_DB`)                                                                                               |
| `src/lib/boards/intelligence/context.tsx`                          | `BoardIntelligenceProvider`, `useBoardIntelligenceOptional`, `useIntelItemIds`, `useIntelMatch`, `IntelToneFrame`                       |
| `src/lib/boards/intelligence/context.test.tsx`                     | provider derivations                                                                                                                    |
| `src/components/boards/IntelligenceStrip.tsx`                      | strip UI (kicker, chips, zero-state, clear, skeleton)                                                                                   |
| `src/components/boards/IntelligenceStrip.test.tsx`                 | RTL tests                                                                                                                               |
| `src/components/boards/BoardTable.intel.test.tsx`                  | table narrows + highlights                                                                                                              |
| `src/components/boards/KanbanBoard.intel.test.tsx`                 | kanban narrows + highlights                                                                                                             |
| `src/components/boards/GanttBoard.intel.test.tsx`                  | timeline narrows + highlights                                                                                                           |
| `supabase/migrations/<stamp>_board_visits.sql`                     | table + RLS + `touch_board_visit` RPC + execute lockdown                                                                                |

**Modify**

| File                                                                         | Change                                                                    |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `src/lib/boards/board-filter.ts`                                             | `BoardFilterState.intel`, `URL_PARAM_KEYS`, `parseIntel`/`serializeIntel` |
| `src/lib/boards/board-filter.test.ts`                                        | add `intel: null` to the one state literal; intel round-trip tests        |
| `src/lib/boards/use-board-filter-sort.ts`                                    | parse `intel`, `setIntel`, `clearAll` clears it                           |
| `src/lib/boards/use-board-filter-sort.test.tsx`                              | `setIntel` tests                                                          |
| `src/app/(app)/boards/[boardId]/page.tsx`                                    | read `lastSeenAt`, pass to `BoardViews`                                   |
| `src/components/boards/BoardViews.tsx`                                       | `lastSeenAt` prop; mount provider, visit touch, tone frame                |
| `src/components/boards/BoardViews.test.tsx`                                  | new prop + mocks                                                          |
| `src/components/offline/OfflineBoard.tsx`                                    | `lastSeenAt={null}`                                                       |
| `src/components/boards/BoardHeader.tsx`                                      | render `<IntelligenceStrip />` after the `<header>`                       |
| `src/components/boards/table/BoardTableInner.tsx`                            | narrow with `narrowItemsToSignal`                                         |
| `src/components/boards/table/ItemRow.tsx`                                    | `useIntelMatch` → `intel-match` / `intel-miss`                            |
| `src/components/boards/KanbanBoard.tsx`                                      | narrow; card highlight                                                    |
| `src/components/boards/CalendarBoard.tsx`                                    | narrow `shared.items`                                                     |
| `src/components/boards/calendar/EventBar.tsx`, `calendar/CalendarAgenda.tsx` | highlight/dim                                                             |
| `src/components/boards/GanttBoard.tsx`, `gantt/GanttRowItem.tsx`             | narrow; row highlight/dim                                                 |
| `src/app/globals.css`                                                        | `[data-intel-tone]` rule + `.intel-match` / `.intel-miss`                 |
| `src/types/database.types.ts`                                                | regenerated (never hand-edited)                                           |

## Execution DAG

**Dependency graph**

- Task 1 (types + constants + `computeSignals` overdue) — no deps.
- Task 2 (blocked + stalled) — depends on Task 1 (same file `signals.ts`).
- Task 3 (overloaded + changed + ordering/truncation + narrowing/selection helpers) — depends on Task 2 (same file).
- Task 4 (`board_visits` migration, read helper, Server Action, client hook, RLS test) — no deps on 1–3. **Touches `database.types.ts` and mints a migration → must be the only migration-bearing branch merging at that moment.**
- Task 5 (`intel` URL param, hook `setIntel`, `BoardIntelligenceProvider`, page/BoardViews wiring, view narrowing in all four views) — depends on Task 3 (`Signal`, `narrowItemsToSignal`, `findActiveSignal`, `signalSelection`, `latestActivityISO`) and Task 4 (`getBoardLastSeenAt`, `useBoardVisitTouch`).
- Task 6 (row highlight/dim: CSS + ItemRow/KanbanCard/EventBar/Agenda/GanttRowItem + view tests) — depends on Task 5 (`useIntelMatch`, `IntelToneFrame`).
- Task 7 (`IntelligenceStrip` + mount in `BoardHeader`) — depends on Task 5 (`useBoardIntelligenceOptional`, `MAX_CHIPS`).
- Task 8 (final gates + How-to-test) — depends on 6 and 7.

**Parallel batches**

- Batch A: Task 1 ∥ Task 4
- Batch B: Task 2 (then Task 3 — sequential, single file)
- Batch C: Task 5
- Batch D: Task 6 ∥ Task 7 (disjoint files: 6 = rows/views/CSS, 7 = strip/BoardHeader)
- Batch E: Task 8

**Critical path:** 1 → 2 → 3 → 5 → 6 (or 7) → 8. Task 4 hides entirely under 1–3. If Batch D runs as two worktrees, the orchestrator merges them one at a time (`superpowers:dispatching-parallel-agents`; agents gate + commit, orchestrator merges). Task 4's migration lands through the orchestrator so `database.types.ts` never races.

---

### Task 1: Signal types, constants and `computeSignals` with the `overdue` kind

**Files:**

- Create: `src/lib/boards/intelligence/types.ts`
- Create: `src/lib/boards/intelligence/constants.ts`
- Create: `src/lib/boards/intelligence/signals.ts`
- Test: `src/lib/boards/intelligence/signals.test.ts`

**Interfaces:**

- Consumes (existing): `firstStatusColumn`, `isStatusValueComplete`, `isOverdue`, `localTodayISO` from `src/lib/boards/overdue.ts` (signatures: `firstStatusColumn<T extends {id,kind,position,settings}>(columns: readonly T[]): T | null`; `isStatusValueComplete(value: unknown, statusColumn: {settings} | null): boolean`; `isOverdue(value: unknown, todayISO: string): boolean`; `localTodayISO(now?: Date): string`). `cellKey(itemId, columnId): string` and `buildCellMap(cellValues)` from `src/lib/boards/cache.ts`. `BoardCache` type from `src/lib/boards/cache.ts` (client-safe mirror of `BoardPayload`; `items: Tables<"items">[]` carry `updated_at: string`, `parent_id: string | null`, `group_id`; `cellValues: {item_id, column_id, value, updated_at}[]`; `dependencies: Tables<"item_dependencies">[]` with `predecessor_id`/`successor_id`).
- Produces (later tasks rely on these exact names):
  - `types.ts`: `SignalKind`, `SignalTone`, `Signal`, `IntelSelection`
  - `constants.ts`: `STALL_DAYS = 5`, `OVERLOAD_RATIO = 1.25`, `MAX_CHIPS = 5`, `SIGNAL_ORDER`, `SIGNAL_TONE`, `BLOCKED_LABEL`, `EFFORT_COLUMN_NAME`
  - `signals.ts`: `type SignalsInput = Pick<BoardCache, "items" | "columns" | "cellValues" | "groups" | "dependencies">`, `type SignalsOptions = { now: Date; lastSeenAt: Date | null; currentUserId: string; memberNames?: ReadonlyMap<string, string> }`, `computeSignals(input: SignalsInput, opts: SignalsOptions): Signal[]`

Spec deviation, recorded: `computeSignals` takes `SignalsInput` (a structural `Pick` of the client `BoardCache`) rather than the server `BoardPayload` — `BoardPayload` is a superset so it is still accepted, and the client provider passes the live React-Query cache (which reflects optimistic + realtime edits) instead of the first-paint payload. `memberNames` is an added optional field so "overloaded · Ana" can carry a name without a server lookup.

- [ ] **Step 1: Write the failing test (overdue kind + empty board)**

Create `src/lib/boards/intelligence/signals.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { localTodayISO } from "@/lib/boards/overdue";
import { computeSignals, type SignalsInput } from "./signals";
import type { Signal } from "./types";

// Fri 11 Sep 2026 12:00 LOCAL. Weekday-dependent labels ("changed since Tue")
// are computed in local time, so the fixture clock is local too.
export const NOW = new Date(2026, 8, 11, 12, 0, 0);
const DAY = 86_400_000;
export const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);
const iso = (d: Date) => d.toISOString();
/** Viewer-local YYYY-MM-DD `n` days before NOW (negative = future). */
export const dateISO = (n: number) => localTodayISO(daysAgo(n));

export const STATUS = "c-status";
export const DATE = "c-date";
export const PEOPLE = "c-people";
export const EFFORT = "c-effort";
export const OPEN = "opt-open";
export const STUCK = "opt-stuck";
export const DONE = "opt-done";

export function column(
  id: string,
  kind: string,
  name: string,
  position: number,
  settings: unknown = {},
): SignalsInput["columns"][number] {
  return {
    id,
    board_id: "b1",
    org_id: "o1",
    name,
    kind,
    position,
    settings,
    width: null,
  } as unknown as SignalsInput["columns"][number];
}

export function item(
  id: string,
  over: Partial<{
    group_id: string;
    parent_id: string | null;
    updated_at: string;
  }> = {},
): SignalsInput["items"][number] {
  return {
    id,
    board_id: "b1",
    org_id: "o1",
    group_id: "g1",
    parent_id: null,
    name: id,
    position: 0,
    created_by: "u0",
    created_at: iso(daysAgo(30)),
    updated_at: iso(daysAgo(30)),
    archived_at: null,
    archived_by: null,
    ...over,
  };
}

export function group(id: string): SignalsInput["groups"][number] {
  return {
    id,
    board_id: "b1",
    org_id: "o1",
    name: id,
    color: "#0073ea",
    position: 0,
  } as unknown as SignalsInput["groups"][number];
}

export function cell(
  item_id: string,
  column_id: string,
  value: unknown,
  updated_at = iso(daysAgo(30)),
): SignalsInput["cellValues"][number] {
  return {
    item_id,
    column_id,
    value,
    updated_at,
  } as SignalsInput["cellValues"][number];
}

export function dep(
  predecessor_id: string,
  successor_id: string,
): SignalsInput["dependencies"][number] {
  return {
    id: `${predecessor_id}->${successor_id}`,
    board_id: "b1",
    org_id: "o1",
    predecessor_id,
    successor_id,
    type: "finish_to_start",
    created_at: iso(daysAgo(30)),
  };
}

/** A board with the four column kinds the engine reads; override per test. */
export function board(over: Partial<SignalsInput> = {}): SignalsInput {
  return {
    columns: [
      column(STATUS, "status", "Status", 0, {
        options: [
          { id: OPEN, label: "Working on it", color: "#fdab3d" },
          { id: STUCK, label: "Stuck", color: "#e2445c" },
          { id: DONE, label: "Done", color: "#00c875" },
        ],
      }),
      column(DATE, "date", "Due", 1),
      column(PEOPLE, "people", "Owner", 2),
      column(EFFORT, "numbers", "Effort", 3),
    ],
    groups: [group("g1")],
    items: [],
    cellValues: [],
    dependencies: [],
    ...over,
  };
}

export const opts = (
  over: Partial<Parameters<typeof computeSignals>[1]> = {},
): Parameters<typeof computeSignals>[1] => ({
  now: NOW,
  lastSeenAt: null,
  currentUserId: "me",
  ...over,
});

export const ofKind = (signals: Signal[], kind: Signal["kind"]) =>
  signals.filter((s) => s.kind === kind);

describe("computeSignals — overdue", () => {
  it("yields no signals for an empty board", () => {
    expect(computeSignals(board(), opts())).toEqual([]);
  });

  it("counts open items whose date is past; done and future items are excluded", () => {
    const input = board({
      items: [item("late"), item("late-done"), item("future"), item("no-date")],
      cellValues: [
        cell("late", STATUS, { optionId: OPEN }),
        cell("late", DATE, { date: dateISO(1) }),
        cell("late-done", STATUS, { optionId: DONE }),
        cell("late-done", DATE, { date: dateISO(1) }),
        cell("future", STATUS, { optionId: OPEN }),
        cell("future", DATE, { date: dateISO(-1) }),
        cell("no-date", STATUS, { optionId: OPEN }),
      ],
    });
    const [overdue] = ofKind(computeSignals(input, opts()), "overdue");
    expect(overdue).toMatchObject({
      kind: "overdue",
      count: 1,
      label: "overdue",
      tone: "red",
      itemIds: ["late"],
    });
  });

  it("uses the range end when a date cell carries one", () => {
    const input = board({
      items: [item("span")],
      cellValues: [
        cell("span", STATUS, { optionId: OPEN }),
        cell("span", DATE, { date: dateISO(5), end: dateISO(2) }),
      ],
    });
    expect(ofKind(computeSignals(input, opts()), "overdue")[0].count).toBe(1);
  });

  it("emits nothing (not a zero-count chip) when no item is overdue", () => {
    const input = board({
      items: [item("a")],
      cellValues: [cell("a", DATE, { date: dateISO(-3) })],
    });
    expect(ofKind(computeSignals(input, opts()), "overdue")).toEqual([]);
  });

  it("treats every item as open when the board has no status column", () => {
    const input = board({
      columns: [column(DATE, "date", "Due", 0)],
      items: [item("a")],
      cellValues: [cell("a", DATE, { date: dateISO(1) })],
    });
    expect(ofKind(computeSignals(input, opts()), "overdue")[0].itemIds).toEqual(
      ["a"],
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run --project unit src/lib/boards/intelligence/signals.test.ts`
Expected: FAIL — `Failed to resolve import "./signals"`.

- [ ] **Step 3: Write the types, constants and the overdue implementation**

Create `src/lib/boards/intelligence/types.ts`:

```ts
/**
 * Board Intelligence — Phase 1 (Orient) types. A plain module (no server-only,
 * no "use server") so the signals engine, the client provider, the strip AND
 * the Phase-2 server run can all import it.
 */
export type SignalKind =
  "overdue" | "overloaded" | "stalled" | "changed" | "blocked";

export type SignalTone = "red" | "yellow" | "gray" | "accent" | "orange";

export type Signal = {
  kind: SignalKind;
  count: number;
  /** "overdue", "overloaded · Ana", "stalled groups", "changed since Tue", "blocked chain" */
  label: string;
  tone: SignalTone;
  /** Rows the chip filter shows. */
  itemIds: string[];
  /** stalled only: the groups to keep expanded. */
  groupIds?: string[];
  /** overloaded only: the person the chip is about. */
  subjectUserId?: string;
};

/** The active chip as mirrored to the URL: `intel=<kind>[:<subject>]`. */
export type IntelSelection = { kind: SignalKind; subject?: string };
```

Create `src/lib/boards/intelligence/constants.ts`:

```ts
import type { SignalKind, SignalTone } from "./types";

/** A group is stalled when nothing in it changed for this many days (spec §3.1). */
export const STALL_DAYS = 5;
/** A person is overloaded when their open load exceeds the board median × this. */
export const OVERLOAD_RATIO = 1.25;
/** Chips the strip shows; signals beyond this stay available to the Phase-2 run. */
export const MAX_CHIPS = 5;

/** Strip order (spec §3.2): overdue, blocked, overloaded, stalled, changed. */
export const SIGNAL_ORDER: readonly SignalKind[] = [
  "overdue",
  "blocked",
  "overloaded",
  "stalled",
  "changed",
] as const;

/** Tone per kind — status colours are the only sanctioned multi-colour set (pulse-ui). */
export const SIGNAL_TONE: Record<SignalKind, SignalTone> = {
  overdue: "red",
  blocked: "orange",
  overloaded: "yellow",
  stalled: "gray",
  changed: "accent",
};

/**
 * Status option labels that read as "blocked" — the same label-regex idiom
 * `src/lib/boards/overdue.ts` uses for done (/done|complete/i). The default
 * status column ships a "Stuck" option (`src/lib/boards/column-defaults.ts`).
 */
export const BLOCKED_LABEL = /stuck|blocked/i;

/** Numbers columns that weight a person's load, by name. Absent → weight 1 per item. */
export const EFFORT_COLUMN_NAME = /effort|estimate|points|hours/i;
```

Create `src/lib/boards/intelligence/signals.ts` (Task 1 version — later tasks add kinds to `KIND_BUILDERS`):

```ts
import type { BoardCache, CacheColumn } from "@/lib/boards/cache";
import { buildCellMap, cellKey } from "@/lib/boards/cache";
import {
  firstStatusColumn,
  isOverdue,
  isStatusValueComplete,
  localTodayISO,
} from "@/lib/boards/overdue";
import { SIGNAL_ORDER, SIGNAL_TONE } from "./constants";
import type { Signal, SignalKind } from "./types";

/**
 * Deterministic board signals, computed client-side from the payload already
 * in memory (spec §3). Pure and synchronous: no clock reads, no DB — `now` and
 * `lastSeenAt` are inputs so the result is reproducible in tests and reusable
 * by the Phase-2 server run.
 */
export type SignalsInput = Pick<
  BoardCache,
  "items" | "columns" | "cellValues" | "groups" | "dependencies"
>;

export type SignalsOptions = {
  now: Date;
  /** The caller's last visit (board_visits.last_seen_at), or null on a first visit. */
  lastSeenAt: Date | null;
  currentUserId: string;
  /** userId → display name, for "overloaded · Ana". Unknown ids read "someone". */
  memberNames?: ReadonlyMap<string, string>;
};

const DAY = 86_400_000;

/** Everything the per-kind builders share, derived once per call. */
type Ctx = {
  input: SignalsInput;
  opts: SignalsOptions;
  cellMap: Map<string, unknown>;
  statusColumn: CacheColumn | null;
  todayISO: string;
  /** itemId → ms of its latest activity (item.updated_at or any cell's updated_at). */
  lastActivity: Map<string, number>;
  isOpen: (itemId: string) => boolean;
};

function parseMs(iso: unknown): number {
  if (typeof iso !== "string") return 0;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * items.updated_at is NOT bumped by cell edits (no such trigger exists in
 * supabase/migrations), so "last activity" folds in every cell's updated_at.
 */
function buildLastActivity(input: SignalsInput): Map<string, number> {
  const map = new Map<string, number>();
  for (const it of input.items) map.set(it.id, parseMs(it.updated_at));
  for (const cv of input.cellValues) {
    const t = parseMs(cv.updated_at);
    const cur = map.get(cv.item_id);
    if (cur !== undefined && t > cur) map.set(cv.item_id, t);
  }
  return map;
}

function buildContext(input: SignalsInput, opts: SignalsOptions): Ctx {
  const cellMap = buildCellMap(input.cellValues);
  const statusColumn = firstStatusColumn(input.columns);
  const isOpen = (itemId: string) =>
    !isStatusValueComplete(
      statusColumn
        ? (cellMap.get(cellKey(itemId, statusColumn.id)) ?? null)
        : null,
      statusColumn,
    );
  return {
    input,
    opts,
    cellMap,
    statusColumn,
    todayISO: localTodayISO(opts.now),
    lastActivity: buildLastActivity(input),
    isOpen,
  };
}

function signal(kind: SignalKind, itemIds: string[], label: string): Signal {
  return {
    kind,
    count: itemIds.length,
    label,
    tone: SIGNAL_TONE[kind],
    itemIds,
  };
}

/**
 * overdue — open items with any date cell before today (viewer-local), the
 * same rule the date cell's tint uses (`isOverdue` + first-status-column
 * completeness; `ItemRow.tsx`).
 */
function overdueSignals(ctx: Ctx): Signal[] {
  const dateColumns = ctx.input.columns.filter((c) => c.kind === "date");
  if (dateColumns.length === 0) return [];
  const itemIds: string[] = [];
  for (const it of ctx.input.items) {
    if (!ctx.isOpen(it.id)) continue;
    const late = dateColumns.some((col) =>
      isOverdue(ctx.cellMap.get(cellKey(it.id, col.id)), ctx.todayISO),
    );
    if (late) itemIds.push(it.id);
  }
  return [signal("overdue", itemIds, "overdue")];
}

const KIND_BUILDERS: Record<SignalKind, (ctx: Ctx) => Signal[]> = {
  overdue: overdueSignals,
  blocked: () => [],
  overloaded: () => [],
  stalled: () => [],
  changed: () => [],
};

/** All signals with a non-zero count, in strip order. Not truncated. */
export function computeSignals(
  input: SignalsInput,
  opts: SignalsOptions,
): Signal[] {
  const ctx = buildContext(input, opts);
  const out: Signal[] = [];
  for (const kind of SIGNAL_ORDER) {
    for (const s of KIND_BUILDERS[kind](ctx)) if (s.count > 0) out.push(s);
  }
  return out;
}

export { DAY as SIGNALS_DAY_MS };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run --project unit src/lib/boards/intelligence/signals.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck + lint, then commit**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

```bash
git add src/lib/boards/intelligence/types.ts src/lib/boards/intelligence/constants.ts src/lib/boards/intelligence/signals.ts src/lib/boards/intelligence/signals.test.ts
git commit -m "feat(boards): board intelligence signal types, constants and the overdue signal"
```

### Task 2: `blocked` and `stalled` kinds

**Files:**

- Modify: `src/lib/boards/intelligence/signals.ts` (replace the `blocked`/`stalled` stubs in `KIND_BUILDERS`; add two builders above it)
- Test: `src/lib/boards/intelligence/signals.test.ts` (append)

**Interfaces:**

- Consumes: Task 1's `Ctx`, `signal()`, `KIND_BUILDERS`, `STALL_DAYS`, `BLOCKED_LABEL`; `parseColumnOptions(settings: unknown): ColumnOption[]` from `src/lib/boards/column-options.ts` (`ColumnOption = { id: string; label: string; color: string }`).
- Produces: `computeSignals` now emits `blocked` (count = number of blocker items; `itemIds` = blockers + their transitive dependents; label `"blocked chain"`) and `stalled` (count = number of stalled groups; `groupIds`; `itemIds` = the OPEN items of those groups; label `"stalled group"` / `"stalled groups"`).

Spec reading, recorded: "blocked" is an item in a status option whose label matches `/stuck|blocked/i` on the board's FIRST status column (the board has no separate "blocked flag" column kind — verified: no such kind exists in `src/lib/validations/boards.ts`), with ≥1 successor in `dependencies`. The chain follows successors transitively so the "blocked chain" filter shows everything downstream.

- [ ] **Step 1: Append the failing tests**

Append to `src/lib/boards/intelligence/signals.test.ts`:

```ts
describe("computeSignals — blocked", () => {
  it("includes the stuck blocker and its transitive dependents; count = blockers", () => {
    const input = board({
      items: [item("a"), item("b"), item("c"), item("lone")],
      cellValues: [
        cell("a", STATUS, { optionId: STUCK }),
        cell("lone", STATUS, { optionId: STUCK }),
      ],
      dependencies: [dep("a", "b"), dep("b", "c")],
    });
    const [blocked] = ofKind(computeSignals(input, opts()), "blocked");
    expect(blocked).toMatchObject({
      kind: "blocked",
      count: 1,
      label: "blocked chain",
      tone: "orange",
    });
    expect([...blocked.itemIds].sort()).toEqual(["a", "b", "c"]);
  });

  it("ignores stuck items without dependents and open items with dependents", () => {
    const input = board({
      items: [item("stuck-alone"), item("working"), item("dep")],
      cellValues: [
        cell("stuck-alone", STATUS, { optionId: STUCK }),
        cell("working", STATUS, { optionId: OPEN }),
      ],
      dependencies: [dep("working", "dep")],
    });
    expect(ofKind(computeSignals(input, opts()), "blocked")).toEqual([]);
  });

  it("recognises a 'Blocked' label, not only 'Stuck'", () => {
    const input = board({
      columns: [
        column(STATUS, "status", "Status", 0, {
          options: [{ id: "opt-b", label: "Blocked", color: "#e2445c" }],
        }),
      ],
      items: [item("a"), item("b")],
      cellValues: [cell("a", STATUS, { optionId: "opt-b" })],
      dependencies: [dep("a", "b")],
    });
    expect(ofKind(computeSignals(input, opts()), "blocked")[0].count).toBe(1);
  });
});

describe("computeSignals — stalled", () => {
  it("flags a group whose latest activity is older than STALL_DAYS and that has an open item", () => {
    const input = board({
      groups: [group("g1"), group("g2"), group("g3")],
      items: [
        item("old-open", {
          group_id: "g1",
          updated_at: daysAgo(10).toISOString(),
        }),
        item("fresh", { group_id: "g2", updated_at: daysAgo(2).toISOString() }),
        item("old-done", {
          group_id: "g3",
          updated_at: daysAgo(10).toISOString(),
        }),
        item("old-done-2", {
          group_id: "g1",
          updated_at: daysAgo(12).toISOString(),
        }),
      ],
      cellValues: [
        cell("old-open", STATUS, { optionId: OPEN }),
        cell("fresh", STATUS, { optionId: OPEN }),
        cell("old-done", STATUS, { optionId: DONE }),
        cell("old-done-2", STATUS, { optionId: DONE }),
      ],
    });
    const [stalled] = ofKind(computeSignals(input, opts()), "stalled");
    expect(stalled).toMatchObject({
      kind: "stalled",
      count: 1,
      label: "stalled group",
      tone: "gray",
      groupIds: ["g1"],
      itemIds: ["old-open"],
    });
  });

  it("a recent cell edit rescues a group whose items.updated_at is stale", () => {
    const input = board({
      items: [item("a", { updated_at: daysAgo(10).toISOString() })],
      cellValues: [
        cell("a", STATUS, { optionId: OPEN }, daysAgo(1).toISOString()),
      ],
    });
    expect(ofKind(computeSignals(input, opts()), "stalled")).toEqual([]);
  });

  it("pluralises the label for several stalled groups", () => {
    const input = board({
      groups: [group("g1"), group("g2")],
      items: [
        item("a", { group_id: "g1", updated_at: daysAgo(6).toISOString() }),
        item("b", { group_id: "g2", updated_at: daysAgo(6).toISOString() }),
      ],
    });
    const [stalled] = ofKind(computeSignals(input, opts()), "stalled");
    expect(stalled.count).toBe(2);
    expect(stalled.label).toBe("stalled groups");
  });

  it("exactly STALL_DAYS old is not yet stalled (strictly older)", () => {
    const input = board({
      items: [item("a", { updated_at: daysAgo(5).toISOString() })],
    });
    expect(ofKind(computeSignals(input, opts()), "stalled")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run --project unit src/lib/boards/intelligence/signals.test.ts`
Expected: the 7 new tests FAIL (`blocked`/`stalled` arrays are empty / `undefined` signal).

- [ ] **Step 3: Implement the two builders**

In `src/lib/boards/intelligence/signals.ts`:

Add to the imports:

```ts
import { parseColumnOptions } from "@/lib/boards/column-options";
import {
  BLOCKED_LABEL,
  SIGNAL_ORDER,
  SIGNAL_TONE,
  STALL_DAYS,
} from "./constants";
```

(replace the earlier `import { SIGNAL_ORDER, SIGNAL_TONE } from "./constants";` line.)

Insert these two functions directly above `const KIND_BUILDERS`:

```ts
/**
 * blocked — items whose FIRST-status-column option label matches
 * BLOCKED_LABEL and that have at least one successor in `dependencies`.
 * `itemIds` = each blocker plus everything downstream of it (transitive
 * successors), so the chip shows the whole chain. count = blockers.
 */
function blockedSignals(ctx: Ctx): Signal[] {
  const statusCol = ctx.statusColumn;
  if (!statusCol || ctx.input.dependencies.length === 0) return [];
  const blockedOptionIds = new Set(
    parseColumnOptions(statusCol.settings)
      .filter((o) => BLOCKED_LABEL.test(o.label))
      .map((o) => o.id),
  );
  if (blockedOptionIds.size === 0) return [];

  const successors = new Map<string, string[]>();
  for (const d of ctx.input.dependencies) {
    const list = successors.get(d.predecessor_id);
    if (list) list.push(d.successor_id);
    else successors.set(d.predecessor_id, [d.successor_id]);
  }

  const itemIds: string[] = [];
  const seen = new Set<string>();
  let blockers = 0;
  for (const it of ctx.input.items) {
    const v = ctx.cellMap.get(cellKey(it.id, statusCol.id));
    const optionId =
      typeof v === "object" && v !== null
        ? (v as { optionId?: unknown }).optionId
        : undefined;
    if (typeof optionId !== "string" || !blockedOptionIds.has(optionId))
      continue;
    if (!successors.has(it.id)) continue;
    blockers += 1;
    const stack = [it.id];
    while (stack.length > 0) {
      const id = stack.pop() as string;
      if (seen.has(id)) continue;
      seen.add(id);
      itemIds.push(id);
      for (const next of successors.get(id) ?? []) stack.push(next);
    }
  }
  const s = signal("blocked", itemIds, "blocked chain");
  s.count = blockers;
  return [s];
}

/**
 * stalled — a group with ≥1 open item whose most recent activity across ALL
 * its items (open or done) is strictly older than STALL_DAYS. `itemIds` are
 * the group's open items (the work that went quiet); `groupIds` lets the
 * table keep those groups expanded.
 */
function stalledSignals(ctx: Ctx): Signal[] {
  const threshold = ctx.opts.now.getTime() - STALL_DAYS * DAY;
  const latestByGroup = new Map<string, number>();
  const openByGroup = new Map<string, string[]>();
  for (const it of ctx.input.items) {
    const t = ctx.lastActivity.get(it.id) ?? 0;
    if (t > (latestByGroup.get(it.group_id) ?? -1))
      latestByGroup.set(it.group_id, t);
    if (ctx.isOpen(it.id)) {
      const list = openByGroup.get(it.group_id);
      if (list) list.push(it.id);
      else openByGroup.set(it.group_id, [it.id]);
    }
  }
  const groupIds: string[] = [];
  const itemIds: string[] = [];
  for (const g of ctx.input.groups) {
    const open = openByGroup.get(g.id);
    if (!open || open.length === 0) continue;
    const latest = latestByGroup.get(g.id);
    if (latest === undefined || latest >= threshold) continue;
    groupIds.push(g.id);
    itemIds.push(...open);
  }
  const s = signal(
    "stalled",
    itemIds,
    groupIds.length === 1 ? "stalled group" : "stalled groups",
  );
  s.count = groupIds.length;
  s.groupIds = groupIds;
  return [s];
}
```

Replace the `KIND_BUILDERS` entries:

```ts
const KIND_BUILDERS: Record<SignalKind, (ctx: Ctx) => Signal[]> = {
  overdue: overdueSignals,
  blocked: blockedSignals,
  overloaded: () => [],
  stalled: stalledSignals,
  changed: () => [],
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run --project unit src/lib/boards/intelligence/signals.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Typecheck + lint, then commit**

Run: `pnpm typecheck && pnpm lint`

```bash
git add src/lib/boards/intelligence/signals.ts src/lib/boards/intelligence/signals.test.ts
git commit -m "feat(boards): blocked-chain and stalled-group intelligence signals"
```

### Task 3: `overloaded` and `changed` kinds, ordering + `MAX_CHIPS` truncation, narrowing and selection helpers

**Files:**

- Modify: `src/lib/boards/intelligence/signals.ts`
- Test: `src/lib/boards/intelligence/signals.test.ts` (append)

**Interfaces:**

- Consumes: Task 1/2 internals; `OVERLOAD_RATIO`, `EFFORT_COLUMN_NAME`, `MAX_CHIPS` from `constants.ts`.
- Produces (Tasks 5–7 depend on these exact exports from `signals.ts`):
  - `computeSignals` now also emits `overloaded` (one per person, highest load first, `subjectUserId`, label `"overloaded · <first name>"`, count = that person's open items) and `changed` (hidden when `lastSeenAt` is null; label `"changed since <formatted>"`).
  - `stripSignals(signals: Signal[]): Signal[]` — first `MAX_CHIPS`.
  - `formatSince(since: Date, now: Date): string` — same day → `"2:05 PM"`; < 6 days → `"Tue"`; else `"Sep 3"`.
  - `narrowItemsToSignal<T extends { id: string; parent_id: string | null }>(items: T[], itemIds: ReadonlySet<string> | null): T[]` — returns `items` itself when `itemIds` is null; otherwise keeps matching items AND the parents of matching sub-items.
  - `signalSelection(s: Signal): IntelSelection`, `selectionEquals(a: IntelSelection | null, b: IntelSelection | null): boolean`, `findActiveSignal(signals: Signal[], sel: IntelSelection | null): Signal | null`.
  - `latestActivityISO(input: SignalsInput): string | null` — ISO of the newest item/cell `updated_at`, for the strip's "last change 3 hours ago".

Spec deviation, recorded: spec §3.2 says overloaded "reuses the workload helpers in `src/lib/workload/`". Those helpers (`buildWorkloadGrid`, `spreadItemEffort`, `capacityState`, `utilizationPct` in `src/lib/workload/rollup.ts`) are calendar-capacity math over `member_capacity` + `org_workload_settings` + date-spread items — data that is NOT in the board payload and would need new reads (spec §8 forbids). Phase 1 therefore implements the spec's own definition directly on the payload: per person, open assigned items (any `people` column) weighted by the first `numbers` column whose name matches `EFFORT_COLUMN_NAME` (weight 1 when absent or empty), compared with the median load across people who carry load; needs ≥ 2 loaded people for a median to mean anything.

- [ ] **Step 1: Append the failing tests**

Append to `src/lib/boards/intelligence/signals.test.ts` (add `formatSince, latestActivityISO, narrowItemsToSignal, stripSignals, findActiveSignal, signalSelection, selectionEquals` to the existing `./signals` import, and `MAX_CHIPS` from `./constants`):

```ts
describe("computeSignals — overloaded", () => {
  const names = new Map([
    ["u1", "Ana Lovelace"],
    ["u2", "Ben"],
  ]);
  const assign = (id: string, ...users: string[]) => [
    cell(id, STATUS, { optionId: OPEN }),
    cell(id, PEOPLE, { userIds: users }),
  ];

  it("flags the person above OVERLOAD_RATIO × median, named by first name", () => {
    const input = board({
      items: [item("a"), item("b"), item("c"), item("d"), item("e"), item("f")],
      cellValues: [
        ...assign("a", "u1"),
        ...assign("b", "u1"),
        ...assign("c", "u1"),
        ...assign("d", "u1"),
        ...assign("e", "u2"),
        ...assign("f", "u3"),
      ],
    });
    const over = ofKind(
      computeSignals(input, opts({ memberNames: names })),
      "overloaded",
    );
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({
      kind: "overloaded",
      count: 4,
      label: "overloaded · Ana",
      tone: "yellow",
      subjectUserId: "u1",
    });
    expect([...over[0].itemIds].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("emits one signal per overloaded person, highest load first", () => {
    const cells = [
      ...["a1", "a2", "a3", "a4"].flatMap((id) => assign(id, "u1")),
      ...["b1", "b2", "b3", "b4", "b5", "b6"].flatMap((id) => assign(id, "u2")),
      ...assign("c1", "u3"),
      ...assign("d1", "u4"),
    ];
    const input = board({
      items: cells
        .filter((c) => c.column_id === STATUS)
        .map((c) => item(c.item_id)),
      cellValues: cells,
    });
    const over = ofKind(
      computeSignals(input, opts({ memberNames: names })),
      "overloaded",
    );
    expect(over.map((s) => s.subjectUserId)).toEqual(["u2", "u1"]);
    expect(over[0].label).toBe("overloaded · Ben");
  });

  it("weights items by the effort column and excludes done items", () => {
    const input = board({
      items: [item("big"), item("s1"), item("s2"), item("t1"), item("done")],
      cellValues: [
        ...assign("big", "u1"),
        cell("big", EFFORT, { n: 5 }),
        ...assign("s1", "u2"),
        ...assign("s2", "u2"),
        ...assign("t1", "u3"),
        cell("done", STATUS, { optionId: DONE }),
        cell("done", PEOPLE, { userIds: ["u3"] }),
        cell("done", EFFORT, { n: 50 }),
      ],
    });
    const over = ofKind(computeSignals(input, opts()), "overloaded");
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({
      subjectUserId: "u1",
      count: 1,
      label: "overloaded · someone",
    });
  });

  it("needs at least two loaded people (a lone assignee is never overloaded)", () => {
    const input = board({
      items: [item("a"), item("b")],
      cellValues: [...assign("a", "u1"), ...assign("b", "u1")],
    });
    expect(ofKind(computeSignals(input, opts()), "overloaded")).toEqual([]);
  });
});

describe("computeSignals — changed", () => {
  it("is hidden on a first visit (lastSeenAt null)", () => {
    const input = board({
      items: [item("a", { updated_at: NOW.toISOString() })],
    });
    expect(ofKind(computeSignals(input, opts()), "changed")).toEqual([]);
  });

  it("counts items whose item or cell activity is after lastSeenAt", () => {
    const lastSeenAt = new Date(2026, 8, 8, 10, 0, 0); // Tue 8 Sep, local
    const input = board({
      items: [
        item("item-touched", { updated_at: daysAgo(1).toISOString() }),
        item("cell-touched"),
        item("untouched"),
      ],
      cellValues: [
        cell(
          "cell-touched",
          DATE,
          { date: dateISO(0) },
          daysAgo(2).toISOString(),
        ),
      ],
    });
    const [changed] = ofKind(
      computeSignals(input, opts({ lastSeenAt })),
      "changed",
    );
    expect(changed).toMatchObject({
      kind: "changed",
      count: 2,
      label: "changed since Tue",
      tone: "accent",
    });
    expect([...changed.itemIds].sort()).toEqual([
      "cell-touched",
      "item-touched",
    ]);
  });
});

describe("formatSince", () => {
  it("same day → clock time; within the week → weekday; older → month day", () => {
    expect(formatSince(new Date(2026, 8, 11, 14, 5), NOW)).toBe("2:05 PM");
    expect(formatSince(new Date(2026, 8, 8, 10, 0), NOW)).toBe("Tue");
    expect(formatSince(new Date(2026, 8, 3, 10, 0), NOW)).toBe("Sep 3");
  });
});

describe("ordering, truncation and helpers", () => {
  function busyBoard(): SignalsInput {
    const cells = [
      // overdue + stuck blocker with a dependent
      cell("late", STATUS, { optionId: STUCK }),
      cell("late", DATE, { date: dateISO(3) }),
      // overloaded u1 (4) vs u2/u3 (1 each) → u1 over; u4 (6) also over
      ...["a1", "a2", "a3", "a4"].flatMap((id) => [
        cell(id, STATUS, { optionId: OPEN }),
        cell(id, PEOPLE, { userIds: ["u1"] }),
      ]),
      ...["b1", "b2", "b3", "b4", "b5", "b6"].flatMap((id) => [
        cell(id, STATUS, { optionId: OPEN }),
        cell(id, PEOPLE, { userIds: ["u4"] }),
      ]),
      cell("c1", STATUS, { optionId: OPEN }),
      cell("c1", PEOPLE, { userIds: ["u2"] }),
      cell("d1", STATUS, { optionId: OPEN }),
      cell("d1", PEOPLE, { userIds: ["u3"] }),
    ];
    const ids = [...new Set(cells.map((c) => c.item_id)), "dep", "quiet"];
    return board({
      groups: [group("g1"), group("g-quiet")],
      items: ids.map((id) =>
        id === "quiet"
          ? item(id, {
              group_id: "g-quiet",
              updated_at: daysAgo(9).toISOString(),
            })
          : item(id, { updated_at: daysAgo(1).toISOString() }),
      ),
      cellValues: cells,
      dependencies: [dep("late", "dep")],
    });
  }

  it("orders kinds overdue, blocked, overloaded, stalled, changed", () => {
    const signals = computeSignals(
      busyBoard(),
      opts({ lastSeenAt: daysAgo(2) }),
    );
    expect(signals.map((s) => s.kind)).toEqual([
      "overdue",
      "blocked",
      "overloaded",
      "overloaded",
      "stalled",
      "changed",
    ]);
  });

  it("stripSignals keeps the first MAX_CHIPS in order", () => {
    const signals = computeSignals(
      busyBoard(),
      opts({ lastSeenAt: daysAgo(2) }),
    );
    expect(signals.length).toBeGreaterThan(MAX_CHIPS);
    const strip = stripSignals(signals);
    expect(strip).toHaveLength(MAX_CHIPS);
    expect(strip.map((s) => s.kind)).toEqual([
      "overdue",
      "blocked",
      "overloaded",
      "overloaded",
      "stalled",
    ]);
  });

  it("narrowItemsToSignal returns the same array when no chip is active", () => {
    const items = [item("a")];
    expect(narrowItemsToSignal(items, null)).toBe(items);
  });

  it("narrowItemsToSignal keeps matches plus the parents of matching sub-items", () => {
    const items = [
      item("p"),
      item("child", { parent_id: "p" }),
      item("other"),
      item("orphan-child", { parent_id: "other" }),
    ];
    const kept = narrowItemsToSignal(items, new Set(["child"]));
    expect(kept.map((i) => i.id)).toEqual(["p", "child"]);
  });

  it("signalSelection / selectionEquals / findActiveSignal round-trip a subject", () => {
    const signals = computeSignals(busyBoard(), opts());
    const u4 = signals.find((s) => s.subjectUserId === "u4") as Signal;
    const sel = signalSelection(u4);
    expect(sel).toEqual({ kind: "overloaded", subject: "u4" });
    expect(selectionEquals(sel, { kind: "overloaded", subject: "u4" })).toBe(
      true,
    );
    expect(selectionEquals(sel, { kind: "overloaded" })).toBe(false);
    expect(selectionEquals(null, null)).toBe(true);
    expect(findActiveSignal(signals, sel)).toBe(u4);
    expect(findActiveSignal(signals, { kind: "overdue" })?.kind).toBe(
      "overdue",
    );
    expect(findActiveSignal(signals, { kind: "changed" })).toBeNull();
    expect(findActiveSignal(signals, null)).toBeNull();
  });

  it("latestActivityISO is the newest item/cell timestamp, or null for an empty board", () => {
    expect(latestActivityISO(board())).toBeNull();
    const input = board({
      items: [item("a", { updated_at: daysAgo(4).toISOString() })],
      cellValues: [
        cell("a", DATE, { date: dateISO(0) }, daysAgo(1).toISOString()),
      ],
    });
    expect(latestActivityISO(input)).toBe(daysAgo(1).toISOString());
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run --project unit src/lib/boards/intelligence/signals.test.ts`
Expected: FAIL — `stripSignals is not a function` / missing exports, overloaded/changed arrays empty.

- [ ] **Step 3: Implement**

In `src/lib/boards/intelligence/signals.ts`:

Replace the constants import with:

```ts
import {
  BLOCKED_LABEL,
  EFFORT_COLUMN_NAME,
  MAX_CHIPS,
  OVERLOAD_RATIO,
  SIGNAL_ORDER,
  SIGNAL_TONE,
  STALL_DAYS,
} from "./constants";
import type { IntelSelection, Signal, SignalKind } from "./types";
```

Insert above `const KIND_BUILDERS`:

```ts
function firstName(name: string | undefined): string {
  const first = name?.trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : "someone";
}

function numberOf(v: unknown): number | null {
  const n =
    typeof v === "object" && v !== null ? (v as { n?: unknown }).n : undefined;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * overloaded — per person: open items assigned in any people column, weighted
 * by the effort/numbers column when the board has one, compared with the
 * median load across everyone who carries load. One signal per person over
 * OVERLOAD_RATIO × median, highest load first (the strip keeps the first).
 */
function overloadedSignals(ctx: Ctx): Signal[] {
  const peopleCols = ctx.input.columns.filter((c) => c.kind === "people");
  if (peopleCols.length === 0) return [];
  const effortCol =
    ctx.input.columns.find(
      (c) => c.kind === "numbers" && EFFORT_COLUMN_NAME.test(c.name),
    ) ?? null;

  const load = new Map<string, { total: number; itemIds: string[] }>();
  for (const it of ctx.input.items) {
    if (!ctx.isOpen(it.id)) continue;
    const weight = effortCol
      ? (numberOf(ctx.cellMap.get(cellKey(it.id, effortCol.id))) ?? 1)
      : 1;
    const assignees = new Set<string>();
    for (const col of peopleCols) {
      const v = ctx.cellMap.get(cellKey(it.id, col.id));
      const ids =
        typeof v === "object" && v !== null
          ? (v as { userIds?: unknown }).userIds
          : undefined;
      if (!Array.isArray(ids)) continue;
      for (const id of ids) if (typeof id === "string") assignees.add(id);
    }
    for (const uid of assignees) {
      const entry = load.get(uid) ?? { total: 0, itemIds: [] };
      entry.total += weight;
      entry.itemIds.push(it.id);
      load.set(uid, entry);
    }
  }
  if (load.size < 2) return [];

  const totals = [...load.values()].map((e) => e.total).sort((a, b) => a - b);
  const mid = totals.length / 2;
  const median =
    totals.length % 2 === 1
      ? totals[Math.floor(mid)]
      : (totals[mid - 1] + totals[mid]) / 2;
  if (median <= 0) return [];

  return [...load.entries()]
    .filter(([, e]) => e.total > OVERLOAD_RATIO * median)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([uid, e]) => {
      const s = signal(
        "overloaded",
        e.itemIds,
        `overloaded · ${firstName(ctx.opts.memberNames?.get(uid))}`,
      );
      s.subjectUserId = uid;
      return s;
    });
}

/** "2:05 PM" (same local day) · "Tue" (< 6 days) · "Sep 3" (older). */
export function formatSince(since: Date, now: Date): string {
  const sameDay =
    since.getFullYear() === now.getFullYear() &&
    since.getMonth() === now.getMonth() &&
    since.getDate() === now.getDate();
  if (sameDay)
    return since.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  if (now.getTime() - since.getTime() < 6 * DAY)
    return since.toLocaleDateString("en-US", { weekday: "short" });
  return since.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** changed — items with activity after the caller's last visit. Hidden on a first visit. */
function changedSignals(ctx: Ctx): Signal[] {
  const since = ctx.opts.lastSeenAt;
  if (!since) return [];
  const sinceMs = since.getTime();
  const itemIds = ctx.input.items
    .filter((it) => (ctx.lastActivity.get(it.id) ?? 0) > sinceMs)
    .map((it) => it.id);
  return [
    signal(
      "changed",
      itemIds,
      `changed since ${formatSince(since, ctx.opts.now)}`,
    ),
  ];
}
```

Replace `KIND_BUILDERS` with the complete table:

```ts
const KIND_BUILDERS: Record<SignalKind, (ctx: Ctx) => Signal[]> = {
  overdue: overdueSignals,
  blocked: blockedSignals,
  overloaded: overloadedSignals,
  stalled: stalledSignals,
  changed: changedSignals,
};
```

Append at the end of the file (and delete the `export { DAY as SIGNALS_DAY_MS };` line from Task 1 — nothing imports it):

```ts
/** The chips the strip shows: the first MAX_CHIPS in strip order (spec §3.2). */
export function stripSignals(signals: Signal[]): Signal[] {
  return signals.slice(0, MAX_CHIPS);
}

/** The URL/selection form of a signal (`overloaded:u1`, `overdue`). */
export function signalSelection(s: Signal): IntelSelection {
  return s.subjectUserId
    ? { kind: s.kind, subject: s.subjectUserId }
    : { kind: s.kind };
}

export function selectionEquals(
  a: IntelSelection | null,
  b: IntelSelection | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.kind === b.kind && (a.subject ?? null) === (b.subject ?? null);
}

/** The signal the active chip points at, or null when none / no longer present. */
export function findActiveSignal(
  signals: Signal[],
  sel: IntelSelection | null,
): Signal | null {
  if (!sel) return null;
  return signals.find((s) => selectionEquals(signalSelection(s), sel)) ?? null;
}

/**
 * Narrow a view's item list to the active chip. `null` (no chip) returns the
 * SAME array so memoized derivations keep their identity. A matching sub-item
 * keeps its parent so it stays reachable in every view (table rows nest under
 * a parent; the timeline nests scheduled children under a header row).
 */
export function narrowItemsToSignal<
  T extends { id: string; parent_id: string | null },
>(items: T[], itemIds: ReadonlySet<string> | null): T[] {
  if (itemIds === null) return items;
  const parentsToKeep = new Set<string>();
  for (const it of items)
    if (itemIds.has(it.id) && it.parent_id) parentsToKeep.add(it.parent_id);
  return items.filter((it) => itemIds.has(it.id) || parentsToKeep.has(it.id));
}

/** ISO timestamp of the board's newest item/cell activity, or null when empty. */
export function latestActivityISO(input: SignalsInput): string | null {
  let best = 0;
  for (const t of buildLastActivity(input).values()) if (t > best) best = t;
  return best > 0 ? new Date(best).toISOString() : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run --project unit src/lib/boards/intelligence/signals.test.ts`
Expected: PASS (all 25 tests).

- [ ] **Step 5: Typecheck + lint, then commit**

Run: `pnpm typecheck && pnpm lint`

```bash
git add src/lib/boards/intelligence/signals.ts src/lib/boards/intelligence/signals.test.ts
git commit -m "feat(boards): overloaded and changed-since signals, strip ordering and chip-filter helpers"
```

### Task 4: `board_visits` — migration, last-seen read, `touchBoardVisit` action, client hook

**Files:**

- Create: `supabase/migrations/<stamp>_board_visits.sql` (stamp minted by the script — never hand-written)
- Modify: `src/types/database.types.ts` (regenerated only)
- Create: `src/lib/validations/board-intelligence.ts`
- Create: `src/lib/boards/intelligence/visits.ts`
- Create: `src/lib/boards/intelligence/visit-actions.ts`
- Create: `src/lib/boards/intelligence/use-board-visit.ts`
- Test: `src/lib/boards/intelligence/visits.test.ts`, `src/lib/boards/intelligence/visit-actions.test.ts`, `src/lib/boards/intelligence/use-board-visit.test.tsx`, `src/lib/boards/intelligence/board-visits.rls.integration.test.ts`

**Interfaces:**

- Consumes (existing): `createClient` from `@/lib/supabase/server` (`async () => SupabaseClient<Database>`); `typedRpc(supabase, fn, args)` from `src/lib/supabase/typed-rpc.ts`; `ActionResult`, `fail` from `src/lib/actions/result.ts`; `public.can_read_board(p_board_id uuid)`; test harness `loadIntegrationEnv`, `integrationTargetReady` from `@/test/integration-env`, `signInWithRetry` from `@/test/integration-auth`.
- Produces:
  - DB: table `public.board_visits(board_id, user_id, last_seen_at)`, RPC `public.touch_board_visit(p_board_id uuid) returns void`.
  - `getBoardLastSeenAt(supabase: SupabaseClient<Database>, boardId: string, userId: string): Promise<string | null>` (ISO string or null; never throws).
  - `touchBoardVisit(boardId: string): Promise<ActionResult>` (Server Action).
  - `useBoardVisitTouch(boardId: string, enabled?: boolean): void` (client hook; writes once per visit).
  - `touchBoardVisitSchema` (Zod).

Spec deviation, recorded: spec §3.4 says "the board payload query joins the current user's row and returns `lastSeenAt`". `getBoardPayload` is React-`cache`d, user-agnostic and mirrored 1:1 into the client `BoardCache`, the offline snapshot and ~20 test fixtures; widening it would ripple through all of them. The read is instead a sibling PK point-read issued in the page's existing `Promise.all` (same cost — one PK read, spec §8) and passed as a prop. `getBoardPayload` is untouched.

- [ ] **Step 1: Mint the migration file**

Run from inside the worktree:

```bash
scripts/new-migration.sh board_visits
```

Expected: `✓ created supabase/migrations/<stamp>_board_visits.sql` and the apply/types checklist. Note the printed `<stamp>_board_visits` name — it is the `name` you must pass to the MCP in Step 3.

- [ ] **Step 2: Write the DDL**

Replace the file's contents (keep the two-line version banner the script wrote at the top; replace the script's placeholder "What this migration does" line with the description below):

```sql
-- <stamp>_board_visits.sql
-- Version minted by scripts/new-migration.sh (real UTC stamp) — do not hand-edit
-- the version; the filename must match the remote ledger row (gotcha-55).
--
-- What this migration does:
--   Adds board_visits — one row per (board, user) recording when that user
--   last had the board open — plus the upsert RPC the board client calls when
--   the tab is hidden or unmounted. Feeds the "changed since" chip of Board
--   Intelligence Phase 1 (docs/superpowers/specs/2026-09-11-board-intelligence-design.md §3.4).

create table public.board_visits (
  board_id     uuid not null references public.boards (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  primary key (board_id, user_id)
);

comment on table public.board_visits is
  'When each user last had a board open. Own rows only; drives the "changed since" intelligence signal.';

alter table public.board_visits enable row level security;

-- Default-deny. Every verb is the caller's OWN row on a board the caller can
-- read — can_read_board is the existing org-membership + board-grant predicate,
-- so a row can never be read or written across orgs or for a board the user
-- has no access to.
create policy "board_visits: select own"
  on public.board_visits for select
  using (user_id = (select auth.uid()) and public.can_read_board(board_id));

create policy "board_visits: insert own"
  on public.board_visits for insert
  with check (user_id = (select auth.uid()) and public.can_read_board(board_id));

create policy "board_visits: update own"
  on public.board_visits for update
  using (user_id = (select auth.uid()) and public.can_read_board(board_id))
  with check (user_id = (select auth.uid()) and public.can_read_board(board_id));

create policy "board_visits: delete own"
  on public.board_visits for delete
  using (user_id = (select auth.uid()));

-- Upsert helper: one round trip per visit. SECURITY INVOKER (the default) is
-- load-bearing — the insert runs under the caller's RLS, so a user who cannot
-- read the board cannot stamp a visit on it.
create or replace function public.touch_board_visit(p_board_id uuid)
returns void
language sql
set search_path = ''
as $$
  insert into public.board_visits (board_id, user_id, last_seen_at)
  values (p_board_id, (select auth.uid()), now())
  on conflict (board_id, user_id) do update
    set last_seen_at = now();
$$;

comment on function public.touch_board_visit (uuid) is
  'Upsert the calling user''s last_seen_at for a board. Security invoker: the insert is RLS-filtered.';

-- Postgres grants EXECUTE to PUBLIC on every new function, which anon inherits.
-- Lock it down in the same migration (the anon-reachability conformance probe
-- fails otherwise — see 20260909070508_board_view_prefs_execute_lockdown.sql).
revoke execute on function public.touch_board_visit (uuid) from public, anon;
grant execute on function public.touch_board_visit (uuid) to authenticated;
```

- [ ] **Step 3: Apply to DEV via the `supabase-dev` MCP, then verify the ledger**

Call `mcp__supabase-dev__apply_migration` with `name: "<stamp>_board_visits"` (exactly the filename without `.sql`) and `query:` = the file's full contents. (If the `mcp__supabase-dev__*` tools are absent, the project MCP servers are unapproved in `~/.claude.json` — stop and say so; do not fall back to the dashboard.)

Then run: `pnpm db:ledger-check`
Expected: exit 0 and the new row listed as in sync (a "not yet applied" note means the MCP `name` did not match the filename — repair with `scripts/reconcile-migration-version.sh <ledger-version> <stamp>`; a ledger row with no file is exit 2 and must be fixed before continuing).

- [ ] **Step 4: Regenerate types**

Call `mcp__supabase-dev__generate_typescript_types`, write the returned TypeScript verbatim to `src/types/database.types.ts`, then:

```bash
pnpm prettier --write src/types/database.types.ts
grep -n "board_visits: {" src/types/database.types.ts
grep -n "touch_board_visit: {" src/types/database.types.ts
```

Expected: both greps hit (a `Tables` entry with `board_id`, `last_seen_at`, `user_id`, and a `Functions` entry with `Args: { p_board_id: string }`). `git diff --stat src/types/database.types.ts` should show only additions around those two entries.

- [ ] **Step 5: Commit the migration + types together**

```bash
git add supabase/migrations/<stamp>_board_visits.sql src/types/database.types.ts
git commit -m "db: board_visits table, RLS and touch_board_visit RPC for board intelligence"
```

- [ ] **Step 6: Write the failing test for the read helper**

Create `src/lib/boards/intelligence/visits.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { getBoardLastSeenAt } from "./visits";

type Result = { data: unknown; error: { message: string } | null };

/** Chainable stand-in for a PostgREST builder ending in maybeSingle(). */
function clientWith(
  result: Result,
  calls: { table?: string; eqs: [string, string][] },
) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (col: string, val: string) => {
      calls.eqs.push([col, val]);
      return chain;
    },
    maybeSingle: async () => result,
  };
  return {
    from: (table: string) => {
      calls.table = table;
      return chain;
    },
  } as unknown as SupabaseClient<Database>;
}

describe("getBoardLastSeenAt", () => {
  it("returns last_seen_at from the caller's own (user_id, board_id) row", async () => {
    const calls = { eqs: [] as [string, string][] } as {
      table?: string;
      eqs: [string, string][];
    };
    const supabase = clientWith(
      { data: { last_seen_at: "2026-09-08T10:00:00Z" }, error: null },
      calls,
    );
    await expect(getBoardLastSeenAt(supabase, "b1", "u1")).resolves.toBe(
      "2026-09-08T10:00:00Z",
    );
    expect(calls.table).toBe("board_visits");
    expect(calls.eqs).toEqual([
      ["user_id", "u1"],
      ["board_id", "b1"],
    ]);
  });

  it("returns null when there is no row (first visit)", async () => {
    const supabase = clientWith({ data: null, error: null }, { eqs: [] });
    await expect(getBoardLastSeenAt(supabase, "b1", "u1")).resolves.toBeNull();
  });

  it("returns null instead of throwing on a read error", async () => {
    const supabase = clientWith(
      { data: null, error: { message: "boom" } },
      { eqs: [] },
    );
    await expect(getBoardLastSeenAt(supabase, "b1", "u1")).resolves.toBeNull();
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `pnpm vitest run --project unit src/lib/boards/intelligence/visits.test.ts`
Expected: FAIL — cannot resolve `./visits`.

- [ ] **Step 8: Implement the read helper**

Create `src/lib/boards/intelligence/visits.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * When the caller last had this board open, as an ISO timestamp, or null on a
 * first visit. A point lookup on the (board_id, user_id) primary key — bounded
 * by construction, so it is safe on the board page's hot path (spec §8: "one
 * primary-key read on board_visits"). RLS already scopes rows to the caller;
 * the explicit user_id filter makes the index use obvious.
 *
 * Never throws: a missing row, an RLS denial or a transport error all resolve
 * to null — a missing "changed since" chip must not be able to break the board.
 */
export async function getBoardLastSeenAt(
  supabase: SupabaseClient<Database>,
  boardId: string,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("board_visits")
    .select("last_seen_at")
    .eq("user_id", userId)
    .eq("board_id", boardId)
    .maybeSingle();
  if (error || !data) return null;
  return data.last_seen_at;
}
```

- [ ] **Step 9: Run it to verify it passes**

Run: `pnpm vitest run --project unit src/lib/boards/intelligence/visits.test.ts`
Expected: PASS (3).

- [ ] **Step 10: Write the failing test for the Server Action**

Create `src/lib/boards/intelligence/visit-actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc }),
}));

import { touchBoardVisit } from "./visit-actions";

const BOARD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

beforeEach(() => rpc.mockReset());

describe("touchBoardVisit", () => {
  it("rejects a non-uuid board id before touching the database", async () => {
    const res = await touchBoardVisit("not-a-uuid");
    expect(res.ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("calls touch_board_visit with the board id and reports ok", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const res = await touchBoardVisit(BOARD);
    expect(res).toEqual({ ok: true, data: undefined });
    expect(rpc).toHaveBeenCalledWith("touch_board_visit", {
      p_board_id: BOARD,
    });
  });

  it("surfaces an RPC error as a failed result (never throws)", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: "permission denied" },
    });
    const res = await touchBoardVisit(BOARD);
    expect(res).toEqual({ ok: false, error: "permission denied" });
  });
});
```

- [ ] **Step 11: Run it to verify it fails**

Run: `pnpm vitest run --project unit src/lib/boards/intelligence/visit-actions.test.ts`
Expected: FAIL — cannot resolve `./visit-actions`.

- [ ] **Step 12: Implement the Zod schema and the action**

Create `src/lib/validations/board-intelligence.ts`:

```ts
import { z } from "zod";

/** Server Action input boundary for touchBoardVisit(boardId). */
export const touchBoardVisitSchema = z.object({
  boardId: z.string().uuid(),
});
```

Create `src/lib/boards/intelligence/visit-actions.ts`:

```ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import { fail, type ActionResult } from "@/lib/actions/result";
import { touchBoardVisitSchema } from "@/lib/validations/board-intelligence";

/**
 * Stamp "the caller had this board open just now" (board_visits upsert).
 *
 * Deliberately does NOT revalidate: this is per-user state that no other
 * client's query renders, and a `revalidatePath` here would re-run every board
 * query on the page to change nothing on screen (gotcha-09). The RPC is
 * SECURITY INVOKER, so RLS — own row AND can_read_board — is the authorization.
 * Callers treat failure as silent (spec §3.4).
 */
export async function touchBoardVisit(boardId: string): Promise<ActionResult> {
  const parsed = touchBoardVisitSchema.safeParse({ boardId });
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  }

  const supabase = await createClient();
  const { error } = await typedRpc(supabase, "touch_board_visit", {
    p_board_id: parsed.data.boardId,
  });
  if (error) return fail(error.message);

  return { ok: true, data: undefined };
}
```

- [ ] **Step 13: Run it to verify it passes**

Run: `pnpm vitest run --project unit src/lib/boards/intelligence/visit-actions.test.ts`
Expected: PASS (3). (If `typedRpc` reports `"touch_board_visit"` is not a known function name, Step 4's types were not regenerated — redo it.)

- [ ] **Step 14: Write the failing hook test**

Create `src/lib/boards/intelligence/use-board-visit.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const touchBoardVisit = vi.fn(async () => ({
  ok: true as const,
  data: undefined,
}));
vi.mock("./visit-actions", () => ({
  touchBoardVisit: (...a: unknown[]) => touchBoardVisit(...(a as [])),
}));

import { useBoardVisitTouch } from "./use-board-visit";

const BOARD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => touchBoardVisit.mockClear());
afterEach(() => setVisibility("visible"));

describe("useBoardVisitTouch", () => {
  it("writes once when the tab is hidden, and not again until it was visible", () => {
    renderHook(() => useBoardVisitTouch(BOARD));
    expect(touchBoardVisit).not.toHaveBeenCalled();

    act(() => setVisibility("hidden"));
    expect(touchBoardVisit).toHaveBeenCalledTimes(1);
    expect(touchBoardVisit).toHaveBeenCalledWith(BOARD);

    act(() => setVisibility("hidden"));
    expect(touchBoardVisit).toHaveBeenCalledTimes(1);

    act(() => setVisibility("visible"));
    act(() => setVisibility("hidden"));
    expect(touchBoardVisit).toHaveBeenCalledTimes(2);
  });

  it("writes on unmount when the visit has not been stamped yet", () => {
    const { unmount } = renderHook(() => useBoardVisitTouch(BOARD));
    unmount();
    expect(touchBoardVisit).toHaveBeenCalledTimes(1);
  });

  it("does not write twice when hidden then unmounted", () => {
    const { unmount } = renderHook(() => useBoardVisitTouch(BOARD));
    act(() => setVisibility("hidden"));
    unmount();
    expect(touchBoardVisit).toHaveBeenCalledTimes(1);
  });

  it("is inert when disabled (offline replay)", () => {
    const { unmount } = renderHook(() => useBoardVisitTouch(BOARD, false));
    act(() => setVisibility("hidden"));
    unmount();
    expect(touchBoardVisit).not.toHaveBeenCalled();
  });

  it("swallows a rejected write", async () => {
    touchBoardVisit.mockRejectedValueOnce(new Error("offline"));
    const { unmount } = renderHook(() => useBoardVisitTouch(BOARD));
    expect(() => unmount()).not.toThrow();
    await Promise.resolve();
  });
});
```

- [ ] **Step 15: Run it to verify it fails**

Run: `pnpm vitest run --project unit src/lib/boards/intelligence/use-board-visit.test.tsx`
Expected: FAIL — cannot resolve `./use-board-visit`.

- [ ] **Step 16: Implement the hook**

Create `src/lib/boards/intelligence/use-board-visit.ts`:

```ts
"use client";

import { useEffect, useRef } from "react";
import { touchBoardVisit } from "./visit-actions";

/**
 * Stamp the caller's visit to a board ONCE per visit (spec §3.4): on
 * `visibilitychange → hidden`, on `pagehide`, or on unmount — whichever comes
 * first. A `sent` guard stops the second and third from writing again; it
 * resets when the tab becomes visible again, because that starts a new visit.
 * Failure is silent: the only consumer is the "changed since" chip on the next
 * visit.
 *
 * `enabled=false` makes it inert (the /offline replay has no server to write to).
 *
 * Dev-only note: React StrictMode mounts effects twice, so the first cleanup
 * fires one extra write in development. Production mounts once.
 */
export function useBoardVisitTouch(boardId: string, enabled = true): void {
  const sent = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    sent.current = false;

    const send = () => {
      if (sent.current) return;
      sent.current = true;
      void touchBoardVisit(boardId).catch(() => {
        /* silent by design (spec §3.4) */
      });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") send();
      else sent.current = false;
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", send);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", send);
      send();
    };
  }, [boardId, enabled]);
}
```

- [ ] **Step 17: Run it to verify it passes**

Run: `pnpm vitest run --project unit src/lib/boards/intelligence/use-board-visit.test.tsx`
Expected: PASS (5).

- [ ] **Step 18: Write the RLS integration probe (skips without `PULSE_TEST_DB`)**

Create `src/lib/boards/intelligence/board-visits.rls.integration.test.ts` — copy the `makeUser` / `beforeAll` / `afterAll` scaffolding VERBATIM from `src/lib/boards/view-prefs.rls.integration.test.ts` lines 1–116 (change the `describe` title to `"RLS: board_visits"`, the email prefix to `boardvisits-`, org names to `"Board Visits Org"` / `"Outsider Org"`, slugs to `boardvisits-…`, board name to `"Visits Board"`), then these cases in place of its `it` blocks:

```ts
it("stamps and reads back the owner's own visit", async () => {
  const { error } = await owner.anon.rpc("touch_board_visit", {
    p_board_id: owner.boardId,
  });
  expect(error).toBeNull();
  const { data } = await owner.anon
    .from("board_visits")
    .select("last_seen_at")
    .eq("board_id", owner.boardId)
    .maybeSingle();
  expect(typeof data?.last_seen_at).toBe("string");
});

it("a second stamp updates the same row (one row per user per board)", async () => {
  const before = await owner.anon
    .from("board_visits")
    .select("last_seen_at")
    .eq("board_id", owner.boardId)
    .maybeSingle();
  await new Promise((r) => setTimeout(r, 20));
  await owner.anon.rpc("touch_board_visit", { p_board_id: owner.boardId });
  const { data: rows } = await owner.anon
    .from("board_visits")
    .select("last_seen_at")
    .eq("board_id", owner.boardId);
  expect(rows).toHaveLength(1);
  expect(rows![0].last_seen_at > before.data!.last_seen_at).toBe(true);
});

it("a shared editor cannot read the owner's visit but can stamp their own", async () => {
  const { data } = await other.anon
    .from("board_visits")
    .select("last_seen_at")
    .eq("board_id", owner.boardId);
  expect(data).toEqual([]);
  const { error } = await other.anon.rpc("touch_board_visit", {
    p_board_id: owner.boardId,
  });
  expect(error).toBeNull();
  const { data: mine } = await other.anon
    .from("board_visits")
    .select("user_id")
    .eq("board_id", owner.boardId);
  expect(mine).toEqual([{ user_id: other.id }]);
});

it("an outsider (other org) cannot stamp a visit on a board they cannot read", async () => {
  const { error } = await outsider.anon.rpc("touch_board_visit", {
    p_board_id: owner.boardId,
  });
  expect(error).not.toBeNull();
  const { data } = await admin
    .from("board_visits")
    .select("user_id")
    .eq("board_id", owner.boardId)
    .eq("user_id", outsider.id);
  expect(data).toEqual([]);
});
```

Run: `pnpm vitest run --project unit src/lib/boards/intelligence/board-visits.rls.integration.test.ts`
Expected: no tests collected by the unit project (integration files are excluded) — that is the intended local outcome. If you have `.env.test` per CONTRIBUTING → "Running integration tests", run `pnpm test:integration -- src/lib/boards/intelligence/board-visits.rls.integration.test.ts` and expect 4 PASS; otherwise the suite skips (`describe.skipIf`).

- [ ] **Step 19: Gates and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all exit 0 (`pnpm test` includes the conformance project, which skips without credentials).

```bash
git add src/lib/validations/board-intelligence.ts src/lib/boards/intelligence/visits.ts src/lib/boards/intelligence/visits.test.ts src/lib/boards/intelligence/visit-actions.ts src/lib/boards/intelligence/visit-actions.test.ts src/lib/boards/intelligence/use-board-visit.ts src/lib/boards/intelligence/use-board-visit.test.tsx src/lib/boards/intelligence/board-visits.rls.integration.test.ts
git commit -m "feat(boards): last-seen read, touchBoardVisit action and once-per-visit client hook"
```

### Task 5: `intel` URL param, `setIntel` in the filter hook, `BoardIntelligenceProvider`, page/BoardViews wiring, narrowing in all four views

**Files:**

- Modify: `src/lib/boards/board-filter.ts:32-61` (state + param keys), `:110-141` (parse/serialize)
- Modify: `src/lib/boards/board-filter.test.ts:80-90` (state literal) + new tests
- Modify: `src/lib/boards/use-board-filter-sort.ts:6-14` (imports), `:49` (`urlHasFilter`), `:61-63` (`raw`), `:162-184` (`clearAll`, `setIntel`, return)
- Modify: `src/lib/boards/use-board-filter-sort.test.tsx` (append)
- Create: `src/lib/boards/intelligence/context.tsx`, `src/lib/boards/intelligence/context.test.tsx`
- Modify: `src/app/(app)/boards/[boardId]/page.tsx:5-10` (import), `:28-49` (Promise.all), `:81-89` (prop)
- Modify: `src/components/boards/BoardViews.tsx:13-30` (imports), `:84-101` (props), `:219-246` (tree)
- Modify: `src/components/boards/BoardViews.test.tsx:12-17` (mocks), `:57` (`useBoardCache` mock), every `<BoardViews …>` render (add `lastSeenAt={null}`)
- Modify: `src/components/offline/OfflineBoard.tsx:133-142` (`lastSeenAt={null}`)
- Modify: `src/components/boards/table/BoardTableInner.tsx:64-69` (imports), `:340-350` (narrowing)
- Modify: `src/components/boards/KanbanBoard.tsx:35-39` (imports), `:195-208` (narrowing)
- Modify: `src/components/boards/CalendarBoard.tsx` (imports; a memo next to `cellMap` at `:160-163`; `shared.items` at `:276-283`)
- Modify: `src/components/boards/GanttBoard.tsx` (imports; a memo before `ganttResult` at `:208`; `buildGanttRows(cache.items, …)` at `:210-225`)

**Interfaces:**

- Consumes: Task 3's `Signal`, `IntelSelection`, `computeSignals`, `findActiveSignal`, `signalSelection`, `selectionEquals`, `narrowItemsToSignal`, `latestActivityISO`, `SIGNAL_ORDER`; Task 4's `getBoardLastSeenAt`, `useBoardVisitTouch`; existing `useBoardCache(boardId, initialData)` (`src/lib/boards/use-board-cache.ts`, returns a React-Query result with `.data: BoardCache`), `useBoardFilterSort()`, `useBoardViewPrefs()` (falls back to a local no-op API when no provider is mounted — `src/lib/boards/view-prefs-context.tsx:105-110`), `useIsOfflineRender()` from `@/lib/offline/offline-render-context`.
- Produces (Tasks 6–7 rely on these exact names):
  - `board-filter.ts`: `BoardFilterState.intel: IntelSelection | null`; `INTEL_PARAM_KEY = "intel"`; `URL_PARAM_KEYS`; `parseIntel(raw: string | null): IntelSelection | null`; `serializeIntel(sel: IntelSelection | null): string | null`.
  - `use-board-filter-sort.ts`: `setIntel(sel: IntelSelection | null): void` (writes with `replaceState`); `clearAll` also clears `intel`.
  - `context.tsx`:
    ```ts
    type BoardIntelligenceValue = {
      signals: Signal[]; // full ordered list (strip truncates)
      selection: IntelSelection | null; // what the URL says
      activeSignal: Signal | null; // resolved against current signals
      intelItemIds: ReadonlySet<string> | null;
      lastChangeAt: string | null;
      nowMs: number; // mount-time clock for relative labels
      loading: boolean;
      toggle: (signal: Signal) => void; // activates, or clears if already active
      clear: () => void;
    };
    function BoardIntelligenceProvider(props: {
      boardId: string;
      initialData: BoardCache;
      members: readonly {
        userId: string;
        fullName: string | null;
        email: string | null;
      }[];
      lastSeenAt: string | null;
      currentUserId: string;
      children: ReactNode;
    }): JSX.Element;
    function useBoardIntelligenceOptional(): BoardIntelligenceValue | null; // null when no provider (fails open)
    function useIntelItemIds(): ReadonlySet<string> | null; // null when no chip / no provider
    function useIntelMatch(itemId: string): boolean | null; // null when no chip / no provider
    function IntelToneFrame(props: { children: ReactNode }): JSX.Element; // <div class="contents" data-intel-tone=…>
    ```
  - `BoardViews` gains a required prop `lastSeenAt: string | null`.

Design notes, recorded: (1) `intel` is parsed from the URL and written with `replaceState` (spec §3.3) but is NOT persisted into the saved `filterQuery` (`FILTER_PARAM_KEYS` stays the persistence list) — a remembered "changed since" chip would be meaningless on the next visit. (2) Row highlight state is delivered by a dedicated `IntelMatchContext` whose value is `null` when no chip is active and a Set whose identity changes only when its contents change — so the memoized rows (`ItemRow`, `KanbanCard`) do not re-render on unrelated cache edits (`BoardTable.render-count.test.tsx`). (3) Calendar and Timeline do not apply the board filter today (only Table + Kanban call `buildItemPredicate`); they narrow with the same `narrowItemsToSignal` helper so all four views agree.

- [ ] **Step 1: Failing tests — `board-filter.ts`**

In `src/lib/boards/board-filter.test.ts`, add `intel: null,` to the `BoardFilterState` literal at line ~86 (after `sort: null,`) — without it the file no longer typechecks once the field exists. Add `parseIntel, serializeIntel, INTEL_PARAM_KEY, URL_PARAM_KEYS, FILTER_PARAM_KEYS,` to the import from `@/lib/boards/board-filter`. Append:

```ts
describe("intel param (active intelligence chip)", () => {
  it("parses kind-only and kind:subject forms", () => {
    expect(parseIntel("overdue")).toEqual({ kind: "overdue" });
    expect(parseIntel("overloaded:u1")).toEqual({
      kind: "overloaded",
      subject: "u1",
    });
  });

  it("rejects unknown kinds, empty subjects and empty strings", () => {
    expect(parseIntel("bogus")).toBeNull();
    expect(parseIntel("overdue:")).toBeNull();
    expect(parseIntel("")).toBeNull();
    expect(parseIntel(null)).toBeNull();
  });

  it("serializes both forms and drops the key when null", () => {
    expect(serializeIntel({ kind: "overdue" })).toBe("overdue");
    expect(serializeIntel({ kind: "overloaded", subject: "u1" })).toBe(
      "overloaded:u1",
    );
    expect(serializeIntel(null)).toBeNull();
  });

  it("round-trips through parseBoardFilter / serializeBoardFilter", () => {
    const state = parseBoardFilter(new URLSearchParams("q=x&intel=blocked"));
    expect(state.intel).toEqual({ kind: "blocked" });
    expect(serializeBoardFilter(state).intel).toBe("blocked");
    expect(serializeBoardFilter({ ...EMPTY_BOARD_FILTER }).intel).toBeNull();
  });

  it("is a URL key but not a persisted filter key", () => {
    expect(URL_PARAM_KEYS).toContain(INTEL_PARAM_KEY);
    expect(FILTER_PARAM_KEYS).not.toContain(INTEL_PARAM_KEY);
  });

  it("does not count toward isFilterActive (the strip owns its own clear)", () => {
    expect(
      isFilterActive({ ...EMPTY_BOARD_FILTER, intel: { kind: "overdue" } }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run --project unit src/lib/boards/board-filter.test.ts`
Expected: FAIL — `parseIntel` is not exported.

- [ ] **Step 3: Implement in `board-filter.ts`**

Add to the imports (top of file):

```ts
import { SIGNAL_ORDER } from "@/lib/boards/intelligence/constants";
import type { IntelSelection } from "@/lib/boards/intelligence/types";
```

In `BoardFilterState` (after `sort`):

```ts
/** The active Intelligence chip (`intel=<kind>[:<subject>]`), or null. URL-only — never persisted. */
intel: IntelSelection | null;
```

In `EMPTY_BOARD_FILTER` add `intel: null,`.

After the `FILTER_PARAM_KEYS` declaration add:

```ts
/**
 * The active Intelligence chip. Lives in the URL next to the filter params
 * (History API, 0 round-trips) but is deliberately NOT in FILTER_PARAM_KEYS:
 * that list is what `useBoardFilterSort` persists into the saved arrangement,
 * and a remembered "changed since Tue" chip would be meaningless next visit.
 */
export const INTEL_PARAM_KEY = "intel";
/** Every board-state param the hook reads from the URL. */
export const URL_PARAM_KEYS = [...FILTER_PARAM_KEYS, INTEL_PARAM_KEY] as const;
```

After `parseConditions` add:

```ts
const SIGNAL_KIND_SET = new Set<string>(SIGNAL_ORDER);

/** `intel=<kind>[:<subject>]` → selection; anything malformed → null (total + safe). */
export function parseIntel(raw: string | null): IntelSelection | null {
  if (!raw) return null;
  const idx = raw.indexOf(":");
  const kind = idx === -1 ? raw : raw.slice(0, idx);
  const subject = idx === -1 ? undefined : raw.slice(idx + 1);
  if (!SIGNAL_KIND_SET.has(kind)) return null;
  if (subject !== undefined && subject === "") return null;
  const k = kind as IntelSelection["kind"];
  return subject === undefined ? { kind: k } : { kind: k, subject };
}

export function serializeIntel(sel: IntelSelection | null): string | null {
  if (!sel) return null;
  return sel.subject ? `${sel.kind}:${sel.subject}` : sel.kind;
}
```

In `parseBoardFilter` add `intel: parseIntel(params.get(INTEL_PARAM_KEY)),`. Change `serializeBoardFilter`'s return type to `Record<(typeof URL_PARAM_KEYS)[number], string | null>` and add `intel: serializeIntel(state.intel),` to its object. Leave `isFilterActive` / `filterFacetCount` unchanged.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run --project unit src/lib/boards/board-filter.test.ts`
Expected: PASS.

- [ ] **Step 5: Failing tests — the hook**

Append to `src/lib/boards/use-board-filter-sort.test.tsx`. The file already mocks `next/navigation` (live `window.location`) and `saveBoardViewPrefs`. Add at the top: `import { saveBoardViewPrefs } from "@/lib/boards/view-prefs-actions";` and `import { SAVE_DEBOUNCE_MS } from "@/lib/boards/view-prefs-context";` (the `BoardViewPrefsProvider` / `EMPTY_BOARD_VIEW_PREFS` imports already exist).

```tsx
describe("useBoardFilterSort intel chip", () => {
  const BOARD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <BoardViewPrefsProvider boardId={BOARD} initial={EMPTY_BOARD_VIEW_PREFS}>
        {children}
      </BoardViewPrefsProvider>
    );
  }

  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/boards/x?view=v1");
    vi.mocked(saveBoardViewPrefs).mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it("setIntel writes intel=<kind:subject> with replaceState and keeps ?view=", () => {
    const spy = vi.spyOn(window.history, "replaceState");
    const { result } = renderHook(() => useBoardFilterSort(), {
      wrapper: Wrapper,
    });
    act(() => result.current.setIntel({ kind: "overloaded", subject: "u1" }));
    expect(spy).toHaveBeenCalledTimes(1);
    const url = String(spy.mock.calls[0][2]);
    expect(url).toContain("intel=overloaded%3Au1");
    expect(url).toContain("view=v1");
    expect(result.current.state.intel).toEqual({
      kind: "overloaded",
      subject: "u1",
    });
    spy.mockRestore();
  });

  it("setIntel(null) removes the param; clearAll removes it too", () => {
    window.history.replaceState(null, "", "/boards/x?intel=overdue&q=x");
    const { result } = renderHook(() => useBoardFilterSort(), {
      wrapper: Wrapper,
    });
    expect(result.current.state.intel).toEqual({ kind: "overdue" });
    act(() => result.current.setIntel(null));
    expect(window.location.search).not.toContain("intel=");
    expect(window.location.search).toContain("q=x");

    act(() => result.current.setIntel({ kind: "overdue" }));
    act(() => result.current.clearAll());
    expect(window.location.search).not.toContain("intel=");
    expect(result.current.state.intel).toBeNull();
  });

  it("never persists the chip into the saved filter query", () => {
    const { result } = renderHook(() => useBoardFilterSort(), {
      wrapper: Wrapper,
    });
    act(() => result.current.setIntel({ kind: "overdue" }));
    act(() => {
      vi.advanceTimersByTime(SAVE_DEBOUNCE_MS + 100);
    });
    // The persisted filter query is unchanged ("" → ""), so the debounced
    // save never fires — proof that intel is not part of what is remembered.
    expect(saveBoardViewPrefs).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run to verify they fail**

Run: `pnpm vitest run --project unit src/lib/boards/use-board-filter-sort.test.tsx`
Expected: FAIL — `result.current.setIntel is not a function`.

- [ ] **Step 7: Implement in `use-board-filter-sort.ts`**

Change the import from `@/lib/boards/board-filter` to add `URL_PARAM_KEYS` (keep `FILTER_PARAM_KEYS` — still used for persistence) and add `import type { IntelSelection } from "@/lib/boards/intelligence/types";`.

Line 49 becomes: `const urlHasFilter = URL_PARAM_KEYS.some((k) => searchParams.get(k));`

Lines 61–63 become (keep the NUL join written as an escape exactly as today):

```ts
const raw = URL_PARAM_KEYS.map((k) => searchParams.get(k) ?? "").join("\u0000");
```

The `write` callback needs no change: `serializeBoardFilter` now returns an `intel` entry, so the key is set/deleted on the URL like every other, and the persistence loop (`for (const key of FILTER_PARAM_KEYS)`) keeps excluding it.

In `clearAll` add `intel: null,` to the literal. After `clearAll` add:

```ts
// The Intelligence chip. replaceState (spec §3.3): a chip toggle is a lens on
// the board, not a navigation the Back button should undo.
const setIntel = useCallback(
  (intel: IntelSelection | null) =>
    write({ ...state, intel }, { replace: true }),
  [state, write],
);
```

Add `setIntel,` to the returned object.

- [ ] **Step 8: Run to verify they pass**

Run: `pnpm vitest run --project unit src/lib/boards/use-board-filter-sort.test.tsx src/lib/boards/board-filter.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit the URL-state half**

```bash
pnpm typecheck && pnpm lint
git add src/lib/boards/board-filter.ts src/lib/boards/board-filter.test.ts src/lib/boards/use-board-filter-sort.ts src/lib/boards/use-board-filter-sort.test.tsx
git commit -m "feat(boards): intel URL param and setIntel in the board filter state"
```

- [ ] **Step 10: Failing test — the provider's derivations**

Create `src/lib/boards/intelligence/context.test.tsx`:

```tsx
import { act, render, renderHook, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { BoardCache } from "@/lib/boards/cache";
import { localTodayISO } from "@/lib/boards/overdue";
import {
  BoardIntelligenceProvider,
  IntelToneFrame,
  useBoardIntelligenceOptional,
  useIntelItemIds,
  useIntelMatch,
} from "./context";

// The hook reads the LIVE window.location, and setIntel writes it with the
// History API — exactly how Next syncs useSearchParams() in the app.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const yesterday = localTodayISO(new Date(Date.now() - 86_400_000));

const cache = {
  board: { id: "b1", org_id: "o1", name: "Board" },
  groups: [
    {
      id: "g1",
      board_id: "b1",
      org_id: "o1",
      name: "G",
      color: "#000",
      position: 0,
    },
  ],
  columns: [
    {
      id: "c-date",
      board_id: "b1",
      org_id: "o1",
      name: "Due",
      kind: "date",
      position: 0,
      settings: {},
      width: null,
    },
  ],
  items: [
    {
      id: "late",
      board_id: "b1",
      org_id: "o1",
      group_id: "g1",
      parent_id: null,
      name: "Late",
      position: 0,
      created_by: "u0",
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
      archived_at: null,
      archived_by: null,
    },
    {
      id: "fine",
      board_id: "b1",
      org_id: "o1",
      group_id: "g1",
      parent_id: null,
      name: "Fine",
      position: 1,
      created_by: "u0",
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
      archived_at: null,
      archived_by: null,
    },
  ],
  cellValues: [
    {
      item_id: "late",
      column_id: "c-date",
      value: { date: yesterday },
      updated_at: "2026-09-01T00:00:00Z",
    },
  ],
  dependencies: [],
  attachments: [],
  timeEntries: [],
  relationLinks: [],
  mirrorTargetCells: [],
  mirrorTargetColumns: [],
} as unknown as BoardCache;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <BoardIntelligenceProvider
        boardId="b1"
        initialData={cache}
        members={[]}
        lastSeenAt={null}
        currentUserId="u1"
      >
        {children}
      </BoardIntelligenceProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => window.history.replaceState(null, "", "/boards/b1"));

describe("BoardIntelligenceProvider", () => {
  it("computes signals from the cache and exposes no active chip by default", () => {
    const { result } = renderHook(() => useBoardIntelligenceOptional(), {
      wrapper,
    });
    expect(result.current?.signals.map((s) => s.kind)).toEqual(["overdue"]);
    expect(result.current?.activeSignal).toBeNull();
    expect(result.current?.intelItemIds).toBeNull();
    expect(result.current?.lastChangeAt).toBe("2026-09-01T00:00:00.000Z");
    expect(result.current?.loading).toBe(false);
  });

  it("toggle activates a chip (URL intel=…), toggling again clears it", () => {
    const { result } = renderHook(
      () => ({
        intel: useBoardIntelligenceOptional(),
        ids: useIntelItemIds(),
        late: useIntelMatch("late"),
        fine: useIntelMatch("fine"),
      }),
      { wrapper },
    );
    const overdue = result.current.intel!.signals[0];
    act(() => result.current.intel!.toggle(overdue));
    expect(window.location.search).toContain("intel=overdue");
    expect(result.current.intel!.activeSignal?.kind).toBe("overdue");
    expect([...result.current.ids!]).toEqual(["late"]);
    expect(result.current.late).toBe(true);
    expect(result.current.fine).toBe(false);

    act(() => result.current.intel!.toggle(overdue));
    expect(window.location.search).not.toContain("intel=");
    expect(result.current.late).toBeNull();
  });

  it("clear removes the chip; a stale URL chip with no matching signal narrows nothing", () => {
    window.history.replaceState(null, "", "/boards/b1?intel=blocked");
    const { result } = renderHook(() => useBoardIntelligenceOptional(), {
      wrapper,
    });
    expect(result.current?.selection).toEqual({ kind: "blocked" });
    expect(result.current?.activeSignal).toBeNull();
    expect(result.current?.intelItemIds).toBeNull();
    act(() => result.current!.clear());
    expect(result.current?.selection).toBeNull();
  });

  it("IntelToneFrame stamps the active tone for the CSS rule", () => {
    window.history.replaceState(null, "", "/boards/b1?intel=overdue");
    render(
      <IntelToneFrame>
        <span>row</span>
      </IntelToneFrame>,
      { wrapper },
    );
    expect(screen.getByText("row").parentElement).toHaveAttribute(
      "data-intel-tone",
      "red",
    );
  });

  it("hooks fail open without a provider", () => {
    const { result } = renderHook(() => ({
      intel: useBoardIntelligenceOptional(),
      ids: useIntelItemIds(),
      m: useIntelMatch("x"),
    }));
    expect(result.current).toEqual({ intel: null, ids: null, m: null });
  });
});
```

- [ ] **Step 11: Run to verify it fails**

Run: `pnpm vitest run --project unit src/lib/boards/intelligence/context.test.tsx`
Expected: FAIL — cannot resolve `./context`.

- [ ] **Step 12: Implement the provider**

Create `src/lib/boards/intelligence/context.tsx`:

```tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { BoardCache } from "@/lib/boards/cache";
import { useBoardCache } from "@/lib/boards/use-board-cache";
import { useBoardFilterSort } from "@/lib/boards/use-board-filter-sort";
import {
  computeSignals,
  findActiveSignal,
  latestActivityISO,
  selectionEquals,
  signalSelection,
} from "./signals";
import type { IntelSelection, Signal } from "./types";

/**
 * Board Intelligence (Phase 1) — the one place signals are computed.
 *
 * Reads the LIVE React-Query board cache (optimistic + realtime edits included),
 * memoizes `computeSignals` on the cache's identity, and mirrors the active chip
 * to the URL through the board filter state (`intel=`; History API; zero RSC
 * re-runs — AGENTS.md working agreement #5).
 *
 * Two contexts on purpose: the strip needs everything; rows need only "am I in
 * the active set". `IntelMatchContext` is `null` when no chip is active and a
 * Set whose identity changes only when its CONTENTS change, so a cell edit that
 * recomputes signals does not re-render every memoized row.
 */
export type BoardIntelligenceValue = {
  signals: Signal[];
  selection: IntelSelection | null;
  activeSignal: Signal | null;
  intelItemIds: ReadonlySet<string> | null;
  lastChangeAt: string | null;
  nowMs: number;
  loading: boolean;
  toggle: (signal: Signal) => void;
  clear: () => void;
};

const BoardIntelligenceContext = createContext<BoardIntelligenceValue | null>(
  null,
);
const IntelMatchContext = createContext<ReadonlySet<string> | null>(null);

export type IntelMember = {
  userId: string;
  fullName: string | null;
  email: string | null;
};

export function BoardIntelligenceProvider({
  boardId,
  initialData,
  members,
  lastSeenAt,
  currentUserId,
  children,
}: {
  boardId: string;
  initialData: BoardCache;
  members: readonly IntelMember[];
  /** board_visits.last_seen_at for the caller, or null on a first visit. */
  lastSeenAt: string | null;
  currentUserId: string;
  children: ReactNode;
}) {
  const query = useBoardCache(boardId, initialData);
  const cache = query.data ?? initialData;
  const loading = query.data === undefined;

  // One clock per mount (react-hooks/purity forbids Date.now() in render). The
  // signals are "as of page open"; the next navigation re-snapshots.
  const [now] = useState(() => new Date());
  const nowMs = now.getTime();

  const memberNames = useMemo(
    () =>
      new Map(
        members.map((m) => [m.userId, m.fullName ?? m.email ?? ""] as const),
      ),
    [members],
  );
  const lastSeen = useMemo(
    () => (lastSeenAt ? new Date(lastSeenAt) : null),
    [lastSeenAt],
  );

  const signals = useMemo(
    () =>
      computeSignals(cache, {
        now,
        lastSeenAt: lastSeen,
        currentUserId,
        memberNames,
      }),
    [cache, now, lastSeen, currentUserId, memberNames],
  );
  const lastChangeAt = useMemo(() => latestActivityISO(cache), [cache]);

  const filter = useBoardFilterSort();
  const selection = filter.state.intel;
  const setIntel = filter.setIntel;

  const activeSignal = useMemo(
    () => findActiveSignal(signals, selection),
    [signals, selection],
  );

  // Content-keyed so the Set's identity survives unrelated cache edits.
  const idsKey = activeSignal ? activeSignal.itemIds.join("\u0000") : null;
  const intelItemIds = useMemo<ReadonlySet<string> | null>(
    () => (idsKey === null ? null : new Set(idsKey.split("\u0000"))),
    [idsKey],
  );

  const toggle = useCallback(
    (signal: Signal) => {
      const next = signalSelection(signal);
      setIntel(selectionEquals(selection, next) ? null : next);
    },
    [selection, setIntel],
  );
  const clear = useCallback(() => setIntel(null), [setIntel]);

  const value = useMemo<BoardIntelligenceValue>(
    () => ({
      signals,
      selection,
      activeSignal,
      intelItemIds,
      lastChangeAt,
      nowMs,
      loading,
      toggle,
      clear,
    }),
    [
      signals,
      selection,
      activeSignal,
      intelItemIds,
      lastChangeAt,
      nowMs,
      loading,
      toggle,
      clear,
    ],
  );

  return (
    <BoardIntelligenceContext.Provider value={value}>
      <IntelMatchContext.Provider value={intelItemIds}>
        {children}
      </IntelMatchContext.Provider>
    </BoardIntelligenceContext.Provider>
  );
}

/** Full strip state, or null when no provider is mounted (fails open). */
export function useBoardIntelligenceOptional(): BoardIntelligenceValue | null {
  return useContext(BoardIntelligenceContext);
}

/** The active chip's item set, or null when no chip / no provider. */
export function useIntelItemIds(): ReadonlySet<string> | null {
  return useContext(IntelMatchContext);
}

/** Per-row: true = matches the active chip, false = does not, null = no chip. */
export function useIntelMatch(itemId: string): boolean | null {
  const ids = useContext(IntelMatchContext);
  return ids === null ? null : ids.has(itemId);
}

/**
 * Stamps the active chip's tone on an ancestor of every row so the CSS rule in
 * globals.css (`[data-intel-tone] .intel-match`) can paint the 2px rule without
 * threading the tone through every view. `display: contents` keeps the views'
 * own flex/height layout untouched.
 */
export function IntelToneFrame({ children }: { children: ReactNode }) {
  const intel = useBoardIntelligenceOptional();
  return (
    <div className="contents" data-intel-tone={intel?.activeSignal?.tone}>
      {children}
    </div>
  );
}
```

- [ ] **Step 13: Run to verify it passes**

Run: `pnpm vitest run --project unit src/lib/boards/intelligence/context.test.tsx`
Expected: PASS (5).

- [ ] **Step 14: Wire the page, BoardViews, OfflineBoard and the BoardViews test**

`src/app/(app)/boards/[boardId]/page.tsx` — add the import:

```ts
import { getBoardLastSeenAt } from "@/lib/boards/intelligence/visits";
```

Change the `Promise.all` destructuring (line 28) to
`const [payload, { data: grantRows }, { data: agentRows }, viewPrefs, lastSeenAt] =`
and append a fifth element after `getBoardViewPrefs(supabase, boardId, user.id),`:

```ts
      // Board Intelligence: when this user last had the board open. A point
      // read on the (board_id, user_id) primary key, in parallel with the
      // payload — the one extra first-paint read spec §8 allows. Drives the
      // "changed since" chip; null on a first visit hides it.
      getBoardLastSeenAt(supabase, boardId, user.id),
```

Add `lastSeenAt={lastSeenAt}` to the `<BoardViews …>` element (after `viewPrefs={viewPrefs}`).

`src/components/offline/OfflineBoard.tsx` — add `lastSeenAt={null}` to its `<BoardViews …>` (after `viewPrefs={EMPTY_BOARD_VIEW_PREFS}`), with the comment `/* No server read offline → no "changed since" chip. */`.

`src/components/boards/BoardViews.tsx` — add the imports:

```ts
import {
  BoardIntelligenceProvider,
  IntelToneFrame,
} from "@/lib/boards/intelligence/context";
import { useBoardVisitTouch } from "@/lib/boards/intelligence/use-board-visit";
```

Add the prop to the signature (after `viewPrefs: ResolvedBoardViewPrefs;`):

```ts
/** board_visits.last_seen_at for the caller (null = first visit). Feeds "changed since". */
lastSeenAt: string | null;
```

and `lastSeenAt,` to the destructuring. Replace the returned tree (lines 219–246) with:

```tsx
return (
  // OUTSIDE the presence provider so every view *and* the item panel can read
  // the saved arrangement.
  <BoardViewPrefsProvider boardId={payload.board.id} initial={viewPrefs}>
    <ActiveViewRecorder viewId={activeViewId} />
    {/* INSIDE the view-prefs provider: it reads the board filter state (the
          `intel=` chip) through useBoardFilterSort. */}
    <BoardIntelligenceProvider
      boardId={payload.board.id}
      initialData={payload}
      members={members}
      lastSeenAt={lastSeenAt}
      currentUserId={currentUserId}
    >
      <BoardPresenceProvider value={presenceValue}>
        <OfflinePersistence userId={currentUserId} />
        <BoardVisitTouch
          boardId={payload.board.id}
          enabled={!isOfflineRender}
        />
        <IntelToneFrame>{view}</IntelToneFrame>
        <PresenceFlashMessage message={flash.lastMessage} />
        <ItemPanel
          itemId={openItem?.id ?? null}
          itemName={openItem?.name ?? ""}
          orgId={payload.board.org_id}
          boardId={payload.board.id}
          currentUserId={currentUserId}
          columns={payload.columns}
          members={members.map((m) => ({
            userId: m.userId,
            fullName: m.fullName,
            avatarUrl: m.avatarUrl,
          }))}
          createdBy={openItem?.created_by ?? null}
          createdAt={openItem?.created_at ?? null}
          onClose={closeItem}
        />
      </BoardPresenceProvider>
    </BoardIntelligenceProvider>
  </BoardViewPrefsProvider>
);
```

Add below `ActiveViewRecorder` at the bottom of the file:

```tsx
/**
 * Stamps the visit (board_visits) once per visit — hidden tab, pagehide or
 * unmount. A component, not a bare hook call, so the offline replay can
 * disable it without a conditional hook. Renders nothing.
 */
function BoardVisitTouch({
  boardId,
  enabled,
}: {
  boardId: string;
  enabled: boolean;
}) {
  useBoardVisitTouch(boardId, enabled);
  return null;
}
```

`src/components/boards/BoardViews.test.tsx` — (a) next to the existing `view-prefs-actions` mock add:

```ts
// The visit stamp is a Server Action (next/headers) — stub it like the prefs save.
vi.mock("@/lib/boards/intelligence/visit-actions", () => ({
  touchBoardVisit: vi.fn(async () => ({ ok: true, data: undefined })),
}));
```

(b) change line 57 to `vi.mock("@/lib/boards/use-board-cache", () => ({ useBoardCache: vi.fn(() => ({ data: undefined })) }));` — the provider destructures the query result; (c) add `lastSeenAt={null}` to every `<BoardViews …>` in the file (four renders).

Run: `pnpm vitest run --project unit src/components/boards/BoardViews.test.tsx`
Expected: PASS (unchanged assertions). Then `pnpm typecheck` — expected 0 errors (this is what catches a missed `lastSeenAt`).

- [ ] **Step 15: Narrow the four views**

`src/components/boards/table/BoardTableInner.tsx` — add imports:

```ts
import { useIntelItemIds } from "@/lib/boards/intelligence/context";
import { narrowItemsToSignal } from "@/lib/boards/intelligence/signals";
```

Directly after `const filter = useBoardFilterSort();` (line 322) add:

```ts
// Active Intelligence chip (null = none). Narrows top-level rows before the
// filter predicate, exactly where quick search narrows them.
const intelItemIds = useIntelItemIds();
```

Change the `visibleItemsByGroup` memo body: `let next = list.filter(predicate);` → `let next = narrowItemsToSignal(list, intelItemIds).filter(predicate);` and its deps to `[itemsByGroup, predicate, comparator, intelItemIds]`. Also keep stalled groups open while their chip is active (spec §3.1 `groupIds`): next to `intelItemIds` add `const intelGroupIds = useBoardIntelligenceOptional()?.activeSignal?.groupIds ?? null;` (add `useBoardIntelligenceOptional` to the same `@/lib/boards/intelligence/context` import) and change the `<GroupSection … collapsed={collapsedGroups.has(group.id)}` prop (≈ line 789) to `collapsed={collapsedGroups.has(group.id) && !(intelGroupIds?.includes(group.id) ?? false)}` — the user's saved collapse state is untouched; the chip only overrides it while active.

`src/components/boards/KanbanBoard.tsx` — add the same two imports. After `const filter = useBoardFilterSort();` (line 195) add `const intelItemIds = useIntelItemIds();`. In `filteredItems`: `let next = cache.items.filter(predicate);` → `let next = narrowItemsToSignal(cache.items, intelItemIds).filter(predicate);` and add `intelItemIds` to the memo deps.

`src/components/boards/CalendarBoard.tsx` — add the same two imports. After the `cellMap` memo (line 163) add:

```ts
// Active Intelligence chip → narrow the items the month/week/agenda lay out.
const intelItemIds = useIntelItemIds();
const intelItems = useMemo(
  () => narrowItemsToSignal(cache.items, intelItemIds),
  [cache.items, intelItemIds],
);
```

In the `shared` object change `items: cache.items,` → `items: intelItems,`.

`src/components/boards/GanttBoard.tsx` — add the same two imports. Directly above the `ganttResult` memo add:

```ts
// Active Intelligence chip → narrow the rows on the timeline. A matching
// sub-item keeps its parent (narrowItemsToSignal) so it stays nested.
const intelItemIds = useIntelItemIds();
const intelItems = useMemo(
  () => narrowItemsToSignal(cache.items, intelItemIds),
  [cache.items, intelItemIds],
);
```

In the memo change `buildGanttRows(cache.items, …` → `buildGanttRows(intelItems, …` and replace `cache.items,` with `intelItems,` in its (eslint-disabled) deps array.

- [ ] **Step 16: Run the existing view suites**

Run: `pnpm vitest run --project unit src/components/boards/BoardTable.test.tsx src/components/boards/BoardTable.render-count.test.tsx src/components/boards/KanbanBoard.test.tsx src/components/boards/CalendarBoard.test.tsx src/components/boards/GanttBoard.test.tsx`
Expected: PASS unchanged — with no provider mounted every view sees `intelItemIds === null` and `narrowItemsToSignal` returns the same array.

- [ ] **Step 17: Gates and commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add src/lib/boards/intelligence/context.tsx src/lib/boards/intelligence/context.test.tsx "src/app/(app)/boards/[boardId]/page.tsx" src/components/boards/BoardViews.tsx src/components/boards/BoardViews.test.tsx src/components/offline/OfflineBoard.tsx src/components/boards/table/BoardTableInner.tsx src/components/boards/KanbanBoard.tsx src/components/boards/CalendarBoard.tsx src/components/boards/GanttBoard.tsx
git commit -m "feat(boards): board intelligence provider, last-seen wiring and chip narrowing in all views"
```

### Task 6: Row highlight (2px tone rule) and 35% dim in Table, Kanban, Calendar and Timeline

**Files:**

- Modify: `src/app/globals.css` (inside the `@layer base { … }` block that holds `.card-lift`, after the `@media (hover: hover) { .card-lift:hover … }` rule, ≈ line 897)
- Modify: `src/components/boards/table/ItemRow.tsx:17` (imports), `:230-240` (root className)
- Modify: `src/components/boards/KanbanBoard.tsx:495-560` (`KanbanCard`)
- Modify: `src/components/boards/calendar/EventBar.tsx:5-13` (imports), `:91-97` (`common`)
- Modify: `src/components/boards/calendar/CalendarAgenda.tsx` (`AgendaDayList` `<li>` at ≈ `:136`)
- Modify: `src/components/boards/gantt/GanttRowItem.tsx:1-31` (imports), `:189-193` (row root)
- Create: `src/components/boards/BoardTable.intel.test.tsx`, `src/components/boards/KanbanBoard.intel.test.tsx`, `src/components/boards/GanttBoard.intel.test.tsx`

**Interfaces:**

- Consumes: Task 5's `useIntelMatch(itemId): boolean | null`, `IntelToneFrame`, `BoardIntelligenceProvider`; `cn` from `@/lib/utils`.
- Produces: CSS classes `intel-match` (2px inset rule in the active tone) and `intel-miss` (35% opacity); every row-level component applies them from `useIntelMatch`.

Design note, recorded: spec §3.3 says the row components take an `intelMatch: boolean | null` prop. The value is still exactly that (`boolean | null` per row) but it is read with `useIntelMatch(item.id)` from the dedicated match context instead of being threaded as a prop through `GroupSection`, `KanbanColumnView`, `CalendarMonth`/`CalendarWeek`/`AgendaDayList` and the Gantt virtualizer — six intermediaries that would otherwise all change for one boolean. The tone (colour) is NOT per row: `IntelToneFrame` stamps `data-intel-tone` once on an ancestor and the CSS rule resolves the colour, so rows stay tone-agnostic. `box-shadow: inset` is used rather than `border-left` so a 2px rule never shifts the row's grid/flex content.

- [ ] **Step 1: Add the CSS rule**

In `src/app/globals.css`, immediately after the `@media (hover: hover) { .card-lift:hover { … } }` block (still inside `@layer base`), add:

```css
/* Board Intelligence (Phase 1): while a strip chip is active the view frame
     carries data-intel-tone; matching rows paint a 2px inset rule in that
     status colour (inset so nothing shifts), non-matching rows dim. Rows only
     know a boolean — the tone is resolved here, once. */
[data-intel-tone="red"] {
  --intel-rule: var(--status-red);
}
[data-intel-tone="orange"] {
  --intel-rule: var(--status-orange);
}
[data-intel-tone="yellow"] {
  --intel-rule: var(--status-yellow);
}
[data-intel-tone="gray"] {
  --intel-rule: var(--status-gray);
}
[data-intel-tone="accent"] {
  --intel-rule: var(--primary);
}
.intel-match {
  box-shadow: inset 2px 0 0 var(--intel-rule, transparent);
}
.intel-miss {
  opacity: 0.35;
}
```

Run: `pnpm vitest run --project unit src/app/globals.contrast.test.ts`
Expected: PASS (the contrast test reads token declarations by selector block; a components rule does not affect it).

- [ ] **Step 2: Failing test — Table narrows and highlights**

Create `src/components/boards/BoardTable.intel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoardTable } from "./BoardTable";
import {
  BoardIntelligenceProvider,
  IntelToneFrame,
} from "@/lib/boards/intelligence/context";
import { localTodayISO } from "@/lib/boards/overdue";
import type { BoardPayload } from "@/lib/boards/queries";

// jsdom offsetHeight/offsetWidth → 0 makes the virtualizer emit 0 rows; stub them.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return 600;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return 1200;
    },
  });
});

vi.mock("@/lib/boards/actions", () => ({
  createGroup: vi.fn(),
  updateGroupColor: vi.fn(),
  deleteGroup: vi.fn(),
  addSubitem: vi.fn(),
  deleteItem: vi.fn(),
  reorderItem: vi.fn(),
  updateColumnSettings: vi.fn(),
}));
vi.mock("@/lib/boards/dependency-actions", () => ({
  createDependency: vi.fn(),
  deleteDependency: vi.fn(),
}));
vi.mock("@/lib/collaboration/actions", () => ({
  createAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
  getAttachmentDownloadUrl: vi.fn(),
  getAttachmentPreviewUrls: vi
    .fn()
    .mockResolvedValue({ ok: true, data: { urls: {} } }),
}));
vi.mock("./BoardHeader", () => ({
  BoardHeader: () => <div data-testid="board-header" />,
}));
// The chip lives in the URL; the provider + table read it through useSearchParams.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const STATUS_COL = "c-status";
const DATE_COL = "c-date";
const WORKING = "opt-working";

function localISO(daysFromToday: number) {
  return localTodayISO(new Date(Date.now() + daysFromToday * 86_400_000));
}
function item(id: string, name: string) {
  return {
    id,
    board_id: "b1",
    org_id: "o1",
    group_id: "g1",
    parent_id: null,
    name,
    position: 0,
    created_by: null,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
  };
}
function cell(itemId: string, columnId: string, value: unknown) {
  return {
    item_id: itemId,
    column_id: columnId,
    value,
    updated_at: "2026-09-01T00:00:00Z",
  };
}
function payload() {
  return {
    board: { id: "b1", org_id: "o1", name: "Board", name_column_width: null },
    groups: [
      {
        id: "g1",
        board_id: "b1",
        org_id: "o1",
        name: "Group 1",
        color: "#0073ea",
        position: 0,
      },
    ],
    columns: [
      {
        id: STATUS_COL,
        board_id: "b1",
        org_id: "o1",
        name: "Status",
        kind: "status",
        position: 0,
        width: null,
        settings: {
          options: [{ id: WORKING, label: "Working on it", color: "#fdab3d" }],
        },
      },
      {
        id: DATE_COL,
        board_id: "b1",
        org_id: "o1",
        name: "Due date",
        kind: "date",
        position: 1,
        width: null,
        settings: {},
      },
    ],
    items: [
      item("i-late", "Late and not done"),
      item("i-future", "Due tomorrow"),
    ],
    cellValues: [
      cell("i-late", STATUS_COL, { optionId: WORKING }),
      cell("i-late", DATE_COL, { date: localISO(-1) }),
      cell("i-future", STATUS_COL, { optionId: WORKING }),
      cell("i-future", DATE_COL, { date: localISO(1) }),
    ],
    dependencies: [],
    views: [],
  } as unknown as BoardPayload;
}

function renderBoard() {
  const qc = new QueryClient();
  const p = payload();
  return render(
    <QueryClientProvider client={qc}>
      <BoardIntelligenceProvider
        boardId="b1"
        initialData={p}
        members={[]}
        lastSeenAt={null}
        currentUserId="u1"
      >
        <IntelToneFrame>
          <BoardTable payload={p} selectedViewId="v1" />
        </IntelToneFrame>
      </BoardIntelligenceProvider>
    </QueryClientProvider>,
  );
}

describe("BoardTable with an active intelligence chip", () => {
  it("shows both rows with no highlight when no chip is active", () => {
    window.history.replaceState(null, "", "/boards/b1");
    renderBoard();
    expect(screen.getByText("Late and not done")).toBeInTheDocument();
    expect(screen.getByText("Due tomorrow")).toBeInTheDocument();
    expect(document.querySelector(".intel-match")).toBeNull();
    expect(document.querySelector(".intel-miss")).toBeNull();
  });

  it("intel=overdue narrows to the overdue row and paints the red rule on it", () => {
    window.history.replaceState(null, "", "/boards/b1?intel=overdue");
    renderBoard();
    expect(screen.getByText("Late and not done")).toBeInTheDocument();
    expect(screen.queryByText("Due tomorrow")).not.toBeInTheDocument();
    const row = screen.getByText("Late and not done").closest(".intel-match");
    expect(row).not.toBeNull();
    expect(row!.closest("[data-intel-tone]")).toHaveAttribute(
      "data-intel-tone",
      "red",
    );
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm vitest run --project unit src/components/boards/BoardTable.intel.test.tsx`
Expected: the second test FAILS — narrowing already works (Task 5) but no element carries `.intel-match`.

- [ ] **Step 4: Implement in `ItemRow.tsx`**

Add the import (next to the `cache` import, line 17):

```ts
import { useIntelMatch } from "@/lib/boards/intelligence/context";
```

Inside the component, after `const selected = useBoardSelection(…)` add:

```ts
// Intelligence chip: true → 2px tone rule, false → dimmed, null → no chip.
// Read from a dedicated context whose value only changes when the active
// set changes, so this memoized row is untouched by unrelated cache edits.
const intelMatch = useIntelMatch(item.id);
```

In the root `<div>`'s `cn(…)` add, after the `isDragging && …` entry:

```ts
        intelMatch === true && "intel-match",
        intelMatch === false && "intel-miss",
```

- [ ] **Step 5: Run to verify it passes, plus the row-render invariant**

Run: `pnpm vitest run --project unit src/components/boards/BoardTable.intel.test.tsx src/components/boards/BoardTable.render-count.test.tsx src/components/boards/BoardTable.overdue.test.tsx`
Expected: PASS.

- [ ] **Step 6: Failing test — Kanban**

Create `src/components/boards/KanbanBoard.intel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { KanbanBoard } from "@/components/boards/KanbanBoard";
import {
  BoardIntelligenceProvider,
  IntelToneFrame,
} from "@/lib/boards/intelligence/context";
import { localTodayISO } from "@/lib/boards/overdue";
import type { BoardPayload } from "@/lib/boards/queries";

vi.mock("@/lib/boards/view-actions", () => ({ updateBoardView: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/boards/use-board-mutations", () => ({
  useBoardMutations: () => ({
    setCell: vi.fn(),
    addItem: vi.fn(),
    clearCellValue: vi.fn(),
    renameItem: vi.fn(),
  }),
}));
vi.mock("@/lib/boards/use-board-realtime", () => ({
  useBoardRealtime: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("./BoardHeader", () => ({
  BoardHeader: () => <div data-testid="board-header" />,
}));

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return 600;
    },
  });
});

const yesterday = localTodayISO(new Date(Date.now() - 86_400_000));

function payload() {
  return {
    board: { id: "b1", org_id: "o1", name: "Board" },
    groups: [{ id: "g1", board_id: "b1" }],
    columns: [
      {
        id: "status",
        board_id: "b1",
        org_id: "o1",
        kind: "status",
        name: "Status",
        position: 0,
        settings: {
          options: [{ id: "o1", label: "Working", color: "#fdab3d" }],
        },
      },
      {
        id: "due",
        board_id: "b1",
        org_id: "o1",
        kind: "date",
        name: "Due",
        position: 1,
        settings: {},
      },
    ],
    items: [
      {
        id: "i1",
        name: "Card A",
        group_id: "g1",
        parent_id: null,
        position: 0,
        updated_at: "2026-09-01T00:00:00Z",
      },
      {
        id: "i2",
        name: "Card B",
        group_id: "g1",
        parent_id: null,
        position: 1,
        updated_at: "2026-09-01T00:00:00Z",
      },
    ],
    cellValues: [
      {
        item_id: "i1",
        column_id: "status",
        value: { optionId: "o1" },
        updated_at: "2026-09-01T00:00:00Z",
      },
      {
        item_id: "i1",
        column_id: "due",
        value: { date: yesterday },
        updated_at: "2026-09-01T00:00:00Z",
      },
      {
        item_id: "i2",
        column_id: "status",
        value: { optionId: "o1" },
        updated_at: "2026-09-01T00:00:00Z",
      },
    ],
    dependencies: [],
    views: [
      {
        id: "v2",
        kind: "kanban",
        name: "Kanban",
        config: { group_column_id: "status" },
      },
    ],
  } as unknown as BoardPayload;
}

function renderKanban() {
  const qc = new QueryClient();
  const p = payload();
  return render(
    <QueryClientProvider client={qc}>
      <BoardIntelligenceProvider
        boardId="b1"
        initialData={p}
        members={[]}
        lastSeenAt={null}
        currentUserId="u1"
      >
        <IntelToneFrame>
          <KanbanBoard payload={p} selectedViewId="v2" members={[]} />
        </IntelToneFrame>
      </BoardIntelligenceProvider>
    </QueryClientProvider>,
  );
}

describe("KanbanBoard with an active intelligence chip", () => {
  it("intel=overdue keeps only the overdue card and marks it", () => {
    window.history.replaceState(null, "", "/boards/b1?intel=overdue");
    renderKanban();
    expect(screen.getByText("Card A")).toBeInTheDocument();
    expect(screen.queryByText("Card B")).not.toBeInTheDocument();
    expect(screen.getByText("Card A").closest("article")).toHaveClass(
      "intel-match",
    );
  });

  it("no chip → both cards, no marks", () => {
    window.history.replaceState(null, "", "/boards/b1");
    renderKanban();
    expect(screen.getByText("Card B")).toBeInTheDocument();
    expect(screen.getByText("Card A").closest("article")).not.toHaveClass(
      "intel-match",
    );
  });
});
```

- [ ] **Step 7: Run to verify it fails, then implement in `KanbanCard`**

Run: `pnpm vitest run --project unit src/components/boards/KanbanBoard.intel.test.tsx`
Expected: first test FAILS on `toHaveClass("intel-match")`.

In `src/components/boards/KanbanBoard.tsx` add `import { useIntelMatch } from "@/lib/boards/intelligence/context";` (next to the `useIntelItemIds` import from Task 5 — merge into one import line). In `KanbanCard`, after `const pending = isOptimisticId(item.id);` add `const intelMatch = useIntelMatch(item.id);`. In the `<article>`'s `cn(…)` add after `isDragging && "opacity-50",`:

```ts
        intelMatch === true && "intel-match",
        intelMatch === false && "intel-miss",
```

Run the test again — expected PASS. Also: `pnpm vitest run --project unit src/components/boards/KanbanBoard.test.tsx` — PASS unchanged.

- [ ] **Step 8: Calendar — EventBar and agenda rows**

`src/components/boards/calendar/EventBar.tsx`: add `import { useIntelMatch } from "@/lib/boards/intelligence/context";`. After `usePresenceFocus(…)` (line ~72) add `const intelMatch = useIntelMatch(interval.itemId);`. In the `common` `cn(…)` add after `isDragging && "opacity-50",`:

```ts
    intelMatch === true && "intel-match",
    intelMatch === false && "intel-miss",
```

`src/components/boards/calendar/CalendarAgenda.tsx`: add the same import and `import { cn } from "@/lib/utils";` if not already imported (it is — check the top of the file). Extract the `<li>` in `AgendaDayList` into a small component so a hook can run per row. Replace the `visible.map((item) => { … })` body's `<li key={item.itemId} data-testid="agenda-item">` with `<AgendaRow key={item.itemId} item={item} statusColumn={statusColumn} cellMap={cellMap} onItemTap={onItemTap} />` and add below `AgendaDayList`:

```tsx
function AgendaRow({
  item,
  statusColumn,
  cellMap,
  onItemTap,
}: {
  item: AgendaItem;
  statusColumn: CacheColumn | undefined;
  cellMap: CellMap;
  onItemTap?: (itemId: string, anchorRect: DOMRect) => void;
}) {
  const isSpan = item.range.end !== item.range.start;
  const statusValue = statusColumn
    ? (cellMap.get(cellKey(item.itemId, statusColumn.id)) ?? null)
    : null;
  const intelMatch = useIntelMatch(item.itemId);
  return (
    <li
      data-testid="agenda-item"
      className={cn(
        intelMatch === true && "intel-match rounded",
        intelMatch === false && "intel-miss",
      )}
    >
      {/* …the existing <button> … </button> exactly as it was … */}
    </li>
  );
}
```

(Move the existing `<button …>…</button>` — lines ≈138–162 of the current file — verbatim into `AgendaRow`; `isSpan` / `statusValue` are computed there now.)

Run: `pnpm vitest run --project unit src/components/boards/CalendarBoard.test.tsx src/components/boards/calendar`
Expected: PASS unchanged (no provider → `null` → no classes).

- [ ] **Step 9: Failing test — Timeline**

Create `src/components/boards/GanttBoard.intel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GanttBoard } from "@/components/boards/GanttBoard";
import {
  BoardIntelligenceProvider,
  IntelToneFrame,
} from "@/lib/boards/intelligence/context";
import { localTodayISO } from "@/lib/boards/overdue";
import type { BoardPayload } from "@/lib/boards/queries";

vi.mock("@/lib/dnd/sensors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/dnd/sensors")>();
  return { useTouchAwareSensors: vi.fn(actual.useTouchAwareSensors) };
});
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return 600;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return 1200;
    },
  });
});
vi.mock("@/lib/boards/use-board-mutations", () => ({
  useBoardMutations: () => ({
    setCell: vi.fn(),
    addItem: vi.fn(),
    clearCellValue: vi.fn(),
    renameItem: vi.fn(),
    addDependency: vi.fn(),
    removeDependency: vi.fn(),
  }),
}));
vi.mock("@/lib/boards/use-board-realtime", () => ({
  useBoardRealtime: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("./BoardHeader", () => ({
  BoardHeader: () => <div data-testid="board-header" />,
}));

const DATE_COL_ID = "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1";
const VIEW_ID = "vvvvvvvv-vvvv-4vvv-8vvv-vvvvvvvvvvvv";
const yesterday = localTodayISO(new Date(Date.now() - 86_400_000));
const nextWeek = localTodayISO(new Date(Date.now() + 7 * 86_400_000));

function payload() {
  return {
    board: { id: "b1", org_id: "o1", name: "My Board" },
    groups: [{ id: "g1", board_id: "b1" }],
    columns: [
      {
        id: DATE_COL_ID,
        board_id: "b1",
        org_id: "o1",
        kind: "date",
        name: "Due Date",
        position: 0,
        settings: {},
      },
    ],
    items: [
      {
        id: "i1",
        name: "Item Alpha",
        group_id: "g1",
        parent_id: null,
        position: 0,
        updated_at: "2026-09-01T00:00:00Z",
      },
      {
        id: "i2",
        name: "Item Beta",
        group_id: "g1",
        parent_id: null,
        position: 1,
        updated_at: "2026-09-01T00:00:00Z",
      },
    ],
    cellValues: [
      {
        item_id: "i1",
        column_id: DATE_COL_ID,
        value: { date: yesterday, end: yesterday },
        updated_at: "2026-09-01T00:00:00Z",
      },
      {
        item_id: "i2",
        column_id: DATE_COL_ID,
        value: { date: nextWeek, end: nextWeek },
        updated_at: "2026-09-01T00:00:00Z",
      },
    ],
    views: [
      {
        id: VIEW_ID,
        kind: "timeline",
        name: "Timeline",
        config: { date_column_id: DATE_COL_ID, zoom: "month" },
        board_id: "b1",
        org_id: "o1",
        position: 0,
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
      },
    ],
    dependencies: [],
  } as unknown as BoardPayload;
}

function renderGantt() {
  const qc = new QueryClient();
  const p = payload();
  return render(
    <QueryClientProvider client={qc}>
      <BoardIntelligenceProvider
        boardId="b1"
        initialData={p}
        members={[]}
        lastSeenAt={null}
        currentUserId="u1"
      >
        <IntelToneFrame>
          <GanttBoard payload={p} members={[]} selectedViewId={VIEW_ID} />
        </IntelToneFrame>
      </BoardIntelligenceProvider>
    </QueryClientProvider>,
  );
}

describe("GanttBoard with an active intelligence chip", () => {
  it("intel=overdue keeps only the overdue row and marks it", () => {
    window.history.replaceState(null, "", "/boards/b1?intel=overdue");
    renderGantt();
    expect(screen.getAllByText("Item Alpha").length).toBeGreaterThan(0);
    expect(screen.queryByText("Item Beta")).not.toBeInTheDocument();
    const rows = screen.getAllByTestId("gantt-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveClass("intel-match");
  });
});
```

- [ ] **Step 10: Run to verify it fails, then implement in `GanttRowItem`**

Run: `pnpm vitest run --project unit src/components/boards/GanttBoard.intel.test.tsx`
Expected: FAIL on `toHaveClass("intel-match")` (narrowing already leaves one row).

In `src/components/boards/gantt/GanttRowItem.tsx` add `import { useIntelMatch } from "@/lib/boards/intelligence/context";`. After `usePresenceFocus(…)` add `const intelMatch = useIntelMatch(row.itemId);`. Change the row root:

```tsx
    <div
      data-testid="gantt-row"
      className={cn(
        "group hover:bg-state-hover/5 flex border-b",
        intelMatch === true && "intel-match",
        intelMatch === false && "intel-miss",
      )}
      style={{ height: ROW_H }}
    >
```

Run: `pnpm vitest run --project unit src/components/boards/GanttBoard.intel.test.tsx src/components/boards/GanttBoard.test.tsx`
Expected: PASS.

- [ ] **Step 11: Gates and commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add src/app/globals.css src/components/boards/table/ItemRow.tsx src/components/boards/KanbanBoard.tsx src/components/boards/calendar/EventBar.tsx src/components/boards/calendar/CalendarAgenda.tsx src/components/boards/gantt/GanttRowItem.tsx src/components/boards/BoardTable.intel.test.tsx src/components/boards/KanbanBoard.intel.test.tsx src/components/boards/GanttBoard.intel.test.tsx
git commit -m "feat(boards): highlight and dim rows for the active intelligence chip in every view"
```

### Task 7: `IntelligenceStrip` component, mounted once under every view's header

**Files:**

- Create: `src/components/boards/IntelligenceStrip.tsx`
- Test: `src/components/boards/IntelligenceStrip.test.tsx`
- Modify: `src/components/boards/BoardHeader.tsx:1-36` (imports), `:130` (`return (` — wrap in a fragment), `:296-298` (`</header>` → add the strip)
- Modify: `src/components/boards/BoardHeader.test.tsx` — no assertion changes expected; run it.

**Interfaces:**

- Consumes: Task 5's `useBoardIntelligenceOptional()` (`BoardIntelligenceValue`), Task 3's `stripSignals`, `Signal`, `SignalTone`; existing `Kicker` (`src/components/ui/kicker.tsx`, props `size?: "sm" | "xs"`), `Skeleton` (`src/components/ui/skeleton.tsx`), `timeAgo(iso: string, nowMs?: number): string` (`src/lib/boards/automation-runs.ts`), `cn`.
- Produces: `IntelligenceStrip()` (reads the provider; renders `null` without one) and the presentational `IntelligenceStripView(props: StripViewProps)` (exported for tests and for Phase 2 to extend).

Phase boundary, recorded: this strip renders kicker + chips + zero-state + "✕ clear" + skeleton only. The "Catch me up" pill and the "updated Xm ago" meta (spec §2.1) are Phase 2 and are NOT rendered here — `IntelligenceStripView` takes no props for them yet.

Mount point, recorded: spec §2.1 places the strip "between `BoardHeader` and the active view". Each view renders its own `<BoardHeader>` (seven call sites across Table/Kanban/Calendar/Gantt incl. their empty-state branches), so the single mount point that appears exactly once in every view is `BoardHeader` itself: it returns `<><header …/><IntelligenceStrip /></>`. The strip fails open (renders nothing) when no `BoardIntelligenceProvider` is above it — which is every non-board consumer of `BoardHeader` (none today) and every existing `BoardHeader` test.

- [ ] **Step 1: Write the failing tests**

Create `src/components/boards/IntelligenceStrip.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  IntelligenceStrip,
  IntelligenceStripView,
  type StripViewProps,
} from "./IntelligenceStrip";
import type { Signal } from "@/lib/boards/intelligence/types";

const NOW = Date.parse("2026-09-11T12:00:00Z");
const sig = (over: Partial<Signal>): Signal => ({
  kind: "overdue",
  count: 3,
  label: "overdue",
  tone: "red",
  itemIds: ["a", "b", "c"],
  ...over,
});

function props(over: Partial<StripViewProps> = {}): StripViewProps {
  return {
    signals: [],
    selection: null,
    activeSignal: null,
    lastChangeAt: null,
    nowMs: NOW,
    loading: false,
    onToggle: vi.fn(),
    onClear: vi.fn(),
    ...over,
  };
}

describe("IntelligenceStripView", () => {
  it("renders the Intelligence kicker and one chip per signal with count + label", () => {
    render(
      <IntelligenceStripView
        {...props({
          signals: [
            sig({}),
            sig({
              kind: "stalled",
              count: 2,
              label: "stalled groups",
              tone: "gray",
              itemIds: ["x"],
            }),
          ],
        })}
      />,
    );
    expect(screen.getByText("Intelligence")).toBeInTheDocument();
    const chips = screen.getAllByRole("button", { pressed: false });
    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveTextContent("3");
    expect(chips[0]).toHaveTextContent("overdue");
    expect(chips[0].className).toContain("rounded-sm");
    expect(chips[0].querySelector(".bg-status-red")).not.toBeNull();
    expect(chips[1].querySelector(".bg-status-gray")).not.toBeNull();
  });

  it("hides zero-count chips and never shows more than five", () => {
    const many = [
      "overdue",
      "blocked",
      "overloaded",
      "overloaded",
      "stalled",
      "changed",
    ].map((kind, i) =>
      sig({
        kind: kind as Signal["kind"],
        label: `${kind}${i}`,
        subjectUserId: kind === "overloaded" ? `u${i}` : undefined,
      }),
    );
    render(
      <IntelligenceStripView
        {...props({ signals: [sig({ count: 0, itemIds: [] }), ...many] })}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(5);
    expect(screen.queryByText("changed5")).not.toBeInTheDocument();
  });

  it("collapses to the one-line zero state with the last change time", () => {
    render(
      <IntelligenceStripView
        {...props({ lastChangeAt: "2026-09-11T09:00:00Z" })}
      />,
    );
    expect(
      screen.getByText(
        "All on track · nothing overdue · last change 3 hours ago",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("omits the last-change segment on an empty board", () => {
    render(<IntelligenceStripView {...props()} />);
    expect(
      screen.getByText("All on track · nothing overdue"),
    ).toBeInTheDocument();
  });

  it("marks the active chip pressed with the accent hairline and shows ✕ clear", async () => {
    const onToggle = vi.fn();
    const onClear = vi.fn();
    const overdue = sig({});
    render(
      <IntelligenceStripView
        {...props({
          signals: [overdue],
          selection: { kind: "overdue" },
          activeSignal: overdue,
          onToggle,
          onClear,
        })}
      />,
    );
    const chip = screen.getByRole("button", { pressed: true });
    expect(chip.className).toContain("border-primary");
    expect(chip.className).toContain("bg-primary/10");
    await userEvent.click(chip);
    expect(onToggle).toHaveBeenCalledWith(overdue);
    await userEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("chips are keyboard-reachable buttons that toggle on Enter", async () => {
    const onToggle = vi.fn();
    const overdue = sig({});
    render(
      <IntelligenceStripView {...props({ signals: [overdue], onToggle })} />,
    );
    const chip = screen.getByRole("button", { name: /overdue/ });
    chip.focus();
    await userEvent.keyboard("{Enter}");
    expect(onToggle).toHaveBeenCalledWith(overdue);
  });

  it("shows skeleton pills, never a spinner, while loading", () => {
    render(<IntelligenceStripView {...props({ loading: true })} />);
    expect(screen.getByLabelText("Loading intelligence")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(document.querySelector(".animate-spin")).toBeNull();
  });

  it("does not render an AI badge, sparkle or glow", () => {
    render(<IntelligenceStripView {...props({ signals: [sig({})] })} />);
    expect(screen.queryByText(/AI/)).not.toBeInTheDocument();
    expect(document.querySelector(".shadow-glow-primary")).toBeNull();
  });
});

describe("IntelligenceStrip (connected)", () => {
  it("renders nothing without a provider", () => {
    const { container } = render(<IntelligenceStrip />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run --project unit src/components/boards/IntelligenceStrip.test.tsx`
Expected: FAIL — cannot resolve `./IntelligenceStrip`.

- [ ] **Step 3: Implement the strip**

Create `src/components/boards/IntelligenceStrip.tsx`:

```tsx
"use client";

import { X } from "lucide-react";
import { Kicker } from "@/components/ui/kicker";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/boards/automation-runs";
import { useBoardIntelligenceOptional } from "@/lib/boards/intelligence/context";
import {
  selectionEquals,
  signalSelection,
  stripSignals,
} from "@/lib/boards/intelligence/signals";
import type {
  IntelSelection,
  Signal,
  SignalTone,
} from "@/lib/boards/intelligence/types";

/**
 * The Intelligence strip (spec §2.1, Phase 1): mono kicker, up to MAX_CHIPS
 * hairline chips, a zero-state line, "✕ clear" while a chip is active, and
 * skeleton pills while the cache hydrates. No AI badge, no glow, no sparkle
 * (decision 27 / pulse-ui). Chip click is a URL-mirrored client filter — zero
 * server round-trips. "Catch me up" and "updated Xm ago" are Phase 2.
 */

/** 6px dot per tone. Static strings so Tailwind emits them. */
const DOT: Record<SignalTone, string> = {
  red: "bg-status-red",
  orange: "bg-status-orange",
  yellow: "bg-status-yellow",
  gray: "bg-status-gray",
  accent: "bg-primary",
};

export type StripViewProps = {
  signals: Signal[];
  selection: IntelSelection | null;
  activeSignal: Signal | null;
  lastChangeAt: string | null;
  nowMs: number;
  loading: boolean;
  onToggle: (signal: Signal) => void;
  onClear: () => void;
};

function zeroStateText(lastChangeAt: string | null, nowMs: number): string {
  const base = "All on track · nothing overdue";
  return lastChangeAt
    ? `${base} · last change ${timeAgo(lastChangeAt, nowMs)}`
    : base;
}

function chipKey(s: Signal): string {
  const sel = signalSelection(s);
  return sel.subject ? `${sel.kind}:${sel.subject}` : sel.kind;
}

function SignalChip({
  signal,
  active,
  onClick,
}: {
  signal: Signal;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "border-border hover:border-border-hover focus-visible:ring-ring ease-keystone inline-flex h-6 shrink-0 items-center gap-1.5 rounded-sm border px-2 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none pointer-coarse:h-11",
        active && "border-primary bg-primary/10",
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 shrink-0 rounded-full", DOT[signal.tone])}
      />
      <span className="font-mono tabular-nums">{signal.count}</span>
      <span className="text-muted-foreground">{signal.label}</span>
    </button>
  );
}

export function IntelligenceStripView({
  signals,
  selection,
  activeSignal,
  lastChangeAt,
  nowMs,
  loading,
  onToggle,
  onClear,
}: StripViewProps) {
  // Zero-count chips are hidden (the engine already drops them; this is the
  // belt to that brace) and the strip shows at most MAX_CHIPS.
  const chips = stripSignals(signals.filter((s) => s.count > 0));
  return (
    <div
      role="toolbar"
      aria-label="Intelligence"
      className="flex h-8 shrink-0 items-center gap-2 overflow-x-auto px-6"
    >
      <span className="flex shrink-0 items-center gap-1.5">
        <span
          aria-hidden
          className="bg-muted-foreground/60 size-1.5 shrink-0 rounded-full"
        />
        <Kicker size="xs">Intelligence</Kicker>
      </span>

      {loading ? (
        <span
          className="flex items-center gap-1.5"
          role="status"
          aria-busy="true"
          aria-label="Loading intelligence"
        >
          <Skeleton className="h-5 w-20 rounded-sm" />
          <Skeleton className="h-5 w-24 rounded-sm" />
          <Skeleton className="h-5 w-16 rounded-sm" />
        </span>
      ) : chips.length === 0 ? (
        <span className="text-muted-foreground truncate text-xs">
          {zeroStateText(lastChangeAt, nowMs)}
        </span>
      ) : (
        chips.map((s) => (
          <SignalChip
            key={chipKey(s)}
            signal={s}
            active={
              activeSignal !== null &&
              selectionEquals(signalSelection(activeSignal), signalSelection(s))
            }
            onClick={() => onToggle(s)}
          />
        ))
      )}

      {selection !== null && !loading ? (
        <button
          type="button"
          onClick={onClear}
          className="text-muted-foreground hover:text-foreground hover:bg-state-hover focus-visible:ring-ring ease-keystone inline-flex h-6 shrink-0 items-center gap-1 rounded-sm px-1.5 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none pointer-coarse:h-11"
        >
          <X className="size-3" aria-hidden />
          clear
        </button>
      ) : null}
    </div>
  );
}

/** Connected strip: reads the board's provider; renders nothing without one. */
export function IntelligenceStrip() {
  const intel = useBoardIntelligenceOptional();
  if (!intel) return null;
  return (
    <IntelligenceStripView
      signals={intel.signals}
      selection={intel.selection}
      activeSignal={intel.activeSignal}
      lastChangeAt={intel.lastChangeAt}
      nowMs={intel.nowMs}
      loading={intel.loading}
      onToggle={intel.toggle}
      onClear={intel.clear}
    />
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run --project unit src/components/boards/IntelligenceStrip.test.tsx`
Expected: PASS (9).

- [ ] **Step 5: Mount it in `BoardHeader`**

In `src/components/boards/BoardHeader.tsx` add `import { IntelligenceStrip } from "@/components/boards/IntelligenceStrip";`. Change the component's `return (` so the `<header …>` is wrapped in a fragment with the strip as its next sibling:

```tsx
return (
  <>
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-6 py-2">
      {/* … everything exactly as it is today … */}
    </header>
    {/* Board Intelligence strip (spec §2.1): its own ~32px row between the
          header and the view. Mounted HERE because every view renders its own
          BoardHeader, so this is the one place that appears exactly once in
          all four views. Renders nothing without a BoardIntelligenceProvider. */}
    <IntelligenceStrip />
  </>
);
```

(Only the wrapper and the trailing `<IntelligenceStrip />` change; re-indent the header body by two spaces to keep Prettier happy — `pnpm prettier --write src/components/boards/BoardHeader.tsx` does it.)

Run: `pnpm vitest run --project unit src/components/boards/BoardHeader.test.tsx src/components/boards/BoardViews.test.tsx`
Expected: PASS unchanged (no provider in the header test → strip renders null; BoardViews stubs the views).

- [ ] **Step 6: Gates and commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add src/components/boards/IntelligenceStrip.tsx src/components/boards/IntelligenceStrip.test.tsx src/components/boards/BoardHeader.tsx
git commit -m "feat(boards): intelligence strip with signal chips under every board header

Changelog: new | Board intelligence strip | Every board now shows overdue, blocked, overloaded, stalled and changed-since chips under its header; click a chip to focus the board on those rows."
```

Then: `pnpm changelog:gen && git add src/lib/changelog/generated.ts && git commit -m "chore(changelog): regenerate generated.ts"` (CI on `develop` fails if the generated file is stale — CONTRIBUTING → "Changelog entries").

---

### Task 8: Final gates, merge, and the "How to test" walkthrough

**Files:** none new. Runs from inside the worktree.

- [ ] **Step 1: Full gates on the merged state**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all four exit 0. `pnpm test` includes the conformance project — with `.env.local` pointing at DEV it probes the live project and must report `touch_board_visit` as denied (42501) and `board_visits` as denied/empty for anon; if it reports REACHABLE/READABLE, Task 4's lockdown statements were not applied.

- [ ] **Step 2: Ledger check and status review**

```bash
pnpm db:ledger-check
git status
```

Expected: ledger in sync (exit 0); `git status` clean except files you did not touch (leave those alone).

- [ ] **Step 3: Finish the task**

```bash
scripts/finish-task.sh
```

Expected: rebases `task/board-intelligence-orient` onto `origin/develop`, re-runs the gates, merges into `develop`, pushes, removes the worktree and deletes the branch. If it stops on a rebase conflict, resolve `git rebase develop` and re-run. The task is not complete until this succeeds.

- [ ] **Step 4: Session note**

Run `/wrapup` and include the "How to test" section below verbatim in the session note (`vault/sessions/`).

#### How to test this (manual walkthrough)

Setup: pull `develop`, `pnpm install`, `pnpm dev`, sign in to an org on DEV (the live deployment runs the DEV database — use a board you own and can safely edit). Use a board that has a **Status** column with "Working on it / Stuck / Done", a **Date** column, and a **People** column (the default new-board template has the first two; add a People column named "Owner" and a Numbers column named "Effort").

1. **Strip appears in every view.** Open `/boards/<id>`. Under the header, a ~32px row reads `INTELLIGENCE` (mono kicker with a small grey dot) followed either by chips or by `All on track · nothing overdue · last change …`. Switch to Kanban, Calendar and Timeline via the view tabs — the same strip is present once in each.
2. **Overdue chip.** Set one item's Date to yesterday and leave its Status not Done. The strip shows a chip `● 1 overdue` (red dot). Set a second item's date to yesterday but Status = Done — the count stays 1.
3. **Click filters, URL mirrors, no reload.** Click `1 overdue`. Expected: the URL gains `?intel=overdue` without a page reload (network tab: no RSC/document fetch), the chip gets the periwinkle hairline + 10% fill, the table shows only the overdue row with a 2px red rule at its left edge, and the "Filter" toolbar is unchanged.
4. **Clear.** Click the chip again — filter clears, URL loses `intel=`. Click it once more, then click `✕ clear` — same result. The Back button does not step through chip toggles (replaceState).
5. **All views narrow.** With `?intel=overdue` active, switch to Kanban (only the overdue card, red-ruled), Calendar (only that item's chip on the month grid; in Agenda mode only that row), Timeline (only that row, red rule). Switch back to Table.
6. **Blocked chain.** In Timeline, add a dependency from item A to item B (row menu → dependency). Set A's Status = Stuck. Table: chip `● 1 blocked chain` (orange dot). Click it: both A and B are shown; A and B carry the orange rule.
7. **Overloaded.** Assign 4 open items to yourself and 1 each to two other members (People column). Chip `● 4 overloaded · <your first name>` (yellow). Click: only your four items remain. Set the Effort column to 5 on one of the others' items — the chip may change or disappear as the median moves (expected: weights count).
8. **Stalled.** Needs a group whose items have not been edited for > 5 days and has at least one open item — use an old board, or skip. Chip `● N stalled group(s)` (grey); clicking shows that group's open items.
9. **Changed since (second visit).** With the board open, switch to another browser tab for a second, come back (that stamps the visit on `hidden`), then edit any cell (rename an item, change a status). Reload the page. Chip `● 1 changed since <time>` (periwinkle dot) appears — clicking it shows only the item you edited. On a brand-new board you have never opened before, no `changed` chip appears on first load.
10. **Zero state.** On a small board with nothing overdue/blocked/stalled/overloaded and after you have already seen it, the strip shows `All on track · nothing overdue · last change 2 minutes ago` (no buttons).
11. **Viewer.** Share the board to a second account as viewer, open it as that user: the strip renders in full and chips filter; nothing in the strip is write-gated.
12. **Not built in this phase (do not expect):** a "Catch me up" pill, an "updated Xm ago" meta, or anything in the dock — those are Phase 2.

---

## Spec coverage (self-review)

| Spec section                                                                                                                                                | Where                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| §2.1 strip: placement under header in all views, own ~32px row                                                                                              | Task 7 (mounted in `BoardHeader`, `h-8`)                                                                                |
| §2.1 kicker "Intelligence" + 6px dot; ≤5 hairline chips with dot/count/label; zero-count hidden; zero-state line; skeleton not spinner                      | Task 7                                                                                                                  |
| §2.1 chip click → filter; active chip accent hairline + 10% fill; "✕ clear"; second click clears                                                            | Task 5 (`toggle`/`clear`, `setIntel`), Task 7 (UI)                                                                      |
| §2.1 matching rows 2px status-colour rule, non-matching ~35% dim                                                                                            | Task 6 (`.intel-match` / `.intel-miss`, `data-intel-tone`)                                                              |
| §2.1 "Catch me up" pill, "updated Xm ago" meta                                                                                                              | **Phase 2 — deliberately not built**                                                                                    |
| §2.1 viewers see the strip in full                                                                                                                          | Task 7 (no access gating); manual test step 11                                                                          |
| §3.1 module + signature, `constants.ts` thresholds                                                                                                          | Tasks 1–3                                                                                                               |
| §3.2 overdue / overloaded / stalled / changed / blocked; ordering; `MAX_CHIPS`                                                                              | Tasks 1, 2, 3                                                                                                           |
| §3.3 `intel=<kind>[:<subject>]` via `replaceState`; hook exposes it; all four views narrow; `intelMatch: boolean \| null` per row                           | Task 5 (URL + narrowing), Task 6 (rows)                                                                                 |
| §3.1 `groupIds` keeps stalled groups expanded while the chip is active                                                                                      | Task 5 Step 15 (`BoardTableInner` `collapsed` override)                                                                 |
| §3.4 `board_visits` table + RLS; read at first paint; `touchBoardVisit` on hidden/unmount, once, silent                                                     | Task 4 (+ Task 5 wiring)                                                                                                |
| §7 migration minted by script, applied via MCP, ledger-checked, types regenerated; RLS default-deny via board access predicate; Zod-validated Server Action | Task 4                                                                                                                  |
| §8 first-paint = payload + one PK read; in-page = 0 round-trips; visit write once per visit                                                                 | Budget section; Tasks 4, 5                                                                                              |
| §10 signals table tests (thresholds, done excluded, first visit hides changed, blocked includes dependents, empty board, ordering, truncation)              | Tasks 1–3                                                                                                               |
| §10 strip RTL (chips+counts, zero-state, click → URL + filter, second click clears, viewer, skeleton)                                                       | Task 7 (view), Task 5 `context.test.tsx` (URL round-trip), Task 6 (filter effect)                                       |
| §10 views narrow + highlight                                                                                                                                | Task 6 (`BoardTable/KanbanBoard/GanttBoard.intel.test.tsx`; Calendar via the shared helper's unit test + manual step 5) |
| §10 integration suites under `PULSE_TEST_DB`                                                                                                                | Task 4 (`board-visits.rls.integration.test.ts`)                                                                         |

## Deviations from the spec text (all recorded inline, collected here)

1. `lastSeenAt` is a sibling PK read in the page (`getBoardLastSeenAt`), not a join inside `getBoardPayload` — same cost, no ripple through `BoardPayload`/`BoardCache`/offline snapshot/fixtures.
2. `computeSignals` accepts a structural `SignalsInput` (Pick of `BoardCache`) and an optional `memberNames`; `currentUserId` is accepted but unused in Phase 1 (reserved for the Phase-2 server recompute).
3. Overloaded does not call `src/lib/workload/` helpers (they need capacity/settings reads the payload lacks); it implements the spec's definition on payload data with a name-matched effort column.
4. "Last activity" = max(`items.updated_at`, that item's `cell_values.updated_at`) because no trigger bumps `items.updated_at` on cell edits.
5. Row `intelMatch` is read via `useIntelMatch(itemId)` (dedicated context) instead of a prop threaded through six intermediaries; the tone is stamped once on `IntelToneFrame`.
6. Calendar/Timeline never applied the board filter; they now narrow with the shared `narrowItemsToSignal` (parents of matching sub-items are kept in every view).
7. `intel` is not persisted to the saved view arrangement and does not count toward the toolbar's `isFilterActive`.
8. Blocked = "stuck/blocked"-labelled option on the first status column (no separate blocked flag exists); chain follows successors transitively; count = blockers.
9. The strip is mounted inside `BoardHeader` (fragment sibling) because every view owns its header.
10. Overdue checks every date column, not only the primary one — mirrors the date cell tinting every past date.

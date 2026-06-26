# Item Creation Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record who created every item/subitem and when, and surface it as two immutable, read-only "Created by" / "Created at" columns at the end of the board table (and in the item panel).

**Architecture:** `created_at` already exists on `items`; add a `created_by` uuid column, attribute it server-side on insert (DB trigger), and make both fields immutable on update (DB trigger). Render the two values as **virtual trailing columns** — read straight off the item row, exactly like the existing virtual Name column — never as `columns`/`cell_values` rows. Reuse a small pair of pure read-only cell components in both the table and the item panel.

**Tech Stack:** Next.js 16 (App Router, RSC), Supabase/Postgres (migrations + RLS + triggers), TypeScript strict, React 19, Tailwind v4 + shadcn (`pulse-ui` tokens), Vitest + Testing Library, lucide-react icons.

## Global Constraints

- Schema changes are **versioned migrations** in `supabase/migrations/`; after applying, regenerate `src/types/database.types.ts` via `pnpm db:types` — **never hand-edit** types.
- **The agent cannot apply migrations / run DDL against the cloud DB** (classifier denies). Task 1 includes a **manual user handoff** to apply the SQL; everything that references `created_by` in TypeScript is blocked until types are regenerated.
- Server Components by default; the two columns are **read-only display only** — no Server Action, no mutation path (immutability is enforced in the DB).
- Style with **semantic `pulse-ui` tokens only** (no raw Tailwind colors); `text-sm`, `size-3.5` icons in dense rows, monochrome chrome.
- Commit identity is pinned by `start-task.sh`. **Stage by path** (`git add <paths>`) — never `git add -A`/`.`/`-a`. Commit subjects lowercase after `type(scope):`; include a body + `Co-Authored-By: Danijel Jovanovic <info@synapse-solutions.ai>` trailer.
- Perf budget: `created_by` rides the existing `items.select("*")` board payload → **0 new queries on first paint, 0 round-trips on interaction**. No new index (no sort/filter on these columns).

---

## File Structure

- **Create** `supabase/migrations/20260625120000_item_created_by.sql` — column + backfill + triggers.
- **Modify** `src/types/database.types.ts` — regenerated (adds `items.created_by`).
- **Create** `src/lib/boards/item-creation-metadata.integration.test.ts` — DB attribution + immutability tests.
- **Create** `src/components/boards/cells/created.tsx` — `formatDateTime`, `CreatedByCell`, `CreatedAtCell`.
- **Create** `src/components/boards/cells/created.test.tsx` — unit tests for the above.
- **Modify** `src/components/boards/BoardTable.tsx` — grid template + two cells in every row path.
- **Create/Modify** a BoardTable test asserting the trailing columns render for item + subitem rows.
- **Modify** `src/components/boards/item-panel/ItemPanel.tsx` — read-only "Created" section + 2 new props.
- **Modify** `src/components/boards/BoardViews.tsx` — pass `createdBy`/`createdAt` to `<ItemPanel>`.
- **Modify** `src/components/boards/item-panel/ItemPanel.test.tsx` — assert the Created section renders.

---

## Execution DAG

**Interfaces (edge list):**

- **T1 (DB)** — _consumes:_ nothing. _produces:_ `items.created_by: string` column (regenerated in `database.types.ts`); INSERT-attribution + UPDATE-immutability guarantees.
- **T2 (cells)** — _consumes:_ nothing (pure; takes `name`/`avatarUrl`/`iso` primitives). _produces:_ `formatDateTime(iso)`, `<CreatedByCell name avatarUrl?>`, `<CreatedAtCell iso>`.
- **T3 (table)** — _consumes:_ T1 (`item.created_by`/`item.created_at` typed) + T2 (`CreatedByCell`, `CreatedAtCell`). _produces:_ rendered trailing columns in `BoardTable` for item + subitem rows.
- **T4 (panel)** — _consumes:_ T1 (`openItem.created_by`/`.created_at`) + T2 (`CreatedByCell`, `CreatedAtCell`, `formatDateTime`). _produces:_ Created section in `ItemPanel`.

**Parallel batches:**

- **Batch A (concurrent):** **T1**, **T2** — disjoint footprints (SQL/types vs pure components). T2 has no dependency on T1's regen (it takes primitives), so it fully completes regardless of the apply handoff.
- **Batch B (concurrent, after A):** **T3**, **T4** — both depend on T1 (types) and T2 (cells); disjoint files (`BoardTable.tsx` vs `item-panel/`), so they run concurrently.

**Critical path:** T1 (write → **user applies SQL** → regen types) → T3. T2 overlaps T1; T4 overlaps T3.

---

## Task 1: DB — `created_by` column, attribution + immutability, backfill

**Files:**

- Create: `supabase/migrations/20260625120000_item_created_by.sql`
- Modify: `src/types/database.types.ts` (regenerated, not hand-edited)
- Test: `src/lib/boards/item-creation-metadata.integration.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `items.created_by` (uuid, NOT NULL after backfill, FK `auth.users(id)`); guarantee that any authenticated insert sets `created_by = auth.uid()` and `created_at = now()` (ignoring client-supplied values), and that `created_by`/`created_at` can never change on UPDATE.

**Context for the implementer:**

- `items` is defined in `supabase/migrations/20260615061747_boards_core.sql:50-66`; it already has `created_at timestamptz not null default now()`. Subitems are rows in the **same table** with `parent_id` set (no separate table).
- The existing `create_item` RPC (`boards_core.sql:198-236`) inserts without `created_by`; `addSubitem` (`src/lib/boards/actions.ts:422-433`) does a direct insert without `created_by`. **Neither needs changing** — the BEFORE INSERT trigger fills `created_by` for both paths.
- `organizations.created_by uuid not null references auth.users(id)` exists (`20260614174043_init_auth_tenancy.sql:30`) — the backfill source.
- Integration tests run against the **live cloud DB** using `.env.local` (symlinked in the worktree) and `describe.skipIf(!SERVICE_ROLE_KEY)`. Mirror the harness in `src/lib/boards/subitems.integration.test.ts` (provisionUser, signInWithRetry, admin service client). They will **fail until the migration is applied** — that is expected and is the red phase.

- [ ] **Step 1: Write the failing integration test**

Create `src/lib/boards/item-creation-metadata.integration.test.ts`. Mirror the provisioning harness from `subitems.integration.test.ts` (copy `provisionUser`, `insertItem`, `beforeAll`/`afterAll`, the `TestUser` type, and the env/const preamble verbatim). Then add these tests inside the `describe.skipIf(!SERVICE_ROLE_KEY)(...)` block:

```ts
it("attributes a new item to the authenticated creator", async () => {
  const before = Date.now();
  const { data: item, error } = await insertItem(userA, "Owned", null);
  expect(error).toBeNull();
  expect(item!.created_by).toBe(userA.id);
  expect(new Date(item!.created_at).getTime()).toBeGreaterThanOrEqual(
    before - 5_000,
  );
});

it("ignores a client-supplied created_by (anti-spoof)", async () => {
  // Try to forge attribution to userB while signed in as userA.
  const { data: item, error } = await userA.anon
    .from("items")
    .insert({
      org_id: userA.orgId,
      board_id: userA.boardId,
      group_id: userA.groupId,
      parent_id: null,
      name: "Forged",
      position: 1,
      created_by: userB.id, // forged — trigger must override
    })
    .select("*")
    .single();
  expect(error).toBeNull();
  expect(item!.created_by).toBe(userA.id);
});

it("attributes a subitem to its creator", async () => {
  const { data: parent } = await insertItem(userA, "P-meta", null);
  const { data: sub, error } = await insertItem(userA, "S-meta", parent!.id);
  expect(error).toBeNull();
  expect(sub!.created_by).toBe(userA.id);
});

it("keeps created_by/created_at immutable on update", async () => {
  const { data: item } = await insertItem(userA, "Immutable", null);
  const originalBy = item!.created_by;
  const originalAt = item!.created_at;

  // A normal rename must not touch the audit fields.
  await userA.anon.from("items").update({ name: "Renamed" }).eq("id", item!.id);
  // An explicit attempt to rewrite the audit fields must be silently preserved.
  await userA.anon
    .from("items")
    .update({ created_by: userB.id, created_at: "2000-01-01T00:00:00Z" })
    .eq("id", item!.id);

  const { data: after } = await userA.anon
    .from("items")
    .select("created_by, created_at, name")
    .eq("id", item!.id)
    .single();
  expect(after!.name).toBe("Renamed");
  expect(after!.created_by).toBe(originalBy);
  expect(after!.created_at).toBe(originalAt);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- item-creation-metadata.integration`
Expected: FAIL (either a TS error that `created_by` is unknown on the items Insert/Row, or assertions failing because the column/triggers don't exist yet).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260625120000_item_created_by.sql`:

```sql
-- Item creation metadata: attribute the creator and freeze creator + timestamp.
-- created_at already exists on public.items (boards_core). We add created_by,
-- backfill it to each row's organization creator, then install triggers that
-- (a) stamp creator + created_at from the authenticated caller on INSERT, and
-- (b) make both fields immutable on UPDATE.

-- 1. Column: who created the row (mirrors organizations.created_by convention).
alter table public.items
  add column created_by uuid references auth.users (id);

-- 2. Backfill existing rows to their org's creator (the one sanctioned default).
update public.items i
set created_by = o.created_by
from public.organizations o
where o.id = i.org_id
  and i.created_by is null;

-- 3. Lock the column down now that every row has a value.
alter table public.items
  alter column created_by set not null;

-- 4. Attribution on INSERT. Force creator + timestamp from the authenticated
--    caller, ignoring any client-supplied value (anti-spoofing). When there is
--    no JWT (service-role / migration contexts), keep the provided value so
--    tooling and seeds still work.
create function public.items_set_creation_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();
    new.created_at := now();
  end if;
  return new;
end;
$$;

create trigger items_set_creation_metadata
  before insert on public.items
  for each row execute function public.items_set_creation_metadata();

-- 5. Immutability on UPDATE. created_by/created_at can never change, for any
--    caller. (Installed AFTER the backfill so the one-time update above runs.)
create function public.items_protect_creation_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  return new;
end;
$$;

create trigger items_protect_creation_metadata
  before update on public.items
  for each row execute function public.items_protect_creation_metadata();
```

- [ ] **Step 4: Hand off to the user to apply the migration (manual — agent is blocked)**

Print the SQL file path and ask the user to apply it to the Supabase project (SQL editor or `supabase db push`), then confirm. Do **not** attempt `mcp__supabase__apply_migration` more than once — if it is denied by the classifier, fall back to the user handoff immediately. Wait for the user's confirmation that the migration applied cleanly.

- [ ] **Step 5: Regenerate types**

Run: `pnpm db:types`
Expected: `src/types/database.types.ts` updates so `items.Row.created_by: string` and `items.Insert.created_by?: string | null` appear. Commit this file in this task.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test -- item-creation-metadata.integration`
Expected: PASS (all four tests green).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260625120000_item_created_by.sql \
        src/types/database.types.ts \
        src/lib/boards/item-creation-metadata.integration.test.ts
git commit -m "feat(items): attribute + freeze item creation metadata

Add items.created_by (backfilled to the org creator), a BEFORE INSERT
trigger that stamps creator + created_at from the authenticated caller
(anti-spoof), and a BEFORE UPDATE trigger making both fields immutable.
Covered by an integration test for attribution, anti-spoof, subitems,
and immutability.

Co-Authored-By: Danijel Jovanovic <info@synapse-solutions.ai>"
```

---

## Task 2: Read-only cell components + datetime formatter

**Files:**

- Create: `src/components/boards/cells/created.tsx`
- Test: `src/components/boards/cells/created.test.tsx`

**Interfaces:**

- Consumes: nothing (pure presentational; primitives only).
- Produces:
  - `formatDateTime(iso: string | null): string` — localized "MMM D, YYYY, h:mm AM" or `""` for null/invalid.
  - `CreatedByCell({ name, avatarUrl }: { name: string | null; avatarUrl?: string | null })` — avatar/initials + name; muted "Unknown" when `name` is null.
  - `CreatedAtCell({ iso }: { iso: string | null })` — formatted datetime; empty when null/invalid.

**Context:** Match the existing cell idiom in `src/components/boards/cells/index.tsx` (e.g. `DateCell` uses `text-sm`; empty cells render `<span className="text-sm" />`). Avatar pattern mirrors `presence/PresenceAvatarStack.tsx` (image or 2-char initials in a rounded chip). Use `pulse-ui` tokens only.

- [ ] **Step 1: Write the failing unit test**

Create `src/components/boards/cells/created.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CreatedAtCell, CreatedByCell, formatDateTime } from "./created";

describe("formatDateTime", () => {
  it("returns '' for null or invalid input", () => {
    expect(formatDateTime(null)).toBe("");
    expect(formatDateTime("not-a-date")).toBe("");
  });
  it("formats a valid ISO string to a non-empty, year-bearing label", () => {
    const out = formatDateTime("2026-06-25T15:42:00Z");
    expect(out).not.toBe("");
    expect(out).toContain("2026");
  });
});

describe("CreatedByCell", () => {
  it("renders the creator name", () => {
    render(<CreatedByCell name="Danijel Jovanovic" />);
    expect(screen.getByText("Danijel Jovanovic")).toBeInTheDocument();
  });
  it("renders 'Unknown' when name is null", () => {
    render(<CreatedByCell name={null} />);
    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });
  it("renders the avatar image when avatarUrl is provided", () => {
    const { container } = render(
      <CreatedByCell name="Danijel Jovanovic" avatarUrl="https://x/y.png" />,
    );
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://x/y.png",
    );
  });
});

describe("CreatedAtCell", () => {
  it("renders a formatted datetime for a valid ISO string", () => {
    render(<CreatedAtCell iso="2026-06-25T15:42:00Z" />);
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });
  it("renders empty for null", () => {
    const { container } = render(<CreatedAtCell iso={null} />);
    expect(container.textContent).toBe("");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- created.test`
Expected: FAIL with "Cannot find module './created'".

- [ ] **Step 3: Write the implementation**

Create `src/components/boards/cells/created.tsx`:

```tsx
/** Read-only renderers for the virtual creation-metadata columns. Pure: they
 *  take resolved primitives, not DB rows, so the table and the item panel can
 *  both reuse them. */

export function formatDateTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function CreatedByCell({
  name,
  avatarUrl,
}: {
  name: string | null;
  avatarUrl?: string | null;
}) {
  if (!name)
    return <span className="text-muted-foreground text-sm">Unknown</span>;
  return (
    <span className="flex items-center gap-2 truncate text-sm">
      <span className="bg-surface-muted flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full text-[10px] font-medium">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className="size-full object-cover" />
        ) : (
          initials(name)
        )}
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}

export function CreatedAtCell({ iso }: { iso: string | null }) {
  const formatted = formatDateTime(iso);
  if (!formatted) return <span className="text-sm" />;
  return <span className="text-sm tabular-nums">{formatted}</span>;
}
```

> Note: if ESLint flags the `<img>` (next/no-img-element), keep the inline disable comment shown above — the existing avatar pattern in `PresenceAvatarStack.tsx` uses a plain `<img>` too. Run lint to confirm before committing.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- created.test`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/cells/created.tsx src/components/boards/cells/created.test.tsx
git commit -m "feat(boards): read-only created-by/created-at cell renderers

Add formatDateTime plus CreatedByCell (avatar/initials + name, 'Unknown'
fallback) and CreatedAtCell (localized date+time), pure components reused
by the board table and the item panel. Unit tested.

Co-Authored-By: Danijel Jovanovic <info@synapse-solutions.ai>"
```

---

## Task 3: BoardTable — two virtual trailing columns

**Files:**

- Modify: `src/components/boards/BoardTable.tsx`
- Test: `src/components/boards/BoardTable.created-columns.test.tsx` (create; or add to an existing BoardTable test if one renders rows)

**Interfaces:**

- Consumes: T1 (`item.created_by`, `item.created_at` typed on `Tables<"items">`), T2 (`CreatedByCell`, `CreatedAtCell`).
- Produces: two read-only columns rendered after the last user column and before the `+` add-column slot, in the header, item rows, and subitem rows; footer/rollup rows stay aligned.

**Context — exact anchors (verify line numbers before editing; the file is ~2224 lines):**

- Width consts at `BoardTable.tsx:216-218` (`VALUE_COL_WIDTH = 180`, `ADD_COL_WIDTH = 44`).
- `gridTemplate()` at `:220-230` returns `` `${nameWidth}px ${tracks} ${ADD_COL_WIDTH}px` ``.
- The template is computed once and used by **5** row paths — all must keep the add-col track aligned:
  - GroupHeaderRow map + `<AddColumnMenu />` at `:1152-1164`.
  - ItemRow map + trailing `<div aria-hidden />` at `:1615-1638`.
  - SortableSubitemRow map + trailing `<div aria-hidden />` at `:1713-1722`.
  - SummaryFooter (`:326`) and GroupRollupRow (`:1206-1215`) — these render summary/rollup cells; they need **two empty filler cells** so the grid columns line up.
- Row components get members + currentUserId via `controls.members: EditorMember[]` (`EditorMember` = `{ userId, fullName, email, avatarUrl }`) and `controls.currentUserId`.
- The Name column is frozen left (`sticky left-0`); nothing is frozen right — the two new columns **scroll normally**. No sticky/resize on them (they are fixed-width, fixed-position).

- [ ] **Step 1: Write the failing component test**

Create `src/components/boards/BoardTable.created-columns.test.tsx`. Render `BoardTable` with a minimal payload containing one group, one top-level item, and one subitem, plus a `members` entry whose `userId` matches the items' `created_by`. (Mirror the payload/props shape from any existing BoardTable-rendering test in `src/components/boards/`; if none renders rows, construct the `payload` from the `BoardPayload` type in `src/lib/boards/queries.ts` and pass the same props `BoardViews` passes at `BoardViews.tsx:118-125`.) Assert:

```tsx
// Header labels present.
expect(screen.getByText("Created by")).toBeInTheDocument();
expect(screen.getByText("Created at")).toBeInTheDocument();
// Creator name shows for the item row (resolved from members).
expect(screen.getAllByText("Danijel Jovanovic").length).toBeGreaterThanOrEqual(
  1,
);
// The created-at value (year) renders for the row.
expect(screen.getAllByText(/2026/).length).toBeGreaterThanOrEqual(1);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- BoardTable.created-columns`
Expected: FAIL ("Created by" / "Created at" not found).

- [ ] **Step 3: Extend the grid template**

In `BoardTable.tsx`, add two width consts near `:216` and append two tracks in `gridTemplate()`:

```ts
const CREATED_BY_WIDTH = 180;
const CREATED_AT_WIDTH = 180;
```

```ts
// in gridTemplate(), change the return to:
return `${nameWidth}px ${tracks} ${CREATED_BY_WIDTH}px ${CREATED_AT_WIDTH}px ${ADD_COL_WIDTH}px`;
```

- [ ] **Step 4: Add a static header pair**

Import the icons and the cells at the top of the file:

```ts
import { Clock, User } from "lucide-react";
import {
  CreatedByCell,
  CreatedAtCell,
} from "@/components/boards/cells/created";
```

Define a small local header component (read-only, no menu/resize) near the other row helpers, matching the height/padding of the existing header cells (read the GroupHeaderRow header-cell wrapper around `:1069-1151` and `ColumnHeader.tsx` for the exact classes, then mirror them minus the interactive controls):

```tsx
function CreatedHeaderCell({
  icon: Icon,
  label,
}: {
  icon: typeof User;
  label: string;
}) {
  return (
    <div className="text-muted-foreground flex items-center gap-1.5 px-2 text-xs font-medium">
      <Icon className="size-3.5" />
      <span className="truncate">{label}</span>
    </div>
  );
}
```

In GroupHeaderRow, insert between the end of the `columns.map(...)` and `<AddColumnMenu />` (around `:1163`):

```tsx
<CreatedHeaderCell icon={User} label="Created by" />
<CreatedHeaderCell icon={Clock} label="Created at" />
```

- [ ] **Step 5: Add the two cells to item + subitem rows**

In ItemRow, between the end of `columns.map(...)` and the trailing `<div aria-hidden />` (around `:1637`):

```tsx
{
  (() => {
    const creator = controls.members.find((m) => m.userId === item.created_by);
    return (
      <>
        <div className="flex items-center px-2">
          <CreatedByCell
            name={creator?.fullName ?? creator?.email ?? null}
            avatarUrl={creator?.avatarUrl ?? null}
          />
        </div>
        <div className="flex items-center px-2">
          <CreatedAtCell iso={item.created_at} />
        </div>
      </>
    );
  })();
}
```

In SortableSubitemRow, insert the same block (using `sub` instead of `item`) between its `columns.map(...)` and trailing `<div aria-hidden />` (around `:1721`).

> Use the same cell wrapper classes the surrounding `<EditableCell>` uses for vertical alignment/borders — read one `EditableCell` render to match its outer `<div>` classes (e.g. border-right, height); the `flex items-center px-2` above is a baseline, align it to the neighbours.

- [ ] **Step 6: Keep footer + rollup rows aligned**

In SummaryFooter (`:326`) and GroupRollupRow (`:1206-1215`), add two empty filler cells right after their existing per-column cells so the add-col / trailing tracks stay aligned:

```tsx
<div aria-hidden />
<div aria-hidden />
```

(GroupRollupRow has no add-col spacer; the two fillers are still correct and harmless.)

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm test -- BoardTable.created-columns`
Expected: PASS.

- [ ] **Step 8: Run typecheck + the full BoardTable test file**

Run: `pnpm typecheck && pnpm test -- BoardTable`
Expected: no type errors; existing BoardTable tests still pass (column alignment unchanged for existing assertions).

- [ ] **Step 9: Commit**

```bash
git add src/components/boards/BoardTable.tsx src/components/boards/BoardTable.created-columns.test.tsx
git commit -m "feat(boards): render created-by/created-at as fixed trailing columns

Append two read-only virtual columns after the last user column (before
the add-column slot) in the header, item rows, and subitem rows, reading
created_by/created_at off the item row; footer and rollup rows get filler
cells to keep the grid aligned. Component tested for items and subitems.

Co-Authored-By: Danijel Jovanovic <info@synapse-solutions.ai>"
```

---

## Task 4: Item panel — read-only "Created" section

**Files:**

- Modify: `src/components/boards/item-panel/ItemPanel.tsx`
- Modify: `src/components/boards/BoardViews.tsx`
- Test: `src/components/boards/item-panel/ItemPanel.test.tsx`

**Interfaces:**

- Consumes: T1 (`openItem.created_by`, `openItem.created_at`), T2 (`CreatedByCell`, `CreatedAtCell`).
- Produces: a read-only Created section in the panel; two new `ItemPanel` props `createdBy: string | null`, `createdAt: string | null`.

**Context:** `ItemPanel` (`ItemPanel.tsx:26-44`) currently takes `members: readonly Member[]` where `Member = { userId: string; fullName: string | null }` (no avatar) — so the panel shows initials + name (avatarUrl omitted). `BoardViews.tsx:82-84` already resolves `openItem` (the full item row) and `:132-144` renders `<ItemPanel>`. The "fields" tab body is the placeholder at `ItemPanel.tsx:109-114` — render the Created section there.

- [ ] **Step 1: Write the failing test**

In `src/components/boards/item-panel/ItemPanel.test.tsx`, add a test (mirror the existing render setup in that file for required props):

```tsx
it("shows read-only creation metadata in the fields tab", async () => {
  const user = userEvent.setup();
  render(
    <ItemPanel
      itemId="item-1"
      itemName="Design review"
      orgId="org-1"
      boardId="board-1"
      currentUserId="u-1"
      columns={[]}
      members={[{ userId: "u-1", fullName: "Danijel Jovanovic" }]}
      createdBy="u-1"
      createdAt="2026-06-25T15:42:00Z"
      onClose={() => {}}
    />,
  );
  await user.click(screen.getByRole("button", { name: /fields/i }));
  expect(screen.getByText("Created by")).toBeInTheDocument();
  expect(screen.getByText("Danijel Jovanovic")).toBeInTheDocument();
  expect(screen.getByText("Created at")).toBeInTheDocument();
  expect(screen.getByText(/2026/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- ItemPanel`
Expected: FAIL (props `createdBy`/`createdAt` don't exist; section not rendered).

- [ ] **Step 3: Add the props and the section to ItemPanel**

Add the imports:

```tsx
import {
  CreatedByCell,
  CreatedAtCell,
} from "@/components/boards/cells/created";
```

Add `createdBy` and `createdAt` to the props type and destructure (`ItemPanel.tsx:26-44`):

```tsx
  createdBy,
  createdAt,
// ...in the type:
  createdBy: string | null;
  createdAt: string | null;
```

Replace the "fields" tab placeholder body (`:109-114`) so it keeps the existing note **and** appends the read-only Created section:

```tsx
{
  tab === "fields" && (
    <div className="space-y-4 py-6">
      <p className="text-muted-foreground text-sm">
        Edit fields in the board grid. (Inline field editing in the panel is a
        fast-follow.)
      </p>
      <dl className="space-y-2 border-t pt-4">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground text-sm">Created by</dt>
          <dd>
            <CreatedByCell
              name={
                members.find((m) => m.userId === createdBy)?.fullName ?? null
              }
            />
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground text-sm">Created at</dt>
          <dd>
            <CreatedAtCell iso={createdAt} />
          </dd>
        </div>
      </dl>
    </div>
  );
}
```

- [ ] **Step 4: Pass the new props from BoardViews**

In `BoardViews.tsx` `<ItemPanel>` (`:132-144`), add:

```tsx
        createdBy={openItem?.created_by ?? null}
        createdAt={openItem?.created_at ?? null}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test -- ItemPanel`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: no errors (BoardViews passes the two new required props; `openItem` is typed with `created_by`/`created_at`).

- [ ] **Step 7: Commit**

```bash
git add src/components/boards/item-panel/ItemPanel.tsx \
        src/components/boards/BoardViews.tsx \
        src/components/boards/item-panel/ItemPanel.test.tsx
git commit -m "feat(boards): show read-only creation metadata in the item panel

Add a Created by / Created at section to the item panel's fields tab,
fed by two new read-only props wired from the already-loaded item row in
BoardViews. Reuses the shared created-by/created-at renderers. Tested.

Co-Authored-By: Danijel Jovanovic <info@synapse-solutions.ai>"
```

---

## Final verification (after all tasks)

- [ ] `pnpm typecheck` — clean
- [ ] `pnpm lint` — clean
- [ ] `pnpm test` — all green (incl. the new integration + component tests; integration needs the migration applied)
- [ ] `pnpm build` — production build succeeds

## Performance & data-fetching budget (from spec)

- **First paint:** `created_by` rides the existing `items.select("*")` board payload (`src/lib/boards/queries.ts`) — **0 new queries**. Creator names resolve from the already-loaded `members` directory; an unresolved creator degrades to "Unknown" (no fetch, no N+1).
- **Per interaction:** read-only columns — no toggle/sort/filter/edit — **0 round-trips, 0 Server Actions**. Immutability means there is deliberately no mutation path.
- **Bounded/indexed:** reuses the existing bounded board read; no new index (no sort/filter on the new columns; YAGNI until sorting is requested).

## Out of scope (YAGNI)

- Sorting/filtering by creator or creation time (no index added).
- Creation metadata on Kanban/Calendar/Gantt cards (table + panel only; the panel is reachable from every view).
- Hiding/resizing/reordering the two columns (they are fixed).
- An updated-by/updated-at pair (only creation is requested).

## Self-Review

- **Spec coverage:** created_by column + attribution + immutability + backfill → T1; read-only cells + datetime format → T2; two fixed trailing table columns for items **and** subitems → T3; item-panel surface → T4; perf budget + DAG carried verbatim. All spec sections map to a task.
- **Placeholder scan:** every code step ships real code; the only manual step (T1 Step 4) is an unavoidable infra handoff, explicitly described, not a TODO.
- **Type consistency:** `formatDateTime`, `CreatedByCell({name, avatarUrl?})`, `CreatedAtCell({iso})` are defined in T2 and consumed with those exact signatures in T3/T4; `item.created_by`/`created_at` (string) defined in T1 and consumed in T3/T4; `EditorMember`/`Member` shapes match their respective consumers (table has avatarUrl, panel does not).

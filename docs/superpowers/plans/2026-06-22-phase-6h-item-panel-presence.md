# Item-Panel "Who's Viewing This Item" Presence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show an "Also viewing" avatar stack in the item-panel header of the other board members who currently have the same `?item=` drawer open, driven entirely by the existing Realtime presence channel.

**Architecture:** Add a pure `presenceTarget.item(itemId)` builder; extract the existing avatar-stack markup out of `BoardPresenceBar` into a presentational `PresenceAvatarStack`; add a context-reading `ItemViewersBar` that selects the per-item viewers from `focusMap`; wire `ItemPanel` to register a `{ viewKind: "panel" }` focus while open and render the bar in its header. No DB, no migration, no Server Action, no new query — ephemeral presence over the existing private channel.

**Tech Stack:** Next.js 16 (App Router, RSC), React 19, Tailwind v4 + shadcn, Supabase Realtime Presence, Zod, Vitest + Testing Library (jsdom).

**Before any UI step:** load the **`pulse-ui`** and **`frontend-design`** skills (AGENTS.md #3). Chrome stays monochrome; the only color is the per-user presence color applied inline (reuse the exact pattern from `BoardPresenceBar`/`PresenceRing`).

**Spec:** `docs/superpowers/specs/2026-06-22-phase-6h-item-panel-presence-design.md`

---

## File Structure

| File                                                          | Responsibility                                            | Change                                      |
| ------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------- |
| `src/lib/boards/presence-target.ts`                           | Focus-target string builders                              | Modify: add `item(itemId)`                  |
| `src/lib/boards/presence-target.test.ts`                      | Builder unit tests                                        | Modify: add `item` cases                    |
| `src/lib/validations/presence.ts`                             | Zod schema guarding the panel focus-target input          | Create                                      |
| `src/components/boards/presence/PresenceAvatarStack.tsx`      | Presentational avatar stack (props-in, no context)        | Create (extracted from `BoardPresenceBar`)  |
| `src/components/boards/presence/PresenceAvatarStack.test.tsx` | Stack primitive tests                                     | Create                                      |
| `src/components/boards/presence/BoardPresenceBar.tsx`         | Board-wide roster bar                                     | Modify: delegate rendering to the primitive |
| `src/components/boards/presence/ItemViewersBar.tsx`           | "Also viewing" bar; selects per-item viewers from context | Create                                      |
| `src/components/boards/presence/ItemViewersBar.test.tsx`      | Viewers-bar tests                                         | Create                                      |
| `src/components/boards/item-panel/ItemPanel.tsx`              | Item drawer; registers panel focus + renders the bar      | Modify                                      |
| `src/components/boards/item-panel/ItemPanel.test.tsx`         | Panel wiring tests                                        | Create or Modify (see Task 5)               |

Do NOT touch: `presence-reducer.ts`, `use-board-presence.ts`, `presence-context.tsx`, `BoardViews.tsx` (the provider boundary is already correct), `presence-channel.ts`, or any migration — confirmed in the spec.

---

## Task 1: `presenceTarget.item` builder

**Files:**

- Modify: `src/lib/boards/presence-target.ts`
- Test: `src/lib/boards/presence-target.test.ts`

- [ ] **Step 1: Read the existing test + source to match style**

Run: `cat src/lib/boards/presence-target.ts src/lib/boards/presence-target.test.ts`
Note the existing `card`/`event` builders and their test shape; mirror them.

- [ ] **Step 2: Write the failing test**

Add to `src/lib/boards/presence-target.test.ts`:

```ts
import { presenceTarget } from "./presence-target";

it("builds an item target keyed on the item id", () => {
  expect(presenceTarget.item("abc")).toBe("item:abc");
});

it("item targets are distinct from card targets for the same id", () => {
  expect(presenceTarget.item("abc")).not.toBe(presenceTarget.card("abc"));
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/lib/boards/presence-target.test.ts`
Expected: FAIL — `presenceTarget.item is not a function`.

- [ ] **Step 4: Implement the builder**

In `src/lib/boards/presence-target.ts`, add inside the object (after `event`):

```ts
  item: (itemId: string) => `item:${itemId}`,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/lib/boards/presence-target.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/boards/presence-target.ts src/lib/boards/presence-target.test.ts
git commit -m "feat(presence): add presenceTarget.item focus-target builder"
```

---

## Task 2: Zod guard for the panel focus-target input

**Files:**

- Create: `src/lib/validations/presence.ts`
- Test: `src/lib/validations/presence.test.ts`

This satisfies the "validate at boundaries" invariant: the call site in `ItemPanel`
(Task 5) validates the `itemId` before it flows into a presence-channel `track`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/validations/presence.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { itemPresenceTargetSchema } from "./presence";

describe("itemPresenceTargetSchema", () => {
  it("accepts a non-empty item id", () => {
    expect(itemPresenceTargetSchema.parse("item-123")).toBe("item-123");
  });

  it("rejects an empty string", () => {
    expect(itemPresenceTargetSchema.safeParse("").success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/validations/presence.test.ts`
Expected: FAIL — cannot find module `./presence`.

- [ ] **Step 3: Implement the schema**

Create `src/lib/validations/presence.ts`:

```ts
import { z } from "zod";

/**
 * Guards the `itemId` that becomes a panel presence focus-target before it is
 * broadcast over the Realtime channel. Item ids are opaque non-empty strings
 * (uuids in practice); we only assert non-empty here to avoid coupling to id
 * format.
 */
export const itemPresenceTargetSchema = z.string().min(1);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/validations/presence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/presence.ts src/lib/validations/presence.test.ts
git commit -m "feat(presence): add Zod guard for panel focus-target item id"
```

---

## Task 3: Extract `PresenceAvatarStack` presentational primitive

**Files:**

- Create: `src/components/boards/presence/PresenceAvatarStack.tsx`
- Test: `src/components/boards/presence/PresenceAvatarStack.test.tsx`
- Modify: `src/components/boards/presence/BoardPresenceBar.tsx`

**UI task — load `pulse-ui` + `frontend-design` first.** This moves the existing
chip/overflow/tooltip markup verbatim into a props-in component; no visual change.

- [ ] **Step 1: Write the failing test for the primitive**

Create `src/components/boards/presence/PresenceAvatarStack.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PresenceAvatarStack } from "./PresenceAvatarStack";
import type { RosterOccupant } from "@/lib/boards/presence-types";

function occ(id: string, name: string): RosterOccupant {
  return { userId: id, name, avatarUrl: null, color: "#888", isSelf: false };
}

describe("PresenceAvatarStack", () => {
  it("renders nothing when there are no occupants", () => {
    const { container } = render(
      <PresenceAvatarStack occupants={[]} ariaLabel="People" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a face per occupant up to maxFaces and a +k overflow chip", () => {
    const occupants = [
      occ("1", "Ann"),
      occ("2", "Bob"),
      occ("3", "Cy"),
      occ("4", "Dee"),
    ];
    render(
      <PresenceAvatarStack
        occupants={occupants}
        ariaLabel="People"
        maxFaces={2}
      />,
    );
    expect(screen.getByLabelText("People")).toBeInTheDocument();
    // 2 faces shown, remaining 2 collapse to "+2"
    expect(screen.getByLabelText("2 more people")).toHaveTextContent("+2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/boards/presence/PresenceAvatarStack.test.tsx`
Expected: FAIL — cannot find module `./PresenceAvatarStack`.

- [ ] **Step 3: Create the primitive (move markup out of `BoardPresenceBar`)**

Create `src/components/boards/presence/PresenceAvatarStack.tsx`:

```tsx
"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { RosterOccupant } from "@/lib/boards/presence-types";

/**
 * Overlapping avatar stack — pure presentational. Faces are capped at
 * `maxFaces`; the remainder collapse into a `+k` overflow chip with a tooltip
 * listing the hidden names. Reads no context: callers select the occupants.
 */
export function PresenceAvatarStack({
  occupants,
  ariaLabel,
  maxFaces = 5,
}: {
  occupants: RosterOccupant[];
  ariaLabel: string;
  maxFaces?: number;
}) {
  if (occupants.length === 0) return null;

  const shown = occupants.slice(0, maxFaces);
  const hidden = occupants.slice(maxFaces);
  const overflow = hidden.length;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex items-center -space-x-2" aria-label={ariaLabel}>
        {shown.map((o) => (
          <Tooltip key={o.userId}>
            <TooltipTrigger asChild>
              <span>
                <AvatarChip occupant={o} />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {o.isSelf ? `${o.name} (you)` : o.name}
            </TooltipContent>
          </Tooltip>
        ))}

        {overflow > 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="bg-surface-muted text-muted-foreground ring-background relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums ring-2"
                aria-label={`${overflow} more ${overflow === 1 ? "person" : "people"}`}
              >
                {`+${overflow}`}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {hidden
                .map((o) => (o.isSelf ? `${o.name} (you)` : o.name))
                .join(", ")}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </TooltipProvider>
  );
}

function AvatarChip({ occupant }: { occupant: RosterOccupant }) {
  return (
    <span
      className={cn(
        "bg-surface text-foreground ring-background relative flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-medium ring-2 select-none",
      )}
      // Per-user presence color as a thin inner border (data-driven, like status).
      style={{ boxShadow: `inset 0 0 0 1.5px ${occupant.color}` }}
    >
      {occupant.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- user avatars from arbitrary hosts; matches existing convention (FilesCell, AttachmentCard)
        <img
          src={occupant.avatarUrl}
          alt=""
          className="size-full object-cover"
        />
      ) : (
        initials(occupant.name)
      )}
    </span>
  );
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
```

- [ ] **Step 4: Run the primitive test to verify it passes**

Run: `pnpm vitest run src/components/boards/presence/PresenceAvatarStack.test.tsx`
Expected: PASS.

- [ ] **Step 5: Refactor `BoardPresenceBar` to delegate to the primitive**

Replace the entire body of `src/components/boards/presence/BoardPresenceBar.tsx` with:

```tsx
"use client";

import { useBoardPresenceContextOptional } from "@/lib/boards/presence-context";
import { PresenceAvatarStack } from "./PresenceAvatarStack";

/**
 * Overlapping avatar stack of everyone currently present on the board. Reads the
 * roster from presence context and delegates rendering to {@link PresenceAvatarStack}.
 */
export function BoardPresenceBar({ maxFaces = 5 }: { maxFaces?: number }) {
  const presence = useBoardPresenceContextOptional();
  const roster = presence?.roster ?? [];
  return (
    <PresenceAvatarStack
      occupants={roster}
      ariaLabel="People on this board"
      maxFaces={maxFaces}
    />
  );
}
```

- [ ] **Step 6: Run the board-bar test to confirm no regression**

Run: `pnpm vitest run src/components/boards/presence/BoardPresenceBar.test.tsx`
Expected: PASS (behavior unchanged). If a test asserted the old `aria-label`
wording, it still matches ("People on this board"). If any assertion targeted
internal markup that moved, update it to go through the rendered output (not
internals) — do not weaken coverage.

- [ ] **Step 7: Commit**

```bash
git add src/components/boards/presence/PresenceAvatarStack.tsx src/components/boards/presence/PresenceAvatarStack.test.tsx src/components/boards/presence/BoardPresenceBar.tsx
git commit -m "refactor(presence): extract PresenceAvatarStack primitive from BoardPresenceBar"
```

---

## Task 4: `ItemViewersBar` — per-item viewers selector

**Files:**

- Create: `src/components/boards/presence/ItemViewersBar.tsx`
- Test: `src/components/boards/presence/ItemViewersBar.test.tsx`

Depends on Task 1 (`presenceTarget.item`) and Task 3 (`PresenceAvatarStack`).
**UI task — `pulse-ui` + `frontend-design` loaded.**

- [ ] **Step 1: Write the failing test**

Create `src/components/boards/presence/ItemViewersBar.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ItemViewersBar } from "./ItemViewersBar";
import {
  BoardPresenceProvider,
  type BoardPresenceContextValue,
} from "@/lib/boards/presence-context";
import { presenceTarget } from "@/lib/boards/presence-target";
import type { RosterOccupant } from "@/lib/boards/presence-types";

function occ(id: string, name: string): RosterOccupant {
  return { userId: id, name, avatarUrl: null, color: "#888", isSelf: false };
}

function ctx(
  focusMap: Map<string, RosterOccupant[]>,
): BoardPresenceContextValue {
  return {
    roster: [],
    focusMap,
    setFocus: () => {},
    selfUserId: "self",
    selfFocusTargetId: null,
    channelStatus: "SUBSCRIBED",
    flashTargetId: null,
  };
}

function renderInProvider(
  node: React.ReactNode,
  focusMap: Map<string, RosterOccupant[]>,
) {
  return render(
    <BoardPresenceProvider value={ctx(focusMap)}>{node}</BoardPresenceProvider>,
  );
}

describe("ItemViewersBar", () => {
  it("renders nothing when there is no itemId", () => {
    const { container } = renderInProvider(
      <ItemViewersBar itemId={null} />,
      new Map(),
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing outside a provider", () => {
    const { container } = render(<ItemViewersBar itemId="i1" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders other viewers of the same item", () => {
    const map = new Map([[presenceTarget.item("i1"), [occ("u2", "Bob")]]]);
    renderInProvider(<ItemViewersBar itemId="i1" />, map);
    expect(screen.getByLabelText("Also viewing this item")).toBeInTheDocument();
  });

  it("excludes the current user from the viewers", () => {
    const map = new Map([
      [presenceTarget.item("i1"), [{ ...occ("self", "Me") }]],
    ]);
    const { container } = renderInProvider(<ItemViewersBar itemId="i1" />, map);
    expect(container.firstChild).toBeNull();
  });
});
```

> Note: this test imports `BoardPresenceContextValue` from `presence-context`. It
> is already exported there (verified). If a future change makes it non-exported,
> export it — do not inline-duplicate the type.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/boards/presence/ItemViewersBar.test.tsx`
Expected: FAIL — cannot find module `./ItemViewersBar`.

- [ ] **Step 3: Implement `ItemViewersBar`**

Create `src/components/boards/presence/ItemViewersBar.tsx`:

```tsx
"use client";

import { useBoardPresenceContextOptional } from "@/lib/boards/presence-context";
import { presenceTarget } from "@/lib/boards/presence-target";
import { PresenceAvatarStack } from "./PresenceAvatarStack";

/**
 * Header indicator for the item detail panel: the avatar stack of *other* board
 * members who currently have the same item's panel open. Reads the per-item
 * viewer set from presence context (`focusMap`) — no new data path. Renders
 * `null` when there is no item, no provider, or no other viewers.
 */
export function ItemViewersBar({ itemId }: { itemId: string | null }) {
  const presence = useBoardPresenceContextOptional();
  if (!presence || !itemId) return null;

  const { focusMap, selfUserId } = presence;
  const others = (focusMap.get(presenceTarget.item(itemId)) ?? []).filter(
    (o) => o.userId !== selfUserId,
  );
  if (others.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground text-xs">Also viewing</span>
      <PresenceAvatarStack
        occupants={others}
        ariaLabel="Also viewing this item"
        maxFaces={3}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/boards/presence/ItemViewersBar.test.tsx`
Expected: PASS (all four cases).

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/presence/ItemViewersBar.tsx src/components/boards/presence/ItemViewersBar.test.tsx
git commit -m "feat(presence): add ItemViewersBar 'also viewing' indicator"
```

---

## Task 5: Wire `ItemPanel` — register panel focus + render the bar

**Files:**

- Modify: `src/components/boards/item-panel/ItemPanel.tsx`
- Test: `src/components/boards/item-panel/ItemPanel.test.tsx` (create if absent)

Depends on Task 1 (`presenceTarget.item`), Task 2 (Zod guard), Task 4 (`ItemViewersBar`).

- [ ] **Step 1: Check for an existing ItemPanel test**

Run: `ls src/components/boards/item-panel/ItemPanel.test.tsx 2>/dev/null || echo "absent"`
If absent, create it in Step 2; if present, append the new cases.

- [ ] **Step 2: Write the failing test (focus registration + header bar)**

Create/append `src/components/boards/item-panel/ItemPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ItemPanel } from "./ItemPanel";
import {
  BoardPresenceProvider,
  type BoardPresenceContextValue,
} from "@/lib/boards/presence-context";
import { presenceTarget } from "@/lib/boards/presence-target";

function ctx(
  setFocus: BoardPresenceContextValue["setFocus"],
): BoardPresenceContextValue {
  return {
    roster: [],
    focusMap: new Map(),
    setFocus,
    selfUserId: "self",
    selfFocusTargetId: null,
    channelStatus: "SUBSCRIBED",
    flashTargetId: null,
  };
}

const baseProps = {
  itemName: "Widget",
  orgId: "org1",
  boardId: "board1",
  currentUserId: "self",
  columns: [],
  members: [],
  onClose: () => {},
} as const;

describe("ItemPanel presence", () => {
  it("registers a panel focus target while the panel is open", () => {
    const setFocus = vi.fn();
    render(
      <BoardPresenceProvider value={ctx(setFocus)}>
        <ItemPanel {...baseProps} itemId="i1" />
      </BoardPresenceProvider>,
    );
    expect(setFocus).toHaveBeenCalledWith({
      viewKind: "panel",
      targetId: presenceTarget.item("i1"),
    });
  });

  it("does not register a focus when there is no open item", () => {
    const setFocus = vi.fn();
    render(
      <BoardPresenceProvider value={ctx(setFocus)}>
        <ItemPanel {...baseProps} itemId={null} />
      </BoardPresenceProvider>,
    );
    expect(setFocus).not.toHaveBeenCalledWith(
      expect.objectContaining({ viewKind: "panel" }),
    );
  });
});
```

> jsdom note (gotcha-36 family): these tests do **not** open a real socket — they
> render against a stub provider, so no native-`Event` global surgery is needed.
> If `useItemCollab`/mutation hooks need a QueryClient at render, wrap the tree in
> a `QueryClientProvider` with a fresh `QueryClient` (check the existing
> `BoardViews.test.tsx` for the project's standard test wrapper and reuse it).

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/components/boards/item-panel/ItemPanel.test.tsx`
Expected: FAIL — `setFocus` not called with the panel target (wiring absent).

- [ ] **Step 4: Wire the panel**

In `src/components/boards/item-panel/ItemPanel.tsx`:

(a) Add imports near the top:

```tsx
import { usePresenceFocus } from "@/lib/boards/use-presence-focus";
import { presenceTarget } from "@/lib/boards/presence-target";
import { itemPresenceTargetSchema } from "@/lib/validations/presence";
import { ItemViewersBar } from "@/components/boards/presence/ItemViewersBar";
```

(b) Inside the component body, after the existing hooks (e.g. after the
`useState`/`useItemCollab` lines), register the focus. Validate the id at the
boundary before building the target:

```tsx
// While the panel is open, broadcast a "viewing this item" focus over the
// existing presence channel so other open panels can show us. Ephemeral —
// no DB write, no server round-trip (gotcha-09 / spec perf budget).
const validItemId =
  itemId && itemPresenceTargetSchema.safeParse(itemId).success ? itemId : null;
usePresenceFocus(
  validItemId
    ? { viewKind: "panel", targetId: presenceTarget.item(validItemId) }
    : null,
  validItemId != null,
);
```

(c) Render the bar in the header. Replace the `<SheetHeader>` block:

```tsx
<SheetHeader>
  <div className="flex items-center justify-between gap-3">
    <SheetTitle>{itemName}</SheetTitle>
    <ItemViewersBar itemId={itemId} />
  </div>
  <SheetDescription className="sr-only">
    Item details, updates, and activity.
  </SheetDescription>
</SheetHeader>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/components/boards/item-panel/ItemPanel.test.tsx`
Expected: PASS (both cases). If the panel needs a QueryClient wrapper at render,
add it per the Step 2 note and re-run.

- [ ] **Step 6: Commit**

```bash
git add src/components/boards/item-panel/ItemPanel.tsx src/components/boards/item-panel/ItemPanel.test.tsx
git commit -m "feat(presence): item panel broadcasts viewing focus + shows 'also viewing' bar"
```

---

## Task 6: Full gate + manual verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full automated gate**

Run:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all four pass. Fix any failure before proceeding (do not weaken tests to
make them pass — see AGENTS.md #4).

- [ ] **Step 2: Manual two-client check (local)**

1. Start the app; open a board in two different browser sessions signed in as two
   different members of the same org/board (e.g. normal window + incognito).
2. In session A, open any item (click a row → `?item=<id>` drawer opens).
3. In session B, open the **same** item.
4. Expected: each panel header shows "Also viewing" + the other user's avatar
   (their presence color as the chip ring). Self is never shown.
5. Close the panel in B → A's "Also viewing" indicator disappears within ~150ms
   (throttle) to a couple seconds (sync).
6. In A, switch to a different view (table → kanban) while the item is open →
   presence persists (provider owned high in the tree).

- [ ] **Step 3: Confirm no migration / no schema drift**

Run: `git status --short supabase/ src/types/database.types.ts`
Expected: **no output** — this slice adds no migration and no type regen.

- [ ] **Step 4: Finish the branch**

Run `scripts/finish-task.sh` from inside the worktree (rebases onto latest
`develop`, runs the gate against the merged state, merges, pushes, removes the
worktree + branch). Then write the "How to test this" walkthrough (Step 2 above,
adapted) into the closing message and the `/wrapup` note.

---

## Execution DAG (AGENTS.md #6)

**Tasks & interfaces (Consumes / Produces):**

- **Task 1 — `presenceTarget.item`**
  - Consumes: nothing
  - Produces: `presenceTarget.item(itemId) => "item:<id>"`
- **Task 2 — Zod guard**
  - Consumes: nothing (independent)
  - Produces: `itemPresenceTargetSchema`
- **Task 3 — `PresenceAvatarStack`** (+ `BoardPresenceBar` refactor)
  - Consumes: `RosterOccupant` (existing)
  - Produces: `PresenceAvatarStack` primitive
- **Task 4 — `ItemViewersBar`**
  - Consumes: Task 1 (`presenceTarget.item`), Task 3 (`PresenceAvatarStack`)
  - Produces: `ItemViewersBar`
- **Task 5 — `ItemPanel` wiring**
  - Consumes: Task 1, Task 2 (`itemPresenceTargetSchema`), Task 4 (`ItemViewersBar`)
  - Produces: panel broadcasts focus + renders the bar
- **Task 6 — gate + manual verify**
  - Consumes: Task 5 (all prior)
  - Produces: green gate, merged branch

**Dependency graph:**

```
T1 ─┐
    ├─► T4 ─┐
T3 ─┘       ├─► T5 ─► T6
T2 ─────────┘
```

(T1 and T3 also feed T4; T2 feeds T5 directly.)

**Parallel batches (waves of concurrent agents):**

- **Batch 1 (parallel):** T1, T2, T3 — no unmet dependencies, no shared files.
  Dispatch concurrently (`superpowers:dispatching-parallel-agents`). Note T3 edits
  `BoardPresenceBar.tsx` + creates two files; T1 edits `presence-target*`; T2
  creates `validations/presence*` — disjoint file sets, safe to run together.
- **Batch 2:** T4 (waits on T1 + T3).
- **Batch 3:** T5 (waits on T2 + T4).
- **Batch 4:** T6 (waits on T5).

**Critical path:** T1/T3 → T4 → T5 → T6 = **4 tasks deep** (the longest chain). T2
rides alongside in Batch 1, so it does not extend the wall-clock floor. With Batch
1 parallelized, the practical floor is the 4-task critical path, not the 6-task
total.

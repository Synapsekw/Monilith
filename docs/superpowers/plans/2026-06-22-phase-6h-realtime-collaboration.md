# Phase 6h — Real-time collaboration (presence + visible last-write-wins) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real-time presence layer on top of Monolith's existing board data sync — a board-wide avatar stack, per-element "who is editing here" indicators across all views, and a visible (non-blocking) last-write-wins collision flash — without any new tables and without touching the existing `postgres_changes` data channel.

**Architecture:** Ephemeral Supabase Realtime **Presence** on a **separate private channel** `presence:board:${boardId}`, gated by an RLS policy on `realtime.messages` that reuses the existing `can_read_board(uuid)` function. A small pure core (color + reducer + target helpers) feeds a single `useBoardPresence` hook owned by `BoardViews` (mounted once, survives view switches per gotcha-09), exposed to all views through a context so each view only drops a `<PresenceRing>` and calls `usePresenceFocus`. The LWW flash observes the existing data-sync events and attributes the change from presence state.

**Tech Stack:** Next.js 16 (App Router, RSC), React 19, `@supabase/supabase-js` ^2.108.1 (Realtime Presence), `@supabase/ssr` ^0.12.0, TanStack React Query, Vitest + Testing Library, Supabase Postgres migrations.

**Spec:** `docs/superpowers/specs/2026-06-22-phase-6h-realtime-collaboration-design.md` — read it first; this plan implements its units U1–U7.

---

## Pre-flight (read before Task 1)

- **Verify the Realtime Authorization API against current docs.** Before writing the migration or the channel helper, confirm how private channels + `realtime.messages` RLS work in the installed Supabase version: use the `supabase` MCP `search_docs` tool (query "Realtime Authorization private channel realtime.messages RLS") and/or read `node_modules/@supabase/realtime-js`. Do **not** assume from memory — the `realtime.topic()` helper, the `extension` column values (`presence` / `broadcast`), and the `private: true` client option are the load-bearing details.
- **Worktree gotchas** (`vault/decisions` / user memory `worktree-gates-binaries-turbopack`):
  - CLI bins aren't on PATH inside the worktree — `export PATH="$(git -C . rev-parse --show-toplevel)/../../node_modules/.bin:$PATH"` or run via `pnpm`.
  - `*.integration.test.ts` **silently skip** without `.env.local` — symlink it from the main checkout before running live tests: `ln -s ../../../.env.local .env.local` (verify the relative depth).
  - `next build` cannot run from the worktree — run `pnpm build` in the **main checkout** before merge.
- **No project setting change (RESOLVED by research).** A `private: true` channel is ALWAYS authorized against the `realtime.messages` policies on its own merits, independent of the "Channel Restrictions / Allow public access" toggle. **Leave the toggle on "allow public"** — switching to "private only" would break the app's existing PUBLIC channels (`board:`/`notifications:`/`item:` postgres_changes), which have no policies. The non-member-denied integration test (Task 10) proves enforcement with the toggle left on. (A same-named *public* `presence:board:` channel is a separate channel and never receives the private channel's traffic, so there is no bypass leak.)

---

## Build-time findings & deviations (from integration scoping)

Discovered while scoping the real components — these adjust the plan:

1. **Header mount point.** `BoardViews` does not render the header directly; each view renders `<BoardHeader … members={…} />` (e.g. `BoardTable.tsx`). So `<BoardPresenceBar>` goes inside **`BoardHeader`** (it already receives `members`) — one insertion covers all views. The `BoardPresenceProvider` + `useBoardPresence` still live in `BoardViews` (wraps everything).
2. **Self identity.** Derive the presence `self` in `BoardViews` from `members.find(m => m.userId === currentUserId)` → `{ userId: currentUserId, name: fullName ?? email ?? "Someone", avatarUrl }`. `EditorMember = { userId, fullName, email, avatarUrl }` (camelCase).
3. **T8d (item-panel field indicators) is DROPPED for v1.** The item panel's "fields" tab is a placeholder — *"Inline field editing in the panel is a fast-follow."* There are **no editable field components** to attach a focus/indicator to. Per-field presence is impossible until field editing exists. Documented as a fast-follow (revisit when the panel gains inline field editors). Avatar-stack presence still appears in the panel's surrounding board (the bar is board-wide).
4. **Toast primitive does not exist** (the repo deliberately has none — see the comment in `members-table.tsx`). To honor "visible LWW" without adding an unrequested dependency, T9 ships as: (a) a **visual flash highlight** on the changed-under-you element (the core "seen" signal), plus (b) a **self-contained ephemeral message** rendered by `BoardViews` from flash state (a tiny inline "toast-lite"), NOT `sonner`. Attribution comes from presence (`focusMap`). If the team later adds a toast lib, the message can move to it.
5. **`onRemoteChange` wiring.** `useBoardRealtime(boardId)`'s `onCell` handler (the existing data hook) has `p.new = { item_id, column_id, value }` and echo-dedups at the value level; fire an additive optional `onRemoteChange?({ targetId: cell:${item_id}:${column_id}, valueChanged: true })` only when it actually patches (i.e. not an echo). To know the local user's focused target for the flash, extend `useBoardPresence` to also expose `selfFocusTargetId: string | null` (state mirror of its focus ref).

## File Structure

**Create:**
- `supabase/migrations/<ts>_realtime_presence_authorization.sql` — RLS policies on `realtime.messages` for the presence channel.
- `src/lib/boards/presence-types.ts` — `PresenceFocus`, `PresenceState`, `RosterOccupant`.
- `src/lib/boards/presence-color.ts` — `presenceColor(userId)`.
- `src/lib/boards/presence-target.ts` — `presenceTarget(...)` composite-id builder.
- `src/lib/boards/presence-reducer.ts` — `toRoster`, `toFocusMap`, `flashDecision`.
- `src/lib/boards/presence-channel.ts` — `boardPresenceTopic`, `createBoardPresenceChannel`.
- `src/lib/boards/use-board-presence.ts` — `useBoardPresence` hook.
- `src/lib/boards/presence-context.tsx` — `BoardPresenceProvider`, `useBoardPresenceContext`.
- `src/lib/boards/use-presence-focus.ts` — `usePresenceFocus`.
- `src/lib/boards/use-lww-flash.ts` — visible-LWW flash wiring.
- `src/components/boards/presence/BoardPresenceBar.tsx` — header avatar stack.
- `src/components/boards/presence/PresenceRing.tsx` — per-element indicator.
- Test files mirroring each unit (`*.test.ts(x)`) + `src/lib/boards/presence.rls.integration.test.ts`.

**Modify:**
- `src/components/boards/BoardViews.tsx` — mount `useBoardPresence` + `BoardPresenceProvider` + render `<BoardPresenceBar>` in the header; wire the LWW flash callback alongside the existing realtime hook.
- `src/components/boards/BoardTable.tsx` — cell focus + `<PresenceRing>` on the cell wrapper.
- `src/components/boards/KanbanBoard.tsx` — card focus + ring.
- `src/components/boards/CalendarBoard.tsx`, `src/components/boards/GanttBoard.tsx` — event focus + ring.
- Item panel field components (`src/components/boards/item-panel/…`) — field focus + ring.

**Do NOT touch:** `src/lib/boards/use-board-realtime.ts` reconciliation behavior, `src/lib/boards/cache.ts`, any data-table migration. No `updated_by` column anywhere.

---

## Task 1: Presence color util (pure)

**Files:**
- Create: `src/lib/boards/presence-color.ts`
- Test: `src/lib/boards/presence-color.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { PRESENCE_PALETTE, presenceColor } from "./presence-color";

describe("presenceColor", () => {
  it("is deterministic for a given userId", () => {
    expect(presenceColor("user-abc")).toBe(presenceColor("user-abc"));
  });

  it("always returns a value from the palette", () => {
    for (const id of ["a", "b", "c", "user-1", "user-2", "zzz"]) {
      expect(PRESENCE_PALETTE).toContain(presenceColor(id));
    }
  });

  it("distributes different ids across the palette (not all one color)", () => {
    const colors = new Set(
      Array.from({ length: 50 }, (_, i) => presenceColor(`user-${i}`)),
    );
    expect(colors.size).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/boards/presence-color.test.ts`
Expected: FAIL — module not found / `presenceColor` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// Fixed palette — picked to read on Pulse's dark-first near-black surfaces and
// stay distinct from the indigo accent. Keep it small and high-contrast.
export const PRESENCE_PALETTE = [
  "#e8595b", // red
  "#f2994a", // orange
  "#f2c94c", // amber
  "#27ae60", // green
  "#2d9cdb", // blue
  "#9b51e0", // violet
  "#eb5fa6", // pink
  "#56ccf2", // cyan
] as const;

export type PresencePaletteColor = (typeof PRESENCE_PALETTE)[number];

/** Deterministic, stable color for a user across the whole app. */
export function presenceColor(userId: string): PresencePaletteColor {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % PRESENCE_PALETTE.length;
  return PRESENCE_PALETTE[idx];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/boards/presence-color.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/presence-color.ts src/lib/boards/presence-color.test.ts
git commit -m "feat(presence): deterministic per-user color util"
```

---

## Task 2: Presence types + target-id helper (pure)

**Files:**
- Create: `src/lib/boards/presence-types.ts`, `src/lib/boards/presence-target.ts`
- Test: `src/lib/boards/presence-target.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { presenceTarget } from "./presence-target";

describe("presenceTarget", () => {
  it("builds stable composite ids per surface", () => {
    expect(presenceTarget.cell("i1", "c1")).toBe("cell:i1:c1");
    expect(presenceTarget.card("i1")).toBe("card:i1");
    expect(presenceTarget.event("i1")).toBe("event:i1");
    expect(presenceTarget.field("i1", "name")).toBe("field:i1:name");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/boards/presence-target.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the types and helper**

```ts
// src/lib/boards/presence-types.ts
export type PresenceViewKind =
  | "table"
  | "kanban"
  | "calendar"
  | "timeline"
  | "panel";

export type PresenceFocus = {
  viewKind: PresenceViewKind;
  targetId: string;
};

/** What each client publishes over the presence channel (one per tab). */
export type PresenceState = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  color: string;
  focus: PresenceFocus | null;
};

/** A user condensed from one-or-more tabs into a single roster entry. */
export type RosterOccupant = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  color: string;
  isSelf: boolean;
};
```

```ts
// src/lib/boards/presence-target.ts
export const presenceTarget = {
  cell: (itemId: string, columnId: string) => `cell:${itemId}:${columnId}`,
  card: (itemId: string) => `card:${itemId}`,
  event: (itemId: string) => `event:${itemId}`,
  field: (itemId: string, fieldKey: string) => `field:${itemId}:${fieldKey}`,
} as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/boards/presence-target.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/presence-types.ts src/lib/boards/presence-target.ts src/lib/boards/presence-target.test.ts
git commit -m "feat(presence): presence types + composite target-id helper"
```

---

## Task 3: Presence reducer (pure)

**Files:**
- Create: `src/lib/boards/presence-reducer.ts`
- Test: `src/lib/boards/presence-reducer.test.ts`

The reducer operates on the raw Supabase presence-state shape: `Record<presenceKey, PresenceState[]>` (each presence key is a transient connection; one user may have several).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { flashDecision, toFocusMap, toRoster } from "./presence-reducer";
import type { PresenceState } from "./presence-types";

const mk = (over: Partial<PresenceState>): PresenceState => ({
  userId: "u1",
  name: "Dani",
  avatarUrl: null,
  color: "#2d9cdb",
  focus: null,
  ...over,
});

const raw = (states: PresenceState[]): Record<string, PresenceState[]> =>
  Object.fromEntries(states.map((s, i) => [`key-${i}`, [s]]));

describe("toRoster", () => {
  it("dedups multiple tabs of one user into a single entry", () => {
    const state = raw([
      mk({ userId: "u1" }),
      mk({ userId: "u1" }),
      mk({ userId: "u2", name: "Sam" }),
    ]);
    const roster = toRoster(state, "u2");
    expect(roster).toHaveLength(2);
    expect(roster.find((r) => r.userId === "u2")?.isSelf).toBe(true);
    expect(roster.find((r) => r.userId === "u1")?.isSelf).toBe(false);
  });
});

describe("toFocusMap", () => {
  it("maps targetId -> occupants currently focused there", () => {
    const state = raw([
      mk({ userId: "u1", focus: { viewKind: "table", targetId: "cell:i1:c1" } }),
      mk({ userId: "u2", focus: { viewKind: "table", targetId: "cell:i1:c1" } }),
      mk({ userId: "u3", focus: null }),
    ]);
    const map = toFocusMap(state);
    expect(map.get("cell:i1:c1")?.map((o) => o.userId).sort()).toEqual(["u1", "u2"]);
    expect(map.has("cell:i2:c1")).toBe(false);
  });
});

describe("flashDecision", () => {
  it("flashes only when the incoming change hits the focused target and differs", () => {
    expect(
      flashDecision({
        incomingTargetId: "cell:i1:c1",
        focusedTargetId: "cell:i1:c1",
        valueChanged: true,
      }),
    ).toBe(true);
  });

  it("does not flash a different target", () => {
    expect(
      flashDecision({
        incomingTargetId: "cell:i1:c2",
        focusedTargetId: "cell:i1:c1",
        valueChanged: true,
      }),
    ).toBe(false);
  });

  it("does not flash when nothing is focused or value is unchanged", () => {
    expect(
      flashDecision({ incomingTargetId: "cell:i1:c1", focusedTargetId: null, valueChanged: true }),
    ).toBe(false);
    expect(
      flashDecision({ incomingTargetId: "cell:i1:c1", focusedTargetId: "cell:i1:c1", valueChanged: false }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/boards/presence-reducer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the reducer**

```ts
import type { PresenceState, RosterOccupant } from "./presence-types";

type RawPresence = Record<string, PresenceState[]>;

function flatten(raw: RawPresence): PresenceState[] {
  return Object.values(raw).flat();
}

/** One entry per user (multiple tabs merged); self flagged. */
export function toRoster(raw: RawPresence, selfUserId: string): RosterOccupant[] {
  const byUser = new Map<string, RosterOccupant>();
  for (const s of flatten(raw)) {
    if (byUser.has(s.userId)) continue;
    byUser.set(s.userId, {
      userId: s.userId,
      name: s.name,
      avatarUrl: s.avatarUrl,
      color: s.color,
      isSelf: s.userId === selfUserId,
    });
  }
  return [...byUser.values()];
}

/** targetId -> distinct users focused there. */
export function toFocusMap(raw: RawPresence): Map<string, RosterOccupant[]> {
  const map = new Map<string, Map<string, RosterOccupant>>();
  for (const s of flatten(raw)) {
    if (!s.focus) continue;
    const key = s.focus.targetId;
    if (!map.has(key)) map.set(key, new Map());
    const inner = map.get(key)!;
    if (!inner.has(s.userId)) {
      inner.set(s.userId, {
        userId: s.userId,
        name: s.name,
        avatarUrl: s.avatarUrl,
        color: s.color,
        isSelf: false, // self-vs-other is decided at render time via selfUserId
      });
    }
  }
  return new Map([...map].map(([k, v]) => [k, [...v.values()]]));
}

export function flashDecision(args: {
  incomingTargetId: string;
  focusedTargetId: string | null;
  valueChanged: boolean;
}): boolean {
  return (
    args.focusedTargetId !== null &&
    args.incomingTargetId === args.focusedTargetId &&
    args.valueChanged
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/boards/presence-reducer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/presence-reducer.ts src/lib/boards/presence-reducer.test.ts
git commit -m "feat(presence): pure reducer — roster dedup, focus map, flash decision"
```

---

## Task 4: Realtime-Authorization migration + channel helper

**Files:**
- Create: `supabase/migrations/<ts>_realtime_presence_authorization.sql`
- Create: `src/lib/boards/presence-channel.ts`
- Test: covered live in Task 8 (RLS cannot be unit-tested without a socket).

> Pick `<ts>` with `date -u +%Y%m%d%H%M%S` so it sorts after the latest existing migration. Confirm `realtime.topic()` and the `realtime.messages` columns against the docs (pre-flight) before finalizing the predicate.

- [ ] **Step 1: Write the migration**

```sql
-- Realtime Authorization for the board presence channel.
-- Channel topic is `presence:board:<board_uuid>`; only users who can read the
-- board may receive (SELECT) or publish (INSERT) presence on it.
-- Reuses the existing can_read_board() SECURITY DEFINER function so presence
-- access == data-read access (one security boundary, org-scoped, no cross-tenant).
--
-- NO global setting change needed: a `private: true` channel is always authorized
-- against these policies regardless of the "Allow public access" toggle. Leave that
-- toggle ON so the app's existing PUBLIC channels keep working ("private only" would
-- break them). Proven by the non-member-denied integration test in this phase.

-- RLS is already enabled on realtime.messages by default — do NOT `enable rls` here
-- (and the migration role may not own the table). Just add policies.
-- extension is gated on both 'presence' AND 'broadcast': supabase-js Presence rides
-- the broadcast transport, and this is the docs' combined pattern. (select ...) wraps
-- the helpers for RLS initplan caching (per Supabase Realtime Authorization docs).

-- Receive presence on a board presence topic.
create policy "presence: read if can read board"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and (select realtime.topic()) like 'presence:board:%'
    and (
      select public.can_read_board(
        (split_part((select realtime.topic()), ':', 3))::uuid
      )
    )
  );

-- Publish (track) presence on a board presence topic.
create policy "presence: write if can read board"
  on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and (select realtime.topic()) like 'presence:board:%'
    and (
      select public.can_read_board(
        (split_part((select realtime.topic()), ':', 3))::uuid
      )
    )
  );
```

> Confirmed against the Supabase Realtime Authorization docs (pre-flight): Presence traffic on `realtime.messages` carries `extension = 'presence'`, broadcast carries `'broadcast'`; gating on the **set** authorizes both. Topic `presence:board:<uuid>` → `split_part(topic, ':', 3)` is the uuid. The `like 'presence:board:%'` guard makes a malformed/foreign topic fail closed (no policy match → denied). `can_read_board` is read-only SECURITY DEFINER (Realtime runs the policy query then rolls it back — no side effects allowed). The policy is evaluated at join/JWT-refresh time and cached per connection.

- [ ] **Step 2: Apply the migration**

Run (via Supabase MCP `apply_migration`, or `supabase db push` if using local stack):
Expected: applies cleanly; `list_migrations` shows the new entry.

- [ ] **Step 3: Regenerate types**

Run: `pnpm db:types`
Expected: `src/types/database.types.ts` regenerates. (No new `public` tables → likely a no-op diff; commit it anyway if it changes.)

- [ ] **Step 4: Write the channel helper**

```ts
// src/lib/boards/presence-channel.ts
"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

/** Single source of truth for the presence topic — must match the migration's
 *  split_part(topic, ':', 3) board-id extraction. */
export function boardPresenceTopic(boardId: string): string {
  return `presence:board:${boardId}`;
}

/** Private presence channel for a board. `setAuth()` is REQUIRED before subscribing
 *  to a private channel — it pushes the current session JWT into the Realtime socket
 *  so the realtime.messages RLS policy can evaluate can_read_board (confirmed in
 *  pre-flight; do not rely on @supabase/ssr to do this implicitly). */
export async function createBoardPresenceChannel(
  boardId: string,
  selfKey: string,
): Promise<RealtimeChannel> {
  const supabase = createClient();
  await supabase.realtime.setAuth(); // Needed for Realtime Authorization
  return supabase.channel(boardPresenceTopic(boardId), {
    config: { private: true, presence: { key: selfKey } },
  });
}
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/*_realtime_presence_authorization.sql src/lib/boards/presence-channel.ts src/types/database.types.ts
git commit -m "feat(presence): private presence channel + realtime.messages RLS (can_read_board)"
```

---

## Task 5: `useBoardPresence` hook + context + `usePresenceFocus`

**Files:**
- Create: `src/lib/boards/use-board-presence.ts`, `src/lib/boards/presence-context.tsx`, `src/lib/boards/use-presence-focus.ts`
- Test: `src/lib/boards/use-board-presence.test.tsx` (hook behavior with a mocked channel)

> Model lifecycle on the existing `src/lib/boards/use-board-realtime.ts` (subscribe in `useEffect`, clean up on unmount, depend on `boardId`). Read it first.

- [ ] **Step 1: Write the failing test** (mock the channel so no socket is needed)

```tsx
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const trackMock = vi.fn();
const onMock = vi.fn().mockReturnThis();
const subscribeMock = vi.fn();
const presenceStateMock = vi.fn().mockReturnValue({});

// createBoardPresenceChannel is async (awaits setAuth) → mock returns a Promise.
vi.mock("./presence-channel", () => ({
  boardPresenceTopic: (id: string) => `presence:board:${id}`,
  createBoardPresenceChannel: vi.fn(async () => ({
    on: onMock,
    subscribe: subscribeMock,
    track: trackMock,
    untrack: vi.fn(),
    presenceState: presenceStateMock,
    unsubscribe: vi.fn(),
  })),
}));

// Wrap the QueryClientProvider so useQueryClient() resolves in the hook.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useBoardPresence } from "./use-board-presence";

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useBoardPresence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("tracks the local presence state on subscribe", async () => {
    renderHook(
      () => useBoardPresence("board-1", { userId: "u1", name: "Dani", avatarUrl: null }),
      { wrapper },
    );
    // async channel creation → wait until subscribe is wired
    await waitFor(() => expect(subscribeMock).toHaveBeenCalled());
    const cb = subscribeMock.mock.calls[0][0];
    act(() => cb("SUBSCRIBED"));
    expect(trackMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", focus: null }),
    );
  });

  it("setFocus re-tracks with the new focus (throttled)", async () => {
    const { result } = renderHook(
      () => useBoardPresence("board-1", { userId: "u1", name: "Dani", avatarUrl: null }),
      { wrapper },
    );
    await waitFor(() => expect(subscribeMock).toHaveBeenCalled());
    act(() => subscribeMock.mock.calls[0][0]("SUBSCRIBED"));
    act(() => result.current.setFocus({ viewKind: "table", targetId: "cell:i1:c1" }));
    // setFocus is throttled (~150ms) → assert eventually
    await waitFor(() =>
      expect(trackMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ focus: { viewKind: "table", targetId: "cell:i1:c1" } }),
      ),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/lib/boards/use-board-presence.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

```ts
// src/lib/boards/use-board-presence.ts
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createBoardPresenceChannel } from "./presence-channel";
import { presenceColor } from "./presence-color";
import { toFocusMap, toRoster } from "./presence-reducer";
import type { PresenceFocus, PresenceState, RosterOccupant } from "./presence-types";

type Self = { userId: string; name: string; avatarUrl: string | null };

export type BoardPresence = {
  roster: RosterOccupant[];
  focusMap: Map<string, RosterOccupant[]>;
  setFocus: (focus: PresenceFocus | null) => void;
  selfUserId: string;
  channelStatus: string;
};

export function useBoardPresence(boardId: string, self: Self): BoardPresence {
  const qc = useQueryClient();
  const [raw, setRaw] = useState<Record<string, PresenceState[]>>({});
  const [channelStatus, setStatus] = useState("INIT");
  const channelRef = useRef<RealtimeChannel | null>(null);
  const focusRef = useRef<PresenceFocus | null>(null);
  const hadDropRef = useRef(false);

  const color = useMemo(() => presenceColor(self.userId), [self.userId]);

  const buildState = useCallback(
    (focus: PresenceFocus | null): PresenceState => ({
      userId: self.userId,
      name: self.name,
      avatarUrl: self.avatarUrl,
      color,
      focus,
    }),
    [self.userId, self.name, self.avatarUrl, color],
  );

  useEffect(() => {
    let channel: RealtimeChannel | null = null;
    let cancelled = false;
    // createBoardPresenceChannel is async (it awaits realtime.setAuth() for
    // Realtime Authorization), so build + subscribe inside an async IIFE with a
    // cancellation guard for unmount-before-ready.
    void (async () => {
      const ch = await createBoardPresenceChannel(boardId, self.userId);
      if (cancelled) {
        void ch.unsubscribe();
        return;
      }
      channel = ch;
      channelRef.current = ch;
      const sync = () => setRaw(ch.presenceState() as Record<string, PresenceState[]>);
      ch.on("presence", { event: "sync" }, sync)
        .on("presence", { event: "join" }, sync)
        .on("presence", { event: "leave" }, sync)
        .subscribe((status) => {
          setStatus(status);
          if (status === "SUBSCRIBED") {
            void ch.track(buildState(focusRef.current));
            // reconnect resync: catch up any data missed while offline
            if (hadDropRef.current) {
              void qc.invalidateQueries({ queryKey: ["board", boardId] });
              hadDropRef.current = false;
            }
          }
          if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            hadDropRef.current = true;
          }
        });
    })();
    return () => {
      cancelled = true;
      if (channel) void channel.unsubscribe();
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, self.userId]);

  // Throttle focus updates: coalesce rapid focus churn to ~one update / 150ms.
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setFocus = useCallback(
    (focus: PresenceFocus | null) => {
      focusRef.current = focus;
      if (throttleRef.current) return;
      throttleRef.current = setTimeout(() => {
        throttleRef.current = null;
        void channelRef.current?.track(buildState(focusRef.current));
      }, 150);
    },
    [buildState],
  );

  const roster = useMemo(() => toRoster(raw, self.userId), [raw, self.userId]);
  const focusMap = useMemo(() => toFocusMap(raw), [raw]);

  return { roster, focusMap, setFocus, selfUserId: self.userId, channelStatus };
}
```

```tsx
// src/lib/boards/presence-context.tsx
"use client";

import { createContext, useContext } from "react";
import type { BoardPresence } from "./use-board-presence";

const Ctx = createContext<BoardPresence | null>(null);

export function BoardPresenceProvider({
  value,
  children,
}: {
  value: BoardPresence;
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBoardPresenceContext(): BoardPresence {
  const v = useContext(Ctx);
  if (!v) throw new Error("useBoardPresenceContext must be used within BoardPresenceProvider");
  return v;
}
```

```ts
// src/lib/boards/use-presence-focus.ts
"use client";

import { useEffect, useRef } from "react";
import { useBoardPresenceContext } from "./presence-context";
import type { PresenceFocus } from "./presence-types";

/** Call from an editable element. Reports focus on mount/focus and clears on blur/unmount.
 *  Pass `active` (e.g. isEditing) to drive focus/blur, or call setActive imperatively. */
export function usePresenceFocus(target: PresenceFocus | null, active: boolean) {
  const { setFocus } = useBoardPresenceContext();
  const prev = useRef(false);
  useEffect(() => {
    if (active && target) {
      setFocus(target);
      prev.current = true;
    } else if (prev.current) {
      setFocus(null);
      prev.current = false;
    }
    return () => {
      if (prev.current) setFocus(null);
    };
  }, [active, target?.targetId, target?.viewKind, setFocus]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/lib/boards/use-board-presence.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/use-board-presence.ts src/lib/boards/presence-context.tsx src/lib/boards/use-presence-focus.ts src/lib/boards/use-board-presence.test.tsx
git commit -m "feat(presence): useBoardPresence hook + provider + usePresenceFocus"
```

---

## Task 6: UI primitives — `PresenceRing` + `BoardPresenceBar`

> **REQUIRED SUB-SKILLS:** load `pulse-ui` and `frontend-design` before styling. Use Monolith tokens (dark-first near-black surfaces, single accent). The structure below is correct; the styling must come from `pulse-ui`.

**Files:**
- Create: `src/components/boards/presence/PresenceRing.tsx`, `src/components/boards/presence/BoardPresenceBar.tsx`
- Test: `src/components/boards/presence/PresenceRing.test.tsx`, `BoardPresenceBar.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// PresenceRing.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PresenceRing } from "./PresenceRing";

vi.mock("@/lib/boards/presence-context", () => ({
  useBoardPresenceContext: () => ({
    selfUserId: "self",
    focusMap: new Map([
      ["cell:i1:c1", [{ userId: "u2", name: "Sam", avatarUrl: null, color: "#2d9cdb", isSelf: false }]],
    ]),
  }),
}));

describe("PresenceRing", () => {
  it("renders an indicator when another user is focused on the target", () => {
    render(<PresenceRing target="cell:i1:c1" />);
    expect(screen.getByLabelText(/Sam is editing/i)).toBeInTheDocument();
  });

  it("renders nothing when nobody else is focused there", () => {
    const { container } = render(<PresenceRing target="cell:i9:c9" />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

```tsx
// BoardPresenceBar.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BoardPresenceBar } from "./BoardPresenceBar";

const occ = (id: string, name: string) => ({
  userId: id, name, avatarUrl: null, color: "#2d9cdb", isSelf: false,
});

vi.mock("@/lib/boards/presence-context", () => ({
  useBoardPresenceContext: () => ({
    selfUserId: "self",
    roster: [
      occ("self", "Me"),
      ...Array.from({ length: 8 }, (_, i) => occ(`u${i}`, `User ${i}`)),
    ],
  }),
}));

describe("BoardPresenceBar", () => {
  it("caps rendered faces and folds the rest into a +k overflow chip", () => {
    render(<BoardPresenceBar maxFaces={5} />);
    expect(screen.getByText("+4")).toBeInTheDocument(); // 9 total - 5 shown
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/components/boards/presence`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement (structure; apply pulse-ui styling)**

```tsx
// src/components/boards/presence/PresenceRing.tsx
"use client";

import { useBoardPresenceContext } from "@/lib/boards/presence-context";

export function PresenceRing({ target }: { target: string }) {
  const { focusMap, selfUserId } = useBoardPresenceContext();
  const others = (focusMap.get(target) ?? []).filter((o) => o.userId !== selfUserId);
  if (others.length === 0) return null;
  const first = others[0];
  return (
    <span
      aria-label={`${first.name} is editing`}
      title={others.map((o) => o.name).join(", ")}
      // pulse-ui: position as an overlay ring/badge on the host element
      style={{ outlineColor: first.color }}
      data-presence-ring
    >
      {others.length > 1 ? `${others.length}` : null}
    </span>
  );
}
```

```tsx
// src/components/boards/presence/BoardPresenceBar.tsx
"use client";

import { useBoardPresenceContext } from "@/lib/boards/presence-context";

export function BoardPresenceBar({ maxFaces = 5 }: { maxFaces?: number }) {
  const { roster } = useBoardPresenceContext();
  if (roster.length === 0) return null;
  const shown = roster.slice(0, maxFaces);
  const overflow = roster.length - shown.length;
  return (
    <div data-presence-bar className="flex items-center">
      {shown.map((o) => (
        <span
          key={o.userId}
          title={o.isSelf ? `${o.name} (you)` : o.name}
          style={{ backgroundColor: o.color }}
          data-presence-face
        >
          {o.avatarUrl ? <img src={o.avatarUrl} alt="" /> : initials(o.name)}
        </span>
      ))}
      {overflow > 0 ? <span data-presence-overflow>{`+${overflow}`}</span> : null}
    </div>
  );
}

function initials(name: string): string {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/components/boards/presence`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/presence/
git commit -m "feat(presence): PresenceRing + BoardPresenceBar primitives"
```

---

## Task 7: Mount presence in `BoardViews` + wire `BoardPresenceBar`

**Files:**
- Modify: `src/components/boards/BoardViews.tsx`

> `BoardViews` already owns the data-realtime hook and persists across view switches — mount presence here so it does too (gotcha-09). It already receives `currentUserId`; get the display name/avatar from the members list already passed for the People editor (no new query).

- [ ] **Step 1: Wire it**

```tsx
// inside BoardViews component body
const presence = useBoardPresence(board.id, {
  userId: currentUserId,
  name: selfMember?.fullName ?? selfMember?.email ?? "Someone",
  avatarUrl: selfMember?.avatarUrl ?? null,
});
```

```tsx
// wrap the views + header in the provider, render the bar in the header
<BoardPresenceProvider value={presence}>
  {/* existing header */}
  <BoardPresenceBar />
  {/* existing <ViewSwitcher /> + active view */}
</BoardPresenceProvider>
```

- [ ] **Step 2: Verify typecheck + existing tests still green**

Run: `pnpm typecheck && pnpm test src/components/boards`
Expected: PASS (no regressions; presence mounts once).

- [ ] **Step 3: Commit**

```bash
git add src/components/boards/BoardViews.tsx
git commit -m "feat(presence): mount useBoardPresence + avatar bar in BoardViews"
```

---

## Task 8 (a–d): View wiring — PARALLEL (disjoint files)

Each sub-task: on the editable element, call `usePresenceFocus(target, isFocused)` and render `<PresenceRing target={...} />`. **No data fetching.** These four are independent (different files) → run as parallel subagents/worktrees.

### 8a — Table (`src/components/boards/BoardTable.tsx`)
- [ ] Target `presenceTarget.cell(itemId, columnId)`; `usePresenceFocus(target, isEditing)` in the cell wrapper; overlay `<PresenceRing>` on the cell. Test: a cell shows a ring when `focusMap` has another occupant (mock context). Commit `feat(presence): table cell editing indicators`.

### 8b — Kanban (`src/components/boards/KanbanBoard.tsx`)
- [ ] Target `presenceTarget.card(itemId)`; focus on card-edit; `<PresenceRing>` on the card. Test + commit `feat(presence): kanban card editing indicators`.

### 8c — Calendar + Gantt (`CalendarBoard.tsx`, `GanttBoard.tsx`)
- [ ] Target `presenceTarget.event(itemId)` on both; `<PresenceRing>` on the event block. Test + commit `feat(presence): calendar/gantt event editing indicators`.

### 8d — Item panel (`src/components/boards/item-panel/…`)
- [ ] Target `presenceTarget.field(itemId, fieldKey)` per editable field; focus on field focus/blur; `<PresenceRing>` per field. Test + commit `feat(presence): item-panel field editing indicators`.

> Each sub-task is its own TDD cycle (failing component test with a mocked `useBoardPresenceContext` → wire → pass → commit). Keep the ring purely presentational; **never** let a ring or focus call trigger a data read.

---

## Task 9: Visible-LWW flash

**Files:**
- Create: `src/lib/boards/use-lww-flash.ts`
- Test: `src/lib/boards/use-lww-flash.test.tsx`
- Modify: `src/components/boards/BoardViews.tsx` (pass a change-event callback from the existing data realtime path into the flash hook) — **without changing `use-board-realtime.ts` reconciliation.**

> Preferred wiring: have `useBoardRealtime` accept an optional `onRemoteChange?: (e: { targetId: string; valueChanged: boolean }) => void` callback that it invokes **after** it patches the cache (purely additive — default undefined keeps current behavior). The flash hook supplies it.

- [ ] **Step 1: Write the failing test**

```tsx
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useLwwFlash } from "./use-lww-flash";

const toast = vi.fn();
vi.mock("sonner", () => ({ toast: (...a: unknown[]) => toast(...a) })); // adapt to repo's toast lib

vi.mock("./presence-context", () => ({
  useBoardPresenceContext: () => ({
    selfUserId: "self",
    focusMap: new Map([
      ["cell:i1:c1", [{ userId: "u2", name: "Sam", avatarUrl: null, color: "#2d9cdb", isSelf: false }]],
    ]),
  }),
}));

describe("useLwwFlash", () => {
  it("flashes + toasts attributed to the occupant when a change hits the focused cell", () => {
    const { result } = renderHook(() => useLwwFlash());
    act(() => result.current.setFocusedTarget("cell:i1:c1"));
    act(() => result.current.onRemoteChange({ targetId: "cell:i1:c1", valueChanged: true }));
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Sam changed this/i));
  });

  it("does not toast for an unfocused target", () => {
    const { result } = renderHook(() => useLwwFlash());
    act(() => result.current.setFocusedTarget("cell:i1:c1"));
    act(() => result.current.onRemoteChange({ targetId: "cell:i2:c2", valueChanged: true }));
    expect(toast).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm test src/lib/boards/use-lww-flash.test.tsx` → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/boards/use-lww-flash.ts
"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner"; // adapt to the repo's toast primitive
import { useBoardPresenceContext } from "./presence-context";
import { flashDecision } from "./presence-reducer";

export function useLwwFlash() {
  const { focusMap } = useBoardPresenceContext();
  const focusedRef = useRef<string | null>(null);
  const [flashTarget, setFlashTarget] = useState<string | null>(null);

  const setFocusedTarget = useCallback((t: string | null) => {
    focusedRef.current = t;
  }, []);

  const onRemoteChange = useCallback(
    (e: { targetId: string; valueChanged: boolean }) => {
      if (!flashDecision({ incomingTargetId: e.targetId, focusedTargetId: focusedRef.current, valueChanged: e.valueChanged })) {
        return;
      }
      const occupant = focusMap.get(e.targetId)?.[0];
      toast(occupant ? `${occupant.name} changed this just now` : "Updated just now");
      setFlashTarget(e.targetId);
      setTimeout(() => setFlashTarget(null), 1200);
    },
    [focusMap],
  );

  return { setFocusedTarget, onRemoteChange, flashTarget };
}
```

> Note: `setFocusedTarget` mirrors what `usePresenceFocus` already reports; in `BoardViews` keep them in sync (or derive `focusedRef` from the presence hook's own focus). Keep the flash visual (`flashTarget`) consumed by the cell wrapper to add a brief highlight class — apply via `pulse-ui`.

- [ ] **Step 4: Run test to verify it passes** — PASS.

- [ ] **Step 5: Wire into `BoardViews`** — add `onRemoteChange` to the existing `useBoardRealtime` call (additive callback) and keep `setFocusedTarget` synced with presence focus. Run `pnpm typecheck && pnpm test src/components/boards`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/boards/use-lww-flash.ts src/lib/boards/use-lww-flash.test.tsx src/lib/boards/use-board-realtime.ts src/components/boards/BoardViews.tsx
git commit -m "feat(presence): visible last-write-wins flash + toast"
```

---

## Task 10: Live integration tests (presence + RLS gate)

**Files:**
- Create: `src/lib/boards/presence.rls.integration.test.ts`

> Mirror an existing `*.rls.integration.test.ts` (e.g. the relations cross-board RLS test): service-role admin seeds an org, a board, a member, and a non-member; anon clients sign in and act. **Symlink `.env.local` first** or the test silently skips.

- [ ] **Step 1: Write the live tests**

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
// reuse the repo's integration test harness for seeding users/org/board + service-role client

describe("board presence channel authorization (live)", () => {
  // beforeAll: seed org, board, member user (board_members editor/viewer), non-member user.

  it("two members on the private channel see each other's presence", async () => {
    // memberA + memberB each createClient (anon) -> signIn -> channel(`presence:board:${boardId}`, {config:{private:true}})
    // both track({...}); assert each receives the other's presence via a sync/join with a timeout.
    expect(true).toBe(true); // replace with real assertion once harness wired
  });

  it("a non-member is DENIED subscribing to the private channel", async () => {
    // nonMember signs in, subscribes the same topic with private:true.
    // assert the subscribe callback yields CHANNEL_ERROR / not SUBSCRIBED (RLS denies via can_read_board).
    expect(true).toBe(true); // replace with real assertion
  });
});
```

- [ ] **Step 2: Symlink env + run live**

Run:
```bash
ln -sf ../../../.env.local .env.local   # verify relative depth from this worktree
pnpm test src/lib/boards/presence.rls.integration.test.ts
```
Expected: both tests run (NOT skipped) and PASS — members see each other; non-member denied. If they skip, the symlink is wrong.

- [ ] **Step 3: Flesh out the assertions** using the repo's existing live-RLS harness until both pass for real (replace the placeholder `expect(true)` lines).

- [ ] **Step 4: Commit**

```bash
git add src/lib/boards/presence.rls.integration.test.ts
git commit -m "test(presence): live presence sync + non-member RLS-denied gate"
```

---

## Task 11: Full gate + manual acceptance

- [ ] **Step 1:** In the worktree: `pnpm typecheck && pnpm lint && pnpm test`. Expected: all green.
- [ ] **Step 2:** In the **main checkout** (build can't run from worktree): `pnpm build`. Expected: clean production build.
- [ ] **Step 3:** No dashboard change. Leave Realtime "Allow public access" ON (default) — the private channel is enforced by its RLS policies regardless; the non-member-denied test (Task 10) proves it. (Do NOT switch to "private only" — it would break existing public channels.)
- [ ] **Step 4:** Two-browser manual acceptance (see "How to test" below).
- [ ] **Step 5:** `scripts/finish-task.sh` from inside the worktree (merges to `develop`, pushes, removes worktree + branch). Then `/wrapup`.

---

## Execution DAG (AGENTS.md rule 6)

**Dependency graph:**
- T1 (color) — none
- T2 (types/target) — none
- T3 (reducer) — T2 (types)
- T4 (migration + channel helper) — none (uses existing `can_read_board`)
- T5 (useBoardPresence + context + focus) — T1, T2, T3, T4
- T6 (UI primitives) — T2, T5 (context shape)
- T7 (mount in BoardViews) — T5, T6
- T8a–d (view wiring) — T5, T6, T7  *(four parallel, disjoint files)*
- T9 (LWW flash) — T3, T5, T7
- T10 (live integration) — T4, T5
- T11 (gate) — everything

**Parallel batches (waves of concurrent agents):**
- **Batch A:** T1, T2, T4 (no unmet deps; pure utils + migration).
- **Batch B:** T3 (after T2).
- **Batch C:** T5 (after A+B).
- **Batch D:** T6 (after T5).
- **Batch E:** T7 (after T6).
- **Batch F:** **T8a, T8b, T8c, T8d, T9, T10 all in parallel** (after T7; T10 needs only T4+T5; disjoint files — dispatch with `superpowers:dispatching-parallel-agents`, isolated worktrees if mutating in parallel).
- **Batch G:** T11.

**Critical path (wall-clock floor):** T2 → T3 → T5 → T6 → T7 → (T8/T9 wave) → T11. T4 (migration) runs alongside the early utils and is ready before T5; it is **not** on the critical path despite being the security foundation.

---

## Performance & data-fetching budget (AGENTS.md rule 5)

- **(a) First paint vs interaction:** First paint = one extra websocket subscribe, **zero** added server/RSC round-trips (roster arrives over the socket). View switch = existing History-API path, presence hook stays mounted in `BoardViews` (no remount, no re-subscribe). Focusing an element = one **throttled** presence `track()` — **0 server round-trips, 0 RSC re-run, 0 React Query refetch.**
- **(b) Server data vs client state:** Presence is ephemeral client state over the socket — never a Server Action / `revalidatePath`. The only server touch is the reconnect catch-up: one bounded `["board", boardId]` refetch (existing `getBoardPayload`).
- **(c) Bounded + indexed:** No new DB reads on the hot path. Reconnect reuses the existing bounded/indexed payload query. Rendered avatars capped (~5 + overflow); focus map is O(1) keyed lookup per element. Scale target ~25 concurrent editors/board.

---

## Self-review notes

- **Spec coverage:** U1→T4, U2→T1+T2+T3, U3→T5, U4→T6, U5→T7+T8a–d, U6→T9, U7→T10. All spec units mapped. ✅
- **Type consistency:** `PresenceState`/`PresenceFocus`/`RosterOccupant` defined in T2, consumed unchanged in T3/T5/T6/T9. `presenceTarget` (T2) used in T8. `flashDecision` signature `{incomingTargetId, focusedTargetId, valueChanged}` consistent T3↔T9. ✅
- **Open risks to confirm at build time:** (1) ~~`extension` value / public-access toggle~~ RESOLVED by research — gate on `extension in ('broadcast','presence')`, call `await supabase.realtime.setAuth()` before subscribe, and **no project-setting change** (the private channel is enforced by RLS on its own; leave "allow public" ON so existing public channels keep working); verified by the Task 10 non-member-denied test; (2) ~~toast primitive~~ RESOLVED — repo has no toast lib, shipped as flash + self-rendered ephemeral message (no `sonner`); (3) ~~item-panel field paths~~ RESOLVED — T8d dropped (no field editors exist yet).

## How to test (manual, two browsers)

1. Pull `develop` after merge; open the same board in two different browser profiles signed in as **two different board members**.
2. In browser A, look at the board header — you should see browser B's avatar appear in the presence bar (and vice-versa).
3. In browser A, click into a cell to edit it. In browser B, that cell should show a colored "editing" ring/badge in A's color.
4. In browser B, while A still has that cell focused, change the **same** cell from another member → A sees a brief flash + a toast "<name> changed this just now". The new value also appears (LWW, existing sync).
5. Switch A between Table / Kanban / Calendar / Gantt — the presence bar persists (no flash/reconnect) and editing indicators appear on cards/events too.
6. Sign in a user who is **not** a member of the board and open it via direct URL — they must **not** appear in others' presence bars and must not receive presence (RLS denies the private channel).

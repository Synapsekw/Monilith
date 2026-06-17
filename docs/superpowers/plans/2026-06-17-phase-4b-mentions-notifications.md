# Phase 4b — @mentions + Notifications Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user @mention teammates in an item update and get assigned via a People cell, fanning out per-user `notifications` rows surfaced in an app-shell inbox (unread badge, live, deep-links to `?item=`).

**Architecture:** New `notifications` table (per-user fan-out rows; RLS gated on `recipient_id = auth.uid()`, insert allowed to org members as the actor). The update composer becomes an @-autocomplete over org members; `body` extends from `{text}` to `{text, mentions: string[]}` (resolved user ids tracked at compose time — no fragile name re-parsing). `addUpdate` inserts one `notifications` row per mentioned user (kind `mention`); `upsertCell` diffs People-cell assignees and fans out `assigned` rows. A per-user Realtime channel (`recipient_id=eq.<uid>`) feeds the inbox + badge. Mark-read mutates optimistically through Server Actions. Built entirely on the 4a collaboration patterns (cache helpers, item-keyed React-Query, optimistic mutations).

**Tech Stack:** Next.js 16 (RSC + Server Actions), Supabase (Postgres, RLS, Realtime), `@supabase/ssr`, TanStack Query, Zod, shadcn/Radix (Popover, Command for the @-menu + inbox), Vitest + RTL, Playwright. Verify with `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

**Plan-time decisions:**

- **Mentions tracked, not re-parsed.** The composer records each selected member's `userId` as it inserts `@Full Name` into the text; `addUpdate` receives `mentions: string[]`. No backend name→id matching (which breaks on duplicate/renamed names). `body` is stored as `{ text, mentions }`; `body_text` stays the plaintext.
- **Notifications insert policy:** `is_org_member(org_id) and actor_id = (select auth.uid())` — a member may create a notification (for any org recipient) only as themselves. Read/update gated on `recipient_id = (select auth.uid())` (you only see/touch your own).
- **No self-notification.** Fan-out excludes the actor from recipients.
- **`update_on_item` is NOT in 4b** (needs a watcher model — spec §13). Only `mention` + `assigned`.
- **Assignment fan-out lives in `upsertCell`** (the People-cell write path), reading the prior value to compute added user ids. Reuses the existing optimistic board path; the notification insert is server-side only.

---

## File structure

| File                                                                                   | Responsibility                                                                      |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `supabase/migrations/<ts>_notifications.sql`                                           | `notification_kind` enum + `notifications` table, indexes, RLS, grants, publication |
| `src/types/database.types.ts`                                                          | Regenerated                                                                         |
| `src/lib/validations/collaboration-actions.ts`                                         | Extend `addUpdateSchema` with `mentions`; add `markNotificationReadSchema`          |
| `src/lib/collaboration/actions.ts`                                                     | `addUpdate` fan-out; new `markNotificationRead` / `markAllNotificationsRead`        |
| `src/lib/boards/actions.ts`                                                            | `upsertCell` People-diff → `assigned` fan-out                                       |
| `src/lib/collaboration/notifications-cache.ts`                                         | Pure cache helpers (prepend / mark-read / mark-all / unread count)                  |
| `src/lib/collaboration/use-notifications.ts`                                           | Inbox fetch + unread count + per-user Realtime                                      |
| `src/lib/collaboration/use-notification-mutations.ts`                                  | Optimistic mark-read / mark-all-read                                                |
| `src/lib/collaboration/mentions.ts`                                                    | Pure: extract `@`-query from a textarea caret; dedupe mention ids                   |
| `src/components/boards/item-panel/MentionTextarea.tsx`                                 | @-autocomplete textarea (Command popover over members)                              |
| `src/components/notifications/NotificationsBell.tsx`                                   | Topbar bell + unread badge + inbox popover                                          |
| `src/components/notifications/NotificationsList.tsx`                                   | Inbox rows; click → `?item=` deep-link + mark-read                                  |
| `src/components/app-shell.tsx`                                                         | Mount `<NotificationsBell>`; accept `currentUserId`                                 |
| `src/app/boards/[boardId]/page.tsx`                                                    | Thread `currentUserId={user.id}` to `AppShell`                                      |
| `src/components/boards/item-panel/UpdatesTab.tsx`                                      | Swap composer textarea for `MentionTextarea`; pass mentions to `onAdd`              |
| `src/lib/collaboration/use-update-mutations.ts`                                        | `add` accepts `mentions`                                                            |
| `*.test.ts(x)` + `notifications.rls.integration.test.ts` + `e2e/notifications.spec.ts` | Tests per module                                                                    |

Each task is independently committable.

---

## Task 1: Migration — notifications table, RLS, Realtime

**Files:**

- Create: `supabase/migrations/<ts>_notifications.sql` (timestamp later than `20260617094500`, e.g. `20260617100000`)

- [ ] **Step 1: Write the migration**

```sql
-- Phase 4b: per-user notification fan-out rows. RLS: you only see/modify your
-- own (recipient_id = auth.uid()); any org member may insert as themselves
-- (the fan-out path in addUpdate / upsertCell).
create type public.notification_kind as enum ('mention', 'assigned', 'update_on_item');

create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  actor_id     uuid references auth.users (id),
  kind         public.notification_kind not null,
  board_id     uuid references public.boards (id) on delete cascade,
  item_id      uuid references public.items (id) on delete cascade,
  update_id    uuid references public.item_updates (id) on delete cascade,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);
create index notifications_unread_idx on public.notifications (recipient_id) where read_at is null;
create index notifications_org_id_idx on public.notifications (org_id);

alter table public.notifications enable row level security;

create policy "notifications: read own" on public.notifications
  for select to authenticated using (recipient_id = (select auth.uid()));
create policy "notifications: insert as member+actor" on public.notifications
  for insert to authenticated with check (
    public.is_org_member(org_id) and actor_id = (select auth.uid())
  );
create policy "notifications: update own" on public.notifications
  for update to authenticated using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

grant select, insert, update on public.notifications to authenticated;

alter publication supabase_realtime add table public.notifications;
```

- [ ] **Step 2: Apply** — `supabase db push --linked` (manual gate; per north-star). Expected: applies clean.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(db): notifications table (per-user fan-out, rls, realtime)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Regenerate types

- [ ] **Step 1:** `pnpm db:types` (filter a stray PostHog `"_tag"` line if it appears). Expected: `notifications` + `notification_kind` appear.
- [ ] **Step 2:** `pnpm typecheck` → PASS.
- [ ] **Step 3:** Commit `chore(db): regenerate types for notifications`.

---

## Task 3: Extend validation (mentions + mark-read)

**Files:**

- Modify: `src/lib/validations/collaboration-actions.ts`
- Modify/Test: `src/lib/validations/collaboration-actions.test.ts`

- [ ] **Step 1: Write the failing test (append)**

```ts
import {
  addUpdateSchema,
  markNotificationReadSchema,
} from "@/lib/validations/collaboration-actions";

describe("mentions + notifications validation", () => {
  const ITEM = "11111111-1111-4111-8111-111111111111";
  const USER = "99999999-9999-4999-8999-999999999999";
  it("accepts an add-update with mentions", () => {
    expect(
      addUpdateSchema.safeParse({
        itemId: ITEM,
        text: "hi @Ada",
        mentions: [USER],
      }).success,
    ).toBe(true);
  });
  it("defaults mentions to empty when omitted", () => {
    const r = addUpdateSchema.parse({ itemId: ITEM, text: "hi" });
    expect(r.mentions).toEqual([]);
  });
  it("rejects a non-uuid mention", () => {
    expect(
      addUpdateSchema.safeParse({
        itemId: ITEM,
        text: "hi",
        mentions: ["nope"],
      }).success,
    ).toBe(false);
  });
  it("validates mark-read", () => {
    expect(
      markNotificationReadSchema.safeParse({ notificationId: USER }).success,
    ).toBe(true);
  });
});
```

- [ ] **Step 2:** Run `pnpm vitest run src/lib/validations/collaboration-actions.test.ts` → FAIL.

- [ ] **Step 3: Extend the schema**

In `collaboration-actions.ts`, change `addUpdateSchema` and add the mark-read schema:

```ts
export const addUpdateSchema = z.object({
  itemId: z.string().uuid(),
  text: TEXT,
  mentions: z.array(z.string().uuid()).default([]),
});

export const markNotificationReadSchema = z.object({
  notificationId: z.string().uuid(),
});
```

- [ ] **Step 4:** Run the test → PASS. **Step 5:** Commit `feat(collab): mentions + mark-read validation`.

---

## Task 4: `addUpdate` mention fan-out

**Files:**

- Modify: `src/lib/collaboration/actions.ts`
- Modify/Test: `src/lib/collaboration/actions.test.ts`

`addUpdate` now stores `body: { text, mentions }` and, after inserting the update, inserts one `notifications` row per mentioned user (excluding the author).

- [ ] **Step 1: Write the failing test (append to actions.test.ts)**

```ts
it("fans out a notification per mention, excluding the author", async () => {
  const OTHER = "33333333-3333-4333-8333-333333333333";
  const notifInsert = vi.fn().mockResolvedValue({ error: null });
  const updInsert = vi.fn().mockReturnValue({
    select: () => ({
      single: async () => ({ data: { id: UPD }, error: null }),
    }),
  });
  from.mockImplementation((table: string) => {
    if (table === "items")
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { org_id: "org", board_id: "board" },
              error: null,
            }),
          }),
        }),
      } as never;
    if (table === "item_updates") return { insert: updInsert } as never;
    if (table === "notifications") return { insert: notifInsert } as never;
    return {} as never;
  });
  await addUpdate({ itemId: ITEM, text: "hi @x @me", mentions: [OTHER, USER] });
  // one row, only for OTHER (USER is the author)
  expect(notifInsert).toHaveBeenCalledTimes(1);
  expect(notifInsert).toHaveBeenCalledWith([
    expect.objectContaining({
      org_id: "org",
      recipient_id: OTHER,
      actor_id: USER,
      kind: "mention",
      item_id: ITEM,
      update_id: UPD,
    }),
  ]);
});
```

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3: Implement** — replace the body insert + add fan-out in `addUpdate`:

```ts
const { data, error } = await supabase
  .from("item_updates")
  .insert({
    org_id: item.org_id,
    board_id: item.board_id,
    item_id: parsed.data.itemId,
    author_id: user.id,
    body: { text: parsed.data.text, mentions: parsed.data.mentions } as Json,
    body_text: parsed.data.text,
  })
  .select("id")
  .single();
if (error || !data) return fail(error?.message ?? "Could not post update.");

const recipients = [...new Set(parsed.data.mentions)].filter(
  (id) => id !== user.id,
);
if (recipients.length > 0) {
  await supabase.from("notifications").insert(
    recipients.map((rid) => ({
      org_id: item.org_id,
      recipient_id: rid,
      actor_id: user.id,
      kind: "mention" as const,
      board_id: item.board_id,
      item_id: parsed.data.itemId,
      update_id: data.id,
    })),
  );
}

return { ok: true, data: { updateId: data.id } };
```

- [ ] **Step 4:** Run → PASS (existing addUpdate tests still pass — they pass no `mentions`, which defaults to `[]`). **Step 5:** Commit `feat(collab): fan out mention notifications on addUpdate`.

---

## Task 5: Assignment fan-out in `upsertCell`

**Files:**

- Modify: `src/lib/boards/actions.ts`
- Modify/Test: `src/lib/boards/actions.test.ts` (or create if absent — mirror the collaboration actions test harness)

When a People cell is upserted, read the prior `userIds`, compute newly-added ids, and insert `assigned` notifications (excluding the actor).

- [ ] **Step 1: Write the failing test**

```ts
// In the boards actions test (vi.mock @/lib/supabase/server with { from, auth:{getUser} }):
it("fans out assigned notifications for newly added people", async () => {
  // column kind=people, item same board, prior value {userIds:[A]}, new {userIds:[A,B]}
  // assert notifications.insert called with one row for B, kind 'assigned', actor=USER
});
```

(Write the concrete mock mirroring Task 4's `from.mockImplementation`, returning the `columns` row `{org_id, board_id, kind:'people'}`, the `items` row, the existing `cell_values` row `{ value: { userIds: [A] } }`, an `upsert` success, and a `notifications.insert` spy. Assert the spy got `[{recipient_id: B, kind:'assigned', actor_id: USER, board_id, item_id, org_id}]`.)

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3: Implement** — in `upsertCell`, after the value is validated and **before/after** the upsert (read prior value first), add a people-diff fan-out. Insert this block just before the existing `supabase.from("cell_values").upsert(...)`:

```ts
let priorPeople: string[] = [];
if (column.kind === "people") {
  const { data: prior } = await supabase
    .from("cell_values")
    .select("value")
    .eq("item_id", parsed.data.itemId)
    .eq("column_id", parsed.data.columnId)
    .maybeSingle();
  priorPeople = (prior?.value as { userIds?: string[] } | null)?.userIds ?? [];
}
```

Then after the successful upsert (`if (error) return fail(...)`), before `revalidatePath`:

```ts
if (column.kind === "people") {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const next = (valueParsed.data as { userIds: string[] }).userIds;
  const added = next.filter(
    (id) => !priorPeople.includes(id) && id !== user?.id,
  );
  if (added.length > 0) {
    await supabase.from("notifications").insert(
      added.map((rid) => ({
        org_id: column.org_id,
        recipient_id: rid,
        actor_id: user?.id ?? null,
        kind: "assigned" as const,
        board_id: column.board_id,
        item_id: parsed.data.itemId,
      })),
    );
  }
}
```

- [ ] **Step 4:** Run → PASS. **Step 5:** Commit `feat(collab): fan out assigned notifications on people-cell add`.

---

## Task 6: Pure notifications cache helpers

**Files:**

- Create: `src/lib/collaboration/notifications-cache.ts`
- Test: `src/lib/collaboration/notifications-cache.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  prependNotification,
  markRead,
  markAllRead,
  unreadCount,
  type NotificationsCache,
} from "@/lib/collaboration/notifications-cache";
import type { Tables } from "@/types/database.types";

function n(id: string, read = false): Tables<"notifications"> {
  return {
    id,
    org_id: "o",
    recipient_id: "u",
    actor_id: "a",
    kind: "mention",
    board_id: "b",
    item_id: "i",
    update_id: null,
    read_at: read ? "2026-06-17T00:00:00Z" : null,
    created_at: "2026-06-17T00:00:00Z",
  } as Tables<"notifications">;
}

describe("notifications cache", () => {
  it("prepends + de-dupes by id", () => {
    let c: NotificationsCache = { notifications: [n("a")] };
    c = prependNotification(c, n("b"));
    expect(c.notifications.map((x) => x.id)).toEqual(["b", "a"]);
    c = prependNotification(c, n("b"));
    expect(c.notifications).toHaveLength(2);
  });
  it("marks one + all read; counts unread", () => {
    let c: NotificationsCache = { notifications: [n("a"), n("b")] };
    expect(unreadCount(c)).toBe(2);
    c = markRead(c, "a");
    expect(unreadCount(c)).toBe(1);
    c = markAllRead(c);
    expect(unreadCount(c)).toBe(0);
  });
});
```

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3: Implement**

```ts
import type { Tables } from "@/types/database.types";

export type AppNotification = Tables<"notifications">;
export type NotificationsCache = { notifications: AppNotification[] };

const READ_STAMP = "read"; // any non-null marker; server time wins on refetch

export function prependNotification(
  c: NotificationsCache,
  n: AppNotification,
): NotificationsCache {
  if (c.notifications.some((x) => x.id === n.id)) return c;
  return { notifications: [n, ...c.notifications] };
}

export function markRead(
  c: NotificationsCache,
  id: string,
): NotificationsCache {
  return {
    notifications: c.notifications.map((x) =>
      x.id === id && !x.read_at ? { ...x, read_at: READ_STAMP } : x,
    ),
  };
}

export function markAllRead(c: NotificationsCache): NotificationsCache {
  return {
    notifications: c.notifications.map((x) =>
      x.read_at ? x : { ...x, read_at: READ_STAMP },
    ),
  };
}

export function unreadCount(c: NotificationsCache): number {
  return c.notifications.reduce((n, x) => (x.read_at ? n : n + 1), 0);
}
```

- [ ] **Step 4:** Run → PASS. **Step 5:** Commit `feat(collab): pure notifications cache helpers`.

---

## Task 7: Notification mark-read Server Actions

**Files:**

- Modify: `src/lib/collaboration/actions.ts`
- Modify/Test: `src/lib/collaboration/actions.test.ts`

- [ ] **Step 1: Failing test**

```ts
import {
  markNotificationRead,
  markAllNotificationsRead,
} from "@/lib/collaboration/actions";

describe("notification reads", () => {
  it("marks one read by id (RLS scopes to recipient)", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    from.mockImplementation(() => ({ update }) as never);
    const res = await markNotificationRead({ notificationId: UPD });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ read_at: expect.any(String) }),
    );
    expect(eq).toHaveBeenCalledWith("id", UPD);
    expect(res).toEqual({ ok: true, data: undefined });
  });
});
```

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3: Implement** (append to `actions.ts`; import `markNotificationReadSchema`):

```ts
export async function markNotificationRead(input: {
  notificationId: string;
}): Promise<ActionResult> {
  const parsed = markNotificationReadSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid");
  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", parsed.data.notificationId);
  if (error) return fail(error.message);
  return { ok: true, data: undefined };
}

export async function markAllNotificationsRead(): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", user.id)
    .is("read_at", null);
  if (error) return fail(error.message);
  return { ok: true, data: undefined };
}
```

- [ ] **Step 4:** Run → PASS. **Step 5:** Commit `feat(collab): mark-read / mark-all-read notification actions`.

---

## Task 8: Notifications fetch hook + per-user Realtime

**Files:**

- Create: `src/lib/collaboration/use-notifications.ts`

Fetches the latest (bounded) notifications for the current user into a React-Query cache and subscribes a per-user Realtime channel (`recipient_id=eq.<userId>`). Mirrors `use-item-collab.ts`.

- [ ] **Step 1: Implement**

```ts
"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import {
  prependNotification,
  unreadCount,
  type AppNotification,
  type NotificationsCache,
} from "@/lib/collaboration/notifications-cache";

const LIMIT = 30;
export function notificationsKey(userId: string) {
  return ["notifications", userId] as const;
}

export function useNotifications(userId: string) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: notificationsKey(userId),
    staleTime: Infinity,
    queryFn: async (): Promise<NotificationsCache> => {
      const supabase = createClient();
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(LIMIT);
      return { notifications: (data ?? []) as AppNotification[] };
    },
  });

  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    const key = notificationsKey(userId);
    function onInsert(p: RealtimePostgresChangesPayload<AppNotification>) {
      const row = p.new as AppNotification;
      qc.setQueryData<NotificationsCache>(key, (prev) =>
        prev ? prependNotification(prev, row) : prev,
      );
    }
    function onUpdate(p: RealtimePostgresChangesPayload<AppNotification>) {
      const row = p.new as AppNotification;
      qc.setQueryData<NotificationsCache>(key, (prev) =>
        prev
          ? {
              notifications: prev.notifications.map((x) =>
                x.id === row.id ? row : x,
              ),
            }
          : prev,
      );
    }
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${userId}`,
        },
        onInsert,
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${userId}`,
        },
        onUpdate,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, qc]);

  const unread = query.data ? unreadCount(query.data) : 0;
  return { query, unread };
}
```

- [ ] **Step 2:** `pnpm typecheck` → PASS. **Step 3:** Commit `feat(collab): notifications fetch hook + per-user realtime`.

---

## Task 9: Optimistic mark-read mutations

**Files:**

- Create: `src/lib/collaboration/use-notification-mutations.ts`

- [ ] **Step 1: Implement** (mirror `use-update-mutations.ts`; optimistic `markRead`/`markAllRead` with rollback; invalidate on success):

```ts
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  markNotificationRead,
  markAllNotificationsRead,
} from "@/lib/collaboration/actions";
import {
  markRead,
  markAllRead,
  type NotificationsCache,
} from "@/lib/collaboration/notifications-cache";
import { notificationsKey } from "@/lib/collaboration/use-notifications";

type Ctx = { previous?: NotificationsCache };

export function useNotificationMutations(userId: string) {
  const qc = useQueryClient();
  const key = notificationsKey(userId);

  const readOne = useMutation<void, Error, { id: string }, Ctx>({
    mutationFn: async (v) => {
      const res = await markNotificationRead({ notificationId: v.id });
      if (!res.ok) throw new Error(res.error);
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<NotificationsCache>(key);
      if (previous)
        qc.setQueryData<NotificationsCache>(key, markRead(previous, v.id));
      return { previous };
    },
    onError: (_e, _v, c) => {
      if (c?.previous) qc.setQueryData(key, c.previous);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const readAll = useMutation<void, Error, void, Ctx>({
    mutationFn: async () => {
      const res = await markAllNotificationsRead();
      if (!res.ok) throw new Error(res.error);
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<NotificationsCache>(key);
      if (previous)
        qc.setQueryData<NotificationsCache>(key, markAllRead(previous));
      return { previous };
    },
    onError: (_e, _v, c) => {
      if (c?.previous) qc.setQueryData(key, c.previous);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  return {
    markRead: (id: string) => readOne.mutate({ id }),
    markAllRead: () => readAll.mutate(),
  };
}
```

- [ ] **Step 2:** `pnpm typecheck` → PASS. **Step 3:** Commit `feat(collab): optimistic mark-read mutations`.

---

## Task 10: Mention extraction (pure)

**Files:**

- Create: `src/lib/collaboration/mentions.ts`
- Test: `src/lib/collaboration/mentions.test.ts`

Pure helpers the composer uses: detect an active `@query` at the caret, and apply a chosen member into the text (returning new text + caret + the recorded id).

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { activeMentionQuery, applyMention } from "@/lib/collaboration/mentions";

describe("mentions", () => {
  it("detects an @query at the caret", () => {
    expect(activeMentionQuery("hello @ad", 9)).toEqual({
      query: "ad",
      start: 6,
    });
    expect(activeMentionQuery("hello world", 11)).toBeNull();
    expect(activeMentionQuery("a@b @c", 6)).toEqual({ query: "c", start: 4 });
  });
  it("applies a chosen member, replacing the @query with @Name", () => {
    const r = applyMention("hi @ad", 6, {
      userId: "u1",
      fullName: "Ada Lovelace",
    });
    expect(r.text).toBe("hi @Ada Lovelace ");
    expect(r.caret).toBe(r.text.length);
  });
});
```

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3: Implement**

```ts
export type MentionTarget = { userId: string; fullName: string | null };

/** The `@query` immediately preceding the caret, or null. Query = word chars
 *  + spaces are NOT consumed (a space ends the token). */
export function activeMentionQuery(
  text: string,
  caret: number,
): { query: string; start: number } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf("@");
  if (at === -1) return null;
  // @ must start the string or follow whitespace.
  if (at > 0 && !/\s/.test(upto[at - 1]!)) return null;
  const query = upto.slice(at + 1);
  if (/\s/.test(query)) return null; // a space closed the token
  return { query, start: at };
}

/** Replace the active @query (from `start` to caret) with `@FullName ` and
 *  return the new text + caret. The caller records `target.userId`. */
export function applyMention(
  text: string,
  caret: number,
  target: MentionTarget,
): { text: string; caret: number } {
  const active = activeMentionQuery(text, caret);
  const start = active ? active.start : caret;
  const label = `@${target.fullName ?? "Someone"} `;
  const next = text.slice(0, start) + label + text.slice(caret);
  return { text: next, caret: start + label.length };
}
```

- [ ] **Step 4:** Run → PASS. **Step 5:** Commit `feat(collab): pure mention extraction helpers`.

---

## Task 11: MentionTextarea (@-autocomplete)

**Files:**

- Create: `src/components/boards/item-panel/MentionTextarea.tsx`
- Test: `src/components/boards/item-panel/MentionTextarea.test.tsx`

A controlled textarea that shows a member dropdown when an `@query` is active; selecting a member calls `applyMention` and records the userId. Emits `(text, mentionIds)` upward. Uses `pulse-ui` tokens; the menu is a simple absolutely-positioned surface (no need for Radix Popover anchoring to a caret — render a bordered list under the textarea filtered by the query).

- [ ] **Step 1: Failing test (behavior: typing `@a` shows a matching member; selecting inserts + records id)**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MentionTextarea } from "@/components/boards/item-panel/MentionTextarea";

const members = [
  { userId: "u1", fullName: "Ada Lovelace" },
  { userId: "u2", fullName: "Alan Turing" },
];

it("suggests members on @query and records the chosen id", () => {
  const onChange = vi.fn();
  render(
    <MentionTextarea
      value=""
      mentionIds={[]}
      members={members}
      onChange={onChange}
    />,
  );
  const ta = screen.getByRole("textbox");
  fireEvent.change(ta, { target: { value: "hi @Al", selectionStart: 6 } });
  // both contain "Al"? Ada has no 'Al'; only Alan matches "Al"
  const option = screen.getByText("Alan Turing");
  fireEvent.mouseDown(option);
  // onChange called with inserted text + recorded id u2
  const [text, ids] = onChange.mock.calls.at(-1)!;
  expect(text).toContain("@Alan Turing");
  expect(ids).toContain("u2");
});
```

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3: Implement**

```tsx
"use client";

import { useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import {
  activeMentionQuery,
  applyMention,
  type MentionTarget,
} from "@/lib/collaboration/mentions";

export function MentionTextarea({
  value,
  mentionIds,
  members,
  onChange,
}: {
  value: string;
  mentionIds: string[];
  members: readonly MentionTarget[];
  onChange: (text: string, mentionIds: string[]) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<{ query: string; start: number } | null>(
    null,
  );

  function recompute(text: string, caret: number) {
    setQuery(activeMentionQuery(text, caret));
  }

  const suggestions = query
    ? members
        .filter((m) =>
          (m.fullName ?? "").toLowerCase().includes(query.query.toLowerCase()),
        )
        .slice(0, 6)
    : [];

  function choose(m: MentionTarget) {
    const ta = ref.current;
    const caret = ta?.selectionStart ?? value.length;
    const { text } = applyMention(value, caret, m);
    setQuery(null);
    onChange(text, [...new Set([...mentionIds, m.userId])]);
    queueMicrotask(() => ta?.focus());
  }

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        value={value}
        rows={3}
        autoFocus
        onChange={(e) => {
          onChange(e.target.value, mentionIds);
          recompute(
            e.target.value,
            e.target.selectionStart ?? e.target.value.length,
          );
        }}
        onKeyUp={(e) =>
          recompute(
            (e.target as HTMLTextAreaElement).value,
            (e.target as HTMLTextAreaElement).selectionStart ?? 0,
          )
        }
      />
      {suggestions.length > 0 && (
        <ul className="bg-surface absolute z-50 mt-1 w-64 overflow-hidden rounded-md border shadow-md">
          {suggestions.map((m) => (
            <li key={m.userId}>
              <button
                type="button"
                className="hover:bg-accent w-full px-3 py-1.5 text-left text-sm"
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(m);
                }}
              >
                {m.fullName ?? "Someone"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4:** Run → PASS. **Step 5:** Commit `feat(collab): @-mention autocomplete textarea`.

---

## Task 12: Wire MentionTextarea into UpdatesTab

**Files:**

- Modify: `src/components/boards/item-panel/UpdatesTab.tsx`
- Modify: `src/lib/collaboration/use-update-mutations.ts`
- Modify: `src/components/boards/item-panel/ItemPanel.tsx` (pass `onAdd` that carries mentions)

`UpdatesTab` tracks `text` + `mentionIds`, renders `MentionTextarea`, and calls `onAdd(text, mentionIds)`. The `add` mutation accepts `{ text, mentions }`.

- [ ] **Step 1:** In `use-update-mutations.ts`, change the `add` mutation variables to `{ text: string; mentions: string[] }`, pass `mentions` into `addUpdate({ itemId, text, mentions })`, and update the optimistic body to `{ text, mentions }`. Update the returned `addUpdate` wrapper to `(text: string, mentions: string[]) => add.mutate({ text, mentions })`.

- [ ] **Step 2:** In `UpdatesTab.tsx`, replace the `Textarea` block with `MentionTextarea`, hold `const [mentionIds, setMentionIds] = useState<string[]>([])`, change `onAdd` prop type to `(text: string, mentionIds: string[]) => void`, and submit `onAdd(text.trim(), mentionIds)` then reset both. Render the composer only when `members` is available.

```tsx
// composer body:
<MentionTextarea
  value={text}
  mentionIds={mentionIds}
  members={members}
  onChange={(t, ids) => {
    setText(t);
    setMentionIds(ids);
  }}
/>;
// submit():
const t = text.trim();
if (!t) return;
onAdd(t, mentionIds);
setText("");
setMentionIds([]);
setOpen(false);
```

- [ ] **Step 3:** In `ItemPanel.tsx`, change the `onAdd` passed to `UpdatesTab` to `mutations.addUpdate` (now `(text, mentionIds) => void`).

- [ ] **Step 4:** `pnpm vitest run src/components/boards/item-panel src/lib/collaboration && pnpm typecheck` → PASS (update any existing UpdatesTab/ItemPanel test that called `onAdd(text)` to the 2-arg shape).

- [ ] **Step 5:** Commit `feat(collab): wire @-mentions into the update composer`.

---

## Task 13: NotificationsBell + inbox, mounted in AppShell

**Files:**

- Create: `src/components/notifications/NotificationsBell.tsx`
- Create: `src/components/notifications/NotificationsList.tsx`
- Modify: `src/components/app-shell.tsx` (accept `currentUserId?: string`; render `<NotificationsBell userId={currentUserId} />` in the topbar when present)
- Modify: `src/app/boards/[boardId]/page.tsx` (pass `currentUserId={user.id}` to `AppShell`)

`NotificationsBell` uses `useNotifications(userId)` + `useNotificationMutations(userId)`; a Radix `Popover` (or the existing dropdown primitive) holds `NotificationsList`. Unread badge from `unread`. Row click: `markRead(id)` + navigate to the item via History API (`?item=` on the row's board) — use a full `window.location` set to `/boards/<board_id>?item=<item_id>` (cross-board → a real navigation is correct here, unlike in-board view toggles).

- [ ] **Step 1: Failing test (badge shows unread count)**

```tsx
// Mock useNotifications to return { query:{data:{notifications:[unread,unread]}}, unread:2 }
// and useNotificationMutations to no-ops; assert the badge renders "2".
```

- [ ] **Step 2:** Run → FAIL.

- [ ] **Step 3: Implement `NotificationsList.tsx`**

```tsx
"use client";

import type { AppNotification } from "@/lib/collaboration/notifications-cache";

function label(n: AppNotification): string {
  switch (n.kind) {
    case "mention":
      return "mentioned you in an update";
    case "assigned":
      return "assigned you to an item";
    default:
      return "updated an item you follow";
  }
}

export function NotificationsList({
  notifications,
  onOpen,
}: {
  notifications: readonly AppNotification[];
  onOpen: (n: AppNotification) => void;
}) {
  if (notifications.length === 0) {
    return (
      <p className="text-muted-foreground p-4 text-center text-sm">
        No notifications.
      </p>
    );
  }
  return (
    <ul className="max-h-96 overflow-y-auto">
      {notifications.map((n) => (
        <li key={n.id}>
          <button
            type="button"
            onClick={() => onOpen(n)}
            className="hover:bg-accent flex w-full items-start gap-2 border-b px-3 py-2 text-left text-sm"
          >
            {!n.read_at && (
              <span
                className="bg-primary mt-1.5 size-2 shrink-0 rounded-full"
                aria-label="unread"
              />
            )}
            <span className={n.read_at ? "text-muted-foreground" : ""}>
              {label(n)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Implement `NotificationsBell.tsx`** (use the existing `Popover`/`DropdownMenu` primitive; here with Popover):

```tsx
"use client";

import { Bell } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useNotifications } from "@/lib/collaboration/use-notifications";
import { useNotificationMutations } from "@/lib/collaboration/use-notification-mutations";
import type { AppNotification } from "@/lib/collaboration/notifications-cache";
import { NotificationsList } from "./NotificationsList";

export function NotificationsBell({ userId }: { userId: string }) {
  const { query, unread } = useNotifications(userId);
  const { markRead, markAllRead } = useNotificationMutations(userId);

  function open(n: AppNotification) {
    markRead(n.id);
    if (n.board_id) {
      const u = new URL(window.location.origin + `/boards/${n.board_id}`);
      if (n.item_id) u.searchParams.set("item", n.item_id);
      window.location.assign(u.toString());
    }
  }

  return (
    <Popover>
      <PopoverTrigger
        aria-label="Notifications"
        className="hover:bg-accent focus-visible:ring-ring relative grid size-9 place-items-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="bg-primary text-primary-foreground absolute -top-0.5 -right-0.5 grid min-w-4 place-items-center rounded-full px-1 text-[10px] leading-4">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          {unread > 0 && (
            <button
              onClick={markAllRead}
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              Mark all read
            </button>
          )}
        </div>
        <NotificationsList
          notifications={query.data?.notifications ?? []}
          onOpen={open}
        />
      </PopoverContent>
    </Popover>
  );
}
```

> If `src/components/ui/popover.tsx` doesn't exist, add it: `yes '' | pnpm dlx shadcn@latest add popover -y` (verify before the task; `dropdown-menu` exists per pulse-ui and is an acceptable substitute — anchor a `DropdownMenuContent` instead).

- [ ] **Step 5:** Mount in `app-shell.tsx` — add `currentUserId?: string` to props and render `{currentUserId && <NotificationsBell userId={currentUserId} />}` in the topbar next to `UserMenu`. Thread `currentUserId={user.id}` from `page.tsx`.

- [ ] **Step 6:** `pnpm vitest run src/components/notifications && pnpm typecheck && pnpm lint && pnpm build` → PASS.

- [ ] **Step 7:** Commit `feat(collab): notifications bell + inbox in app shell`.

---

## Task 14: RLS + fan-out integration tests (live DB)

**Files:**

- Create: `src/lib/collaboration/notifications.rls.integration.test.ts`

Mirror `collaboration.rls.integration.test.ts` (two users, two orgs; here also add user B as a **member of org A** to test in-org mention delivery). Assert:

- [ ] **Step 1: Write the test** covering:
  - Posting an update in org A with `mentions:[B]` (B is a member of A) inserts a `notifications` row visible to **B only** (A's `select` returns 0 for B's rows; B sees it).
  - `recipient_id` RLS: B cannot read A's notifications and vice-versa.
  - Adding B to a People cell fans out an `assigned` row to B.
  - `markNotificationRead` by the recipient sets `read_at`; a non-recipient update affects 0 rows.

(Provision: create org A via user A; create user B; add B to org A via `org_members` insert as A — confirm the org_members insert policy allows an admin/owner to add members, else use the service-role `admin` client to insert the membership row directly, which the harness already has.)

- [ ] **Step 2:** `pnpm vitest run src/lib/collaboration/notifications.rls.integration.test.ts` → PASS (skips without service-role key).

- [ ] **Step 3:** Commit `test(collab): notifications rls + fan-out integration`.

---

## Task 15: e2e — @mention → inbox row

**Files:**

- Create: `e2e/notifications.spec.ts`

Two confirmed users in one org (create both via service-role admin; add the second to the org). Sign in as A, open an item, post an update mentioning B; sign in as B (new context), assert the bell badge shows 1 and the inbox row is present; click it → lands on `/boards/<id>?item=<id>`.

- [ ] **Step 1: Write the spec** (mirror `e2e/item-panel.spec.ts` auth+board setup; use two `browser.newContext()` sessions).
- [ ] **Step 2:** `pnpm exec playwright test e2e/notifications.spec.ts` → PASS.
- [ ] **Step 3:** Commit `test(collab): e2e @mention -> recipient inbox`.

---

## Task 16: Full verification gate + advisors + wrapup

- [ ] **Step 1:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` → all PASS.
- [ ] **Step 2:** Advisor lints (via Supabase MCP `execute_sql` or `get_advisors`): confirm `notifications` has RLS on + 3 policies; the FK on `recipient_id`/`actor_id` (auth.users) left unindexed per convention, `recipient_id` covered by the composite + partial indexes; no new security warnings.
- [ ] **Step 3:** `/wrapup` — log the session, flip Phase 4 → "4b Done — 4c next", link the PR.

---

## Self-Review

**Spec coverage (§3, §6, §7, §9, §11):**

- §3 `notifications` table + enum + indexes + recipient-gated RLS → Task 1. ✔
- §6 queries/actions/Realtime: fetch hook + per-user channel (Task 8), mark-read actions (Task 7), optimistic mutations (Task 9), no revalidate on client-state reads. ✔
- §7 mention capture (@-autocomplete Task 11, extraction Task 10), `body` carries mentions + `body_text` resolved text (Task 4), fan-out per recipient (Task 4), assignment fan-out on People-cell add (Task 5), inbox popover + unread badge + deep-link + mark-read-on-view (Task 13). ✔
- §9 perf budget: open inbox = 1 bounded `recipient_id`-indexed read (Task 8 `LIMIT`); unread via partial index `notifications_unread_idx` (Task 1); live updates = per-user push (Task 8); composer adds 0 board round-trips. ✔
- §11 testing: RLS + fan-out integration (Task 14), trigger/pure unit (Tasks 6/10), component (Tasks 11/13), e2e (Task 15). ✔
- **Excluded by design:** `update_on_item` (needs watcher model, spec §13) — `notification_kind` keeps the enum value, unused in 4b.

**Placeholder scan:** Tasks 5, 13, 14, 15 contain prose-guided steps (mock shapes / provisioning / two-context e2e) because they extend existing harnesses whose exact surrounding code the implementer matches; the new logic (diff/fan-out, schemas, hooks, components) is given as complete code.

**Type/name consistency:** `mentions: string[]` threads addUpdateSchema (T3) → addUpdate (T4) → use-update-mutations (T12) → UpdatesTab/MentionTextarea (T11/T12); `NotificationsCache`/`AppNotification`/`prependNotification`/`markRead`/`markAllRead`/`unreadCount` consistent across T6/T8/T9; `notificationsKey` defined T8, consumed T9; `markNotificationRead`/`markAllNotificationsRead` consistent T7/T9; `activeMentionQuery`/`applyMention`/`MentionTarget` consistent T10/T11.

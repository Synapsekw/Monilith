# Notification Preferences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each user turn individual in-app notification event-types on/off from Settings, with existing users unaffected until they opt out.

**Architecture:** A new opt-out `notification_preferences` table (disabled-rows-only, self-RLS) is the source of truth. In-app delivery is gated by a single `BEFORE INSERT` trigger on `public.notifications` (SECURITY DEFINER — reads the _recipient's_ prefs, covering every current and future insert site including the service-client digest/feedback paths). A new server action + optimistic client form extend the existing Settings "Notifications" card. The email channel is modeled in the schema but keeps the existing `email_digest_opt_out` mechanism for this iteration.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, Supabase (Postgres + RLS), Zod, Vitest. Migrations via `scripts/new-migration.sh`; types via `pnpm db:types`.

---

## Spec reference

`docs/superpowers/specs/2026-07-15-notification-prefs-design.md`. Read it before starting.

## Grounded conventions (do not reinvent)

- Server actions: `"use server"`, Zod-validate at the boundary, return `ActionResult` / `fail` from `src/lib/actions/result.ts`. Pattern: `src/lib/settings/digest-actions.ts`.
- Optimistic client toggle: `useTransition` + revert-on-failure. Pattern: `src/components/settings/DigestPreferenceForm.tsx`.
- Migrations are **minted only** via `scripts/new-migration.sh <slug>` — never hand-stamp a version. Apply to DEV via the `supabase-dev` MCP with the **same version + name**, verify with `list_migrations`, run advisors.
- After any migration: `pnpm db:types` and commit `src/types/database.types.ts` in the same PR.
- Integration tests (`*.rls.integration.test.ts` / `*.integration.test.ts`) **skip unless `PULSE_TEST_DB` is set** — they run against DEV, never prod. Verify live behavior in a rolled-back transaction on DEV.
- Enum values already present: `notification_kind = mention | assigned | update_on_item | automation | feedback_response | health_digest`.

## File structure

| File                                                            | Create/Modify       | Responsibility                                                                                                                 |
| --------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `supabase/migrations/<stamp>_notification_preferences.sql`      | Create (via script) | `notification_channel` enum, `notification_preferences` table + RLS, `gate_notification_by_pref()` trigger fn + trigger        |
| `src/types/database.types.ts`                                   | Modify (regen)      | Generated types for the new enum/table                                                                                         |
| `src/lib/settings/notification-prefs.ts`                        | Create              | `notificationPrefKindSchema`, controllable-kinds list, `AppNotificationPrefKind` type — shared source of truth for UI + action |
| `src/lib/settings/notification-prefs-actions.ts`                | Create              | `setNotificationPreference` server action (upsert disabled row / delete on enable)                                             |
| `src/lib/settings/notification-prefs-actions.test.ts`           | Create              | Unit tests for the action (mocked Supabase)                                                                                    |
| `src/lib/settings/notification-prefs.queries.ts`                | Create              | `getDisabledInAppKinds(userId)` — first-paint read of disabled rows                                                            |
| `src/components/settings/NotificationPreferencesForm.tsx`       | Create              | Optimistic per-type in-app toggles                                                                                             |
| `src/components/settings/NotificationPreferencesForm.test.tsx`  | Create              | Component unit test (optimistic + revert)                                                                                      |
| `src/app/(app)/settings/page.tsx`                               | Modify              | Read disabled kinds; render new form in the Notifications card                                                                 |
| `src/lib/settings/notification-prefs.rls.integration.test.ts`   | Create              | RLS: no cross-user pref access                                                                                                 |
| `src/lib/collaboration/notification-gating.integration.test.ts` | Create              | Trigger drops the row for opted-out recipients; keeps others                                                                   |

## Execution DAG (working agreement #6)

**Interfaces**

- Task 1 (migration + types) **Produces:** the `notification_preferences` table, `notification_channel` enum, the gating trigger, regenerated `database.types.ts`.
- Task 2 (shared module) **Produces:** `notificationPrefKindSchema`, `CONTROLLABLE_IN_APP_KINDS`, `AppNotificationPrefKind`. **Consumes:** the regenerated enum type (Task 1).
- Task 3 (action + unit test) **Consumes:** Task 1 (table), Task 2 (schema). **Produces:** `setNotificationPreference`.
- Task 4 (query helper) **Consumes:** Task 1 (table), Task 2 (kinds). **Produces:** `getDisabledInAppKinds`.
- Task 5 (form + unit test) **Consumes:** Task 2 (kinds), Task 3 (action). **Produces:** `NotificationPreferencesForm`.
- Task 6 (settings wiring) **Consumes:** Task 4 (query), Task 5 (form).
- Task 7 (RLS integration test) **Consumes:** Task 1.
- Task 8 (trigger gating integration test) **Consumes:** Task 1.

**Dependency graph**

```
T1 ─┬─> T2 ─┬─> T3 ─┐
    │       └─> T5 ─┴─> T6
    ├─> T4 ───────────> T6
    ├─> T7
    └─> T8
```

**Parallel batches**

- **Batch A:** T1 (blocks nearly everything — do first, alone).
- **Batch B (parallel after T1):** T2, T7, T8 (T7/T8 only need the DB objects; T2 only needs the regenerated type).
- **Batch C (parallel after T2):** T3, T4.
- **Batch D (after T3):** T5.
- **Batch E (after T4 + T5):** T6.

**Critical path:** T1 → T2 → T3 → T5 → T6 (5 tasks = wall-clock floor).

**Note on parallel file writes:** all tasks touch distinct files except T6, which is the only writer of `settings/page.tsx` — so no two parallel tasks write the same file. See the §"Build-time collision" note below for the _cross-branch_ conflict on `settings/page.tsx`.

---

## Task 1: Migration — table, enum, RLS, gating trigger

**Files:**

- Create: `supabase/migrations/<stamp>_notification_preferences.sql` (mint via script)
- Modify: `src/types/database.types.ts` (regenerate)

- [ ] **Step 1: Mint the migration file**

```bash
scripts/new-migration.sh notification_preferences
```

Expected: prints a new path `supabase/migrations/<UTCstamp>_notification_preferences.sql`. Note the exact version stamp + name — you reuse them verbatim when applying to DEV.

- [ ] **Step 2: Write the migration SQL**

Put this in the newly-minted file (do not hand-edit the stamp):

```sql
-- Notification preferences: per-user, per-kind, per-channel opt-out.
-- Opt-out model: a row exists ONLY to record a DISABLED preference; absence =
-- enabled. Zero backfill => existing users keep current behavior.

create type public.notification_channel as enum ('in_app', 'email');

create table public.notification_preferences (
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       public.notification_kind    not null,
  channel    public.notification_channel not null,
  enabled    boolean not null default false check (enabled = false),
  created_at timestamptz not null default now(),
  primary key (user_id, kind, channel)
);

comment on table public.notification_preferences is
  'Opt-out only: a row means the (kind, channel) is DISABLED for user_id. No row = enabled.';

alter table public.notification_preferences enable row level security;

create policy "notif prefs: read own" on public.notification_preferences
  for select to authenticated using (user_id = (select auth.uid()));
create policy "notif prefs: write own" on public.notification_preferences
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.notification_preferences to authenticated;

-- In-app gating choke point: skip the notification row when the recipient has a
-- disabled (kind, 'in_app') preference. SECURITY DEFINER so it can read the
-- RECIPIENT's prefs (the actor inserting is a different user). Covers every
-- insert path incl. the service-client digest/feedback fan-outs.
create or replace function public.gate_notification_by_pref()
returns trigger language plpgsql security definer stable
set search_path = '' as $$
begin
  if exists (
    select 1 from public.notification_preferences p
    where p.user_id = new.recipient_id
      and p.kind    = new.kind
      and p.channel = 'in_app'
  ) then
    return null;  -- opted out: skip this row
  end if;
  return new;
end;
$$;

create trigger gate_notification_by_pref
  before insert on public.notifications
  for each row execute function public.gate_notification_by_pref();
```

- [ ] **Step 3: Apply to DEV via the `supabase-dev` MCP**

Use `mcp__supabase-dev__apply_migration` with **the same version + name** as the minted file. Then `mcp__supabase-dev__list_migrations` and confirm the new stamp is at the head of the ledger. If the ledger drifts, run `scripts/reconcile-migration-version.sh`.

- [ ] **Step 4: Run advisors**

Use `mcp__supabase-dev__get_advisors` (security + performance). Expected: no new errors introduced by this migration. In particular confirm the function reports no `search_path`-mutable warning (it sets `search_path = ''`).

- [ ] **Step 5: Regenerate types**

```bash
pnpm db:types
```

Expected: `src/types/database.types.ts` now contains `notification_channel` under `Enums` and a `notification_preferences` entry under `Tables`. Verify:

```bash
grep -n "notification_channel" src/types/database.types.ts
grep -n "notification_preferences" src/types/database.types.ts
```

Expected: both print matches.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/<stamp>_notification_preferences.sql src/types/database.types.ts
git commit -m "feat(notifications): notification_preferences table + in-app gating trigger"
```

---

## Task 2: Shared kinds module

**Files:**

- Create: `src/lib/settings/notification-prefs.ts`

- [ ] **Step 1: Write the module**

```ts
import { z } from "zod";
import type { Database } from "@/types/database.types";

export type NotificationKind = Database["public"]["Enums"]["notification_kind"];
export type NotificationChannel =
  Database["public"]["Enums"]["notification_channel"];

/**
 * Event-types a user may toggle for the in-app channel. `feedback_response`
 * is intentionally excluded (always-on: it is a direct reply to the user).
 * `update_on_item` / `automation` are reserved enum values not yet emitted.
 */
export const CONTROLLABLE_IN_APP_KINDS = [
  "mention",
  "assigned",
  "health_digest",
] as const;

export type AppNotificationPrefKind =
  (typeof CONTROLLABLE_IN_APP_KINDS)[number];

export const notificationPrefKindSchema = z.enum(CONTROLLABLE_IN_APP_KINDS);

/** UI copy for each controllable kind (in-app channel). */
export const IN_APP_KIND_LABELS: Record<
  AppNotificationPrefKind,
  { label: string; description: string }
> = {
  mention: {
    label: "Mentions",
    description: "When someone @-mentions you in an update",
  },
  assigned: {
    label: "Assignments",
    description: "When you're assigned to an item",
  },
  health_digest: {
    label: "Weekly digest",
    description: "The weekly plan-health digest, in-app",
  },
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no errors). This confirms the enum types from Task 1 resolve.

- [ ] **Step 3: Commit**

```bash
git add src/lib/settings/notification-prefs.ts
git commit -m "feat(notifications): shared controllable-kinds module for prefs"
```

---

## Task 3: `setNotificationPreference` server action + unit test

**Files:**

- Create: `src/lib/settings/notification-prefs-actions.ts`
- Test: `src/lib/settings/notification-prefs-actions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const getUser = vi.fn();
const upsert = vi.fn();
const del = vi.fn();
const from = vi.fn(() => ({ upsert, delete: del }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: { getUser }, from })),
}));

import { setNotificationPreference } from "./notification-prefs-actions";

beforeEach(() => {
  getUser.mockReset();
  upsert.mockReset();
  del.mockReset();
  from.mockClear();
});

describe("setNotificationPreference", () => {
  it("disables a kind by upserting a disabled row for the caller", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    upsert.mockResolvedValue({ error: null });

    const res = await setNotificationPreference({
      kind: "mention",
      enabled: false,
    });

    expect(res.ok).toBe(true);
    expect(from).toHaveBeenCalledWith("notification_preferences");
    expect(upsert).toHaveBeenCalledWith(
      {
        user_id: "user-1",
        kind: "mention",
        channel: "in_app",
        enabled: false,
      },
      { onConflict: "user_id,kind,channel" },
    );
    expect(del).not.toHaveBeenCalled();
  });

  it("enables a kind by deleting the disabled row", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    const eqChannel = vi.fn(async () => ({ error: null }));
    const eqKind = vi.fn(() => ({ eq: eqChannel }));
    const eqUser = vi.fn(() => ({ eq: eqKind }));
    del.mockReturnValue({ eq: eqUser });

    const res = await setNotificationPreference({
      kind: "assigned",
      enabled: true,
    });

    expect(res.ok).toBe(true);
    expect(del).toHaveBeenCalled();
    expect(eqUser).toHaveBeenCalledWith("user_id", "user-1");
    expect(eqKind).toHaveBeenCalledWith("kind", "assigned");
    expect(eqChannel).toHaveBeenCalledWith("channel", "in_app");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects when unauthenticated", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await setNotificationPreference({
      kind: "mention",
      enabled: false,
    });
    expect(res.ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("validates the kind at the boundary", async () => {
    const res = await setNotificationPreference({
      kind: "feedback_response",
      enabled: false,
    } as never);
    expect(res.ok).toBe(false);
    expect(getUser).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/lib/settings/notification-prefs-actions.test.ts`
Expected: FAIL — `setNotificationPreference` is not defined / module not found.

- [ ] **Step 3: Write the action**

```ts
"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fail, type ActionResult } from "@/lib/actions/result";
import { notificationPrefKindSchema } from "@/lib/settings/notification-prefs";

const inputSchema = z.object({
  kind: notificationPrefKindSchema,
  enabled: z.boolean(),
});

/**
 * Set the caller's IN-APP preference for one notification kind. Opt-out model:
 * disabling upserts a row; enabling deletes it (absence = enabled). RLS
 * ("notif prefs: write own") restricts the write to the caller's own rows.
 */
export async function setNotificationPreference(
  input: z.infer<typeof inputSchema>,
): Promise<ActionResult<null>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid input");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not signed in");

  if (parsed.data.enabled) {
    // Enable = remove the disabled row (default is enabled).
    const { error } = await supabase
      .from("notification_preferences")
      .delete()
      .eq("user_id", user.id)
      .eq("kind", parsed.data.kind)
      .eq("channel", "in_app");
    if (error) return fail(error.message);
    return { ok: true, data: null };
  }

  // Disable = record a disabled row (idempotent upsert on the PK).
  const { error } = await supabase.from("notification_preferences").upsert(
    {
      user_id: user.id,
      kind: parsed.data.kind,
      channel: "in_app",
      enabled: false,
    },
    { onConflict: "user_id,kind,channel" },
  );
  if (error) return fail(error.message);
  return { ok: true, data: null };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/lib/settings/notification-prefs-actions.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/settings/notification-prefs-actions.ts src/lib/settings/notification-prefs-actions.test.ts
git commit -m "feat(notifications): setNotificationPreference server action"
```

---

## Task 4: `getDisabledInAppKinds` query helper

**Files:**

- Create: `src/lib/settings/notification-prefs.queries.ts`

- [ ] **Step 1: Write the helper**

```ts
import { createClient } from "@/lib/supabase/server";
import {
  CONTROLLABLE_IN_APP_KINDS,
  type AppNotificationPrefKind,
} from "@/lib/settings/notification-prefs";

/**
 * The set of controllable in-app kinds the given user has DISABLED. Bounded,
 * PK-indexed read (opt-out rows only). Used for first paint of the settings
 * form. RLS scopes it to the caller, but we pass userId for an explicit filter.
 */
export async function getDisabledInAppKinds(
  userId: string,
): Promise<Set<AppNotificationPrefKind>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notification_preferences")
    .select("kind")
    .eq("user_id", userId)
    .eq("channel", "in_app");

  const controllable = new Set<string>(CONTROLLABLE_IN_APP_KINDS);
  const disabled = new Set<AppNotificationPrefKind>();
  for (const row of data ?? []) {
    if (controllable.has(row.kind))
      disabled.add(row.kind as AppNotificationPrefKind);
  }
  return disabled;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/settings/notification-prefs.queries.ts
git commit -m "feat(notifications): getDisabledInAppKinds first-paint query"
```

---

## Task 5: `NotificationPreferencesForm` component + unit test

**Files:**

- Create: `src/components/settings/NotificationPreferencesForm.tsx`
- Test: `src/components/settings/NotificationPreferencesForm.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const setPref = vi.fn();
vi.mock("@/lib/settings/notification-prefs-actions", () => ({
  setNotificationPreference: (...args: unknown[]) => setPref(...args),
}));

import { NotificationPreferencesForm } from "./NotificationPreferencesForm";

beforeEach(() => setPref.mockReset());

describe("NotificationPreferencesForm", () => {
  it("renders a checkbox per controllable kind, checked when not disabled", () => {
    render(<NotificationPreferencesForm disabledKinds={["mention"]} />);
    const mentions = screen.getByLabelText("Mentions") as HTMLInputElement;
    const assignments = screen.getByLabelText(
      "Assignments",
    ) as HTMLInputElement;
    expect(mentions.checked).toBe(false); // disabled -> unchecked
    expect(assignments.checked).toBe(true);
  });

  it("optimistically disables and calls the action with enabled:false", async () => {
    setPref.mockResolvedValue({ ok: true, data: null });
    render(<NotificationPreferencesForm disabledKinds={[]} />);
    const assignments = screen.getByLabelText(
      "Assignments",
    ) as HTMLInputElement;

    fireEvent.click(assignments); // uncheck => disable
    expect(assignments.checked).toBe(false);
    await waitFor(() =>
      expect(setPref).toHaveBeenCalledWith({
        kind: "assigned",
        enabled: false,
      }),
    );
  });

  it("reverts the checkbox when the action fails", async () => {
    setPref.mockResolvedValue({ ok: false, error: "nope" });
    render(<NotificationPreferencesForm disabledKinds={[]} />);
    const mentions = screen.getByLabelText("Mentions") as HTMLInputElement;

    fireEvent.click(mentions);
    await waitFor(() => expect(mentions.checked).toBe(true)); // reverted
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test src/components/settings/NotificationPreferencesForm.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Write the component**

```tsx
"use client";

import { useState, useTransition } from "react";
import { setNotificationPreference } from "@/lib/settings/notification-prefs-actions";
import {
  CONTROLLABLE_IN_APP_KINDS,
  IN_APP_KIND_LABELS,
  type AppNotificationPrefKind,
} from "@/lib/settings/notification-prefs";

/**
 * Per-type in-app notification toggles. Opt-out: a kind in `disabledKinds` is
 * OFF. Each checkbox is optimistic and reverts on failure (mirrors
 * DigestPreferenceForm). "Enabled" = checkbox checked = no disabled row.
 */
export function NotificationPreferencesForm({
  disabledKinds,
}: {
  disabledKinds: readonly AppNotificationPrefKind[];
}) {
  const [disabled, setDisabled] = useState<Set<AppNotificationPrefKind>>(
    () => new Set(disabledKinds),
  );
  const [pending, startTransition] = useTransition();

  function toggle(kind: AppNotificationPrefKind, nextEnabled: boolean) {
    setDisabled((prev) => {
      const next = new Set(prev);
      if (nextEnabled) next.delete(kind);
      else next.add(kind);
      return next;
    });
    startTransition(async () => {
      const res = await setNotificationPreference({
        kind,
        enabled: nextEnabled,
      });
      if (!res.ok) {
        // revert
        setDisabled((prev) => {
          const next = new Set(prev);
          if (nextEnabled) next.add(kind);
          else next.delete(kind);
          return next;
        });
      }
    });
  }

  return (
    <fieldset className="space-y-3">
      <legend className="text-muted-foreground mb-1 text-xs font-medium">
        In-app
      </legend>
      {CONTROLLABLE_IN_APP_KINDS.map((kind) => {
        const enabled = !disabled.has(kind);
        const copy = IN_APP_KIND_LABELS[kind];
        return (
          <label
            key={kind}
            className="flex items-start gap-2 text-sm"
            title={copy.description}
          >
            <input
              type="checkbox"
              aria-label={copy.label}
              className="accent-primary mt-0.5 size-4"
              checked={enabled}
              disabled={pending}
              onChange={(e) => toggle(kind, e.target.checked)}
            />
            <span>
              <span className="block">{copy.label}</span>
              <span className="text-muted-foreground block text-xs">
                {copy.description}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test src/components/settings/NotificationPreferencesForm.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/NotificationPreferencesForm.tsx src/components/settings/NotificationPreferencesForm.test.tsx
git commit -m "feat(notifications): NotificationPreferencesForm optimistic toggles"
```

---

## Task 6: Wire the form into the Settings page

**Files:**

- Modify: `src/app/(app)/settings/page.tsx`

> ⚠️ **Build-time collision:** `settings/page.tsx` is also edited by the parallel org-switcher branch. Keep this change minimal (2 imports + 1 read + the form inside the existing Notifications card). If the org-switcher branch has already merged into `develop`, rebase first (`git -C <main-checkout> fetch origin develop && git rebase origin/develop`) and re-apply this small hunk. See the plan's collision note.

- [ ] **Step 1: Add imports**

Add near the other `@/components/settings/*` imports (after the `DigestPreferenceForm` import line):

```tsx
import { NotificationPreferencesForm } from "@/components/settings/NotificationPreferencesForm";
import { getDisabledInAppKinds } from "@/lib/settings/notification-prefs.queries";
```

- [ ] **Step 2: Read disabled kinds on first paint**

The page already `await requireUser()` as `user`. Add this read alongside the existing parallel reads (it is independent). Add `getDisabledInAppKinds(user.id)` to the first `Promise.all` (the one that resolves `myTimeZone, orgs, aiCredential, orgAi`) and destructure it:

```tsx
const [myTimeZone, orgs, aiCredential, orgAi, disabledInApp] =
  await Promise.all([
    getUserTimeZoneCached(user.id),
    getUserOrgs(),
    getMyAiCredential(),
    getOrgAiSettings(),
    getDisabledInAppKinds(user.id),
  ]);
```

- [ ] **Step 3: Render the form in the Notifications card**

Replace the body of the existing Notifications `<Card>` `CardContent` so the in-app toggles sit above the existing digest-email toggle, grouped:

```tsx
<CardContent className="space-y-4">
  <NotificationPreferencesForm disabledKinds={[...disabledInApp]} />
  <div className="space-y-1">
    <p className="text-muted-foreground text-xs font-medium">Email</p>
    <DigestPreferenceForm
      initialOptOut={myProfile?.email_digest_opt_out ?? false}
    />
  </div>
</CardContent>
```

Also update the card's `CardDescription` from "In-app notifications are unaffected." to "Choose which notifications you receive." (the old copy is now false).

- [ ] **Step 4: Verify the full gate suite**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all four PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/settings/page.tsx
git commit -m "feat(notifications): surface per-type prefs in Settings Notifications card"
```

---

## Task 7: RLS integration test (cross-user isolation)

**Files:**

- Create: `src/lib/settings/notification-prefs.rls.integration.test.ts`

> Runs only when `PULSE_TEST_DB` is set (against DEV). Follow the harness pattern in `src/lib/collaboration/notifications.rls.integration.test.ts` for building anon clients per user (`A.anon`, `C.anon`, etc.). Use the existing test bootstrap helpers that file imports — do not hand-roll auth.

- [ ] **Step 1: Write the test**

```ts
import { describe, expect, it } from "vitest";
// Reuse the same fixtures/util the sibling notifications RLS test uses.
// Adjust the import to match that file's actual helper (e.g. `makeUsers`,
// `withOrg`, etc.) — read notifications.rls.integration.test.ts first.
import { setupTwoUsersInSeparateOrgs } from "@/lib/collaboration/__test-utils__/rls"; // <- match sibling

const RUN = !!process.env.PULSE_TEST_DB;

describe.skipIf(!RUN)("notification_preferences RLS", () => {
  it("a user cannot read another user's preference rows", async () => {
    const { A, B } = await setupTwoUsersInSeparateOrgs();

    // A disables a kind for themselves.
    const ins = await A.anon.from("notification_preferences").insert({
      user_id: A.userId,
      kind: "mention",
      channel: "in_app",
      enabled: false,
    });
    expect(ins.error).toBeNull();

    // B selects — must see none of A's rows.
    const { data: bSees } = await B.anon
      .from("notification_preferences")
      .select("*");
    expect((bSees ?? []).some((r) => r.user_id === A.userId)).toBe(false);
  });

  it("a user cannot write a preference row for someone else", async () => {
    const { A, B } = await setupTwoUsersInSeparateOrgs();
    const { error } = await B.anon.from("notification_preferences").insert({
      user_id: A.userId, // not B -> WITH CHECK must reject
      kind: "assigned",
      channel: "in_app",
      enabled: false,
    });
    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it (only meaningful with `PULSE_TEST_DB`)**

Run: `PULSE_TEST_DB=1 pnpm test src/lib/settings/notification-prefs.rls.integration.test.ts`
Expected: PASS. Without the env var: SKIPPED (still green in CI).

> If the imported helper name/path differs from the sibling file, fix the import to match before asserting pass — this is the one place the plan defers to the existing harness.

- [ ] **Step 3: Commit**

```bash
git add src/lib/settings/notification-prefs.rls.integration.test.ts
git commit -m "test(notifications): RLS isolation for notification_preferences"
```

---

## Task 8: Trigger gating integration test

**Files:**

- Create: `src/lib/collaboration/notification-gating.integration.test.ts`

> The load-bearing behavioral test: proves the `BEFORE INSERT` trigger drops rows for opted-out recipients and keeps them for others. Mirror the client-setup/util of `notifications.rls.integration.test.ts`. Insert notifications with a client that satisfies the notifications insert RLS (member+actor) OR the service client, matching how the sibling test inserts.

- [ ] **Step 1: Write the test**

```ts
import { describe, expect, it, afterEach } from "vitest";
import { setupOrgWithTwoMembers } from "@/lib/collaboration/__test-utils__/rls"; // <- match sibling

const RUN = !!process.env.PULSE_TEST_DB;

describe.skipIf(!RUN)("in-app notification gating trigger", () => {
  afterEach(async () => {
    // clean prefs rows created in the test (see sibling cleanup pattern)
  });

  it("drops the in-app row when the recipient disabled that kind", async () => {
    const { actor, recipient, orgId } = await setupOrgWithTwoMembers();

    // recipient opts out of 'mention' in-app
    await recipient.anon.from("notification_preferences").insert({
      user_id: recipient.userId,
      kind: "mention",
      channel: "in_app",
      enabled: false,
    });

    // actor fans out a mention notification to recipient
    const ins = await actor.anon.from("notifications").insert({
      org_id: orgId,
      recipient_id: recipient.userId,
      actor_id: actor.userId,
      kind: "mention",
    });
    expect(ins.error).toBeNull(); // trigger returns NULL, not an error

    // recipient sees no such row (trigger skipped the insert)
    const { data } = await recipient.anon
      .from("notifications")
      .select("id")
      .eq("recipient_id", recipient.userId)
      .eq("kind", "mention");
    expect(data ?? []).toHaveLength(0);
  });

  it("keeps the row when the recipient has NOT opted out", async () => {
    const { actor, recipient, orgId } = await setupOrgWithTwoMembers();

    const ins = await actor.anon.from("notifications").insert({
      org_id: orgId,
      recipient_id: recipient.userId,
      actor_id: actor.userId,
      kind: "assigned",
    });
    expect(ins.error).toBeNull();

    const { data } = await recipient.anon
      .from("notifications")
      .select("id")
      .eq("recipient_id", recipient.userId)
      .eq("kind", "assigned");
    expect((data ?? []).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it**

Run: `PULSE_TEST_DB=1 pnpm test src/lib/collaboration/notification-gating.integration.test.ts`
Expected: PASS. Without the env var: SKIPPED.

- [ ] **Step 3: Commit**

```bash
git add src/lib/collaboration/notification-gating.integration.test.ts
git commit -m "test(notifications): in-app gating trigger drops opted-out rows"
```

---

## Final verification (before finish-task)

- [ ] Run the full gate suite from the worktree root:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all four PASS. (Integration suites SKIP without `PULSE_TEST_DB` — that is expected in CI.)

- [ ] Confirm the migration ledger on DEV matches the committed file name+version (`mcp__supabase-dev__list_migrations`).
- [ ] Confirm advisors are clean (`mcp__supabase-dev__get_advisors`).

---

## Manual test guide (hand to the user after merge)

Setup: pull `develop`, ensure your local `.env.local` points at DEV (default). Sign in.

1. Go to **Settings** (`/settings`). In the **Notifications** card you now see an **In-app** group with three toggles (Mentions, Assignments, Weekly digest) above the existing **Email** weekly-digest checkbox. Expected: all three in-app boxes checked (default = everything on).
2. Uncheck **Mentions**. Expected: the box unchecks instantly (optimistic) and stays unchecked after a moment (persisted).
3. In another board, have a teammate (or a second account) @-mention you in an item update. Expected: **no** new in-app notification appears in your bell — the mention was gated.
4. Re-check **Mentions** in Settings. Have them @-mention you again. Expected: the notification **does** appear in the bell (gating removed).
5. Assign yourself via a People column from a second account with **Assignments** unchecked → no notification; checked → notification appears. (Confirms the second kind.)
6. Reload the Settings page. Expected: your toggle states persist across reloads.
7. **Not user-observable but worth noting:** `feedback_response` has no toggle by design (always-on), and the weekly-digest _email_ checkbox behaves exactly as before (it still writes `email_digest_opt_out`).

---

## Self-review notes

- **Spec coverage:** table+enum+RLS+trigger (T1) ✔; shared kinds incl. feedback_response exclusion (T2, spec §6) ✔; action opt-out semantics (T3, spec §4) ✔; first-paint bounded read (T4, spec §9) ✔; optimistic UI (T5, spec §8) ✔; settings wiring + collision flag (T6, spec §12) ✔; RLS + trigger tests (T7/T8, spec §10) ✔; email-channel-kept-as-is (spec §7) — reflected in T6 keeping `DigestPreferenceForm` untouched ✔; performance budget (spec §9) — T4 bounded read + no revalidate in T5 ✔.
- **Deferred/owner:** unify `email_digest_opt_out` — spec §11 owner question, deliberately NOT a task.
- **Type consistency:** `setNotificationPreference({ kind, enabled })`, `getDisabledInAppKinds(userId): Set<AppNotificationPrefKind>`, `CONTROLLABLE_IN_APP_KINDS`, `channel = 'in_app'` used consistently across T2–T6.
- **Harness caveat:** T7/T8 defer the exact test-util import to the sibling `notifications.rls.integration.test.ts` (its helper names are the source of truth) — the one intentional "read the neighbor first" step.

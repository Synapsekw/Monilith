# Per-user timezone + update timestamps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show author name + absolute date/time on each item update, and replace the unusable raw-IANA timezone control with a searchable, friendly-labeled picker driven by a new per-user timezone preference.

**Architecture:** Add a nullable `timezone` column to `profiles` (null = "Automatic" → viewer's device zone); the existing self-update RLS policy already covers writes. A shared `<DateTime>` client primitive — fed by a `TimeZoneProvider` mounted in the authenticated app shell — renders every timestamp in the user's resolved zone. A single reusable `TimezonePicker` (shadcn Command + Popover combobox) powers both the new personal picker and the refactored org picker. The org timezone (admin-only, drives automations) is untouched except for its UI.

**Tech Stack:** Next.js 16 (App Router, RSC + Server Actions), Supabase (Postgres + RLS), TypeScript strict, Zod, shadcn/ui (`cmdk` + Radix Popover), Vitest + Testing Library (jsdom).

---

## File structure

**Create:**

- `supabase/migrations/20260621120000_profiles_timezone.sql` — adds `profiles.timezone`
- `src/lib/validations/profile.ts` — `updateProfileTimezoneSchema`
- `src/lib/validations/profile.test.ts`
- `src/lib/profile/actions.ts` — `updateProfileTimezone` server action
- `src/lib/datetime/timezone.ts` — `listTimeZones`, `detectDeviceTimeZone`, `timezoneLabel`
- `src/lib/datetime/timezone.test.ts`
- `src/lib/datetime/format.ts` — `formatDateTime`
- `src/lib/datetime/format.test.ts`
- `src/lib/datetime/timezone-context.tsx` — `TimeZoneProvider`, `useTimeZone`
- `src/components/datetime/date-time.tsx` — `<DateTime>` primitive
- `src/components/ui/timezone-picker.tsx` — shared combobox
- `src/components/settings/personal-timezone-form.tsx` — personal picker form
- `src/components/boards/item-panel/UpdatesTab.test.tsx` — author + timestamp render test
- `src/lib/profile/timezone.rls.integration.test.ts` — RLS self-only write test

**Modify:**

- `src/types/database.types.ts` — regenerated (adds `profiles.timezone`)
- `src/lib/auth/session.ts` — add cached `getUserTimeZone()`
- `src/app/boards/layout.tsx`, `src/app/settings/layout.tsx`, `src/app/dashboards/layout.tsx` — wrap `<AppShell>` in `<TimeZoneProvider>`
- `src/components/settings/timezone-form.tsx` — use `TimezonePicker` instead of native `<select>`
- `src/components/settings/timezone-form.test.tsx` — rewrite for combobox interaction
- `src/app/settings/page.tsx` — render `<PersonalTimezoneForm>`
- `src/components/boards/item-panel/UpdatesTab.tsx` — render `<DateTime>` next to author

---

## Task 1: Migration — add `profiles.timezone`

**Files:**

- Create: `supabase/migrations/20260621120000_profiles_timezone.sql`
- Modify: `src/types/database.types.ts` (regenerated)

The existing `profiles: update self` policy (init migration, lines 205–208) already allows a user to update their own row, so **no new RLS policy is required** — only the column.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260621120000_profiles_timezone.sql`:

```sql
-- Per-user display timezone. NULL = "Automatic" (resolve to the viewer's device
-- zone at render time). A non-null value is a validated IANA id (e.g.
-- 'Europe/Belgrade'), enforced in app code via Zod (Postgres can't validate IANA
-- names in a CHECK). Writes are already gated by the existing
-- "profiles: update self" RLS policy. The org-level organizations.timezone
-- (which drives automations) is unrelated and unchanged.
alter table public.profiles
  add column timezone text;

comment on column public.profiles.timezone is
  'Per-user display timezone (IANA id). NULL = automatic / device zone.';
```

- [ ] **Step 2: Apply the migration**

Run: `pnpm supabase migration up` (or `pnpm db:push` if that is the project's apply script — check `package.json`; otherwise apply via the Supabase MCP `apply_migration`).
Expected: migration applies cleanly; `profiles` now has a nullable `timezone` column.

- [ ] **Step 3: Regenerate types**

Run: `pnpm db:types`
Expected: `src/types/database.types.ts` updates so `profiles.Row` includes `timezone: string | null` (and `Insert`/`Update` include `timezone?: string | null`).

- [ ] **Step 4: Verify the type changed**

Run: `grep -n "timezone" src/types/database.types.ts | head`
Expected: a `timezone: string | null` line appears under the `profiles` block.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260621120000_profiles_timezone.sql src/types/database.types.ts
git commit -m "feat(db): add nullable profiles.timezone for per-user display zone"
```

---

## Task 2: Zod schema for personal timezone

**Files:**

- Create: `src/lib/validations/profile.ts`
- Test: `src/lib/validations/profile.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/validations/profile.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { updateProfileTimezoneSchema } from "./profile";

describe("updateProfileTimezoneSchema", () => {
  it("accepts a valid IANA timezone", () => {
    const r = updateProfileTimezoneSchema.safeParse({
      timezone: "Europe/Belgrade",
    });
    expect(r.success).toBe(true);
  });

  it("accepts null (Automatic)", () => {
    const r = updateProfileTimezoneSchema.safeParse({ timezone: null });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown timezone", () => {
    const r = updateProfileTimezoneSchema.safeParse({
      timezone: "Mars/Olympus_Mons",
    });
    expect(r.success).toBe(false);
  });

  it("rejects an empty string", () => {
    const r = updateProfileTimezoneSchema.safeParse({ timezone: "" });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/validations/profile.test.ts`
Expected: FAIL — cannot import `./profile` (module does not exist).

- [ ] **Step 3: Write the schema**

Create `src/lib/validations/profile.ts`:

```ts
import { z } from "zod";
import { isValidTimeZone } from "@/lib/validations/org";

/**
 * Personal display timezone. A non-null value must be a runtime-valid IANA id;
 * `null` means "Automatic" (use the viewer's device zone). Reuses the same
 * `isValidTimeZone` runtime check as the org timezone schema.
 */
export const updateProfileTimezoneSchema = z.object({
  timezone: z.string().refine(isValidTimeZone, "Unknown timezone").nullable(),
});
export type UpdateProfileTimezoneInput = z.infer<
  typeof updateProfileTimezoneSchema
>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/validations/profile.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/validations/profile.ts src/lib/validations/profile.test.ts
git commit -m "feat(validation): add updateProfileTimezoneSchema (IANA or null)"
```

---

## Task 3: `updateProfileTimezone` server action

**Files:**

- Create: `src/lib/profile/actions.ts`

This mirrors `updateOrgTimezone` (`src/lib/org/actions.ts`) but writes the caller's **own** `profiles` row. RLS (`profiles: update self`) is the real boundary; the action never accepts a client-supplied user id.

- [ ] **Step 1: Write the action**

Create `src/lib/profile/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { updateProfileTimezoneSchema } from "@/lib/validations/profile";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };
const fail = (error: string): ActionResult<never> => ({ ok: false, error });

/** Update the signed-in user's personal display timezone (null = Automatic). */
export async function updateProfileTimezone(input: {
  timezone: string | null;
}): Promise<ActionResult> {
  const parsed = updateProfileTimezoneSchema.safeParse(input);
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Invalid input");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail("Not authenticated.");

  // RLS ("profiles: update self") restricts the write to the caller's own row.
  const { error } = await supabase
    .from("profiles")
    .update({ timezone: parsed.data.timezone })
    .eq("id", user.id);

  if (error) return fail("Could not update timezone.");

  revalidatePath("/settings");
  return { ok: true, data: undefined };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS — `profiles` accepts `timezone` (from Task 1's regenerated types).

- [ ] **Step 3: Commit**

```bash
git add src/lib/profile/actions.ts
git commit -m "feat(profile): updateProfileTimezone server action (self-only via RLS)"
```

---

## Task 4: Timezone utilities (`listTimeZones`, `detectDeviceTimeZone`, `timezoneLabel`)

**Files:**

- Create: `src/lib/datetime/timezone.ts`
- Test: `src/lib/datetime/timezone.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/datetime/timezone.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { listTimeZones, timezoneLabel } from "./timezone";

// Fixed reference dates make offset labels deterministic (no Date.now()).
const WINTER = new Date("2026-01-15T12:00:00Z");
const SUMMER = new Date("2026-07-15T12:00:00Z");

describe("listTimeZones", () => {
  it("returns a non-empty list including common zones", () => {
    const zones = listTimeZones();
    expect(zones).toContain("UTC");
    expect(zones).toContain("Europe/Belgrade");
    expect(zones.length).toBeGreaterThan(100);
  });
});

describe("timezoneLabel", () => {
  it("includes the city and a GMT offset", () => {
    const label = timezoneLabel("Europe/Belgrade", WINTER);
    expect(label).toContain("Belgrade");
    expect(label).toContain("GMT+1"); // CET in January
  });

  it("reflects DST in the offset for the reference date", () => {
    const label = timezoneLabel("Europe/Belgrade", SUMMER);
    expect(label).toContain("GMT+2"); // CEST in July
  });

  it("humanizes underscores in multi-word cities", () => {
    const label = timezoneLabel("America/New_York", WINTER);
    expect(label).toContain("New York");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/datetime/timezone.test.ts`
Expected: FAIL — cannot import `./timezone`.

- [ ] **Step 3: Write the utilities**

Create `src/lib/datetime/timezone.ts`:

```ts
/** All IANA zones the runtime knows, or a minimal fallback. */
export function listTimeZones(): string[] {
  return typeof Intl !== "undefined" &&
    typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")
    : ["UTC"];
}

/** The viewer's current device timezone (used for "Automatic"). */
export function detectDeviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function partValue(
  timeZone: string,
  referenceDate: Date,
  timeZoneName: "long" | "shortOffset",
): string {
  return (
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName })
      .formatToParts(referenceDate)
      .find((p) => p.type === "timeZoneName")?.value ?? ""
  );
}

/**
 * Friendly label for a zone, e.g.
 * "New York — Eastern Standard Time (GMT-5)". Offsets/names are computed against
 * `referenceDate` so callers control DST and tests stay deterministic.
 */
export function timezoneLabel(timeZone: string, referenceDate: Date): string {
  const city = timeZone.split("/").pop()?.replace(/_/g, " ") ?? timeZone;
  const longName = partValue(timeZone, referenceDate, "long");
  const offset = partValue(timeZone, referenceDate, "shortOffset");
  return longName ? `${city} — ${longName} (${offset})` : `${city} (${offset})`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/datetime/timezone.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/datetime/timezone.ts src/lib/datetime/timezone.test.ts
git commit -m "feat(datetime): IANA list + friendly timezone label helpers"
```

---

## Task 5: `formatDateTime`

**Files:**

- Create: `src/lib/datetime/format.ts`
- Test: `src/lib/datetime/format.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/datetime/format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatDateTime } from "./format";

const ISO = "2026-06-21T15:45:00Z";

describe("formatDateTime", () => {
  it("formats an absolute date and time in the given zone", () => {
    const out = formatDateTime(ISO, { timeZone: "UTC" });
    expect(out).toContain("2026");
    expect(out).toMatch(/3:45|15:45/); // locale may be 12h or 24h
  });

  it("produces different output for different zones", () => {
    const utc = formatDateTime(ISO, { timeZone: "UTC" });
    const tokyo = formatDateTime(ISO, { timeZone: "Asia/Tokyo" });
    expect(utc).not.toEqual(tokyo);
  });

  it("accepts a Date instance", () => {
    expect(formatDateTime(new Date(ISO), { timeZone: "UTC" })).toContain(
      "2026",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/datetime/format.test.ts`
Expected: FAIL — cannot import `./format`.

- [ ] **Step 3: Write the formatter**

Create `src/lib/datetime/format.ts`:

```ts
/**
 * Absolute date + time, e.g. "Jun 21, 2026, 3:45 PM". `timeZone` undefined →
 * the runtime's default zone (the viewer's device zone in the browser).
 */
export function formatDateTime(
  value: string | number | Date,
  opts: { timeZone?: string } = {},
): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: opts.timeZone,
  }).format(date);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/datetime/format.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/datetime/format.ts src/lib/datetime/format.test.ts
git commit -m "feat(datetime): formatDateTime absolute formatter"
```

---

## Task 6: `TimeZoneProvider` + `useTimeZone`

**Files:**

- Create: `src/lib/datetime/timezone-context.tsx`

- [ ] **Step 1: Write the provider**

Create `src/lib/datetime/timezone-context.tsx`:

```tsx
"use client";

import { createContext, useContext, type ReactNode } from "react";

/** Resolved user timezone: an explicit IANA id, or null = Automatic. */
const TimeZoneContext = createContext<string | null>(null);

export function TimeZoneProvider({
  timeZone,
  children,
}: {
  timeZone: string | null;
  children: ReactNode;
}) {
  return (
    <TimeZoneContext.Provider value={timeZone}>
      {children}
    </TimeZoneContext.Provider>
  );
}

/** The signed-in user's preferred zone, or null when Automatic/unset. */
export function useTimeZone(): string | null {
  return useContext(TimeZoneContext);
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/datetime/timezone-context.tsx
git commit -m "feat(datetime): TimeZoneProvider + useTimeZone context"
```

---

## Task 7: `<DateTime>` primitive

**Files:**

- Create: `src/components/datetime/date-time.tsx`

Resolution: explicit profile zone (from context) → else device zone (undefined → `Intl` uses device). `suppressHydrationWarning` covers the Automatic case, where the server render (no device zone) and client render can differ.

- [ ] **Step 1: Write the component**

Create `src/components/datetime/date-time.tsx`:

```tsx
"use client";

import { useTimeZone } from "@/lib/datetime/timezone-context";
import { formatDateTime } from "@/lib/datetime/format";

/** The single app-wide primitive for rendering an absolute timestamp. */
export function DateTime({
  value,
  className,
}: {
  value: string | number | Date;
  className?: string;
}) {
  const tz = useTimeZone();
  const date = value instanceof Date ? value : new Date(value);
  return (
    <time
      dateTime={date.toISOString()}
      className={className}
      suppressHydrationWarning
    >
      {formatDateTime(date, { timeZone: tz ?? undefined })}
    </time>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/datetime/date-time.tsx
git commit -m "feat(datetime): <DateTime> timestamp primitive"
```

---

## Task 8: `getUserTimeZone()` + mount `TimeZoneProvider` in the app shell layouts

**Files:**

- Modify: `src/lib/auth/session.ts`
- Modify: `src/app/boards/layout.tsx`, `src/app/settings/layout.tsx`, `src/app/dashboards/layout.tsx`

- [ ] **Step 1: Add the cached helper to `session.ts`**

In `src/lib/auth/session.ts`, append after `getUserOrgs`:

```ts
/** The signed-in user's personal timezone (null = Automatic / unset). Cached
 * per request so the layout reads it without an extra round-trip. */
export const getUserTimeZone = cache(async (): Promise<string | null> => {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .single();
  return data?.timezone ?? null;
});
```

- [ ] **Step 2: Wrap the boards layout**

In `src/app/boards/layout.tsx`, add to the imports:

```tsx
import { requireUser, getUserOrgs, getUserTimeZone } from "@/lib/auth/session";
import { TimeZoneProvider } from "@/lib/datetime/timezone-context";
```

Add `getUserTimeZone()` to the `Promise.all` destructure and array:

```tsx
const [
  orgs,
  boards,
  sharedBoards,
  dashboards,
  { data: workspaces },
  platformAdmin,
  timeZone,
] = await Promise.all([
  getUserOrgs(),
  listMyBoards(),
  listSharedBoards(),
  listDashboards(),
  supabase.from("workspaces").select("id, name"),
  isPlatformAdmin(),
  getUserTimeZone(),
]);
```

Wrap the returned `<AppShell>` (keep all its existing props unchanged):

```tsx
return (
  <TimeZoneProvider timeZone={timeZone}>
    <AppShell
      currentUserId={user.id}
      /* …all existing props unchanged… */
    >
      {children}
    </AppShell>
  </TimeZoneProvider>
);
```

- [ ] **Step 3: Wrap the settings and dashboards layouts the same way**

Apply the identical three edits (import `getUserTimeZone` + `TimeZoneProvider`, add `getUserTimeZone()` as the last `Promise.all` entry → `timeZone`, wrap `<AppShell>` in `<TimeZoneProvider timeZone={timeZone}>`) to:

- `src/app/settings/layout.tsx`
- `src/app/dashboards/layout.tsx`

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Verify existing layout/shell tests still pass**

Run: `pnpm vitest run src/components/app-shell.test.tsx`
Expected: PASS (AppShell props are unchanged; the provider is a transparent wrapper).

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/session.ts src/app/boards/layout.tsx src/app/settings/layout.tsx src/app/dashboards/layout.tsx
git commit -m "feat(datetime): provide user timezone to the authenticated app shell"
```

---

## Task 9: Shared `TimezonePicker` combobox

**Files:**

- Create: `src/components/ui/timezone-picker.tsx`

Uses the existing `src/components/ui/command.tsx` and `src/components/ui/popover.tsx`. `cmdk` filters on each item's `value`, so we set it to `"<label> <zone>"` to match both friendly text and the raw IANA id. cmdk items expose `role="option"`, which the tests target.

- [ ] **Step 1: Write the component**

Create `src/components/ui/timezone-picker.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import {
  listTimeZones,
  timezoneLabel,
  detectDeviceTimeZone,
} from "@/lib/datetime/timezone";

export function TimezonePicker({
  value,
  onChange,
  allowAutomatic = false,
  disabled = false,
}: {
  value: string | null;
  onChange: (tz: string | null) => void;
  allowAutomatic?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // One reference instant per mount keeps offset labels stable across renders.
  const ref = useMemo(() => new Date(), []);
  const options = useMemo(
    () =>
      listTimeZones().map((zone) => ({
        zone,
        label: timezoneLabel(zone, ref),
      })),
    [ref],
  );

  const triggerLabel =
    value === null
      ? allowAutomatic
        ? `Automatic — ${detectDeviceTimeZone()}`
        : "Select timezone"
      : timezoneLabel(value, ref);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Search timezone…" />
          <CommandList>
            <CommandEmpty>No timezone found.</CommandEmpty>
            <CommandGroup>
              {allowAutomatic && (
                <CommandItem
                  value="Automatic device"
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === null ? "opacity-100" : "opacity-0",
                    )}
                  />
                  Automatic — {detectDeviceTimeZone()}
                </CommandItem>
              )}
              {options.map((o) => (
                <CommandItem
                  key={o.zone}
                  value={`${o.label} ${o.zone}`}
                  onSelect={() => {
                    onChange(o.zone);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === o.zone ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {o.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. (If `lucide-react` lacks `ChevronsUpDown`/`Check`, check the other shadcn primitives for the exact icon import names and adjust.)

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/timezone-picker.tsx
git commit -m "feat(ui): searchable TimezonePicker combobox with friendly labels"
```

---

## Task 10: Personal timezone form + wire into Settings

**Files:**

- Create: `src/components/settings/personal-timezone-form.tsx`
- Modify: `src/app/settings/page.tsx`

- [ ] **Step 1: Write the personal form**

Create `src/components/settings/personal-timezone-form.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { updateProfileTimezone } from "@/lib/profile/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { TimezonePicker } from "@/components/ui/timezone-picker";
import { cn } from "@/lib/utils";

export function PersonalTimezoneForm({
  currentTimezone,
}: {
  currentTimezone: string | null;
}) {
  const [tz, setTz] = useState<string | null>(currentTimezone);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const isUnchanged = tz === currentTimezone;

  function save() {
    setMsg(null);
    start(async () => {
      const res = await updateProfileTimezone({ timezone: tz });
      if (res.ok) {
        setMsg("Saved.");
        setIsError(false);
      } else {
        setMsg(res.error);
        setIsError(true);
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Your timezone</Label>
        <TimezonePicker
          value={tz}
          onChange={(v) => {
            setTz(v);
            setMsg(null);
          }}
          allowAutomatic
          disabled={pending}
        />
        <p className="text-muted-foreground text-xs">
          Controls how dates and times are shown to you across the app.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={pending || isUnchanged} size="sm">
          {pending ? "Saving…" : "Save"}
        </Button>
        {msg && (
          <span
            className={cn(
              "text-xs",
              isError ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {msg}
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Render it in the Settings page**

In `src/app/settings/page.tsx`:

Add imports:

```tsx
import { requireUser, getUserOrgs, getUserTimeZone } from "@/lib/auth/session";
import { PersonalTimezoneForm } from "@/components/settings/personal-timezone-form";
```

After `const user = await requireUser();`, read the personal zone:

```tsx
const myTimeZone = await getUserTimeZone();
```

Add a new card immediately after the `</div>` that closes the page header (before the Organization `<Card>`), inside the `space-y-4` wrapper:

```tsx
<Card>
  <CardHeader>
    <CardTitle>Preferences</CardTitle>
    <CardDescription>Personal settings for your account.</CardDescription>
  </CardHeader>
  <CardContent>
    <PersonalTimezoneForm currentTimezone={myTimeZone} />
  </CardContent>
</Card>
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/personal-timezone-form.tsx src/app/settings/page.tsx
git commit -m "feat(settings): personal timezone picker"
```

---

## Task 11: Refactor the org timezone form to use `TimezonePicker`

**Files:**

- Modify: `src/components/settings/timezone-form.tsx`
- Modify: `src/components/settings/timezone-form.test.tsx`

The org timezone is always a non-null string and offers no "Automatic" option. Behavior (action call, save button, status message) is unchanged — only the control changes.

- [ ] **Step 1: Rewrite the existing test for the combobox**

Replace `src/components/settings/timezone-form.test.tsx` with:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TimezoneForm } from "./timezone-form";

vi.mock("@/lib/org/actions", () => ({
  updateOrgTimezone: vi.fn(async () => ({ ok: true, data: undefined })),
}));
import { updateOrgTimezone } from "@/lib/org/actions";

describe("TimezoneForm", () => {
  it("shows the current timezone on the trigger", () => {
    render(<TimezoneForm orgId="o1" currentTimezone="Europe/Belgrade" />);
    expect(
      screen.getByRole("combobox", { name: /belgrade/i }),
    ).toBeInTheDocument();
  });

  it("saves the chosen timezone via the action", async () => {
    render(<TimezoneForm orgId="o1" currentTimezone="UTC" />);
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.type(
      screen.getByPlaceholderText(/search timezone/i),
      "New York",
    );
    await userEvent.click(
      await screen.findByRole("option", { name: /new york/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(updateOrgTimezone).toHaveBeenCalledWith({
      orgId: "o1",
      timezone: "America/New_York",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/components/settings/timezone-form.test.tsx`
Expected: FAIL — current form renders a `<select>`, so there is no `combobox` role / search input.

- [ ] **Step 3: Rewrite the form to use `TimezonePicker`**

Replace `src/components/settings/timezone-form.tsx` with:

```tsx
"use client";

import { useState, useTransition } from "react";
import { updateOrgTimezone } from "@/lib/org/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { TimezonePicker } from "@/components/ui/timezone-picker";
import { cn } from "@/lib/utils";

interface TimezoneFormProps {
  orgId: string;
  currentTimezone: string;
}

export function TimezoneForm({ orgId, currentTimezone }: TimezoneFormProps) {
  const [tz, setTz] = useState(currentTimezone);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const isUnchanged = tz === currentTimezone;

  function save() {
    setMsg(null);
    start(async () => {
      const res = await updateOrgTimezone({ orgId, timezone: tz });
      if (res.ok) {
        setMsg("Saved.");
        setIsError(false);
      } else {
        setMsg(res.error);
        setIsError(true);
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Timezone</Label>
        <TimezonePicker
          value={tz}
          onChange={(v) => {
            // Org timezone is never "Automatic"; ignore a null selection.
            if (v) setTz(v);
            setMsg(null);
          }}
          disabled={pending}
        />
        <p className="text-muted-foreground text-xs">
          Date automations fire at 8:00 AM in this timezone.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={pending || isUnchanged} size="sm">
          {pending ? "Saving…" : "Save"}
        </Button>
        {msg && (
          <span
            className={cn(
              "text-xs",
              isError ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {msg}
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/components/settings/timezone-form.test.tsx`
Expected: PASS (2 tests). If cmdk filtering needs a frame to settle, the `findByRole("option")` already awaits it.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/timezone-form.tsx src/components/settings/timezone-form.test.tsx
git commit -m "refactor(settings): org timezone picker uses searchable TimezonePicker"
```

---

## Task 12: Show author + timestamp on updates

**Files:**

- Modify: `src/components/boards/item-panel/UpdatesTab.tsx`
- Test: `src/components/boards/item-panel/UpdatesTab.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/boards/item-panel/UpdatesTab.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { UpdatesTab } from "./UpdatesTab";
import { TimeZoneProvider } from "@/lib/datetime/timezone-context";
import type { UpdatesCache } from "@/lib/collaboration/cache";

const cache: UpdatesCache = {
  updates: [
    {
      id: "u1",
      org_id: "o1",
      board_id: "b1",
      item_id: "i1",
      author_id: "user-1",
      body: { text: "Shipped it", mentions: [] },
      body_text: "Shipped it",
      edited_at: null,
      created_at: "2026-06-21T15:45:00Z",
      updated_at: "2026-06-21T15:45:00Z",
    },
  ],
};

const members = [{ userId: "user-1", fullName: "Ada Lovelace" }];

describe("UpdatesTab", () => {
  it("renders the author name and a formatted timestamp", () => {
    render(
      <TimeZoneProvider timeZone="UTC">
        <UpdatesTab
          cache={cache}
          members={members}
          onAdd={vi.fn()}
          onDelete={vi.fn()}
        />
      </TimeZoneProvider>,
    );
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    // created_at rendered via <DateTime> in the provided UTC zone.
    expect(screen.getByText(/2026/)).toBeInTheDocument();
    expect(screen.getByText(/Shipped it/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/components/boards/item-panel/UpdatesTab.test.tsx`
Expected: FAIL — no element matching `/2026/` (timestamp not rendered yet).

- [ ] **Step 3: Render `<DateTime>` next to the author**

In `src/components/boards/item-panel/UpdatesTab.tsx`, add the import:

```tsx
import { DateTime } from "@/components/datetime/date-time";
```

Replace the header `<div>` (current lines 82–94) with:

```tsx
<div className="text-muted-foreground mb-1 flex items-center justify-between text-xs">
  <span className="flex items-center gap-2">
    <span className="text-foreground font-medium">
      {members.find((m) => m.userId === u.author_id)?.fullName ?? "Someone"}
    </span>
    <DateTime value={u.created_at} />
  </span>
  <button
    className="opacity-60 hover:opacity-100"
    onClick={() => onDelete(u.id)}
    aria-label="Delete update"
  >
    Delete
  </button>
</div>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/components/boards/item-panel/UpdatesTab.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/boards/item-panel/UpdatesTab.tsx src/components/boards/item-panel/UpdatesTab.test.tsx
git commit -m "feat(boards): show author + date/time on each item update"
```

---

## Task 13: RLS integration test — a user can set only their own timezone

**Files:**

- Create: `src/lib/profile/timezone.rls.integration.test.ts`

Mirror the structure/setup of the existing `src/lib/org/admin.rls.integration.test.ts` (same Supabase test client/harness, env guards, and per-test user provisioning). Read that file first and reuse its helpers for creating users and authenticated clients.

- [ ] **Step 1: Write the integration test**

Create `src/lib/profile/timezone.rls.integration.test.ts` following the existing harness. The two assertions:

```ts
// (Pseudocode shape — adapt to admin.rls.integration.test.ts's helpers.)
// 1. A user updates their OWN profile timezone → succeeds and persists.
//    const { error } = await userAClient
//      .from("profiles").update({ timezone: "Europe/Belgrade" }).eq("id", userA.id);
//    expect(error).toBeNull();
//    const { data } = await userAClient
//      .from("profiles").select("timezone").eq("id", userA.id).single();
//    expect(data?.timezone).toBe("Europe/Belgrade");
//
// 2. A user CANNOT change another user's timezone (RLS default-deny).
//    const { error, data: updated } = await userAClient
//      .from("profiles").update({ timezone: "Asia/Tokyo" })
//      .eq("id", userB.id).select();
//    // RLS makes the row invisible to the writer → no rows affected (or error).
//    expect(updated ?? []).toHaveLength(0);
//    const { data: bAfter } = await serviceClient
//      .from("profiles").select("timezone").eq("id", userB.id).single();
//    expect(bAfter?.timezone).not.toBe("Asia/Tokyo");
```

Use the real helper names and client factories from `admin.rls.integration.test.ts`. Keep the same `describe.skipIf(!hasEnv)` guard that file uses so the suite is skipped when integration env vars are absent.

- [ ] **Step 2: Run the integration test**

Run: `pnpm vitest run src/lib/profile/timezone.rls.integration.test.ts`
Expected: PASS when integration env is configured; SKIPPED otherwise (matching the existing admin RLS suite's behavior).

- [ ] **Step 3: Commit**

```bash
git add src/lib/profile/timezone.rls.integration.test.ts
git commit -m "test(profile): RLS — users can set only their own timezone"
```

---

## Task 14: Full verification

- [ ] **Step 1: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: PASS (no unused imports — e.g. confirm `cn` is still used in the org form).

- [ ] **Step 3: Test**

Run: `pnpm test`
Expected: PASS — all new tests plus the rewritten `timezone-form.test.tsx` and the unchanged `app-shell.test.tsx`.

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: PASS (production build).

- [ ] **Step 5: Manual smoke (optional but recommended)**

Use the `verify`/`run` skill to launch the app and confirm: (a) Settings → Preferences shows a searchable "Your timezone" picker that saves; (b) the org "Timezone" control is now the same searchable picker; (c) an item's Updates tab shows author name + a date/time for each update.

---

## Execution DAG

Dependencies (Task N → depends on):

- T1 (migration/types) → none
- T2 (Zod) → T1
- T3 (action) → T1, T2
- T4 (tz utils) → none
- T5 (formatDateTime) → none
- T6 (provider) → none
- T7 (`<DateTime>`) → T5, T6
- T8 (getUserTimeZone + layouts) → T1, T6
- T9 (TimezonePicker) → T4
- T10 (personal form + settings page) → T3, T8, T9
- T11 (org form refactor) → T9
- T12 (updates timestamp) → T7
- T13 (RLS integration test) → T1
- T14 (verification) → all

**Parallel batches** (each batch = one wave of concurrent agents):

- **Batch 1:** T1, T4, T5, T6 — no unmet deps.
- **Batch 2:** T2, T7, T9, T13 — (T2←T1; T7←T5,T6; T9←T4; T13←T1).
- **Batch 3:** T3, T8, T11 — (T3←T2; T8←T1,T6; T11←T9). T12 also unblocks here (T12←T7).
- **Batch 4:** T10 (←T3,T8,T9), T12 if not already done.
- **Batch 5:** T14 verification.

**Critical path:** T1 → T2 → T3 → T10 → T14 (five hops) — the wall-clock floor.

When dispatching a batch with ≥2 tasks, use `superpowers:dispatching-parallel-agents`; file-mutating parallel tasks get isolated **git worktrees** (`superpowers:using-git-worktrees`) per working agreement #1. Note T8, T10, and T11 all touch settings-area files but **different** files (T8: layouts; T10: page + new form; T11: org form) — safe to parallelize as scheduled.

```

```

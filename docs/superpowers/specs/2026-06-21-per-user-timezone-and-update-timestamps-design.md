# Per-user timezone + update timestamps — design

**Date:** 2026-06-21
**Status:** Approved (brainstorming) — ready for implementation plan

## Problem

Two user-reported issues:

1. **Update timestamps missing.** Each board item has an Updates section. Updates render the
   author's name but **not** the date/time the update was added. Users can't tell when an update
   happened.
2. **Timezone picker is unusable.** The Settings page timezone control lists ~418 raw IANA
   identifiers (`America/New_York`, underscores, no search, no offsets), so users can't easily
   "pick their location." It is also currently a single **org-wide** setting (admin-only), not a
   personal preference.

## Decisions (from brainstorming)

- **Per-user timezone**, stored as a personal preference — _in addition to_ the existing org-wide
  timezone (which is admin-only and keeps driving automation timing; it is left untouched).
- **Searchable picker with friendly labels** (e.g. "Belgrade — Central European Time (GMT+2)").
- **Absolute date + time** for update timestamps (e.g. "Jun 21, 2026, 3:45 PM"), matching the
  existing Activity tab style.
- **App-wide** date/time display via a single shared formatter/primitive, so all timestamps respect
  the user's timezone consistently.
- Personal timezone **defaults to "Automatic"** (use the viewer's device timezone). Nothing changes
  for any user until they explicitly choose a zone.

## Current state (verified by codebase exploration)

- **Updates UI:** `src/components/boards/item-panel/UpdatesTab.tsx` renders author name via a
  client-side member lookup (`members.find(m => m.userId === u.author_id)?.fullName ?? "Someone"`).
  It does **not** render a timestamp, although `created_at` is already fetched.
- **Updates data:** `item_updates` table (migration
  `20260617090000_collaboration_updates_activity.sql`) has `author_id` and `created_at`.
  `use-item-collab.ts` fetches all columns (`.select("*")`) — **no query change needed**.
- **Activity tab** (`ActivityRow.tsx`) already shows author + `new Date(when).toLocaleString()` —
  the pattern to mirror.
- **Timezone setting:** `src/app/settings/page.tsx` + `src/components/settings/timezone-form.tsx`.
  The list is generated from `Intl.supportedValuesOf("timeZone")` — already the correct IANA
  standard, just presented as raw identifiers in a plain `<select>` with no search/labels.
- **Org timezone storage:** `organizations.timezone` (text, default `'UTC'`). Server action
  `updateOrgTimezone` in `src/lib/org/actions.ts`; Zod + `isValidTimeZone()` in
  `src/lib/validations/org.ts`. Used **backend-only** by the automation date-sweep
  (`AT TIME ZONE` in `_automation_date_sweep`). Org timezone remains the source for automations.
- **Profiles:** `listOrgMembers` (`src/lib/boards/queries.ts`) reads `profiles` (`full_name`,
  `avatar_url`, `email`). No timezone column yet.

## Architecture

### 1. Data model

- Add `timezone text` (nullable) to `public.profiles`.
  - `null` = **Automatic** (resolve to the viewer's device timezone at render time).
  - Non-null = an explicit IANA id (e.g. `Europe/Belgrade`).
- RLS: users may update **their own** profile's timezone. Verify the existing profiles
  self-update policy; extend/add as needed so a user can write only their own row, and cannot set
  another user's timezone (covered by an RLS integration test).
- Versioned migration in `supabase/migrations/`; regenerate `src/types/database.types.ts`
  (`pnpm db:types`) and commit in the same change. The org `timezone` column is **not** modified.

### 2. Validation + Server Action

- New `updateProfileTimezoneSchema` (in `src/lib/validations/` — colocate with profile/org
  validations). Accepts a **valid IANA string** (reuse the existing `isValidTimeZone()` refine)
  **or** `null` (Automatic). Reject unknown zones and non-string/non-null values.
- New server action `updateProfileTimezone(timezone)` that updates the **caller's own** profile row
  (`supabase.auth.getUser()` → `update ... eq('id', user.id)`) and revalidates the relevant path.
  Mirrors `updateOrgTimezone`. RLS is the real boundary; the action never trusts a client-supplied
  user id.

### 3. Shared searchable timezone picker

- One reusable `TimezonePicker` component (shadcn **Command + Popover** combobox) used by **both**
  the new personal picker and the refactored org picker. Props: current value (`string | null`),
  `onChange`, and whether the "Automatic" option is offered (personal: yes; org: no).
- A pure label helper (`src/lib/datetime/` or `src/lib/timezone/`):
  `timezoneLabel(ianaId, referenceDate)` → `"Belgrade — Central European Time (GMT+2)"`.
  - City/region derived from the IANA id; offset + long name computed via `Intl.DateTimeFormat`
    with `timeZoneName` against a **passed-in `referenceDate`** (deterministic → testable; avoids
    `Date.now()` non-determinism in tests).
  - Searchable by city and region text.
- Top option in the personal picker: **"Automatic — use this device's timezone"** (stores `null`,
  previews the detected zone via `Intl.DateTimeFormat().resolvedOptions().timeZone`).

### 4. App-wide date/time formatting

- `formatDateTime(value, { timeZone, ... })` in `src/lib/datetime/` — thin wrapper over
  `Intl.DateTimeFormat` producing the absolute "Jun 21, 2026, 3:45 PM" style.
- A single client primitive `<DateTime value={...} />` is the **only** component that renders
  timestamps app-wide (it can be used as a leaf inside Server Components). It:
  - resolves the zone as **explicit profile tz → else device tz**;
  - uses `suppressHydrationWarning` on the rendered time element so "Automatic" (server fallback vs.
    client device zone) does not trigger a hydration mismatch.
- `TimeZoneProvider` at the app layout supplies the resolved zone from the **already-loaded**
  profile (no new query). `<DateTime>` reads it via `useTimeZone()`; when the profile tz is `null`
  the client resolves to the device zone.

### 5. Updates section

- In `UpdatesTab.tsx`, render `<DateTime value={u.created_at} />` (absolute date + time) next to
  the author name, styled like `ActivityRow`. Author name rendering is unchanged. No DB/query
  change. "(edited)" marker behavior is preserved.

### 6. Settings UI

- Add a **personal** "Your timezone" picker (available to every member) using `TimezonePicker` +
  the `updateProfileTimezone` action. Selection is client state until **Save** (which is a Server
  Action + targeted revalidation).
- Refactor the existing org `timezone-form.tsx` to use the same `TimezonePicker` (admins only).
  Behavior/storage for the org timezone is unchanged — only its UI is upgraded.

## Performance & data-fetching budget

- **Update timestamps:** 0 new server round-trips — `created_at` is already loaded with the
  updates query; rendering is pure client formatting.
- **Picker interaction:** typing/selecting in the combobox is **client state, 0 round-trips**. The
  IANA list is computed client-side from `Intl` (no fetch). **Save** changes server data → Server
  Action + targeted `revalidatePath`.
- **TimeZoneProvider:** resolves the zone from the profile already loaded in the layout — **no
  extra hot-path query**.
- No unbounded reads introduced. The ~418-entry list is static and filtered in-memory by `cmdk`;
  virtualization is unnecessary.

## Testing

Written and executed before "done" (`pnpm typecheck && lint && test && build`):

- **Zod:** `updateProfileTimezoneSchema` accepts a valid IANA string and `null`; rejects unknown
  zones (`"Mars/Olympus_Mons"`), empty string, and non-string/non-null.
- **Label helper:** `timezoneLabel("Europe/Belgrade", fixedRefDate)` yields the expected
  city/long-name/offset; offsets asserted against a fixed reference date (DST-stable cases).
- **`formatDateTime`:** given an explicit zone, formats deterministically; falls back to device
  zone when none provided.
- **`UpdatesTab`:** renders the author name **and** a formatted timestamp for an update.
- **RLS integration test:** a user can set **their own** profile timezone and **cannot** set
  another user's (default-deny upheld).

## Execution DAG

Tasks (independent units → batches):

- **A.** Migration: add `profiles.timezone` + RLS self-update policy + regenerate types.
- **B.** Zod schema + `updateProfileTimezone` server action. _(needs A: types)_
- **C.** `TimezonePicker` component + `timezoneLabel` helper. _(independent — pure UI/util)_
- **D.** `formatDateTime` + `<DateTime>` primitive + `TimeZoneProvider`. The formatter/util is
  independent; the provider wiring reads the profile tz. _(provider wiring needs A)_
- **E.** Settings UI: personal timezone form + refactor org form to `TimezonePicker`. _(needs B, C)_
- **F.** Updates timestamp in `UpdatesTab`. _(needs D)_
- **G.** Tests + verification across all of the above. _(needs A–F)_

**Parallel batches:**

- **Batch 1 (parallel):** A, C, and the pure `formatDateTime`/label utilities of D.
- **Batch 2 (parallel):** B, and the `TimeZoneProvider` wiring of D.
- **Batch 3 (parallel):** E, F.
- **Batch 4:** G (verification).

**Critical path:** A → B → E (≈ equal to A → D-provider → F). Three dependency hops — the
wall-clock floor. Batch-1 tasks dispatch as concurrent agents; file-mutating parallel tasks use
isolated git worktrees per working agreement #1.

## Out of scope (YAGNI)

- Avatars in the updates list (only name + timestamp were requested).
- Relative "2 hours ago" timestamps (absolute chosen).
- Changing how the org timezone drives automations.
- Per-board or per-org-member timezone overrides beyond the single personal preference.

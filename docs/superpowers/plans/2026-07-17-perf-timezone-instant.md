# Perf Tier-3 Task A — Stream the User's Timezone So Timestamps Never Blank — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`
> (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Each task is TDD: write the failing test first, then the
> change.

**Goal:** Make every `<DateTime>` timestamp paint a correct, human-readable value on first paint
instead of blanking (empty `<time>`) until the streamed profile-timezone promise resolves — without
a wrong-timezone flash and without touching the instant-nav / `useSearchParams` architecture that
gotcha-48 blocks.

**Architecture:** The streaming-shell work (PF Task D3) already threads the user's personal timezone
into the client as an _unawaited promise_, and today `DateTime` **suspends** on it behind an empty
`<time>` fallback — so timestamps blank-then-fill on every hard load. This plan replaces that
suspend-and-blank with a **device-zone-first, reconcile-on-explicit-override** render: the client
knows the device zone synchronously, and for the large "Automatic" majority (personal
`profiles.timezone` is `null`) the device zone _is_ the correct answer, so no server value is ever
needed. A tiny device-timezone **cookie** lets the server render the correct zone into the _streamed
HTML_ for returning visitors (true never-blank), and the streamed personal-timezone promise still
flows through — a client-side, non-suspending reconciliation swaps to an explicit personal zone only
when it differs from the device zone. No new server round-trips, no `unstable_instant`, no new
`useSearchParams`.

**Tech Stack:** Next.js 16 (App Router, Cache Components/PPR streaming, async `cookies()`), React 19
(`use()` is _removed_ from this path in favor of a non-suspending accessor; `useEffect`/`useState`
for reconciliation), TypeScript strict, `Intl.DateTimeFormat`, Vitest + @testing-library/react.

---

## Why this dodges gotcha-48 (read before building)

`vault/decisions/2026-07-04-gotcha-48-unstable-instant-blocked-by-shell-searchparams.md` records that
the _naive_ reading of "Task A" — make `(app)` routes instant via `unstable_instant` /
`{ prefetch: "static" }` — is **architecturally blocked**: the persistent shell reads
`useSearchParams()` pervasively (that's how the gotcha-09 0-refetch view/tab switching works), and
pervasive `useSearchParams()` fails Next 16's instant-nav build validation. **This plan does not
pursue instant nav at all.** It never adds `unstable_instant`, never flips the `false` flags in
`src/app/(app)/layout.tsx` or `src/app/admin/layout.tsx`, and never adds a `useSearchParams()` read.
It is a purely client-side render-timing change in the `DateTime` primitive plus a device-zone
cookie — orthogonal to the instant-nav architecture, so it **cannot regress gotcha-48 or gotcha-09**.
The "stream the timezone so content never blanks" goal is met by _rendering immediately in a
known-good zone_, not by making routes prefetch-static.

## Approaches considered

1. **Device-zone-first, cookie-seeded (CHOSEN).** `DateTime` renders immediately in the device zone
   (synchronous on the client; server-seeded from a `pulse_tz` cookie for returning visitors) and
   reconciles to an explicit personal zone client-side only when the streamed promise resolves to a
   non-null string that differs. For Automatic users (the majority) the device zone is _correct_ —
   zero server dependency, zero correction. Only a user whose explicit personal zone differs from
   their device zone ever sees a (graceful, text-only) correction, never a blank.
   - Trade-off: needs a one-time client cookie write + a server cookie read (cheap; the shell is
     already cookie-dynamic). A truly first-ever visitor (no cookie yet) still fills at hydration —
     the theoretical floor, since the server cannot know a new device's zone.

2. **Pure-client device-zone, no cookie (rejected as insufficient alone).** Simpler, but a client
   component still server-renders into the streamed HTML; with no cookie the server has no device
   zone, so the streamed HTML would either blank (unchanged pain) or commit the server zone (UTC)
   and flash. Kills the DB-round-trip blank but not the SSR blank/flash — so it does not meet
   "never blanks on first paint" on its own. It is the _subset_ of Approach 1 without the cookie.

3. **Server-default-zone Suspense fallback (org / UTC) (rejected).** Render the fallback in the org
   timezone instead of empty. Requires `await`-ing the org zone in the shell (reintroduces the
   blocking read that PF D3 deliberately removed) or flashing UTC; and it is _wrong_ for Automatic
   users who want their device zone, not the org zone. Higher flash risk, more coupling, worse
   default. Not pursued.

## Current state (verified on this worktree)

- `src/components/datetime/date-time.tsx` — `DateTime` wraps `<Suspense fallback={<time dateTime={iso} />}>`
  (empty, no visible text) around `ResolvedDateTime`, which calls `useTimeZone()` → `use(promise)`
  and **suspends** until the shell's personal-timezone promise resolves. This is the blank-then-fill.
- `src/lib/datetime/timezone-context.tsx` — `TimeZoneProvider({ timeZone: string | null | Promise<…> })`
  and `useTimeZone(): string | null` (suspends via `use()`). **Grep confirms `useTimeZone` /
  `timezone-context` are imported only by `date-time.tsx` and the test file** — replacing the hook
  is safe.
- `src/components/shell/authenticated-shell.tsx` — a **Server Component** that already reads cookies
  (via `getUser()`), resolves the personal timezone as an unawaited promise, and wraps children in
  `<TimeZoneProvider timeZone={resolveUserTimeZone()}>`.
- `src/lib/datetime/timezone.ts` — `detectDeviceTimeZone(): string` (synchronous, `Intl`-based,
  UTC-safe fallback) already exists and is used by `timezone-picker.tsx`.
- `src/lib/datetime/format.ts` — `formatDateTime` calls `Intl.DateTimeFormat(undefined, …)` with an
  **unpinned locale**, which risks the gotcha-50 locale-driven SSR/client mismatch (Node `en-US`
  vs. browser locale) once we render the human text on both server and client.
- `DateTime` consumers (blank surface today): `boards/item-panel/UpdatesTab.tsx`,
  `boards/cells/created.tsx`, `boards/automations/RecentRuns.tsx`, `boards/trash/BoardTrashDialog.tsx`,
  `boards/ArchivedBoardsSection.tsx`.

## File Structure

- **Create** `src/lib/datetime/device-timezone.tsx` — client `DeviceTimeZoneProvider` +
  `useDeviceTimeZone()` + `DEVICE_TZ_COOKIE` constant. One responsibility: expose a device zone that
  is server-seeded from a cookie and client-corrected on mount, and persist the cookie.
- **Modify** `src/lib/datetime/format.ts` — pin the format locale (gotcha-50).
- **Modify** `src/lib/datetime/timezone-context.tsx` — replace the suspending `useTimeZone()` with a
  non-suspending `useResolvedTimeZone(deviceZone)`; keep `TimeZoneProvider` unchanged.
- **Modify** `src/components/datetime/date-time.tsx` — render immediately in the resolved zone; drop
  the `<Suspense>` + `use()` blank path.
- **Modify** `src/components/shell/authenticated-shell.tsx` — read the `pulse_tz` cookie server-side
  and wrap children in `<DeviceTimeZoneProvider initial={…}>` (inside, or around, the existing
  `TimeZoneProvider`).
- **Create/Modify tests:** `src/lib/datetime/device-timezone.test.tsx`,
  `src/lib/datetime/format.test.ts` (extend), `src/lib/datetime/timezone-context.test.tsx` (extend),
  `src/components/datetime/date-time.test.tsx` (create).

## Global Constraints

- **This is NOT the Next.js in your training data.** Re-read the relevant `node_modules/next/dist/docs/`
  guide (streaming, `cacheComponents`, async `cookies()`) before touching any Next API.
- **Do NOT enable `unstable_instant` or add any `useSearchParams()` read** — gotcha-48 / gotcha-09.
  The two `unstable_instant = false` flags stay `false` and untouched.
- **0 new server round-trips.** No new DB reads; the personal-timezone read is the _existing_ shell
  read. The added `cookies()` read is on an already-cookie-dynamic layout — no new round-trip.
- **Bounded/indexed reads unchanged.** This is display-only; `getUserTimeZoneCached` (single
  `id = userId` indexed read) is untouched.
- **pulse-ui tokens** for any visual output — but there is no new visible chrome here (only `<time>`
  text), so no new tokens are introduced. Load the `pulse-ui` skill only if a skeleton is added.
- **Never flash a wrong zone.** The empty-fallback design exists to prevent a wrong-timezone flash;
  the replacement must preserve that guarantee (device zone is correct for Automatic users; explicit
  reconciliation is text-only and rare).
- **Tests written AND executed.** A task is done only when
  `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass.
- **Commit hygiene:** stage **by path**, never `git add -A`. Author identity is pinned by
  `start-task.sh` (`Danijel Jovanovic <info@synapse-solutions.ai>`). Lowercase conventional subject
  after `type(scope):`, descriptive body + `Co-Authored-By` trailer.

---

### Task 1: Pin the format locale (gotcha-50 guard)

Rendering the human timestamp text on **both** server and client (Tasks 3–4) reintroduces the
gotcha-50 trap: `Intl.DateTimeFormat(undefined, …)` uses Node's `en-US` on the server and the
browser's locale on the client, so the _string_ can differ (`Jan 1` vs `1 Jan`) even when the zone
is identical — a hydration mismatch / flash independent of timezone. Pin the locale so server and
client agree.

**Files:**

- Modify: `src/lib/datetime/format.ts`
- Test: `src/lib/datetime/format.test.ts` (extend)

**Interfaces:**

- Consumes: nothing.
- Produces: `formatDateTime(value, { timeZone?: string }): string` — unchanged signature, now
  deterministic across runtimes (fixed `"en-US"` locale). Tasks 3–4 rely on this determinism.

- [ ] **Step 1: Write the failing test** — append to `src/lib/datetime/format.test.ts`:

```ts
it("formats with a pinned locale (deterministic order, not runtime-default)", () => {
  // en-US medium date renders "Mon DD, YYYY" — assert the month-first shape so a
  // runtime whose default locale is day-first can't drift the string.
  const out = formatDateTime("2026-06-21T15:45:00Z", { timeZone: "UTC" });
  expect(out).toMatch(/^Jun 21, 2026/);
});
```

- [ ] **Step 2: Run test to verify it fails** (if the local runtime default is already en-US it may
      pass — that is the point of pinning; the test locks the behavior regardless of runtime):

Run: `pnpm vitest run src/lib/datetime/format.test.ts`
Expected: PASS or FAIL depending on the runtime's default locale; either way it must PASS after Step 3.

- [ ] **Step 3: Pin the locale** in `src/lib/datetime/format.ts`:

```ts
/**
 * Absolute date + time, e.g. "Jun 21, 2026, 3:45 PM". Locale is PINNED to
 * "en-US" so the rendered string is identical on the server (Node) and in the
 * browser — otherwise a locale-driven order difference (gotcha-50) flashes on
 * hydration even when the timezone matches. `timeZone` undefined → the runtime's
 * default zone (the viewer's device zone in the browser).
 */
export function formatDateTime(
  value: string | number | Date,
  opts: { timeZone?: string } = {},
): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: opts.timeZone,
  }).format(date);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/datetime/format.test.ts`
Expected: PASS (all format tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/datetime/format.ts src/lib/datetime/format.test.ts
git commit -m "fix(datetime): pin formatdatetime locale to en-us" \
  -m "Rendering the human timestamp on both server and client reintroduces the gotcha-50 locale-mismatch flash (Node en-US vs browser locale) even when the timezone agrees. Pin the Intl locale to en-US so the string is byte-identical across runtimes." \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Device-timezone cookie provider

Give the server a correct device zone for the **streamed HTML** of returning visitors, and give the
client a synchronous device zone. The cookie is written once (and refreshed on drift) by a mount
effect; the server reads it. This is what makes the render _truly never blank_ for anyone who has
loaded the app before.

**Files:**

- Create: `src/lib/datetime/device-timezone.tsx`
- Test: `src/lib/datetime/device-timezone.test.tsx`

**Interfaces:**

- Consumes: `detectDeviceTimeZone` from `@/lib/datetime/timezone`.
- Produces:
  - `DEVICE_TZ_COOKIE = "pulse_tz"` (string constant; the server reads this name).
  - `DeviceTimeZoneProvider({ initial, children }: { initial: string | null; children: ReactNode })`
    — client component. Holds the device zone in state, seeded from `initial` (the server-read
    cookie). On mount, computes `detectDeviceTimeZone()`, updates state, and writes/refreshes the
    `pulse_tz` cookie if it drifted from `initial`.
  - `useDeviceTimeZone(): string | null` — returns the current device zone (`initial` during SSR /
    pre-mount, then the client-detected zone). `null` means "unknown" (first-ever visit, pre-mount).

- [ ] **Step 1: Write the failing test** — `src/lib/datetime/device-timezone.test.tsx`:

```tsx
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEVICE_TZ_COOKIE,
  DeviceTimeZoneProvider,
  useDeviceTimeZone,
} from "./device-timezone";

vi.mock("@/lib/datetime/timezone", () => ({
  detectDeviceTimeZone: () => "Asia/Kuwait",
}));

function Probe() {
  return <span>zone:{useDeviceTimeZone() ?? "unknown"}</span>;
}

describe("DeviceTimeZoneProvider", () => {
  beforeEach(() => {
    // jsdom cookie is a plain string jar we can read/reset.
    document.cookie = `${DEVICE_TZ_COOKIE}=; path=/; max-age=0`;
  });
  afterEach(() => vi.restoreAllMocks());

  it("serves the server-seeded initial zone, then the client-detected zone after mount", async () => {
    await act(async () => {
      render(
        <DeviceTimeZoneProvider initial="Europe/Belgrade">
          <Probe />
        </DeviceTimeZoneProvider>,
      );
    });
    // After mount the client detection wins.
    expect(screen.getByText("zone:Asia/Kuwait")).toBeInTheDocument();
  });

  it("writes the cookie when the detected zone drifts from the seed", async () => {
    await act(async () => {
      render(
        <DeviceTimeZoneProvider initial="Europe/Belgrade">
          <Probe />
        </DeviceTimeZoneProvider>,
      );
    });
    expect(document.cookie).toContain(`${DEVICE_TZ_COOKIE}=Asia%2FKuwait`);
  });

  it("exposes null when there is no seed and detection has not run (SSR shape)", () => {
    // A render with no provider returns the context default (null).
    render(<Probe />);
    expect(screen.getByText("zone:unknown")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/datetime/device-timezone.test.tsx`
Expected: FAIL ("Cannot find module './device-timezone'").

- [ ] **Step 3: Implement `src/lib/datetime/device-timezone.tsx`:**

```tsx
"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { detectDeviceTimeZone } from "@/lib/datetime/timezone";

/** Cookie the server reads to seed the device zone into streamed HTML. */
export const DEVICE_TZ_COOKIE = "pulse_tz";

/** null = device zone not yet known (first-ever visit, pre-mount). */
const DeviceTimeZoneContext = createContext<string | null>(null);

/**
 * Seeds the device zone from a server-read cookie (`initial`) so returning
 * visitors get correct timestamps in the FIRST streamed HTML — no blank, no
 * flash. On mount it computes the real device zone, publishes it, and refreshes
 * the cookie if it drifted (moved laptop, changed OS zone). No server round-trip.
 */
export function DeviceTimeZoneProvider({
  initial,
  children,
}: {
  initial: string | null;
  children: ReactNode;
}) {
  const [zone, setZone] = useState<string | null>(initial);
  useEffect(() => {
    const detected = detectDeviceTimeZone();
    setZone(detected);
    if (detected && detected !== initial) {
      document.cookie = `${DEVICE_TZ_COOKIE}=${encodeURIComponent(
        detected,
      )}; path=/; max-age=31536000; samesite=lax`;
    }
  }, [initial]);
  return (
    <DeviceTimeZoneContext.Provider value={zone}>
      {children}
    </DeviceTimeZoneContext.Provider>
  );
}

/** The current device zone, or null if not yet known. Never suspends. */
export function useDeviceTimeZone(): string | null {
  return useContext(DeviceTimeZoneContext);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/datetime/device-timezone.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/datetime/device-timezone.tsx src/lib/datetime/device-timezone.test.tsx
git commit -m "feat(datetime): add device-timezone cookie provider" \
  -m "A client provider that seeds the device zone from a server-read pulse_tz cookie (so returning visitors get correct timestamps in the first streamed HTML) and refreshes the cookie on drift. Exposes useDeviceTimeZone(); never suspends; no server round-trip." \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Non-suspending `useResolvedTimeZone` accessor

Replace the suspending `useTimeZone()` with a hook that returns the best-known zone _immediately_:
the explicit personal zone once the streamed promise resolves, otherwise the device zone — never
suspending, never blanking.

**Files:**

- Modify: `src/lib/datetime/timezone-context.tsx`
- Test: `src/lib/datetime/timezone-context.test.tsx` (extend)

**Interfaces:**

- Consumes: the `TimeZoneContext` value `string | null | Promise<string | null>` (from the existing
  `TimeZoneProvider`, unchanged); `useDeviceTimeZone` is **not** consumed here — the device zone is
  passed in as an argument by the caller (Task 4) to keep this hook pure/testable.
- Produces: `useResolvedTimeZone(deviceZone: string | null): string | null` — returns the explicit
  personal IANA zone when the context has resolved to a non-null string; otherwise `deviceZone`
  (Automatic case); `null` only when both are unknown. Never suspends. `TimeZoneProvider` and its
  props are unchanged. `useTimeZone` is **removed** (single consumer migrates in Task 4).

- [ ] **Step 1: Write the failing test** — append to `src/lib/datetime/timezone-context.test.tsx`:

```tsx
import { useResolvedTimeZone } from "./timezone-context";

function Resolved({ device }: { device: string | null }) {
  return <span>tz:{useResolvedTimeZone(device) ?? "none"}</span>;
}

describe("useResolvedTimeZone (non-suspending)", () => {
  it("returns the device zone when the context is null (Automatic)", () => {
    render(
      <TimeZoneProvider timeZone={null}>
        <Resolved device="Asia/Kuwait" />
      </TimeZoneProvider>,
    );
    expect(screen.getByText("tz:Asia/Kuwait")).toBeInTheDocument();
  });

  it("returns an explicit resolved string over the device zone", () => {
    render(
      <TimeZoneProvider timeZone="Europe/Belgrade">
        <Resolved device="Asia/Kuwait" />
      </TimeZoneProvider>,
    );
    expect(screen.getByText("tz:Europe/Belgrade")).toBeInTheDocument();
  });

  it("returns the device zone while a promise is pending, then the explicit zone", async () => {
    let resolve!: (v: string | null) => void;
    const pending = new Promise<string | null>((r) => (resolve = r));
    await act(async () => {
      render(
        <TimeZoneProvider timeZone={pending}>
          <Resolved device="Asia/Kuwait" />
        </TimeZoneProvider>,
      );
    });
    // No suspense, no blank: the device zone shows immediately.
    expect(screen.getByText("tz:Asia/Kuwait")).toBeInTheDocument();
    await act(async () => {
      resolve("America/New_York");
      await pending;
    });
    expect(screen.getByText("tz:America/New_York")).toBeInTheDocument();
  });

  it("keeps the device zone when a promise resolves to null (Automatic)", async () => {
    let resolve!: (v: string | null) => void;
    const pending = new Promise<string | null>((r) => (resolve = r));
    await act(async () => {
      render(
        <TimeZoneProvider timeZone={pending}>
          <Resolved device="Asia/Kuwait" />
        </TimeZoneProvider>,
      );
    });
    await act(async () => {
      resolve(null);
      await pending;
    });
    expect(screen.getByText("tz:Asia/Kuwait")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/datetime/timezone-context.test.tsx`
Expected: FAIL ("useResolvedTimeZone is not exported" / not a function).

- [ ] **Step 3: Implement** — replace the body of `src/lib/datetime/timezone-context.tsx` below
      `TimeZoneProvider` (keep the provider and `TimeZoneValue` type as-is; remove `useTimeZone` and
      the `use` import):

```tsx
"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

/** The user's zone as an IANA id, or null = Automatic. It may still be an
 * unresolved promise streamed from the shell (the timezone read is not awaited
 * before content paints). */
type TimeZoneValue = string | null | Promise<string | null>;
const TimeZoneContext = createContext<TimeZoneValue>(null);

export function TimeZoneProvider({
  timeZone,
  children,
}: {
  timeZone: TimeZoneValue;
  children: ReactNode;
}) {
  return (
    <TimeZoneContext.Provider value={timeZone}>
      {children}
    </TimeZoneContext.Provider>
  );
}

/**
 * The zone to display an absolute timestamp in, resolved WITHOUT suspending:
 *   - an explicit personal zone (`profiles.timezone`) once the streamed promise
 *     resolves to a non-null string — this overrides the device zone;
 *   - otherwise `deviceZone` (the Automatic case — the device zone is what the
 *     user wants when they haven't pinned a zone).
 * Returns `null` only when both are unknown (first-ever visit, pre-mount, no
 * cookie) — the caller renders machine-readable-only text in that single case.
 * Never blanks, never flashes a wrong zone for Automatic users, and only ever
 * corrects device→explicit (rare: an explicit zone different from the device).
 */
export function useResolvedTimeZone(deviceZone: string | null): string | null {
  const v = useContext(TimeZoneContext);
  const [explicit, setExplicit] = useState<string | null>(
    typeof v === "string" ? v : null,
  );
  useEffect(() => {
    if (typeof v === "string") {
      setExplicit(v);
      return;
    }
    if (v && typeof v === "object" && "then" in v) {
      let live = true;
      void v.then((z) => {
        if (live && typeof z === "string") setExplicit(z);
      });
      return () => {
        live = false;
      };
    }
    // v === null → Automatic: keep the device zone, clear any stale explicit.
    setExplicit(null);
  }, [v]);
  return explicit ?? deviceZone;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/datetime/timezone-context.test.tsx`
Expected: PASS (existing provider tests + the 4 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/datetime/timezone-context.tsx src/lib/datetime/timezone-context.test.tsx
git commit -m "feat(datetime): add non-suspending useresolvedtimezone accessor" \
  -m "Replaces the suspending useTimeZone() with a hook that returns the best-known display zone immediately: the explicit personal zone once the streamed promise resolves, else the passed-in device zone. Never suspends, so timestamps stop blanking." \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Render `DateTime` immediately (drop the blank Suspense path) + wire the shell

Make `DateTime` paint the human text on first paint, and seed the device zone from the cookie in the
shell so returning visitors never see even a streamed-HTML blank.

**Files:**

- Modify: `src/components/datetime/date-time.tsx`
- Modify: `src/components/shell/authenticated-shell.tsx`
- Test: `src/components/datetime/date-time.test.tsx` (create)

**Interfaces:**

- Consumes: `useResolvedTimeZone` (Task 3), `useDeviceTimeZone` + `DeviceTimeZoneProvider` +
  `DEVICE_TZ_COOKIE` (Task 2), `formatDateTime` (Task 1), `cookies()` from `next/headers`.
- Produces: `DateTime({ value, className })` — renders `<time dateTime={iso}>` with the formatted
  text present on first paint whenever a zone is known (device zone for returning/Automatic users,
  explicit zone after reconciliation); empty text ONLY on a first-ever visit with no cookie
  (pre-mount), filled at hydration. No `<Suspense>`, no `use()`.

- [ ] **Step 1: Write the failing test** — `src/components/datetime/date-time.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DateTime } from "./date-time";
import { DeviceTimeZoneProvider } from "@/lib/datetime/device-timezone";
import { TimeZoneProvider } from "@/lib/datetime/timezone-context";

const ISO = "2026-06-21T02:00:00Z"; // 2am UTC → still Jun 20 in the Americas

describe("DateTime", () => {
  it("renders the timestamp immediately in the seeded device zone (no blank)", () => {
    render(
      <DeviceTimeZoneProvider initial="America/New_York">
        <TimeZoneProvider timeZone={null}>
          <DateTime value={ISO} />
        </TimeZoneProvider>
      </DeviceTimeZoneProvider>,
    );
    const el = screen.getByRole("time");
    // New York is UTC-4 in June → 2am UTC is 10pm on Jun 20.
    expect(el).toHaveTextContent(/Jun 20, 2026/);
    expect(el).toHaveAttribute("dateTime", new Date(ISO).toISOString());
  });

  it("prefers an explicit personal zone over the device zone", () => {
    render(
      <DeviceTimeZoneProvider initial="America/New_York">
        <TimeZoneProvider timeZone="Asia/Tokyo">
          <DateTime value={ISO} />
        </TimeZoneProvider>
      </DeviceTimeZoneProvider>,
    );
    // Tokyo is UTC+9 → 2am UTC is 11am on Jun 21.
    expect(screen.getByRole("time")).toHaveTextContent(/Jun 21, 2026/);
  });

  it("renders machine-readable-only when no zone is known (first-ever visit)", () => {
    render(
      <TimeZoneProvider timeZone={null}>
        <DateTime value={ISO} />
      </TimeZoneProvider>,
    );
    const el = screen.getByRole("time");
    expect(el).toHaveAttribute("dateTime", new Date(ISO).toISOString());
    expect(el).toHaveTextContent(""); // no human text, but not absent
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/datetime/date-time.test.tsx`
Expected: FAIL (current `DateTime` suspends behind an empty `<time>` and imports `useTimeZone`).

- [ ] **Step 3: Rewrite `src/components/datetime/date-time.tsx`:**

```tsx
"use client";

import { useResolvedTimeZone } from "@/lib/datetime/timezone-context";
import { useDeviceTimeZone } from "@/lib/datetime/device-timezone";
import { formatDateTime } from "@/lib/datetime/format";

/**
 * The single app-wide primitive for rendering an absolute timestamp. It paints
 * a correct, human-readable value on FIRST paint — the device zone (Automatic,
 * the majority) or the explicit personal zone once the streamed promise
 * resolves — instead of blanking. `suppressHydrationWarning` because the seeded
 * cookie zone and the client-detected zone can differ by a text swap (never a
 * layout jump); the `dateTime` attr is always the stable machine-readable ISO.
 * The only blank is a first-ever visit with no cookie, filled at hydration.
 */
export function DateTime({
  value,
  className,
}: {
  value: string | number | Date;
  className?: string;
}) {
  const date = value instanceof Date ? value : new Date(value);
  const iso = date.toISOString();
  const deviceZone = useDeviceTimeZone();
  const zone = useResolvedTimeZone(deviceZone);
  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {zone ? formatDateTime(date, { timeZone: zone }) : ""}
    </time>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/datetime/date-time.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire the shell** — in `src/components/shell/authenticated-shell.tsx` read the cookie
      server-side and wrap children in `DeviceTimeZoneProvider`. Add the imports:

```tsx
import { cookies } from "next/headers";
import {
  DEVICE_TZ_COOKIE,
  DeviceTimeZoneProvider,
} from "@/lib/datetime/device-timezone";
```

Make `AuthenticatedShell` async (it is a Server Component) and read the cookie, then nest the
providers so `DateTime` sees both:

```tsx
export async function AuthenticatedShell({
  children,
}: {
  children: ReactNode;
}) {
  const deviceZone = (await cookies()).get(DEVICE_TZ_COOKIE)?.value ?? null;
  return (
    <AppShell
      sidebarNav={/* …unchanged… */}
      mobileNav={/* …unchanged… */}
      headerUser={/* …unchanged… */}
      commandPalette={/* …unchanged… */}
    >
      <DeviceTimeZoneProvider initial={deviceZone}>
        <TimeZoneProvider timeZone={resolveUserTimeZone()}>
          {children}
        </TimeZoneProvider>
      </DeviceTimeZoneProvider>
    </AppShell>
  );
}
```

> Note: `AuthenticatedShell` is already rendered inside the cookie-dynamic `(app)` and `admin`
> layouts, so `await cookies()` adds no new dynamic boundary. Keep the four Suspense slots exactly as
> they are. If `pnpm build` flags the `cookies()` read, re-read `node_modules/next/dist/docs` on
> `cookies()` + `cacheComponents` before deviating — do **not** award-suspend the whole shell.

- [ ] **Step 6: Verify `useTimeZone` is fully retired**

Run: `grep -rn "useTimeZone\b" src`
Expected: no matches (only `useResolvedTimeZone` / `useDeviceTimeZone` remain). If any consumer
other than the migrated `date-time.tsx` shows up, migrate it the same way (pass `useDeviceTimeZone()`
into `useResolvedTimeZone`).

- [ ] **Step 7: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run src/lib/datetime src/components/datetime && pnpm build`
Expected: all green. `pnpm build` must not flag the streamed promise or the `cookies()` read.

- [ ] **Step 8: Commit**

```bash
git add src/components/datetime/date-time.tsx src/components/datetime/date-time.test.tsx src/components/shell/authenticated-shell.tsx
git commit -m "feat(datetime): paint timestamps immediately instead of blanking" \
  -m "DateTime now renders the human text on first paint using the device zone (Automatic majority) or the explicit personal zone once the streamed promise resolves, dropping the empty-time Suspense fallback. The shell seeds the device zone from the pulse_tz cookie so returning visitors get correct timestamps in the first streamed HTML. No unstable_instant, no useSearchParams, no new server reads." \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Performance & data-fetching budget (AGENTS.md #5)

- **First paint (hard load):** returning visitors — the server reads the `pulse_tz` cookie and
  renders every `DateTime` into the streamed HTML in the correct device zone: **0 blank, 0 flash**.
  First-ever visitors (no cookie) get machine-readable-only text that fills at **hydration** (bounded
  by client JS, not by any DB round-trip) — strictly faster than today's profile-read-bounded blank.
- **Streamed data:** the personal-timezone value still arrives via the **existing** unawaited shell
  promise (`resolveUserTimeZone()` → `getUserTimeZoneCached`). **No new server read is added.** The
  `await cookies()` is on the already-cookie-dynamic shell — no new round-trip.
- **In-page interactions (view/tab/filter/sort toggles):** **0 new server round-trips.** This change
  adds no `useSearchParams` read and no `<Link>`/router navigation; the gotcha-09 0-refetch model is
  untouched. Reconciliation device→explicit is a client-only text swap that happens at most once per
  load, never per interaction.
- **Bounded/indexed reads:** unchanged. `getUserTimeZoneCached` is a single `id = userId` indexed,
  `use cache`-tagged read. No growing-table `select *` is introduced.
- **gotcha-48 / instant-nav:** untouched — `unstable_instant` stays `false` on both layouts; no
  prefetch-static validation is attempted.

## Execution DAG (AGENTS.md #6)

**Dependency edges** (from the Interfaces blocks):

- Task 1 (format locale): no deps. Produces deterministic `formatDateTime`.
- Task 2 (device-timezone provider): no deps. Produces `useDeviceTimeZone` / `DeviceTimeZoneProvider`
  / `DEVICE_TZ_COOKIE`.
- Task 3 (`useResolvedTimeZone`): no deps. Produces the non-suspending accessor.
- Task 4 (DateTime + shell): **depends on Tasks 1, 2, 3** (imports all three).

```
1 ─┐
2 ─┼─▶ 4
3 ─┘
```

**Parallel batches:**

- **Batch 1 (parallel-capable): Tasks 1, 2, 3.** Disjoint files (`format.ts` / `device-timezone.tsx`
  / `timezone-context.tsx`), no shared state — safe to run concurrently.
- **Batch 2: Task 4.** Runs only after 1–3 land (it imports all three).

**Critical path:** `max(1, 2, 3) → 4` = two waves. **Realistic execution:** this is a small,
single-worktree change (this `perf-timezone-instant` worktree); doing Tasks 1→2→3→4 sequentially in
one session is entirely reasonable — the DAG documents that 1/2/3 _may_ be parallelized (e.g. via
`superpowers:subagent-driven-development` with three subagents) but the coordination cost outweighs
the wall-clock saving for four ~5-minute tasks. Do **not** spin up separate git worktrees for tasks
this small; keep them in this one worktree.

## Manual test guide (observe the blank-then-fill is gone)

Setup: pull `develop` (after merge), run the dev server, sign in. Use a surface with visible
timestamps — the **item panel Updates tab** (`UpdatesTab`), a board's **Created** column
(`created.tsx`), or **Automations → recent runs** (`RecentRuns`).

1. **Returning-visitor never-blank (primary):** Load any authenticated page once (this sets the
   `pulse_tz` cookie — confirm in DevTools → Application → Cookies that `pulse_tz` = your IANA zone,
   e.g. `Asia/Kuwait`). Now hard-refresh a page with timestamps (⌘/Ctrl-Shift-R). **Expected:** every
   timestamp shows a real date/time from the _first_ painted frame — no empty gap that fills a beat
   later. (Throttle the network to "Slow 3G" in DevTools to make any residual blank obvious; there should be
   none.)
2. **Automatic user correctness:** With personal timezone left as **Automatic** (Settings → the
   timezone card shows "Automatic — <your zone>"), confirm the displayed times match your device
   clock. There is no server dependency for this case.
3. **Explicit-zone reconciliation (graceful, not a blank):** In Settings, set your personal timezone
   to a zone **different from your device** (e.g. device in Kuwait, set `America/New_York`). Reload.
   **Expected:** timestamps appear immediately (device zone) and, at most, do a single text swap to
   the explicit zone — never a blank, never a layout jump. For the common case (explicit zone ==
   device zone) there is no visible change at all.
4. **First-ever visitor floor:** In an Incognito window, sign in and load a timestamped page.
   **Expected:** the one-time exception — human text may be absent for the pre-hydration instant then
   fill; the `<time>` element and its `dateTime` ISO attribute are always present (inspect the DOM).
   Subsequent loads (cookie now set) behave like step 1.
5. **No instant-nav / view-switch regression:** On a board, toggle views/tabs/filters — no full-page
   refetch, no timestamp re-blank (gotcha-09 / gotcha-48 intact).

If any step shows a blank-then-fill for a _returning_ visitor, the cookie seeding (Task 2/4) is not
wired — re-check the `cookies()` read in `authenticated-shell.tsx` and that `DeviceTimeZoneProvider`
wraps `children`.

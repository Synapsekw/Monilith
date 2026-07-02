# Robustness & Error-Surfacing Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every failure visible — branded error/not-found pages for server throws, toasts for silent mutation rollbacks, logs for dropped notification inserts, explicit membership checks on board delete/duplicate, and loud failures for board-payload read errors.

**Architecture:** Two shared fallback components feed thin `error.tsx`/`not-found.tsx` route files (Next 16 conventions, verified against `node_modules/next/dist/docs/`). A `sonner` toaster mounts once in the `(app)` layout and is called from the mutation hook's `onError`s. Server actions gain error capture (log, don't fail) on notification fan-outs and additive `getBoardAccess` checks. `getBoardPayload` throws on DB read errors instead of returning empty arrays.

**Tech Stack:** Next.js 16.2.9 (App Router), React 19, TanStack Query 5, Supabase, sonner (new dep), Vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-07-02-robustness-error-surfacing-design.md`

## Global Constraints

- Next.js **16.2.9**: `error.tsx` is a client component with props `{ error: Error & { digest?: string }, unstable_retry: () => void }` — use `unstable_retry`, not `reset`. `not-found.tsx` is a server component with no props.
- **RLS remains the security boundary** — all app-level checks in this plan are additive feedback, never a replacement.
- **Server Actions for all mutations**; Zod validation stays first in every action.
- TypeScript strict, no `any`. Only new dependency allowed: `sonner`.
- **UI tasks (1–3) must load the `pulse-ui` and `frontend-design` skills first** (working agreement #3). Use existing design tokens (`text-foreground`, `text-muted-foreground`, shadcn `Button`), monochromatic + single accent.
- Commits: conventional, **lowercase subject** after `type(scope):`, descriptive body, trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Stage **explicitly by path** — never `git add -A`.
- Run tests with the unit project during tasks (`pnpm test --project unit -- <file>`); full gates in Task 7.
- Prod error messages from server components are stripped by Next (only `digest` survives) — fallback copy must not depend on `error.message`.

---

### Task 1: Shared fallback components

**Files:**

- Create: `src/components/shell/error-fallback.tsx`
- Create: `src/components/shell/not-found-fallback.tsx`
- Test: `src/components/shell/error-fallback.test.tsx`
- Test: `src/components/shell/not-found-fallback.test.tsx`

**Interfaces:**

- Consumes: `Button` from `@/components/ui/button` (existing shadcn primitive — verify it exists; if the project exports it elsewhere under `src/components/ui/`, adapt the import, not the API).
- Produces:
  - `ErrorFallback({ error, retry, title?, description? }: { error: Error & { digest?: string }; retry: () => void; title?: string; description?: string })` — named export, client component.
  - `NotFoundFallback({ title, description, backHref, backLabel }: { title: string; description: string; backHref: string; backLabel: string })` — named export, server-renderable (no `"use client"`).

- [ ] **Step 1: Load the `pulse-ui` and `frontend-design` skills** (mandatory before UI work). Adjust class names below to the tokens those skills prescribe if they differ.

- [ ] **Step 2: Write the failing tests**

`src/components/shell/error-fallback.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorFallback } from "./error-fallback";

function makeError(digest?: string): Error & { digest?: string } {
  const e = new Error("boom") as Error & { digest?: string };
  if (digest) e.digest = digest;
  return e;
}

describe("ErrorFallback", () => {
  it("renders default copy and calls retry on click", async () => {
    const retry = vi.fn();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ErrorFallback error={makeError()} retry={retry} />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalled(); // logged for observability
    spy.mockRestore();
  });

  it("renders custom title/description and the digest", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorFallback
        error={makeError("abc123")}
        retry={() => {}}
        title="Couldn't load boards"
        description="Custom description."
      />,
    );
    expect(screen.getByText("Couldn't load boards")).toBeInTheDocument();
    expect(screen.getByText("Custom description.")).toBeInTheDocument();
    expect(screen.getByText(/abc123/)).toBeInTheDocument();
  });

  it("omits the digest line when absent", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<ErrorFallback error={makeError()} retry={() => {}} />);
    expect(screen.queryByText(/error code/i)).not.toBeInTheDocument();
  });
});
```

`src/components/shell/not-found-fallback.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NotFoundFallback } from "./not-found-fallback";

describe("NotFoundFallback", () => {
  it("renders copy and a back link", () => {
    render(
      <NotFoundFallback
        title="Board not found"
        description="This board may have been deleted."
        backHref="/boards"
        backLabel="All boards"
      />,
    );
    expect(screen.getByText("Board not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All boards" })).toHaveAttribute(
      "href",
      "/boards",
    );
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test --project unit -- src/components/shell/error-fallback.test.tsx src/components/shell/not-found-fallback.test.tsx`
Expected: FAIL — cannot resolve `./error-fallback` / `./not-found-fallback`.

- [ ] **Step 4: Implement the components**

`src/components/shell/error-fallback.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/**
 * Shared fallback body for route-level error boundaries (error.tsx files).
 * Copy must not depend on error.message — Next strips server error messages
 * in production; only `digest` survives (shown for support correlation).
 */
export function ErrorFallback({
  error,
  retry,
  title = "Something went wrong",
  description = "An unexpected error kept this page from loading. Your data is safe.",
}: {
  error: Error & { digest?: string };
  retry: () => void;
  title?: string;
  description?: string;
}) {
  useEffect(() => {
    // Observability: route errors would otherwise vanish client-side.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-8 text-center">
      <h2 className="text-foreground text-lg font-semibold">{title}</h2>
      <p className="text-muted-foreground max-w-md text-sm">{description}</p>
      <Button onClick={retry} className="mt-2">
        Try again
      </Button>
      {error.digest ? (
        <p className="text-muted-foreground text-xs">
          Error code: {error.digest}
        </p>
      ) : null}
    </div>
  );
}
```

`src/components/shell/not-found-fallback.tsx`:

```tsx
import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Shared body for not-found.tsx route files (server component — no hooks). */
export function NotFoundFallback({
  title,
  description,
  backHref,
  backLabel,
}: {
  title: string;
  description: string;
  backHref: string;
  backLabel: string;
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-8 text-center">
      <h2 className="text-foreground text-lg font-semibold">{title}</h2>
      <p className="text-muted-foreground max-w-md text-sm">{description}</p>
      <Button asChild variant="outline" className="mt-2">
        <Link href={backHref}>{backLabel}</Link>
      </Button>
    </div>
  );
}
```

If `Button` lacks `asChild`, render a plain styled `<Link>` instead — keep the accessible name/href contract the test asserts.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test --project unit -- src/components/shell/error-fallback.test.tsx src/components/shell/not-found-fallback.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/shell/error-fallback.tsx src/components/shell/not-found-fallback.tsx src/components/shell/error-fallback.test.tsx src/components/shell/not-found-fallback.test.tsx
git commit
```

Subject: `feat(shell): add error and not-found fallback components`

---

### Task 2: Route error boundaries and not-found pages

**Files:**

- Create: `src/app/error.tsx`, `src/app/not-found.tsx`
- Create: `src/app/(app)/error.tsx`
- Create: `src/app/(app)/boards/error.tsx`, `src/app/(app)/dashboards/error.tsx`, `src/app/(app)/portfolios/error.tsx`, `src/app/(app)/goals/error.tsx`, `src/app/(app)/time/error.tsx`
- Create: `src/app/(app)/boards/[boardId]/not-found.tsx`, `src/app/(app)/dashboards/[dashboardId]/not-found.tsx`, `src/app/(app)/portfolios/[portfolioId]/not-found.tsx`
- Test: `src/app/error-boundaries.test.tsx`

**Interfaces:**

- Consumes: `ErrorFallback({ error, retry, title?, description? })` and `NotFoundFallback({ title, description, backHref, backLabel })` from Task 1.
- Produces: default-exported route files only (nothing downstream imports them). The three dynamic pages already call `notFound()` — no page changes.

- [ ] **Step 1: Write the failing test**

`src/app/error-boundaries.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import RootError from "./error";
import AppError from "./(app)/error";
import BoardsError from "./(app)/boards/error";
import DashboardsError from "./(app)/dashboards/error";
import PortfoliosError from "./(app)/portfolios/error";
import GoalsError from "./(app)/goals/error";
import TimeError from "./(app)/time/error";
import RootNotFound from "./not-found";
import BoardNotFound from "./(app)/boards/[boardId]/not-found";
import DashboardNotFound from "./(app)/dashboards/[dashboardId]/not-found";
import PortfolioNotFound from "./(app)/portfolios/[portfolioId]/not-found";

const err = Object.assign(new Error("x"), { digest: "d1" });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("error boundaries", () => {
  const cases: [
    string,
    React.ComponentType<{
      error: Error & { digest?: string };
      unstable_retry: () => void;
    }>,
  ][] = [
    ["root", RootError],
    ["(app)", AppError],
    ["boards", BoardsError],
    ["dashboards", DashboardsError],
    ["portfolios", PortfoliosError],
    ["goals", GoalsError],
    ["time", TimeError],
  ];
  it.each(cases)("%s renders a retry affordance", (_name, Comp) => {
    render(<Comp error={err} unstable_retry={() => {}} />);
    expect(
      screen.getByRole("button", { name: /try again/i }),
    ).toBeInTheDocument();
    cleanup();
  });
});

describe("not-found pages", () => {
  const cases: [string, React.ComponentType, string][] = [
    ["root", RootNotFound, "/"],
    ["board", BoardNotFound, "/boards"],
    ["dashboard", DashboardNotFound, "/dashboards"],
    ["portfolio", PortfolioNotFound, "/portfolios"],
  ];
  it.each(cases)("%s renders a back link to %s", (_n, Comp, href) => {
    render(<Comp />);
    expect(screen.getByRole("link")).toHaveAttribute("href", href);
    cleanup();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --project unit -- src/app/error-boundaries.test.tsx`
Expected: FAIL — module `./error` (etc.) not found.

- [ ] **Step 3: Create the error boundary files**

Pattern (every `error.tsx` is this file with its own copy; per Next 16 docs the props are `error` + `unstable_retry`):

`src/app/(app)/boards/error.tsx`:

```tsx
"use client";

import { ErrorFallback } from "@/components/shell/error-fallback";

export default function BoardsError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <ErrorFallback
      error={error}
      retry={unstable_retry}
      title="Couldn't load boards"
      description="Something failed while loading this board data. Your data is safe — try again."
    />
  );
}
```

Same shape for the others, changing only component name/title/description:

| File                                 | Component         | title                         | description                                                                                   |
| ------------------------------------ | ----------------- | ----------------------------- | --------------------------------------------------------------------------------------------- |
| `src/app/error.tsx`                  | `RootError`       | `Something went wrong`        | `An unexpected error kept this page from loading. Your data is safe.` (omit props — defaults) |
| `src/app/(app)/error.tsx`            | `AppError`        | `Something went wrong`        | defaults (covers settings/workload too)                                                       |
| `src/app/(app)/dashboards/error.tsx` | `DashboardsError` | `Couldn't load dashboards`    | `Something failed while loading dashboard data. Your data is safe — try again.`               |
| `src/app/(app)/portfolios/error.tsx` | `PortfoliosError` | `Couldn't load portfolios`    | `Something failed while loading portfolio data. Your data is safe — try again.`               |
| `src/app/(app)/goals/error.tsx`      | `GoalsError`      | `Couldn't load goals`         | `Something failed while loading goals data. Your data is safe — try again.`                   |
| `src/app/(app)/time/error.tsx`       | `TimeError`       | `Couldn't load time tracking` | `Something failed while loading time data. Your data is safe — try again.`                    |

- [ ] **Step 4: Create the not-found files**

`src/app/(app)/boards/[boardId]/not-found.tsx`:

```tsx
import { NotFoundFallback } from "@/components/shell/not-found-fallback";

export default function BoardNotFound() {
  return (
    <NotFoundFallback
      title="Board not found"
      description="This board may have been deleted, or you may not have access to it."
      backHref="/boards"
      backLabel="All boards"
    />
  );
}
```

Same shape for:

- `src/app/(app)/dashboards/[dashboardId]/not-found.tsx` — `DashboardNotFound`, "Dashboard not found", "This dashboard may have been deleted, or you may not have access to it.", `/dashboards`, "All dashboards".
- `src/app/(app)/portfolios/[portfolioId]/not-found.tsx` — `PortfolioNotFound`, "Portfolio not found", "This portfolio may have been deleted, or you may not have access to it.", `/portfolios`, "All portfolios".
- `src/app/not-found.tsx` — `RootNotFound`, "Page not found", "The page you're looking for doesn't exist or has moved.", `/`, "Go home". (Also catches all unmatched URLs app-wide.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test --project unit -- src/app/error-boundaries.test.tsx`
Expected: PASS (11 cases).

- [ ] **Step 6: Commit**

```bash
git add src/app/error.tsx src/app/not-found.tsx "src/app/(app)/error.tsx" "src/app/(app)/boards/error.tsx" "src/app/(app)/dashboards/error.tsx" "src/app/(app)/portfolios/error.tsx" "src/app/(app)/goals/error.tsx" "src/app/(app)/time/error.tsx" "src/app/(app)/boards/[boardId]/not-found.tsx" "src/app/(app)/dashboards/[dashboardId]/not-found.tsx" "src/app/(app)/portfolios/[portfolioId]/not-found.tsx" src/app/error-boundaries.test.tsx
git commit
```

Subject: `feat(app): add route error boundaries and not-found pages`

---

### Task 3: Sonner toaster + mutation error toasts

**Files:**

- Modify: `package.json` (add `sonner`)
- Create: `src/components/ui/sonner.tsx`
- Modify: `src/app/(app)/layout.tsx`
- Modify: `src/lib/boards/use-board-mutations.ts`
- Test: `src/lib/boards/use-board-mutations.test.tsx` (extend)

**Interfaces:**

- Consumes: nothing from other tasks (independent).
- Produces: `Toaster` (named export from `@/components/ui/sonner`) mounted in the `(app)` layout; module-private `showMutationError(action: string, err: Error): void` inside `use-board-mutations.ts`. Toast contract used by tests: `toast.error(action, { description: err.message })`.

- [ ] **Step 1: Load the `pulse-ui` and `frontend-design` skills** (toaster is UI).

- [ ] **Step 2: Install sonner**

Run: `pnpm add sonner`
Expected: `sonner` appears in `package.json` dependencies.

- [ ] **Step 3: Write the failing tests** — extend `src/lib/boards/use-board-mutations.test.tsx`. Add near the other `vi.mock` calls (top of file, before imports of the hook):

```tsx
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toastError(...a) },
}));
```

Add `toastError.mockReset()` to the existing `beforeEach` (or a new one), and these tests (reuse the file's existing `seedCache`/wrapper helpers for the QueryClient setup):

```tsx
describe("mutation error toasts", () => {
  it("toasts and rolls back when setCell fails", async () => {
    upsertCell.mockResolvedValue({ ok: false, error: "boom" });
    const qc = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const before = seedCache(qc);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useBoardMutations("b1"), { wrapper });
    act(() => {
      result.current.setCell({
        itemId: "i1",
        columnId: "c1",
        value: { text: "x" },
      });
    });
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError).toHaveBeenCalledWith(
      "Couldn't save the cell — your change was undone.",
      { description: "boom" },
    );
    // rollback still happens
    expect(qc.getQueryData(boardKey("b1"))).toEqual(before);
  });

  it("does NOT toast for callback-surfaced mutations (addItem)", async () => {
    const createItem = vi.fn().mockResolvedValue({ ok: false, error: "boom" });
    // add createItem to the existing @/lib/boards/actions mock factory
    const qc = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    seedCache(qc);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useBoardMutations("b1"), { wrapper });
    const onError = vi.fn();
    act(() => {
      result.current.addItem({ groupId: "g1", name: "x" }, { onError });
    });
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(toastError).not.toHaveBeenCalled();
  });
});
```

Adapt seed/wrapper details to the file's existing helpers (`seedCache(qc)` exists; the `@/lib/boards/actions` mock factory must also export `createItem`, `deleteItem`, `renameItem`, `renameGroup`, `renameBoard`, `removeColumnOption`, `renameColumn`, `reorderItem`, `resizeColumn`, `resizeNameColumn`, `updateColumnSettings`, `addSubitem` if the new tests exercise them — vi module factories replace the whole module, so any action the hook calls must be present).

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm test --project unit -- src/lib/boards/use-board-mutations.test.tsx`
Expected: new tests FAIL — `toastError` never called (no toast wiring yet). Pre-existing tests stay green.

- [ ] **Step 5: Implement** — in `src/lib/boards/use-board-mutations.ts`:

Add import + helper (module level, above `useBoardMutations`):

```ts
import { toast } from "sonner";

/** Surface a failed board mutation. Rollback already restored the cache;
 *  this is the user-visible half (spec F2). */
function showMutationError(action: string, err: Error) {
  toast.error(action, { description: err.message });
}
```

Then add `showMutationError(<message>, err)` as the **last line** of the existing `onError` of each silent mutation (keep the rollback line first), and as a new `onError` on the silent non-optimistic ones. Messages:

| Mutation                                 | message                                                         |
| ---------------------------------------- | --------------------------------------------------------------- |
| setCellMutation                          | `Couldn't save the cell — your change was undone.`              |
| clearCellMutation                        | `Couldn't clear the cell — your change was undone.`             |
| renameItemMutation                       | `Couldn't rename the item — your change was undone.`            |
| deleteItemMutation                       | `Couldn't delete the item — it was restored.`                   |
| reorderItemMutation                      | `Couldn't reorder the item — your change was undone.`           |
| renameGroupMutation                      | `Couldn't rename the group — your change was undone.`           |
| reorderGroupMutation                     | `Couldn't reorder the group — your change was undone.`          |
| setGroupColorMutation                    | `Couldn't change the group color — your change was undone.`     |
| deleteGroupMutation                      | `Couldn't delete the group — it was restored.`                  |
| renameColumnMutation                     | `Couldn't rename the column — your change was undone.`          |
| resizeColumnMutation                     | `Couldn't resize the column — your change was undone.`          |
| deleteColumnMutation                     | `Couldn't delete the column — it was restored.`                 |
| updateColumnSettingsMutation             | `Couldn't update the column settings — your change was undone.` |
| removeColumnOptionMutation               | `Couldn't remove the option — your change was undone.`          |
| removeDependencyMutation                 | `Couldn't remove the dependency — it was restored.`             |
| setRelationLinksMutation                 | `Couldn't update the connection — your change was undone.`      |
| deleteColumnFileMutation                 | `Couldn't delete the file — it was restored.`                   |
| deleteEntryMutation                      | `Couldn't delete the time entry — it was restored.`             |
| setEstimateMutation                      | `Couldn't save the estimate — your change was undone.`          |
| renameBoardMutation                      | `Couldn't rename the board — your change was undone.`           |
| resizeNameColumnMutation                 | `Couldn't resize the column — your change was undone.`          |
| startTimerMutation (new `onError`)       | `Couldn't start the timer.`                                     |
| stopTimerMutation (new `onError`)        | `Couldn't stop the timer.`                                      |
| addManualEntryMutation (new `onError`)   | `Couldn't add the time entry.`                                  |
| editEntryMutation (new `onError`)        | `Couldn't save the time entry.`                                 |
| uploadColumnFileMutation (new `onError`) | `Couldn't upload the file.`                                     |

**Do NOT add toasts to:** addItemMutation, addSubitemMutation, addGroupMutation, addColumnMutation, addDependencyMutation — their callers already surface errors inline via `onError` callbacks (`role="alert"` banners, e.g. `BoardTable.tsx`); double feedback is worse than one.

Example (setCellMutation — every optimistic one follows this shape):

```ts
onError: (err, _vars, ctx) => {
  if (ctx?.previous) qc.setQueryData(key, ctx.previous);
  showMutationError("Couldn't save the cell — your change was undone.", err);
},
```

Create `src/components/ui/sonner.tsx` (shadcn-style theme bridge):

```tsx
"use client";

import { useTheme } from "next-themes";
import { Toaster as SonnerToaster } from "sonner";

/** App-wide toaster. Mounted once in the (app) layout; themed via next-themes. */
export function Toaster(props: React.ComponentProps<typeof SonnerToaster>) {
  const { theme = "system" } = useTheme();
  return (
    <SonnerToaster
      theme={theme as "light" | "dark" | "system"}
      position="bottom-right"
      closeButton
      {...props}
    />
  );
}
```

Mount in `src/app/(app)/layout.tsx` (client component inside a server layout is fine):

```tsx
import type { ReactNode } from "react";
import { AuthenticatedShell } from "@/components/shell/authenticated-shell";
import { Toaster } from "@/components/ui/sonner";

export const unstable_instant = false;

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AuthenticatedShell>{children}</AuthenticatedShell>
      <Toaster />
    </>
  );
}
```

(Preserve the existing file's doc comment and `unstable_instant` line.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test --project unit -- src/lib/boards/use-board-mutations.test.tsx`
Expected: PASS, including all pre-existing tests (they mock sonner too now, so no real DOM toasts).

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/components/ui/sonner.tsx "src/app/(app)/layout.tsx" src/lib/boards/use-board-mutations.ts src/lib/boards/use-board-mutations.test.tsx
git commit
```

Subject: `feat(boards): surface mutation failures as error toasts`

---

### Task 4: Log failed notification fan-out inserts

**Files:**

- Modify: `src/lib/boards/actions.ts:580` (upsertCell assigned fan-out)
- Modify: `src/lib/collaboration/actions.ts:65` (addUpdate mention fan-out)
- Test: `src/lib/boards/actions.test.ts` (extend), `src/lib/collaboration/actions.test.ts` (extend)

**Interfaces:**

- Consumes: nothing from other tasks (independent).
- Produces: unchanged action signatures (`upsertCell`, `addUpdate` — still return `ActionResult`); log contract `console.error("[notifications] <assigned|mention> fan-out failed", { itemId, recipients, error })` that Task 7's gates and future observability rely on.

- [ ] **Step 1: Write the failing tests**

In `src/lib/boards/actions.test.ts`, inside the existing `upsertCell people-cell assignment fan-out` describe (reuse its `from` mock shape verbatim — copy the working builder from the passing test):

```ts
it("returns ok but logs when the notification insert fails", async () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  const notifInsert = vi
    .fn()
    .mockResolvedValue({ error: { message: "insert denied" } });
  const upsert = vi.fn().mockResolvedValue({ error: null });
  from.mockImplementation((table: string) => {
    if (table === "columns")
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { org_id: "org", board_id: "board", kind: "people" },
              error: null,
            }),
          }),
        }),
      } as never;
    if (table === "items")
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { board_id: "board" },
              error: null,
            }),
          }),
        }),
      } as never;
    if (table === "cell_values")
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
        upsert,
      } as never;
    if (table === "notifications") return { insert: notifInsert } as never;
    return {} as never;
  });

  const res = await upsertCell({
    itemId: ITEM,
    columnId: COL,
    value: { userIds: [A] },
  });

  expect(res).toEqual({ ok: true, data: undefined }); // primary write not failed
  expect(spy).toHaveBeenCalledWith(
    "[notifications] assigned fan-out failed",
    expect.objectContaining({
      itemId: ITEM,
      recipients: 1,
      error: "insert denied",
    }),
  );
  spy.mockRestore();
});
```

In `src/lib/collaboration/actions.test.ts`, inside the `addUpdate mention fan-out` describe (reuse its existing `updInsert`/`notifInsert` builder shape):

```ts
it("returns ok but logs when the mention notification insert fails", async () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  const notifInsert = vi
    .fn()
    .mockResolvedValue({ error: { message: "insert denied" } });
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

  const res = await addUpdate({
    itemId: ITEM,
    text: "hi",
    mentions: [OTHER],
  });

  expect(res).toEqual({ ok: true, data: { updateId: UPD } });
  expect(spy).toHaveBeenCalledWith(
    "[notifications] mention fan-out failed",
    expect.objectContaining({
      itemId: ITEM,
      recipients: 1,
      error: "insert denied",
    }),
  );
  spy.mockRestore();
});
```

(`OTHER` is already defined in that describe block; hoist it if needed.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test --project unit -- src/lib/boards/actions.test.ts src/lib/collaboration/actions.test.ts`
Expected: the two new tests FAIL — `console.error` never called.

- [ ] **Step 3: Implement**

`src/lib/boards/actions.ts` — replace the bare `await` at line ~580:

```ts
if (added.length > 0) {
  const { error: notifErr } = await supabase.from("notifications").insert(
    added.map((rid) => ({
      org_id: column.org_id,
      recipient_id: rid,
      actor_id: user?.id ?? null,
      kind: "assigned" as const,
      board_id: column.board_id,
      item_id: parsed.data.itemId,
    })),
  );
  // Best-effort fan-out: the cell write already succeeded, so don't fail the
  // action — but never drop the failure silently (spec F3 / decision D4).
  if (notifErr)
    console.error("[notifications] assigned fan-out failed", {
      itemId: parsed.data.itemId,
      recipients: added.length,
      error: notifErr.message,
    });
}
```

`src/lib/collaboration/actions.ts` — replace the bare `await` at line ~65:

```ts
if (recipients.length > 0) {
  const { error: notifErr } = await supabase.from("notifications").insert(
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
  // Best-effort fan-out: the update already posted (spec F3 / decision D4).
  if (notifErr)
    console.error("[notifications] mention fan-out failed", {
      itemId: parsed.data.itemId,
      recipients: recipients.length,
      error: notifErr.message,
    });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test --project unit -- src/lib/boards/actions.test.ts src/lib/collaboration/actions.test.ts`
Expected: PASS (new + all pre-existing fan-out tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/actions.ts src/lib/collaboration/actions.ts src/lib/boards/actions.test.ts src/lib/collaboration/actions.test.ts
git commit
```

Subject: `fix(notifications): log failed notification fan-out inserts`

---

### Task 5: Explicit membership checks for deleteBoard / duplicateBoard

**Depends on Task 4 (same file: `src/lib/boards/actions.ts`).**

**Files:**

- Modify: `src/lib/boards/actions.ts:172` (deleteBoard), `:202` (duplicateBoard)
- Test: `src/lib/boards/actions.test.ts` (extend)

**Interfaces:**

- Consumes: `getBoardAccess(boardId: string): Promise<"owner" | "editor" | "viewer" | null>` from `@/lib/boards/queries` (exists at `queries.ts:99`; `server-only` module — safe to import from the `"use server"` actions file).
- Produces: unchanged signatures; new failure messages `"Only the board owner can delete this board."` and `"Board not found."` that UI tests may assert.

- [ ] **Step 1: Write the failing tests** — in `src/lib/boards/actions.test.ts`:

Add a hoisted mock next to the other `vi.mock` calls (this also prevents `server-only` from loading in jsdom):

```ts
const getBoardAccess = vi.fn();
vi.mock("@/lib/boards/queries", () => ({
  getBoardAccess: (...a: unknown[]) => getBoardAccess(...a),
}));
```

Extend the `@/lib/supabase/server` mock factory with an `rpc` fn (additive — existing tests unaffected):

```ts
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from, auth: { getUser }, rpc }),
}));
```

Import the actions and add (BOARD is any valid uuid constant):

```ts
import { deleteBoard, duplicateBoard } from "@/lib/boards/actions";

const BOARD = "44444444-4444-4444-8444-444444444444";

describe("board membership checks (defense in depth — RLS stays the boundary)", () => {
  beforeEach(() => {
    getBoardAccess.mockReset();
    rpc.mockReset();
  });

  it("deleteBoard refuses non-owners without touching the db", async () => {
    getBoardAccess.mockResolvedValue("editor");
    const res = await deleteBoard({ boardId: BOARD });
    expect(res).toEqual({
      ok: false,
      error: "Only the board owner can delete this board.",
    });
    expect(from).not.toHaveBeenCalled();
  });

  it("deleteBoard proceeds for the owner", async () => {
    getBoardAccess.mockResolvedValue("owner");
    const del = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    from.mockImplementation((table: string) => {
      if (table === "attachments")
        return {
          select: () => ({ eq: async () => ({ data: [], error: null }) }),
        } as never;
      if (table === "boards") return { delete: del } as never;
      return {} as never;
    });
    const res = await deleteBoard({ boardId: BOARD });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(del).toHaveBeenCalled();
  });

  it("duplicateBoard refuses non-members with a non-leaking message", async () => {
    getBoardAccess.mockResolvedValue(null);
    const res = await duplicateBoard({ boardId: BOARD });
    expect(res).toEqual({ ok: false, error: "Board not found." });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("duplicateBoard proceeds for a viewer", async () => {
    getBoardAccess.mockResolvedValue("viewer");
    rpc.mockResolvedValue({ data: { id: "new-board" }, error: null });
    const res = await duplicateBoard({ boardId: BOARD });
    expect(res).toEqual({ ok: true, data: { boardId: "new-board" } });
    expect(rpc).toHaveBeenCalledWith("duplicate_board_structure", {
      p_board_id: BOARD,
    });
  });
});
```

If the `attachments` builder chain in `deleteBoard` needs `.select().eq()` to be awaitable, mirror the real call shape (`.select("storage_path").eq("board_id", id)` awaited directly): make `eq` an async fn returning `{ data: [], error: null }` as shown.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test --project unit -- src/lib/boards/actions.test.ts`
Expected: new tests FAIL — no membership check yet (delete proceeds / wrong error).

- [ ] **Step 3: Implement** — in `src/lib/boards/actions.ts`:

Add import:

```ts
import { getBoardAccess } from "@/lib/boards/queries";
```

`deleteBoard` — insert after the Zod parse, before `createClient()`:

```ts
// Defense in depth: RLS already blocks non-owners, but an RLS-filtered
// delete affects 0 rows and returns no error — a lying success. Check
// explicitly so non-owners get a real answer (spec F4 / decision D5).
const access = await getBoardAccess(parsed.data.boardId);
if (access !== "owner")
  return fail("Only the board owner can delete this board.");
```

`duplicateBoard` — insert after the Zod parse, before `createClient()`:

```ts
// Any member (owner/editor/viewer) may duplicate — they can already read
// the data. Non-members get the same message as a missing board so we
// don't leak existence (spec F4 / decision D5).
const access = await getBoardAccess(parsed.data.boardId);
if (!access) return fail("Board not found.");
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test --project unit -- src/lib/boards/actions.test.ts`
Expected: PASS — new tests plus all pre-existing ones (the upsertCell tests don't call deleteBoard/duplicateBoard, so the new mock defaults don't disturb them; if any pre-existing test now reaches `getBoardAccess`, give it `getBoardAccess.mockResolvedValue("owner")` in its arrange step).

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/actions.ts src/lib/boards/actions.test.ts
git commit
```

Subject: `feat(boards): explicit membership checks for delete and duplicate board`

---

### Task 6: getBoardPayload — fail loudly on read errors

**Files:**

- Modify: `src/lib/boards/queries.ts:129-294` (`getBoardPayload`)
- Test: Create `src/lib/boards/queries.test.ts`

**Interfaces:**

- Consumes: nothing from other tasks (the thrown error is _caught_ by Task 2's `boards/error.tsx` at runtime, but there is no code dependency).
- Produces: `getBoardPayload(boardId): Promise<BoardPayload | null>` — signature unchanged; **new contract:** `null` only when the board row is absent/RLS-hidden; any DB read error now **throws** `Error("Failed to load board <read>: <message>")`.

- [ ] **Step 1: Write the failing test** — `src/lib/boards/queries.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from }),
}));
vi.mock("@/lib/auth/session", () => ({ getUser: vi.fn() }));

import { getBoardPayload } from "@/lib/boards/queries";

type Result = { data: unknown; error: { message: string } | null };

/** Chainable, thenable stand-in for a PostgREST builder. */
function tableMock(result: Result) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "not", "in"])
    chain[m] = () => chain;
  chain.maybeSingle = async () => result;
  (chain as { then: unknown }).then = (resolve: (v: Result) => void) =>
    resolve(result);
  return chain;
}

const BOARD_ROW = { id: "b1", org_id: "o1", name: "B" };

beforeEach(() => {
  from.mockReset();
});

describe("getBoardPayload error contract", () => {
  it("returns null when the board row is absent (→ notFound)", async () => {
    from.mockImplementation(() => tableMock({ data: null, error: null }));
    expect(await getBoardPayload("b1")).toBeNull();
  });

  it("throws when the board head read errors (not notFound)", async () => {
    from.mockImplementation(() =>
      tableMock({ data: null, error: { message: "db down" } }),
    );
    await expect(getBoardPayload("b2")).rejects.toThrow(/db down/);
  });

  it("throws when a parallel read errors instead of rendering an empty board", async () => {
    from.mockImplementation((table: string) => {
      if (table === "boards")
        return tableMock({ data: BOARD_ROW, error: null });
      if (table === "items")
        return tableMock({ data: null, error: { message: "items broke" } });
      return tableMock({ data: [], error: null });
    });
    await expect(getBoardPayload("b3")).rejects.toThrow(/items.*items broke/i);
  });

  it("returns the payload when every read succeeds", async () => {
    from.mockImplementation((table: string) =>
      table === "boards"
        ? tableMock({ data: BOARD_ROW, error: null })
        : tableMock({ data: [], error: null }),
    );
    const payload = await getBoardPayload("b4");
    expect(payload?.board).toEqual(BOARD_ROW);
    expect(payload?.items).toEqual([]);
  });
});
```

**Note:** `getBoardPayload` is wrapped in React `cache()` — it memoizes per boardId, so every test above uses a **distinct boardId** (b1–b4). Keep that discipline for any test you add.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --project unit -- src/lib/boards/queries.test.ts`
Expected: "throws when the board head read errors" and "throws when a parallel read errors" FAIL (current code returns `null` / an empty payload).

- [ ] **Step 3: Implement** — in `getBoardPayload`:

Board head (line ~133): split error from missing:

```ts
const { data: board, error: boardErr } = await supabase
  .from("boards")
  .select("*")
  .eq("id", boardId)
  .maybeSingle();
// A DB failure is not a 404: throw so the boards error boundary renders
// (spec F5 / decision D6). Missing/RLS-hidden row stays null → notFound().
if (boardErr) throw new Error(`Failed to load board: ${boardErr.message}`);
if (!board) return null;
```

After the nine-read `Promise.all` (line ~202), before any `.data` use:

```ts
// A silently-empty board (every `.data ?? []` below) is indistinguishable
// from deleted data. Fail loudly; the segment error boundary offers retry.
const reads: [string, { error: { message: string } | null }][] = [
  ["groups", groupsRes],
  ["columns", columnsRes],
  ["items", itemsRes],
  ["cell values", cellsRes],
  ["views", viewsRes],
  ["dependencies", depsRes],
  ["attachments", attachmentsRes],
  ["time entries", timeEntriesRes],
  ["relation links", relationLinksRes],
];
for (const [name, res] of reads)
  if (res.error)
    throw new Error(`Failed to load board ${name}: ${res.error.message}`);
```

Linked-item names read (line ~210): capture and check the error:

```ts
const { data: linkedItems, error: linkedErr } = await supabase
  .from("items")
  .select("id, name")
  .in("id", linkedIds);
if (linkedErr)
  throw new Error(`Failed to load board linked items: ${linkedErr.message}`);
```

Mirror follow-up reads (line ~261): after the `Promise.all([cellsRes2, colsRes2])`:

```ts
if (cellsRes2.error)
  throw new Error(
    `Failed to load board mirror cells: ${cellsRes2.error.message}`,
  );
if (colsRes2.error)
  throw new Error(
    `Failed to load board mirror columns: ${colsRes2.error.message}`,
  );
```

Keep the `?? []` fallbacks in the return object — after the checks they only cover `data: null` on genuinely-empty results.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test --project unit -- src/lib/boards/queries.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/boards/queries.ts src/lib/boards/queries.test.ts
git commit
```

Subject: `fix(boards): fail loudly when board payload reads error`

---

### Task 7: Full verification gates

**Files:** none (verification only).

**Interfaces:**

- Consumes: all previous tasks merged into the task branch.
- Produces: green gates — the precondition for `scripts/finish-task.sh`.

- [ ] **Step 1: Run the four gates** (working agreement #4)

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: all pass. Known traps (vault memory): a cold `pnpm typecheck` can fail on `cacheLife("nav"/"guard")` until `pnpm build` generates `.next/types` — if so, run `pnpm build` first, then re-run typecheck; integration tests hit live Supabase and run serially — a `beforeAll` timeout there is the documented flake, re-run before diagnosing.

- [ ] **Step 2: Fix anything red, re-run until green.** No commit for this task unless fixes were needed (each fix commits with its owning task's scope).

---

## Execution DAG (working agreement #6)

**Dependency graph:**

- Task 2 depends on Task 1 (imports `ErrorFallback` / `NotFoundFallback`).
- Task 5 depends on Task 4 (both edit `src/lib/boards/actions.ts` + its test file — serialized to avoid clobbering, no logic dependency).
- Task 6 has a runtime rendezvous with Task 2 (its throw is caught by `boards/error.tsx`) but **no code dependency** — independent.
- Task 7 depends on all of 1–6.

**Parallel batches (all within this one worktree/branch — batch-mates touch disjoint files, so parallel subagents are safe here):**

- **Batch 1:** Task 1, Task 3, Task 4, Task 6 (4-wide)
- **Batch 2:** Task 2, Task 5 (2-wide)
- **Batch 3:** Task 7 (gate)

**Critical path:** Task 1 → Task 2 → Task 7 (3 tasks; Task 4 → Task 5 → Task 7 ties it). Wall-clock floor ≈ 3 task-lengths.

## Performance & data-fetching budget (working agreement #5)

Restated from spec §4: zero new server round-trips on any interaction; error/not-found pages render only on failure; `<Toaster />` mounts once (client-only, no fetch); `getBoardAccess` adds ≤2 indexed point-reads to two rare mutations; `getBoardPayload` gains checks, not queries. No new views/tabs/filters — no History-API state involved.

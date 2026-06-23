# Shared `(app)` Shell Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the authenticated shell (sidebar nav, header, command palette) mount **once** and persist across section navigation, instead of every section layout re-mounting its own copy and re-fetching the sidebar on every click.

**Architecture:** Introduce a single URL-transparent route group `src/app/(app)/` whose `layout.tsx` renders `AuthenticatedShell`. Move the seven main authenticated sections under it so the group layout becomes their common ancestor (which the App Router preserves across sibling navigation). Delete the now-redundant per-section layouts; keep only a thin dashboards layout for its grid CSS. `admin` and `home` stay outside the group (admin's pre-Suspense auth guard must not run inside the shell's Suspense; home is a one-shot dispatcher).

**Tech Stack:** Next.js 16 App Router (route groups, route segment config), Vitest, Node `fs`.

---

## File Structure

| Path                                                                   | Action          | Responsibility                                                                  |
| ---------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------- |
| `src/app/(app)/layout.tsx`                                             | Create          | The single shared shell mount + `unstable_instant = false`                      |
| `src/app/(app)/boards/` … `settings/`                                  | Move (`git mv`) | The seven sections, now children of the group                                   |
| `src/app/boards/layout.tsx` (+portfolios/goals/time/workload/settings) | Delete          | Redundant — shell now lives on the parent group                                 |
| `src/app/(app)/dashboards/layout.tsx`                                  | Slim            | Keep ONLY the react-grid-layout CSS import; drop the shell + `unstable_instant` |
| `src/app/app-shell-structure.test.ts`                                  | Create          | Regression guard: exactly one shell mount under `(app)/`                        |
| `src/app/admin/`, `src/app/home/`                                      | Untouched       | Keep their own shell mount (deliberate)                                         |

## Execution DAG

This is a single coherent refactor over one route tree; the tasks are inherently **sequential** (no parallel batches):

- **Task 1** (RED test) → **Task 2** (structural move, turns it GREEN) → **Task 3** (verify gates + import integrity).
- Critical path = Task 1 → 2 → 3. Task 2 is atomic on purpose: create-group + move-dirs + delete-layouts + slim-dashboards land in one commit so there is never a broken double-shell intermediate state.

---

### Task 1: Regression-guard test (RED)

**Files:**

- Test: `src/app/app-shell-structure.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP_GROUP = join(process.cwd(), "src/app/(app)");

/** All `layout.tsx` files at or below `dir`, as absolute paths. */
function layoutFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...layoutFiles(full));
    } else if (entry === "layout.tsx") {
      out.push(full);
    }
  }
  return out;
}

describe("(app) route group shell structure", () => {
  it("mounts AuthenticatedShell exactly once — on the group layout", () => {
    // The group layout exists and is the shell mount.
    const groupLayout = join(APP_GROUP, "layout.tsx");
    expect(existsSync(groupLayout)).toBe(true);
    expect(readFileSync(groupLayout, "utf8")).toContain("AuthenticatedShell");

    // No section layout *under* the group re-mounts the shell. A second mount
    // here would re-introduce the per-section reload bug this group fixes.
    const sectionLayouts = layoutFiles(APP_GROUP).filter(
      (f) => f !== groupLayout,
    );
    for (const file of sectionLayouts) {
      expect(
        readFileSync(file, "utf8"),
        `${file} must not mount AuthenticatedShell — the shared (app) layout already does`,
      ).not.toContain("AuthenticatedShell");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/app/app-shell-structure.test.ts`
Expected: FAIL — `existsSync(groupLayout)` is `false` (the `(app)` group does not exist yet), so the first `expect(...).toBe(true)` fails.

- [ ] **Step 3: Commit the failing test**

```bash
git add src/app/app-shell-structure.test.ts
git commit -m "test(shell): guard single shell mount under (app) group"
```

---

### Task 2: Create the group, move sections, drop redundant layouts (turns Task 1 GREEN)

**Files:**

- Create: `src/app/(app)/layout.tsx`
- Move: `src/app/{boards,dashboards,portfolios,goals,time,workload,settings}` → `src/app/(app)/…`
- Delete: `src/app/(app)/{boards,portfolios,goals,time,workload,settings}/layout.tsx`
- Modify: `src/app/(app)/dashboards/layout.tsx` (slim to CSS-only)

> **Shell note:** the `(app)` path contains parentheses — **always quote** paths in shell commands (`"src/app/(app)/boards"`), or zsh will try to glob them.

- [ ] **Step 1: Create the shared group layout**

Create `src/app/(app)/layout.tsx`:

```tsx
import type { ReactNode } from "react";
import { AuthenticatedShell } from "@/components/shell/authenticated-shell";

/**
 * The single persistent shell for every authenticated section
 * (boards, dashboards, portfolios, goals, time, workload, settings). Because
 * this group layout is the common ancestor of all of them, Next.js preserves it
 * across section navigation — the sidebar nav, header user region and command
 * palette mount once and stream their per-user data once per page load, not on
 * every section click.
 *
 * Hoisted from the former per-section layouts: cookie-bound page-load entry is
 * dynamic; sibling client-nav is validated via `{ prefetch: 'static' }` on the
 * page segments. The static AppShell frame still prerenders; per-user data
 * streams behind Suspense.
 *
 * `admin` and `home` deliberately stay OUTSIDE this group: admin runs its
 * platform-admin guard before any Suspense boundary, and home is a one-shot
 * redirect dispatcher.
 */
export const unstable_instant = false;

export default function AppLayout({ children }: { children: ReactNode }) {
  return <AuthenticatedShell>{children}</AuthenticatedShell>;
}
```

- [ ] **Step 2: Move the seven section directories into the group**

Run (the group dir now exists from Step 1):

```bash
for s in boards dashboards portfolios goals time workload settings; do
  git mv "src/app/$s" "src/app/(app)/$s"
done
git status --short
```

Expected: each section dir shows as renamed (`R`) into `src/app/(app)/`.

- [ ] **Step 3: Delete the six redundant section layouts**

These only mounted the shell and set `unstable_instant` — both now on the group layout:

```bash
git rm "src/app/(app)/boards/layout.tsx" \
       "src/app/(app)/portfolios/layout.tsx" \
       "src/app/(app)/goals/layout.tsx" \
       "src/app/(app)/time/layout.tsx" \
       "src/app/(app)/workload/layout.tsx" \
       "src/app/(app)/settings/layout.tsx"
```

- [ ] **Step 4: Slim the dashboards layout to CSS-only**

Overwrite `src/app/(app)/dashboards/layout.tsx` with (no shell, no `unstable_instant` — both inherited from the group):

```tsx
// react-grid-layout v2 ships a single stylesheet (includes resize-handle styles;
// the old react-resizable CSS no longer exists as a dependency). Imported in a
// dashboards-scoped layout so the grid styles load only for dashboard routes,
// not shell-wide.
import "react-grid-layout/css/styles.css";

import type { ReactNode } from "react";

export default function DashboardsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <>{children}</>;
}
```

- [ ] **Step 5: Run the regression test — now GREEN**

Run: `pnpm vitest run src/app/app-shell-structure.test.ts`
Expected: PASS — group layout exists and contains `AuthenticatedShell`; the only other `layout.tsx` under `(app)/` (dashboards) does not.

- [ ] **Step 6: Typecheck (catches any import breakage from the move)**

Run: `pnpm typecheck`
Expected: PASS, no errors. (Moved files use the `@/` absolute alias, so deepening the dir should not break imports.)

- [ ] **Step 7: Commit the structural change**

```bash
git add "src/app/(app)"
git status --short   # confirm only intended adds/renames/deletes are staged
git commit -m "refactor(shell): hoist AuthenticatedShell into shared (app) group

Move boards/dashboards/portfolios/goals/time/workload/settings under a
single (app) route group whose layout mounts the shell once. Delete the
now-redundant per-section layouts; keep a thin dashboards layout for its
grid CSS. URLs unchanged (route group is URL-transparent). Sidebar now
persists across section navigation instead of re-mounting per click."
```

---

### Task 3: Verify import integrity and full gates

**Files:** none modified — verification only.

- [ ] **Step 1: Confirm nothing imports the old route paths or uses fragile relative imports**

Run:

```bash
grep -rn "app/boards/layout\|app/dashboards/layout\|app/settings/layout" src || echo "no stale layout imports"
grep -rn "from \"\.\./\.\./\.\." "src/app/(app)" || echo "no deep relative imports in moved tree"
```

Expected: both print their "no …" sentinel (nothing references a moved layout by path; the moved tree has no `../../..`-style relative imports that the extra directory depth would break). If the second finds hits, convert those imports to the `@/` alias and re-run typecheck.

- [ ] **Step 2: Run the full gate suite**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all four PASS. In the `build` output, confirm the route manifest still lists `/boards`, `/dashboards`, `/portfolios`, `/goals`, `/time`, `/workload`, `/settings` (route group adds no URL segment).

- [ ] **Step 3: Commit (only if lint/format touched anything)**

```bash
git status --short
# If clean, nothing to commit. Otherwise:
git add -p   # stage only gate-driven formatting of files in this change
git commit -m "chore(shell): gate fixups for (app) group move"
```

---

## How to test this (manual acceptance)

After merge to `develop` (pull `develop`, `pnpm dev -p 3001`, log in):

1. Open the app and go to **Boards** → open any board. Open DevTools → **Network**, filter to the document/RSC + Supabase requests, and clear the log.
2. Click **Portfolios** in the sidebar. **Expected:** the sidebar nav itself does **not** flash a skeleton or re-render; only the main content area swaps. No new burst of sidebar nav queries (`listMyBoards` / `listSharedBoards` / `listDashboards` / workspaces).
3. Click **Dashboard**, then **My Time**, then back to **Boards**. **Expected:** same — the sidebar stays put across every section change; the skeleton appears only on the very first page load (hard refresh), not on in-app section clicks.
4. Hard-refresh on each section URL (`/portfolios`, `/dashboards`, `/time`) and confirm the page still loads correctly (route group did not change URLs).
5. Visit **Admin** (if platform admin) and confirm it still loads and still hard-redirects a non-admin cleanly — admin intentionally keeps its own shell mount.

**Known follow-up (not in this change):** editing a board (rename/reorder/delete/duplicate/move) still triggers `revalidatePath("/", "layout")` in `src/lib/boards/actions.ts`, which invalidates the whole shell and will reload the sidebar on the _next_ navigation. Narrowing that to a scoped `revalidateTag` is a separate task.

---

## Self-Review

- **Spec coverage:** group layout (Task 2.1) ✓; seven dir moves (2.2) ✓; delete six redundant layouts (2.3) ✓; thin dashboards layout (2.4) ✓; admin/home untouched (not in any task = unchanged) ✓; import-path risk (3.1) ✓; `revalidatePath` flagged out-of-scope (How-to-test follow-up) ✓; URL-unchanged check (3.2) ✓; gates + regression guard (Task 1, 3.2) ✓; manual acceptance (How to test) ✓.
- **Placeholder scan:** none — all code blocks and commands are concrete.
- **Type consistency:** `AppLayout`/`DashboardsLayout` both take `{ children: ReactNode }`; test helper `layoutFiles` is defined before use; group layout path constant `APP_GROUP` reused consistently.

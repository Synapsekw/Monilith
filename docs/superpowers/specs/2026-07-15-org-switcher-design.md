# Org Switcher — Design Spec

**Date:** 2026-07-15
**Status:** Draft — awaiting owner review
**Author:** Scoping agent (task/org-switcher)

> Scoping note: produced headless (no interactive Q&A). Defaults were resolved
> where sensible and marked; genuine owner questions are collected in §10.

---

## 1. Problem

A Pulse user can belong to multiple organizations (`getUserOrgs()` already
returns **all** of them, RLS-scoped). But there is **no concept of an active
org** anywhere in the app: ~22 files hardcode `orgs[0]` (or the equivalent
`(await getUserOrgs())[0]`) as "the org." A multi-org user is therefore
permanently pinned to whichever org sorts first, with no way to switch.

We want a first-class **active-org selection**: a multi-org user picks their
active org from the sidebar; the selection persists; every org-scoped read/write
resolves to that active org instead of `orgs[0]`.

## 2. Goals / Non-Goals

**Goals**

- A sidebar **org switcher** (mirrors the existing workspace switcher) for users
  in ≥2 orgs.
- A single **active-org resolver** every call site uses instead of `orgs[0]`.
- Persistence across requests (and page reloads).
- Membership re-verified server-side on **every** read — the cookie is UX only;
  RLS + `getUserOrgs()` remain the security boundary.
- Behavior-preserving for the overwhelmingly common single-org user (no cookie →
  resolver returns the same org `orgs[0]` returned).

**Non-Goals**

- Org creation from the switcher (org minting stays onboarding-gated — see §10 Q1).
- Cross-device persistence via a DB column (cookie-only for v1 — see §10 Q2).
- Any RLS/migration/schema change. **Zero DB migrations.**
- Changing workspace-switcher behavior (org is its parent; they compose).

## 3. Precedent we mirror (grounded in code)

The **workspace switcher** is the exact pattern one level down. We copy its shape:

| Workspace (exists)                                                  | Org (new)                                                           |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `src/lib/workspaces/active.ts` — `getActiveWorkspaceId(workspaces)` | `src/lib/org/active.ts` — `resolveActiveOrg()` / `getActiveOrgId()` |
| `src/lib/workspaces/active-actions.ts` — `setActiveWorkspace(id)`   | `src/lib/org/active-actions.ts` — `setActiveOrg(id)`                |
| `src/components/shell/workspace-switcher.tsx`                       | `src/components/shell/org-switcher.tsx`                             |
| cookie `pulse_active_ws`                                            | cookie `pulse_active_org`                                           |

Key facts confirmed by reading the code:

- `getActiveWorkspaceId(workspaces)` reads the cookie, returns it **only if it
  matches one of the passed workspaces**, else `workspaces[0]?.id ?? ""`. This
  validate-against-the-list step is the whole security story: a deleted/foreign
  id can never scope the nav to nothing. We replicate this exactly for orgs.
- `setActiveWorkspace` sets an `httpOnly`, `sameSite:"lax"`, `path:"/"`,
  1-year cookie and does **no** `revalidateTag` — the cached reads are keyed by
  workspace id, so a switch simply hits a different cache entry. The caller does
  `router.refresh()`. Org caches are likewise keyed by `orgId`
  (`dashboardsTag(orgId)`, `workspacesTag(orgId)`, …), so the same "no
  invalidation needed" reasoning holds.
- `getUserOrgs()` is `cache()`-wrapped and RLS-scoped; it **throws** on DB error
  (never returns `[]`) so a transient failure isn't misread as "no org." Our
  resolver must preserve that throw semantics (don't swallow it).

## 4. The active-org resolver contract

New file `src/lib/org/active.ts` (`import "server-only"`):

```ts
export const ACTIVE_ORG_COOKIE = "pulse_active_org";

/** Pure selection core — trivially unit-testable without cookies/DB. */
export function pickActiveOrg(
  orgs: UserOrg[],
  cookieValue: string | undefined,
): UserOrg | null {
  if (cookieValue && orgs.some((o) => o.id === cookieValue))
    return orgs.find((o) => o.id === cookieValue)!;
  return orgs[0] ?? null;
}

/** Resolve the active org for the current request. React-cache()-wrapped.
 *  Calls getUserOrgs() (RLS-scoped == membership verified) then intersects the
 *  cookie against that list. A foreign/stale cookie is inert. Throws propagate
 *  from getUserOrgs (transient DB error is not "no org"). */
export const resolveActiveOrg = cache(async (): Promise<UserOrg | null> => {
  const orgs = await getUserOrgs();
  const raw = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  return pickActiveOrg(orgs, raw);
});

/** Convenience: the active org id, or "" when the user has no org. */
export async function getActiveOrgId(): Promise<string> {
  return (await resolveActiveOrg())?.id ?? "";
}
```

**Design choice — resolver fetches internally, unlike `getActiveWorkspaceId`
which takes a `workspaces` param.** Rationale: nearly every call site currently
does `const orgs = await getUserOrgs(); const org = orgs[0]` — two lines that
collapse to one `await resolveActiveOrg()`. Because `getUserOrgs()` is already
`cache()`-wrapped, calling it inside the resolver is free (deduped per request).
The switcher's data loader still calls `getUserOrgs()` directly for the **full
list** and `resolveActiveOrg()` for the active one; the React cache means both
share one query.

**Type:** reuse `UserOrg` (`Pick<Organization,"id"|"name"|"timezone">`) from
`src/lib/auth/session.ts` — do not declare a new shape.

## 5. The switch action

New file `src/lib/org/active-actions.ts` (`"use server"`), mirrors
`setActiveWorkspace`:

```ts
export async function setActiveOrg(orgId: string): Promise<void> {
  // Defense-in-depth: only persist an org the caller actually belongs to.
  // (Reads already re-verify via resolveActiveOrg; this just avoids writing junk.)
  const orgs = await getUserOrgs();
  if (!orgs.some((o) => o.id === orgId)) return;
  const jar = await cookies();
  jar.set(ACTIVE_ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
```

No `revalidateTag` (org-keyed caches self-select). Caller does `router.refresh()`.

## 6. The switcher UI

New file `src/components/shell/org-switcher.tsx` — a near-copy of
`workspace-switcher.tsx`:

- Props `{ orgs: UserOrg[]; activeOrgId: string; collapsed?: boolean }`.
- **Renders `null` when `orgs.length <= 1`** (the common case — most users see
  nothing new). Mirrors `if (workspaces.length === 0) return null`.
- Dropdown lists orgs with a check on the active one; `onSelect` →
  `startTransition(async () => { await setActiveOrg(id); router.refresh(); })`.
- Collapsed-rail variant with tooltip, same as workspace switcher.
- **No "New organization" item** (org minting is onboarding-gated — see §10 Q1).
  A "Manage" link is out of scope (no per-org settings page today).

**Placement:** above the `WorkspaceSwitcher` in
`src/components/shell/sidebar-nav.tsx` (org is the parent of workspace). Because
the switcher self-hides for single-org users, the sidebar is visually unchanged
for them. Mobile nav renders the same `SidebarNav`, so it's inherited.

**Design system:** styling is copied verbatim from the workspace switcher
(existing tokens), so no new `pulse-ui` design work — but the implementer still
loads `pulse-ui` before touching the component per working agreement #3.

## 7. Data-flow & the stale-workspace interplay

`getSidebarNavData()` (in `sidebar-nav-data.tsx`) currently:
`orgId = orgs[0]?.id ?? ""` → `listWorkspacesCached(orgId)` →
`getActiveWorkspaceId(workspaces)`.

After: `orgId = (await resolveActiveOrg())?.id ?? ""` — and it also passes
`orgs` + `activeOrgId` to `SidebarNav` for the switcher.

**Crucial free win:** when the org changes, the active-**workspace** cookie may
still reference a workspace in the _old_ org. `getActiveWorkspaceId` already
validates the ws-cookie against **this org's** workspace list and falls back to
`workspaces[0]` — so the stale ws-cookie **self-heals** on org switch with **no
extra code**. We document this; we do not clear the ws cookie.

## 8. Performance & data-fetching budget (working agreement #5)

- **First paint:** unchanged. `resolveActiveOrg()` adds **0 queries** —
  `getUserOrgs()` and `cookies()` are already read on these paths; the React
  cache dedupes `getUserOrgs()` across the resolver + the switcher loader.
- **Switch interaction:** it **changes server-data scope** (org → different
  workspaces/boards/dashboards), so per rule #5 it is a Server Action
  (`setActiveOrg`) + `router.refresh()` — **not** a `<Link>`/router navigation,
  and **not** History-API in-page state. Identical mechanism to the workspace
  switch. No new round-trips beyond the single refresh.
- **Bounded reads:** no change to any query shape; no new `select *`. The
  resolver reads only the already-narrowed `UserOrg` fields.

## 9. Migration surface — the authoritative `orgs[0]` / `getUserOrgs()[0]` call-site list

**Count: 22 non-test files, ~30 selection occurrences.** The brief's "~15" under-
counted because the entire `src/lib/ai/*` subtree uses the
`(await getUserOrgs())[0]` idiom, which a raw `orgs[0]` grep misses. Full list
(verified by `grep -rn "orgs\[0\]\|getUserOrgs())\[0\]"` excluding tests):

**Shell / components (2)**

- `src/components/shell/sidebar-nav-data.tsx:19` — `orgs[0]?.id` (also gains switcher props)
- `src/components/shell/command-palette-data.tsx:16` — `orgs[0]?.id`

**Pages (3)**

- `src/app/home/page.tsx:29` — `orgs[0]`
- `src/app/(app)/dashboards/page.tsx:9` — `orgs[0]?.id`
- `src/app/(app)/settings/page.tsx:40` — `orgs[0]` ⚠️ **build-collision with the parallel notification-prefs work — coordinate merge order (see §10 Q3)**

**Lib — non-AI (7)**

- `src/lib/org/guard.ts:15` — `orgs[0]?.id` (`isOrgAdmin`)
- `src/lib/goals/queries.ts:93` — `orgs[0]?.id` (`getGoalOwners`)
- `src/lib/datetime/user-timezone.ts:24` — `orgs[0]?.timezone` (fallback tz)
- `src/lib/time/actions.ts:30` — `orgs[0]?.id` (`upsertTimeAllocation`)
- `src/lib/workspaces/actions.ts:24, 49, 69` — 3 sites (create/rename/delete); also update the `// … the shell's orgs[0]` comment at :48
- `src/lib/workload/queries.ts:90, 170` — 2 sites (`getWorkloadGrid`, `getWorkloadPageData`)
- `src/lib/workload/actions.ts:23, 58` — 2 sites (`upsertMemberCapacity`, `setWorkloadDefaults`)

**Lib — AI subtree (10 files)** _(the surface the brief missed)_

- `src/lib/ai/actions.ts:122` — `orgs[0]`
- `src/lib/ai/board-actions.ts:56` — `orgs[0]`
- `src/lib/ai/settings-actions.ts:29, 52` — 2 sites
- `src/lib/ai/ask/actions.ts:36` — `(await getUserOrgs())[0]`
- `src/lib/ai/write/actions.ts:80, 135` — 2 sites
- `src/lib/ai/summarize/actions.ts:42` — `(await getUserOrgs())[0]`
- `src/lib/ai/column-fill/actions.ts:73` — `(await getUserOrgs())[0]`
- `src/lib/ai/item-assist/actions.ts:77` — `(await getUserOrgs())[0]`
- `src/lib/ai/import-mapping-actions.ts:93` — `(await getUserOrgs())[0]`
- `src/lib/ai/automation-gen-actions.ts:45` — `(await getUserOrgs())[0]`

**Confirmed NOT to change** (use `getUserOrgs()` for existence/membership, not
index-0 selection): `src/app/onboarding/page.tsx` & `src/app/onboarding/actions.ts`
(both gate on `orgs.length`), `src/lib/org/queries-cached.ts` & `src/lib/profile/actions.ts`
(comment references only), and `src/lib/auth/session.ts` (defines `getUserOrgs`).

### Migration strategy — **resolver-with-safe-default, incremental, behavior-preserving**

**Not a big-bang rename.** Each site swaps
`getUserOrgs() … [0]` → `resolveActiveOrg()` (or `getActiveOrgId()` where only the
id is needed). Because `pickActiveOrg` falls back to `orgs[0]` when there is no
cookie, **every migrated site returns the identical value it did before** for any
user who hasn't switched — so each edit is independently correct and shippable,
and the switcher genuinely only changes behavior once a multi-org user selects a
different org. This lets the broad refactor land in **safe, batched, area-scoped
groups** (see the plan's Execution DAG) instead of one risky mega-commit, and
keeps merge-conflict blast radius small.

Mechanical rule per site:

- `const orgs = await getUserOrgs(); const org = orgs[0]` → `const org = await resolveActiveOrg()`
- `const orgId = orgs[0]?.id ?? ""` → `const orgId = await getActiveOrgId()`
- Where `getUserOrgs()` is fetched in a `Promise.all([...])` **only** to reach
  `[0]`, drop it from the tuple and call the resolver (cache dedupes, so no extra
  query). Where the full list is still needed (switcher loader), keep both.

## 10. Open questions for the owner

- **Q1 — "Create organization" in the switcher?** Default: **no.** Org minting is
  gated in `onboarding/actions.ts` (a member can't loop it to mint orgs). Confirm
  the switcher stays selection-only.
- **Q2 — Cookie vs DB persistence.** Default: **cookie-only** (mirrors workspace
  switcher; UX-only, RLS is the boundary). Cross-device "sticky" active org would
  need a `profiles.active_org_id` column + migration — deferred. Confirm.
- **Q3 — settings/page.tsx merge coordination.** `settings/page.tsx:40` is also
  edited by the parallel notification-prefs work. Default plan: sequence the
  settings edit as its own small task and land it after (or coordinate a rebase
  with) notif-prefs to avoid a build-breaking conflict. Confirm ordering.
- **Q4 — Single-org visibility.** Default: switcher **hidden** for `orgs.length <= 1`.
  Alternative: show it disabled to hint multi-org exists. Confirm hidden is fine.

## 11. Testing strategy (full detail in the plan)

- **Unit:** `pickActiveOrg` truth table (cookie matches / cookie foreign / cookie
  stale / empty list / no cookie). Pure fn → no mocks.
- **Resolver/action:** `resolveActiveOrg` returns cookie-matched org; falls back
  to `orgs[0]`; `setActiveOrg` ignores a foreign id; sets cookie for a valid id.
- **Component:** `org-switcher.test.tsx` — renders null for ≤1 org; lists orgs;
  calls `setActiveOrg` + refresh on select; marks active.
- **Regression:** every migrated file keeps its existing tests green (behavior-
  preserving). The four gates (`typecheck/lint/test/build`) must pass.
- **Manual E2E:** seed a user into 2 orgs on DEV; switch; verify boards/
  dashboards/workspaces/settings all reflect the new org and the choice survives
  a reload. (Walkthrough in the plan.)

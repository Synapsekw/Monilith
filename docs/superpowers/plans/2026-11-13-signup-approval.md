# Signup Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every new account waits for a platform admin; an account that is not approved cannot join an organisation and sees a waiting screen.

**Architecture:** A service-only table `account_approvals` holds the status. A `before insert` trigger on `org_members` is the database rule. The app reads the status through a tagged server cache and gates `requireUser`, `/home` and the auth callback. Platform admins approve or reject from `/admin/users`.

**Tech Stack:** Next.js 16.3.4 (App Router, Cache Components), Supabase (Postgres, RLS, auth), Zod 4, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-11-13-signup-approval-design.md`

## Global Constraints

- This is Next.js 16. Read the relevant guide in `node_modules/next/dist/docs/` before writing framework code, in particular `use cache`, `cacheTag` and `updateTag`. Copy the caching pattern from `isPlatformAdminCached` in `src/lib/platform/guard.ts`; do not invent one.
- Work in the worktree `.claude/worktrees/signup-approval`. Implementers never run `scripts/finish-task.sh`, never merge, never push.
- Commit identity `Danijel Jovanovic <info@synapse-solutions.ai>`. Stage by path only. Subjects lower-case after the type, at most 100 characters. Import zod as `import * as z from "zod"`.
- The migration `supabase/migrations/20261113091436_signup_approval.sql` is written and applied by the orchestrator. Implementers do not edit it, do not write another migration, and never hand-edit `src/types/database.types.ts`.
- New tests are unit tests with fakes. A hand-rolled Supabase fake must record and apply its filters (`src/test/query-double.ts`, `src/test/mcp-fake-client.ts` show the shape). No `*.integration.test.ts` files.
- Server Actions return `ActionResult` and use `fail`/`ok` from `src/lib/actions/result.ts`.
- The status is read with the service client only, on the server only. `SUPABASE_SERVICE_ROLE_KEY` never reaches the browser.
- A failed status read must never let an account through and must never be shown as "pending": it throws.
- A missing row counts as `pending`.
- User-facing copy never says "Pulse". UI work loads the `pulse-ui` and `frontend-design` skills first.
- `(app)/layout.tsx` and `AuthenticatedShell` must not await request-time APIs (`src/test/static-shell.test.ts`). Do not add the gate there.
- `src/proxy.ts` must not query the database. Do not add the gate there.
- Run commands in the foreground with a 600000 ms timeout.

## Performance and data-fetching budget

- First paint for an approved account: the status comes from a tagged server cache (profile `guard`, revalidated every 300 s per server instance); at most one small query per account per instance per 300 s. An account that is not approved is always re-read live.
- `/admin/users` first paint: one extra bounded query (pending accounts, limit 50).
- Approve and Reject: Server Actions; they clear one cache tag and revalidate `/admin`.
- No in-page interaction refetches server data.

## File structure

| File                                                                       | Responsibility                                                                |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `supabase/migrations/20261113091436_signup_approval.sql` (done)            | Table, backfill, signup trigger, membership trigger, admin search             |
| `src/lib/auth/approval.ts` (new)                                           | Read the status; gate; cache tag name                                         |
| `src/lib/auth/session.ts` (modify)                                         | `requireUser` calls the gate                                                  |
| `src/app/home/page.tsx` (modify)                                           | Calls the gate                                                                |
| `src/app/auth/callback/route.ts` (modify)                                  | Unapproved accounts skip setup                                                |
| `src/lib/auth/finish-setup.ts` (new)                                       | Redeem invitations, otherwise provision (shared by callback and pending page) |
| `src/app/onboarding/page.tsx` (modify)                                     | Redeem invitations before showing the form                                    |
| `src/app/pending-approval/page.tsx`, `actions.ts` (new)                    | Waiting screen, check again, sign out                                         |
| `src/lib/platform/queries.ts`, `actions.ts`, `search-action.ts` (modify)   | Status in user rows; pending list; approve and reject                         |
| `src/components/admin/pending-accounts.tsx` (new), `user-row.tsx` (modify) | Pending section; status label                                                 |
| `src/app/admin/users/page.tsx`, `src/app/admin/page.tsx` (modify)          | Mount the section; waiting count                                              |

---

### Task 1 (orchestrator): Apply the migration and regenerate types

- [ ] Dry-run the migration plus assertions inside `begin; … rollback;` on DEV through the `supabase-dev` MCP. Expected: the assertion block ends with `DRYRUN_OK`.
- [ ] Apply with `apply_migration`, name `signup_approval`, then `pnpm db:ledger-check`; if the ledger stamped another version, run `scripts/reconcile-migration-version.sh <ledger-version> 20261113091436`.
- [ ] Regenerate `src/types/database.types.ts` with the MCP `generate_typescript_types`, format with prettier, commit with subject `feat(auth): add account approvals table and membership rule`.
- [ ] `pnpm vitest run src/lib/supabase/anon-reachability.conformance.test.ts` passes.

### Task 2: Approval lookup and the app gate

**Files:** create `src/lib/auth/approval.ts`, `approval.test.ts`, `src/lib/auth/finish-setup.ts`, `finish-setup.test.ts`; modify `src/lib/auth/session.ts` (+ `session.test.ts`), `src/app/home/page.tsx` (+ test), `src/app/auth/callback/route.ts` (+ `route.test.ts`), `src/app/onboarding/page.tsx` (+ a page test if none exists).

**Interfaces:**

- Consumes: `account_approvals` table types; `createServiceClient`; `redeemInvitationsForUser` (`src/lib/auth/redeem.ts`); `provisionAccountForUser` (`src/lib/auth/provision.ts`); `SessionUser` (`src/lib/auth/session.ts`).
- Produces:
  - `type ApprovalStatus = "pending" | "approved" | "rejected"`
  - `approvalTag(userId: string): string` returning `` `account-approval:${userId}` ``
  - `getAccountApproval(userId: string): Promise<ApprovalStatus>` — `use cache` with `cacheTag(approvalTag(userId))`, service client, `.from("account_approvals").select("status").eq("user_id", userId).maybeSingle()`; error throws `new Error("Could not verify account approval.")`; no row returns `"pending"`.
  - `PENDING_APPROVAL_PATH = "/pending-approval"`
  - `enforceApproval(user: Pick<SessionUser, "id">): Promise<void>` — redirects to `PENDING_APPROVAL_PATH` unless the status is `"approved"`.
  - `finishAccountSetup(user: SessionUser): Promise<{ ok: true } | { ok: false; reason: "provisioning" }>` — the exact redeem-then-provision sequence currently inline in the callback route, moved without behaviour change.

- [ ] **Step 1:** Read `src/lib/platform/guard.ts` (`isPlatformAdminCached`), `src/lib/auth/session.ts`, `src/app/auth/callback/route.ts`, `src/app/home/page.tsx`, `src/app/onboarding/page.tsx` and their tests.
- [ ] **Step 2: Failing tests for `approval.ts`.** Cases, each asserting on behaviour through a filter-applying fake of the service client: a row with `approved` returns `"approved"`; `pending` and `rejected` return themselves; no row returns `"pending"`; a query error rejects with "Could not verify account approval."; the query filters on `user_id` equal to the id passed (a fake that returns the row only for the matching id; a different id gets `"pending"`); `enforceApproval` calls `redirect("/pending-approval")` for pending and rejected and does not redirect for approved; `enforceApproval` propagates the read error and does not redirect.
- [ ] **Step 3:** Run them, see them fail, implement `approval.ts`, see them pass.
- [ ] **Step 4: `requireUser`.** Failing tests first in `session.test.ts`: an approved user is returned; a pending user triggers `redirect("/pending-approval")`; the password-change redirect still wins when both apply (it runs first); an unauthenticated request still redirects to login and never reads the approval. Then add `await enforceApproval(user)` after `enforcePasswordChange(user)`.
- [ ] **Step 5: `/home`.** It calls `getUser()` and `enforcePasswordChange` itself. Add the same call after it, with a test that a pending user is redirected before any org or board read.
- [ ] **Step 6: `finishAccountSetup`.** Move the callback's redeem-then-provision block into `finish-setup.ts` unchanged; tests: invitations redeemed means no provisioning; none redeemed means provisioning runs; a provisioning error returns `{ ok: false, reason: "provisioning" }`.
- [ ] **Step 7: Callback.** Failing tests first: after `exchangeCodeForSession`, a user whose status is not approved is redirected to `/pending-approval` and neither redeem nor provision is called; an approved user goes through `finishAccountSetup` exactly as before (existing tests keep passing); a failed status read redirects to `/login?error=provisioning` and runs no setup.
- [ ] **Step 8: Onboarding.** Before rendering the form, call `redeemInvitationsForUser`; if any invitation was redeemed, `redirect("/")`. Test both branches. A redeem error falls through to the form.
- [ ] **Step 9:** `pnpm typecheck`, `pnpm lint`, `pnpm vitest run src/lib/auth src/app/auth src/app/home src/app/onboarding`. Commit: `feat(auth): gate unapproved accounts behind a waiting screen`.

### Task 3: The waiting screen

**Files:** create `src/app/pending-approval/page.tsx`, `actions.ts`, `page.test.tsx`, `actions.test.ts`. Check `src/proxy.ts` and `src/proxy.test.ts`: `/pending-approval` must require a session (it is not a public route) and must not be in the auth-route list.

**Interfaces:**

- Consumes: Task 2's exports; `getUser` (not `requireUser`, which would loop); the existing sign-out action in `src/app/auth/actions.ts`.
- Produces: `checkApproval(): Promise<ActionResult>` — a Server Action that re-reads the status **uncached** (direct service-client read, not `getAccountApproval`), and when approved calls `updateTag(approvalTag(user.id))`, runs `finishAccountSetup`, then `redirect("/home")`; otherwise returns `ok()` so the page re-renders its message.

- [ ] **Step 1:** Failing page tests: no session redirects to login; an approved account redirects to `/home`; pending shows "Your account is waiting for approval" and explains that an administrator has to approve it; rejected shows "Your account was not approved"; both show the signed-in email, a "Check again" button and "Sign out".
- [ ] **Step 2:** Failing action tests: not signed in fails; pending returns ok and runs no setup; approved clears the tag, runs `finishAccountSetup` once and redirects to `/home`; a provisioning failure returns `fail("We couldn't finish setting up your account. Please try again.")` and does not redirect; a failed status read fails without setup.
- [ ] **Step 3:** Implement the page (a Server Component using the auth pages' existing layout and components in `src/app/(auth)` and `src/components/auth`; match their look) and the action. The form posts to the action; no client-side polling.
- [ ] **Step 4:** `pnpm typecheck`, `pnpm lint`, the page and action tests, `pnpm vitest run src/proxy.test.ts`. Commit: `feat(auth): add the pending approval screen`.

### Task 4: Admin approve and reject

**Files:** modify `src/lib/platform/queries.ts` (+ test), `src/lib/platform/actions.ts` (+ test), `src/lib/platform/search-action.ts`, `src/components/admin/user-row.tsx`, `src/components/admin/user-row-actions.tsx` (+ test), `src/app/admin/users/page.tsx` (+ test), `src/app/admin/page.tsx`; create `src/components/admin/pending-accounts.tsx` (+ test).

**Interfaces:**

- Consumes: the `platform_search_users` RPC's new `approval_status` column and `p_only_status` parameter; `approvalTag` from Task 2 (if Task 2 has not merged yet, define the same string locally with a comment naming `src/lib/auth/approval.ts` and replace it on rebase); `isPlatformAdmin`; `createServiceClient`; `platformUserTargetSchema`.
- Produces:
  - `PlatformUser` gains `approvalStatus: "pending" | "approved" | "rejected"` and `createdAt: string`.
  - `listPendingAccounts(limit = 50): Promise<PlatformUser[]>` — the RPC with `p_only_status: "pending"`.
  - `countPendingAccounts(): Promise<number>` — service client, `account_approvals`, `status = 'pending'`, `count: "exact", head: true`; only called after a platform-admin check.
  - `platformApproveUser(input: unknown): Promise<ActionResult>` and `platformRejectUser(input: unknown): Promise<ActionResult>`.
  - `approveUserAction(userId: string)`, `rejectUserAction(userId: string)` in `search-action.ts`, in the style of the existing wrappers.

- [ ] **Step 1:** Read `src/lib/platform/actions.ts` (`setUserBan` is the template: validate, actor, admin check, service write, audit row, revalidate), its test, `queries.ts`, `search-action.ts`, the admin users page and both row components.
- [ ] **Step 2: Failing action tests.** Invalid input fails; unauthenticated fails; a non-admin fails and writes nothing; success updates `account_approvals` for exactly that `user_id` with the new status, `decided_at` set and `decided_by` the actor (use a filter-applying fake: a second user's row must be unchanged); an update that matches no row inserts the row with that status (upsert on `user_id`); success inserts an `admin_audit_log` row with `actor_kind: "platform"`, `action: "platform.user_approved"` or `"platform.user_rejected"`, `target_user_id` and `target_email`; success calls `updateTag(approvalTag(userId))` and `revalidatePath("/admin")`; a database error fails, writes no audit row and clears no tag. An admin may not reject their own account.
- [ ] **Step 3:** Implement the two actions through one private helper, as `setUserBan` does. Resolve `target_email` with `svc.auth.admin.getUserById`.
- [ ] **Step 4:** Queries: map `approval_status` and `created_at`; add `listPendingAccounts` and `countPendingAccounts`; tests assert the RPC arguments and the mapping.
- [ ] **Step 5: UI.** `PendingAccounts` renders nothing when the list is empty; otherwise a section titled "Waiting for approval" with one row per account (email, signed-up date, organisations if any) and Approve and Reject buttons that call the wrappers, disable while pending, and show the error with the existing mutation toast helper (`src/lib/ui/mutation-toast.ts`). Reject asks for confirmation with the existing `alert-dialog` primitive. Mount it above the people list on page 0 of `/admin/users` only. In `UserRow`, the status column shows "Pending" or "Not approved" when the account is not approved, ahead of the existing "Banned"/"Active" logic; `UserRowActions` gains "Approve" for pending and rejected accounts.
- [ ] **Step 6:** The admin overview (`src/app/admin/page.tsx`) shows "N accounts waiting for approval" linking to `/admin/users` when N is above zero.
- [ ] **Step 7:** Tests for the component and the page section (empty, populated, Approve calls the wrapper with the id, Reject needs confirmation).
- [ ] **Step 8:** `pnpm typecheck`, `pnpm lint`, `pnpm vitest run src/lib/platform src/components/admin src/app/admin`. Commit: `feat(admin): approve and reject new accounts`.

### Task 5: Keep end-to-end specs and seeds working

**Files:** every `e2e/**/*.ts` and `e2e/**/*.spec.ts` that calls `auth.admin.createUser`; `supabase/fixtures/tier2-fixture-users.dev-only.sql`; `CONTRIBUTING.md`.

- [ ] **Step 1:** `grep -rn "createUser(" e2e src --include=*.ts --include=*.tsx`. For each call in `e2e/` and in `*.integration.test.ts*` and `*.fixtures.test.ts` files, add `app_metadata: { pre_approved: true }` (merge with any existing `app_metadata`). If a shared helper creates users, change the helper once.
- [ ] **Step 2:** In the dev-only fixture SQL, after each inserted `auth.users` row is created, ensure an `account_approvals` row with `approved` exists (`insert … on conflict (user_id) do update set status = 'approved'`).
- [ ] **Step 3:** Add a short "New accounts need approval" paragraph to `CONTRIBUTING.md` next to the testing section: what `pre_approved` does, that a person signing up cannot set it, and that any migration that seeds an `auth.users` row which must hold a membership has to approve it.
- [ ] **Step 4:** `pnpm typecheck`, `pnpm lint`. Commit: `test(auth): create test accounts as pre-approved`.

### Task 6 (orchestrator): Gates, whole-branch review, live run

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
- [ ] Whole-branch review on the most capable model, with these questions: any path that gives an unapproved account a membership or tenant data; any place the service-role read could be reached from the client; whether a platform admin or an existing account can be locked out; whether the cache can serve "approved" after a reject or "pending" after an approve.
- [ ] Live run in the owner's browser: sign up a throwaway account, see the waiting screen, approve it from `/admin/users` in another session, press "Check again", land in the app; reject path with a second throwaway; delete both accounts with the existing admin action. Confirm an existing account signs in normally.
- [ ] Record results in the session note, then `scripts/finish-task.sh`.

## Execution DAG

| Task                      | Depends on |
| ------------------------- | ---------- |
| 1 Migration and types     | none       |
| 2 Lookup and gate         | 1          |
| 3 Waiting screen          | 2          |
| 4 Admin                   | 1          |
| 5 Specs and seeds         | 1          |
| 6 Gates, review, live run | 2, 3, 4, 5 |

Parallel batches: (1), then (2, 4, 5), then (3), then (6). Critical path: 1 → 2 → 3 → 6. Tasks in one batch run in separate worktrees cut from the task branch; the orchestrator merges them one at a time.

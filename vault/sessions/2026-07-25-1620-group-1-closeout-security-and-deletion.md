---
type: session
date: 2026-07-25-1620
branch: develop
trigger: wrapup
status: complete
tags: [session, security, migrations, mcp, auth, tooling]
related:
  [
    "[[2026-07-25-1056-settings-redesign-mcp-guide]]",
    "[[2026-07-24-1950-mcp-server-oauth]]",
    "[[2026-07-25-gotcha-57-dev-applied-migration-with-no-committed-file]]",
    "[[2026-07-25-gotcha-59-definer-acl-default-privileges-not-load-bearing]]",
    "[[2026-07-25-gotcha-60-server-action-side-effects-invisible-to-mcp]]",
  ]
---

# Group 1 closeout — security, deletion, and the gates that should have caught it

## What changed

- **`/whats-next` triage found the north-star badly stale, again:** the promotion it listed as
  "Next" had already shipped (#72, `main` @ `186782d`), prod's ledger was already at full 111/111
  parity so the gotcha-57 ACL migration had already ridden along, and §2 still listed E2/E3/E4 as
  open epics when they went to prod in #62. **E6 is the only genuinely open Phase-10 epic.**
- **Owner picked all of Group 1** (the carryover bucket) and dropped the prod-DB-password rotation.
  Six worktrees scoped to plans, then built and merged serially: `c72bc02`.
- **#3 definer ACL lockdown** — 8 `SECURITY DEFINER` functions in `public` were `anon`-executable on
  **both DEV and PROD**, two of them `vault.secrets`-deleting triggers. Migration
  `20260725102610` + an in-migration class-wide assertion. DEV is now 114 definer functions, 0
  anon-executable. Also restored the `TO authenticated` clause `20260720090620` omitted on
  `item_embeddings_select`.
- **#4 `/login` `?next=`** — closed a **live open redirect** (`?next=%2F%0A%2Fevil.com` reached
  `https://evil.com/` on `develop`: control chars were unfiltered and browsers strip them before
  parsing) and un-login-walled `/api/mcp`, `/api/oauth/*`, `/.well-known/oauth-*`, which the proxy
  had been 307ing — so **the MCP OAuth flow was unreachable end-to-end for any external client**.
- **#5** rate-limited `/api/oauth/register` (per-IP 10/10min + global 200/h, fail-closed scoped to
  that one endpoint). **#7** deduped the MCP tool layer (6 `GetClient` → 1, 2 `writeCellValue` → 1;
  22 mutations, 0 survivors). **#6** added `pnpm db:ledger-check`, wired into `finish-task.sh`,
  `/sync-prod` and `/promote`.
- **#8 delete account** — account deletion was **impossible for anybody**: every user creates an org
  at onboarding and `organizations_created_by_fkey` blocked the delete. Same FK made
  `platformDeleteUser` a latent bug, so the admin "Delete permanently" button had **never worked**.
  Fixed by per-column hybrid (reassign 13 ownership columns to a live active owner, cascade
  `time_entries`, SET NULL 14 attributive) + 9 missing indexes + orphaned-avatar deletion.
- Direct on `develop`: wordmark standalone mark reverted (`0158029`), prod-password rotation removed
  from Owed (`f0a3b47`), explicit time budgets for two load-sensitive interaction tests (`3a52f9a`).

## Why

Group 1 was three sessions of accumulated carryover that read as small follow-ups. Scoping it
properly revealed the opposite: two items were **live exploitable or live broken in production**
(the open redirect, the anon-executable vault-secret triggers), two were **shipped features that had
never worked** (account deletion, the admin delete button, the MCP OAuth flow), and one shipped
feature has been silently inert in prod for three weeks (the health digest). The pattern is that
nothing in the toolchain notices a feature that ships and then does nothing — which is why #6's
ledger gate and #3's in-migration assertion matter more than their size suggests.

## How to test (for the user)

Pull `develop`, `pnpm install`, `pnpm dev`, private window.

1. **Open redirect:** visit `/auth/callback?next=%2F%0A%2Fexample.com` → lands on `/`. Before today
   it navigated to `https://example.com/`.
2. **Resume after login:** signed out, visit `/boards` → URL is `/login?next=%2Fboards`; sign in →
   you land on `/boards`, not the dashboard.
3. **Delete account:** sign up a throwaway, complete onboarding, `/settings/security` → **Delete
   account**. As sole owner it refuses with a clear message and deletes nothing. Add a second owner,
   retry → signed out to `/login?deleted=1`; the surviving owner inherits the boards (still
   archivable and restorable from Trash) and item updates read as **Pulse Autopilot** (decision D2).
4. **Admin delete:** as platform admin, `/admin/users` → **Delete permanently** on a throwaway →
   succeeds. It always failed before.
5. **Rate limit:** POST `/api/oauth/register` 11× → ten `201`s then `429` with `Retry-After`.

## Open threads

- **`/sync-prod` has NOT run — PROD is still exposed.** All 8 anon-executable definer functions,
  including the two `vault.secrets` deleters, remain live in prod. **Ordering is load-bearing:
  `/sync-prod` must precede the promotion**, or prod ships a Delete Account button with no
  reassignment RPC behind it.
- **Prod Vault is empty** — no `app_url`, `ai_pgnet_hmac_secret`, or `digest_secret`. Consequences:
  E5 semantic search returns nothing (`item_embeddings` = 0 rows against 380 live items) and
  **`digest_runs` = 0 rows ever — the health digest has never fired in prod** since shipping
  2026-07-03. Crons all report `succeeded` (they notice the missing secret and skip), so nothing
  alerts. `/sync-prod` pushes schema, not Vault secrets — that gap is structural and unguarded.
- **E5 prod env blocked:** the two `vercel env add` commands were denied by the permission classifier
  (writing a secret to prod). `.env.local` was corrected locally (`OPENAI_API_KEY` →
  `OPENAI_EMBEDDING_API_KEY`, which is the only name the code reads). Generated HMAC secret is in the
  session scratchpad. Health digest deliberately untouched — provisioning it starts emailing real
  users with three weeks of backlog.
- **Finding F1 — MCP assigns people without notifying them.** Real, user-visible, still open; see
  [[2026-07-25-gotcha-60-server-action-side-effects-invisible-to-mcp]]. Fix is now a one-line swap
  once `upsertCellCore` is hoisted.
- **#2 MCP end-to-end test** is finally _possible_ thanks to #4, but needs a deployed prod, so it
  comes after `/sync-prod` + promote.
- Integration suites still **skip** (no `.env.test`; the guard deny-lists DEV) — #8 compensated with
  a static tripwire parsing the committed migration plus rolled-back MCP probes on DEV. A skip is
  not a pass.
- `SmartFillDialog.test.tsx` flaked under contention and was **not** given a budget — only
  `timezone-form` and `cells` were. May resurface.
- **gotcha-55 recurred twice** (MCP `apply_migration` version drift), reconciled both times.
- Delete-account decisions **D1/D3/D4** shipped as owner-delegated defaults; D1's `target_email`
  purge window is documented but unbuilt.

## Next session entry point

**`/sync-prod` first, then promote `develop → main`** — in that order. Then provision prod Vault +
the two Vercel env vars, run the embeddings backfill, and finally the real MCP connection test.
After that the board is clear for a roadmap build: **Report Builder v2** (charts + wide-board table),
**Ask Pulse Phase 2** (write actions in `/ask` — engine and confirm card already exist, S–M), or
**E6** Stripe.

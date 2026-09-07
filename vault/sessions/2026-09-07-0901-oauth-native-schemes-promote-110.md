---
type: session
date: 2026-09-07-0901
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-09-07-gotcha-100-a-validator-reused-across-a-boundary-inherits-the-wrong-requirement]]"
  - "[[2026-08-06-gotcha-76-exact-redirect-uri-matching-locks-out-every-cli-client]]"
  - "[[2026-09-05-1314-settings-menu-blank-streaming-redirect]]"
---

# Native-client OAuth schemes, then PR #110 to production

## What changed

- **Fixed MCP OAuth registration for native clients** (`653294fe`, worktree
  `task/oauth-native-redirect-schemes`). `src/lib/validations/mcp-oauth.ts` validated every
  `redirect_uri` with `isHttpUrl` — the board **link-cell** XSS guard — so `cursor://…` was
  rejected `invalid_client_metadata: URL must be http or https` and no desktop client could
  register. New `isAllowedRedirectUri` in `src/lib/mcp/oauth/redirect-uri.ts`, shared by all
  three schemas (register, authorize, token): http(s) always; other schemes only in
  hierarchical `scheme://…` form and not in a deny list. 24 tests added; `isHttpUrl` untouched.
- **Checked the Server-Action redirect risk rather than assuming it.** Traced Next 16: a
  `cursor://` target is an external action redirect server-side (host mismatch → empty body +
  `x-action-redirect`) and `location.replace()` client-side (private-use URLs have origin
  `null`). No consent-route change needed.
- **Verified live before merging** — dev server: `cursor://` registers 201, authorize carries
  it to `/login`, `javascript:` still 400s. The probe client row was deleted from DEV.
- **Promoted `develop → main`, PR #110** (`dd11b086`), 33 commits: this fix plus the whole
  **Spec 3** batch built in the four parallel worktrees — agent delegation with depth/fan-out
  enforced in the claim RPC, `@handle` addressing in item updates, mentions and Ask, the nested
  run tree with subtree token totals, the per-org assistant name, and the run-graph migrations.
  Squash divergence healed (`b5aca95c`).
- **Wrote [[2026-09-07-gotcha-100-a-validator-reused-across-a-boundary-inherits-the-wrong-requirement]]**
  and announced the fix on `/updates` (backdated to the 2026-09-05 ship date).

## Why

The bug was reported from outside the repo: a session driving Cursor could not connect its MCP
client, and its diagnosis pointed at Monolith's register endpoint. Confirming it took one grep —
the endpoint really was reusing a guard written for a different threat model. Left unfixed, the
MCP server worked only for `claude.ai` and loopback CLIs, which is the same "correct for the only
client we had ever seen" failure as gotcha-76, one layer up.

Promotion followed because the fix is worthless on `develop`: the client connects to
`www.monolith.works`. That carried Spec 3 with it, which was already green and integrated.

## How to test (for the user)

1. In your desktop AI client (Cursor, Grok bot, any MCP client), remove the old dead Monolith
   connector entries — their `client_id`s point at rows registered before the fix.
2. Add the Monolith MCP server again and click **Connect**. Registration succeeds instead of
   erroring "URL must be http or https".
3. A browser tab opens on `www.monolith.works`. Sign in if prompted; you land on the consent
   screen.
4. Click **Allow access**. The browser offers to open your app; accept. The client receives the
   code on its private-use callback and shows as connected.
5. Run any Monolith MCP tool (list boards, read an item) — it returns your data with no second
   login.
6. Negative check: `curl -X POST https://www.monolith.works/api/oauth/register -H 'content-type:
application/json' -d '{"client_name":"x","redirect_uris":["javascript:alert(1)"]}'` returns
   `400 invalid_client_metadata`.

Confirmed by the owner on 2026-09-07: Grok bot connected end-to-end.

## Open threads

- **Closed after the wrapup:** the four `_draft-*.md` stubs (`2026-09-04-0904`, `2026-09-05-0919`,
  `2026-09-05-1119`, `2026-09-07-0433`) were deleted. Each was a pure Stop-hook stub — a `git diff
--stat` and `(fill in)` placeholders, no human prose — and the work they stubbed is committed and,
  for Spec 3, written up here.
- **Also committed after the wrapup** (`ce3c14c3`): the 2026-08-27 correction to
  `supabase/fixtures/tier2-fixture-users.dev-only.sql` and decision-31, which had sat uncommitted in
  the working tree. It records that `/sync-prod`'s **data** phase carries the fixture accounts into
  PROD regardless of the `fixtures/` vs `migrations/` placement the files used to claim protected
  them — the accounts were found live in PROD and deleted that day.
- `/updates` coverage still flags **2026-08-24** (the agent reference-documents build day). Its
  announcements ride a later date, so this is the known date-bucket noise, not a gap.
- The `http:` non-loopback redirect case (plaintext remote callback) is still accepted — out of
  scope here, worth a look if the OAuth surface is revisited.

## Next session entry point

`develop` == `main` == production, unpromoted delta 0, no live worktrees, ledger 156/156. Phase 10
has **E6 (Stripe) as its only open epic** — Specs 1, 2a, 2b, 2c and 3 are all in production (2c
still inert until an admin opens the org ceiling). Start there, or with the E5 embeddings backfill
that semantic surfaces still need in prod.

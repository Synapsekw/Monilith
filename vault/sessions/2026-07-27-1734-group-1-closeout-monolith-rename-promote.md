---
type: session
date: 2026-07-27-1734
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-07-27-gotcha-63-mcp-tool-surface-without-enumeration-forces-n-plus-1]]"
  - "[[2026-07-27-decision-31-tier2-permanent-tenant-fixtures]]"
  - "[[2026-07-27-gotcha-62-client-disconnect-kills-the-turn-before-it-bills]]"
---

# Group 1 closed out: Monolith rename, MCP list_items, promotion #78

## What changed

- **Seven branches built, gated and merged**, then promoted as PR **#78** (`main` @ `1121796`,
  CI green, Vercel deploy verified live — the CORS fix confirmed by curl against prod, not just a
  green status). Squash divergence healed (`4c09f7b`, `-s ours`).
- **`/ask` survives a client disconnect** ([[2026-07-27-gotcha-62-client-disconnect-kills-the-turn-before-it-bills]]) — the turn is now a detached
  promise handed to `after()`; the stream is a pure observer. **No migration, and no client change**:
  the persisted row already equals a completed one, so existing drop-recovery renders it.
- **Tier 2 fixtures** — two permanent DEV tenants make cross-tenant isolation a read-only assertion.
  Proven to bite on three deliberately broken policies, one of them an Ask Monolith policy that had
  **never executed** since shipping. `selectPurgeableUserIds` now exempts the fixtures, without which
  the age purge would have deleted them and left the suite passing **vacuously**.
- **The skip theatre ended** — 70 integration suites reported "skipped" on every run; they now live
  behind `pnpm test:integration`. Nothing deleted; decision-25 amended, not contradicted.
- **Digest bounded to its period** — the premise was half wrong. There is no catch-up loop
  (`since = now − 7 days`, hardcoded), so an empty `digest_runs` meant **one** digest per org, not
  three weeks. The real defect: `_board_health_counts` applied the window to `new_items` only, so the
  first prod email would have read "0 new activities · 51 overdue" going back six weeks. Fixed by
  period-scoping the **content**, which needs no seed row and is correct for a fresh org by
  construction. A `blocked` run status makes a skipped run visible instead of `pg_cron` reporting
  `succeeded`.
- **Monolith branding** — 13 user-visible strings, including the OAuth consent screen and the MCP
  `serverInfo.name`. All wire/storage/billing identifiers deliberately untouched. The Autopilot bot
  was renamed in UI **and** seeded DB identity together, since `profiles.full_name` is stamped on
  every update it has posted.
- **MCP `list_items`** ([[2026-07-27-gotcha-63-mcp-tool-surface-without-enumeration-forces-n-plus-1]]) — a board reads in 2 calls instead of ~164.
- **Prod schema synced**: 3 migrations applied via `db push` (115 → 118). The tier-2 seed correctly
  no-op'd on prod ("fixture accounts absent — skipping seed"), so **0 fixture users leaked**.
- **The rename finished across docs and the vault** (`51e9495`, then `536ee64`) — 143 files of prose,
  `CONTRIBUTING.md`, the `project/pulse` → `project/monolith` tag namespace (37 files), and a scoped
  prettier pass. Replacement fired only on a **standalone** `Pulse` token never adjacent to
  `[A-Za-z0-9_@./-]`, which structurally protects every slug, path, wikilink target and identifier;
  code fences and inline-code spans were skipped. Verified: 143 `M` and **zero renames**, no
  unresolved wikilinks, no orphans. Three sentences that describe the old branding **as a defect**
  were deliberately reverted to "Pulse" — renaming inside them would falsify the record.
- **Two prettier casualties caught by reading the diff, not trusting the tool:** it re-delimits
  markdown emphasis, turning `postgres_changes` into `postgres*changes` and `${board_id}` into
  `${board*id}` in prose. Both files reverted, the other 32 committed.

## Why

The board had accumulated eight carryover items that kept resurfacing every `/whats-next` without
ever being closed. The goal was to clear the whole group so only feature work remains. Six of the
eight closed; the rest are genuinely owner-actions on production, not agent work.

The two defects found mid-session — the "Pulse" branding on the consent screen and the five-minute
board read — both came from actually _using_ the product through Claude Desktop. Neither was visible
from inside the codebase.

## How to test (for the user)

1. Reconnect the MCP connector in Claude Desktop (remove and re-add — clients cache the tool list at
   connect time, so it cannot discover `list_items` otherwise). The approval screen should now read
   **"…wants to access your Monolith account"**.
2. Ask **"what's on the QCC board"**. Expect an answer from one or two calls, not minutes of
   `get_item` churn.
3. Ask something matching >50 items, e.g. "search QCC for 'a'". Expect an explicit truncation note
   pointing at `list_items`, not a silent 50.
4. Open `/ask`, start a long question, and **kill the network mid-stream**. Reload: the answer should
   be there, and an `ai_usage` row should exist for the turn.
5. Prod SQL: `select public._health_digest_ping();` then
   `select * from public.digest_runs where status = 'blocked';` — expect **one row naming
   `digest_secret`**. That is the alarm that was missing for three weeks.

## Open threads

- **`digest_secret` still absent from prod Vault.** The schema half is now live, so provisioning is
  safe. Note prod has **no `RESEND_API_KEY`** either, so the first runs file in-app notifications and
  send no email regardless — inspect `digest_runs.stats` before adding one.
- **E5 embeddings still inert.** `OPENAI_EMBEDDING_API_KEY` was in fact provisioned on Vercel
  2026-07-25 (the vault's "denied by the permission classifier" claim was stale). What remains is
  enqueueing existing items into `item_embed_queue` — the `embed-sweep` cron drains 50 every 2 min
  and signs its own call, so no secret handling is needed. **`supabase-prod` MCP is read-only**
  (`25006`), so this needs a paste into the prod SQL editor.
- **`/sync-prod`'s data phase was deliberately NOT run.** The guard passes (prod holds no independent
  orgs/users), but a full replace would copy DEV-only rows into prod — including the two Tier 2
  fixture accounts **whose passwords are committed to the repo**. Exclude them from the dump before
  any future data sync.
- **Ask Monolith write path still unexercised on prod.** Now worth doing, since the disconnect fix is
  live.
- **gotcha-55 recurred three times in one day** (MCP `apply_migration` stamping a different version
  than the committed file); reconciled each time. The frequency suggests the mint→apply handoff wants
  automating.
- **The rename stops at source symbols.** Docs now say "Ask Monolith" while the code keeps
  `askPulseLoop`, `askPulseStream`, `AskPulseVisual` and the `ask_pulse` billing string — a
  deliberate divergence, since `ask_pulse` is written into `ai_usage` rows and renaming it orphans
  billing history. The symbol refactor is a source change and wants its own task.
- **22 `src/` files are prettier-dirty** (pre-existing). The style pass was deliberately scoped to
  `docs/` + `vault/`; `brand-lab/`, `.obsidian/` and vendored `.claude/skills/` are dirty too and are
  none of ours.
- Unchanged: **E6** Stripe blocked on creds.

## Next session entry point

Board is clear of carryover. **Report Builder v2 roll-ups + org templates** is the critical path — one
shared migration dropping `reports.board_id NOT NULL`, then the single-board assumption has to be
unwound across access checks, payload fetch, shaping, routing and ~1.4k lines of tests.

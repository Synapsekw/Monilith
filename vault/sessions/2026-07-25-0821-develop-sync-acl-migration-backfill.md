---
type: session
date: 2026-07-25-0821
branch: develop
trigger: wrapup
status: complete
tags: [session, migrations, security, vault-hygiene]
related:
  [
    "[[2026-07-25-gotcha-57-dev-applied-migration-with-no-committed-file]]",
    "[[2026-07-24-1950-mcp-server-oauth]]",
    "[[2026-07-21-1123-e5-agentic-semantic-full-build]]",
  ]
---

# Sync develop, backfill the DEV-only MCP OAuth ACL migration

## What changed

- **Pulled `develop` (28 commits, `1dfe16f..cc00c66` — the MCP server + OAuth work).** Local had one
  unpushed vault commit so this rebased, conflicting in `00-north-star.md` + `board.html`. Resolved to
  **upstream** — remote `cc00c66` ("reconcile stale e5/main state", 07-24) is strictly newer and already
  restates E5 status; the only unique content in the local commit was the E5 session note, which applied
  clean. Ran `pnpm install` (lockfile moved in the range).
- **Found a DEV-only migration with no committed file:** `20260724134101_mcp_oauth_vault_cleanup_acl`,
  revoking `oauth_tokens_vault_cleanup()` (SECURITY DEFINER, deletes from `vault.secrets`) from
  public/anon/authenticated. Recovered the DDL from the ledger and backfilled the file **at the DEV
  version** rather than minting a new stamp (`b4efe5f`). Verified on DEV that all three definer functions
  from the MCP OAuth family are now `postgres=X | service_role=X`.
- **Wrote [[2026-07-25-gotcha-57-dev-applied-migration-with-no-committed-file]]** — no gate catches this
  shape: gotcha-55's reconcile script needs the file to exist, `db push` is file-driven, and a
  `revoke`/`grant`-only migration leaves `db:types` byte-identical.
- **Corrected the north-star** (`db2be59`): it asserted twice that the E5 session note "was never
  committed to this vault" — false as of this pull. Replaced with links to it.
- **Confirmed no session note is owed.** Audited every commit-day on `develop` against `vault/sessions/`:
  07-19 = promotion #69 (not a build session, already reconciled), 07-20/21 = the E5 note, 07-24 = the
  MCP note. Folded and deleted both stop-hook drafts (`_draft-2026-07-21-0727`, superseded by the real
  E5 note; `_draft-2026-07-25-0418`, this session).

## Why

The owner suspected the E5 wrapup was stranded on another machine and might need re-deriving from
`develop`'s history. It wasn't — it was sitting in the local unpushed commit all along, and the
north-star's own prose was the thing spreading the false claim. Checking the migration ledger as
routine post-pull hygiene is what turned a docs-cleanup session into catching a security regression
one promotion away from prod.

## How to test (for the user)

No user-facing behavior to test — a migration file backfill of already-applied DDL plus vault docs.
Verified by inspecting the live DEV ACLs (`pg_proc.proacl`) rather than the test suite, since the
change is a grant, not code.

## Open threads

- **`20260724134101_mcp_oauth_vault_cleanup_acl` must ride the next `/sync-prod`** or prod ships that
  definer trigger function publicly executable. Now recorded in north-star §3 Owed.
- Nothing automated diffs `list_migrations` against `supabase/migrations/` — the gotcha-57 follow-up
  suggests a `finish-task.sh` / `/sync-prod` pre-check.
- Worth auditing the other definer functions added around 07-20/07-24 for the same missed ACL.
- Unchanged carryovers: E5 env vars + embeddings backfill, MCP end-to-end connection test, `/login`
  `?next=`, prod DB password rotation.

## Next session entry point

The promotion is the front: set the E5 env vars, then `/promote` `develop → main` — it now carries the
MCP server, E5, **and** the ACL migration. Or a roadmap build (Report Builder v2 / E6).

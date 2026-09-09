---
type: adr
date: 2026-09-09
status: accepted
tags: [decision, gotcha, postgres, rls, security]
related:
  - "[[2026-09-09-1131-board-view-prefs]]"
  - "[[2026-09-07-gotcha-101-a-test-outside-the-default-gate-can-merge-having-never-run]]"
---

# Gotcha 102 — a new Postgres function is executable by anon until you revoke it

## Context

Migration `20260909064520` added `save_board_view_prefs`, the upsert RPC behind per-user
board arrangements. It was written carefully: security invoker on purpose, so the board
lookup that resolves `org_id` runs under the caller's RLS and a user cannot create a prefs
row for a board they cannot see. The table it writes has default-deny RLS with four
policies, every one of them scoped to `user_id = auth.uid()`.

None of that mattered for the question that was actually missed. Postgres grants
`EXECUTE` on every newly created function to `PUBLIC`, and Supabase's `anon` role inherits
`PUBLIC`. So an unauthenticated caller could reach the function body. The suite caught it:
`src/lib/supabase/anon-reachability.conformance.test.ts` parses function signatures out of
`supabase/migrations/` and probes the live DEV project with the anon key. It failed with
the RPC's own error, `board not found` — proof the body had been entered.

The repo already has the idiom, in `20260707140000_soft_delete_archived_at.sql`:

```sql
revoke execute on function public.save_board_view_prefs (uuid, jsonb) from public, anon;
grant  execute on function public.save_board_view_prefs (uuid, jsonb) to authenticated;
```

## Decision

Every migration that creates a function in `public` carries the revoke/grant pair in the
same migration. Not a follow-up, not a later hardening pass — the same file, because a
function without it is exposed for exactly as long as it takes someone to notice.

## Consequences

The near miss here was mild: `auth.uid()` is null for anon, so the insert would have hit
the `NOT NULL user_id` and failed anyway. That is luck, not design. A function whose body
does anything before it touches an auth-scoped column has no such accident protecting it,
and security invoker does not help either — it makes the function run as *the caller*, and
anon is a caller.

Two things generalise beyond Postgres.

**A default that is safe for the language is not safe for the deployment.** `GRANT ... TO
PUBLIC` is a reasonable default for a database whose roles are all trusted. It is the wrong
default the moment one of those roles is reachable from the internet without credentials.
Every new object in a multi-tenant schema should be read as exposed until something says
otherwise.

**Review read the security-relevant lines and still missed this, because the miss was an
absence.** The migration was reviewed for what it said — the policies, the invoker choice,
the RLS-filtered lookup — and all of that was right. What was wrong was a line that was not
there, and prose review is far better at judging present statements than at noticing absent
ones. That asymmetry is why the conformance suite exists and why it is worth its runtime:
it enumerates the objects and asks the same question of each, which is exactly the job a
reader is worst at.

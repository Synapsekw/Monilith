# DEV Migration-Ledger Repair Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to run this plan step-by-step. Steps use checkbox (`- [ ]`) syntax for tracking. This is an **ops / metadata-only** task — there is no application code, no tests to author, and no build. The "gates" here are read-only SQL diffs, not `pnpm typecheck/lint/test/build`.

**Goal:** Reconcile the DEV Supabase migration ledger (`supabase_migrations.schema_migrations`) with the committed filenames in `supabase/migrations/` — insert the one missing row and correct five skewed `version`/`name` values — **without touching the DEV schema itself**.

**Architecture:** The DEV schema is already fully correct; every migration's DDL has run. Only the bookkeeping ledger drifted: (1) one row (`20260705120000`) was applied to DEV's schema but the ledger row was recorded only on PROD; (2) the last five migrations were applied via the `apply_migration` MCP tool, which stamped its own apply-time timestamp instead of the committed filename timestamp (one also captured the whole filename stem as its `name`). The repair is a handful of `UPDATE`/`INSERT` statements against the ledger table only — pure metadata, zero DDL.

**Tech Stack:** Supabase Postgres, `supabase_migrations.schema_migrations` ledger table, `mcp__supabase-dev` MCP tools (`execute_sql`, `list_migrations`), Supabase CLI (`supabase db push`) as the downstream consumer of the ledger.

**Reference / rationale:** north-star §status (line 54–57) records the drift as an owed item. PROD's ledger is the reference for the missing row.

---

## Preconditions (must hold before starting)

- Operate only inside the worktree `/Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/dev-ledger-repair` (branch `task/dev-ledger-repair`).
- All writes go through `mcp__supabase-dev__execute_sql` — **never** `apply_migration` (see "Why not apply_migration" below).
- This plan is **not yet approved to execute.** It is written for review. Executing it is a separate, explicitly-authorized step.

---

## The exact discrepancy (verified 2026-07-09, read-only)

Source of truth = committed `supabase/migrations/*.sql` filenames in this worktree. Compared against `mcp__supabase-dev__list_migrations` (DEV ledger) and cross-checked against `mcp__supabase-prod__list_migrations` (PROD ledger).

### A. Missing ledger row on DEV (1 row)

| Committed filename                           | Present in DEV schema?                                                                    | DEV ledger row?  | PROD ledger row?                                                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------- |
| `20260705120000_import_rows_multi_group.sql` | **Yes** — `public.import_rows_into_board(p_board_id uuid, p_payload jsonb)` exists on DEV | **No (missing)** | **Yes** (`version=20260705120000`, `name=import_rows_multi_group`, `statements=null`) |

The migration's DDL is live on DEV; only its ledger row is absent. PROD is the authoritative reference and shows `statements = null` for this row.

### B. Skewed `version` (and one malformed `name`) on DEV (5 rows)

All five are the tail migrations applied via the `apply_migration` MCP tool, which recorded an apply-time timestamp rather than the committed filename's timestamp. Row `20260707050518` additionally stored the full filename stem in `name` instead of the short name.

| Committed filename (correct)                           | DEV ledger `version` (wrong) | DEV ledger `name` (as recorded)             | → correct `version` | → correct `name`                    |
| ------------------------------------------------------ | ---------------------------- | ------------------------------------------- | ------------------- | ----------------------------------- |
| `20260706164829_user_ai_credentials.sql`               | `20260706134916`             | `user_ai_credentials`                       | `20260706164829`    | `user_ai_credentials`               |
| `20260706165521_user_ai_credentials_vault_cleanup.sql` | `20260706135547`             | `user_ai_credentials_vault_cleanup`         | `20260706165521`    | `user_ai_credentials_vault_cleanup` |
| `20260707120000_search_items_ranked_rpc.sql`           | `20260707044730`             | `search_items_ranked_rpc`                   | `20260707120000`    | `search_items_ranked_rpc`           |
| `20260707130000_avatars_bucket.sql`                    | `20260707050518`             | `20260707130000_avatars_bucket` ⚠ malformed | `20260707130000`    | `avatars_bucket`                    |
| `20260707140000_soft_delete_archived_at.sql`           | `20260707052332`             | `soft_delete_archived_at`                   | `20260707140000`    | `soft_delete_archived_at`           |

Notes:

- `version` is the primary key of `schema_migrations`. None of the five target versions (`…164829`, `…165521`, `20260707120000/130000/140000`) currently exist in the DEV ledger, so the `UPDATE`s cause **no PK collision**.
- The `statements` column on these five rows is non-null (1 statement each). The repair preserves `statements` (UPDATE only changes `version`/`name`) — it is not load-bearing for CLI version-matching, so we deliberately leave it alone.
- Everything at and before `20260704114000_definer_execution_lockdown_hygiene` already matches exactly across committed files, DEV, and PROD — **out of scope, do not touch.**

### Ordering sanity check

After repair, the DEV ledger tail (by `version`, ascending) becomes:

```
20260704114000  definer_execution_lockdown_hygiene   (unchanged)
20260705120000  import_rows_multi_group              (INSERTED)
20260706164829  user_ai_credentials                  (was 20260706134916)
20260706165521  user_ai_credentials_vault_cleanup    (was 20260706135547)
20260707120000  search_items_ranked_rpc              (was 20260707044730)
20260707130000  avatars_bucket                       (was 20260707050518, name fixed)
20260707140000  soft_delete_archived_at              (was 20260707052332)
```

This is strictly increasing and 1:1 with the committed filenames — exactly what `supabase db push` / `supabase migration list` expect.

---

## Why not `apply_migration`

`mcp__supabase-dev__apply_migration` (and `supabase db push`) **append a new row** to the ledger and, for `apply_migration`, also _execute_ the SQL. We must not re-run any DDL (the objects already exist — it would error or, worse, mutate the schema) and we must not append duplicate rows. This repair edits existing bookkeeping only, so it uses `execute_sql` with plain DML (`UPDATE`/`INSERT`) against `supabase_migrations.schema_migrations`.

---

## Risk analysis

- **Does this alter the DEV schema?** No. Every statement targets `supabase_migrations.schema_migrations` (a bookkeeping table). No `CREATE`/`ALTER`/`DROP` on application objects, no data in `public`. The schema is already correct and stays byte-for-byte identical. Step 5 proves this with a before/after schema fingerprint.
- **Could reconciling timestamps break `supabase db push` / `finish-task` gating?**
  - `finish-task.sh` gates on `pnpm typecheck && lint && test && build` **only** — it does **not** run `supabase db push`. So neither the current drift nor this repair affects finish-task. (Confirmed: no `db push` in `scripts/finish-task.sh`.)
  - The only `supabase db push` in the repo is `scripts/sync-prod/push-schema.sh`, which pushes to **PROD** using PROD's ledger — unaffected by DEV ledger state.
  - The repair _reduces_ risk: **today** a future `supabase db push --db-url <DEV>` or `supabase migration list` against DEV would misbehave — the CLI matches migration files to ledger rows by `version` string, so the five skewed rows make the CLI see the committed files (`20260706164829`, …) as _unapplied_ (it would try to re-run them → error, since objects exist) and the ledger rows (`20260706134916`, …) as remote-only extras → reported drift. After the repair the DEV ledger is 1:1 with the filenames, so the CLI treats DEV as fully in-sync. This is strictly safer, not riskier.
- **Concurrency:** run when no `supabase db push`/migration is in flight against DEV. The five `UPDATE`s + one `INSERT` are a single transaction (Step 4), so the ledger is never left half-reconciled.
- **Reversibility:** the pre-change snapshot captured in Step 1 is the rollback script (re-`UPDATE` versions back / `DELETE` the inserted row). Keep it until verification passes.

---

## Tasks

### Task 1: Snapshot current state (read-only baseline + rollback material)

**No writes.** Capture the exact "before" so the change is auditable and reversible.

- [ ] **Step 1: Snapshot the ledger tail.** Via `mcp__supabase-dev__execute_sql`:

```sql
select version, name, array_length(statements,1) as stmt_count
from supabase_migrations.schema_migrations
where version >= '20260704114000'
order by version;
```

Expected (before): `20260704114000`, then the five skewed rows `20260706134916 / 20260706135547 / 20260707044730 / 20260707050518 / 20260707052332`, and **no** `20260705120000`. Save this output verbatim — it is the rollback reference.

- [ ] **Step 2: Snapshot a schema fingerprint (to prove no schema change later).** Via `mcp__supabase-dev__execute_sql`:

```sql
select md5(string_agg(sig, '|' order by sig)) as schema_fingerprint,
       count(*) as object_count
from (
  select n.nspname || '.' || c.relname || ':' || c.relkind as sig
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public','storage','auth')
  union all
  select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','storage')
) s;
```

Record `schema_fingerprint` and `object_count`. This deliberately **excludes** `supabase_migrations` so the ledger edits do not move the fingerprint.

### Task 2: Insert the missing `20260705120000` row

**Files:** none (SQL via `mcp__supabase-dev__execute_sql`).

- [ ] **Step 1: Insert the missing ledger row, matching PROD.** PROD records `statements = null`, so mirror that (the column is not used for version-matching):

```sql
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20260705120000', 'import_rows_multi_group', null)
on conflict (version) do nothing;
```

- [ ] **Step 2: (verify inline)** the `INSERT` reports 1 row affected. Do not run `list_migrations` yet — full verification is Task 4.

> Note: This is written as an independent statement for readability, but in execution it is bundled into the single transaction in Task 3 Step 1 so the whole repair is atomic.

### Task 3: Reconcile the five skewed rows (atomic)

**Files:** none (SQL via `mcp__supabase-dev__execute_sql`).

- [ ] **Step 1: Run the missing-row insert + five reconciling updates as ONE transaction.** This supersedes running Task 2 separately — execute this single block:

```sql
begin;

-- (A) missing row
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20260705120000', 'import_rows_multi_group', null)
on conflict (version) do nothing;

-- (B) skewed version/name reconciliation (version = PK; targets are unused → no collision)
update supabase_migrations.schema_migrations
  set version = '20260706164829'
  where version = '20260706134916' and name = 'user_ai_credentials';

update supabase_migrations.schema_migrations
  set version = '20260706165521'
  where version = '20260706135547' and name = 'user_ai_credentials_vault_cleanup';

update supabase_migrations.schema_migrations
  set version = '20260707120000'
  where version = '20260707044730' and name = 'search_items_ranked_rpc';

update supabase_migrations.schema_migrations
  set version = '20260707130000', name = 'avatars_bucket'
  where version = '20260707050518' and name = '20260707130000_avatars_bucket';

update supabase_migrations.schema_migrations
  set version = '20260707140000'
  where version = '20260707052332' and name = 'soft_delete_archived_at';

commit;
```

Expected: 1 insert + 5 updates, each affecting exactly 1 row. If any `UPDATE` affects 0 rows, the `where` guard didn't match (state changed since the snapshot) — **do not `commit`; `rollback`** and re-snapshot (Task 1) before retrying.

> Note on tooling: `execute_sql` runs raw SQL; wrapping in an explicit `begin/commit` gives all-or-nothing safety. If the MCP layer auto-commits per statement (no multi-statement transaction), fall back to running the six statements individually **in the order above** and stop immediately if any affects the wrong row count.

### Task 4: Verify (ledger diff against committed filenames)

**No writes.** Prove the ledger now matches the committed files and PROD.

- [ ] **Step 1: Re-run `mcp__supabase-dev__list_migrations`.** Confirm the tail is exactly:

```
20260704114000  definer_execution_lockdown_hygiene
20260705120000  import_rows_multi_group
20260706164829  user_ai_credentials
20260706165521  user_ai_credentials_vault_cleanup
20260707120000  search_items_ranked_rpc
20260707130000  avatars_bucket
20260707140000  soft_delete_archived_at
```

and that none of the old skewed versions (`20260706134916`, `20260706135547`, `20260707044730`, `20260707050518`, `20260707052332`) remain.

- [ ] **Step 2: Machine-diff ledger vs. committed filenames.** From the worktree, list the committed versions and eyeball against Step 1:

```bash
cd /Users/danijeljovanovic/Dev/Monolith/.claude/worktrees/dev-ledger-repair
ls -1 supabase/migrations/*.sql | xargs -n1 basename | sed 's/_.*//' | sort > /tmp/committed_versions.txt
wc -l /tmp/committed_versions.txt   # expect 93 (count of *.sql files); DEV ledger goes 92 → 93 rows after the insert
```

Every version in `list_migrations` must appear in `committed_versions.txt` and vice-versa (the ledger has one row per committed file). Confirm the count matches the ledger row count from Step 1.

- [ ] **Step 3: Prove the schema is unchanged.** Re-run the Task 1 Step 2 fingerprint query. `schema_fingerprint` and `object_count` **must be identical** to the baseline. If they differ, something beyond the ledger changed — stop and investigate (this should be impossible given the statements above).

### Task 5: Record the repair (dev-memory)

**Files:** `vault/sessions/<via /wrapup>`, `vault/00-north-star.md`.

- [ ] **Step 1:** Run `/wrapup` to log the session and remove the "dev ledger repair (`20260705120000`)" item from north-star §status "Owed" (line 57) and update the "PROD ledger at `20260705120000`; DEV now has …" note (line 54) to reflect the reconciled DEV ledger. Note in the session: the fix was ledger-metadata only; DEV schema fingerprint identical before/after.
- [ ] **Step 2:** Consider a short ADR in `vault/decisions/` capturing the trap: _`apply_migration` via MCP stamps its own timestamp/name into the ledger, diverging from committed filenames — apply feature migrations so the ledger `version` equals the committed filename timestamp, or reconcile afterward._ (Optional but recommended — this is exactly the kind of non-obvious trap the vault exists for.)

---

## "How to test this" (acceptance)

Not user-observable — this is internal ledger hygiene. Acceptance = Task 4:

1. `mcp__supabase-dev__list_migrations` tail matches the seven-row block above (no skewed versions remain).
2. Ledger versions are 1:1 with `supabase/migrations/*.sql` filenames (Task 4 Step 2).
3. Schema fingerprint identical before/after (Task 4 Step 3) — proves schema untouched.

No `pnpm` gates apply (no application code changed). The `task/dev-ledger-repair` branch carries only this plan doc (and any vault notes); finish via `scripts/finish-task.sh` once the plan is approved and — if execution is authorized — the ledger repair has been run and verified.

---

## Self-review

- **Discrepancy coverage:** 1 missing row (Task 2/3A) + 5 skewed rows incl. 1 malformed name (Task 3B) — all six ledger rows named in the discrepancy tables have a corresponding statement. ✓
- **No placeholders:** every SQL statement is concrete with exact version/name literals and `where` guards. ✓
- **PK safety:** target versions verified absent from the current DEV ledger (no collision). ✓
- **Schema safety:** only `supabase_migrations.schema_migrations` is written; fingerprint check excludes that table and must match. ✓
- **Consistency:** correct `version`/`name` values in Task 3 match the discrepancy table and the Task 4 verification block exactly. ✓

# /sync-prod — publish dev → prod (full-fidelity, on demand)

Publish the dev database and storage to production in one on-demand operation: the agent runs all
read-only checks, then **gates** every destructive prod write behind an explicit typed confirmation
— handing the user exact commands to run, never executing them itself.

**Full-replace semantics:** prod's data is overwritten with dev's on each run. This is safe and
correct only while dev is effectively the sole source of data. **This model has a known expiry** —
the first time a real customer signs up directly on production, a full replace would clobber their
data. Run the independent-prod-data guard (step 2) before every sync, and retire this command when
prod gains independent users.

**Env → DB mapping** (authoritative — `.mcp.json` project-ref labels appear inverted in other
contexts; trust these):

- **DEV** — project `hjqcahbbbdaknbbnfnvl`, read/write, source of data. MCP tool: `supabase-dev`.
- **PROD** — project `jzsyqhxynswolgijkktn`, read-only via MCP, empty mirror target. MCP tool: `supabase-prod`.

Design spec: `docs/superpowers/specs/2026-06-26-sync-prod-design.md`.

## Arguments

- `--dry-run` (in `$ARGUMENTS`): run steps 1–4 read-only (schema parity, independent-prod-data
  guard, plan presentation) plus `pnpm sync:storage -- --dry-run`, then stop — **no prod writes**.
  Step 4's command hand-off is a no-op in dry-run (nothing is handed over). Skips the `SYNC PROD`
  gate entirely. Safe to run anytime.
- `--force` (in `$ARGUMENTS`): bypass the independent-prod-data guard in step 2. Use only when
  you have explicitly confirmed that overwriting prod-native data is intentional.

## Precondition — `.env.prod.local` must be present

Before any step, verify that `.env.prod.local` exists at the repo root and contains all four
required variables:

- `PROD_SUPABASE_URL`
- `PROD_SUPABASE_SERVICE_ROLE_KEY`
- `DEV_SUPABASE_DB_URL`
- `PROD_SUPABASE_DB_URL`

If the file is missing or any variable is absent → **stop immediately**: "`.env.prod.local` is
missing or incomplete. Add the required prod credentials and retry."

## Steps to follow

Create a TodoWrite item per step and work them in order. **Stop conditions are hard** — on any
stop, emit the report in its `⛔ Stopped` form (see Report) with the relevant detail and **no
false success claim**.

### 1. Schema parity (agent, read-only)

Query the applied migration versions on both environments:

- **DEV** via `supabase-dev`:
  `SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;`
- **PROD** via `supabase-prod`:
  `SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;`

On a never-pushed PROD the `supabase_migrations.schema_migrations` relation may not exist yet, so
the PROD query **errors** instead of returning zero rows. Treat a "relation does not exist" (or any
missing-migrations-table) error as **PROD has zero migrations** — i.e. the bootstrap case below, not
a tool failure.

Compute the set of versions present in DEV but absent in PROD.

- **Non-empty set** (including bootstrap where PROD has zero migrations) → **hard stop**: tell the
  user to apply the missing migrations first:
  ```bash
  pnpm exec supabase db push --db-url "$PROD_SUPABASE_DB_URL"
  ```
  Then retry `/sync-prod`. Do not proceed past this stop.
- **Parity confirmed (sets are equal):** continue.

### 2. Independent-prod-data guard (agent, read-only)

> `--force` bypasses the **stop**, not the **check**. Always run the queries below. With
> `--force`, a non-empty difference logs a named warning (with the offending IDs) and continues
> instead of stopping — so the bypass is still audited.

Query PROD via `supabase-prod` for all org and auth-user IDs:

```sql
SELECT id FROM public.organizations;
SELECT id FROM auth.users;
```

Query DEV via `supabase-dev` for the same:

```sql
SELECT id FROM public.organizations;
SELECT id FROM auth.users;
```

Find IDs present in PROD but absent in DEV (the set difference).

- **Non-empty difference, without `--force` → loud stop**:

  ```
  ⛔ Stopped: PROD contains data not present in DEV.
  Proceeding would permanently overwrite production-native data.

  Offending org IDs:       <list>
  Offending auth user IDs: <list>

  This is the expiry condition for the dev→prod mirror model — prod has
  gained independent users or orgs. Retry with --force only if you
  understand and accept the data loss.
  ```

- **Empty difference (or PROD is empty):** continue.
- **Non-empty difference with `--force`:** log a named warning listing the offending IDs
  and continue.

### 3. Gate — confirm the sync

Present the full sync plan to the user:

```
Sync plan: dev → prod (full replace)
  Source:  DEV (hjqcahbbbdaknbbnfnvl) — your working data
  Target:  PROD (jzsyqhxynswolgijkktn) — will be fully replaced

  Commands you will run (in order):
    1. scripts/sync-prod/backup-prod.sh         — safety snapshot of current prod
    2. DUMP=$(scripts/sync-prod/dump-dev.sh)    — dump dev data, capture path
    3. scripts/sync-prod/restore-prod.sh "$DUMP" — truncate prod → load → reset seqs
    4. pnpm sync:storage                         — sync storage blobs dev → prod
```

**If `--dry-run`:** print the plan above, then run `pnpm sync:storage -- --dry-run` and stop —
emit the `⛔ Stopped` report form (see Report) with the reason "dry run complete — no prod writes,
PROD untouched". Do not ask for confirmation.

**Otherwise:** ask for explicit typed confirmation via `AskUserQuestion`:

> "Proceed with dev → prod full replace? This will overwrite all PROD data. Type **SYNC PROD**
> to confirm, or anything else to cancel."

Only the exact phrase `SYNC PROD` proceeds. Any other response → stop cleanly:
"Sync cancelled at gate. PROD is untouched." (The user can re-run `/sync-prod` when ready.)

### 4. Hand the user the commands (in order)

State clearly: **the agent cannot write prod — the user runs these commands and pastes back the
full output before verification proceeds.**

```bash
# Step 1 — safety snapshot of current prod (run first, before anything destructive)
scripts/sync-prod/backup-prod.sh

# Step 2 — dump dev data and capture the path
DUMP=$(scripts/sync-prod/dump-dev.sh)

# Step 3 — restore into prod (truncate → load → reset sequences, replica mode)
scripts/sync-prod/restore-prod.sh "$DUMP"

# Step 4 — sync storage blobs dev → prod (upsert)
pnpm sync:storage
```

**Path note:** `restore-prod.sh` passes the dump path to `psql \i` without additional shell
quoting. Dump files are written to `.dumps/dev-data-<timestamp>.sql` — no spaces in that path.
Do not pass a custom dump path containing spaces.

Run each command in order. If any step errors, stop and paste the error message before continuing.
Paste the full output of all four commands before moving to step 5.

### 5. Verify parity (agent, read-only)

After the user confirms completion and pastes output, compare key row counts and storage object
counts dev vs prod via MCP. Run each query on both `supabase-dev` and `supabase-prod`:

```sql
SELECT COUNT(*) FROM public.organizations;
SELECT COUNT(*) FROM public.boards;
SELECT COUNT(*) FROM public.items;
SELECT COUNT(*) FROM auth.users;
SELECT COUNT(*) FROM storage.objects;
```

Emit a parity table:

```
Table              DEV count   PROD count   Match?
──────────────────────────────────────────────────
organizations      N           N            ✅ / ⚠
boards             N           N            ✅ / ⚠
items              N           N            ✅ / ⚠
auth.users         N           N            ✅ / ⚠
storage.objects    N           N            ✅ / ⚠
```

All counts matching → emit the success report. Any mismatch → emit the `⛔ Stopped` report with
the parity table and the specific discrepancy.

### 6. Report

Emit the formatted report (below).

## Report format

Success:

```
## 🔄 Sync report — dev → prod
**Result:** ✅ Synced to production

### Parity
| Table            | DEV | PROD | Match |
|------------------|-----|------|-------|
| organizations    | N   | N    | ✅    |
| boards           | N   | N    | ✅    |
| items            | N   | N    | ✅    |
| auth.users       | N   | N    | ✅    |
| storage.objects  | N   | N    | ✅    |

### Notes
- ⚠ Full-replace model expires when prod gains independent users — run the guard on every sync.
```

Stop (any hard stop above):

```
## 🔄 Sync report — dev → prod
**Result:** ⛔ Stopped: <one-line reason>

<the one piece of evidence the user needs to act>
- e.g. missing migration versions + db push command, offending org/user IDs,
  "SYNC PROD not confirmed — PROD untouched", or "dry run — PROD untouched"
```

## Discipline

- **Read-only until the gate; agent never runs prod writes.** Steps 1–3 mutate nothing. Every
  prod-write command (backup, restore, storage sync) is handed to the user to run — the agent
  cannot and must not attempt them, whether directly or via shell invocation.
- **Prod backup precedes every restore.** `backup-prod.sh` is step 1 of the handover block,
  before `restore-prod.sh`. This order is not optional — do not reorder the handed commands.
- **Typed confirmation required.** No prod write begins without the user typing the exact phrase
  `SYNC PROD` at the gate. Abbreviated, paraphrased, or implicit consent is treated as
  cancellation.
- **Honest reporting.** Never claim success if parity counts do not match, if the user reports a
  command error, or if any step was skipped. Report PROD's actual state.
- **Expiry reminder on every success.** The full-replace model is designed to retire; the reminder
  in the success report is intentional and must not be omitted.

## Edge cases

- **Missing `.env.prod.local`** — stop at precondition; do not reach any step.
- **PROD schema behind or bootstrap (zero migrations)** — hard stop at step 1 with the `db push`
  instruction; re-run `/sync-prod` after schema is applied.
- **PROD has independent data (guard fires)** — loud stop at step 2 naming offending IDs;
  re-run with `--force` only after explicit user acceptance.
- **`--force` with independent prod data** — log the named IDs as acknowledged and overwritten;
  this is the user's explicit decision.
- **`--dry-run`** — stop after the plan + storage dry-run in step 3; PROD is untouched.
- **Gate not confirmed** — stop cleanly at step 3; PROD is untouched; user can re-run.
- **User reports error mid-handover** — do not proceed to step 5; help diagnose (e.g., `psql`
  not installed, wrong credentials, network error) before retrying the failed command.
- **Parity mismatch after restore** — emit the ⛔ report naming the mismatched table(s); the
  restore is idempotent (backup exists), so the user can retry `restore-prod.sh` after diagnosing.

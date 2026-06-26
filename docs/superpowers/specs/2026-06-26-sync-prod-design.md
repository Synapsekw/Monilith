# `/sync-prod` — publish dev → prod (full-fidelity, on-demand)

**Status:** Design (brainstormed 2026-06-26)
**Author:** Danijel Jovanovic
**Related:** `/promote` (`docs/superpowers/specs/2026-06-21-promote-command-design.md`)

## Problem & model

Pulse runs two Supabase projects:

- **DEV** (`hjqca…`) — has the schema, admin data, and Danijel's **real working data**.
- **PROD** (`jzsyq…`) — currently **empty** (no schema, no data).

> Project-ref ↔ environment labels in `.mcp.json` are **backwards** — `hjqca…` is DEV (read/write),
> `jzsyq…` is PROD (read-only via MCP). This spec uses the real mapping above.

The decided operating model:

- **Dev is the working environment and the source of truth for _data_.** Danijel keeps building and
  using dev day-to-day.
- **Prod is a published _mirror_ of dev**, refreshed **on demand** by a single command, **run by the
  user** (never by the agent — see "Why the user runs the writes").
- Each sync is a **full replace** of prod's data with dev's — not an incremental diff. Deterministic
  and correct while dev is the sole source of data.

### Two flows, opposite directions (the framing that unlocked this)

- **Schema** flows **dev → prod**, via the existing versioned migrations in `supabase/migrations/`.
- **Data** normally flows prod → dev in mature products. Here we deliberately invert it
  (**dev → prod**) because dev is the sole source of data today.

### Known expiry (designed-for, not ignored)

This mirror model is safe **only while dev is effectively the sole source of data**. The first time a
real customer signs up directly on production and creates their own org, a full dev → prod replace
would clobber their data. The design is therefore **loud** about this (see "Independent-prod-data
guard") and the model is expected to be **retired** when prod gains independent users.

## Scope

**In scope (full fidelity):**

- `public` schema business data (orgs, boards, items, …).
- `auth` user data (`auth.users`, `auth.identities`, related) so logins work and user-id FKs resolve.
- `storage` — both the metadata rows (`storage.objects`, `storage.buckets`) **and** the actual
  attachment blobs in S3-backed storage.

**Out of scope (deliberately):**

- Continuous / streaming replication — this is **on-demand only**.
- Two-way / merge sync — **one-directional overwrite** only.
- Coupling into `/promote` — they stay **separate** commands; `/promote` only _offers_ to chain into
  `/sync-prod` at the end (see "Hand-off from `/promote`").

## The prerequisite gap that exists today

Nothing currently applies migrations to **either** database automatically — not CI (`ci.yml` only
typechecks/lints/tests/builds) and not the Vercel deploy. Schema has reached dev **manually**. Prod
being empty means it has **no schema yet**, not merely no data.

This design standardizes the schema half: **`supabase db push` against the linked prod project**, run
by the user, as the schema counterpart to the data sync. The **first** `/sync-prod` run doubles as
the **bootstrap** — once prod schema exists via `db push`, the data/storage steps fill it. The
command's preflight enforces schema parity on **every** run so prod schema never silently drifts from
the data being loaded into it.

## Why the user runs the writes

The agent **cannot** write to prod:

- The prod MCP server is `read_only=true`.
- The local classifier blocks DDL / migration pushes (established in prior sessions — the user
  applies prod SQL directly).

This is not a limitation to work around — it is the **correct shape** for an operation that can
overwrite production. Division of labor:

- **Agent runs:** all read-only checks (schema parity, independent-data guard), dev-side dump
  orchestration, and post-sync verification.
- **User runs:** every step that writes prod (backup, restore, storage upload), each gated behind
  explicit confirmation, with the exact commands handed over by the command.

## Toolchain (decided)

- **Supabase CLI** — present. Used for the dev-side **data dump** and for **`supabase db push`** to
  prod (schema).
- **`psql` / libpq** — user will install (e.g. `scoop install postgresql`). The robust **restore**
  path: handles COPY-format dumps, transactions, and `session_replication_role` natively. (The
  Supabase CLI dumps data well but has **no** "load data into project X" command, so a loader is
  required; `psql` is it.)
- **`@supabase/supabase-js`** — already a dependency. Powers the **storage blob** copy via two
  service-role clients (dev source, prod target).

## Components

```
scripts/sync-prod/
  dump-dev.sh        # Supabase CLI data-only dump: public + auth + storage metadata → timestamped file
  restore-prod.sh    # psql load into prod: truncate → load → reset sequences, in one txn, replica mode
  sync-storage.ts    # Node: two service-role supabase-js clients; ensure prod buckets; copy each blob
  backup-prod.sh     # Supabase CLI dump of prod (safety snapshot) → timestamped file, pre-destructive
.claude/commands/sync-prod.md   # runbook/orchestrator (mirrors /promote's structure)
```

`.claude/commands/sync-prod.md` is the orchestrator: the agent runs read-only + dev-side +
verification steps inside it, and **gates** the destructive prod steps behind explicit typed
confirmation, handing the user exact commands to run.

## Pipeline (ordered)

1. **Preflight — schema parity** _(agent, read-only)._ Confirm prod's live schema matches dev's
   applied migrations. **Drift → hard stop** — a data load against a mismatched schema fails. If prod
   is behind, instruct the user to `supabase db push` to the linked prod project first.
2. **Independent-prod-data guard** _(agent, read-only via prod)._ Check prod for any org/user **not**
   present in dev. **Found → loud stop** unless `--force`. This is the expiry guardrail.
3. **Backup prod** _(user)._ `supabase db dump` of prod → timestamped local file, **before** anything
   destructive. Restorable if a sync goes wrong.
4. **Dump dev data** _(user)._ CLI data-only dump of `public` + `auth` + `storage` (metadata).
5. **Restore into prod** _(user, gated by typed confirm `SYNC PROD`)._ `psql` into prod: truncate
   target tables → load dump → reset sequences, in one transaction with `session_replication_role =
replica` (suppresses triggers/RLS during load).
6. **Sync storage blobs** _(user)._ `sync-storage.ts`: ensure prod buckets exist, then download each
   dev object and upload to prod (upsert).
7. **Verify** _(agent, read-only)._ Row-count + storage-object-count parity dev vs prod; emit a
   formatted report.

## Hand-off from `/promote`

`/promote` stays a separate command and is unchanged through its existing steps. After `/promote`
completes — **main merged, CI green, Vercel production deploy confirmed** — it ends by **offering, in
sequence**, to run `/sync-prod`:

> "Production code is live. Want to sync dev data → prod now? (runs `/sync-prod`)"

If accepted, control passes to the `/sync-prod` flow (which then runs its own preflight + gates). If
declined, `/promote` finishes normally. `/promote` itself never writes prod data — it only chains the
offer.

## Safety model

- **Read-only until the gate.** Steps 1–2 mutate nothing and are agent-run. Every prod write is
  user-run.
- **Typed confirmation** (`SYNC PROD`) before truncate/restore.
- **Prod backup first** (step 3) — a restorable snapshot precedes any destructive step.
- **Independent-data guard** (step 2) — refuses to clobber prod-native data unless `--force`.
- **`--dry-run`** — runs steps 1–4 and prints what _would_ change; touches nothing in prod.

## Secrets / config

- Dev creds already in `.env.local`.
- Prod needs: **direct DB connection string** (for `psql` restore + `db push`) + **service-role key**
  (for storage upload). These live in a **gitignored** `.env.prod.local` (or a clearly-namespaced
  `*_PROD` block), **never committed**, **never** shipped to the browser.
- The command **refuses to run** if prod creds are missing.

## Open implementation risks (resolve during planning, not now)

- **`auth.users` copy** is the highest-risk step: GoTrue-manages several columns and there are related
  tables (`auth.identities`, possibly `auth.mfa_*`). May require a **targeted table list** rather than
  dumping the whole `auth` schema, and careful ordering. Validate against a throwaway target before
  trusting it on prod.
- **Dump format vs restore:** confirm whether `supabase db dump --data-only` emits COPY or INSERT
  blocks and that `psql` loads it cleanly with `session_replication_role = replica`; settle exact
  schema flags (`--schema public,auth,storage`) and truncation order.
- **Storage bucket creation:** prod buckets (and their public/private + MIME settings) must exist
  before object upload; `sync-storage.ts` creates them from dev's bucket config.

## Testing

- **Parity verification** (step 7): automated row-count + object-count comparison dev vs prod.
- **`--dry-run` rehearsal** before any real run.
- Destructive steps can't be unit-tested against real prod, so the discipline is: **dry-run → prod
  backup → real run → parity check**. Where feasible, rehearse the `auth`/restore path against a
  throwaway Supabase project first.

## Execution DAG (for the plan)

- **Schema prerequisite** (prod `db push`) — gates everything; the bootstrap edge.
- **Independent units** (can be built in parallel): `dump-dev.sh`, `backup-prod.sh`,
  `sync-storage.ts`, and the verification check are largely independent.
- **Sequential dependency:** `restore-prod.sh` consumes `dump-dev.sh`'s output; the command runbook
  consumes all scripts. Critical path: dump → restore → storage → verify.

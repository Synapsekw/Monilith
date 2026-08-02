---
type: adr
status: accepted
date: 2026-08-02
tags: [project/monolith, adr, decision, operations, supabase, environments, deploy]
related:
  - "[[00-north-star]]"
  - "[[operations]]"
  - "[[2026-06-26-1500-sync-prod-built-and-run]]"
---

# Decision 32 — The production deployment runs the DEVELOPMENT database (until feature-complete)

> **Read this before reasoning about anything involving "production data".**
> `www.monolith.works` is wired to the **DEV** Supabase project. The cutover to the PROD project
> happens only when the app is declared feature-complete. This is deliberate, not a misconfiguration
> — do not "fix" it.

## Context

There are two Supabase projects:

| Project ref            | Environment    | Role today                                                       |
| ---------------------- | -------------- | ---------------------------------------------------------------- |
| `hjqcahbbbdaknbbnfnvl` | **DEVELOPMENT** | **The live database.** Local dev AND the deployed production site |
| `jzsyqhxynswolgijkktn` | **PRODUCTION**  | Provisioned, schema + a `/sync-prod` mirror of data — **not serving traffic** |

The product is still being built. Splitting the data across two databases mid-build would mean every
feature that lands has to be migrated, backfilled and re-verified twice, and the real working data —
the orgs, boards and items actually in use — lives on DEV. So the deployed build keeps pointing at
DEV while the feature set is still moving.

## Decision

**The production Vercel deployment reads and writes the DEV Supabase project
(`hjqcahbbbdaknbbnfnvl`). The `jzsyq…` PROD project is kept schema-current but idle. We cut over
when the app is declared feature-complete.**

The environment variables on Vercel are the source of truth for what the live site talks to; this
note records the *intent* behind them.

## Consequences — what this means for an agent

1. **"Production" is ambiguous in this repo. Always say which you mean.**
   - _production **deployment**_ = `main` on Vercel = `www.monolith.works` → talks to **DEV DB**
   - _production **database**_ = the `jzsyq…` Supabase project → currently serves **nobody**

2. **The DEV database holds real, live, user-facing data.** Treat `hjqca…` with production care:
   no destructive experiments, no casual truncates, no "it's only dev" reasoning. A bad migration or
   a bad delete on DEV is a bad migration on the live app.

3. **A change is live for users as soon as it is applied to DEV and `main` is promoted.** There is
   no separate prod-data step in between. DEV migrations therefore reach real users.

4. **Data written on the live site does not appear in the `jzsyq…` project.** Anyone inspecting the
   PROD project to explain live behaviour is looking at the wrong database. Debug live issues
   against DEV (`DEV_SUPABASE_DB_URL` in `.env.prod.local`, or the `supabase-dev` MCP).

5. **`/sync-prod` is a mirror-forward, not a cutover.** It keeps `jzsyq…` current so the eventual
   switch is cheap. Running it changes nothing about which database serves traffic.

6. **Prod-side provisioning still matters and still lags.** Vault secrets, cron schedules and env
   vars set on the PROD project are dormant today; secrets used by the *live* site must exist on
   **DEV** (this is exactly why `app_url` being absent on DEV silently killed every signed
   `pg_cron` hop — see [[2026-08-01-gotcha-69-a-cookie-gate-turns-a-cron-post-into-a-silent-405]]).

## The cutover (when it happens)

Not now. Trigger: **the app is declared feature-complete** by the owner. At that point, in order:
run `/sync-prod` for a final full-fidelity mirror, repoint the Vercel env vars to `jzsyq…`, move
Vault secrets + cron schedules onto PROD, verify auth/email/storage, and only then treat DEV as a
non-production environment again. Until that day, this note stands.

## Status

**Accepted and current as of 2026-08-02.** When the cutover happens, flip this note's `status` to
`superseded`, record the date, and update [[00-north-star]] §3 and [[operations]] in the same pass.

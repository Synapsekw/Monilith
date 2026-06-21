---
type: session
date: 2026-06-21-1522
branch: develop
trigger: wrapup
status: complete
tags: [session]
related: []
---

# Vercel CLI setup + project link

## What changed

- **Installed Vercel CLI globally** — `vercel 54.14.5` via `pnpm add -g`. `pnpm setup` had never
  been run on this machine (no global bin dir), so it first wrote `PNPM_HOME=~/Library/pnpm` into
  `~/.zshrc` (active in new shells only).
- **Logged in** (user-run device OAuth) → team **Synapse-Solutions** (`synapse-solutionskw`).
- **Linked the repo** — `vercel link` → `synapse-solutionskw/monilith`
  (`www.monolith.works`, Node 24.x). Wrote `.vercel/project.json` (already gitignored).
- **Did NOT `vercel env pull`** (deliberate): Vercel stores the 3 Supabase vars for
  **Production + Preview only — no Development env**, and `vercel env pull` defaults to Development,
  so it would have written a near-empty file and clobbered the working `.env.local`. Local also
  holds a Vercel-absent `SUPABASE_ACCESS_TOKEN`. Kept local `.env.local` as source of truth;
  removed the transient secret backup.
- **No repo file changes** — `.vercel/` is gitignored; the `.obsidian/*` edits in the tree are
  pre-existing, not from this session.

## Why

Local Vercel tooling (env pull, `vercel dev`, manual `vercel`/`--prod`) was unavailable — the repo
was never linked. The project is now linked to the deploying `monilith` Vercel project, which also
corroborates the `[[2026-06-21-1416-promote-command-build]]` assumption that prod-deploy state is
readable as the `"Vercel"` commit status on `Synapsekw/Monilith`.

## How to test (for the user)

No user-facing behavior to test — local tooling only. Quick self-verify in a **new** terminal (or
prefix with `! ` here): `vercel whoami` (→ your login) and `vercel project ls` (→ lists `monilith`).

## Open threads

- **No Development env in Vercel** — plain `vercel env pull` won't sync cleanly until the 3 Supabase
  vars are added to Development (or pull Production explicitly into `.env.production.local`). Left as
  an optional follow-up per user's choice to keep local untouched.
- `vercel` is on `PATH` for **new** shells only (via `~/.zshrc`); already-open shells need
  `source ~/.zshrc` or the full path `~/Library/pnpm/vercel`.

## Next session entry point

CLI is installed + linked; nothing required. If env sync is wanted later, either add the Supabase
vars to Vercel's Development env or `vercel env pull --environment=production .env.production.local`.

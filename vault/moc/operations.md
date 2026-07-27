---
type: moc
status: active
tags: [moc/operations]
related: ["[[00-north-star]]"]
---

# Operations — Map of Content

> How Monolith is built, wired, and run. Runbooks for Supabase, MCP, migrations, and deploy.

## Environment & secrets

- `.env.local` (gitignored) — real Supabase URL + anon key + `SUPABASE_SERVICE_ROLE_KEY`. The
  service-role key is **server-only**, never reaches the browser.
- `.env.example` — the template (committed, blank values).
- `src/lib/env.ts` — Zod-validated env access; fail fast on missing/invalid vars.

## Supabase + MCP (spec §3)

- Hosted Supabase MCP server via OAuth; `.mcp.json` at repo root, scoped to project,
  `read_only=true` by default.
- 🧑 **Manual (Danijel):** create the Supabase project; paste URL/anon/service-role keys into
  `.env.local`; set the real `project_ref` in `.mcp.json`; `claude /mcp` → browser OAuth; approve
  MCP tool calls; toggle `read_only` **off** when applying migrations.
- Local dev: Supabase CLI, versioned migrations in `supabase/migrations/`, `supabase db push`.

## Migration workflow

1. Write a versioned migration in `supabase/migrations/` (never dashboard click-ops).
2. Apply (`supabase db push`, or MCP `apply_migration` with read-only off).
3. Regenerate types → `src/types/database.types.ts` (`generate_typescript_types`).
4. Run `get_advisors` — fix any missing RLS / policies / indexes before moving on.

## Quality gates (per phase)

`pnpm test` (Vitest + RTL) · `pnpm e2e` (Playwright) · `pnpm typecheck` · `pnpm lint` ·
Supabase advisors clean · CHANGELOG entry written. Husky pre-commit runs lint-staged. **No phase
is complete with failing tests or advisor warnings.**

## Deploy

Vercel (frontend) + Supabase Cloud. Cloud-ready from day one; full deploy hardening is phase 9.

## Related MOCs

- [[architecture]]
- [[memory]]

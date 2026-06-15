---
type: moc
status: active
tags: [vault/meta]
---

# Pulse vault — How this works

The Obsidian vault is the **whole Pulse repo** (`.obsidian/` lives at the repo root, Mubarak-style);
this `vault/` folder holds the **development-memory** layer on top of the codebase: where we are,
why we made each call, and what happened session by session. The codebase tells you _what_ the code
is; this folder tells you _why_ it got that way. Modeled on the Mubarak AI vault.

## Entry point

→ **[[00-north-star]]** — the canonical "where are we, where are we going, why" doc. Open this first.

## Layout

Repo root holds `.obsidian/` (the vault config) and `vault/` (this memory layer). The app's own
`docs/` and `specs/` at repo root are indexed too.

- `vault/00-north-star.md` — the destination + current state (start here)
- `vault/product.md` — product vision, users, design principles
- `vault/moc/` — Maps of Content (thin indexes: architecture, roadmap, specs, operations, memory)
- `vault/decisions/` — ADRs and extracted gotchas (dated)
- `vault/sessions/` — what each working session did (the real "what we did" log)
- `vault/templates/` — note templates (Templater)
- `vault/_attachments/` — pasted images/files
- `docs/`, `specs/` — design docs (indexed via dataview `FROM "docs" OR "specs"`)

## Maintenance rules

### 1. North-star bump rule

When a phase closes or the current state shifts, update the relevant section in `00-north-star.md`
and bump `last-updated` in its frontmatter.

### 2. Capture a session at the end of each working block

Drop a note in `vault/sessions/` from `vault/templates/session.md`: what changed, why, open threads,
where to pick up next. Filename: `YYYY-MM-DD-HHmm-short-slug.md`.

### 3. Record gotchas as decisions

When you hit a non-obvious trap (especially Next 16 / Supabase / RLS surprises), write a short ADR
in `vault/decisions/` from `vault/templates/decision.md`. Tag it `gotcha`. This is how we stop
re-learning the same lesson.

### 4. Frontmatter-or-die

Every note starts with a YAML frontmatter block at line 1 with at least a `type`:
`session | adr | moc | north-star | product-context | report`.

## Required Obsidian community plugins

The live `dataview` / `dataviewjs` blocks and the `<% tp %>` template syntax need two community
plugins (Settings → Community plugins): **Dataview** and **Templater**. Without them the queries
render as plain code blocks and templates won't expand — everything else still works.

## Scope note

The vault spans the **whole repo** (`.obsidian/` at the repo root), so the app's `docs/` and `specs/`
are indexed alongside this `vault/` folder — the master design spec resolves as [[2026-06-14-pulse-design]].
Frontmatter-or-die (rule 4) is what makes those docs show up in the live Dataview queries. See [[memory]].

## Related

- Auto-memory at `~/.claude/projects/-Users-danijeljovanovic-Dev-Monolith/memory/` — user-level
  preferences saved by Claude Code (a different layer; coexists). See [[memory]].

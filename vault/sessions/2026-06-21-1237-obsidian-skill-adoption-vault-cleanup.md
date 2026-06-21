---
type: session
date: 2026-06-21-1237
branch: develop
trigger: wrapup
status: complete
tags: [session, tooling, vault, skills]
related:
  - "[[2026-06-21-decision-23-external-tooling-adoption-bar]]"
  - "[[dev-memory-vault]]"
---

# Obsidian CLI skill adoption + vault link/orphan cleanup

## What changed

- **Evaluated 5 friend-recommended repos** (affaan-m/ECC, ruvnet/ruflo, nexu-io/open-design, pablo-mano/Obsidian-CLI-skill, multica-ai/andrej-karpathy-skills) via 5 parallel explorer agents, judged against our Superpowers + vault + worktree setup → **4 SKIP, 1 ADOPT** (rationale in [[2026-06-21-decision-23-external-tooling-adoption-bar]]).
- **Adopted `obsidian-cli`** as a project skill (`.claude/skills/obsidian-cli/`) — graph/backlink/orphan/full-text-search/frontmatter queries over the vault via the official Obsidian CLI. Tested live in a throwaway worktree, merged via `finish-task.sh` (`e28f6f1`).
- **Wired a best-effort link-rot check into `/wrapup`** (step 6: `unresolved` + `orphans`, skips cleanly if Obsidian isn't running).
- **Used the skill to clean vault rot:** fixed a gotcha-07 wikilink date typo (`9fee66c`); repointed 3 stale links (`pdf-preview-queued`, `supabase-migration-ledger-drift`, de-linked `commit-body-and-coauthor-trailer`) + removed 3 `_draft` stubs (`bb6456a`); **de-orphaned 8 sessions + 2 ADRs** via topical backlinks (`a678458`), vault orphans **13 → 3** (only templates remain); removed a stray draft stub swept in by a directory-add (`ed815e6`).

## Why

Friend-recommended tooling needed vetting before adoption: most of it (ECC, ruflo, open-design) is globally-installed machinery that duplicates Superpowers and the vault and would create two competing brains. The Obsidian skill was the exception — low-footprint and additive (graph queries we lacked) — and adopting it immediately surfaced real link rot worth fixing.

## How to test (for the user)

1. Pull `develop`. Ensure **Obsidian Desktop is running** with the CLI enabled (Settings → Command line interface).
2. Ask in chat: _"use obsidian-cli to find broken wikilinks and orphans in vault/"_ → expect only known false positives (path strings, `LICENSE`) and the intentional auto-memory cross-refs; the 4 real broken links are gone and orphans are just the 3 templates.
3. Or run `/wrapup` — step 6 now runs the rot check automatically.

## Open threads

- Remaining `unresolved` are not rot: code-block noise + intentional `[[...]]` cross-refs to the **auto-memory** store (lives outside the Obsidian vault, so it can't resolve). Option if we ever care: symlink the memory dir into the vault.
- `commit-body-and-coauthor-trailer` was de-linked (no note existed); if we want a real "commit body + `Co-Authored-By` trailer" standing rule, add it to `AGENTS.md` or auto-memory.
- `obsidian-cli` is **main-thread only** (needs the running desktop app) — headless subagents can't use it.

## Next session entry point

Resume **Phase 6d-2 — mirror columns**. The `obsidian-cli` skill is now available for vault navigation/maintenance, and `/wrapup` self-checks link rot each session.

---
type: adr
date: 2026-06-21
status: accepted
tags: [decision, tooling, skills, process]
related:
  - "[[2026-06-21-1237-obsidian-skill-adoption-vault-cleanup]]"
  - "[[dev-memory-vault]]"
  - "[[pulse-working-agreement]]"
---

# Decision 23 — Bar for adopting external Claude-Code tooling repos

## Context

We were handed 5 community repos (agent harnesses / skill packs) to consider adopting. We already
run a mature, deliberate stack: **Superpowers** skills, a tracked **Obsidian vault** dev-memory
(+ `/wrapup`), and a **worktree + `task/<name>`** working agreement. The risk is that popular,
heavily-marketed tooling installs globally and quietly takes ownership of the same surfaces.

## Decision

Adopt external tooling only when it is **low-footprint and additive**. Concretely, **SKIP** a repo
when any of these hold; **ADOPT** (or cherry-pick) only when none do:

- installs **globally** to `~/.claude/` or runs a **daemon/MCP service** we'd have to maintain;
- ships **always-on hooks** on every tool call, or drops/overwrites `CLAUDE.md`/`settings.json`;
- **duplicates** a system we already run (Superpowers skills, the vault, the worktree flow) — two
  competing brains, not one;
- raises operating burden for a **non-engineer operator**.

Prefer copying a single **behavior or idea** into our own project-local config over installing a
bundle. Test any real candidate in a **throwaway worktree** before merging.

## Rationale

Applying the bar to the 5 repos: **ECC, ruflo (Claude-Flow), open-design** are global megasuites /
daemons that duplicate Superpowers + the vault and seize hooks/memory → SKIP. **karpathy-skills** is
one prompt-rule already covered (more rigorously) by brainstorming/TDD/verification → SKIP. Only
**Obsidian-CLI-skill** passed — two markdown files, no hooks, no global writes, and it adds a real
capability we lacked (graph/backlink/orphan/search queries over the vault) → ADOPT.

## Consequences

- Positive: one coherent toolchain; no competing memory/skill systems; adoption decisions are fast
  and consistent.
- Negative: we forgo some flashy capabilities (swarms, artifact generators) that don't fit our stack.
- Open follow-ups: `obsidian-cli` is main-thread-only (needs the desktop app); revisit if a headless
  vault-query path is ever needed.

## Related

- [[2026-06-21-1237-obsidian-skill-adoption-vault-cleanup]]
- [[pulse-working-agreement]]

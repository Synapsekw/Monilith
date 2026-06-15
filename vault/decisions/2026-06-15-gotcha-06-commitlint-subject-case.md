---
type: adr
date: 2026-06-15
status: accepted
tags: [decision, gotcha]
related: ["[[2026-06-15-1946-phase3a-views-kanban]]"]
---

# Gotcha 06 — commitlint rejects commit subjects that start uppercase

## Context

The repo runs `@commitlint/config-conventional` on a commit-msg hook. Its `subject-case` rule
disallows `sentence-case`, `start-case`, `pascal-case`, and `upper-case` subjects. In practice this
means **the subject (the text after `type(scope): `) must start with a lowercase word** and must not
be an all-caps token at the start.

Hit during Phase 3a: `test(boards): RLS coverage …` was **rejected** (leading "RLS" is upper-case),
while `feat(boards): board_views table + RLS + …` **passed** (starts lowercase; the later "RLS" is
fine). Planned messages starting with PascalCase component names (`BoardHeader …`, `KanbanBoard …`)
would also have been rejected.

## Decision

- Start every commit subject with a **lowercase** word. Prefer a lowercase verb/noun:
  `feat(boards): add BoardHeader + ViewSwitcher …`, `test(boards): rls coverage …`.
- Acronyms/PascalCase are fine **later** in the subject, just not as the first token.

## Consequences

- When authoring plans, write commit messages that already start lowercase so subagents can use them
  verbatim (saves a rejected-commit round-trip).
- camelCase identifiers as the first word are OK (they start lowercase, e.g.
  `feat(boards): buildKanbanColumns grouping logic`).

## Related

- [[2026-06-15-1946-phase3a-views-kanban]]

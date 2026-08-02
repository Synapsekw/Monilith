---
type: moc
status: active
tags: [moc/specs]
related: ["[[00-north-star]]"]
---

# Specs — Map of Content

> Index of design specs. The vault is the whole repo, so docs in `docs/` and `specs/` are linked as
> `[[wikilinks]]` and indexed by Dataview below. Frontmatter-or-die: every spec needs a `type:` to
> appear in the live query.

## Master spec

- [[2026-06-14-pulse-design]] — **Monolith — Master Design Spec**, approved 2026-06-14
  (`docs/superpowers/specs/`). The source of truth: product vision, tech stack, environment/MCP,
  full feature set, data model + Supabase conventions, design system, phased build plan, engineering
  guardrails, manual responsibilities.

## Live: all specs/docs by recency

```dataview
TABLE type, status, file.mtime as "Updated"
FROM "docs" OR "specs"
WHERE type
SORT file.mtime DESC
```

Spec sections:

- §1 Product vision · §2 Tech stack · §3 Environment & MCP · §4 Feature set
  (Monday core / ClickUp depth / Asana polish / cross-cutting) · §5 Data model & Supabase
  conventions · §6 Design system · §7 Phased build plan · §8 Engineering guardrails ·
  §9 Manual responsibilities.

## Derived

- [[platform-roadmap]] — the §7 build plan with live status
- [[architecture]] — the §2/§5/§6 detail as a code-structure map

> Per-phase implementation plans (derived from §7) live alongside the master spec at repo root as
> they're written. Add links here as they appear.

## Related MOCs

- [[architecture]]
- [[operations]]

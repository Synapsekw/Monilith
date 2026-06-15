---
type: moc
status: active
tags: [moc/memory]
related: ["[[00-north-star]]", "[[README]]"]
---

# Memory — Map of Content

> Self-referential map. Where does Pulse's project memory live? Three layers:

## Layer 1: Project state (this vault)

The Obsidian vault is the **whole repo** (`.obsidian/` lives at the repo root, Mubarak-style), so
notes here and the project's `docs/`/`specs/` are all indexable.

- [[00-north-star]] — destination + current state
- [[product]] — product vision + design context
- `vault/sessions/` — session-by-session captures (what we did, why, where to pick up)
- `vault/decisions/` — ADRs and extracted gotchas
- `vault/moc/*` — index notes (this file is one)
- `docs/`, `specs/` — design docs at repo root, indexed via dataview `FROM "docs" OR "specs"`

## Layer 2: Subagent memory (per-agent scratch)

`.claude/agent-memory/` (repo root, if/when used) — agent-specific carry-over for repeated task types.

## Layer 3: User-level auto-memory (machine-local, persists across projects)

`~/.claude/projects/-Users-danijeljovanovic-Dev-Monolith/memory/` — preferences, feedback, and
project facts saved automatically by Claude Code. Outside the repo. Indexed by `MEMORY.md` there.

**Coexistence:** Layer 3 is _user behaviour_; Layer 1 is _project state_. They don't overlap.

## Gotchas (extracted ADRs)

```dataview
TABLE status, file.cday as "Recorded"
FROM "vault/decisions"
WHERE contains(tags, "gotcha")
SORT file.cday DESC
```

## Recent sessions

```dataview
TABLE branch, file.mtime as "Updated"
FROM "vault/sessions"
WHERE type = "session"
SORT file.mtime DESC
LIMIT 10
```

## Related MOCs

- [[architecture]]
- [[operations]]

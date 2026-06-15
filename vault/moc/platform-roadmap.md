---
type: moc
status: active
tags: [moc/roadmap]
related: ["[[00-north-star]]"]
---

# Platform Roadmap — Map of Content

> The phased build plan (master spec §7). Phase status is mirrored in [[00-north-star]] §2 —
> bump it there when a phase closes. Commit + checkpoint after each phase: run tests, run
> advisors, regenerate types, write a CHANGELOG entry, pause for review.

## Phases

| #   | Phase                              | Outcome                                                                           | Status          |
| --- | ---------------------------------- | --------------------------------------------------------------------------------- | --------------- |
| 0   | Setup                              | Scaffold, deps, theming tokens, Supabase + MCP wired; themed shell + ⌘K stub      | **Done**        |
| 1   | Auth & tenancy                     | Supabase Auth, org creation + membership, protected routes, RLS baseline          | **In progress** |
| 2   | Boards core                        | Workspaces→boards→groups→items, Table view, inline edit, optimistic, realtime     | Not started     |
| 3   | Views                              | Kanban + Calendar + Timeline/Gantt (deps); switcher + saved config                | Not started     |
| 4   | Collaboration                      | Item panel, updates/comments/@mentions, attachments, activity log, notifications  | Not started     |
| 5   | Automations + Rules                | Trigger/condition/action builder; Postgres triggers + Edge Functions              | Not started     |
| 6   | ClickUp depth                      | Subitems/nesting, time tracking, Docs, custom statuses/fields, relations + mirror | Not started     |
| 7   | Asana polish                       | Goals/OKRs, Portfolios, Workload/capacity                                         | Not started     |
| 8   | Dashboards + templates + ⌘K polish | Cross-board widgets, templates, palette polish                                    | Not started     |
| 9   | Hardening                          | Performance, advisors clean, tests, a11y audit, Vercel deploy                     | Not started     |

## Sessions by phase

```dataview
TABLE branch, date as "When"
FROM "vault/sessions"
WHERE type = "session"
SORT file.name DESC
```

## Related MOCs

- [[architecture]]
- [[specs]]

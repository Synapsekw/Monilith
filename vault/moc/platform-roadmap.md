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

| #   | Phase                              | Outcome                                                                                                                                                                                                                                                                                                                                                                                                      | Status                                              |
| --- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| 0   | Setup                              | Scaffold, deps, theming tokens, Supabase + MCP wired; themed shell + ⌘K stub                                                                                                                                                                                                                                                                                                                                 | **Done**                                            |
| 1   | Auth & tenancy                     | Supabase Auth, org creation + membership, protected routes, RLS baseline                                                                                                                                                                                                                                                                                                                                     | **Done**                                            |
| 2   | Boards core                        | Workspaces→boards→groups→items, Table view, inline edit, optimistic, realtime                                                                                                                                                                                                                                                                                                                                | **Done**                                            |
| 3   | Views                              | Kanban + Calendar + Timeline/Gantt (deps); switcher + saved config                                                                                                                                                                                                                                                                                                                                           | **Done** (3a + 3b)                                  |
| RS  | Design refresh (dark-first reskin) | Align shipped surfaces to dark near-black look; reuse in-repo prototype ([[2026-06-16-decision-08-dark-first-monday-reskin]])                                                                                                                                                                                                                                                                                | **Done** (dark + light)                             |
| 4   | Collaboration                      | Item panel, updates/comments/@mentions, attachments, activity log, notifications ([[2026-06-16-phase-4-collaboration-design\|spec]]: 4a panel+updates+activity → 4b @mentions+notifications → 4c attachments)                                                                                                                                                                                                | **Done** (4a+4b+4c)                                 |
| 5   | Automations + Rules                | Trigger/condition/action builder; Postgres triggers + `pg_cron`/`pg_net`                                                                                                                                                                                                                                                                                                                                     | **Done** (5a→5c-2)                                  |
| 6   | ClickUp depth                      | Subitems/nesting, time tracking, Docs, custom statuses/fields, relations + mirror, real-time collab (presence)                                                                                                                                                                                                                                                                                               | **In progress** (6a–6h done; 6e Docs deferred)      |
| 7   | Asana polish                       | Goals/OKRs, Portfolios, Workload/capacity                                                                                                                                                                                                                                                                                                                                                                    | **In progress** (7a + 7b + 7c done)                 |
| 8   | Dashboards + templates + ⌘K polish | Cross-board widgets, templates, palette polish                                                                                                                                                                                                                                                                                                                                                               | **Done** (D1–D3b + templates + ⌘K)                  |
| 9   | Hardening                          | Performance, advisors clean, tests, a11y audit, Vercel deploy                                                                                                                                                                                                                                                                                                                                                | **In progress** (design locked; 9.1 done; 9.2 next) |
| 10  | AI & Agents                        | Reusable AI platform layer (gateway · Vault BYO-key store · usage ledger/credits · entitlements) + a feature wave (Ask Monolith, item assist, generation, agentic automations, semantic search) sold **managed or BYO-key**. Scope: `docs/superpowers/specs/2026-07-05-ai-platform-phase-10-scope.md`; E1 spec `…-ai-foundation-and-ask-pulse-design.md`. ([[2026-07-05-decision-26-ai-platform-dual-billing]]) | **E1 done** (develop); E2–E6 + Ask-full-page open   |

> **RS** is a cross-cutting workstream, not a renumber of 0–9 — it re-skins what's shipped and the
> feature phases then land on the dark surface, reusing prototype view/logic code where portable.

> **Phase 10** is decomposed into 6 epics (E1 Foundation+Ask Monolith → E2 Item assist · E3 Conversational
> actions · E4 Generation · E6 Billing [parallel after E1] → E5 Agentic automation [long pole]). E1 is
> the critical path and the ~2-week ship-in-2 slice. Per-epic specs/plans land just-in-time. **E1 is
> done on develop.**

> **Ask Monolith full-page (queued, not started)** — owner-approved expansion of the shipped Ask Monolith
> popup into a standalone `/ask` chat page (side-nav destination, persisted per-user cross-board
> history, multi-turn rolling-summary memory, token streaming; Phase 2 adds confirm-before-execute
> write actions). Spans E1 F5 (the chat surface) + E3 F6 (write actions, pulled forward). Deliberately
> reverses the original "AI at the seams, no standalone chat" stance
> ([[2026-07-12-decision-27-ask-becomes-standalone-surface]]). Spec + Phase-1 plan written 2026-07-12:
> `docs/superpowers/specs/2026-07-12-ask-pulse-full-page-conversational-design.md`,
> `docs/superpowers/plans/2026-07-12-ask-pulse-full-page-conversational.md`.

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

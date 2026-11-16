---
type: session
date: 2026-11-16-1648
branch: develop
trigger: wrapup
status: complete
tags: [session]
related: ["[[2026-11-15-1309-folder-invites-and-command-center-tower]]", "[[2026-11-15-0726-mono-focus-today-and-retrieval]]", "[[2026-11-15-1838-mcp-connection-permanence]]"]
---

# Feature review and two fix waves

## What changed

- **Review** of everything shipped in PR #152 (four read-only agents), then **twelve task branches** built in parallel worktrees and merged one at a time. `develop` head `7199237b`, last gate 15,272 tests. Seven migrations applied to DEV through the dashboard SQL editor, each after a rolled-back dry run; ledger 217/217.
- **Wave 1 (security and correctness):** view-only boards are read-only everywhere; folder share and invite need ownership of every board in the folder or an org admin (`20261115173604`, closed a view-only-to-editor escalation); the invited person's path works end to end (`/auth/confirm`, `20261115173702`); a guest sees only people, workspaces and Monos shared with them (`20261115173759`); connected apps expire after 90 idle days, self-heal only on real session loss, and a password change disconnects them (`20261115173811`); one rule for done, due and overdue ([[2026-11-15-decision-46-one-rule-for-done-due-and-overdue]], `20261115173751`).
- **Wave 2 (missing pieces):** item panel Fields and Linked from; automations read-only for viewers (an update or delete that matched zero rows used to report success); cap notices, and MCP `list_items` now returns every cell (it cut at 1,000 on 11 of 29 live boards); assistant tools `list_folders`, `list_people`, `add_comment`, relations in `get_item` (41 tools); Today row actions with due today first (`20261116112326`); folder KPI drill-down and the attention filter moved into SQL (`20261116112338`).
- Live numbers: largest folder overdue 762 to 402; its attention list held 567 rows and showed 100; the Today block showed zero due-today items for every busy member.
- `/updates`: every branch carries a `Changelog:` trailer; nothing extra announced.

## Why

The owner asked for a second look at the latest features and whether anything was missing. The review found one privilege escalation, several surfaces that lied to view-only people, and counts that disagreed between screens; the fixes followed in two parallel waves.

## How to test (for the user)

Pull `develop`, `pnpm build && pnpm start -p 3001`, open `http://localhost:3001` (uses the live DEV data).

1. Largest folder, Overview: Overdue reads about 402. Click the card: the items open underneath, "Showing 50 of 402".
2. Needs attention: expand a board; rows load 20 at a time with a true total.
3. `/my-work`: Today starts with "Due today". Click a row's circle to mark it done, or its date to move it. The row updates without a reload.
4. Open any item, Fields tab: every column with its value, editable. "Linked from" lists items that link here.
5. As a view-only member: no edit controls on cells, the item panel, Automations (rules and runs are visible, no switch or delete), or the folder Timeline row menu.
6. Share a folder that holds someone else's board as a non-admin: refused with a plain reason under the field.
7. Settings, Connected apps: each app shows last used and expiry. Change password: the list empties.
8. `/ask`: "What's overdue in the <folder name> folder?" finds the folder by name. Ask it to comment on an item: a confirm card appears, nothing posts before Apply.

## Open threads

- **Not promoted.** After promotion the owner must paste `supabase/templates/invite.html` into the Supabase "Invite user" template, set Site URL `https://www.monolith.works` and add `/auth/confirm` to the redirect URLs.
- Browser-checked on a local build (light theme, owner account): folder drill-down, Today block, item panel Fields, assistant read and comment card. **Not** checked: the invite email end to end, a guest's view, a view-only account, MCP reconnect after a revoked session, dark theme, touch.
- Owner decisions open: one overdue number everywhere (assistant counts subitems, 440; folders count top-level, 402); whether a folder viewer may rename, delete or customize a folder; deleting about 43 orphan `mcp_bridge` Vault secrets.
- The dock Ask chat stages board writes for a view-only person (the database refuses on Apply; the executor was not traced). Confirm cards outside a board say "an item" instead of naming it.
- Backlog from the agents: silent cuts at 5,000 items and 200 attachments in the board payload; a dashboard widget read cut at 1,000 rows; export ignores the truncation flag; the old assistant loop still serves the Intelligence ask and the palette quick action; the panel header "OWNER" chip shows the creator; a React hydration error (#418) on the folder page; `get_focus_today` (old) can be dropped after promotion; 7 of 12 MCP connections were idle past 90 days and must reconnect.
- Two gate runs failed on environment (a network timeout to Supabase; CPU overload with several suites running) and passed on re-run.

## Next session entry point

Run `/promote` for `develop` (head `7199237b`), then the owner's Supabase invite-template step, then the unchecked browser paths above, starting with the invite email and a guest account.

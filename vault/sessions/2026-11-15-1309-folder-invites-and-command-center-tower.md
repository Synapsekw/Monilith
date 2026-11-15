---
type: session
date: 2026-11-15-1309
branch: develop
trigger: wrapup
status: complete
tags: [session]
related: []
---

# Folder invites and the command center "Tower"

## What changed

- **Folder invites** merged to `develop` (`e9a1f5ea`). Invite a member or an email to a folder as
  viewer or editor; they get every board in it, including boards added later. Outsiders join as
  `guest` and see only their folders. Four migrations, all live on DEV: `20261114132219`,
  `20261114135114`, `20261114191239`, `20261114201906`. The four board access helpers gained the
  folder path, so 68 policies inherit it unedited.
- **Command center "Tower"** merged to `develop` (`8d80fdd7`). KPI trends, burn forecast, board by
  week load heat map, people section, boards with health and sort, grouped attention, "Items by
  stage" for folders without dates. Migration `20261114145347` live on DEV (`folder_burn` gained two
  columns; new `folder_burn_packed` and `folder_load`).
- **A live bug found and fixed on the way:** the burn read returned a stage by week grid (4,088 rows
  on DAAS) through an API capped at 1,000 rows, so the chart showed 14 of 56 stages. Now one packed
  call. Still wrong on production until `develop` is promoted.
- Reviews caught, before any apply: folder takeover through a mutable `created_by`, a board swap
  into a shared folder, an account-existence leak in the invite response, and guest reach into
  workspaces, report links, board agents and Monos.
- Nameless org members now show their email on folder surfaces instead of "Unknown member".
- `/updates`: three entries announced for 2026-11-15 (`036ab407`): folder invites, the richer folder
  overview, and the burn chart fix. They publish with the next promotion.

## Why

The owner asked for one action to bring a person onto a whole folder, and for the folder page to be
useful. Access is a security boundary on the database that serves production, so every migration
was proven in a rolled-back run on real data before it was applied.

## How to test (for the user)

Run the app from the main checkout on `develop`. Nothing to apply; the database side is live.

1. Open a folder. Expect an **Invite** button top right; sidebar folder menu has **Share folder…**.
2. Invite: type a colleague's name, Add as Viewer. Expect them listed and an avatar by the button.
3. Change their level to Editor. Open a board in the folder, Share: expect "Through folder … · Editor".
4. Type the same person's email and Invite. Expect "That person already has access".
5. Move a board into that folder. Expect a confirm naming how many people get access.
6. Remove the person. Expect the list to empty.
7. Open DAAS. Expect the heat map, a burn chart rising to about 2,000 planned, and the reading
   "… behind plan today. Everything completed so far arrived already done …".
8. Pick a board in the filter. Expect every section, including people, to narrow to it.
9. Open CRM. Expect "Items by stage", zero cards as chips, no heat map.
10. Customize: Sections sheet offers Load and People; an empty section shows a slim placeholder.

## Open threads

- **Promote soon.** A layout saved on `develop` with `load` or `people` falls back to its preset on
  the old production code.
- Folder "overdue" counts any passed date, including a start date (742 on DAAS, 292 red heat-map
  cells). Boards moved to a due-date rule this week; folders should follow.
- Each folder RPC on DAAS costs about 620 ms because each recomputes the per-item flags.
- Not browser-tested: the email invite path, the guest's own view, the move confirm.
- The RLS suite for folder members (54 cases) has never run; no test database on this machine.
- No rate limit on invitation emails a folder creator can send.
- Drop the unused dense `folder_burn` after promotion; include all five migrations in `/sync-prod`.
- Seven `_draft-*.md` stubs in `vault/sessions/` were left alone; other sessions were active.

## Next session entry point

Promote `develop` to `main`, then walk the test list above on production. After that, the folder
overdue rule and the combined per-item flags read are the two follow-ups worth a task each.

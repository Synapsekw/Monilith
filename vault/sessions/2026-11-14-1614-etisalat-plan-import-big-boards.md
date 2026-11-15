---
type: session
date: 2026-11-14-1614
branch: develop
trigger: wrapup
status: complete
tags: [session]
related:
  - "[[2026-11-14-1124-cross-board-dependencies-folder-timeline]]"
---

# Etisalat plan import and loading for big boards

## What changed

- Imported the Etisalat Drones & Robotics tracker (2,127 activities, 1,360 dependencies) into the DAAS folder on DEV as **11 boards**, one per workstream, with Procurement and Productization split out: Programme Governance & PMO, Platform & Integrations, Site & Infrastructure, Procurement, Productization, Operational Readiness, Client Pursuits, Client Service Delivery, Ecosystem & Partners, Marketing & Events, Innovation Centre & PI Lab. Groups are sub-workstreams (2–13 per board); 76 links cross boards; parents with children became subitems; start dates follow the tracker's own scheduling rule. A first attempt (one 1,770-item board plus two) was archived after the owner asked for a split.
- The import ran as one transaction per pass through the Supabase management API (owner-approved route A), acting as the owner via `request.jwt.claims` and the app's own `import_rows_into_board`. A first payload hit HTTP 413; a compact payload expanded server-side then exhausted temp disk because every row carried the whole 900 KB JSON into a sort. Small materialized CTEs fixed it. Every pass was dry-run with `rollback` first.
- People: Owner and Support are people columns for the 9 matched org members (Nathanel and Irdhina on their gmail accounts, per the owner); unmatched names stay as text in Other owners / Other support; assignees got editor access (44 grants). Non-status option colours avoid red, yellow and green (reserved for Status); "D&R ·" prefix removed from board names.
- Fix merged as `d39463f4`: `getBoardPayload` read every table in one request, and PostgREST truncates at `max_rows` = 1000 whatever `.limit()` says, so any board over ~1000 cells showed blank rows. New `fetchAllRows` (`src/lib/supabase/paginate.ts`) pages items, cells, dependencies, relation links and mirror cells with total orders; cell cap 20000 → 60000.
- Fix in the same merge: group headers sat off their columns when `name_column_width` is null, because the auto-fit measures text on a canvas the server lacks and React keeps the server's style on hydration. `useHydrated()` now gates the measurement.
- Announced the loading fix on `/updates` for 2026-11-14.

## Why

The tracker is the first real programme plan moved into Monolith, and the cross-board dependency and folder Timeline work exists for it. It also exposed that no live board had ever exceeded 1,000 cells, so the PostgREST cap had been silently latent in the board read.

## How to test (for the user)

1. Wait for the next promotion (or pull `develop` and run locally). Until then www.monolith.works still shows blank cells on these boards.
2. Open DAAS, then **Platform & Integrations** (441 items). Every row shows Status, Programme, Owner (a person), Start and Due; each group header sits over its own column.
3. Scroll to the bottom: the only rows without values are collapsed parents, which show rollup bars.
4. Open **Procurement**: two groups, parents expand to subitems.
5. Open DAAS **Timeline**: 11 bands, arrows between boards.
6. Open any item, **Fields**, **Links / Dependencies**: it lists what it waits on and blocks, including other boards.
7. Sign in as an assigned member (for example Ivan): the items appear in **My Work** and the boards are editable.

## Open threads

- `fetchAllRows` treats a short page as the end, so the page size must equal the hosted `max_rows`. Verified 1000 on DEV only; check PROD at cutover.
- Review minors deferred: waves fetch up to 8 pages even when fewer are needed; pages are not one snapshot; `.in("id", …)` linked-name reads are unpaged and could hit URL length limits above ~1000 ids.
- Sabari, James Velasco, Michael Thabit, Ravi Suthar and others are not users yet; their names are text. Five matched members have no display name, so they show as emails.
- Customer 0 and POCs & Service Delivery were archived from the app this morning (not by the import); the old Ecosystem & Partners board no longer exists.
- Plan board not refreshed; Obsidian link-rot check skipped.

## Next session entry point

Promote `develop` so the big-board fix reaches production, then walk the DAAS boards with the owner and decide whether the imported Status values should be refreshed from the tracker before the team starts using the boards.

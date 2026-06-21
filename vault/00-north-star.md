---
type: north-star
status: active
last-updated: 2026-06-21-1119
tags: [project/pulse, north-star]
related:
  - "[[README]]"
  - "[[product]]"
---

# Pulse — North Star

> Single canonical entry point. Where are we, where are we going, why. Open this first.
> **When state changes, update the relevant section and bump `last-updated` in the frontmatter.**

## 1. Pitch

**Pulse** is a cloud-native **"Work OS"** in the spirit of Monday.com — folding in the best of
ClickUp (nested hierarchy, docs, native time tracking) and Asana (goals/OKRs, workload, portfolios)
into one coherent product. Not a clone: the _ultimate_ version. Monday's visual, color-coded board
experience as the foundation; ClickUp's depth; Asana's polish. Design language: modern monochromatic
(neutral grayscale) with a single configurable accent, **dark-first** (layered near-black surfaces +
indigo accent; light supported but secondary), Linear-grade restraint applied to a colorful category.
Built on **Next.js 16 + React 19 + Tailwind v4 + Supabase**, multi-tenant (org-scoped RLS) from day one.

Master spec: [[2026-06-14-pulse-design]] (`docs/superpowers/specs/2026-06-14-pulse-design.md`).
Visual reskin target + prototype reuse map: [[2026-06-16-decision-08-dark-first-monday-reskin]].

## 2. Product north star — phased build (0 → 9)

From the master spec §7. Each phase: status + one-line outcome. **Commit + checkpoint after each;
run tests + advisors + regenerate types before moving on.**

- **0 — Setup** — <span style="color:#22c55e">**[Done]**</span>
  Scaffold, deps, theming tokens, Supabase + MCP wired. Themed empty app shell, dark/light toggle, ⌘K stub.
  _Done 2026-06-14 (commits `25c3e04` → `fea23fa`). See [[2026-06-14-phase0-setup]]._
- **1 — Auth & tenancy** — <span style="color:#22c55e">**[Done]**</span>
  Email/password auth, org creation + membership, protected routes, RLS baseline.
  _Done 2026-06-15 (commits `d9fc02c` → `31336e5`). RLS isolation proven by integration test; 32 unit tests + e2e green. See [[2026-06-15-phase1-auth-tenancy]]._
- **2 — Boards core** — <span style="color:#22c55e">**[Done — 2a+2b+2c]**</span>
  Workspaces→boards→groups→items, Table view (Text/Status/People/Date/Numbers/Dropdown), inline editing, optimistic updates, realtime.
  _**2a** schema+RLS+RPCs + read-only virtualized Table · **2b** inline editors (6 kinds) + optimistic cache + realtime · **2c** column management (add/rename/delete/resize). See [[2026-06-15-1053-phase2a-boards-core]], [[2026-06-15-1259-phase2b-boards-interactive]], [[2026-06-17-1929-phase2c-column-management]]._
- **3 — Views** — <span style="color:#22c55e">**[Done]**</span>
  Kanban + Calendar + Timeline/Gantt with dependencies; view switcher + saved config.
  _**3a**: `board_views` + RLS + RPCs, view switcher (client-side `?view=` switching, no RSC refetch),
  Kanban. **3b** (2026-06-16): Calendar (`CalendarBoard` + `dates.ts`/`calendar.ts`) and Timeline/Gantt
  (`GanttBoard` + `gantt.ts`) with the `item_dependencies` model (cycle-safe RPC + RLS, 23 integration
  tests). Per-kind view config; ViewSwitcher add-view menu. See [[2026-06-16-2009-dark-reskin-calendar-timeline]]._
- **4 — Collaboration** — <span style="color:#22c55e">**[Done]**</span>
  Item detail panel, updates/comments/@mentions, attachments, activity log, notifications inbox.
  _**4a** `?item=` drawer (History API, 0 RSC refetch) + Updates + trigger-driven Activity Log · **4b** @mentions + per-user `notifications` table + inbox bell · **4c** item-level attachments (private Storage bucket + Storage-object RLS + Monday-style Files tab). Spec [[2026-06-16-phase-4-collaboration-design]]; see [[2026-06-17-0846-phase4a-item-panel-updates-activity]], [[2026-06-17-0920-phase4b-mentions-notifications]], [[2026-06-17-1400-phase4c-attachments]]._
- **5 — Automations + Rules** — <span style="color:#22c55e">**[Done — 5a + 5b-1 + 5b-2 + 5c-1 + 5c-2]**</span>
  Trigger/condition/action builder; Postgres triggers + `pg_cron`/`pg_net` (no Edge Functions); recipes.
  _**5a** in-DB engine — `automations` table + `cell_values` `AFTER` trigger (depth-cap guard) → notify-person + set-option, per-board builder + recipes · **5b-1** `item_created`/`person_assigned` triggers + flat AND/OR **"If" condition** (reuses D3b filter machinery, in-DB predicate) · **5b-2** **date-based** triggers via `pg_cron` (`date_reached` + hourly 08:00-org-local sweep + once-only ledger + `/settings` timezone) · **5c-1** **run-history** (`automation_runs`, fault-isolated `_automation_run` begin/exception, per-rule "Recent runs" disclosure + prune) · **5c-2** external **webhook actions** (`call_webhook` via `pg_net` + reconcile sweep + SSRF guard + admin-gate DB trigger). See [[2026-06-18-1711-phase5a-automations]], [[2026-06-18-1653-phase5b1-automations-triggers-condition]], [[2026-06-18-2222-phase5b2-date-triggers]], [[2026-06-19-0957-phase5c1-run-history]], [[2026-06-19-1316-phase5c2-webhook-actions]]._
- **6 — ClickUp depth** — <span style="color:#eab308">**[In progress — 6a + 6b + 6c done]**</span>
  Subitems/nesting, time tracking, Docs, custom statuses/fields, relations + mirror columns.
  _Split into 5 slices (A subitems · B custom fields/statuses · C time tracking · D relations+mirror · E docs).
  **6a — Subitems** (Done 2026-06-19): single-level nesting reusing `items.parent_id` + a `tg_items_single_level` BEFORE-trigger; subitems share the board's columns; Table nesting (dnd-sortable sub-block + read-only rollups on collapsed parents); new `addSubitem`/`deleteItem`/`reorderItem`. See [[2026-06-19-phase-6a-subitems-design]], [[2026-06-19-phase-6a-subitems]]._
  **6b — Custom fields/statuses** (Done 2026-06-20, subagent-driven): **G1** edit status/dropdown options after creation — `updateColumnSettings` + `delete_column_option` RPC (removes option + clears referencing cells atomically) + `ColumnOptionsDialog` (add/rename/recolor/drag-reorder/remove, swatch palette, count-confirm); **G2** five scalar kinds (Checkbox, Rating, Link, Email, Phone) via the discriminated-union/switch pattern + `COLUMN_KIND_META` Add-menu + rollup cases; **G3** Files column (`attachments.column_id` + bounded payload query + `FilesCell` upload/thumbnail/lightbox, 0 round-trips on first paint). Review caught + fixed a Critical link-cell XSS (`javascript:` URLs → http(s)-only `isHttpUrl` guard). 665 unit tests + live RPC integration + Playwright e2e green. Spec [[2026-06-19-phase-6b-custom-fields-statuses-design]], session [[2026-06-20-1210-phase6b-custom-fields-statuses]].\_
  **6c — Time tracking** (Done 2026-06-20, subagent-driven): Monday-style `time_tracking` column kind — new `time_entries` side table (org-scoped RLS, one-running-per-user partial-unique, atomic `start_timer` SECURITY DEFINER RPC), per-item estimate in `cell_values`, server actions + optimistic cache mutations, `TimeTrackingCell` (live tick + popover: flat session list, manual add/edit/delete, inline estimate) + collapsed-parent Σ duration rollup. 12-task subagent-driven build; final review SHIP-WITH-NITS; gate green (852 unit + 4/4 live integration + 1 e2e). Spec [[2026-06-20-phase-6c-time-tracking-design]], session [[2026-06-20-1954-phase6c-time-tracking]]. **Next: 6d — relations + mirror.**\_
  **6f — Inline PDF preview** (Built 2026-06-20, local `develop` not pushed): attachments extension — client-only `PdfPreview` (PDF.js → canvas, lazy `next/dynamic`), pdf-only `getAttachmentPdfUrl` signing action, `kind === "pdf"` lightbox branch on both Files tab + board Files cell, `canPreviewInline` affordance. Bucket-only, no new infra; worker bundles natively under Next 16. Verified green in isolation (typecheck · lint · 714 unit · build); push blocked only by a concurrent board-sharing session's non-compiling HEAD. Spec [[2026-06-20-document-preview-pdf-design]], session [[2026-06-20-2202-phase6f-pdf-preview-build]].\_
  **6d-1 — Relations / Connect boards** (Done 2026-06-21): new `relation` column kind linking an item to one/many items on a configured target board. `relation_links` join table + atomic `set_relation_links` replace RPC (gated on `can_edit_board`); cross-board RLS proven by 7 live integration tests (viewer sees link rows but linked name RLS-filtered to null). 0-round-trip payload hydration, optimistic mutation, `RelationCell` + RLS-scoped picker + `RelationColumnConfig` add-column dialog + "N linked" rollup. Built orchestrator-inline in a worktree, merged via `finish-task.sh`. **Deferred to 6d-2: mirror columns** (the join table is shaped for it), multi-target boards, two-way reciprocal links. Spec [[2026-06-21-phase-6d1-relations-design]], session [[2026-06-21-1119-phase-6d1-relations]]. **Next: 6d-2 — mirror.**\_
- **7 — Asana polish** — **[Not started]**
  Goals/OKRs, Portfolios, Workload/capacity.
- **8 — Dashboards + templates + ⌘K polish** — <span style="color:#22c55e">**[Done — widgets (D1+D2+D3a+D3b) + templates + ⌘K]**</span>
  _**Dashboards** cross-board workspace widgets: **D1** `dashboards`/`dashboard_widgets` + `dashboard_aggregate` RPC spine + `react-grid-layout` v2 canvas (0-refetch-on-drag) + Number widget · **D2** Chart (bar/pie) + Battery (status-distribution) · **D3a** List widget (bounded latest-N rows) · **D3b** flat AND/OR List filter (`dashboard_list_rows` RPC + FilterBuilder), closing the widget subsystem. See [[2026-06-17-2048-dashboards-d1-foundation]], [[2026-06-17-2119-dashboards-d2-chart-battery]], [[2026-06-17-2155-dashboards-d3a-list-widget]], [[2026-06-18-0818-dashboards-d3b-list-filter]]._
  _**Board templates** built-in catalog (Blank/Sprint/Content/CRM) → atomic `create_board_from_template` RPC + sidebar picker. See [[2026-06-18-1128-phase8-board-templates]]._
  _**⌘K polish** (closes Phase 8): palette Navigation (jump to any board/dashboard, 0 fetch) + Create (new board/dashboard). See [[2026-06-18-1323-phase8-cmdk-polish]]._
- **9 — Hardening** — **[Not started]**
  Performance (virtualization, indexes), advisors clean, tests, a11y audit, Vercel deploy.

**RS — Design refresh (dark-first reskin)** — <span style="color:#22c55e">**[Done — dark + light]**</span>
Dark-first near-black palette as `.dark` `@theme`/OKLch tokens (+ elevation, scrollbar, animations,
"direction C" board density), dark default. **Light-mode pass shipped 2026-06-18** — `pillTextColor`
luminance helper + light-token polish + full Playwright sweep (20 surfaces). Both modes user-verified.
Target + reuse map: [[2026-06-16-decision-08-dark-first-monday-reskin]]. See [[2026-06-18-1541-light-mode-reskin]].

**Where we are:** Phases 0–4 done **and promoted to `main`** (PR #16 squash-merged 2026-06-17 — integration only, no Vercel project yet). **Phase 8 closed** (Dashboards D1–D3b + board templates + ⌘K polish, all pushed). **RS reskin complete** (dark + light). **Phase 5 (Automations + Rules) closed 2026-06-19** (5a engine → 5b triggers/condition → 5b-2 date triggers → 5c-1 run-history → 5c-2 webhook actions, all pushed). **Phase 6 (ClickUp depth) in progress** — 6a Subitems + 6b Custom fields/statuses + 6c Time tracking shipped + pushed (6c subagent-driven, final review SHIP-WITH-NITS, gate green); **6f Inline PDF preview** + cross-cutting **board-level sharing** both **shipped + pushed** (2026-06-20). Cross-cutting **Org Admin + Platform Super-Admin console** shipped + pushed — now extended with **per-user management** (reset email / temp password + forced change / suspend / hard-delete with sole-owner guard) and admin nav moved to the sidebar bottom. **In-app organization invite acceptance shipped + pushed 2026-06-21** (invitees see pending invites in the notification bell with Accept/Decline; admin Settings shows declined + Re-invite) — closes the "invited member sees nothing / can't accept" gap; the empty workspace shell was also rebranded (Monolith mark + new welcome copy). **Phase 6d-1 — Relations (Connect Boards) shipped + pushed 2026-06-21** (`relation_links` join table + `set_relation_links` RPC, RLS-scoped cross-board picker, chips + "N linked" rollup; mirror/multi-target/two-way deferred to 6d-2). `develop == origin/develop` (`280478e`, full gate green); `main` not promoted past 0–4 (WebGL landing dep needs a cross-browser check). **Next: 6d-2 — mirror columns.**

## 3. Now

- **Phase:** Phase 6 (ClickUp depth) in progress — **6a + 6b + 6c + 6d-1 + 6f shipped + pushed**, plus cross-cutting **board-level sharing shipped + pushed**. **Next: 6d-2 — mirror columns** · 6e docs. Full phase status above in §2 "Where we are".
- **Latest (2026-06-21):** **Phase 6d-1 — Relations (Connect Boards)** (`task/relations-6d1` → merged `280478e`, 10 commits, **pushed — `develop == origin/develop`, full gate green via `finish-task.sh`**) — Monday-style connect-boards relation column. New `relation_links` join table + atomic `set_relation_links` RPC (gated on `can_edit_board`); cross-board RLS is the high-risk surface — a viewer of the owning board sees link rows but the linked-item **name is RLS-filtered to null** (chip omitted, no leak), proven by 7 live integration tests. 0-round-trip first paint (links + names hydrated into the board payload via a two-query JS join), optimistic `setRelationLinks` mutation, `RelationCell` (chips + "+N more" + RLS-scoped picker) + `RelationColumnConfig` add-column dialog (extended `createColumn` to accept validated initial settings) + "N linked" rollup. Built orchestrator-inline in a worktree (gotcha-28 subagent-sandbox tension). Deferred to **6d-2**: mirror columns (the join table is shaped for it), multi-target boards, two-way reciprocal links. Known: `e2e/relations.spec.ts` written but its local run latched onto the main-checkout dev server (no `relation` kind) — sound logic, runs in CI; that crash motivated a `ColumnHeader` optional-chaining guard. Spec [[2026-06-21-phase-6d1-relations-design]]; see [[2026-06-21-1119-phase-6d1-relations]].
- **Latest (2026-06-21):** **Migration-ledger drift fix** (`dc51ba7` → merged `77828be`, **pushed — `develop == origin/develop`, gate green**) — ops fix, not a phase deliverable. `db push --linked` failed on three REMOTE-only versions (`20260621044028/044145/044711`) with no local files; `20260621000000_board_access_*` showed LOCAL-only-unapplied. The orphan `.sql` files were gone from all of git, but their SQL was recovered from `supabase_migrations.schema_migrations.statements` — three iterative board-access RLS attempts whose final form (`044711`) is byte-for-byte the committed `000000`, already live. Verified live defs match, then **ledger-only repair** (`reverted` the three `0440xx`, `applied` `000000`) — zero schema/data change; `migration list` now all LOCAL==REMOTE, `db push --dry-run` clean. Also rebased a diverged local `develop` (3 phase-7a docs commits, now pushed) onto origin before merge. ADR [[2026-06-21-gotcha-29-migration-ledger-drift-throwaway-cloud-applies]]; see [[2026-06-21-1037-migration-ledger-drift-fix]].
- **Latest (2026-06-21):** **Worktree-per-session workflow + pinned commit identity** (`ccb5162`, **pushed — `develop == origin/develop`**) — process change, not a phase deliverable. Parallel sessions in one shared checkout kept colliding (a branch belongs to the folder, not the session, so temp branches alone can't isolate them — only worktrees can). Replaced working agreement #1: every building session now runs in its own git worktree on a temporary `task/<name>` branch and is **not "done" until merged into `develop` AND the worktree/branch are deleted**; added `scripts/start-task.sh` + `scripts/finish-task.sh` (one command each). Also fixed Vercel silently skipping deploys from commit-author-email drift — pinned identity to `Danijel Jovanovic <info@synapse-solutions.ai>` (the email verified on the `Synapsekw` account Vercel deploys from), re-asserted per worktree. ADR [[2026-06-21-decision-22-worktree-temp-branches-and-pinned-commit-identity]]; see [[2026-06-21-0928-worktree-workflow-commit-identity]].
- **Latest (2026-06-21):** **Attachment storage cleanup on delete** (`dd31e0d` spec + `54a77ee` fix, **pushed — `84fb185..7e104db`, CI green**) — out-of-band bugfix, not a phase deliverable. Item/board cascade deletes dropped the `attachments` rows but **orphaned the underlying Storage bytes** (silent, billable leak). New `removeAttachmentObjects` helper (service-role, batched, best-effort) wired into `deleteItem` (item + subitems) and `deleteBoard` (whole board via denormalized `board_id`); paths gathered before the cascade, freed only after the RLS-guarded delete. **Service-role is required** — the per-object storage-delete RLS is uploader-or-admin, so a member couldn't clear files others uploaded. Org delete has no code path yet (helper is path-agnostic); historical orphans out of scope. TDD, gate green (typecheck·lint·912 tests·build). Spec [[2026-06-21-attachment-cleanup-on-delete-design]]; see [[2026-06-21-0914-attachment-cleanup-on-delete]].
- **Latest (2026-06-21):** **In-app organization invite acceptance** (`67515a8..7b83fc3`, 6 commits, **pushed — `develop == origin/develop`, CI green**) — fixes "I invited a member and they get nothing / nowhere to accept." Root cause: the only enrollment path (`redeem_invitations`) ran solely in the magic-link `/auth/callback`, so an already-registered user signing in with a password was never added. Now three email-scoped `SECURITY DEFINER` RPCs (`my_pending_invitations`/`accept_invitation`/`decline_invitation` + `status='declined'`) feed a react-query data layer + an `InvitationsSection` in the notification bell (badge = unread + invites; Accept reloads `/`); admin Settings shows declined invites with **Re-invite**. Subagent-driven (Task 1 foundation → parallel Tasks 2/3/4 → Task 5 wiring); two-stage review approved (one stale-comment nit fixed). Gate green (typecheck·lint·build, 20/20 feature tests incl. live RPC integration 5/5). The empty workspace shell was also rebranded (theme-aware Monolith mark + new welcome copy, landed in `f8e693f`). Worktree-parallel dispatch failed (subagents are sandboxed to the project root — [[2026-06-21-gotcha-28-subagents-cant-write-outside-primary-dir]]); ran parallel implementers in the main checkout instead. Known: a pre-existing flaky `admin.rls` integration test (board RLS under GoTrue rate limits) is unrelated. Spec [[2026-06-20-in-app-invite-accept-design]]; see [[2026-06-21-0020-in-app-invite-acceptance]].
- **Latest (2026-06-20):** **Phase 6f — Inline PDF preview built** (`ebca8dc..334d446`, 7 commits, **local `develop`, NOT pushed**) — executed the 6f plan A–F. `isPdf`/`canPreviewInline` helpers, pdf-only `getAttachmentPdfUrl` signing action, client-only `PdfPreview` PDF.js canvas renderer (lazy via `next/dynamic`), Card/Row preview affordance, `kind === "pdf"` branch in `FilePreviewLightbox` (both Files tab + board Files cell), e2e spec. **Verified green in an isolated worktree off `531badf`**: typecheck 0 · lint · 714 unit tests · build — **PDF.js worker bundles under Next 16 via `new URL(..., import.meta.url)`**, no `/public` fallback needed. Plan deviations: pdfjs v6 uses `render({ canvas, viewport })` + `destroy()` on the loading task; lightbox effect rekeyed to set state only async (`react-hooks/set-state-in-effect` lint). Subagent implementers hit an Edit/Write permission wall → implemented direct, committed serially by path (gotcha-22). **Not pushed** — a concurrent board-sharing session interleaved commits on `develop` whose half-wired `listBoards→listMyBoards` rename leaves HEAD non-compiling (its files, not 6f's). Spec [[2026-06-20-document-preview-pdf-design]]; see [[2026-06-20-2202-phase6f-pdf-preview-build]].
- **Latest (2026-06-20):** **Board-level sharing — BUILT + pushed** (`efbf937..0dcb8e9`, 10 commits, **`develop == origin/develop` at `e39047e`, CI green**) — subagent-driven from the 7-task plan (Task 1 migration root → Wave-2 parallel actions/queries/dialog/sidebar/tests → wiring + gate). `board_members` + `can_read_board`/`can_edit_board`, READ→per-board / WRITE→`can_edit_board` rewrite across all 15 board-scoped tables, 6 hardened write RPCs, `share_board`/`unshare_board`, back-fill (editor-to-all on existing boards); two cloud migrations applied. **Security review caught a Critical**: table RLS was locked but attachment **file bytes** stayed org-readable via the separate `storage.objects` policy — fixed by board-scoping the 3 storage policies on path segment `[2]`, proven by a live cross-user download-denial test ([[2026-06-20-gotcha-27-storage-objects-separate-rls-from-table]]). Gate green (`typecheck·lint·build`, 878 tests), live two-user browser smoke test PASS (5/5). **Known follow-up:** `page.tsx` doesn't load `listSharedBoards()`, so a user owning 0 boards can't discover a board shared to them from `/` (renders fine on `/boards/*`) — deferred (file holds a concurrent session's branding edit). Spec [[2026-06-20-board-level-sharing-design|spec]]; see [[2026-06-20-2253-board-sharing-build]].
- **Latest (2026-06-20):** **Inline PDF preview — spec + plan** (`ebc5dd1`, `e1682f4`, **pushed**) — planning only, no code. Attachments today render PDFs as icon + Download; this adds inline render in the existing `FilePreviewLightbox` (both the item Files tab and the board Files cell). Decisions: **PDF only**, client-side **PDF.js**, **bucket-only — no new service, no third-party egress** (dedicated PDF-only signed URL, bytes `fetch`ed → canvas, never top-level nav). Office (docx/pptx) **deferred** behind a convert-to-PDF seam (needs a LibreOffice engine, not standing one up now). 6-task maximally-parallel plan (batch 1: helper/signing/renderer → batch 2: affordance/lightbox → batch 3: e2e). Proposed slice **6f**. **Not built** — execution was held off to avoid clobbering the concurrent 6c session; tree now clean. Spec [[2026-06-20-document-preview-pdf-design|spec]]; see [[2026-06-20-2027-pdf-preview-spec-plan]], [[pdf-preview-queued]].
- **Latest (2026-06-20):** **Board-level sharing — spec + plan** (`edf7d79`, `cbb4778`, **pushed**) — planning only, no code. Org-level invites already shipped; the gap is **per-board sharing**. Decisions: per-board, **private-by-default**, Viewer/Editor, **private even from admins**, owner-only sharing, existing boards back-filled Editor-to-all so nothing disappears, nav "Shared with me" + shared-out indicator. Architecture: `board_members` grants + `can_read_board`/`can_edit_board` helpers. Key finding: privacy requires rewriting reads on **all ~15 board-scoped tables** + guarding **6 write RPCs**, not just the core 5 ([[2026-06-20-gotcha-26-per-board-privacy-all-board-scoped-tables]]). 7-task plan, maximally parallel (1 migration root → 5-wide wave → wiring). **Not built yet.** Spec [[2026-06-20-board-level-sharing-design|spec]]; see [[2026-06-20-2024-board-sharing-spec-plan]].
- **Latest (2026-06-20):** **Phase 6c — Time Tracking built + pushed** (`910928c..ddb4d86`, 16 commits, **pushed — `develop` CI green, run `27877873381`**) — subagent-driven 12-task execution (fresh implementer + per-task reviewer each; orchestrator-committed to keep the concurrent integration-auth refactor out of 6c commits). `time_tracking` column kind + `time_entries` side table (org-scoped RLS, one-running-per-user partial-unique, atomic `start_timer` RPC — verified live via MCP + 4/4 integration), per-item estimate in `cell_values`, optimistic mutations + revalidate (no realtime v1), `TimeTrackingCell` (client live tick + popover) + collapsed-parent Σ rollup. Review loop fixed real defects (junk-duration parse, 60m rounding, a vacuous RLS assertion, a keyboard-a11y gap); resolved a pre-existing migration-ledger drift ([[supabase-migration-ledger-drift]]) + two plan-vs-repo traps (PascalCase commit subject, `Date.now()`-in-render purity). Final opus review **SHIP-WITH-NITS**; gate green (typecheck · lint · 852 unit · build · 4/4 integration · e2e). Spec [[2026-06-20-phase-6c-time-tracking-design]]; see [[2026-06-20-1954-phase6c-time-tracking]].
- **Latest (2026-06-20):** **Branded auth emails — recovery + invite** (`5d46cfa`, **not pushed**) — a real password-reset email arrived unbranded because `config.toml` templates only drive the **local** stack. Added `recovery.html` + `invite.html` (matching `confirmation.html`), generalized prod deploy into `scripts/push-auth-emails.ts` (Management API PATCH — confirmation/recovery/invite, never touches Site URL, unlike `config push`), pushed + verified via API read-back. `SUPABASE_ACCESS_TOKEN` now in gitignored `.env.local`. magic_link/email_change/reauthentication still GoTrue defaults (no flow triggers them). See [[2026-06-20-1910-branded-auth-emails-recovery-invite]], [[2026-06-20-gotcha-25-auth-email-prod-deploy]].
- **Latest (2026-06-20):** **Integration-suite test reliability** (`b3d94a4`, **not pushed**) — `pnpm test` was intermittently red locally: ~40 concurrent integration-suite sign-ins tripped GoTrue's auth rate limit (429), whose silent symptom was a null `create_organization` → `reading 'id'` NPE in `beforeAll`. Added `signInWithRetry()` (exponential backoff on 429) used by all 18 suites + split Vitest into a parallel `unit` and serial (`fileParallelism: false`) `integration` project; also fixed a deterministic `subitems` uppercase-slug bug (violated `organizations.slug` CHECK). These suites skip in CI, so it was a local-only gate. 819/819 green. See [[2026-06-20-1835-integration-auth-retry-helper]], [[2026-06-20-gotcha-24-integration-suite-auth-rate-limit]].
- **Latest (2026-06-20):** **Phase 6c — Time Tracking: spec + plan** (`5b28d46..47a5a80`, pushed) — brainstormed to a locked design + wrote a 12-task TDD plan (3 parallel Explore agents gathered exact in-repo patterns). Time Tracking **column kind** (Monday-style): sessions in a new `time_entries` side table (derived cell content, like 6b Files), per-item estimate in `cell_values`, **one running timer per user** (partial-unique + atomic `start_timer` RPC), live timer + manual entries, parent rollup. Deferred: cross-board timesheet, grouped breakdown, notes, others' edits, realtime. **Not yet built** — Tasks 1–2 apply two cloud migrations (auth gate). Spec [[2026-06-20-phase-6c-time-tracking-design|spec]]; see [[2026-06-20-1619-phase6c-time-tracking-plan]].
- **Latest (2026-06-20):** **Admin user management** (`391374b..6438a4a`, 6 commits, **pushed — CI green** run `27867004016`) — extends the platform super-admin console with a per-user `⋯` dropdown on `/admin/users` (send reset email, set temp password w/ forced change at next login, suspend/reactivate, hard delete) + moved admin nav to the sidebar bottom. New platform actions + `platform_user_sole_owned_orgs` RPC (delete blocked & names orgs if sole active owner; self-delete refused) + forced-change flow (`app_metadata.must_change_password` → `(auth)/change-password`, cleared service-role-only, loop-safe). Subagent-driven; per-task + final review (READY TO MERGE). See [[2026-06-20-1559-admin-user-management]]. _Manual gates pending: in-browser checks + the `develop → main` promotion._
- **Latest (2026-06-20):** **Phase 6b — Custom fields & statuses** (`ae8ea1f..de94136`, 23 commits, **not pushed**) — built subagent-driven (foundation on main thread; pure helpers, G2 rendering, data layer, G1 dialog, Files cell each a fresh subagent; whole-branch review + live e2e). G1 status/dropdown option editing (`delete_column_option` RPC clears referencing cells atomically + `ColumnOptionsDialog`), G2 five scalar kinds (Checkbox/Rating/Link/Email/Phone), G3 Files column (`attachments.column_id`, in-cell upload + preview lightbox, 0 round-trips first paint). Review caught a Critical link-cell `javascript:` XSS → http(s)-only `isHttpUrl` guard (`87f83e7`). Two migrations applied to cloud. 665 unit tests + 2/2 live RPC integration + 1/1 Playwright e2e; typecheck/lint/build green. See [[2026-06-20-1210-phase6b-custom-fields-statuses]].
- **Branch:** `develop == origin/develop` (`280478e`, pushed 2026-06-21 — Phase 6d-1 relations merged via `finish-task.sh`, full gate green; on top of the migration-drift fix + phase-7a docs). `main` at `30a9cf3` (Phases 0–4) — **do not promote yet** (WebGL landing dep needs a manual cross-browser check). _(Parallel sessions share this checkout — a concurrent branding edit to `page.tsx` is uncommitted in the tree; leave it untouched; commit only your own paths.)_
- **In flight:** **Data-driven `/updates` changelog** — self-maintaining from opt-in `Changelog:` git trailers (parser + frozen seed + committed `generated.ts` + develop-scoped CI drift guard). Tasks 1–5 done; **Tasks 6–7 pending** (CI job + CONTRIBUTING docs) + a `\|`-in-description parser fix. Spec [[2026-06-18-data-driven-changelog-design|spec]]; see [[2026-06-18-2144-updates-changelog-data-driven]].
- **Latest (2026-06-19):** **Org Admin + Platform Super-Admin console** shipped + pushed (`27db623..220793c`) — per-org admin console + cross-tenant super-admin tier, multi-page `/admin` with a collapsible Platform sidebar nav. Follow-ups fixed empty admin pages (authed-client RPC calls), purged ~3,400 rows of integration-test pollution, and root-caused an AFTER-DELETE activity trigger that blocked cascade deletes ([[2026-06-19-gotcha-23-activity-trigger-blocks-cascade-delete]]) + added a vitest teardown. See [[2026-06-19-2152-org-admin-platform-console]], [[2026-06-19-2231-platform-admin-console-ui]], [[2026-06-19-2312-admin-data-bug-cloud-purge]]. _(Full session history: Recent-sessions table + Last-session embed below.)_
- **🧑 Manual gates (Danijel):** Supabase keys done. Project is cloud-native with no local stack — with explicit per-session authorization, agents apply migrations via `supabase db push --linked` (done this session for the three 4a migrations). The **Supabase MCP** was OAuth-authorized this session (read-write scope; used read-only for advisor lints — schema still goes through versioned migration files, never `apply_migration`). Regenerate types after schema changes (note: `pnpm db:types` can leak a PostHog telemetry line — filter `'"_tag"'` before prettier). **Drift watch RESOLVED:** the migration ledger was fully in sync (local == remote) before 4a's pushes — 3b's `timeline_dependencies` out-of-band apply is confirmed complete.

### Last session

```dataviewjs
const sessions = dv.pages('"vault/sessions"')
  .where(p => p.type === "session" && p.status === "complete")
  .array();
sessions.sort((a, b) => String(b.file.name).localeCompare(String(a.file.name)));
const latest = sessions[0];

if (!latest) {
  dv.paragraph("_No finalized session notes yet — capture one at the end of a working session._");
} else {
  dv.paragraph(`**[[${latest.file.name}]]** · _${latest.date}_`);
  dv.paragraph(`![[${latest.file.name}]]`);
}
```

### Recent sessions (last 10)

```dataview
TABLE branch, date as "Session"
FROM "vault/sessions"
WHERE type = "session"
SORT file.name DESC
LIMIT 10
```

### Recent activity — specs/docs (last 14d)

Any spec or doc touched in the last two weeks (whole repo is the vault now).

```dataview
TABLE type, status, file.mtime as "Updated"
FROM "docs" OR "specs"
WHERE file.mtime > date(today) - dur(14 days)
SORT file.mtime DESC
```

## 4. Engineering guardrails (from spec §8)

- TS strict, no unjustified `any`, **Zod at every boundary**.
- **Server Components by default**; Client only when interactive; **Server Actions for mutations**.
- **RLS is the real security boundary** — never trust the client. Default deny on every table; policies key off `org_members` for `auth.uid()`; no cross-org access.
- `SUPABASE_SERVICE_ROLE_KEY` never reaches the browser.
- All schema via **versioned migrations** (never dashboard click-ops). After each migration: `generate_typescript_types` → `src/types/database.types.ts`, then run `get_advisors`.
- Every feature ships with at least basic tests. **No phase complete with failing tests or advisor warnings.** Small conventional-commit commits.
- This is **Next.js 16, not the version in training data** — read `node_modules/next/dist/docs/` before writing framework code (see `AGENTS.md`).

## 5. Decision log (last 10)

```dataview
TABLE status, file.cday as "Created"
FROM "vault/decisions"
WHERE type = "adr"
SORT file.cday DESC
LIMIT 10
```

## 6. Entry points

- [[product]] — what we're building and for whom
- [[architecture]] — system + code structure, data model
- [[platform-roadmap]] — phase 0–9 detail
- [[specs]] — design spec index
- [[operations]] — runbooks, Supabase/MCP, deploy
- [[memory]] — what lives where (this vault's self-map)

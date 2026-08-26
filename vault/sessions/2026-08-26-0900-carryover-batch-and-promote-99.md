---
type: session
date: 2026-08-26-0900
branch: develop
trigger: wrapup
status: complete
tags: [session]
related: []
---

# Carryover batch, test-infra hardening, and promote #99

## What changed

- `/whats-next` triaged the vault, surfaced 9 carryover/new-feature candidates, and — on explicit
  direction to "fix all the carryover" — built and merged **7 items** sequentially into `develop`,
  each in its own worktree: migration cleanup (dropped dead `ai_credential_get`/`org_ai_secret_get`
  overloads, added price `CHECK`s), a **real production bug fix** (dashboard number/battery/
  completion/health widgets were resolving through the service client and raising `42501` since
  2026-07-04), the reference-doc sentinel narrowed to stop a false-positive, DocumentPicker's
  silent 100-row cap fixed, an a11y pass (focus-restore, `aria-describedby`, combobox naming), F17
  (usage dashboard + AI weekly-digest narrative — a full feature build), and a per-agent stable
  nonce closing a prompt-injection forgery gap. An 8th item (Personal Agents Phase 2 remainder) was
  investigated and found to need no build — see Open threads.
- **Two unplanned, session-blocking infra fixes landed directly on `develop`**: Node 22.4+'s
  experimental `localStorage` global was shadowing jsdom's per-window Storage in every test
  (polyfilled in `vitest.setup.ts`), and vitest's default worker count (`cpus - 1`) was
  oversubscribing this machine — six worktrees running full `pnpm test`/`pnpm build` concurrently
  drove swap to 6.9 of 8GB and started failing worker-spawn, not real test assertions
  (`maxWorkers: 4` in `vitest.config.ts`).
- `/promote` shipped the whole batch as **PR #99** (52 commits, squash-merged, heal commit
  `57b77edb`), verified live: Vercel `state=success`, `www.monolith.works` 200, `/settings/ai` 307.
- `/wrapup` step 6 caught a real gap the mechanical date-bucket coverage check couldn't see: F17 and
  the dashboard fix shipped 2026-08-25, the same day as an announcement commit that only described
  Spec 2b's three entries — the day read "covered" while two shipped features weren't. Backfilled
  with two more dated announcement commits (`ee7de01e` for 08-25, `80b6811f` for 08-26).

## Why

The vault's own triage flagged Spec 2b as merged-and-unpromoted with a real live bug (the dashboard
widgets) and several small carryover fixes accumulating. The owner asked to clear all of it in one
pass rather than picking items off one at a time, which surfaced the machine-resource-contention
problem early — better found now, fixed once, than rediscovered on every future multi-worktree
session.

## How to test (for the user)

1. **Dashboard widgets** — open any board's dashboard, add a Number/Battery/Completion/Health
   widget → renders data instead of erroring.
2. **Reference documents** — Settings → Agents → attach a document whose text contains the heading
   "REFERENCE DOCUMENTS" → saves successfully.
3. **DocumentPicker** — an agent's document library past 100 items shows "Showing 100 of N
   documents" in the attach picker.
4. **a11y** — Settings → Agents → edit an agent, clear the name field, Save → the error is
   announced with the field, and focus returns to the Save button instead of dropping to the page.
5. **Usage dashboard** — `/settings/ai` shows a usage breakdown card; the weekly digest and
   notifications carry a short AI-usage narrative.
6. **Migration cleanup / nonce / test-infra** — no user-visible surface, verified by the suite and
   live DEV ledger checks.

## Open threads

- **Personal Agents Phase 2 remainder — resolved as "nothing to build here."** Of the four items
  the old vault note listed (`@mentionable` agents in item threads, agent-initiated proposals,
  per-agent principals, PDF documents): agent-initiated proposals and PDF documents were already
  shipped by other work this session (the unattended-run proposal path via
  `personal-agent/route.ts`'s `onPropose` → `insertProposals`, and Spec 2b's PDF extraction);
  `@mentionable` agents and per-agent principals are explicitly deferred to **Spec 3** in the Phase
  2 design doc itself (`docs/superpowers/specs/2026-08-03-personal-agents-phase2-design.md`), not
  silently missing. One narrow, genuinely-unscoped nugget surfaced and was deliberately **not**
  built: an agent **writing** a PDF report and attaching it as output (`renderHtmlToPdf` is still
  only used by Report Builder) — small, undefined scope, worth a quick `brainstorming` pass if
  wanted, not invented here.
- **Two changelog announcement commits are on `develop` but not yet promoted** (`ee7de01e`,
  `80b6811f`) — they ride the next promotion.
- **The resource-contention lesson is now fixed at the config level** (`maxWorkers: 4`), but the
  underlying reality — this machine cannot cleanly run 6+ concurrent full `pnpm test`/`pnpm build`
  processes — is worth remembering before dispatching another wide parallel batch. One heavy
  worktree gate at a time was the reliable pattern once discovered.

## Next session entry point

**Brainstorm Spec 2c (agent memory)** — the owner-chosen next slice, depth before breadth over
Spec 3. It must consume `document-budget.ts` rather than re-derive its arithmetic. E6 Stripe
remains the other open, unblocked epic if 2c isn't the pick.

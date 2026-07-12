---
type: index
status: active
last-updated: 2026-07-12
tags: [project/pulse, adr, index]
---

# Gotcha index

One line per gotcha, grouped by theme. **Numbering rules for future ADRs:**

- Two numbers were minted twice — disambiguated here as **10a/10b** and **43a/43b** (exact
  filenames below; other docs that cite "gotcha-10" or "gotcha-43" by bare number are ambiguous —
  resolve against this index). **38 was skipped** and stays retired to avoid confusion with
  historical cross-references. Do **not** rename existing files.
- Before minting a new gotcha, check this index and take the **next free number** (currently
  **56**), then add a row here. `decision-NN` ADRs are a separate interleaved sequence (08, 11,
  21–26 so far) — don't collide with those either.

## Worktrees & subagents

- **07** [[2026-06-15-gotcha-07-shared-worktree-subagents]] — background subagents share one working dir; stage by explicit path
- **10a** [[2026-06-16-gotcha-10-stage-untracked-subagent-files]] — stage subagents' NEW (untracked) files too, not just modified
- **15** [[2026-06-17-2155-gotcha-15-subagent-scope-overstep-shared-checkout]] — subagents overstep task scope; one agent per file in a shared checkout
- **22** [[2026-06-19-gotcha-22-parallel-subagent-commit-ref-race]] — parallel subagents committing to one branch race on the branch ref
- **28** [[2026-06-21-gotcha-28-subagents-cant-write-outside-primary-dir]] — subagents can't write outside the primary working dir; nest worktrees inside it
- **31** [[2026-06-21-gotcha-31-worktree-needs-real-install]] — a nested worktree needs a real `pnpm install`, not inherited `node_modules`
- **39** [[2026-06-22-gotcha-39-stale-worktree-deps-after-sibling-dependency-add]] — rebasing onto a develop with a new dependency leaves worktree deps stale

## Shared DB, migrations & Supabase

- **03** [[2026-06-15-gotcha-03-gen-types-schema-public-prettier]] — regenerate types with `--schema public | prettier` to match MCP output
- **13** [[2026-06-17-gotcha-13-realtime-only-insert-needs-optimistic-echo]] — a create rendered only via the Realtime echo silently fails when the echo lags
- **17** [[2026-06-18-1711-gotcha-17-empty-string-custom-guc]] — `current_setting(name, true)` returns `''` (not NULL) for a custom GUC on pooled connections
- **18** [[2026-06-19-gotcha-18-create-or-replace-function-overload]] — `CREATE OR REPLACE FUNCTION` with changed args adds an overload, doesn't replace
- **19** [[2026-06-19-gotcha-19-set-option-value-shape-per-column-kind]] — `cell_values.value` shape is per column-kind; server-side writers must match it
- **23** [[2026-06-19-gotcha-23-activity-trigger-blocks-cascade-delete]] — AFTER-DELETE activity trigger blocked cascade deletes (and tests leaked cloud data)
- **24** [[2026-06-20-gotcha-24-integration-suite-auth-rate-limit]] — concurrent integration suites trip GoTrue's auth rate limit
- **26** [[2026-06-20-gotcha-26-per-board-privacy-all-board-scoped-tables]] — per-board privacy must cover EVERY board-scoped table, not just the core 5
- **27** [[2026-06-20-gotcha-27-storage-objects-separate-rls-from-table]] — `storage.objects` has its own RLS, separate from the recording table
- **29** [[2026-06-21-gotcha-29-migration-ledger-drift-throwaway-cloud-applies]] — ledger drift from throwaway cloud applies; reconcile with `migration repair`
- **30** [[2026-06-21-gotcha-30-mcp-vs-cli-type-gen-shared-db]] — MCP type-gen differs from CLI; shared cloud DB cross-contaminates `database.types.ts`
- **34** [[2026-06-22-gotcha-34-migration-ledger-drift-recurs-on-throwaway-applies]] — ledger drift recurs on auto-timestamp cloud applies; relabel the version
- **35** [[2026-06-22-gotcha-35-private-realtime-channel-needs-no-public-access-toggle]] — private Realtime channels don't need the public-access toggle (flipping it breaks public ones)
- **36** [[2026-06-22-gotcha-36-realtime-socket-integration-tests-need-native-event-globals-under-jsdom]] — live Realtime socket tests need native Event globals restored under jsdom
- **37** [[2026-06-22-gotcha-37-parallel-worktree-integration-tests-flake-on-shared-supabase]] — parallel worktree sessions flake each other's gates via the shared Supabase
- **41** [[2026-06-23-gotcha-41-db-types-contamination-from-shared-remote]] — `pnpm db:types --linked` contaminates a worktree when the shared DB is ahead of its snapshot
- **43a** [[2026-06-23-gotcha-43-shared-db-integration-test-flake]] — live-DB integration suite is nondeterministically flaky under `pnpm test`
- **43b** [[2026-07-03-gotcha-43-parallel-branch-migration-version-collision]] — parallel branches independently mint the same migration version
- **52** [[2026-07-07-gotcha-52-managed-postgres-set-param-denied-use-set-config]] — managed Postgres denies `SET <param>` in function headers; use `set_config`
- **53** [[2026-07-07-gotcha-53-getuserorgs-filters-deactivated-but-roster-cache-doesnt]] — `getUserOrgs()` filters deactivated memberships but the roster cache doesn't
- **55** [[2026-07-11-gotcha-55-mcp-apply-migration-version-drifts-from-committed-file]] — MCP `apply_migration` version drifts from the committed file; reconcile before `/sync-prod`

## Next.js / framework

- **01** [[2026-06-14-gotcha-01-next16-not-next15]] — scaffold is Next 16, not the Next 15 in training data
- **02** [[2026-06-14-gotcha-02-proxy-must-live-in-src]] — `proxy.ts` must live under `src/` for Next 16 to register it
- **04** [[2026-06-15-gotcha-04-action-dispatch-needs-transition]] — dispatch Server Actions inside `startTransition` or redirects don't navigate
- **05** [[2026-06-15-gotcha-05-board-cache-coherence]] — with a `staleTime: Infinity` TanStack cache, every mutation must patch the cache
- **09** [[2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch]] — RSC navigation refetches everything on in-page view switches
- **10b** [[2026-06-17-gotcha-10-board-payload-unbounded-reads]] — `getBoardPayload` reads items/cell_values/dependencies unbounded
- **12** [[2026-06-17-gotcha-12-public-route-needs-proxy-and-e2e-update]] — a new public route needs the proxy whitelist + e2e update, not just `page.tsx`
- **16** [[2026-06-18-1128-gotcha-16-use-server-sync-export]] — a `"use server"` module may export only async functions
- **40** [[2026-06-23-gotcha-40-cachecomponents-global-blast-radius]] — `cacheComponents: true` is global; it breaks every cookie-reading route
- **42** [[2026-06-23-gotcha-42-no-function-children-across-rsc-client-boundary]] — never pass a function child from a Server to a Client Component
- **44** [[2026-06-24-gotcha-44-sibling-section-layouts-remount-shell]] — per-section sibling layouts re-mount the shared shell on cross-section nav
- **48** [[2026-07-04-gotcha-48-unstable-instant-blocked-by-shell-searchparams]] — `unstable_instant` can't validate `(app)` routes while the shell reads `useSearchParams()`
- **50** [[2026-07-05-gotcha-50-tolocaledatestring-undefined-locale-hydration-mismatch]] — `toLocaleDateString(undefined, …)` in SSR'd client components causes hydration mismatch

## UI & libraries

- **14** [[2026-06-17-2048-gotcha-14-react-grid-layout-v2-api]] — react-grid-layout v2 has a rewritten API (v1 training data is wrong)
- **20** [[2026-06-19-gotcha-20-dnd-kit-transform-scale-stretch]] — `CSS.Transform.toString` stretches variable-height dnd-kit sortable items
- **33** [[2026-06-21-gotcha-33-drag-width-must-be-int]] — pointer-drag widths must be rounded before hitting an int-validated action
- **45** [[2026-06-24-gotcha-45-structured-output-permissive-config-empties]] — a permissive field in a structured-output schema makes the model emit it empty
- **46** [[2026-06-24-gotcha-46-tailwind-scans-markdown-classes]] — Tailwind v4 scans committed `.md` docs; placeholder classes break the build
- **47** [[2026-06-28-gotcha-47-coarse-tooltip-suppresses-focus-label]] — suppressing hover tooltips on touch also kills keyboard-focus labels
- **49** [[2026-07-05-gotcha-49-summaries-aggregate-top-level-only]] — column summaries aggregated top-level rows only; subitem/rollup data invisible
- **51** [[2026-07-06-gotcha-51-revealonhover-needs-unnamed-group]] — `RevealOnHover` requires an unnamed `group` ancestor, not `group/<name>`

## Promotion / CI

- **06** [[2026-06-15-gotcha-06-commitlint-subject-case]] — commitlint rejects commit subjects that start uppercase
- **25** [[2026-06-20-gotcha-25-auth-email-prod-deploy]] — branded auth emails reach prod only via the Management API push script
- **32** [[2026-06-21-gotcha-32-promote-merge-method-squash-divergence]] — `/promote` assumed merge commits; squash-only repo re-diverges develop/main

## Machine contention

- **54** [[2026-07-09-gotcha-54-concurrent-worktree-gate-contention]] — concurrent worktree gate runs exhaust vitest fork workers; false failures + stalls

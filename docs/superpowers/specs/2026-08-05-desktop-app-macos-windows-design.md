# Desktop App — macOS first, Windows second

**Date:** 2026-08-05
**Status:** Approved 2026-08-05 — plan to follow
**Author:** Dani (with Claude)
**Related:** `src/app/manifest.ts` (states "Offline is out of scope"; this spec reverses it),
`vault/decisions/2026-06-16-gotcha-09-rsc-nav-refetch-on-view-switch.md`,
`vault/decisions/2026-06-17-gotcha-13-realtime-only-insert-needs-optimistic-echo.md`,
`docs/superpowers/specs/2026-08-01-billing-and-monetization-design.md` (E6 — the entitlement
contract in § Subscription is a requirement _on_ E6, not delivered here)

## Summary

Ship Monolith as a signed native app for macOS, then Windows. The app is an **Electron shell
loading the hosted `www.monolith.works`** — not a bundled server, not a rewrite. Every RSC page,
all ~201 Server Actions, `proxy.ts` auth and the PPR shell keep working exactly as they do today.

The shell earns its existence with three things a browser tab cannot do: **signed, notarized
distribution**; **OS integration** (menu bar, dock badge, global hotkey, launch-at-login, deep
links, native notifications); and **real filesystem access** (Finder drag-in, save-to-disk exports,
open attachments in their native app).

Separately — and this is the dominant cost — the app gains **read-only offline**: boards you have
already opened stay readable with no network, all writes clearly blocked, healing on reconnect.
That capability lands in the **web app**, not the shell, so it is one code path and web users get
it too.

Two facts from the codebase shaped the design. Auth is **email/password only**
(`signInWithPassword`; no `signInWithOAuth` anywhere), which removes the worst desktop-shell
gotcha — embedded-webview OAuth blocking — entirely. And Playwright runs a **single Chromium
project**, so there is zero WebKit coverage, which is what rules Tauri out for the launch platform.

## Scope

**In scope**

- Electron shell for macOS: window, menus, dock badge, global hotkey, launch-at-login, deep links,
  native notifications, persistent session.
- Filesystem bridge: drag files in from Finder, save exports directly to disk, open attachments in
  the default OS app.
- Signing, notarization, and an auto-update channel.
- Read-only offline for **boards** — service worker, persisted query cache, offline entry route,
  write blocking, reconnect healing.
- Windows packaging and signing, after macOS is shipped.

**Out of scope, deliberately**

- **Offline writes of any kind.** No queue, no local mutation log, no conflict resolution. A write
  attempted offline is refused, not deferred. Deferring writes is a data-layer rewrite and a
  different product decision.
- **Offline for surfaces other than boards** — dashboards, settings, goals, reports, `/ask` and the
  agent dock are online-only in v1. The offline shell does not route to them.
- **Bundling Next.js into the app.** See Decision 2.
- **Mac App Store distribution.** See Decision 7.
- **Encryption at rest for the local cache.** See § Cache security for what is done instead.

## Decisions taken

| #   | Decision         | Choice                                                             | Rationale                                                                                                       |
| --- | ---------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| 1   | Shell technology | **Electron**                                                       | Tauri renders in WKWebView on macOS — an engine with zero test coverage here, on the launch platform            |
| 2   | App source       | **Load the hosted URL**; do not bundle Next.js                     | A bundled server adds ~200MB and a Node runtime and gets you no closer to offline — Supabase is still remote    |
| 3   | Offline scope    | **Read-only, boards already visited**                              | Bounded and additive; offline writes are a data-layer rewrite                                                   |
| 4   | Offline home     | **The web app** (SW + persisted cache), not the shell              | One code path; web users benefit; a shell-side cache forks offline logic permanently                            |
| 5   | Repo layout      | **Separate `monolith-desktop` repo**                               | A pnpm workspace at this root changes `pnpm install` semantics in every worktree and endangers the gate tooling |
| 6   | Write blocking   | **`assertOnline()` in the 16 mutation modules + conformance test** | Not 201 call sites — board writes already funnel through `useMutation`                                          |
| 7   | Distribution     | **Notarized direct download, not the Mac App Store**               | MAS mandates Apple IAP at 30%/15% on subscriptions; direct distribution has no such requirement                 |
| 8   | Cache security   | **Wipe on sign-out / org switch / expiry**, not encrypted          | Encryption-at-rest needs a key the app can read unattended, which buys little; wiping is provable               |

### Why Electron over Tauri (Decision 1)

Tauri v2 is genuinely the better-behaved citizen — roughly 10–15MB against Electron's ~120–150MB,
and materially lower idle RAM. It was rejected on one specific ground: on macOS it renders in
**WKWebView**, while Windows gets Chromium via WebView2. That is two rendering engines to support,
and the untested one is on the platform shipping first.

This UI is not trivial to render: `ogl` (WebGL), `framer-motion`, `recharts`,
`react-grid-layout`, `dnd-kit`, and `@tanstack/react-virtual`. `playwright.config` declares exactly
one project — `chromium`. There is no WebKit suite that would catch a WKWebView divergence, so the
first report would come from a user.

Electron ships the same Chromium the tests and the users already run, identically on both
platforms, and puts Node in the main process, which makes Decision-scope filesystem work trivial.
Revisit Tauri if bundle size becomes a real complaint — the shell is small enough to port, because
Decision 4 keeps all the interesting logic out of it.

### Why the offline layer lives in the web app (Decision 4)

The alternative is an Electron-side cache: the main process snapshots board payloads and serves
them from a custom protocol when offline. It avoids service workers entirely, which is a real
attraction.

It was rejected because it produces two offline implementations that must agree forever — and the
web one still gets built eventually, because `src/app/manifest.ts` already ships and installability
is a question of when. It also puts cache-invalidation logic in the one place with no test
infrastructure.

## Architecture

Three layers, only two of which are new code in this repo.

```
┌─────────────────────────────────────────┐
│ Electron shell  (monolith-desktop repo) │  menus · dock badge · hotkey · deep links
│  main + preload, contextIsolation on    │  filesystem IPC · auto-update · version gate
└──────────────────┬──────────────────────┘
                   │ loads https://www.monolith.works
┌──────────────────▼──────────────────────┐
│ Service worker        (this repo, NEW)  │  static-chunk precache · navigation fallback
└──────────────────┬──────────────────────┘
┌──────────────────▼──────────────────────┐
│ Next.js 16 app        (this repo)       │  RSC · Server Actions · proxy auth — UNCHANGED
│  + persisted query cache        (NEW)   │  IndexedDB · allowlisted keys · wipe on sign-out
└─────────────────────────────────────────┘
```

## Offline read path

The crux, and the reason this is weeks rather than days.

Today `/boards/[boardId]/page.tsx` is an RSC that runs `getBoardPayload` and hands the result to a
client component as `initialData`, which `useBoardCache` seeds into TanStack Query at
`staleTime: Infinity`. Offline there is no server, so there is no `initialData`.

**1 — Persist the query cache.** Add `@tanstack/react-query-persist-client` with an **async
IndexedDB persister**. The default `localStorage` persister is unusable here: a board payload will
exceed the 5MB origin quota. Persistence is **allowlisted by query key** — `board`, and nothing
else in v1. AI streams, widget previews, and agent run history are explicitly not persisted. The
persister is throttled and capped with a `maxAge` of 7 days.

**2 — Service worker.** Registered **after load, on idle**, so it never competes with hydration.

- `/_next/static/**` — **cache-first**. Safe because those filenames are content-hashed.
- Navigations — **network-first with a short timeout**; on failure serve the precached `/offline`
  document.
- **No other HTML document is ever cached.** Caching a real document cache-first is how a service
  worker pins users to a dead build; see § Risks.

**3 — The `/offline` entry route.** A client-only route that reads the intended path, resolves a
board id, and renders the board components hydrating from the persisted cache instead of
`initialData`. A board never visited renders an honest "This board isn't available offline."

This is the load-bearing choice: **an additional entry route, not a rewiring of the RSC path.** The
online path is untouched, which is what keeps the blast radius small and honours working agreement
#5's "in-page state must not refetch server data."

**4 — One intrusive change.** `useBoardCache(boardId, initialData)` must accept an optional
`initialData` and fall back to the persisted entry, failing cleanly when neither exists. That is
the only edit to existing board internals.

**5 — Reconnect healing already exists.** `use-board-cache.ts` documents that its `queryFn` exists
precisely so the realtime hook's `invalidateQueries` — fired when the channel re-subscribes after a
drop — resyncs the full board and recovers collaborator edits missed during the gap. A network
outage is the same shape as a channel drop. **No new reconnect logic is required**, only a test
proving the offline→online transition triggers it.

## Write blocking

Offline, a Server Action is a POST to a server that isn't there. It fails on its own; the
requirement is that it fails _legibly_ and that the UI never implies a write landed.

Synthesizing an `ActionResult` failure in the service worker was considered and **rejected**:
Server Action responses are RSC flight payloads, not JSON, and hand-forging one couples us to
Next's private wire format.

Two mechanisms instead:

**`assertOnline()` in every mutation module.** All board writes funnel through `useMutation` — 16
modules, 8 of them under `src/lib/boards/mutations/`. Each `mutationFn` opens with a guard
returning `fail("You're offline — reconnect to make changes.")`. Sixteen files is bounded and
greppable.

**A conformance test makes it durable.** The existing `--project conformance` suite gains a check
that every `useMutation` in `src/` routes through `assertOnline`. This is the `id-sources.test.ts`
pattern: the rule is enforced by a test, not by review diligence. It must build its matcher without
reusing a global regex across `.test()` calls — that is
[[2026-08-03-gotcha-72-a-global-regex-with-test-makes-a-guard-silently-blind]], which has already
shipped three times.

**Read-only rendering.** The `/offline` route renders boards in an explicit read-only mode: no
inline cell editors, no add-item affordances, an offline banner. `assertOnline` is the backstop for
the mid-session case — user is on the live board, network drops, they click Save.

## Auth and cache security

The offline shell renders **no** server-verified identity, so it must not become a way to read
another account's cached data on a shared machine.

- The persisted cache is namespaced by user id, and the offline route renders only if the locally
  stored identity marker matches the last signed-in user.
- **Sign-out wipes IndexedDB and every service-worker cache**, synchronously, before redirecting.
  Same on org switch.
- If the stored session is older than **7 days** — the same window as the entitlement grace below,
  deliberately one number and not two — the cache is wiped and the app requires an online sign-in.

Not encrypted at rest. An app that opens unattended needs a key it can read unattended, so
encryption here mostly relocates the problem; wiping on sign-out is provable and testable, and that
trade is stated rather than assumed. On macOS the data sits in the per-user app container.

## Subscription

A requirement **on** E6, not delivered by this spec. E6 must expose an entitlement shaped
`{ plan, status, checkedAt }`, which the client persists. Offline the app honours the cached
entitlement for a **7-day grace window**; past that it requires a reconnect before rendering
anything. Verified at shell boot and on every reconnect — never per navigation.

Decision 7 is time-sensitive: choosing Mac App Store distribution later would force Apple IAP and
invalidate whatever Stripe integration E6 ships. **Settle it before E6 starts.**

## The Electron shell

Separate repo. Loads the production origin in a persistent session partition.

**Security posture** — non-negotiable, because this window renders remote code:
`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, no remote module. The preload
exposes one narrow typed IPC surface. `will-navigate` and `setWindowOpenHandler` allowlist the
exact production origin; **every other URL opens in the system browser**, never in-window.

**OS integration:** application and Edit menus (Electron does not give you Cmd+C/V without explicit
Edit-menu roles — omitting them is the classic first bug), dock/taskbar badge driven by the
notification count over IPC, a global hotkey to summon-and-focus, launch-at-login, native
notifications, and a `monolith://` protocol handler so emailed links — password recovery, briefing
deep links — open in the app.

**Filesystem:** Finder drag-in resolves real paths via `webUtils.getPathForFile` (Electron 32+
removed `File.path`; using it is a silent failure), save-to-disk exports through
`dialog.showSaveDialog`, and attachments opened via `shell.openPath`.

**Version handshake:** the shell fetches `/desktop-release.json` at boot — a **statically
prerendered** file in this repo, pure and synchronous, exactly like `src/app/manifest.ts`, so it
adds no env or DB requirement. If the shell is below `minSupportedShell` it blocks with an update
prompt. This is the escape hatch for a breaking web-app change.

**Auto-update:** `electron-updater` against a generic feed.

**Windows delta:** Electron bundles Chromium, so there is no WebView2 dependency. NSIS installer,
protocol registration via the registry, and code signing — Azure Trusted Signing (~$10/mo) rather
than an EV certificate. Packaging deep `node_modules` on Windows hits the same `MAX_PATH` limit the
worktree tooling already documents; the fix is the same `\\?\` prefixed path.

## Performance & data-fetching budget (working agreement #5)

**First paint, online: unchanged — zero new server round-trips.** No RSC query is added, moved, or
duplicated. The service worker registers after load on idle, so it never competes with hydration.

**Interactions: zero new round-trips.** Nothing here introduces a navigation. Read-only mode and
the offline banner are client state driven by `onlineManager`, never a `<Link>` or `router.push` —
which would re-run every query in the page (gotcha-09).

**The offline path is zero round-trips by definition** — that is what it is for.

**Cache persistence is bounded and off the hot path.** Allowlisted to the `board` key only, written
through a throttled async IndexedDB persister, capped by a 7-day `maxAge`. The persisted payload is
the already-bounded `getBoardPayload` projection, so **no new unbounded read is introduced** and no
`select *` is added to a growing table.

**Precaching is bounded.** Content-hashed static chunks plus exactly one document (`/offline`).

**Reconnect costs one query per open board** — the existing `invalidateQueries`, not an app-wide
refetch.

**The version check is one fetch of a static file at shell boot**, not per navigation.

## Testing (working agreement #4 — written and executed)

**Conformance** (`--project conformance`) — every `useMutation` in `src/` routes through
`assertOnline`. The durable defence; must avoid the global-regex trap of gotcha-72.

**Unit** — `assertOnline` rejects offline and passes online; the persister allowlist stores `board`
and refuses a non-allowlisted key; sign-out wipes IndexedDB and SW caches; the entitlement grace
boundary is tested on both sides of 7 days; a cache namespaced to user A is not read by user B.

**Component** — the `/offline` route renders a cached board read-only; a board never visited shows
the unavailable state; mutation affordances are absent in read-only mode.

**E2E** (existing Playwright chromium project) — `context.setOffline(true)`, reload, board renders
from cache; an edit is refused with the offline message; back online, the realtime re-subscribe
heals the board without a manual reload.

**Shell** (separate repo) — Playwright-for-Electron smoke: window opens and loads, a `monolith://`
deep link routes correctly, an external link opens in the system browser and **not** in-window, the
Edit menu gives working Cmd+C/V.

**Gates** — `pnpm typecheck && pnpm lint && pnpm test && pnpm build` green before merge.

## Execution DAG (working agreement #6)

| Unit  | Work                                                                               | Consumes |
| ----- | ---------------------------------------------------------------------------------- | -------- |
| **A** | Persisted query cache: IDB persister, key allowlist, namespacing, wipe-on-sign-out | —        |
| **B** | Service worker + `/offline` entry route + `useBoardCache` optional `initialData`   | A        |
| **C** | `assertOnline` across 16 mutation modules + the conformance test                   | —        |
| **D** | Read-only board rendering mode + offline banner                                    | —        |
| **E** | Entitlement cache + 7-day grace gate (stubbed until E6 lands)                      | —        |
| **F** | Electron shell: window, security posture, menus, OS integration, filesystem IPC    | —        |
| **G** | `/desktop-release.json` (this repo, trivial) + version handshake (shell)           | F        |
| **H** | Signing, notarization, auto-update channel                                         | F        |
| **I** | Windows packaging, signing, protocol registration                                  | H        |

**Dependency graph:** A → B; F → {G, H}; H → I. C, D, E, F have no unmet dependency.

| Batch | Units               | Notes                                                         |
| ----- | ------------------- | ------------------------------------------------------------- |
| 1     | **A, C, D, E, F**   | Five concurrent agents; F is a different repo, fully isolated |
| 2     | **B, G, H**         | B consumes A; G and H consume F                               |
| 3     | **I**               | Consumes H                                                    |
| 4     | Integration + gates | Single serialising step                                       |

**Critical path:** two independent chains — `A → B → gates` in this repo, and `F → H → I` in the
shell repo. Wall-clock floor is the longer of the two, so the macOS shell and the offline layer
should be started **together**, not in sequence.

Units that mutate files in parallel get isolated worktrees per working agreement #1.

### Decompose into two plans, not one

This spec is an **architecture spec covering ~7 weeks across two repos** — deliberately larger than
the recent slice specs, because the shell choice and the offline design have to be decided together
or they contradict each other. It is **not** a single implementation plan, and turning it into one
would repeat the Phase 1 shape the `personal-agents-phase2` spec explicitly reacts against: six of
that phase's defects originated in an over-large plan rather than in the implementations.

The two chains above are genuinely independent — they share no files, and their only contract is
`/desktop-release.json`. So `writing-plans` runs **twice**:

- **Plan 1 — Offline read-only** (units A, B, C, D, E), entirely in this repo. Ships value on the
  web with no desktop app in existence.
- **Plan 2 — The macOS shell** (units F, G, H), in `monolith-desktop`, with **I** following as its
  own small Windows plan.

Plan 1 has the deeper critical path and the higher risk, so it starts first — but neither blocks
the other.

## Effort

| Layer                                                    | Estimate      |
| -------------------------------------------------------- | ------------- |
| Electron shell (F, G) — window, security, OS integration | ~1–1.5 wk     |
| Filesystem bridge                                        | ~3–5 d        |
| Signing, notarization, auto-update (H)                   | ~3–5 d        |
| **Offline read-only (A, B, C, D)**                       | **~2.5–4 wk** |
| Entitlement grace (E)                                    | ~2–3 d        |
| Windows (I)                                              | ~1 wk         |

**≈6–8 weeks for macOS, +1 week for Windows**, less whatever the two parallel chains overlap.
Recurring costs: Apple Developer Program $99/yr, Azure Trusted Signing ~$10/mo.

## Risks

| Risk                                                        | Severity | Mitigation                                                                                                          |
| ----------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| A stale service worker pins users to a dead build           | **High** | Never cache-first a real document; precache keyed to build id; `skipWaiting` + `clients.claim`; a kill-switch route |
| Cached org data readable on a shared machine                | **High** | Namespaced by user id, wiped on sign-out / org switch / expiry, allowlisted to `board`; unit-tested                 |
| Remote-content window escalating into Node                  | **High** | `sandbox` + `contextIsolation` + no `nodeIntegration`; strict navigation allowlist; external URLs to system browser |
| A new mutation module ships without `assertOnline`          | Medium   | Conformance test, not review diligence — and built without the gotcha-72 global-regex trap                          |
| Read-only mode drifts as new board affordances are added    | Medium   | Component test asserts no mutation affordances render offline; extend it with each new surface                      |
| Offline cache serves data the user has since lost access to | Medium   | 7-day `maxAge`; reconnect invalidates; accepted for a read-only window on data they could already see               |
| Apple notarization or signing blocks the release late       | Medium   | Unit H is in batch 2, not at the end — notarize a hello-world build before the shell is finished                    |
| Electron `File.path` removal silently breaks Finder drag-in | Low      | `webUtils.getPathForFile` from the start; covered by the shell smoke suite                                          |

## ADRs owed

1. **This reverses `src/app/manifest.ts`'s stated position** — _"Offline is out of scope — no
   service worker references here."_ That was a deliberate call and its reversal must be written
   down, not left as silent drift.
2. **Distribution: notarized direct download, not the Mac App Store.** Must be recorded **before
   E6/Stripe begins**, because MAS would mandate Apple IAP and invalidate that work.
3. **Electron over Tauri**, with the WKWebView-coverage reasoning — so the decision can be revisited
   deliberately if a WebKit suite ever exists.

## Open questions

- Where does the auto-update feed live — Vercel Blob, S3, or GitHub Releases?
- What does the global hotkey do beyond summon-and-focus? Quick-capture is attractive but is its
  own spec.
- Does the shell need a tray/menu-bar-resident mode, or is a dock app sufficient for v1?

## How to test (manual acceptance, post-merge)

1. Install the signed `.dmg`. Confirm macOS does **not** warn about an unidentified developer.
2. Sign in. Quit fully (Cmd+Q) and reopen — you are still signed in.
3. Confirm Cmd+C / Cmd+V work in a board cell and in the item panel.
4. Open two or three boards so they enter the cache. **Turn off Wi-Fi.**
5. Reload the app. Those boards still render, with a visible offline banner.
6. Try to edit a cell, add an item, and drag a card. Each is refused with an offline message —
   nothing appears to succeed and then silently revert.
7. Navigate to a board you never opened. It reports honestly that it isn't available offline.
8. **Turn Wi-Fi back on.** The banner clears and the board resyncs without a manual reload. Have
   someone else edit an item while you were offline and confirm you see it after reconnect.
9. Sign out, then reopen the app offline. No cached board is reachable.
10. Drag a file from Finder onto an item — it uploads. Export a board to Excel — a native save
    dialog appears. Open an attachment — it opens in the default macOS app.
11. Click an emailed briefing link. It opens **in the app**, not the browser.
12. Click a link to any external site from inside the app. It opens in your **default browser**.
13. Press the global hotkey from another app — Monolith comes forward.
14. Publish a newer build to the update feed. Reopen the app and confirm it updates.

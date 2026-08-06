---
type: adr
status: accepted
date: 2026-08-06
tags: [project/monolith, adr, decision, desktop, electron, tauri, testing, playwright]
related:
  - "docs/superpowers/specs/2026-08-05-desktop-app-macos-windows-design.md"
  - "playwright.config.ts"
  - "[[00-north-star]]"
---

# Decision 37 — Electron over Tauri for the desktop shell

## Context

`docs/superpowers/specs/2026-08-05-desktop-app-macos-windows-design.md` (Decision 1) picks the
rendering technology for the desktop shell that loads `www.monolith.works`. The two realistic
candidates were Tauri v2 and Electron.

Tauri is the objectively better-behaved citizen on paper: roughly 10–15MB against Electron's
~120–150MB, and materially lower idle RAM. Rejecting it is not a "Tauri is bad" decision — it is
rejected on one specific, falsifiable ground.

## Decision

**Ship the desktop shell on Electron, not Tauri.**

## Why

Tauri renders its webview using each OS's native engine: **WKWebView on macOS**, Chromium
(WebView2) on Windows. That is two different rendering engines behind one shell, and the one this
app would depend on for its **launch platform** (macOS first, Windows second, per the spec's title)
is the one with no coverage anywhere in this repo's test suite.

`playwright.config.ts` declares exactly one project:

```ts
projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
```

There is no `webkit` project. Every E2E assertion in this codebase — including the offline suite
this ADR ships alongside (`e2e/offline.spec.ts`), and `e2e/boards.spec.ts`'s full create/edit/reload
flow — runs exclusively against Chromium. The board surface is not simple rendering: `ogl` (WebGL),
`framer-motion`, `recharts`, `react-grid-layout`, `dnd-kit`, and `@tanstack/react-virtual` are all in
active use. A WKWebView-specific layout, animation, or drag-and-drop divergence on macOS would have
**zero automated coverage that could catch it** — the first report would come from a user, on the
platform shipping first, in the environment that dogfoods heaviest.

Electron ships its own bundled Chromium — the same rendering engine the test suite already runs
against, identically on macOS and Windows. Choosing it means the shell inherits the coverage this
repo already has, rather than shipping on an engine the CI has never once exercised.

## What would reverse this back

**A real WebKit test suite.** If `playwright.config.ts` grows a `webkit` project — exercising the
same board surfaces (drag-and-drop, virtualized scroll, WebGL/canvas rendering, animation) that
currently run only under `chromium` — the specific gap this decision is closing no longer exists,
and Tauri's size/memory advantage becomes a live trade-off worth reopening. Until that project
exists, the WKWebView divergence risk is unmeasured, not merely "believed low," and this decision
stands.

## Consequences

- The desktop shell repo (`monolith-desktop`, per the shell spec's Decision 5) is committed to
  Electron's `~120–150MB` footprint and higher idle RAM than Tauri would have cost.
- `contextIsolation: true` / `nodeIntegration: false` / `sandbox: true` — Electron's standard
  remote-content security posture — becomes load-bearing, since the shell is now a Node-capable
  process rendering fully remote, untrusted-by-default web content.
- Adding a `webkit` Playwright project in the future is the concrete, checkable trigger for
  revisiting this decision — it should be treated as a real signal, not housekeeping, if it lands.
- Tracked in [[00-north-star]] alongside the desktop-app and offline-read-only work.

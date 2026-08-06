# Desktop shell — this repo's surface

The macOS desktop shell lives in a **separate repository** (`monolith-desktop`,
Plan 2: `docs/superpowers/plans/2026-08-06-macos-desktop-shell.md`). It wraps the
deployed web app, so almost nothing about it lives here. This directory exists so
that "almost nothing" is still findable in one place instead of being
reconstructed from three unrelated files.

## Everything this repo owes the desktop shell

| Where                                      | What                                                                         |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| `src/lib/desktop/release-contract.ts`      | Canonical contract: path, type, semver comparison, validation                |
| `public/desktop-release.json`              | The file actually served. Validated against the contract by the test here    |
| `src/lib/desktop/release-contract.test.ts` | Asserts the shipped JSON matches the contract and the versions are orderable |
| `src/proxy.ts` → `PUBLIC_ROUTES`           | Keeps `/desktop-release.json` reachable **before sign-in**                   |

`proxy.ts` imports `DESKTOP_RELEASE_PATH` from here rather than repeating the
string, so the public-route exemption and the contract cannot drift apart.

## Why the proxy entry is load-bearing

The proxy's matcher exempts static files by extension (`.js`, `.css`, `.svg`, …)
but **not `.json`**. Without the explicit `PUBLIC_ROUTES` entry the contract
307s to `/login?next=…`, and every installed shell receives an HTML login page
where it expects JSON — at boot, before anyone can sign in. There is a
regression test for exactly this in `src/proxy.test.ts`.

## Related but NOT desktop-specific

Offline read-only (`src/lib/offline/`, `public/sw.js`, `src/app/offline/`) is a
**web** capability. The desktop shell benefits from it, but it is not part of
this contract and must not be moved here — it ships and is tested on its own,
against a production build via `pnpm e2e:offline`.

## Decisions

- `vault/decisions/2026-08-06-decision-36-desktop-ships-as-a-notarized-direct-download.md`
  — direct download, **not** the Mac App Store (MAS mandates Apple IAP, which
  would invalidate E6's Stripe integration).
- `vault/decisions/2026-08-06-decision-37-electron-over-tauri-for-the-desktop-shell.md`
  — Electron over Tauri, because `playwright.config.ts` declares only a
  `chromium` project and Tauri renders in WKWebView on macOS, so nothing would
  catch a divergence.

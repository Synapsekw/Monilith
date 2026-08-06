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
| `src/lib/desktop/read-release.ts`          | Server-side reader used by the Settings page (kept out of the proxy path)    |
| `src/app/(app)/settings/desktop/page.tsx`  | The download page — Settings → Integrations → Desktop app                    |
| `src/proxy.ts` → `PUBLIC_ROUTES`           | Keeps `/desktop-release.json` reachable **before sign-in**                   |

## Where the installers live

The `.dmg` files are in the **public `desktop` Supabase Storage bucket**
(migration `20260806113351_desktop_bucket.sql`), not in `public/` — a 114MB
binary in the repo would bloat git and the Vercel deployment. The bucket is
public for reads and **service-role-only for writes**: releases are published
from the build machine, never from the app.

Publishing a new build is an upload plus a `downloads` edit in
`public/desktop-release.json`:

```bash
curl -X POST "$NEXT_PUBLIC_SUPABASE_URL/storage/v1/object/desktop/Monolith-<v>-arm64.dmg" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/x-apple-diskimage" -H "x-upsert: true" \
  --data-binary "@dist/Monolith-<v>-arm64.dmg"
```

`read-release.ts` deliberately **imports** the JSON instead of reading it from
`process.cwd()/public` at request time: `public/` is served statically and is
not guaranteed to be in the serverless bundle, so a filesystem read works
locally and can throw in production.

## The download page carries an unsigned-build warning

Until notarization ships, macOS refuses a downloaded copy and reports the app as
**“damaged”** — which reads as a corrupt download, not a signing problem. The
page says so explicitly and gives the `xattr -dr com.apple.quarantine`
workaround, and a test pins that notice in place. **Delete both once the build
is notarized**, and not before.

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

# Desktop release feed — design

**Date:** 2026-08-07
**Goal:** Publish an `electron-updater` feed so the macOS desktop shell can discover, download and
(once signed) install its own updates.
**Repos:** `monolith-desktop` (shell) and this one (bucket migration).

## The problem

`electron-builder.yml` has declared `publish.url: https://releases.monolith.works/desktop` since the
shell shipped, and `src/main/updater.ts` calls `checkForUpdatesAndNotify()` on launch and every six
hours. Nothing was ever published there. `releases.monolith.works` resolves to Vercel — the apex is
on Vercel nameservers — but no project claims the subdomain, so every check has been 404ing since
1.0.0 shipped.

Three separate things are broken, and only the first is obvious.

### 1. No feed is published

The artifacts already exist. A `pnpm package` run leaves `dist/latest-mac.yml`, both `.dmg`s and
both `.blockmap`s on disk. They have simply never been uploaded anywhere.

### 2. The mac build has no `zip` target

This is the one that would have wasted an afternoon. `MacUpdater.js:81` in the installed
`electron-updater@6.8.9` is:

```js
const zipFileInfo = findFile(files, "zip", ["pkg", "dmg"]);
if (zipFileInfo == null) {
  /* throws */
}
```

It looks for a **zip** and explicitly **excludes dmg**. Squirrel.Mac installs from a zip; a DMG is a
human-facing download format and nothing else. The current `latest-mac.yml` lists only DMGs, so even
a perfectly-served feed yields `null` here and throws.

### 3. The bucket rejects the files the feed is made of

`supabase/migrations/20260806113351_desktop_bucket.sql` constrains the `desktop` bucket:

```sql
allowed_mime_types = array['application/x-apple-diskimage', 'application/octet-stream']
```

A `.zip` (`application/zip`) and `latest-mac.yml` (`text/yaml`) are **rejected at upload with a
415**. The bucket was scoped to exactly one artifact type because at the time there was exactly one.

## The blocker we are explicitly deferring

**macOS auto-update requires a Developer ID signature, and this build is ad-hoc signed.**

`electron-builder.yml` sets `identity: null`, and `scripts/adhoc-sign.cjs` runs
`codesign --sign - --deep` to produce a coherent-but-untrusted signature. Squirrel.Mac validates
that a downloaded update satisfies the **running** app's designated code-signing requirement. For an
ad-hoc signature that requirement is the literal `cdhash` of the current binary, which changes on
every build — so every update is rejected, always. Electron's own documentation states the
requirement flatly.

There is no Developer ID cert on the build machine (`security find-identity -v -p codesigning`
returns only an unrelated "Aria Local Signing" cert) and no Apple Developer Program membership.

**Decision: build the whole feed anyway, minus the cert.** Everything in this spec is a
prerequisite for signed auto-update, none of it is wasted, and when a Developer ID arrives the
remaining change is flipping `identity` and `hardenedRuntime` — the notarization hook
(`scripts/notarize.cjs`) is already wired and already skips cleanly without credentials.

The corollary is that we must not ship something that _looks_ wired but silently cannot work. See
"Making failure loud" below.

## Architecture

```
shell → releases.monolith.works/desktop/latest-mac.yml
              │ 307
              ▼
        hjqca….supabase.co/storage/v1/object/public/desktop/…
```

A zero-build Vercel project owns the subdomain and does nothing but redirect `/desktop/*` into the
existing public `desktop` bucket.

### Why the indirection, and not the bucket URL directly

**The feed URL is compiled into every shipped binary and can never change for copies already
installed.** Pointing `publish.url` straight at `hjqcahbbbdaknbbnfnvl.supabase.co` would bake the
**DEV** Supabase project ref into every `.app` permanently — and this repo's `AGENTS.md` documents a
planned DEV→PROD cutover once the app is feature-complete. After that cutover, every shell in the
field would still be fetching updates from the old project, forever, with no way to repoint them
short of a manual reinstall.

The subdomain costs one Vercel project and buys a URL we can repoint at any time.

### Why 307 and not 308

A permanent redirect is cached by clients indefinitely, which destroys exactly the swappability the
indirection exists to provide. Temporary keeps the repoint free.

`electron-updater` follows both — verified in `builder-util-runtime@9.7.0/out/httpExecutor.js`,
which follows redirects on the metadata request (`doApiRequest`) and on the download (`doDownload`),
bounded by `maxRedirects`, stripping auth headers cross-origin. The bucket is public, so the header
stripping is irrelevant here.

### Why redirect rather than rewrite

A Vercel rewrite proxies the bytes; a redirect hands off. Each update is a ~115MB transfer. A
redirect keeps that traffic on Supabase's egress instead of routing it through the Vercel project.

## Components

### `monolith-desktop`

| File                         | Change                                                                |
| ---------------------------- | --------------------------------------------------------------------- |
| `electron-builder.yml`       | Add a `zip` mac target alongside `dmg`, both arches                   |
| `src/main/updater.ts`        | Wire `autoUpdater.logger` and an `on("error")` handler                |
| `scripts/publish-release.sh` | Upload the whole `dist/` artifact set to the bucket in one command    |
| `tests/release-feed.test.ts` | Assert `electron-builder.yml` still declares a mac `zip` target       |
| `release-feed/`              | The Vercel redirect project (`vercel.json` + a one-page `index.html`) |
| `README.md`                  | Replace "Nothing is published there yet" with the release runbook     |

The DMG target stays. It is what the Settings download page links, and it is the only format a human
can install from.

### This repo

One migration extending the `desktop` bucket's `allowed_mime_types` to accept `application/zip` and
`text/yaml`. Minted with `scripts/new-migration.sh`, applied to DEV via the `supabase-dev` MCP with
the same version + name, verified with `pnpm db:ledger-check`.

Nothing else changes here. `public/desktop-release.json` and the version gate are a separate
contract — they answer "is this shell too old to run", which is a different question from "is there
a newer build available" — and they keep working unchanged.

## Making failure loud

`updater.ts` currently swallows every failure:

```ts
void autoUpdater.checkForUpdatesAndNotify().catch(() => undefined);
```

No error handler, no logger. Combined with the signature blocker, shipping the feed as-is would
produce a system that checks, downloads, fails, and reports nothing — the exact trap this repo's
desktop README already names: _"a completely broken gate looks exactly like a healthy one."_

So the updater gains an `autoUpdater.on("error")` handler and a logger, so electron-updater's own
decisions ("Found version X", "New version downloaded", the signature rejection) reach a log. It
still never throws into the app; it just stops lying about what happened.

## Testing

**Unit:** a test asserting the mac `zip` target is still declared in `electron-builder.yml`. The
failure mode is silent and remote — a dropped target produces a feed that parses fine and simply
never yields an installable file — so it needs a test rather than a comment. Same discipline as the
existing `release-contract.test.ts`.

**End-to-end acceptance:** we cannot prove installation; that is what the cert gates. We can prove
everything up to it. Publish a synthetic `1.0.1` feed, run the packaged `1.0.0` shell, and confirm
the log shows it **found 1.0.1, downloaded it, and then failed at the signature check with a visible
error**. That exercises DNS, the redirect, YAML parsing, sha512 verification, zip selection and the
download — every link in the chain except the deferred one. Then revert the feed to `1.0.0`.

A green run of that test is also the regression test for the day the cert lands: the only expected
difference is that the final step succeeds.

## Out of scope

- **Apple Developer ID, notarization, and the `xattr` quarantine notice** on the Settings download
  page. Deferred by decision, above. The notice and its pinning test stay until the build is
  notarized, per `src/lib/desktop/README.md`.
- **A "Check for Updates…" menu item.** The natural home for surfacing an update state to a human,
  but it is UX beyond the feed.
- **Repointing `public/desktop-release.json`'s `downloads` through `releases.monolith.works`.** The
  same baked-in-URL argument applies to the Settings download links and this is probably right
  eventually, but it is a separate change with its own contract test to update.
- **Windows.** The shell is macOS-only today.

## Decisions

- `vault/decisions/2026-08-06-decision-36-desktop-ships-as-a-notarized-direct-download.md` — direct
  download, not the Mac App Store.
- `vault/decisions/2026-08-06-decision-37-electron-over-tauri-for-the-desktop-shell.md`

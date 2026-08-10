---
type: session
date: 2026-08-09-2323
branch: develop
trigger: wrapup
status: complete
tags: [session, desktop, macos, release, ci, signing, github-actions]
related:
  [
    "[[2026-08-09-2035-desktop-101-release]]",
    "[[2026-08-09-1756-desktop-manual-update-path]]",
    "[[2026-08-09-1703-desktop-release-feed]]",
    "[[2026-08-09-gotcha-83-an-unsigned-hardened-runtime-build-reports-as-corrupt-not-unsigned]]",
    "[[2026-08-09-gotcha-84-a-dmg-only-update-feed-is-inert]]",
  ]
---

# The desktop repo got a remote, and the signed release got a switch

Closes the **"Still open there"** item from [[2026-08-09-2035-desktop-101-release]]: `monolith-desktop`
had no git remote — 16 commits, one disk, including a published release — and the signed-build path
existed only as a sentence in a config comment.

All work is in the sibling repo `~/Dev/monolith-desktop`. **This repo has no code change**, and that
is a finding, not an omission — see _The web repo correctly needed nothing_.

## What changed

**`Synapsekw/monolith-desktop` now exists** — private, default `main`, 20 commits, remote HEAD
verified identical to local. The 16 local-only commits are backed up. `gh repo create` had been
blocked by the permission classifier in an earlier session; it ran fine here.

**`.github/workflows/release.yml` (`cb3eed8`)** — a `v*` tag push is now the release. It is
deliberately useful **before** there is an Apple account: with no signing secrets it builds unsigned,
uploads the dmg/zip as run artifacts, and says so in the job summary. Adding the six secrets is the
**only** change needed to make it a signed, notarized, published release — no code edit, no flag, no
yml change. `.github/RELEASING.md` documents every secret and how to produce it.

**`pnpm package:signed` (`996e6c5`)** — `electron-builder.yml` had referenced this command since the
shell was scaffolded and `package.json` never defined it. The README filled the gap with the
dangerous advice: _"set `mac.identity` and `hardenedRuntime: true` in `electron-builder.yml`"_ — one
atomic change spread over two hand edits, which is how you end up having made one of them and
shipping the corrupt-app pair from [[2026-08-09-gotcha-83-an-unsigned-hardened-runtime-build-reports-as-corrupt-not-unsigned]].
`scripts/package-signed.sh` passes both as CLI overrides in a single command, so one cannot be
applied without the other.

## Three traps that were latent behind `identity: null`

Found by audit, then **verified against the installed `app-builder-lib@26.15.3`** rather than docs.
All three were invisible because nothing signs today, and all three would have fired on the *first*
genuinely signed build — the worst possible moment (`e7b311d`).

1. **`forceCodeSigning` — pairing identity with hardenedRuntime does not actually guarantee a signed
   build.** `out/codeSign/macCodeSign.js`:

   ```js
   if (isMas || isForceCodeSigning) { throw ... }
   else { log.warn(..., "skipped macOS application code signing") }
   ```

   So an expired certificate, a locked keychain, or a CI keychain that imported without yielding a
   usable identity takes the **else** branch: warn, skip signing, and carry on to emit a
   `hardenedRuntime` bundle with no signature. That is the corrupt artifact, reached from the one
   direction the identity/hardenedRuntime pairing cannot block, announced only by a warning inside
   twenty minutes of build log. Both release paths now pass it.

2. **Double notarization.** electron-builder 26 has its own `@electron/notarize` pass, activated by
   `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID` — the *same three variables*
   `scripts/notarize.cjs` reads and the README tells you to export. Not two settings for one thing:
   two independent submissions of the same bundle, per architecture, doubling the slowest step in a
   release. `notarize: false` keeps the explicit hook.

3. **`mac.identity` is tri-state and `adhoc-sign.cjs` read it as a boolean.** app-builder-lib
   documents `undefined` as _"searches the keychain… if none is found, signing is skipped for all
   architectures — there is no automatic ad-hoc fallback."_ The old `identity !== null` check read
   that as "someone else is signing this" and stood down; electron-builder also stands down, with a
   warning. **Both decline**, and the linker-signature-only bundle the script exists to prevent
   ships anyway. It now throws rather than guesses.

Also: `hardenedRuntime: false` is now commented as **load-bearing**. electron-builder's darwin
default is `true`, so deleting that line as boilerplate does not restore a safe default — it creates
the corrupt pair.

## Guards, not comments

`electron-builder.yml`'s comments already explained the corrupt-app pair at length, and the pair
shipped anyway, because **a comment cannot fail a build**. `tests/signing-config.test.ts` (10 tests,
suite 23 → 33) turns each invariant into something that fails.

Each was **mutation-tested**, not just written: setting `hardenedRuntime: true` against the committed
`identity: null`, removing `notarize: false`, dropping `forceCodeSigning`, and reverting the
tri-state check each turned exactly the expected test(s) red, and all 33 passed again on revert.

## The web repo correctly needed nothing

Scouted, then verified directly. The web side is **deliberately pinned** to the unsigned reality:
`src/lib/desktop/README.md` says the unsigned warning must be deleted _"once the build is notarized,
and not before"_, and three tests in `src/app/(app)/settings/desktop/page.test.tsx` pin the `xattr`
copy in place. Editing it now would ship install instructions for a build that does not exist. The
four-step follow-up is recorded in `.github/RELEASING.md` → _"The day the certificate actually
lands"_.

One cross-repo constraint **did** come back the other way: `src/lib/desktop/release-contract.ts` uses
a strict `/^\d+\.\d+\.\d+$/` and `getDesktopRelease()` **throws** on failure. A prerelease version
would not fail in the desktop repo — it would 500 the Settings page in *this* one, later, for
reasons nobody would connect. The workflow now rejects any non-bare-`x.y.z` version before building.

## Verified, not assumed

- Remote HEAD `fa44da6` == local; 20 commits; repo private; task branch deleted.
- Gates in-repo: typecheck clean, **33/33 tests**.
- **A real `pnpm package` run** — both architectures, dmg **and** zip, `latest-mac.yml` listing the
  zips Squirrel needs, and `codesign --verify --strict` passing on both `.app`s with
  `Signature=adhoc`, `Identifier=ai.synapse.monolith`. The config changes did not break the unsigned
  path.
- **The workflow was actually run** (`workflow_dispatch`, `dry_run: true`, run `31331469431`) rather
  than shipped untested — this repo's own history is that gates passing ≠ it works. **Conclusion:
  success.** Every unsigned step green, and the three signing-gated steps — _Import Developer ID
  certificate_, _Verify signature, notarization and staple_, _Publish to the update feed_ — all
  correctly **skipped** with no secrets present. Keychain destroyed. Artifact
  `monolith-desktop-1.0.1-unsigned`, 465MB. The mode-resolution gating works as designed, on the
  real runner, not on paper.

  That run is also the first time `pnpm install --frozen-lockfile`, `pnpm typecheck` and `pnpm test`
  have executed on a machine that is not this laptop. They passed — which retires a small standing
  unknown about the lockfile.

## What is still not done, and cannot be

**Nothing here has been signed or notarized. There is no Apple Developer account.** Everything from
certificate import onward — keychain import on the runner, electron-builder honouring
`-c.mac.identity`, notarization, stapling, `spctl --assess`, and whether auto-update actually
*installs* — is untested by construction. The $99 enrolment is the only remaining blocker, and it is
the owner's to buy.

The audit also flagged **entitlements** worth trimming (`allow-unsigned-executable-memory` is a strict
superset of `allow-jit`; `network.client` and `files.user-selected.read-write` are App Sandbox keys,
inert without `app-sandbox`). **Deliberately not applied** — it is the one change that can crash the
app on launch, and only in a *signed* build, which nobody can produce today. Recorded for the day the
certificate lands.

## How to test

Not user-observable in the Monolith web app — no code changed here. To check the desktop work:

1. `open https://github.com/Synapsekw/monolith-desktop` — confirm the repo exists, is **Private**, and
   shows 20 commits on `main`.
2. In that repo, **Actions → Release (macOS)** — open the `dry_run` run and confirm _Typecheck_ and
   _Test_ are green and _Import Developer ID certificate_ is **skipped** (no secrets).
3. Download the run's `dist` artifact, unzip, then `xattr -dr com.apple.quarantine` the `.dmg` and
   install it. It is a normal unsigned build — same as `pnpm install:local`.
4. Locally: `cd ~/Dev/monolith-desktop && pnpm test` → **33 passing**.
5. Prove a guard works: set `hardenedRuntime: true` in `electron-builder.yml`, run `pnpm test` → two
   failures naming the corrupt-app pair. Revert.
6. `pnpm package:signed` with no `CSC_NAME` → refuses immediately with the variable named, instead of
   building something unsigned.

## Open threads

- **The $99 Apple Developer account** is the only thing between here and installable auto-update.
  `.github/RELEASING.md` is the runbook, top to bottom.
- **One manual reinstall still bootstraps each user** — unchanged. 1.0.0 predates the prompt.
- **CI green does not prove the app launches.** Only the Vitest suite runs; `tests/packaged.spec.ts`
  (Playwright-Electron) is not wired in, and the README is emphatic that the interesting failures —
  the silently-absent preload bridge — are invisible to Vitest.
- **`macos-15` is pinned** and will be deprecated eventually, as `macos-14` already is.
  `macos-latest` was repointed to macOS 26 in mid-2026 and there is an open runner-image regression
  where a `.p12` imports "successfully" and yields no identity — hence the pin, and hence
  `forceCodeSigning`, which turns exactly that symptom into a failure instead of a corrupt release.
- **Private repo ⇒ macOS minutes bill at 10×.** Every tag runs a two-architecture Electron build.

## Next session entry point

The desktop track is blocked on a purchase, not on code. The critical path is elsewhere: the **E6
Stripe track** (units B, C, E–H) — no migration, not blocked on credentials — or the dashboard-widget
`SECURITY DEFINER` / service-client question from the north-star, which may be affecting users today.

---
type: adr
date: 2026-08-09
status: accepted
tags: [decision, gotcha, desktop, macos, packaging]
related: ["[[2026-08-09-1702-desktop-drag-fix-and-pr89-promote]]"]
---

# Gotcha 83 — an unsigned hardened-runtime build reports as corrupt, not unsigned

## Context

The desktop shell shipped with `hardenedRuntime: true` and no signing identity, because the plan
wrote the release-correct config and there is no Apple Developer account yet. Those two settings are
individually reasonable and jointly wrong.

With no identity, electron-builder skips signing entirely, leaving only the bare linker signature
Apple forces onto every arm64 binary. Inspected:

```
Identifier=Electron          <- not ai.synapse.monolith
Sealed Resources=none        <- nothing sealed
Info.plist=not bound
```

Hardened runtime then advertises a signature that claims sealed resources which do not exist, so
`codesign --verify` fails with `code has no resources but signature indicates they must be present`
and Gatekeeper reports the app as **damaged/corrupt** rather than merely from an unidentified
developer. Stripping quarantine does not fix it, because the signature itself is malformed.

Two things were misdiagnosed on the way, both worth recording:

1. **The framework was blamed.** The owner asked why this worked under Tauri and not Electron. It has
   nothing to do with either. `com.apple.quarantine` is stamped by the **downloading application**
   (Chrome), not by the build — a Tauri app downloaded the same way is blocked identically. Under
   Tauri the app had been run locally, which never touches that path.
2. **The workaround targeted an unreachable step.** The shipped Settings page said to run
   `xattr -dr com.apple.quarantine /Applications/Monolith.app` *after* installing. Gatekeeper blocks
   the drag **out of the quarantined disk image**, so the app never reaches `/Applications` for the
   command to act on. Instructions that look authoritative and cannot be followed are worse than
   none.

## Decision

For unsigned local builds: `identity: null`, `hardenedRuntime: false`, and an `afterPack` hook
(`scripts/adhoc-sign.cjs`) that runs `codesign --force --deep --sign -` over the bundle. That grants
**no trust** — the app is still unsigned to Apple — but produces a coherent signature (real bundle
id, sealed resources, `--verify` passes), so the failure the user sees is the accurate one.

`afterPack`, not `afterSign`: with `identity: null` electron-builder skips signing, so `afterSign`
never fires.

Notarization **requires** hardened runtime, so the two flip on together or not at all. `pnpm
install:local` builds straight into `/Applications`, which is never quarantined and needs no Apple
account — that is the daily loop; the DMG is the download-and-install rehearsal.

Downloaded unsigned builds strip the attribute **from the `.dmg`, before mounting**.

## Consequences

- Do not copy release-correct signing config into a repo that cannot sign. The half-configured state
  is worse than the honestly-unsigned one, because it turns a familiar warning into an alarming lie.
- A green `pnpm package` proves the build ran, not that the artifact installs. Neither typecheck,
  lint, unit tests nor the build could see any of this; it took inspecting `codesign -dv` on the
  installed bundle and a real Finder-style install.
- Related: the same session found the window could not be dragged at all
  (`titleBarStyle: "hiddenInset"` removes the only free draggable region on macOS, and the renderer
  is a web app that declares no `-webkit-app-region: drag`). Also invisible to every gate; guarded now
  by a smoke test asserting the frame is taller than its content, control-checked by restoring the
  option and confirming the test goes red.

---
type: adr
date: 2026-08-09
status: accepted
tags: [decision, gotcha, desktop, macos, release, packaging]
related:
  [
    "[[2026-08-09-1703-desktop-release-feed]]",
    "[[2026-08-09-gotcha-83-an-unsigned-hardened-runtime-build-reports-as-corrupt-not-unsigned]]",
  ]
---

# Gotcha 84 — a dmg-only update feed is inert, and every symptom points somewhere else

## Context

The macOS shell shipped building exactly one artifact, the `.dmg`, because that is what a human
downloads from Settings → Integrations → Desktop app. `electron-builder` generates `latest-mac.yml`
from whatever targets exist, so a dmg-only build still produces a complete, valid,
correctly-checksummed feed index.

That feed can never install anything. `electron-updater`'s `MacUpdater` selects the payload with:

```js
const zipFileInfo = findFile(files, "zip", ["pkg", "dmg"]); // MacUpdater.js:81
if (zipFileInfo == null) {
  /* throws */
}
```

It looks for a **zip** and passes `["pkg", "dmg"]` as the *excluded* extensions — because
Squirrel.Mac installs by swapping an app bundle out of a zip and cannot mount and install from a
disk image. A DMG is a human distribution format and nothing else.

## The reason this is expensive to diagnose

Every observable signal points at the feed infrastructure rather than the build config:

- The build succeeds with no warning about the missing target.
- `latest-mac.yml` exists, parses, and lists real files with correct sha512s and sizes.
- The feed URL serves a `200`, and `curl` shows perfectly reasonable YAML.
- The updater's own log says `Checking for update` and then fails **after** the network round-trip.

So the natural search order is DNS → redirect → storage → YAML → checksums, all of which are fine.
The defect is one line of packaging config in a different repo from the feed.

It is also silent in the worst way: the failure happens on someone else's machine, hours after
launch, in a subsystem with no UI. Absent an `error` listener the cause is destroyed twice over —
see [[2026-08-09-1703-desktop-release-feed]].

## Decision

Build **both** mac targets, always, and treat the pair as non-negotiable:

```yaml
mac:
  artifactName: ${productName}-${version}-${arch}.${ext}
  target:
    - target: dmg # what a human downloads
      arch: [arm64, x64]
    - target: zip # the ONLY thing Squirrel.Mac can install
      arch: [arm64, x64]
```

Guard it in two places, because the two failure modes are different:

1. **`tests/release-feed.test.ts`** parses `electron-builder.yml` and asserts the `zip` target is
   declared. Catches the config regression at commit time.
2. **The live-feed acceptance test** (`tests/fixtures/updater-main.js`, driven from `smoke.spec.ts`)
   asserts the **published** feed offers a `.zip`. Catches a bad *publish* — a stale `dist/`, a
   partial upload — which no static check can see.

`scripts/publish-release.sh` additionally refuses to upload a feed listing no zip, so the broken
state cannot reach the bucket in the first place.

## Consequences

- Each release uploads roughly twice the bytes (~485MB for two arches). Irrelevant against a bucket
  and a redirect; the zips are what actually get downloaded by updates, the DMGs by humans.
- Artifact names are pinned with `${arch}` because electron-builder **omits** the arch suffix for
  x64, which would otherwise put `Monolith-1.0.0-mac.zip` beside `Monolith-1.0.0-arm64-mac.zip` and
  read like a universal build. This is the same drift already fixed once for the DMG names; pin the
  name **before** publishing, since renaming afterwards strands objects in a public bucket.

## The generalisable rule

**A generated manifest is not evidence that the thing it describes is usable.** `latest-mac.yml` was
well-formed, honest about its contents, and useless — because validity and sufficiency are different
properties. When a consumer selects from a manifest, test what the consumer *selects*, not that the
manifest parses.

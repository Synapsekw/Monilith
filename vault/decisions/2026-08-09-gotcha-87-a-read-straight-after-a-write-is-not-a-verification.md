---
type: adr
date: 2026-08-09
status: accepted
tags: [decision, gotcha, release, storage, tooling]
related:
  [
    "[[2026-08-09-2035-desktop-101-release]]",
    "[[2026-08-09-gotcha-84-a-dmg-only-update-feed-is-inert]]",
  ]
---

# Gotcha 87 — a read straight after a write is not a verification

## Context

`scripts/publish-release.sh` uploads the desktop release to a public Supabase Storage bucket:
eight payloads (two arches × dmg + zip, each with a blockmap), then `latest-mac.yml` **last**, so no
client can see an index pointing at files that have not landed. It then reads the feed back through
`releases.monolith.works` and asserts the version matches.

Cutting 1.0.1, that read-back failed:

```
✓ Monolith-1.0.1-arm64.dmg
✓ latest-mac.yml
verifying https://releases.monolith.works/desktop/latest-mac.yml
✗ served feed says 1.0.0, expected 1.0.1 (stale cache?)
```

Every upload returned `200`. The index write returned `200` with a real object id. And the very
next read returned the **previous** version — carrying `cache-control: no-cache`, a value this
script never sets (it sends `max-age=60` for the index). So the response was not the object just
written. A retry a minute later, with byte-identical headers, wrote and served 1.0.1 correctly.

The root cause was not pinned. The bucket listing showed the index's `updated_at` moving to the
script's write time while the served body was still the old version, which is consistent with an
intermediary answering from cache and inconsistent with a failed write. It was not reproducible
afterwards.

## Why it matters more than it looks

The index is the **only mutable object** in the bucket. Payload filenames carry their version, so
they are write-once and can never be stale. `latest-mac.yml` is overwritten every release, and it
is the single file every client reads to decide what to download.

So the failure mode this class of bug produces is exactly the worst one: **new payloads published
successfully behind an index still advertising the old release.** Nothing 404s, nothing errors, no
user sees a broken download — they simply never receive the update, and the next person to look
finds a bucket that appears completely correct.

## Decision

Treat post-write verification as a **convergence check, not a point read**.

```bash
for i in $(seq 1 10); do
  SERVED="$(curl -fsSL -H 'Cache-Control: no-cache' \
    "$FEED_URL?_=$(date +%s)-$i")"
  [ "$(version_of "$SERVED")" = "$VERSION" ] && break
  sleep 6
done
```

Three properties, each load-bearing:

1. **It polls.** A publish that takes a few seconds to become visible is normal. One that never
   converges is a real failure and still fails the release — the guard is not weakened, only given
   time to be right.
2. **It cache-busts** with a changing query parameter and a `no-cache` request header, so a stale
   intermediary cannot answer for the whole loop and turn a transient problem into a hard failure.
3. **It diffs the served body against `dist/` byte-for-byte**, not just the version line. A
   truncated or half-written index can carry the correct first line while listing sha512s that no
   longer match the payloads — a corruption that only surfaces when a user's update fails its
   checksum, which is to say, never where anyone can see it.

## Consequences

- A publish can now take up to a minute longer in the worst case. Against a release, irrelevant.
- The verification is the only thing standing between "uploaded" and "actually released". It ran
  once, caught this, and refused to report success — the release was fine, the guard was right, and
  without it 1.0.1 would have shipped behind a 1.0.0 feed.

## The generalisable rule

**`200 OK` means the write was accepted, not that the world has changed.** Any publish step whose
success is defined by what a *third party* subsequently serves — a CDN, object storage, a DNS
record, a package index — must verify by reading until it converges, and must compare the full
artifact rather than a field that happens to be easy to parse. A single read immediately after a
write measures the write path, not the read path, and it is the read path users are on.

---
type: adr
status: accepted
date: 2026-08-06
tags: [project/monolith, adr, decision, desktop, distribution, billing, e6]
related:
  - "docs/superpowers/specs/2026-08-05-desktop-app-macos-windows-design.md"
  - "docs/superpowers/specs/2026-08-01-billing-and-monetization-design.md"
  - "[[00-north-star]]"
---

# Decision 36 — Desktop ships as a notarized direct download, not through the Mac App Store

## Context

`docs/superpowers/specs/2026-08-05-desktop-app-macos-windows-design.md` (Decision 7) settles how the
macOS desktop app reaches users. Distribution has exactly two realistic options: the Mac App Store
(MAS), or a signed-and-notarized `.dmg` downloaded directly from Monolith's own site with Sparkle-
style auto-updates. This choice has to be made now, not deferred, because it interacts with work that
has not started yet: E6, the billing and monetization epic
(`docs/superpowers/specs/2026-08-01-billing-and-monetization-design.md`), which will wire Monolith's
subscriptions to Stripe.

## Decision

**The desktop app ships as a notarized direct download. It does not go through the Mac App Store.**

## Why

The Mac App Store mandates Apple's In-App Purchase (IAP) system for any app that sells digital
subscriptions through it, at a 30% cut in year one of a subscription and 15% thereafter. A direct
download outside the App Store has no such requirement — Monolith can charge through Stripe, exactly
as the web app already plans to, with no App Store intermediary and no Apple tax on that revenue.

Monolith's subscription is sold once, to one account, used identically from the browser and from the
desktop shell (the shell loads the hosted web app — see the shell/offline design's Decision 2 and 4;
it is not a separate purchasable product). MAS distribution would force that one subscription through
two incompatible payment paths — Stripe for web, Apple IAP for anyone who installed via the Store —
which is not a small integration detail, it is a structurally different entitlement and billing
model.

## Why this must be settled before E6 starts, not after

**Stated plainly: choosing the Mac App Store later would invalidate the Stripe integration E6
ships.** E6 is going to build Monolith's entitlement and checkout flow around Stripe as the single
source of truth for `{ plan, status, checkedAt }` (the shape the offline entitlement cache persists,
per the offline-read-only plan's Global Constraints). If the desktop distribution decision were left
open and MAS were chosen after E6 already shipped Stripe-only billing, every desktop install would
need a second, Apple-IAP-shaped entitlement path bolted on after the fact — a rebuild of the exact
surface E6 is about to build once. Settling distribution now means E6 can be built for exactly one
payment processor with no asterisk for "unless it's the Mac App Store build."

## What would reverse this back

- **Apple materially changes IAP terms** for macOS subscription apps in a way that removes the
  30%/15% cut or permits external payment processors within the Store listing itself (regulatory
  pressure has moved in this direction in some jurisdictions already) — if that becomes true and
  applies to Monolith's category, the economic argument against MAS weakens and this should be
  re-evaluated.
- **Discoverability becomes a real growth bottleneck** and the App Store's install-base reach is
  judged worth paying the IAP cut for — a business decision, not an engineering one, but it would
  still require rebuilding the entitlement path E6 will have shipped by then.

Neither condition is expected soon; the point of deciding now is precisely so E6 does not have to
hedge against either.

## Consequences

- E6's Stripe integration can assume a single payment processor and a single entitlement shape with
  no App-Store-specific branch.
- The desktop shell (separate `monolith-desktop` repo per the shell spec's Decision 5) needs its own
  signing and notarization pipeline and auto-update channel, but not an in-app purchase SDK.
- Marketing and onboarding copy for desktop should not promise "Mac App Store" availability.
- Tracked in [[00-north-star]] alongside the desktop-app and offline-read-only work; must be visible
  to whoever scopes E6 next.

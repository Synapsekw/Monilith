---
type: adr
status: accepted
date: 2026-07-07
tags: [project/pulse, adr, gotcha, cache, rls]
related:
  - "[[2026-07-07-1117-avatar-surfaces-header-presence-columns]]"
---

# Gotcha 53 — `getUserOrgs()` filters deactivated memberships; the roster cache does not → stale-cache leak

## Context

`updateProfileAvatar` (and any profile-field edit) must invalidate the org-member roster cache so the
new `avatar_url`/`full_name` propagates. The roster is `listOrgMembersCached(orgId)` — a `"use cache"`
read tagged `orgMembersTag(orgId)` (`org-members:org:<orgId>`), `cacheLife("nav")` (revalidate 60s /
**expire 3600s**). The invalidation originally busted that tag for every org in `getUserOrgs()`.

The bug: **the set of orgs `getUserOrgs()` returns is narrower than the set of rosters that contain
the user.** `getUserOrgs()` → `auth_user_orgs()` filters `deactivated_at IS NULL`, but
`listOrgMembersCached` returns **all** `org_members` rows including deactivated ones. So an org where
the user is **deactivated-but-still-rostered** never gets its tag invalidated on a profile change —
that roster keeps serving the user's stale row (e.g. `avatar_url: null`) until the 1-hour cache
expiry. Symptom seen: avatar "never appears on some boards."

(The tempting hypothesis — cross-org shared boards — was **wrong**: a cross-org guest is granted via
`board_members`, not `org_members`, so they are never in another org's roster in the first place.
Verified 0 cross-org grants on dev before rejecting it.)

## Decision

Invalidate the roster tag for **every org the user has an `org_members` row in — active or
deactivated** — not just `getUserOrgs()`. Read those org ids with the **service client** (filtered to
`user_id = <uploader>`), because `org_members` RLS (`org_id IN auth_user_orgs()`) would itself hide
the user's own deactivated rows from an anon/authed read — the same filter that caused the bug.

## Consequences

- **General rule:** any cache invalidation keyed on "the current user's orgs" must match the
  membership scope of the cache it is busting. If the cached read includes deactivated/pending/guest
  rows, the invalidation must too — `getUserOrgs()`/`auth_user_orgs()` is an **active-only** view and
  will silently under-invalidate. Reach for a service-client `org_members` read when you need the full
  membership set.
- Applies to future profile edits (full_name, future fields) and to any other per-user datum cached
  inside a per-org roster.
- Cost: one extra service-client read per profile edit (cold path, negligible).

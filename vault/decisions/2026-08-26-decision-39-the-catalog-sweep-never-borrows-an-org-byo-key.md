---
type: adr
date: 2026-08-26
status: accepted
tags: [decision, ai, providers, security]
related:
  [
    "[[2026-08-27-0913-carryover-batch-promote-100-sync-prod]]",
    "[[2026-08-11-1501-provider-model-layer-spec-1]]",
    "[[2026-08-27-1229-carryover-clear-batch-promote-101]]",
  ]
amended: 2026-08-27
---

# Decision 39 — the catalog sweep never borrows an org BYO key

## Context

The nightly model-catalog refresh probes each provider's `/v1/models` to verify model ids, and it
needs *a* credential per provider to do so. `readSweepCredential()` picks one stored key from
`user_ai_credentials`. Org BYO keys live elsewhere — `org_ai_settings.byo_secret_id` — and are read
only by `gateway.ts`. So a provider that exists **solely** as an org BYO key is never swept.

The vault recorded this as the "largest functional gap": new models would be invisible for that
provider until someone re-saved a key. Investigating it turned up a premise error — `setOrgByoKey`
already runs `verifyProviderModels` in an `after()` callback on save, so such a provider *is*
verified, just at save time. The real exposure is a **staleness window** for models published after
that save, not permanent invisibility.

## Decision

Keep the exclusion. The sweep reads personal keys only, and the contract comment on
`readSweepCredential()` now says so explicitly, pinned by two tests: no table other than
`user_ai_credentials` is touched, and `org_ai_secret_get` is never called. A fallback cannot be
added without turning one of them red.

## Rationale

1. **Cross-tenant use of an org-scoped secret.** `ai_models` is a *platform-wide* catalog. A sweep
   borrowing an org key must pick one org among many and spend that tenant's secret on a probe whose
   result serves every other tenant. Service-role access bypasses RLS, so nothing structural would
   stop it — which is precisely why the rule has to be written down rather than assumed.
2. **No consent surface.** What legitimises borrowing a *personal* key is the disclosure under the
   field the person typed it into, and that person alone bears the probe. An org key is entered by
   one admin under the organisation's provider contract; the rate limits, 401 audit noise and
   anomaly detection a daily probe can trigger land on a tenant that never agreed to it.
3. **Bounded cost.** Save-time verification already covers the provider's ids; only later-published
   models go stale, and decision-39's sibling work makes that visible rather than silent — the sweep
   now records `skipped` with a reason, and `/settings/ai` renders it.

## Consequences

- ~~A provider keyed only at org level shows "Not checked" freshness rather than a verified
  timestamp. That is accurate, not a fault.~~ **Amended 2026-08-27**
  ([[2026-08-27-1229-carryover-clear-batch-promote-101]]): a provider keyed only at org level now
  shows a verified timestamp from its **last save-time check**, and ages from there. `setOrgByoKey`
  (and `saveAiKey`) already ran the probe and discarded the result; they now record it. **The
  decision is unchanged** — the sweep still borrows no org key, and both pinning tests are
  untouched. Only the *staleness window* this section describes is unchanged too; it is now visible
  as an ageing timestamp instead of a flat "Not checked", which is strictly more informative. This
  closes a gap rationale #3 already anticipated ("Save-time verification already covers the
  provider's ids") rather than reversing anything.
- **Save-time health is recorded on success only.** A failed verify writes **no** row. `ai_providers`
  is a platform-wide registry with no `org_id`/`user_id` column, so one tenant pasting a revoked key
  would otherwise render as a vendor outage for every other tenant — the same cross-tenant objection
  as rationale #1, pointing the other way down the write path. The nightly sweep remains the sole
  authority on failures.
- If the staleness window ever becomes a real complaint, the fix is **not** to borrow the org key —
  it is to re-run save-time verification on a schedule under the org's own authority, or to ask the
  admin to opt in explicitly.

## Reversal condition

An org-level opt-in ("use our key to keep the model catalog current") with a visible control and
stored consent would satisfy points 1 and 2 and make the fallback legitimate.

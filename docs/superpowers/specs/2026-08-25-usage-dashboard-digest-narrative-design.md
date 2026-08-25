# F17 — AI usage breakdown + weekly-digest narrative

**Date:** 2026-08-25
**Status:** Approved (delegated build session — see `vault/00-north-star.md` §Phase 10, "F17 survives only in the superseded July E6 plan")

## Context

`docs/superpowers/plans/2026-07-12-e6-billing-platform.md` names F17 ("usage dashboard + AI
weekly-digest narrative") as Track B of the July E6 plan. That plan is explicitly superseded — its
own header says Track B "has no successor spec... it is not part of the August billing design."
Everything below was re-verified against the live DEV schema and current `src/lib/ai/*` /
`src/lib/digest/*` modules on 2026-08-25 (via `supabase-dev` MCP `list_tables`/`execute_sql` and
direct file reads); the July plan's code samples are **not** trustworthy as written (see
"Divergences from the July plan" below) — the shape of the DB and the gateway API changed
materially since July.

## What already exists (do not rebuild)

- `ai_usage` (org_id, user_id, feature, provider, model, input_tokens, output_tokens,
  cache_read_tokens, cache_write_tokens, cost_usd, credits, created_at), indexed by
  `ai_usage_org_created_idx (org_id, created_at DESC)`.
- `ai_credits_used_this_month(p_org)` RPC + `getAiEntitlement(orgId)` / `requireAiEntitlement` in
  `src/lib/ai/entitlement.ts` — already the source of the credits-used/limit numbers.
- **A credits-used/limit meter already renders** in `OrgAiSettingsForm.tsx` (`/settings/ai`,
  managed-mode admins only) — "X / Y credits this month" + a progress bar. This is NOT being
  duplicated.
- `digest_runs` (org_id, period_start, period_end, status, stats jsonb, email_sent_count, error) +
  `runWeeklyDigest`/`processOrg` in `src/lib/digest/run.ts`, `renderDigestHtml`/`renderDigestText`
  in `src/lib/digest/render.ts`, both already wired to a weekly cron. No `narrative` column exists
  yet.
- An adapter-agnostic "generate one short narrative" pattern already ships in production:
  `src/lib/reports/ai-actions.ts` → `draftReportNarrative` (`src/lib/reports/ai-draft.ts`) — calls
  `adapter.generateStructured` with a JSON schema, gated by `requireAiEntitlement`, metered by
  `runAi`. `report_narrative` is already a registered feature tier (`standard`) in
  `src/lib/ai/model-map.ts`. F17's narrative generator is a near-copy of this, not new design.
- Prod (the live deployment on the DEV DB) currently ships **no `RESEND_API_KEY`** — digest sends
  file in-app `notifications` only, no email (vault, confirmed 2026-08-04). A narrative that only
  renders in the email HTML would therefore be invisible to real users today. **The narrative must
  also ride the in-app notification payload**, not just the email template — this is a scope
  correction versus the July plan, which only wired it into the email renderer.

## What's genuinely net-new (the actual F17 scope)

1. **Two bounded, indexed rollup RPCs** (service-role only, mirroring existing `ai_usage`
   function grants): a 6-month `date_trunc('month', …)` rollup and a this-month per-feature
   breakdown. Both scan `ai_usage_org_created_idx` with an explicit `[from, to)` bound — no
   unbounded `select *`.
2. **A usage-breakdown card** on `/settings/ai` (admin-only, same page as the existing meter): a
   per-feature bar list (which features are burning credits this month) + a 6-month credits/cost
   trend. This is additive to the existing meter, not a replacement — it answers "where did the
   spend go" and "is it trending up", which the existing single-number meter doesn't.
3. **A weekly-digest narrative**: one short, calm paragraph (`<=45 words`) summarizing an org's
   week, generated once per (org, week) inside the existing idempotent `digest_runs` claim, cached
   on a new `digest_runs.narrative` column, rendered as the lead line in both the HTML/text email
   AND folded into the `notifications` payload for `kind = 'health_digest'`. Runs only for
   `managed`/`org_byo` orgs (the cron has no session user, so `per_user`/`off` get the
   narrative-free digest, matching how the entitlement gate already treats those modes elsewhere).
   Non-fatal by construction: any failure (entitlement, provider, parse) returns `null` and the
   digest sends unchanged — this mirrors `runAi`'s own "meter on the error path" and the existing
   `generateDigestNarrative`-shaped design from the July plan, which remains sound.

## Divergences from the July plan (verified 2026-08-25, do not follow the old code samples)

- **`runAi`'s callback signature changed.** It is now
  `(resolved: ResolvedAiCall, reportUsage) => Promise<{ result: T; usage: AiUsageTokens }>` —
  there is no `resolved.adapter.complete(...)` method and no `model` field in the return. The
  adapter surface is `generateStructured<T>({ ...toRequestArgs(opts), system, user, schema })` —
  JSON-schema structured output, the same call `draftReportNarrative` already makes in prod. F17's
  narrative generator must use `generateStructured` with a `{ narrative: string }` schema, not a
  free-text `.complete()` call.
- **The digest narrative needs a JSON schema + Zod validation**, exactly like
  `src/lib/reports/ai-draft-schema.ts` (`REPORT_NARRATIVE_JSON_SCHEMA` /
  `reportNarrativeSchema`) — copy that shape down to one field.
- **`ai_usage` already has `cache_read_tokens`/`cache_write_tokens`** columns the July plan's SQL
  sample didn't know about — irrelevant to the two new rollup RPCs (they don't need cache token
  detail), so no change needed there, just noting the live schema is richer than the sample.
- **The usage UI must not duplicate the existing credits meter** in `OrgAiSettingsForm.tsx` — the
  July plan's `UsageDashboard.tsx` sketch assumed a blank slate. The new card is scoped down to
  per-feature breakdown + trend only.
- **Notification payload gets the narrative too** (see above) — the July plan only wired the email
  renderer, which is not sufficient in the current no-RESEND-key prod state.

## Architecture

```
ai_usage (existing) ──┬──> ai_usage_summary(org, from, to) RPC ──> getUsageSummary() ──> UsageBreakdown card (/settings/ai)
                       └──> ai_usage_by_feature_this_month(org) RPC ──┘

digest_runs.narrative (new column)
  processOrg() [run.ts] ──> generateDigestNarrative(orgId, boards, totals)
                               │  (adapter-agnostic generateStructured, entitlement-gated, non-fatal)
                               ▼
                     digest_runs.narrative (persisted)  +  notifications.payload.narrative  +  email lead paragraph
```

## Components

1. **Migration** `usage_summary_and_digest_narrative` — adds `digest_runs.narrative text`, two
   `SECURITY DEFINER` SQL functions (`ai_usage_summary`, `ai_usage_by_feature_this_month`),
   `revoke all … grant execute … to service_role` matching the existing `ai_usage` function grant
   pattern.
2. **`src/lib/ai/usage-summary.ts`** — `getUsageSummary(orgId)`: reads a 6-month window via the two
   new RPCs plus `getAiEntitlement(orgId)` (reused, not reinvented); returns
   `{ entitlement, months, features }`. `server-only`, `typedRpc`.
3. **`src/components/settings/UsageBreakdown.tsx`** — client component, fed the server-preloaded
   summary; per-feature bar list + 6-month trend (recharts, already a dependency); a
   this-month/6-month toggle is pure client state, 0 new round-trips. Mounted in
   `src/app/(app)/settings/ai/page.tsx`, admin-only, alongside the existing `OrgAiSettingsForm`.
4. **`src/lib/digest/narrative-schema.ts`** — `DIGEST_NARRATIVE_JSON_SCHEMA` + Zod, one field.
5. **`src/lib/digest/narrative.ts`** — `generateDigestNarrative(orgId, boards, totals)`, mirrors
   `draftReportNarrative`'s call shape; never throws (try/catch → `null`).
6. **Wire-in**: `src/lib/digest/render.ts` gets an optional `narrative?: string` on
   `DigestEmailInput`, rendered as a lead paragraph/line. `src/lib/digest/run.ts`'s `processOrg`
   calls `generateDigestNarrative` after the skip-check, before `sendEmails`; persists it on the
   `sent` update; folds it into the `notifications` insert payload (extend
   `digestNotificationPayloadSchema` in `src/lib/validations/digest.ts` with an optional
   `narrative` field).

## Performance & data-fetching budget (AGENTS.md #5)

- **First paint `/settings/ai`:** `UsageBreakdown` reads once server-side (`getUsageSummary`,
  admin-only, alongside the existing `getOrgAiSettings`/`buildModelOptions` reads already on that
  page). No client fetch on mount.
- **This-month/6-month toggle:** client state over the preloaded 6-month window — 0 new server
  round-trips.
- **Bounded/indexed:** both new RPCs scan `ai_usage_org_created_idx (org_id, created_at)` with an
  explicit `[from, to)` bound (`date_trunc('month')` grouping for the rollup; `>= date_trunc('month',
now())` for the per-feature breakdown) — no unbounded `select *`.
- **Narrative:** generated once per (org, week) inside the existing idempotent `digest_runs` claim,
  cached on the row — 0 per-recipient/per-view AI calls; rides the existing weekly cron, no new
  schedule.

## Testing

TDD throughout: RPC behavior via `PULSE_TEST_DB`-gated integration test (rolled-back txn, matching
`org_ai_settings.rls.integration.test.ts`'s pattern); `getUsageSummary` unit-tested with a mocked
`typedRpc`; `UsageBreakdown` render test with a fixture summary; `generateDigestNarrative` unit
tests for managed/org_byo/per_user/failure paths (mirrors the July plan's test list, still valid);
`render.test.ts` and `run.test.ts` extended for the narrative field.

## Out of scope

- Stripe/billing (F16) — separate, already-scoped E6 track, untouched here.
- Per-user (not just per-org) usage breakdown — `ai_usage.user_id` exists but a per-user view is a
  follow-up, not blocking this card.
- Any change to `ai_mode`/entitlement semantics — this is read-only surfacing of existing data.

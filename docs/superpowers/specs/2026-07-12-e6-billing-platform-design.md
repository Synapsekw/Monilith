# E6 — Billing & Platform (Phase 10 Batch 2) — Design Spec

**Date:** 2026-07-12
**Slug:** `e6-billing-platform`
**Status:** Spec drafted (scoping subagent), pending review
**Epic:** Phase 10 · E6 (parallel batch after E1)
**Depends on:** E1 (foundation) — merged on `develop` (`org_ai_settings`, `ai_usage`, gateway `resolveAiAdapter`/`runAi`, `getAiEntitlement`/`requireAiEntitlement`, `digest_runs` weekly digest).
**Scope docs:** `docs/superpowers/specs/2026-07-05-ai-platform-phase-10-scope.md`, ADR `vault/decisions/2026-07-05-decision-26-ai-platform-dual-billing.md`.

---

## 1. Why this epic

Pulse can meter and cap AI spend (E1: the `ai_usage` ledger + `org_ai_settings` entitlement + the `resolveAiAdapter`/`runAi` gateway), but there is **no way for a customer to pay** — the entitlement (tier + monthly credit ceiling) is set only by a platform operator from `src/app/admin/organizations/[id]` via `setOrgAiPlan`. Billing is fully greenfield: no Stripe SDK, no subscription table, no checkout, no webhook. E6 closes two gaps:

- **F16 — Stripe self-serve.** An org admin picks a plan, checks out through Stripe, and their subscription drives the same `org_ai_settings.tier` + `monthly_credit_limit` that E1 already reads. Managing/cancelling flows through the Stripe Billing Portal.
- **F17 — Usage dashboard + exec digest narrative.** Org admins see their spend vs. quota (rolled up from the `ai_usage` ledger over its `(org_id, created_at)` index), and the existing weekly `digest_runs` email gains an AI-written narrative paragraph — generated once per run, metered through the E1 gateway, cached on the run row.

Design stance carries over from the phase scope: **AI at the seams, calm/crisp, no glow.** Billing is a plain Settings surface; the narrative is one short paragraph atop an existing email, not a new AI product.

## 2. The core architectural seam (read this first)

E1 deliberately split **billing plane** from **entitlement plane**:

- `org_ai_settings` (`tier`, `monthly_credit_limit`, `ai_mode`) is the **entitlement read side**. `getAiEntitlement()` (`src/lib/ai/entitlement.ts`) and `resolveAiAdapter()` (`src/lib/ai/gateway.ts`) read it on every AI call. E2/E3/E4 all consume this read contract.
- Today `org_ai_settings` has exactly **two writers**, both service-role: `setOrgAiPlan` (platform admin) and `setAiMode`/`setOrgByoKey` (org admin, mode + BYO key only — deliberately _not_ tier/limit).

**F16 adds a third writer** — the Stripe webhook — that translates a subscription into `tier` + `monthly_credit_limit` + `ai_mode`. **Nothing on the read side changes.** The gateway, entitlement gate, ledger, and every downstream epic (E2–E5) keep reading `org_ai_settings` exactly as they do now. This is the whole point of E1's shape: monetization is a new _writer_, not a new _contract_. F16 must preserve it — no new field that `getAiEntitlement` must learn about; the subscription resolves to the existing three columns.

**F17 is purely additive** on the read side of the ledger and the write side of the digest — it introduces no new entitlement semantics.

## 3. F16 — Stripe self-serve subscriptions

### 3.1 Plan model — Stripe prices ↔ the existing tier enum

The tier enum is fixed by E1: `none | starter | pro | enterprise` (`setOrgAiPlanSchema` in `src/lib/validations/admin.ts`; `org_ai_settings.tier` default `'none'`). We do **not** invent new tiers.

Stripe holds the money objects (one **Product** per paid tier, each with one recurring monthly **Price**). Our app holds a **plan catalog** (`src/lib/stripe/plans.ts`) — the single source of truth mapping each tier to: its Stripe Price ID (read from env), its `monthlyCreditLimit` (the credit ceiling that tier grants), and display metadata (name, blurb, price label). The catalog is the bidirectional bridge:

- **Checkout** (tier → price): user picks `pro` → catalog yields the `pro` Price ID → Stripe Checkout.
- **Webhook** (price → tier + limit): a subscription event carries a Price ID → catalog reverse-lookup → the tier + credit limit to write into `org_ai_settings`.

**Approach chosen:** a config module keyed by env-provided Price IDs. Rejected alternatives: (A) a DB `billing_plans` table — YAGNI, tiers are static and code-reviewed; (B) hard-coding Price IDs in source — they differ per Stripe account/mode (test vs live) and are environment config, so they live in env. `starter`/`pro`/`enterprise` are paid; `none` is the unpaid floor (no Price).

### 3.2 Subscription state — new `org_subscriptions` table

Billing-plane state is **not** stored on `org_ai_settings` (that stays the lean entitlement projection). A new table records the Stripe relationship:

```
org_subscriptions
  org_id                 uuid PK  -> organizations(id) on delete cascade
  stripe_customer_id     text     -- reused across checkouts/portal
  stripe_subscription_id text
  status                 text     -- active | trialing | past_due | canceled | incomplete | ...
  price_id               text     -- the current Stripe Price (maps -> tier)
  tier                   text     -- resolved tier snapshot (audit/debug)
  current_period_end     timestamptz
  updated_at             timestamptz
```

- RLS: **service-role write only** (mirrors `digest_runs`: RLS on, no policies for the webhook writer). Org admins **read** their own row via a `SECURITY INVOKER` select policy gated on `has_org_role(org_id, ['owner','admin'])` so the billing UI can show current status.
- The webhook is the only writer; it **also** projects the resolved tier/limit/mode into `org_ai_settings` (service role) so the entitlement read side stays authoritative and unchanged.

Plus a **`stripe_webhook_events`** dedup table (`event_id text PK, type text, received_at timestamptz`) — Stripe delivers at-least-once and retries; we insert-on-conflict-do-nothing and skip already-seen events, so replays are idempotent.

### 3.3 Webhook → entitlement sync

Route handler: `src/app/api/stripe/webhook/route.ts` (Next.js 16 route handler — confirm the raw-body pattern against `node_modules/next/dist/docs/`).

1. **Signature verification** with `STRIPE_WEBHOOK_SECRET` over the **raw request body** (`await req.text()`, not parsed JSON — `stripe.webhooks.constructEvent(rawBody, sigHeader, secret)`). Reject with 400 on failure. Never trust the payload before this passes.
2. **Dedup** on `event.id` via `stripe_webhook_events` (insert; if conflict, 200 and return — already processed).
3. **Dispatch** the handled event set to a pure sync function (§3.4). Return 200 on success; a thrown error returns 500 so Stripe retries.

Handled events (v1, minimal): `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`. (`invoice.payment_failed` → status `past_due` is optional polish; keep the set small for v1.)

### 3.4 Sync core — a pure, unit-testable function

`src/lib/stripe/sync.ts` exports `applyStripeEvent(event, svc)` — takes an already-verified Stripe event + a service client, resolves org (via `client_reference_id`/`metadata.org_id` on checkout, or the `org_subscriptions.stripe_customer_id` lookup on subscription events), maps `price_id → tier + monthlyCreditLimit` via the plan catalog, and writes:

- `org_subscriptions` (upsert the customer/subscription/status/period).
- `org_ai_settings` (service role): on **active/trialing** → `tier`, `monthly_credit_limit`, and `ai_mode = 'managed'` (subscribing buys managed credits) **unless** the org is already `org_byo` (a BYO org keeping its own key isn't flipped — noted decision, §7). On **canceled/deleted** → revert `tier='none'`, `monthly_credit_limit=0`, and `ai_mode` back to `'per_user'` (fail-safe: no managed credits when unpaid).

Keeping signature-verify (route) separate from business logic (`applyStripeEvent`) is what makes the sync **testable without Stripe** — fixtures in, DB mutation out.

### 3.5 Checkout + Billing Portal (Server Actions)

`src/lib/stripe/checkout-actions.ts`:

- `createCheckoutSession(tier)` — org-admin-gated (reuse the `requireOrgAdmin()` pattern from `src/lib/ai/settings-actions.ts`). Create-or-reuse a Stripe Customer (persist `stripe_customer_id` on `org_subscriptions`), create a `mode:'subscription'` Checkout Session with `line_items:[{price, quantity:1}]`, `client_reference_id: orgId`, `metadata:{ org_id }`, and success/cancel URLs (`APP_BASE_URL` + `/settings`). Returns `{ url }`; the client does `window.location.assign(url)`.
- `createBillingPortalSession()` — org-admin-gated; returns a Stripe Billing Portal URL for the stored customer (manage/cancel/update card). Returns `{ url }`.

Both are **explicit user actions** (button clicks), never view toggles — see the perf budget (§6). Both return the canonical `ActionResult<{url}>` from `src/lib/actions/result.ts`.

### 3.6 Billing UI

An org-admin-only **Billing** card on `/settings` (a new `src/components/settings/BillingForm.tsx`, added to the settings masonry alongside the existing "AI — Organization" card). First paint reads `org_subscriptions` status + the plan catalog server-side; the card shows either a **plan picker** (Starter/Pro/Enterprise → "Subscribe" → `createCheckoutSession`) when unpaid, or **current plan + "Manage subscription"** (→ `createBillingPortalSession`) when active. Pure client interactivity beyond the two redirects is minimal. Follows the `pulse-ui` Keystone system (mono kickers, single periwinkle accent, radius-14 cards) — load `pulse-ui` + `frontend-design` before building.

### 3.7 Metering is already wired

F16 changes **who sets the ceiling**, not the meter. `requireAiEntitlement` (pre-spend gate) + `runAi` (post-call `record_ai_usage`) + `ai_credits_used_this_month` are untouched. A paying org simply has a non-zero `monthly_credit_limit` set by its subscription instead of by a platform operator. No change to `src/lib/ai/gateway.ts`, `entitlement.ts`, or `pricing.ts`.

## 4. F17 — Usage dashboard + exec digest narrative

### 4.1 Usage dashboard

Org admins see current spend vs. quota and a short history. Read side is the `ai_usage` ledger over its existing `ai_usage_org_created_idx (org_id, created_at desc)` index — **bounded, indexed, no unbounded scan**.

New SQL rollup function `ai_usage_summary(p_org uuid, p_from timestamptz, p_to timestamptz)` (`SECURITY DEFINER`, service-role only, mirroring the E1 function grants) returning per-**month** aggregates: `month`, `credits`, `cost_usd`, `calls`, plus a per-**feature** breakdown for the current month. Wrapped by `src/lib/ai/usage-summary.ts` (`getUsageSummary(orgId)`), typed via `typedRpc` where applicable.

UI: an org-admin **Usage** section — a card on `/settings` (or a small `/settings/usage` sub-view; recommend a card to match the existing masonry). Shows: current-month credits used / limit (from `getAiEntitlement`), a per-feature bar, and a last-6-months trend using the existing `recharts`/shadcn chart battery already in deps. First paint fetches the last 6 months in **one** indexed query; the month/range toggle operates on the **preloaded window in client state (0 server round-trips)**; only a request _beyond_ the preloaded window triggers a Server Action (see §6).

### 4.2 Exec digest narrative

The weekly digest (`src/lib/digest/run.ts` → `runWeeklyDigest` → `processOrg`) computes per-board `totals` and renders `renderDigestHtml`/`renderDigestText` (`src/lib/digest/render.ts`). F17 adds a **one-paragraph AI narrative** at the top of the digest.

- **Generated once per run**, inside `processOrg` after `totals`/`boards` are known, via a new `src/lib/digest/narrative.ts` (`generateDigestNarrative(orgId, boards, totals)`), which calls the E1 gateway `runAi({ orgId, userId, feature: 'digest_narrative' }, …)` with a privacy-safe snapshot (board names + counts only — same discipline as dashboard-gen; no raw cell values). The result is **stored on the run row** (new `digest_runs.narrative text` column) and passed to the renderers as an optional field — so it is computed **once per (org, week)** and read cheaply, never regenerated per recipient or per view. This satisfies the "on-demand/cached, not per-view" budget.
- **Entitlement + mode gating.** The narrative runs only when the org's AI is server-resolvable **without a session user** — i.e. `ai_mode ∈ { managed, org_byo }`. The digest cron runs as service role with **no session user**, and `resolveAiAdapter`'s `per_user` branch requires a cookie-bound session (`resolveUserAdapter`), so `per_user` and `off` orgs are **skipped** (plain digest, as today). For `managed`, `requireAiEntitlement` still applies (a quota-exhausted org is skipped). This is a clean, explicit rule.
- **Failure is non-fatal.** Narrative generation is wrapped in try/catch; any failure (quota, provider error, disabled) sets `narrative = null` and the digest renders and sends exactly as it does today. The digest send path must never break because of AI.

Renderers gain an optional `narrative?: string` on `DigestEmailInput`; when present it renders as a lead paragraph in both HTML and text.

## 5. File map (new + touched)

**F16 — new:**

- `src/lib/stripe/client.ts` — memoized Stripe SDK client from `STRIPE_SECRET_KEY` (server-only).
- `src/lib/stripe/plans.ts` — tier ↔ Price ID ↔ credit-limit catalog + reverse-lookup.
- `src/lib/stripe/sync.ts` — pure `applyStripeEvent(event, svc)`.
- `src/lib/stripe/checkout-actions.ts` — `createCheckoutSession`, `createBillingPortalSession` (Server Actions).
- `src/app/api/stripe/webhook/route.ts` — signature verify + dedup + dispatch.
- `src/components/settings/BillingForm.tsx` — billing card UI.
- `supabase/migrations/<stamp>_billing_subscriptions.sql` — `org_subscriptions` + `stripe_webhook_events` + RLS.

**F17 — new:**

- `src/lib/ai/usage-summary.ts` — `getUsageSummary(orgId)`.
- `src/components/settings/UsageDashboard.tsx` — usage card UI.
- `src/lib/digest/narrative.ts` — `generateDigestNarrative(...)`.
- `supabase/migrations/<stamp>_usage_summary_and_digest_narrative.sql` — `ai_usage_summary()` fn + `digest_runs.narrative` column.

**Touched:**

- `src/lib/env.server.ts` — add optional `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_ENTERPRISE` (all optional; absent → billing self-disables, like the digest today).
- `src/app/(app)/settings/page.tsx` — mount `BillingForm` + `UsageDashboard` for admins.
- `src/lib/digest/run.ts` (`processOrg`) — generate + persist narrative; pass to renderers.
- `src/lib/digest/render.ts` — optional `narrative` field in HTML + text.
- `src/types/database.types.ts` — regenerated after each migration.
- `package.json` — add `stripe`.

**Shared surfaces flagged for the cross-epic DAG:** `supabase/migrations/` (parallel-branch version collision — gotcha-43; mint via `scripts/new-migration.sh`), the `org_ai_settings` **write** path (F16 becomes a 3rd writer; read side unchanged for E2–E5), and `src/app/admin/` (platform `setOrgAiPlan` coexists with self-serve — §7).

## 6. Performance & data-fetching budget (AGENTS.md #5)

- **First paint** of `/settings` is unchanged: `BillingForm` + `UsageDashboard` read once server-side (subscription status; last-6-months usage rollup in one indexed query). No client data-fetch on mount.
- **Checkout / portal are explicit actions** — one Server Action per button click, ending in a full redirect to Stripe. Never a view toggle, never on tab/filter switch.
- **Usage range toggle** stays in **client state over the preloaded 6-month window (0 new server round-trips)**; History API (`replaceState`) if the range is URL-reflected — never a `<Link>`/router nav. Only a request _beyond_ the preloaded window triggers a Server Action.
- **Hot-path reads are bounded + indexed:** `ai_usage_summary` aggregates over `ai_usage_org_created_idx (org_id, created_at)` with an explicit `[from,to]` bound and `date_trunc('month')` grouping — no unbounded `select *`. The webhook writes are O(1) upserts keyed by `org_id`/`event_id`.
- **Digest narrative is generated once per (org, week)** inside the existing idempotent `digest_runs` claim and **cached on the row** — zero per-recipient or per-view AI calls. It rides the existing weekly cron; no new schedule, no new standing service.

## 7. Open decisions to confirm (surface to the user)

1. **External Stripe dependencies (hard blocker — see §8).** Cannot be resolved in code.
2. **Does a subscription force `ai_mode = 'managed'`?** Recommended: yes on activation (unless already `org_byo`), revert to `per_user` on cancel. Alternative: leave `ai_mode` untouched and only set tier/limit (like `setOrgAiPlan` does today) — but then a subscriber in `per_user` mode wouldn't actually use their purchased managed credits. Recommend the former.
3. **Self-serve vs. platform-admin precedence.** Both `setOrgAiPlan` (comped/manual) and the Stripe webhook write `org_ai_settings.tier`/`limit`. v1: last-writer-wins; a manual grant on a Stripe-subscribed org is overwritten on the next subscription event. Document that manual grants are for **comped/non-paying** orgs. (A `source` flag to make manual grants sticky is a possible v2 — YAGNI now.)
4. **BYO orgs + subscriptions.** v1: a BYO org can still subscribe (e.g. for a support/seat tier) but the subscription does **not** flip them off their own key. Their `monthly_credit_limit` from us is moot (BYO is uncapped by us). Recommend: allow subscribe, don't change `ai_mode`, don't cap.
5. **Enterprise = self-serve or sales-assist?** v1: treat `enterprise` as a normal self-serve Price for simplicity. If it should be "contact us", drop it from the picker — trivial catalog change.

## 8. External dependencies — BUILD BLOCKER (user must provide)

**F16 cannot run end-to-end without all of the following. The code (and unit/integration tests with a mocked/injected Stripe client) can be fully built and merged, but a real checkout is impossible until these exist:**

1. **A Stripe account** (test mode is enough for development).
2. **Products + Prices created in Stripe** — one recurring monthly Price per paid tier (`starter`, `pro`, `enterprise`).
3. **Environment variables** in `.env.local` (DEV) and Vercel (Preview + Production):
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_ENTERPRISE`
4. **A registered webhook endpoint** in the Stripe dashboard pointing at `https://<app>/api/stripe/webhook`, subscribed to `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted` (and optionally `invoice.payment_failed`). For local dev, `stripe listen --forward-to localhost:3000/api/stripe/webhook` provides a signing secret.

Until these are provided, billing **self-disables** the same way the digest does when `DIGEST_SECRET` is absent: env vars are `optional()`; the checkout actions and webhook return a clear "billing not configured" result/503, and the Billing card renders a "billing unavailable" state. CI and boot stay green without any Stripe secret. **F17 has no external dependency** — it reuses the E1 Anthropic key already in the env and the existing digest cron.

## 9. Parallelization plan (AGENTS.md #6)

E6 is a **single worktree** (`task/e6-billing`) — F16 and F17 share the migrations surface, the settings page, and the env module, so they live together. Internally the tasks fan out; the full Execution DAG (dependency graph, parallel batches, critical path) is in the implementation plan `docs/superpowers/plans/2026-07-12-e6-billing-platform.md`. F16 and F17 are **independent feature tracks** that only converge at the shared `settings/page.tsx` mount and the type-regen after migrations — they can be built by concurrent subagents.

## 10. Testing strategy

- **Stripe sync (`applyStripeEvent`)** — unit-tested with hand-built Stripe event fixtures (checkout completed / subscription updated / deleted) against a fake/injected service client; asserts the exact `org_subscriptions` + `org_ai_settings` mutations, including the cancel→revert and the `org_byo` no-flip rule.
- **Signature verification** — tested with the Stripe SDK's `stripe.webhooks.generateTestHeaderString` + a known test secret (valid → parsed event; tampered → throws) so the route's verify branch is covered without a live endpoint. Dedup tested by replaying the same `event.id` twice.
- **Checkout actions** — the Stripe client is injected/mocked; assert customer create-or-reuse, session params (`client_reference_id`, `metadata.org_id`, price), and admin gating.
- **Plan catalog** — round-trip: tier → price → tier; unknown price → null.
- **Usage summary** — unit test the rollup shape; opt-in integration test (DEV, rolled-back txn, `PULSE_TEST_DB`) that inserts ledger rows and asserts monthly/feature aggregates over the index.
- **Digest narrative** — unit test the gating rule (managed/byo → generate; per_user/off → skip; failure → null) with a mocked `runAi`; assert the digest still sends when narrative throws.
- **Full gate:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` — the mandatory closure gate. No live Stripe calls in CI.

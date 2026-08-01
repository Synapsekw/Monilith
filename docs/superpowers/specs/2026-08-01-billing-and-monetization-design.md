# Billing & monetization — design

- **Date:** 2026-08-01
- **Status:** approved (design), plan pending
- **Depends on:** `2026-08-01-ai-cogs-reduction-design.md` — the price points below assume
  the post-fix unit economics. Also blocked on Stripe API credentials (Phase 10 E6).

## Context

Monolith has no way to take money. Billing is greenfield: no Stripe, no plan column, no
subscription state. What _does_ exist, shipped and tested in Phase 10 E1, is the entire
AI entitlement layer — `resolveAiAdapter` as a single chokepoint over four `ai_mode`
values, an `ai_usage` ledger with per-org monthly credit accounting, `requireAiEntitlement`
failing closed with typed errors, and `setOrgAiPlan` in the platform admin console.

That machinery already implements the feature gate. This spec adds the commercial layer
on top of it: what the tiers are, how customers buy, and how Stripe state flows back into
`org_ai_settings`.

**Cost structure, which is what makes the tiering non-arbitrary.** Infrastructure is
Supabase Pro ($25/mo) plus Vercel Pro ($20/mo with a $20 usage credit); at current scale
(22 orgs, 447 items, 59 MB) and for a long way beyond it, that is roughly **$0.25 per
user per month** — a rounding error. AI is **~95% of marginal COGS**, at $1.70–8.40 per
user per month after the COGS work. The product therefore splits cleanly into a
near-zero-COGS Work OS and a genuinely expensive AI layer, and the pricing follows that
seam rather than inventing one.

**Market band.** ClickUp $7/$12/$19 with a $5–7 Brain add-on; Monday $9/$12/$19 annual
with a 3-seat minimum and 3→5→10→15 seat buckets; Asana $10.99 base with AI only at
Advanced ($24.99); Notion ~$10–12 with AI bundled. Full Work OS lands at **$8–20/seat**,
and the prevailing 2026 pattern for AI is hybrid — a seat floor plus a metered allowance —
because flat per-seat collapses when one power user burns 50× the tokens of an average one.

## Goal

Ship self-serve subscription billing for two tiers, a card-gated trial, and
platform-admin discount codes — without changing any AI entitlement semantics.

## Non-goals (v1)

- **Self-serve credit top-ups.** Credit exhaustion is a hard stop; a platform admin
  raises the ceiling via the existing `setOrgAiPlan`. Build top-ups once there is
  evidence of how often the wall is actually hit.
- SSO, usage-based invoicing, multi-currency, per-seat (rather than pooled) allowances.
- **BYO as a product surface.** `org_byo` and `per_user` stay in the codebase and remain
  reachable by admin action for Enterprise exceptions; they are not sold, not documented,
  and get no UI.
- Dunning email sequences. Stripe's built-in retry schedule and hosted emails suffice.

## Commercial design

### Tiers

| Tier           | Annual                    | Monthly     | AI                                                   |
| -------------- | ------------------------- | ----------- | ---------------------------------------------------- |
| **Core**       | **$10/user/mo** ($120/yr) | $12/user/mo | none                                                 |
| **Pulse**      | **$24/user/mo** ($288/yr) | $29/user/mo | all AI + **500 credits/seat/month**, pooled org-wide |
| **Enterprise** | custom                    | custom      | custom ceiling, SSO, BYO by exception                |

Core includes the entire non-AI product: all views, automations, dashboards, portfolios,
goals, workload, time tracking, reports, import/export, sharing, semantic-search-free
search. Its marginal cost is ~$0.25/user/month — a **97% gross margin**.

Pulse's $14 delta is the AI price. 500 credits = **$5 of our spend** (1 credit = $0.01,
already the shipped convention) ≈ **62 Asks per seat per month** at post-COGS-work rates.
Worst case, if an org burns its entire allowance every month, the AI line runs at **64%
margin**; at a realistic 20% burn it is **93%**. The allowance is deliberately sized well
above expected use and well below the price, which is the only configuration that is both
generous-feeling and safe.

**Annual is 2 months free** — that is the $10-vs-$12 and $24-vs-$29 spread, not a separate
discount to administer.

**No seat minimum and no seat buckets.** Monday's 3-seat floor and bucket jumps are the
single most-criticized aspect of its pricing in every comparison write-up. Charging for
exactly the seats in use costs us nothing and is a real differentiator.

### Trial

**14 days of Pulse, card required up front, auto-converts on day 15.** Show the whole
product; let them downgrade to Core at conversion if they decide AI isn't for them.

The trial carries a **one-time 500-credit grant for the org** — the same magnitude as one
Pulse seat's monthly allowance, so the mental model transfers at conversion.

Stripe's `trial_period_days` with a collected payment method handles the entire
trial→paid transition natively. There is **no custom trial state machine** to build,
schedule, or test.

> **Known leak, accepted.** `ai_credits_used_this_month(p_org)` sums by **calendar
> month**. A trial starting 25 August receives 500 credits in August and a fresh 500 on
> 1 September. Exposure is bounded at **$10 of COGS per trial org**, and the card
> requirement removes the abuse vector that would make it matter. Revisit only if trial
> credit burn shows up as a real cost line.

### Lifecycle

- Seat changes prorate (Stripe default); the org credit pool recomputes as `seats × 500`.
- On cancellation or terminal payment failure: **30-day read-only grace with export
  enabled**, then suspend. **Never delete on lapse** — losing a customer's data over a
  declined card is an unrecoverable trust failure for a Work OS.
- Credit exhaustion is a soft wall: notify at 80%, hard stop at 100% via the existing
  `AiQuotaExceededError`. **Non-AI features keep working.** Running out of AI credits must
  never block someone from updating a task.

`requireAiEntitlement` is documented as check-then-spend and explicitly non-atomic
(`entitlement.ts:42-43`) — concurrent calls can overshoot the ceiling. With real money
attached this is worth stating precisely rather than fixing: the overshoot is bounded by
`max concurrent calls × cost per call`, roughly **$1–2 worst case**, not unbounded. The
ledger sum remains the source of truth. Leave as-is.

## Entitlement mapping — the gate already exists

| Tier           | `org_ai_settings.ai_mode` | `tier`        | `monthly_credit_limit` |
| -------------- | ------------------------- | ------------- | ---------------------- |
| Core           | `off`                     | `core`        | 0                      |
| Pulse          | `managed`                 | `pulse`       | `seats × 500`          |
| Trial          | `managed`                 | `trial`       | 500                    |
| Enterprise     | `managed` (or `org_byo`)  | `enterprise`  | admin-set              |
| Lapsed / grace | `off`                     | previous tier | 0                      |

`requireAiEntitlement` already throws `AiDisabledError` on `off` and `AiQuotaExceededError`
on an exhausted managed ceiling. **There is no second gating layer to build** — Core is
simply an org whose `ai_mode` is `off`.

**One default has to change, and it has blast radius.** `DEFAULT_ORG_AI_SETTINGS` is
`mode: "per_user"` (`org-settings.ts:17-23`) — an org with no row today gets "members use
their own keys." Under a managed-only model the default for an unpaid or lapsed org must
be `off`. Changing the constant alone would silently flip behaviour for every org that
has no row. The migration must **write explicit rows** for all existing orgs at their
intended mode, and only then may the fallback change.

## Stripe architecture

**Objects.** Two Products (`Monolith Core`, `Monolith Pulse`), each with a monthly and an
annual recurring Price. One Stripe Customer per organization. One Subscription per
organization, with `quantity` = active seat count.

**Checkout.** `mode: "subscription"`, `quantity: seats`, `trial_period_days: 14` on first
subscription, and — required — **`payment_method_collection: "always"`**. Stripe skips
card collection whenever the first invoice is $0, which both a trial and a 100% discount
code produce; without this flag those accounts end up with no card on file and no way to
charge when the trial or coupon ends.

**Billing Portal.** Stripe's hosted portal handles card updates, plan changes,
cancellation, and invoice history. Cheap to wire, and it removes an entire category of UI
from scope.

**Webhook route.** `src/app/api/stripe/webhook/route.ts`, a Route Handler (not a Server
Action — signature verification needs the raw body via `await request.text()`), verifying
`stripe-signature`, then writing via the service-role client.

Events handled:

| event                                        | effect                                                                            |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| `checkout.session.completed`                 | link Stripe customer ↔ org; create `org_billing` row                              |
| `customer.subscription.created` / `.updated` | set tier, status, seats, period end; recompute `ai_mode` + `monthly_credit_limit` |
| `customer.subscription.deleted`              | enter grace: `ai_mode = off`, set `grace_ends_at`                                 |
| `invoice.paid`                               | clear `past_due`, clear grace                                                     |
| `invoice.payment_failed`                     | mark `past_due`; on terminal failure enter grace                                  |

Repo-specific traps that apply here:

- **The webhook route is public and must be registered in `src/proxy.ts`.** An unregistered
  public route gets caught by the auth gate and Stripe sees a redirect
  (`2026-06-17-gotcha-12`).
- **Webhook handlers must be idempotent.** Stripe retries; every handler keys on the
  Stripe object ID and is safe to replay.
- **Any checkout return page that reads `searchParams` must wrap the read in a `<Suspense>`
  child**, or `next build` fails with a cacheComponents "Uncached data outside `<Suspense>`"
  error while typecheck, lint, and unit tests all pass. This is a build-only trap and has
  bitten this repo before.
- The Stripe SDK helper is a **plain module**, not `"use server"` — a non-async export from
  a `"use server"` module passes typecheck, lint, and test and fails only `pnpm build`.

**Seat sync.** Membership changes (invite accepted, member deactivated, member removed)
push `quantity` to Stripe and recompute the credit pool. `getUserOrgs` filters deactivated
members but the roster cache does not (`2026-07-07-gotcha-53`) — the seat count must be
derived from the same authoritative query the billing side uses, not from a cached roster.

## Discount codes (platform admin)

Platform admins generate single-use codes, up to 100% off, valid on monthly and annual.

**Build on Stripe Coupons + Promotion Codes; mirror locally.** A Coupon carries the
discount, a Promotion Code is the customer-facing string wrapping it with native
`max_redemptions`, `expires_at`, and redemption tracking. Reimplementing redemption,
proration, and invoice math would be a large and permanently-wrong subsystem.

### The monthly-vs-annual trap

Stripe coupon `duration` is `once` / `repeating (N months)` / `forever`. On a monthly plan
`once` means one month free; **on an annual plan the identical coupon means a whole year
free** — 12× the giveaway from the same admin click. Therefore:

- **`once` is never exposed.** Duration is expressed in months, or forever.
- Durations in multiples of 12 are cadence-safe: "50% off for 12 months" costs the same
  either way.
- Sub-12-month durations are recorded as **monthly-only** (`applies_to_cadence`), and the
  checkout action refuses to apply them to an annual price. Otherwise "1 month free"
  silently becomes a free year.
- The admin UI **displays the computed cash value on both cadences before confirm.** It
  must not be possible to give away $288 believing you gave away $24.

### 100% off

Two specific requirements:

1. `payment_method_collection: "always"` (as above) — otherwise a comped account has no
   card and cannot be charged when the coupon ends.
2. The confirm dialog states the **AI cost that is not comped**. A 100%-off Pulse seat
   still costs ~$5/month in AI credits. Comping revenue does not comp COGS, and that is
   precisely the number nobody recalls at the moment of clicking.

### Schema — `billing_discount_codes`

`code` (unique), `stripe_coupon_id`, `stripe_promotion_code_id`, `percent_off` (1–100),
`duration` (`repeating` | `forever`), `duration_in_months`, `applies_to_cadence`
(`monthly` | `annual` | `both`), `plan_restriction` (`core` | `pulse` | null),
`max_redemptions` (default **1** — the single-recipient case), `times_redeemed`,
`expires_at`, `created_by`, `note` (who it's for and why), `redeemed_by_org_id`,
`redeemed_at`, `revoked_at`.

**Code format:** `MONO-XXXX-XXXX` from an alphabet excluding `0/O` and `1/I/l` — these get
read aloud and typed by hand. Generated server-side, collision-checked against the unique
index.

**Delivery:** the admin screen renders the code plus a **pre-applied checkout link** with
a copy button. No email in v1 — production has no `RESEND_API_KEY`, so an email path would
be dead on arrival.

### Server actions

Three new actions in `src/lib/platform/actions.ts`, alongside the seven already there,
each gated by `isPlatformAdmin()`, each returning `ActionResult` via `fail()` from
`src/lib/actions/result.ts`, each writing `admin_audit_log`:

- `createDiscountCode(input: unknown): Promise<ActionResult>`
- `revokeDiscountCode(input: unknown): Promise<ActionResult>`
- `listDiscountCodes(input: unknown): Promise<ActionResult>`

Zod validation at the boundary, mirroring `setOrgAiPlan` (`platform/actions.ts:49`).

## Security

**Both new tables are deny-all to `authenticated` and `anon`.** `org_billing` carries
Stripe customer and subscription IDs; `billing_discount_codes` is, in effect, free money.
Neither is tenant-readable under any policy. Platform-admin reads go through
`SECURITY DEFINER` RPCs gated on `is_platform_admin()`, matching the existing platform
RPC pattern; org-scoped billing status reaches the org's own settings page through a
narrow definer function returning tier, status, seats, and period end — never Stripe IDs.

`pnpm test:conformance` enumerates every function signature and table with empty
allow-lists, so both tables and every new RPC are picked up automatically. The suite will
fail if either is reachable — which is the intended behaviour, not something to configure
around.

`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are server-only and validated in the
existing `env.server` boot check. Note that adding required env vars there **500s any
`next start` / Lighthouse CI job that lacks them** while passing every local gate — so
they go in as optional-with-runtime-check, or CI gets the placeholders.

## Performance & data-fetching budget

- **Pricing page.** Static marketing surface. The monthly/annual toggle is **client state
  with zero server round-trips**; if it needs to be linkable, `window.history.replaceState`
  — never a `<Link>` or `router` navigation, which re-runs every query in the page
  (`2026-06-16-gotcha-09`).
- **Org billing settings page.** One bounded read of `org_billing` on first paint via the
  definer RPC. Plan changes and card updates redirect to Stripe's hosted portal, so there
  is no in-page mutation surface to budget for.
- **Admin discount-code list.** Bounded page of 50, ordered by `created_at desc` over an
  index on `(created_at desc)`. Filters (active / redeemed / revoked) are client-side over
  the loaded page — no refetch. No unbounded `select *`.
- **Hot paths untouched.** No billing read enters the board payload, the AI request path,
  or any per-request auth check. Entitlement continues to read `org_ai_settings` exactly
  as today.

## Testing

- **Unit — webhook mapping:** each of the five events produces the correct
  `(ai_mode, tier, monthly_credit_limit, status)` tuple; replaying an event is a no-op.
- **Unit — seat→pool arithmetic:** `monthly_credit_limit === seats × 500` across seat
  changes, and 0 on Core, grace, and lapsed.
- **Unit — discount duration guard:** a sub-12-month code rejected against an annual
  price; a 12-month code accepted on both; `once` unrepresentable in the input type.
- **Unit — code generation:** no ambiguous characters; collision retry.
- **Integration (Tier 2 fixtures) — RLS:** a non-privileged authenticated user cannot
  select from `org_billing` or `billing_discount_codes` for their own org or any other,
  and cannot execute the platform definer RPCs.
- **Conformance (Tier 3, anon):** both tables and all new RPCs unreachable, allow-lists
  empty.
- **Manual, against Stripe test mode:** trial signup with card → auto-conversion; a 100%
  forever code → subscription created _with_ a payment method attached; payment failure →
  grace → read-only; cancellation → export still works.

Gates: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, plus `pnpm db:ledger-check`.

## Independent units (for the execution DAG)

- **A — schema + entitlement mapping.** `org_billing`, `billing_discount_codes`, RLS,
  definer RPCs, the `DEFAULT_ORG_AI_SETTINGS` change and its backfill migration.
- **B — Stripe client + checkout + portal actions.** Depends on A.
- **C — webhook route + seat sync.** Depends on A and B.
- **D — pricing page + org billing settings UI.** Depends on A; parallel with B and C.
- **E — admin discount-code screen + three server actions.** Depends on A and B.

Critical path: **A → B → C**. D runs parallel from A. E joins after B. Nothing in this
spec may start before the COGS spec's unit B (cache-aware pricing) has merged — the
credit ceiling is the mechanism this entire design relies on, and it is not accurate
until then.

## Open dependency

Stripe API credentials are not yet provisioned. Units A and D can be built and merged
without them; B, C, and E need at minimum a Stripe **test-mode** key to be verifiable.
Until then, `setOrgAiPlan` in the platform console remains the way to grant a paid tier —
which was the explicit intent of decision-26 §4, so revenue is not blocked on this spec
completing.

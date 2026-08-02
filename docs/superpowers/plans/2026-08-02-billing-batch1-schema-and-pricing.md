# Billing batch 1 — schema, entitlement mapping, and the public pricing page

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the two billing units that need no Stripe credentials — Unit A (billing schema, tier vocabulary, entitlement mapping, and the `setAiMode` self-grant fix) and Unit D (the public `/pricing` page and landing teaser) — so the Stripe-dependent units have a root to build on and the pricing page is live before credentials arrive.

**Architecture:** Two deny-all tables (`org_billing`, `billing_discount_codes`) written only by the service role, read by the org through one narrow `SECURITY DEFINER` RPC that never returns Stripe IDs. The entitlement gate is **not** rebuilt — `requireAiEntitlement` already fails closed on `ai_mode = 'off'`; this plan only changes what _sets_ that mode: it stops being customer-chosen and starts being subscription-derived. The pricing page is a fully static Server Component with one client leaf (the cadence toggle) and zero server round-trips on interaction.

**Tech Stack:** Next.js 16 App Router (RSC + Server Actions), Supabase Postgres + RLS, Zod, Vitest, Tailwind v4 + shadcn primitives (Monolith Keystone tokens).

**Source spec:** `docs/superpowers/specs/2026-08-01-billing-and-monetization-design.md` — units **A** and **D** of its execution DAG (batch 1). Units B, C, E, F, G, H are deliberately out of scope; they need at minimum a Stripe test-mode key to be verifiable and get their own plan.

## Global Constraints

- **Server Components by default.** Exactly two modules carry `"use client"`: `billing-cadence-toggle.tsx` and `pricing-table.tsx` (which holds the cadence state). Everything else on `/pricing` renders on the server. All mutations are Server Actions returning `ActionResult` from `src/lib/actions/result.ts` — never a locally re-declared result shape.
- **Migrations are minted only via `scripts/new-migration.sh <slug>`.** Never hand-write a version stamp. Apply to DEV via the `supabase-dev` MCP `apply_migration` passing the **full stamped filename** as `name`, then verify with `pnpm db:ledger-check`.
- **After any migration, regenerate types** with `pnpm db:types` from the **main checkout** and commit `src/types/database.types.ts` in the same commit. Verify the file is non-empty and ends in TypeScript before committing — a broken regen silently truncates it.
- **RLS is the security boundary.** Both new tables are deny-all to `authenticated` and `anon`. `ANON_REACHABLE_TABLE_ALLOWLIST` and `ANON_REACHABLE_FUNCTION_ALLOWLIST` in `src/test/anon-conformance.ts` are empty by design and **must stay empty**.
- **Definer functions must have their PUBLIC grant stripped**: `revoke all on function ... from public, anon;` then `grant execute ... to authenticated;`. This is the pattern in `20260725102610_definer_acl_lockdown.sql`.
- **`/pricing` must be registered as a public route in `src/proxy.ts`** — both in `PUBLIC_ROUTES` and in the `config.matcher` exclusion, mirroring `/updates` exactly. An unregistered public route hits the auth gate and 307s to `/login`.
- **Do not add the pricing section to `src/components/landing/landing-sections.tsx`.** That file is at 837 lines against a deliberately-retained 800-line `max-lines` tripwire. Ship `src/components/landing/pricing-section.tsx` as a new file.
- **UI work requires the design skills** — load `pulse-ui` and `example-skills:frontend-design` before writing any component in Tasks 7–9. Monochrome chrome, periwinkle for primary/focus only, hairlines that brighten rather than thicken, `rounded-lg` panels / `rounded-sm` chips.
- **Never colour alone.** Any tone-carrying element pairs colour with text (AA + colourblind).
- **Coarse pointers get 44px targets** (`pointer-coarse:` variants) — this is an iPad-optimized app.
- **Commit identity is pinned** to `Danijel Jovanovic <info@synapse-solutions.ai>`. Commit subjects are **lowercase** after `type(scope):` or husky rejects. Every commit needs a descriptive body plus the `Co-Authored-By` trailer.
- **Stage explicitly by path.** Never `git add -A` / `git add .` / `git commit -a`.
- Gates for every task: `pnpm typecheck && pnpm lint && pnpm test`. Gates for the whole plan additionally: `pnpm build` and `pnpm db:ledger-check`.

## Live-data facts this plan depends on (verified against DEV, 2026-08-02)

Queried directly, because Task 4 changes behaviour for real users:

| Fact                       | Value                |
| -------------------------- | -------------------- |
| Organizations              | **22**               |
| `org_ai_settings` rows     | **0**                |
| Orgs with no settings row  | **22** (all of them) |
| `user_ai_credentials` rows | **1**                |

**Consequences, and they matter:**

1. **Every org today runs on `DEFAULT_ORG_AI_SETTINGS`** — the constant, not a row. Flipping that constant to `off` without a backfill would disable AI for all 22 orgs at once, including the one user with a BYO key. Task 4 therefore writes 22 explicit `per_user` rows **first**, in the same migration, and only then may the constant change.
2. **No tier data exists**, so the tier vocabulary change in Task 1 has zero rows to migrate. `starter` and `pro` appear only in `src/components/admin/OrgAiPlanForm.tsx`, `src/lib/validations/admin.ts`, and test fixtures.
3. **After Task 4, newly-created orgs default to `off`** — a new signup gets no AI until an operator grants it. That is the intended commercial behaviour, and until Unit B (checkout) ships, `setOrgAiPlan` in the platform console is the grant path, exactly as the spec's "Open dependency" section states. **Flag this to the user at merge time** — signup is currently open.

## File structure

| File                                                       | Responsibility                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `supabase/migrations/<stamp>_billing_schema.sql`           | **Create:** `org_billing`, `billing_discount_codes`, deny-all RLS, indexes, `get_org_billing_status` definer RPC                                                                                                                                                                     |
| `supabase/migrations/<stamp>_org_ai_settings_backfill.sql` | **Create:** explicit `per_user` rows for every existing org, so the constant may flip                                                                                                                                                                                                |
| `src/lib/billing/tiers.ts`                                 | **Create:** the single source of truth for tier names, prices, credit allowance, and feature lists. **Zero imports** — it is the leaf of the billing module graph. Imported by the pricing page, the landing teaser, `entitling.ts`, and (later) checkout. No React, no server-only. |
| `src/lib/billing/entitling.ts`                             | **Create:** pure mapping — which billing statuses entitle AI, and `creditLimitFor(tier, seats)`. Pure functions, no I/O, so it is trivially unit-testable and reusable by the webhook in Unit C. Imports the allowance constant from `tiers.ts` rather than restating it.            |
| `src/lib/billing/status.ts`                                | **Create:** `server-only` read of `get_org_billing_status` for the calling org                                                                                                                                                                                                       |
| `src/lib/ai/org-settings.ts`                               | **Modify:** `DEFAULT_ORG_AI_SETTINGS.mode` → `"off"`                                                                                                                                                                                                                                 |
| `src/lib/ai/settings-actions.ts`                           | **Modify:** `setAiMode` rejects `managed` without an entitling subscription; zeroes the ceiling on `off`                                                                                                                                                                             |
| `src/lib/validations/admin.ts`                             | **Modify:** tier enum → the billing vocabulary                                                                                                                                                                                                                                       |
| `src/components/admin/OrgAiPlanForm.tsx`                   | **Modify:** the `TIERS` array must match the Zod enum                                                                                                                                                                                                                                |
| `src/components/billing/pricing-tier-card.tsx`             | **Create:** one tier card. No directive — pure presentation over props, so it works on either side of the boundary                                                                                                                                                                   |
| `src/components/billing/billing-cadence-toggle.tsx`        | **Create:** `"use client"` — the segmented monthly/annual control                                                                                                                                                                                                                    |
| `src/components/billing/pricing-table.tsx`                 | **Create:** `"use client"` — holds the cadence state and composes the toggle + three cards                                                                                                                                                                                           |
| `src/components/billing/pricing-comparison.tsx`            | **Create:** feature comparison table. Server Component, mounted by the page (not nested in the client subtree) so it never ships                                                                                                                                                     |
| `src/components/billing/pricing-faq.tsx`                   | **Create:** FAQ over native `<details>`. Server Component, no JavaScript                                                                                                                                                                                                             |
| `src/app/pricing/page.tsx`                                 | **Create:** the public route                                                                                                                                                                                                                                                         |
| `src/components/landing/pricing-section.tsx`               | **Create:** the compact landing teaser (new file — see the `max-lines` constraint)                                                                                                                                                                                                   |
| `src/components/landing/monolith-hero.tsx`                 | **Modify:** mount the teaser, add the footer link                                                                                                                                                                                                                                    |
| `src/components/landing/landing-nav.tsx`                   | **Modify:** add the "Pricing" nav link                                                                                                                                                                                                                                               |
| `src/proxy.ts`                                             | **Modify:** register `/pricing` as public in both places                                                                                                                                                                                                                             |
| `src/test/billing-rls.integration.test.ts`                 | **Create:** Tier 2 fixture proof that neither table is tenant-readable                                                                                                                                                                                                               |

---

## Execution DAG

| Task                            | Depends on                                                               | Unit |
| ------------------------------- | ------------------------------------------------------------------------ | ---- |
| 1 — tier vocabulary             | —                                                                        | A    |
| 2 — billing schema migration    | 1 (shares the tier check constraint)                                     | A    |
| 3 — types + billing read module | 2, **7** (`entitling.ts` imports the allowance constant from `tiers.ts`) | A    |
| 4 — backfill + default flip     | 3                                                                        | A    |
| 5 — `setAiMode` guard           | 3, 4                                                                     | A    |
| 6 — RLS + conformance proof     | 2                                                                        | A    |
| 7 — tier data + card + toggle   | —                                                                        | D    |
| 8 — `/pricing` route + proxy    | 7                                                                        | D    |
| 9 — landing teaser + nav/footer | 7                                                                        | D    |

**Parallel batches:**

| batch | tasks               | note                                                                      |
| ----- | ------------------- | ------------------------------------------------------------------------- |
| 1     | **1**, **7**        | no dependencies; 7 touches only new files under `src/components/billing/` |
| 2     | **2**, **8**, **9** | 8 and 9 both unblock on 7 and touch disjoint files                        |
| 3     | **3**, **6**        | both unblock on 2; 3's second dependency (7) also cleared in batch 1      |
| 4     | **4**               | needs 3                                                                   |
| 5     | **5**               | needs 4                                                                   |

Critical path: **1 → 2 → 3 → 4 → 5** (five waves). The entire D column (7 → 8/9) is off the critical path and finishes in two waves.

**Worktree note:** Tasks 1–6 and 7–9 modify disjoint file sets except for nothing at all — the two columns share no file. If dispatched as parallel agents, they may share one worktree safely. Task 2 and Task 4 both apply migrations to shared DEV and must **not** run concurrently with each other.

---

### Task 1: Tier vocabulary — replace `starter`/`pro` with the billing tiers

The tier column is the join between the platform-admin grant path and the subscription. It currently speaks a vocabulary (`starter`, `pro`) that the billing design does not use. With zero rows in `org_ai_settings` (see live-data facts), this is a pure code change with no data migration.

**Files:**

- Modify: `src/lib/validations/admin.ts:38-43`
- Modify: `src/components/admin/OrgAiPlanForm.tsx:13`
- Modify: `src/lib/ai/entitlement.test.ts:16,57`
- Modify: `src/lib/ai/org-settings.test.ts:28,39`
- Modify: `src/lib/platform/actions.test.ts:125,135,142`
- Test: `src/lib/validations/admin.test.ts` (create if absent)

**Interfaces:**

- Consumes: nothing.
- Produces: `setOrgAiPlanSchema` accepting `tier: "none" | "core" | "pulse" | "trial" | "enterprise"`. Task 2's `org_billing.tier` check constraint uses the same five values.

- [ ] **Step 1: Write the failing test**

Create or extend `src/lib/validations/admin.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { setOrgAiPlanSchema } from "@/lib/validations/admin";

const ORG = "00000000-0000-4000-8000-000000000001";

describe("setOrgAiPlanSchema tier vocabulary", () => {
  it("accepts every billing tier", () => {
    for (const tier of ["none", "core", "pulse", "trial", "enterprise"]) {
      const r = setOrgAiPlanSchema.safeParse({
        orgId: ORG,
        tier,
        monthlyCreditLimit: 500,
      });
      expect(r.success, `${tier} should parse`).toBe(true);
    }
  });

  it("rejects the retired pre-billing tiers", () => {
    for (const tier of ["starter", "pro"]) {
      const r = setOrgAiPlanSchema.safeParse({
        orgId: ORG,
        tier,
        monthlyCreditLimit: 500,
      });
      expect(r.success, `${tier} should be rejected`).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run --project unit src/lib/validations/admin.test.ts`
Expected: FAIL — `"core"` is rejected by the current enum, and `"starter"` is accepted.

- [ ] **Step 3: Change the enum**

In `src/lib/validations/admin.ts`, replace lines 36–43:

```ts
// Platform: grant an org's AI allowance (tier + monthly credit ceiling). This is
// the operator-controlled entitlement only — `ai_mode` stays with the org admin.
//
// The vocabulary is the billing design's, not a free label: `core` = no AI,
// `pulse` = the metered AI tier, `trial` = the 14-day grant, `enterprise` =
// admin-set ceiling. `none` remains for an org with no plan at all. It must stay
// in lockstep with `org_billing.tier`'s check constraint and with the TIERS
// array in OrgAiPlanForm.
export const setOrgAiPlanSchema = z.object({
  orgId: z.string().uuid(),
  tier: z.enum(["none", "core", "pulse", "trial", "enterprise"]),
  monthlyCreditLimit: z.number().int().min(0).max(1_000_000),
});
export type SetOrgAiPlanInput = z.infer<typeof setOrgAiPlanSchema>;
```

- [ ] **Step 4: Update the admin form**

In `src/components/admin/OrgAiPlanForm.tsx`, line 13:

```ts
// Must match setOrgAiPlanSchema's enum exactly — a value here that the schema
// rejects surfaces as a generic "Invalid input" with no clue which field.
const TIERS = ["none", "core", "pulse", "trial", "enterprise"] as const;
```

- [ ] **Step 5: Update the test fixtures that hardcode `"pro"`**

Replace `tier: "pro"` with `tier: "pulse"` at every site listed under **Files** above. These are fixture values with no behavioural meaning; the point is that the codebase no longer references a retired tier.

- [ ] **Step 6: Run the gates**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS. If `pnpm test` reports a failure in `src/lib/platform/actions.test.ts`, a `"pro"` occurrence was missed — grep for it: `grep -rn '"pro"' src/`

- [ ] **Step 7: Commit**

```bash
git add src/lib/validations/admin.ts src/lib/validations/admin.test.ts \
        src/components/admin/OrgAiPlanForm.tsx \
        src/lib/ai/entitlement.test.ts src/lib/ai/org-settings.test.ts \
        src/lib/platform/actions.test.ts
git commit -m "feat(billing): adopt the billing tier vocabulary

Replaces the pre-billing `starter`/`pro` tier labels with the five values
the billing design uses: none, core, pulse, trial, enterprise. Zero rows
exist in org_ai_settings across all 22 orgs, so this is a pure code change
with no data migration; the old labels appeared only in the Zod enum, the
admin form, and test fixtures.

The enum must stay in lockstep with org_billing.tier's check constraint.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Billing schema — two deny-all tables and one narrow definer RPC

**Files:**

- Create: `supabase/migrations/<stamp>_billing_schema.sql` (stamp minted by the script — never hand-written)

**Interfaces:**

- Consumes: the tier vocabulary from Task 1.
- Produces: tables `public.org_billing` and `public.billing_discount_codes`; function `public.get_org_billing_status(p_org uuid)` returning `(tier text, status text, cadence text, seats integer, current_period_end timestamptz, trial_ends_at timestamptz, grace_ends_at timestamptz)`. Task 3 wraps this RPC; Task 5 calls it through that wrapper.

- [ ] **Step 1: Mint the migration file**

```bash
scripts/new-migration.sh billing_schema
```

Note the exact filename it prints — you need it verbatim in Step 3.

- [ ] **Step 2: Write the migration**

Paste into the file the script just created (keep its generated header comment):

```sql
-- Phase 10 E6 · Unit A: the commercial layer over the shipped AI entitlement.
--
-- Two tables, both DENY-ALL to authenticated and anon. org_billing carries
-- Stripe customer/subscription ids; billing_discount_codes is, in effect, free
-- money. Neither is tenant-readable under any policy. RLS is enabled with NO
-- policies at all — that is the deny, and it is deliberate, not an omission.
-- Writes come exclusively from the service role (the Stripe webhook, Unit C),
-- which bypasses RLS.
--
-- The org reads its own billing state through get_org_billing_status(), a
-- SECURITY DEFINER function that returns the customer-facing fields ONLY and
-- never a Stripe id.

-- ---------------------------------------------------------------------------
-- 1. org_billing — one row per organization, mirroring the Stripe subscription.
-- ---------------------------------------------------------------------------
create table if not exists public.org_billing (
  org_id                 uuid primary key references public.organizations (id) on delete cascade,
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  -- Lockstep with setOrgAiPlanSchema's enum (src/lib/validations/admin.ts).
  tier                   text not null default 'none'
                           check (tier in ('none', 'core', 'pulse', 'trial', 'enterprise')),
  -- Mirrors Stripe's subscription status, plus 'none' (never subscribed) and
  -- 'grace' (cancelled, inside the 30-day read-only window).
  status                 text not null default 'none'
                           check (status in ('none', 'trialing', 'active', 'past_due', 'canceled', 'grace')),
  cadence                text check (cadence in ('monthly', 'annual')),
  seats                  integer not null default 0 check (seats >= 0),
  current_period_end     timestamptz,
  trial_ends_at          timestamptz,
  grace_ends_at          timestamptz,
  -- The promotion code applied at checkout, mirrored for display. Not a FK:
  -- a code may be revoked and deleted while the discount it granted lives on
  -- in Stripe.
  discount_code          text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

alter table public.org_billing enable row level security;
-- No policies. Default-deny IS the policy.

create trigger org_billing_set_updated_at
  before update on public.org_billing
  for each row execute function public.set_updated_at();

comment on table public.org_billing is
  'Stripe subscription mirror, one row per org. Deny-all RLS: service-role writes only; orgs read via get_org_billing_status().';

-- ---------------------------------------------------------------------------
-- 2. billing_discount_codes — platform-admin-issued codes, mirrored from Stripe.
-- ---------------------------------------------------------------------------
-- max_redemptions defaults to 1: the single-recipient case is the common one,
-- and a code that is accidentally multi-use is money.
create table if not exists public.billing_discount_codes (
  id                       uuid primary key default gen_random_uuid(),
  code                     text not null unique,
  stripe_coupon_id         text,
  stripe_promotion_code_id text,
  percent_off              integer not null check (percent_off between 1 and 100),
  -- Stripe's `once` duration is DELIBERATELY not representable here. On a
  -- monthly plan `once` means one month free; on an annual plan the identical
  -- coupon means a whole YEAR free — 12x the giveaway from the same admin
  -- click. Duration is therefore always months-or-forever.
  duration                 text not null check (duration in ('repeating', 'forever')),
  duration_in_months       integer check (duration_in_months > 0),
  -- Sub-12-month durations are cadence-unsafe (see above) and must be recorded
  -- as monthly-only. Multiples of 12 cost the same either way.
  applies_to_cadence       text not null default 'both'
                             check (applies_to_cadence in ('monthly', 'annual', 'both')),
  plan_restriction         text check (plan_restriction in ('core', 'pulse')),
  max_redemptions          integer not null default 1 check (max_redemptions > 0),
  times_redeemed           integer not null default 0 check (times_redeemed >= 0),
  expires_at               timestamptz,
  created_by               uuid,
  note                     text,
  redeemed_by_org_id       uuid references public.organizations (id) on delete set null,
  redeemed_at              timestamptz,
  revoked_at               timestamptz,
  created_at               timestamptz not null default now(),
  constraint billing_discount_codes_repeating_needs_months check (
    duration <> 'repeating' or duration_in_months is not null
  ),
  -- The trap, enforced in the database rather than only in the admin UI: a
  -- sub-12-month code applied to an annual price multiplies the giveaway.
  constraint billing_discount_codes_short_duration_is_monthly_only check (
    duration <> 'repeating'
    or duration_in_months % 12 = 0
    or applies_to_cadence = 'monthly'
  )
);

alter table public.billing_discount_codes enable row level security;
-- No policies. Default-deny IS the policy.

-- Bounded admin list: 50 per page ordered by created_at desc (working agreement #5).
create index if not exists billing_discount_codes_created_idx
  on public.billing_discount_codes (created_at desc);

comment on table public.billing_discount_codes is
  'Platform-admin discount codes mirrored from Stripe Coupons + Promotion Codes. Deny-all RLS: effectively free money, never tenant-readable.';

-- ---------------------------------------------------------------------------
-- 3. get_org_billing_status — the ONLY tenant-facing read.
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER because org_billing is deny-all; the membership check in the
-- body is therefore load-bearing, not a query hint. It returns the seven
-- customer-facing fields and deliberately omits stripe_customer_id and
-- stripe_subscription_id — a definer that returned them would hand every org
-- member the keys to a Stripe Billing Portal session.
--
-- An org with no row is not an error: it returns a single synthetic row at
-- ('none','none'), so callers never branch on empty-vs-absent.
create or replace function public.get_org_billing_status(p_org uuid)
returns table (
  tier               text,
  status             text,
  cadence            text,
  seats              integer,
  current_period_end timestamptz,
  trial_ends_at      timestamptz,
  grace_ends_at      timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_org_member(p_org) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;

  return query
    select coalesce(b.tier, 'none'),
           coalesce(b.status, 'none'),
           b.cadence,
           coalesce(b.seats, 0),
           b.current_period_end,
           b.trial_ends_at,
           b.grace_ends_at
    from (select 1) as one
    left join public.org_billing b on b.org_id = p_org;
end;
$$;

-- Default EXECUTE is granted to PUBLIC; strip it and hand it back to signed-in
-- callers only. `anon` must stay unable to reach any function
-- (ANON_REACHABLE_FUNCTION_ALLOWLIST is empty by design — src/test/anon-conformance.ts).
revoke all on function public.get_org_billing_status(uuid) from public, anon;
grant execute on function public.get_org_billing_status(uuid) to authenticated;

comment on function public.get_org_billing_status(uuid) is
  'Customer-facing billing state for an org the caller belongs to. SECURITY DEFINER over a deny-all table; never returns Stripe ids.';
```

- [ ] **Step 3: Apply to DEV via the `supabase-dev` MCP**

Call `apply_migration` with `name` set to the **full stamped filename** from Step 1 (e.g. `20260802141530_billing_schema`) and `query` set to the file's contents. Passing a different `name` produces ledger drift that later becomes DDL forensics.

- [ ] **Step 4: Verify the ledger agrees with the repo**

Run: `pnpm db:ledger-check`
Expected: no drift reported in either direction.

- [ ] **Step 5: Verify the deny actually denies**

Through the `supabase-dev` MCP `execute_sql`:

```sql
select relname, relrowsecurity,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname) as policy_count
from pg_class c
where c.relname in ('org_billing', 'billing_discount_codes');
```

Expected: both rows show `relrowsecurity = true` and `policy_count = 0`. A policy count above zero means a policy was added by mistake — that is a security regression, not a convenience.

- [ ] **Step 6: Prove the monthly-vs-annual coupon trap is actually blocked**

The spec calls for a guard that a sub-12-month discount cannot apply to an annual price — on a monthly plan "1 month free" costs one month, on an annual plan the identical coupon costs a **year**. `billing_discount_codes` has no application writer until Unit G, so the constraint _is_ the guard and must be exercised now, not assumed. Through the `supabase-dev` MCP `execute_sql`, run this as one statement — it rolls back, leaving no rows:

```sql
do $$
declare
  v_blocked boolean := false;
begin
  -- Should be REFUSED: 1 month, but applicable to annual.
  begin
    insert into public.billing_discount_codes
      (code, percent_off, duration, duration_in_months, applies_to_cadence)
    values ('MONO-TEST-0001', 100, 'repeating', 1, 'both');
  exception when check_violation then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'GUARD MISSING: a 1-month code was accepted for annual';
  end if;

  -- Should be ACCEPTED: 1 month, monthly-only.
  insert into public.billing_discount_codes
    (code, percent_off, duration, duration_in_months, applies_to_cadence)
  values ('MONO-TEST-0002', 100, 'repeating', 1, 'monthly');

  -- Should be ACCEPTED: 12 months is cadence-safe either way.
  insert into public.billing_discount_codes
    (code, percent_off, duration, duration_in_months, applies_to_cadence)
  values ('MONO-TEST-0003', 50, 'repeating', 12, 'both');

  raise notice 'discount duration guard OK';
  raise exception 'rollback: verification only';
end $$;
```

Expected: the final error is exactly `rollback: verification only`, preceded by the `discount duration guard OK` notice. Any other error means a constraint is wrong. Confirm nothing persisted:

```sql
select count(*) from public.billing_discount_codes;
```

Expected: `0`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/<stamp>_billing_schema.sql
git commit -m "feat(billing): add org_billing and billing_discount_codes

Two deny-all tables with RLS enabled and zero policies — org_billing holds
Stripe customer/subscription ids, billing_discount_codes is effectively free
money, and neither is tenant-readable under any policy. Service-role writes
only.

get_org_billing_status() is the single tenant-facing read: SECURITY DEFINER
over the deny-all table, membership-checked in the body, returning the seven
customer-facing fields and never a Stripe id. An org with no row gets a
synthetic ('none','none') row so callers never branch on absent-vs-empty.

Stripe's `once` coupon duration is deliberately unrepresentable: on a monthly
plan it means one month free, on an annual plan the identical coupon means a
whole year. A check constraint enforces that sub-12-month durations are
monthly-only.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Regenerate types and wrap the billing read

**Files:**

- Modify: `src/types/database.types.ts` (generated — never hand-edit)
- Create: `src/lib/billing/entitling.ts`
- Create: `src/lib/billing/entitling.test.ts`
- Create: `src/lib/billing/status.ts`

**Interfaces:**

- Consumes: `get_org_billing_status` from Task 2; `CREDITS_PER_SEAT` from Task 7's `src/lib/billing/tiers.ts`.
- Produces:
  - `type BillingTier = "none" | "core" | "pulse" | "trial" | "enterprise"`
  - `type BillingStatus = "none" | "trialing" | "active" | "past_due" | "canceled" | "grace"`
  - `type OrgBillingStatus = { tier: BillingTier; status: BillingStatus; cadence: "monthly" | "annual" | null; seats: number; currentPeriodEnd: string | null; trialEndsAt: string | null; graceEndsAt: string | null }`
  - `function entitlesAi(status: BillingStatus): boolean`
  - `function creditLimitFor(tier: BillingTier, seats: number): number`
  - `function readOrgBillingStatus(orgId: string): Promise<OrgBillingStatus>` (server-only)
  - `const CREDIT_LIMIT_UNMANAGED = -1`
  - Task 5 consumes `entitlesAi` and `readOrgBillingStatus`.

- [ ] **Step 1: Regenerate the database types**

From the **main checkout** (not a worktree — an unlinked worktree makes the generator write an error into the file, emptying it):

```bash
pnpm db:types
```

Then verify it did not truncate:

```bash
wc -l src/types/database.types.ts && tail -3 src/types/database.types.ts
```

Expected: several thousand lines, and the last lines are TypeScript (a `}` or a type alias), not a stray log line. If the file shrank or ends in prose, discard it (`git checkout -- src/types/database.types.ts`) and re-run from the linked checkout.

Confirm the new objects landed:

```bash
grep -c "org_billing\|billing_discount_codes\|get_org_billing_status" src/types/database.types.ts
```

Expected: a non-zero count.

- [ ] **Step 2: Write the failing test for the pure mapping**

Create `src/lib/billing/entitling.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { entitlesAi, creditLimitFor } from "@/lib/billing/entitling";
import { CREDITS_PER_SEAT } from "@/lib/billing/tiers";

describe("entitlesAi", () => {
  it("entitles a trialing, active, or past-due subscription", () => {
    expect(entitlesAi("trialing")).toBe(true);
    expect(entitlesAi("active")).toBe(true);
    // past_due is still entitled: Stripe retries for days, and cutting AI off
    // on the first failed charge punishes a customer whose card merely expired.
    expect(entitlesAi("past_due")).toBe(true);
  });

  it("does not entitle never-subscribed, cancelled, or grace", () => {
    expect(entitlesAi("none")).toBe(false);
    expect(entitlesAi("canceled")).toBe(false);
    expect(entitlesAi("grace")).toBe(false);
  });
});

describe("creditLimitFor", () => {
  it("gives Pulse 500 pooled credits per seat", () => {
    expect(creditLimitFor("pulse", 1)).toBe(500);
    expect(creditLimitFor("pulse", 7)).toBe(3_500);
    expect(CREDITS_PER_SEAT).toBe(500);
  });

  it("gives a trial one flat 500-credit org grant, not per seat", () => {
    expect(creditLimitFor("trial", 1)).toBe(500);
    expect(creditLimitFor("trial", 12)).toBe(500);
  });

  it("gives Core nothing — Core is the no-AI tier", () => {
    expect(creditLimitFor("core", 50)).toBe(0);
    expect(creditLimitFor("none", 50)).toBe(0);
  });

  it("leaves Enterprise at its admin-set ceiling by returning -1", () => {
    // -1 is the do-not-touch sentinel: Enterprise ceilings are negotiated, and
    // a webhook recomputing them from seats would silently overwrite the deal.
    expect(creditLimitFor("enterprise", 40)).toBe(-1);
  });

  it("never returns a negative pool for a real tier", () => {
    expect(creditLimitFor("pulse", 0)).toBe(0);
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `pnpm vitest run --project unit src/lib/billing/entitling.test.ts`
Expected: FAIL — `Cannot find module '@/lib/billing/entitling'`.

- [ ] **Step 4: Write the pure mapping module**

Create `src/lib/billing/entitling.ts`:

```ts
/**
 * The billing → entitlement mapping, as pure functions.
 *
 * Deliberately free of I/O and of `server-only`, so the Stripe webhook (Unit C),
 * the settings guard (Task 5), and unit tests can all share one definition. The
 * entitlement GATE is not here — `requireAiEntitlement` already fails closed on
 * `ai_mode = 'off'`. This module decides what the subscription implies; nothing
 * here reads or writes anything.
 *
 * The allowance comes from `tiers.ts`, which is the published price list and
 * therefore the place that number is actually decided. Restating it here would
 * let the page advertise one figure while the ceiling enforced another.
 */
import { CREDITS_PER_SEAT } from "@/lib/billing/tiers";

export type BillingTier = "none" | "core" | "pulse" | "trial" | "enterprise";

export type BillingStatus =
  | "none"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "grace";

/** The flat org-wide grant a 14-day trial carries — not multiplied by seats. */
export const TRIAL_CREDIT_GRANT = CREDITS_PER_SEAT;

/**
 * Sentinel for "this tier's ceiling is negotiated — do not recompute it".
 * Callers MUST check for it before writing `monthly_credit_limit`; writing -1
 * into the column would make `creditsRemaining` negative and hard-stop the org.
 */
export const CREDIT_LIMIT_UNMANAGED = -1;

const ENTITLING: readonly BillingStatus[] = ["trialing", "active", "past_due"];

/**
 * Does this subscription status entitle managed AI?
 *
 * `past_due` says yes on purpose: Stripe's retry schedule runs for days, and
 * revoking AI on the first declined charge punishes a customer whose card
 * merely expired. `grace` says no — grace is the post-cancellation read-only
 * window, where non-AI features keep working and AI does not.
 */
export function entitlesAi(status: BillingStatus): boolean {
  return ENTITLING.includes(status);
}

/**
 * The monthly credit ceiling a tier implies.
 *
 * Returns `CREDIT_LIMIT_UNMANAGED` for Enterprise — see that constant.
 */
export function creditLimitFor(tier: BillingTier, seats: number): number {
  switch (tier) {
    case "pulse":
      return Math.max(0, Math.trunc(seats)) * CREDITS_PER_SEAT;
    case "trial":
      return TRIAL_CREDIT_GRANT;
    case "enterprise":
      return CREDIT_LIMIT_UNMANAGED;
    case "core":
    case "none":
      return 0;
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run --project unit src/lib/billing/entitling.test.ts`
Expected: PASS, all 6 tests.

- [ ] **Step 6: Write the server-only read wrapper**

Create `src/lib/billing/status.ts`:

```ts
import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { BillingStatus, BillingTier } from "@/lib/billing/entitling";

export type OrgBillingStatus = {
  tier: BillingTier;
  status: BillingStatus;
  cadence: "monthly" | "annual" | null;
  seats: number;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  graceEndsAt: string | null;
};

/** What an org with no subscription looks like. Never null, so callers don't branch. */
export const NO_BILLING: OrgBillingStatus = {
  tier: "none",
  status: "none",
  cadence: null,
  seats: 0,
  currentPeriodEnd: null,
  trialEndsAt: null,
  graceEndsAt: null,
};

/**
 * Read the calling org's own billing state.
 *
 * Goes through the RLS client on purpose: `get_org_billing_status` is
 * SECURITY DEFINER over a deny-all table and does its own membership check, so
 * calling it with the SERVICE client would bypass that check and read any org's
 * row. The one place that legitimately needs cross-org reads is the platform
 * admin console (Unit H), which gets its own definer gated on is_platform_admin().
 *
 * One bounded round trip, primary-key lookup. Working agreement #5.
 */
export async function readOrgBillingStatus(
  orgId: string,
): Promise<OrgBillingStatus> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_org_billing_status", {
    p_org: orgId,
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) return NO_BILLING;
  return {
    tier: row.tier as BillingTier,
    status: row.status as BillingStatus,
    cadence: (row.cadence as "monthly" | "annual" | null) ?? null,
    seats: row.seats ?? 0,
    currentPeriodEnd: row.current_period_end,
    trialEndsAt: row.trial_ends_at,
    graceEndsAt: row.grace_ends_at,
  };
}
```

- [ ] **Step 7: Run the gates**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS. A typecheck error on `supabase.rpc("get_org_billing_status", …)` means Step 1's regeneration did not pick up the function — re-check the ledger and re-run `pnpm db:types`.

- [ ] **Step 8: Commit**

```bash
git add src/types/database.types.ts src/lib/billing/entitling.ts \
        src/lib/billing/entitling.test.ts src/lib/billing/status.ts
git commit -m "feat(billing): map subscription state to ai entitlement

entitling.ts is pure and I/O-free so the Stripe webhook, the settings guard,
and unit tests share one definition of what a subscription implies.

past_due entitles AI deliberately — Stripe retries for days, and revoking AI
on the first declined charge punishes a customer whose card merely expired.
grace does not: it is the post-cancellation read-only window.

Enterprise returns a do-not-touch sentinel rather than a number, because its
ceiling is negotiated and a webhook recomputing it from seats would silently
overwrite the deal.

status.ts reads through the RLS client on purpose: the definer does its own
membership check, so a service-role call would bypass it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Backfill every org's mode, then flip the default to `off`

**This is the task with live-user blast radius.** All 22 orgs currently have no `org_ai_settings` row and therefore run on the constant. Changing the constant first would disable AI for every one of them in the same deploy.

**Files:**

- Create: `supabase/migrations/<stamp>_org_ai_settings_backfill.sql`
- Modify: `src/lib/ai/org-settings.ts:18-27`
- Modify: `src/lib/ai/org-settings.test.ts`

**Interfaces:**

- Consumes: Task 3's types.
- Produces: `DEFAULT_ORG_AI_SETTINGS.mode === "off"`. Task 5 depends on this being the fallback for a brand-new org.

- [ ] **Step 1: Mint the migration**

```bash
scripts/new-migration.sh org_ai_settings_backfill
```

- [ ] **Step 2: Write the backfill**

```sql
-- Phase 10 E6 · Unit A: make every existing org's AI mode explicit, so the
-- application-side fallback can change without moving anyone.
--
-- src/lib/ai/org-settings.ts ships DEFAULT_ORG_AI_SETTINGS with mode
-- 'per_user': an org with no row today means "members use their own keys".
-- Under managed-only billing the fallback for an unpaid org must be 'off'.
--
-- Verified on DEV 2026-08-02: 22 organizations, ZERO org_ai_settings rows. So
-- every org is running on that constant right now, and flipping it alone would
-- turn AI off for all of them in one deploy — including the one user with a
-- stored BYO key. This migration writes each org's CURRENT effective mode as a
-- real row first. Nobody's behaviour changes; only the meaning of "no row"
-- does, and after this there are no orgs without a row.
--
-- `on conflict do nothing` so an org that has since gained a row keeps it, and
-- so the migration is safely re-runnable.
insert into public.org_ai_settings (org_id, ai_mode, tier, monthly_credit_limit)
select o.id, 'per_user'::public.ai_mode, 'none', 0
from public.organizations o
on conflict (org_id) do nothing;
```

- [ ] **Step 3: Apply to DEV and verify no org is left uncovered**

Apply via the `supabase-dev` MCP `apply_migration` with the full stamped filename as `name`. Then verify:

```sql
select
  (select count(*) from public.organizations) as orgs,
  (select count(*) from public.org_ai_settings) as settings_rows,
  (select count(*) from public.organizations o
     where not exists (select 1 from public.org_ai_settings s where s.org_id = o.id)) as uncovered;
```

Expected: `orgs = settings_rows` and `uncovered = 0`. **Do not proceed to Step 5 unless `uncovered` is 0** — any uncovered org silently loses AI the moment the constant changes.

- [ ] **Step 4: Verify the ledger**

Run: `pnpm db:ledger-check`
Expected: no drift.

- [ ] **Step 5: Write the failing test for the new default**

In `src/lib/ai/org-settings.test.ts`, add:

```ts
it("defaults a row-less org to no AI, not to per-user keys", () => {
  // The fallback is what an org with no org_ai_settings row gets. Under
  // managed-only billing that must be 'off': a brand-new org has not bought
  // anything, and 'per_user' would hand it a working AI surface for free.
  // Every org that existed before this change got an explicit 'per_user' row
  // written by the backfill migration, so nobody was moved.
  expect(DEFAULT_ORG_AI_SETTINGS.mode).toBe("off");
  expect(DEFAULT_ORG_AI_SETTINGS.monthlyCreditLimit).toBe(0);
});
```

- [ ] **Step 6: Run it to make sure it fails**

Run: `pnpm vitest run --project unit src/lib/ai/org-settings.test.ts`
Expected: FAIL — `expected "per_user" to be "off"`.

- [ ] **Step 7: Flip the constant**

In `src/lib/ai/org-settings.ts`, replace lines 18–27:

```ts
/**
 * What an org with no `org_ai_settings` row gets.
 *
 * `off` since Phase 10 E6: under managed-only billing an org that has not
 * subscribed has no AI. This was `per_user` until 2026-08-02, when a backfill
 * migration wrote an explicit `per_user` row for all 22 then-existing orgs —
 * changing this constant alone would have silently disabled AI for every one of
 * them, because none had a row. Only genuinely new orgs land here now.
 */
export const DEFAULT_ORG_AI_SETTINGS: OrgAiSettings = {
  mode: "off",
  tier: "none",
  monthlyCreditLimit: 0,
  byoProvider: null,
  byoKeyLast4: null,
  maxAgentsPerUser: 3,
  maxAgentRunsPerUserPerDay: 3,
};
```

- [ ] **Step 8: Run the tests**

Run: `pnpm vitest run --project unit src/lib/ai/`
Expected: PASS. If `entitlement.test.ts` now fails, a case there assumed the row-less default was unmetered — update that case to assert the new `off` behaviour rather than reverting the constant.

- [ ] **Step 9: Run the full gates**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add supabase/migrations/<stamp>_org_ai_settings_backfill.sql \
        src/lib/ai/org-settings.ts src/lib/ai/org-settings.test.ts
git commit -m "feat(billing): default a row-less org to no ai, after backfilling

Under managed-only billing, an org that has not subscribed must default to
ai_mode 'off'. Changing the constant alone would have been a silent live
regression: DEV has 22 organizations and ZERO org_ai_settings rows, so every
existing org runs on this fallback today and all 22 would have lost AI in one
deploy, including the one user with a stored BYO key.

The migration therefore writes each org's current effective mode ('per_user')
as a real row first, and only then does the constant change. Nobody moves;
only the meaning of 'no row' does. New orgs from here get 'off' and reach AI
through a subscription — or, until checkout ships, through setOrgAiPlan in
the platform console.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Close the `setAiMode` self-grant hole

`setAiMode` accepts any of the four `ai_mode` values behind nothing but `requireOrgAdmin()`, and its upsert writes **only** `ai_mode`. Harmless today. Under paid billing it is an exploit: a Pulse customer who downgrades (webhook sets `ai_mode: 'off'`) opens Settings → AI, selects "Managed", and resumes spending against their previous credit pool — free AI, metered to our platform key.

**Files:**

- Modify: `src/lib/ai/settings-actions.ts:75-104`
- Test: `src/lib/ai/settings-actions.test.ts` (create if absent)

**Interfaces:**

- Consumes: `entitlesAi` and `readOrgBillingStatus` from Task 3; the `off` default from Task 4.
- Produces: no new exports — `setAiMode` keeps its signature `(input: { mode: AiMode }) => Promise<ActionResult<{ mode: AiMode }>>`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/ai/settings-actions.test.ts` (or extend it):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const upsert = vi.fn().mockResolvedValue({ error: null });
const readBilling = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn().mockResolvedValue({ id: "user-1" }),
}));
vi.mock("@/lib/org/active", () => ({
  resolveActiveOrg: vi.fn().mockResolvedValue({ id: "org-1" }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    rpc: vi.fn().mockResolvedValue({ data: true }), // has_org_role → admin
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({ from: () => ({ upsert }) })),
}));
vi.mock("@/lib/ai/org-settings", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai/org-settings")>()),
  readOrgAiSettings: vi.fn().mockResolvedValue({
    mode: "off",
    tier: "none",
    monthlyCreditLimit: 0,
    byoProvider: null,
    byoKeyLast4: "1234",
    maxAgentsPerUser: 3,
    maxAgentRunsPerUserPerDay: 3,
  }),
}));
vi.mock("@/lib/billing/status", () => ({
  readOrgBillingStatus: (...a: unknown[]) => readBilling(...a),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { setAiMode } = await import("@/lib/ai/settings-actions");

beforeEach(() => {
  upsert.mockClear();
  readBilling.mockReset();
});

describe("setAiMode — managed is derived from the subscription", () => {
  it("refuses managed when the org has no entitling subscription", async () => {
    readBilling.mockResolvedValue({ tier: "none", status: "none", seats: 0 });
    const r = await setAiMode({ mode: "managed" });
    expect(r.ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("refuses managed while the org is in post-cancellation grace", async () => {
    readBilling.mockResolvedValue({ tier: "pulse", status: "grace", seats: 4 });
    const r = await setAiMode({ mode: "managed" });
    expect(r.ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("allows managed on an active subscription", async () => {
    readBilling.mockResolvedValue({
      tier: "pulse",
      status: "active",
      seats: 4,
    });
    const r = await setAiMode({ mode: "managed" });
    expect(r.ok).toBe(true);
    expect(upsert).toHaveBeenCalled();
  });

  it("zeroes the credit ceiling when switching to off", async () => {
    // The ceiling must not be left armed behind a disabled mode — otherwise
    // re-enabling managed by any route resumes spending against the old pool.
    readBilling.mockResolvedValue({
      tier: "pulse",
      status: "active",
      seats: 4,
    });
    const r = await setAiMode({ mode: "off" });
    expect(r.ok).toBe(true);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ ai_mode: "off", monthly_credit_limit: 0 }),
      expect.anything(),
    );
  });

  it("leaves the ceiling alone for the cost-free modes", async () => {
    readBilling.mockResolvedValue({ tier: "none", status: "none", seats: 0 });
    const r = await setAiMode({ mode: "org_byo" });
    expect(r.ok).toBe(true);
    expect(upsert.mock.calls[0]?.[0]).not.toHaveProperty(
      "monthly_credit_limit",
    );
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm vitest run --project unit src/lib/ai/settings-actions.test.ts`
Expected: FAIL — the first two cases return `ok: true` because no guard exists yet.

- [ ] **Step 3: Implement the guard**

In `src/lib/ai/settings-actions.ts`, add the import beside the existing ones:

```ts
import { readOrgBillingStatus } from "@/lib/billing/status";
import { entitlesAi } from "@/lib/billing/entitling";
```

Then replace the body of `setAiMode` from line 86 (`const svc = ...`) through line 103:

```ts
const svc = createServiceClient();

if (mode === "org_byo") {
  const current = await readOrgAiSettings(svc, ctx.orgId);
  if (current.byoKeyLast4 === null)
    return fail("Add an organization key before switching to it.");
}

// `managed` spends OUR platform key, so it is derived from the subscription,
// not chosen by the customer. Without this, an org that downgraded (webhook
// sets ai_mode 'off') could re-select "Managed" here and resume spending
// against its previous credit pool — free AI, metered to us.
if (mode === "managed") {
  const billing = await readOrgBillingStatus(ctx.orgId);
  if (!entitlesAi(billing.status))
    return fail("Managed AI needs an active Pulse subscription.");
}

// Turning AI off must also disarm the ceiling. Leaving a non-zero
// monthly_credit_limit behind a disabled mode means any future path that
// re-enables managed resumes against the old pool. The cost-free modes
// (org_byo, per_user) are unmetered, so their ceiling is irrelevant and is
// left untouched — zeroing it would silently destroy an Enterprise org's
// negotiated allowance on a temporary toggle.
const patch =
  mode === "off"
    ? {
        org_id: ctx.orgId,
        ai_mode: mode,
        monthly_credit_limit: 0,
        updated_by: ctx.userId,
      }
    : { org_id: ctx.orgId, ai_mode: mode, updated_by: ctx.userId };

const { error } = await svc
  .from("org_ai_settings")
  .upsert(patch, { onConflict: "org_id" });
if (error) return fail("Couldn't update the AI mode. Please try again.");

revalidatePath("/settings");
return { ok: true, data: { mode } };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run --project unit src/lib/ai/settings-actions.test.ts`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Run the full gates**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/settings-actions.ts src/lib/ai/settings-actions.test.ts
git commit -m "fix(billing): derive managed ai mode from the subscription

setAiMode accepted any of the four ai_mode values behind requireOrgAdmin()
alone, and its upsert wrote only ai_mode. Harmless before billing; under paid
billing it is an exploit — a customer who downgrades (webhook sets 'off')
could open Settings, select Managed, and resume spending against their
previous credit pool on our platform key.

Managed now requires an entitling billing status, and switching to 'off' also
zeroes monthly_credit_limit so the ceiling is not left armed behind a disabled
mode. org_byo and per_user are unmetered, so their ceiling is deliberately
untouched: zeroing it would destroy an Enterprise org's negotiated allowance
on a temporary toggle.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Prove the deny — RLS integration test and conformance

The conformance suite (Tier 3, anon) enumerates every table and function against empty allow-lists, so it picks up both new objects automatically. What it does **not** cover is an _authenticated_ tenant user, which is the realistic attacker here.

**Files:**

- Create: `src/lib/billing/billing-rls.fixtures.test.ts`

**Interfaces:**

- Consumes: the tables and RPC from Task 2; the permanent Tier 2 fixtures in `src/test/tenant-fixtures.ts`.
- Produces: nothing consumed downstream.

**Why the `fixtures` project and not `integration`:** the integration project provisions users and skips without a sacrificial Supabase project, so assertions there can sit unexecuted for weeks. The `fixtures` project runs against two permanent read-only tenants seeded into DEV by `20260727094033_seed_tier2_tenant_fixtures.sql`, and **`pnpm test` runs it** — so this actually gates. Read `src/lib/supabase/tenant-isolation.fixtures.test.ts` first; the harness below is its pattern, not a new one.

- [ ] **Step 1: Write the test**

Create `src/lib/billing/billing-rls.fixtures.test.ts`:

```ts
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { signInOrThrow } from "@/test/integration-auth";
import {
  type FixtureTenant,
  TIER2_FIXTURE_PASSWORD,
  TIER2_FIXTURE_TENANTS,
  loadFixtureEnv,
  resolveFixtureTarget,
} from "@/test/tenant-fixtures";
import type { Database } from "@/types/database.types";

// Deny-all means deny-all. The conformance tier proves a LOGGED-OUT visitor
// reaches nothing; the realistic attacker on a billing table is a signed-in
// member of a real org reading their OWN row — org_billing holds the Stripe
// customer id, and billing_discount_codes is effectively free money.
//
// Anti-vacuity: "returned no rows" is only evidence if the client is genuinely
// authenticated. signInOrThrow throws rather than yielding a silently
// signed-out client, and the first assertion below proves the session can read
// something it IS entitled to.

loadFixtureEnv();

const resolution = resolveFixtureTarget(process.env);

if (!resolution.ok) {
  console.info(`[billing-rls] skipped — ${resolution.reason}`);
}

const [ALPHA, BETA] = TIER2_FIXTURE_TENANTS;

describe.skipIf(!resolution.ok)(
  "billing tables are not tenant-readable",
  () => {
    const target = resolution.ok ? resolution.target : null;
    let client: SupabaseClient<Database>;

    async function signIn(fixture: FixtureTenant) {
      const c = createClient<Database>(target!.url, target!.anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await signInOrThrow(
        c,
        { email: fixture.email, password: TIER2_FIXTURE_PASSWORD },
        `tier-2 fixture ${fixture.label}`,
      );
      return c;
    }

    beforeAll(async () => {
      client = await signIn(ALPHA);
    }, 120_000);

    it("has a genuinely authenticated session (anti-vacuity)", async () => {
      // If this fails, every "no rows" assertion below is meaningless.
      const { data, error } = await client
        .from("organizations")
        .select("id")
        .eq("id", ALPHA.orgId);
      expect(error).toBeNull();
      expect(data).toEqual([{ id: ALPHA.orgId }]);
    });

    it("returns no org_billing rows for the caller's own org", async () => {
      const { data, error } = await client
        .from("org_billing")
        .select("org_id")
        .eq("org_id", ALPHA.orgId);
      // RLS with no policies yields an empty set rather than an error. Either is
      // acceptable evidence; a non-empty set is not.
      expect(error !== null || data?.length === 0).toBe(true);
    });

    it("returns no billing_discount_codes rows at all", async () => {
      const { data, error } = await client
        .from("billing_discount_codes")
        .select("code");
      expect(error !== null || data?.length === 0).toBe(true);
    });

    it("never leaks a Stripe id through get_org_billing_status", async () => {
      const { data, error } = await client.rpc("get_org_billing_status", {
        p_org: ALPHA.orgId,
      });
      expect(error).toBeNull();
      const row = data?.[0];
      expect(row).toBeDefined();
      expect(Object.keys(row!)).not.toContain("stripe_customer_id");
      expect(Object.keys(row!)).not.toContain("stripe_subscription_id");
      // An org with no subscription reads as the synthetic none/none row, so
      // callers never have to branch on absent-vs-empty.
      expect(row!.tier).toBe("none");
      expect(row!.status).toBe("none");
    });

    it("refuses get_org_billing_status for an org the caller does not belong to", async () => {
      const { error } = await client.rpc("get_org_billing_status", {
        p_org: BETA.orgId,
      });
      expect(error).not.toBeNull();
    });
  },
);
```

- [ ] **Step 2: Run the fixtures project**

Run: `pnpm vitest run --project fixtures src/lib/billing/billing-rls.fixtures.test.ts`
Expected: PASS, 5 tests. If it prints `[billing-rls] skipped`, the DEV credentials are not in `.env.local` — resolve that rather than accepting a skip, because a skipped RLS proof is no proof.

- [ ] **Step 3: Run conformance to confirm the allow-lists stayed empty**

Run: `pnpm test:conformance`
Expected: PASS with `ANON_REACHABLE_TABLE_ALLOWLIST` and `ANON_REACHABLE_FUNCTION_ALLOWLIST` still `[]`. **If conformance fails asking you to add an entry, do not add it** — that is the suite correctly reporting that a new object is anon-reachable, and the fix is in the migration's grants, not the allow-list.

- [ ] **Step 4: Commit**

```bash
git add src/lib/billing/billing-rls.fixtures.test.ts
git commit -m "test(billing): prove both billing tables deny an authenticated tenant

Conformance covers anon; this covers the realistic attacker — a signed-in
member of a real org reading their own row. Asserts empty reads on both
tables, that get_org_billing_status never returns a Stripe id, and that it
refuses an org the caller does not belong to.

Lives in the fixtures project, not integration: integration skips without a
sacrificial Supabase project, and a security assertion that silently skips is
not an assertion. An anti-vacuity check proves the session is genuinely
authenticated before any 'no rows' claim is made.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Tier data, the cadence toggle, and the pricing card

**Load `pulse-ui` and `example-skills:frontend-design` before writing any markup in this task.**

**Files:**

- Create: `src/lib/billing/tiers.ts`
- Create: `src/lib/billing/tiers.test.ts`
- Create: `src/components/billing/billing-cadence-toggle.tsx`
- Create: `src/components/billing/pricing-tier-card.tsx`
- Create: `src/components/billing/pricing-tier-card.test.tsx`

**Interfaces:**

- Consumes: nothing. `tiers.ts` is the leaf of the billing module graph — it must have zero imports, because `entitling.ts` (Task 3) imports _it_.
- Produces:
  - `const CREDITS_PER_SEAT = 500` — consumed by Task 3's `entitling.ts`
  - `type Cadence = "monthly" | "annual"`
  - `type PricingTier = { id: "core" | "pulse" | "enterprise"; name: string; tagline: string; monthly: number | null; annual: number | null; features: readonly string[]; highlight: boolean; ctaLabel: string; ctaHref: string }`
  - `const PRICING_TIERS: readonly PricingTier[]`
  - `function priceFor(tier: PricingTier, cadence: Cadence): number | null`
  - `<BillingCadenceToggle value={cadence} onChange={fn} />`
  - `<PricingTierCard tier={tier} cadence={cadence} />`
  - Task 8 imports `PRICING_TIERS`, `PricingTierCard`, `BillingCadenceToggle`, and `CREDITS_PER_SEAT`. Task 9 imports only `PRICING_TIERS` and `priceFor` — the landing teaser renders its own compact markup rather than the full card, so the landing page's bundle is unchanged.

- [ ] **Step 1: Write the failing test for the tier data**

Create `src/lib/billing/tiers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PRICING_TIERS, priceFor, CREDITS_PER_SEAT } from "@/lib/billing/tiers";

const core = PRICING_TIERS.find((t) => t.id === "core")!;
const pulse = PRICING_TIERS.find((t) => t.id === "pulse")!;
const enterprise = PRICING_TIERS.find((t) => t.id === "enterprise")!;

describe("PRICING_TIERS", () => {
  it("carries the three published tiers, with Pulse highlighted", () => {
    expect(PRICING_TIERS).toHaveLength(3);
    expect(pulse.highlight).toBe(true);
    expect(core.highlight).toBe(false);
  });

  it("prices annual as two months free relative to monthly", () => {
    // The $10-vs-$12 and $24-vs-$29 spread IS the annual discount — there is no
    // separate coupon to administer. 12 x annual must equal 10 x monthly.
    expect(core.annual! * 12).toBe(core.monthly! * 10);
    expect(pulse.annual).toBe(24);
    expect(pulse.monthly).toBe(29);
  });

  it("leaves Enterprise unpriced", () => {
    expect(enterprise.monthly).toBeNull();
    expect(priceFor(enterprise, "annual")).toBeNull();
  });

  it("states the credit allowance in Pulse's features, matching the constant", () => {
    expect(
      pulse.features.some((f) => f.includes(String(CREDITS_PER_SEAT))),
    ).toBe(true);
  });

  it("never claims Core includes AI", () => {
    expect(
      core.features.some((f) => /\bAI\b/.test(f) && !/no ai/i.test(f)),
    ).toBe(false);
  });
});

describe("priceFor", () => {
  it("returns the cadence's price", () => {
    expect(priceFor(core, "monthly")).toBe(12);
    expect(priceFor(core, "annual")).toBe(10);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run --project unit src/lib/billing/tiers.test.ts`
Expected: FAIL — `Cannot find module '@/lib/billing/tiers'`.

- [ ] **Step 3: Write the tier data module**

Create `src/lib/billing/tiers.ts`:

```ts
/**
 * The published price list. Plain data, no React and no `server-only`, so the
 * pricing page, the landing teaser, `entitling.ts`, and (later) the checkout
 * action all read one definition instead of four drifting copies.
 *
 * ZERO IMPORTS, deliberately: this module is the leaf of the billing graph.
 * `entitling.ts` imports CREDITS_PER_SEAT from here, so an import in the other
 * direction would be a cycle.
 *
 * Prices are per user per month in USD. Annual is billed yearly at the annual
 * rate; the $10-vs-$12 and $24-vs-$29 spread IS the "two months free" discount,
 * not a separate coupon to administer.
 */

export type Cadence = "monthly" | "annual";

/**
 * The Pulse allowance, pooled org-wide. 500 credits = $5 of our spend at the
 * shipped 1 credit = $0.01 convention — deliberately well above expected use
 * and well below the $14 AI price delta, which is the only configuration that
 * is both generous-feeling and safe.
 *
 * Lives here rather than in entitling.ts because it is a PRICING decision, and
 * the pricing page advertises it. One definition means the page cannot promise
 * a number the ceiling does not enforce.
 */
export const CREDITS_PER_SEAT = 500;

export type PricingTier = {
  id: "core" | "pulse" | "enterprise";
  name: string;
  tagline: string;
  /** USD per user per month, billed monthly. `null` = talk to us. */
  monthly: number | null;
  /** USD per user per month, billed annually. `null` = talk to us. */
  annual: number | null;
  features: readonly string[];
  /** Exactly one tier is highlighted — the one we want chosen. */
  highlight: boolean;
  ctaLabel: string;
  ctaHref: string;
};

export const PRICING_TIERS: readonly PricingTier[] = [
  {
    id: "core",
    name: "Core",
    tagline: "The whole Work OS. No AI.",
    monthly: 12,
    annual: 10,
    features: [
      "Unlimited boards, items, and workspaces",
      "Table, kanban, calendar, and timeline views",
      "Automations, dashboards, and reports",
      "Portfolios, goals, workload, and time tracking",
      "Import and export, board sharing, guests",
      "No seat minimum — pay for the seats you use",
    ],
    highlight: false,
    ctaLabel: "Start free trial",
    ctaHref: "/signup",
  },
  {
    id: "pulse",
    name: "Pulse",
    tagline: "Everything in Core, plus the agents.",
    monthly: 29,
    annual: 24,
    features: [
      "Everything in Core",
      "Ask Pulse across your whole workspace",
      "Personal agents and daily briefings",
      "AI board, dashboard, and automation generation",
      "Semantic search",
      `${CREDITS_PER_SEAT} AI credits per seat per month, pooled org-wide`,
    ],
    highlight: true,
    ctaLabel: "Start free trial",
    ctaHref: "/signup",
  },
  {
    id: "enterprise",
    name: "Enterprise",
    tagline: "For teams with their own rules.",
    monthly: null,
    annual: null,
    features: [
      "Everything in Pulse",
      "Custom AI credit ceiling",
      "SSO",
      "Bring your own model keys by arrangement",
      "Priority support",
    ],
    highlight: false,
    ctaLabel: "Contact us",
    ctaHref: "mailto:info@synapse-solutions.ai?subject=Monolith%20Enterprise",
  },
];

export function priceFor(tier: PricingTier, cadence: Cadence): number | null {
  return cadence === "annual" ? tier.annual : tier.monthly;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run --project unit src/lib/billing/tiers.test.ts`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Write the cadence toggle**

Create `src/components/billing/billing-cadence-toggle.tsx`:

```tsx
"use client";
import { cn } from "@/lib/utils";
import type { Cadence } from "@/lib/billing/tiers";

/**
 * Monthly / annual switch. The ONLY client component on the pricing page.
 *
 * Pure client state — switching cadence is zero server round-trips (working
 * agreement #5). If this ever needs to be linkable, use
 * `window.history.replaceState`, never a `<Link>` or `router.push`: a router
 * navigation re-runs every query in the page (gotcha-09).
 *
 * Rendered as a radiogroup rather than two buttons so the pair is one tab stop
 * and arrow keys move between options, which is what a segmented control should
 * do. 44px minimum target on coarse pointers.
 */
export function BillingCadenceToggle({
  value,
  onChange,
}: {
  value: Cadence;
  onChange: (next: Cadence) => void;
}) {
  const options: { id: Cadence; label: string }[] = [
    { id: "monthly", label: "Monthly" },
    { id: "annual", label: "Annual" },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Billing cadence"
      className="bg-surface-muted border-border inline-flex items-center gap-1 rounded-lg border p-1"
    >
      {options.map((o) => {
        const selected = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.id)}
            className={cn(
              "focus-visible:ring-ring rounded-sm px-4 py-1.5 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none",
              "pointer-coarse:min-h-11 pointer-coarse:px-5",
              selected
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
      <span className="text-muted-foreground px-2 text-xs font-medium">
        2 months free
      </span>
    </div>
  );
}
```

- [ ] **Step 6: Write the failing card test**

Create `src/components/billing/pricing-tier-card.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PricingTierCard } from "./pricing-tier-card";
import { PRICING_TIERS } from "@/lib/billing/tiers";

const core = PRICING_TIERS.find((t) => t.id === "core")!;
const pulse = PRICING_TIERS.find((t) => t.id === "pulse")!;
const enterprise = PRICING_TIERS.find((t) => t.id === "enterprise")!;

describe("PricingTierCard", () => {
  it("shows the cadence's price and says what it is per", () => {
    render(<PricingTierCard tier={core} cadence="annual" />);
    expect(screen.getByText("$10")).toBeInTheDocument();
    expect(screen.getByText(/per user \/ month/i)).toBeInTheDocument();
  });

  it("shows the monthly price when the cadence is monthly", () => {
    render(<PricingTierCard tier={core} cadence="monthly" />);
    expect(screen.getByText("$12")).toBeInTheDocument();
  });

  it("says 'billed annually' only on the annual cadence", () => {
    const { rerender } = render(
      <PricingTierCard tier={pulse} cadence="annual" />,
    );
    expect(screen.getByText(/billed annually/i)).toBeInTheDocument();
    rerender(<PricingTierCard tier={pulse} cadence="monthly" />);
    expect(screen.queryByText(/billed annually/i)).not.toBeInTheDocument();
  });

  it("renders 'Custom' instead of a price for an unpriced tier", () => {
    render(<PricingTierCard tier={enterprise} cadence="annual" />);
    expect(screen.getByText(/custom/i)).toBeInTheDocument();
  });

  it("labels the highlighted tier in text, not colour alone", () => {
    render(<PricingTierCard tier={pulse} cadence="annual" />);
    expect(screen.getByText(/most popular/i)).toBeInTheDocument();
  });

  it("renders every feature", () => {
    render(<PricingTierCard tier={pulse} cadence="annual" />);
    for (const f of pulse.features) {
      expect(screen.getByText(f)).toBeInTheDocument();
    }
  });
});
```

- [ ] **Step 7: Run it to make sure it fails**

Run: `pnpm vitest run --project unit src/components/billing/pricing-tier-card.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 8: Write the card**

Create `src/components/billing/pricing-tier-card.tsx`:

```tsx
import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Kicker } from "@/components/ui/kicker";
import { priceFor, type Cadence, type PricingTier } from "@/lib/billing/tiers";

/**
 * One tier. No directive of its own: it is imported by `pricing-table.tsx`
 * ("use client") and so ships to the client, and imported by the landing teaser
 * path where it renders on the server. That is fine — it is pure presentation
 * over props and fetches nothing. Keep it that way: adding a server-only import
 * here would break the client build of the pricing page.
 *
 * The highlighted tier is marked with a "Most popular" label as well as the
 * accent border: never colour alone.
 */
export function PricingTierCard({
  tier,
  cadence,
}: {
  tier: PricingTier;
  cadence: Cadence;
}) {
  const price = priceFor(tier, cadence);

  return (
    <div
      className={cn(
        "bg-surface flex h-full flex-col rounded-lg border p-6",
        tier.highlight ? "border-primary/40" : "border-border",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <Kicker>{tier.name}</Kicker>
        {tier.highlight ? (
          <span className="bg-primary/10 text-primary rounded-sm px-2 py-1 font-mono text-[9px] font-medium tracking-[0.1em] uppercase">
            Most popular
          </span>
        ) : null}
      </div>

      <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
        {tier.tagline}
      </p>

      <div className="mt-6 mb-1 flex items-baseline gap-1.5">
        {price === null ? (
          <span className="text-4xl font-extrabold tracking-tight">Custom</span>
        ) : (
          <>
            <span className="text-4xl font-extrabold tracking-tight">
              ${price}
            </span>
            <span className="text-muted-foreground text-sm">
              per user / month
            </span>
          </>
        )}
      </div>
      <p className="text-muted-foreground min-h-5 text-xs">
        {price !== null && cadence === "annual" ? "Billed annually" : " "}
      </p>

      <ul className="mt-6 mb-8 flex flex-1 flex-col gap-2.5">
        {tier.features.map((f) => (
          <li key={f} className="flex items-start gap-2.5 text-[13.5px]">
            <Check
              className="text-primary mt-0.5 size-4 flex-none"
              aria-hidden="true"
            />
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <Link
        href={tier.ctaHref}
        className={cn(
          "focus-visible:ring-ring inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none",
          "pointer-coarse:min-h-11",
          tier.highlight
            ? "bg-primary text-primary-foreground hover:bg-primary/90"
            : "border-border hover:border-border-hover border",
        )}
      >
        {tier.ctaLabel}
      </Link>
    </div>
  );
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pnpm vitest run --project unit src/components/billing/`
Expected: PASS, all 6 card tests.

- [ ] **Step 10: Run the gates and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`

```bash
git add src/lib/billing/tiers.ts src/lib/billing/tiers.test.ts \
        src/components/billing/billing-cadence-toggle.tsx \
        src/components/billing/pricing-tier-card.tsx \
        src/components/billing/pricing-tier-card.test.tsx
git commit -m "feat(billing): add the published price list and tier card

tiers.ts is the one definition the pricing page, the landing teaser, and
later the checkout action all read, so the numbers cannot drift between
surfaces. Annual is expressed as its own per-month rate because the
\$10-vs-\$12 spread IS the two-months-free discount — there is no coupon to
administer.

The cadence toggle is the only client component: switching is pure client
state with zero server round-trips. The highlighted tier is labelled 'Most
popular' in text as well as accented, never colour alone.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: The `/pricing` route

**Files:**

- Create: `src/components/billing/pricing-table.tsx`
- Create: `src/components/billing/pricing-comparison.tsx`
- Create: `src/components/billing/pricing-faq.tsx`
- Create: `src/app/pricing/page.tsx`
- Create: `src/app/pricing/page.test.tsx`
- Modify: `src/proxy.ts:21` and `src/proxy.ts:174`
- Modify: `src/proxy.test.ts`

**Interfaces:**

- Consumes: `PRICING_TIERS`, `PricingTierCard`, `BillingCadenceToggle`, `CREDITS_PER_SEAT` from Task 7.
- Produces: the route `/pricing`. Task 9's nav and footer link to it.

- [ ] **Step 1: Write the composed table**

Create `src/components/billing/pricing-table.tsx`:

```tsx
"use client";
import { useState } from "react";
import { BillingCadenceToggle } from "./billing-cadence-toggle";
import { PricingTierCard } from "./pricing-tier-card";
import { PRICING_TIERS, type Cadence } from "@/lib/billing/tiers";

/**
 * Toggle + three cards. Client, because the cadence lives in `useState`.
 *
 * Importing PricingTierCard from a "use client" module pulls it into the client
 * bundle too — that is how the boundary works, and it is accepted here: the
 * card is pure presentation over props, fetches nothing, and re-rendering three
 * of them on a toggle is exactly the interaction. The comparison table and FAQ
 * are deliberately mounted by the PAGE rather than nested here, so they stay
 * Server Components and never ship.
 *
 * Zero server round-trips on toggle, per working agreement #5.
 */
export function PricingTable() {
  const [cadence, setCadence] = useState<Cadence>("annual");

  return (
    <>
      <div className="flex justify-center">
        <BillingCadenceToggle value={cadence} onChange={setCadence} />
      </div>
      <div className="mt-12 grid gap-5 md:grid-cols-3">
        {PRICING_TIERS.map((t) => (
          <PricingTierCard key={t.id} tier={t} cadence={cadence} />
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Write the feature comparison table**

Create `src/components/billing/pricing-comparison.tsx`. A Server Component — the rows do not vary by cadence, so it stays entirely out of the client subtree:

```tsx
import { Check, Minus } from "lucide-react";
import { CREDITS_PER_SEAT } from "@/lib/billing/tiers";

type Cell = boolean | string;
type Row = { label: string; core: Cell; pulse: Cell; enterprise: Cell };

const GROUPS: { group: string; rows: Row[] }[] = [
  {
    group: "Work OS",
    rows: [
      {
        label: "Boards, items, workspaces",
        core: "Unlimited",
        pulse: "Unlimited",
        enterprise: "Unlimited",
      },
      {
        label: "Table, kanban, calendar, timeline",
        core: true,
        pulse: true,
        enterprise: true,
      },
      { label: "Automations", core: true, pulse: true, enterprise: true },
      {
        label: "Dashboards and reports",
        core: true,
        pulse: true,
        enterprise: true,
      },
      {
        label: "Portfolios, goals, workload",
        core: true,
        pulse: true,
        enterprise: true,
      },
      { label: "Time tracking", core: true, pulse: true, enterprise: true },
      {
        label: "Import, export, board sharing",
        core: true,
        pulse: true,
        enterprise: true,
      },
    ],
  },
  {
    group: "AI",
    rows: [
      { label: "Ask Pulse", core: false, pulse: true, enterprise: true },
      {
        label: "Personal agents and daily briefings",
        core: false,
        pulse: true,
        enterprise: true,
      },
      {
        label: "AI board and dashboard generation",
        core: false,
        pulse: true,
        enterprise: true,
      },
      { label: "Semantic search", core: false, pulse: true, enterprise: true },
      {
        label: "Monthly AI credits",
        core: "None",
        pulse: `${CREDITS_PER_SEAT} per seat, pooled`,
        enterprise: "Custom",
      },
    ],
  },
  {
    group: "Account",
    rows: [
      {
        label: "Seat minimum",
        core: "None",
        pulse: "None",
        enterprise: "None",
      },
      { label: "SSO", core: false, pulse: false, enterprise: true },
      {
        label: "Bring your own model keys",
        core: false,
        pulse: false,
        enterprise: "By arrangement",
      },
    ],
  },
];

/**
 * Marks are paired with an accessible name, never colour alone: a check renders
 * with sr-only "Included" and a dash with "Not included", so the table reads
 * correctly to a screen reader and to anyone who cannot distinguish the glyphs.
 *
 * The table scrolls inside its own container rather than widening the page —
 * three columns plus labels is wider than a phone.
 */
function Mark({ value }: { value: Cell }) {
  if (typeof value === "string")
    return <span className="text-[13px]">{value}</span>;
  return value ? (
    <>
      <Check className="text-primary mx-auto size-4" aria-hidden="true" />
      <span className="sr-only">Included</span>
    </>
  ) : (
    <>
      <Minus
        className="text-muted-foreground mx-auto size-4"
        aria-hidden="true"
      />
      <span className="sr-only">Not included</span>
    </>
  );
}

export function PricingComparison() {
  return (
    <section className="mt-24">
      <h2 className="mb-8 text-center text-2xl font-extrabold tracking-tight">
        Compare plans
      </h2>
      <div className="border-border overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <caption className="sr-only">
            Feature comparison across the Core, Pulse, and Enterprise plans
          </caption>
          <thead>
            <tr className="border-border border-b">
              <th scope="col" className="px-4 py-3 text-left font-semibold">
                Feature
              </th>
              <th scope="col" className="px-4 py-3 text-center font-semibold">
                Core
              </th>
              <th scope="col" className="px-4 py-3 text-center font-semibold">
                Pulse
              </th>
              <th scope="col" className="px-4 py-3 text-center font-semibold">
                Enterprise
              </th>
            </tr>
          </thead>
          <tbody>
            {GROUPS.map((g) => (
              <>
                <tr key={g.group} className="bg-surface-muted">
                  <th
                    scope="colgroup"
                    colSpan={4}
                    className="text-kicker px-4 py-2 text-left font-mono text-[9px] tracking-[0.1em] uppercase"
                  >
                    {g.group}
                  </th>
                </tr>
                {g.rows.map((r) => (
                  <tr key={r.label} className="border-border/60 border-t">
                    <th
                      scope="row"
                      className="px-4 py-2.5 text-left font-normal"
                    >
                      {r.label}
                    </th>
                    <td className="px-4 py-2.5 text-center">
                      <Mark value={r.core} />
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <Mark value={r.pulse} />
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <Mark value={r.enterprise} />
                    </td>
                  </tr>
                ))}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
```

> If `pnpm lint` objects to the `<>…</>` inside `.map` lacking a key, hoist it to `<Fragment key={g.group}>` with `import { Fragment } from "react"` and move the `key` off the inner `<tr>`.

- [ ] **Step 3: Write the FAQ**

Create `src/components/billing/pricing-faq.tsx`. Native `<details>` so it needs no JavaScript and stays a Server Component:

```tsx
import { CREDITS_PER_SEAT } from "@/lib/billing/tiers";

const FAQ: { q: string; a: string }[] = [
  {
    q: "What is an AI credit?",
    a:
      "One credit is one cent of model spend. Pulse includes " +
      `${CREDITS_PER_SEAT} credits per seat per month, pooled across your whole ` +
      "organization — so a heavy user and a light user balance each other out " +
      "instead of each hitting their own wall.",
  },
  {
    q: "What happens if we run out of credits?",
    a:
      "AI features pause until the pool resets at the start of the next month. " +
      "Nothing else stops — boards, automations, dashboards and every other part " +
      "of Monolith keep working exactly as before. Running out of AI credits " +
      "never blocks someone from updating a task.",
  },
  {
    q: "Is there a seat minimum?",
    a:
      "No. You pay for exactly the seats in use, and adding or removing a seat " +
      "prorates automatically. There are no seat buckets and no minimum team size.",
  },
  {
    q: "How does the free trial work?",
    a:
      "Every new organization gets 14 days of Pulse. We ask for a card up front " +
      "so the subscription converts without interrupting your team, and you can " +
      "switch to Core or cancel at any point during the trial.",
  },
  {
    q: "What happens to our data if we cancel?",
    a:
      "Your workspace becomes read-only for 30 days with export enabled, then is " +
      "suspended. We never delete your data because a subscription lapsed.",
  },
  {
    q: "Can we switch between monthly and annual?",
    a:
      "Yes, from Settings at any time. Annual works out to two months free — " +
      "that is the whole difference between the two rates; there is no separate " +
      "discount to claim.",
  },
];

export function PricingFaq() {
  return (
    <section className="mx-auto mt-24 max-w-[720px]">
      <h2 className="mb-8 text-center text-2xl font-extrabold tracking-tight">
        Questions
      </h2>
      <div className="border-border divide-border/60 divide-y rounded-lg border">
        {FAQ.map((item) => (
          <details key={item.q} className="group px-5 py-4">
            <summary className="focus-visible:ring-ring flex cursor-pointer items-center justify-between gap-4 text-[15px] font-semibold focus-visible:ring-2 focus-visible:outline-none pointer-coarse:min-h-11">
              {item.q}
              <span
                className="text-muted-foreground flex-none transition-transform group-open:rotate-45"
                aria-hidden="true"
              >
                +
              </span>
            </summary>
            <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
              {item.a}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Write the page**

Create `src/app/pricing/page.tsx`:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { nunito } from "@/lib/fonts";
import { PricingTable } from "@/components/billing/pricing-table";
import { PricingComparison } from "@/components/billing/pricing-comparison";
import { PricingFaq } from "@/components/billing/pricing-faq";

export const metadata: Metadata = {
  title: "Pricing · Monolith",
  description:
    "Monolith pricing — Core at $10 per user per month for the whole Work OS, Pulse at $24 with AI agents and 500 pooled credits per seat. No seat minimum.",
};

/**
 * Public, unauthenticated, fully static. No `searchParams` is read here on
 * purpose: awaiting searchParams at page level fails `next build` under
 * cacheComponents ("Uncached data outside <Suspense>") while typecheck, lint
 * and unit tests all pass. The cadence is client state, so nothing is needed
 * from the URL.
 *
 * Wrapped in `dark` so Keystone tokens resolve to the always-dark marketing
 * aesthetic regardless of the visitor's theme, matching /updates and /landing.
 */
export default function PricingPage() {
  return (
    <div className="dark bg-background text-foreground min-h-dvh">
      <div className="mx-auto max-w-[1100px] px-6 py-20 sm:px-8">
        <Link
          href="/landing"
          className="text-muted-foreground hover:text-foreground mb-12 inline-flex items-center gap-1.5 text-sm transition-colors"
        >
          <ArrowLeft className="size-4" />
          Back to home
        </Link>

        <header className="mx-auto mb-12 max-w-[640px] text-center">
          <h1
            className={`${nunito.className} text-4xl font-extrabold tracking-tight sm:text-5xl`}
          >
            Pay for the seats you use
          </h1>
          <p className="text-muted-foreground mt-4 text-base leading-relaxed sm:text-lg">
            No seat minimum, no bucket jumps. Every plan starts with a 14-day
            free trial of Pulse.
          </p>
        </header>

        <PricingTable />
        <PricingComparison />
        <PricingFaq />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Register the route as public in `src/proxy.ts`**

Line 21 — add `/pricing` to `PUBLIC_ROUTES`:

```ts
// Public routes an unauthenticated visitor may view (exact match). `/` is the
// static MONOLITH landing for logged-out visitors (the proxy redirects an
// authenticated hit on `/` to /home below); `/landing` is the always-on splash
// the nav logo points to; `/updates` is the public changelog linked from the
// landing footer; `/pricing` is the public price list linked from the nav.
const PUBLIC_ROUTES = ["/", "/landing", "/updates", "/pricing"];
```

Line 174 — add `pricing` to the matcher exclusion, so Vercel serves it from the CDN with zero proxy invocation, exactly as `/updates` already is:

```ts
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|login|signup|updates|pricing|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|ttf|otf|map)$).*)",
```

Both edits are required and they are not redundant: the matcher exclusion is the performance path, and `PUBLIC_ROUTES` is the correctness backstop if the matcher is ever narrowed.

- [ ] **Step 6: Write the failing proxy test**

`src/proxy.test.ts` already provides a `req(path)` helper and a hoisted `getClaims` mock; use them rather than building a request by hand. Add inside the existing `describe("proxy()")` block:

```ts
it("lets an anonymous visitor reach /pricing without a login redirect", async () => {
  getClaims.mockResolvedValue({ data: null, error: null });

  const res = await proxy(req("/pricing"));

  expect(res.headers.get("location")).toBeNull();
});

it("excludes /pricing from the proxy matcher so the CDN serves it", () => {
  // Belt and braces: PUBLIC_ROUTES is the correctness backstop, this is the
  // performance path. A route in one but not the other still works but pays a
  // proxy invocation on every anonymous hit.
  const matcher = config.matcher[0];
  expect(matcher).toContain("pricing");
});
```

`config` is already imported at the top of that file alongside `proxy`.

- [ ] **Step 7: Write the page test**

Create `src/app/pricing/page.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import PricingPage from "./page";
import { PRICING_TIERS } from "@/lib/billing/tiers";

describe("/pricing", () => {
  it("renders every published tier by name", () => {
    render(<PricingPage />);
    for (const t of PRICING_TIERS) {
      // The name appears in the card kicker and again as a comparison column
      // header, so assert presence rather than uniqueness.
      expect(screen.getAllByText(t.name).length).toBeGreaterThan(0);
    }
  });

  it("defaults to the annual cadence", () => {
    render(<PricingPage />);
    expect(screen.getByRole("radio", { name: "Annual" })).toBeChecked();
    expect(screen.getByText("$24")).toBeInTheDocument();
  });

  it("states the no-seat-minimum promise", () => {
    render(<PricingPage />);
    expect(screen.getAllByText(/no seat minimum/i).length).toBeGreaterThan(0);
  });

  it("marks Core as not including Ask Pulse, in text as well as a glyph", () => {
    render(<PricingPage />);
    const row = screen.getByRole("row", { name: /ask pulse/i });
    // Never colour or glyph alone: the sr-only labels carry the meaning.
    expect(within(row).getByText("Not included")).toBeInTheDocument();
    expect(within(row).getAllByText("Included").length).toBe(2);
  });

  it("answers what happens when credits run out", () => {
    render(<PricingPage />);
    expect(screen.getByText(/run out of credits/i)).toBeInTheDocument();
    expect(
      screen.getByText(/never blocks someone from updating a task/i),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Run the tests**

Run: `pnpm vitest run --project unit src/app/pricing/page.test.tsx src/proxy.test.ts`
Expected: PASS. If the comparison-row query fails on the accessible name, check that each `<tr>`'s row header text is what `getByRole("row", { name })` sees — the accessible name is the concatenation of all cells, so `/ask pulse/i` must match as a substring.

- [ ] **Step 9: Run the build — this is the gate that matters here**

Run: `pnpm build`
Expected: PASS, with `/pricing` listed as a static route. A cacheComponents "Uncached data outside `<Suspense>`" failure means something in the subtree started reading request data — find it and wrap it, do not add `force-dynamic`.

- [ ] **Step 10: Run the full gates and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`

```bash
git add src/components/billing/pricing-table.tsx \
        src/components/billing/pricing-comparison.tsx \
        src/components/billing/pricing-faq.tsx \
        src/app/pricing/page.tsx src/app/pricing/page.test.tsx \
        src/proxy.ts src/proxy.test.ts
git commit -m "feat(billing): add the public pricing page

Cards, cadence toggle, feature comparison, and FAQ. Fully static,
unauthenticated, dark-locked to match /updates and /landing. Only the cadence
toggle is a client component; the comparison table and FAQ are Server
Components, the FAQ using native <details> so it needs no JavaScript.

Registered as public in proxy.ts in BOTH places: the matcher exclusion is the
performance path (CDN-served, zero proxy invocation) and PUBLIC_ROUTES is the
correctness backstop. An unregistered public route 307s to /login.

No searchParams is read at page level — that fails next build under
cacheComponents while every other gate passes. The cadence is client state,
so nothing is needed from the URL.

Comparison marks carry sr-only Included / Not included labels: a check glyph
alone is not readable to a screen reader or to anyone who cannot distinguish
it from a dash.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Landing teaser, nav link, footer link

**Files:**

- Create: `src/components/landing/pricing-section.tsx`
- Create: `src/components/landing/pricing-section.test.tsx`
- Modify: `src/components/landing/landing-nav.tsx:27-32`
- Modify: `src/components/landing/monolith-hero.tsx:30-37`

**Interfaces:**

- Consumes: `PRICING_TIERS` and `priceFor` from Task 7; the `/pricing` route from Task 8.
- Produces: `<LandingPricingSection />`, mounted by `MonolithHero`.

- [ ] **Step 1: Write the failing test**

Create `src/components/landing/pricing-section.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LandingPricingSection } from "./pricing-section";

describe("LandingPricingSection", () => {
  it("shows the annual headline price for each tier", () => {
    render(<LandingPricingSection />);
    expect(screen.getByText("$10")).toBeInTheDocument();
    expect(screen.getByText("$24")).toBeInTheDocument();
    expect(screen.getByText(/custom/i)).toBeInTheDocument();
  });

  it("links to the full pricing page", () => {
    render(<LandingPricingSection />);
    const link = screen.getByRole("link", { name: /compare plans/i });
    expect(link).toHaveAttribute("href", "/pricing");
  });

  it("has an anchor target so the nav link can reach it", () => {
    const { container } = render(<LandingPricingSection />);
    expect(container.querySelector("#pricing")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm vitest run --project unit src/components/landing/pricing-section.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the teaser**

Create `src/components/landing/pricing-section.tsx` — a **new file**, deliberately not appended to `landing-sections.tsx`, which sits at 837 lines against an 800-line `max-lines` tripwire:

```tsx
import Link from "next/link";
import { Container, SectionHead } from "./sections/primitives";
import { LandingReveal } from "./landing-reveal";
import { PRICING_TIERS, priceFor } from "@/lib/billing/tiers";

/**
 * Compact three-card pricing teaser for the landing page. Server Component:
 * no cadence toggle here on purpose — the teaser shows the annual (headline)
 * rate and sends anyone who wants to compare to /pricing, which keeps the
 * landing page's client bundle unchanged.
 *
 * A new file rather than another section inside landing-sections.tsx, which is
 * at 837 lines against a deliberately-retained 800-line max-lines tripwire whose
 * whole purpose is keeping god-file accretion visible.
 */
export function LandingPricingSection() {
  return (
    <section id="pricing" className="py-24 sm:py-32">
      <Container>
        <SectionHead
          center
          kicker="Pricing"
          title="Pay for the seats you use"
          sub="No seat minimum, no bucket jumps. Every plan starts with a 14-day free trial of Pulse."
        />

        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {PRICING_TIERS.map((tier, i) => {
            const price = priceFor(tier, "annual");
            return (
              <LandingReveal key={tier.id} delayMs={i * 80}>
                <div
                  className={`bg-surface flex h-full flex-col rounded-lg border p-5 ${
                    tier.highlight ? "border-primary/40" : "border-border"
                  }`}
                >
                  <div className="text-kicker font-mono text-[9px] tracking-[0.1em] uppercase">
                    {tier.name}
                  </div>
                  <div className="mt-3 flex items-baseline gap-1.5">
                    {price === null ? (
                      <span className="text-3xl font-extrabold tracking-tight">
                        Custom
                      </span>
                    ) : (
                      <>
                        <span className="text-3xl font-extrabold tracking-tight">
                          ${price}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          per user / month
                        </span>
                      </>
                    )}
                  </div>
                  <p className="text-muted-foreground mt-2.5 text-[13.5px] leading-relaxed">
                    {tier.tagline}
                  </p>
                </div>
              </LandingReveal>
            );
          })}
        </div>

        <div className="mt-10 text-center">
          <Link
            href="/pricing"
            className="border-border hover:border-border-hover focus-visible:ring-ring inline-flex items-center justify-center rounded-lg border px-5 py-2.5 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none pointer-coarse:min-h-11"
          >
            Compare plans →
          </Link>
        </div>
      </Container>
    </section>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run --project unit src/components/landing/pricing-section.test.tsx`
Expected: PASS, all 3 tests.

- [ ] **Step 5: Mount it and add the footer link**

In `src/components/landing/monolith-hero.tsx`, add the import beside the others:

```tsx
import { LandingPricingSection } from "./pricing-section";
```

and replace lines 30–37:

```tsx
      <LandingSections signedIn={signedIn} />
      <LandingPricingSection />

      <footer className={styles.footer}>
        <span>Free to start</span>
        <Link href="/pricing" className={styles.footerLink}>
          Pricing
        </Link>
        <Link href="/updates" className={styles.footerLink}>
          Updates →
        </Link>
      </footer>
```

- [ ] **Step 6: Add the nav link**

In `src/components/landing/landing-nav.tsx`, replace the `<nav>` block at lines 27–32:

```tsx
<nav className={styles.navLinks} aria-label="Landing sections">
  <a href="#agents">Agents</a>
  <a href="#features">Product</a>
  <a href="#views">Views</a>
  {/* In-page anchor, not a <Link>: the teaser lives on this route, and
              a router navigation would re-run every query in the page
              (gotcha-09). The full comparison at /pricing is a real route and
              is linked from the teaser's CTA and the footer. */}
  <a href="#pricing">Pricing</a>
  <Link href="/updates">Updates</Link>
</nav>
```

- [ ] **Step 7: Run the landing tests**

Run: `pnpm vitest run --project unit src/components/landing/`
Expected: PASS. `landing-nav.test.tsx` may assert an exact link count — update that assertion to include Pricing rather than removing it.

- [ ] **Step 8: Run the full gates**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: PASS. A `max-lines` lint error on `landing-sections.tsx` means the section was added to the wrong file — it belongs in `pricing-section.tsx`.

- [ ] **Step 9: Commit**

```bash
git add src/components/landing/pricing-section.tsx \
        src/components/landing/pricing-section.test.tsx \
        src/components/landing/monolith-hero.tsx \
        src/components/landing/landing-nav.tsx \
        src/components/landing/landing-nav.test.tsx
git commit -m "feat(billing): add the landing pricing teaser and nav link

A new file rather than another section inside landing-sections.tsx, which is
at 837 lines against a deliberately-retained 800-line max-lines tripwire.

The teaser is a Server Component showing annual headline rates only — no
cadence toggle, so the landing page's client bundle is unchanged — and sends
anyone who wants to compare to /pricing. The nav entry is an in-page anchor,
not a router navigation, which would re-run every query in the page.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Closing the branch

- [ ] Run the full gate set one final time from inside the worktree: `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm db:ledger-check`
- [ ] Run `scripts/finish-task.sh` from inside the worktree. It rebases onto the latest `develop`, re-runs the gates against the merged state, merges, pushes, and removes the worktree and branch.
- [ ] **A task is not complete until it is merged into `develop` AND cleaned up.** If `finish-task.sh` stops on a rebase conflict, resolve `git rebase develop` and re-run. If it stops on a ledger row with no committed file, that is gotcha-57 — reconcile before retrying.
- [ ] Hand the user a numbered "How to test this" walkthrough (below) and repeat it in the `/wrapup` session note.

## How to test this (draft — verify each step before handing it over)

1. **Pricing page.** Log out (or use a private window) and open `/pricing`. Expect three cards, Pulse marked "Most popular", annual selected by default showing **$10 / $24 / Custom**. Click **Monthly** — prices change to **$12 / $29** with no page reload and no spinner.
2. **Public access.** Still logged out, hard-refresh `/pricing`. Expect the page, **not** a redirect to `/login`. A redirect means the proxy registration is wrong.
3. **Landing teaser.** Open `/landing`, click **Pricing** in the nav. Expect a smooth scroll to the teaser (not a page navigation), three compact cards at annual rates, and **Compare plans →** taking you to `/pricing`.
4. **Existing orgs keep their AI.** Sign in to an existing org, open **Settings → AI**. Expect the mode to read **per-user keys**, exactly as before — the backfill wrote that row. If it reads "off", the backfill did not cover this org and that is a live regression.
5. **The self-grant hole is closed.** In an org with no subscription, open **Settings → AI** and try to select **Managed**. Expect a refusal: "Managed AI needs an active Pulse subscription." Before this change it would have succeeded.
6. **New orgs default to off.** Create a fresh org. Open **Settings → AI**. Expect **off**, and expect Ask to report AI is not on your plan. Grant it via `/admin/organizations/<id>` → AI plan (tier `pulse`, ceiling 500) and confirm AI becomes reachable — that is the operator path until checkout ships.

## Out of scope — the next plan

Units **B** (Stripe client, checkout, portal), **C** (webhook + seat sync), **E** (`<UpgradePrompt>`, `<CreditMeter>`, shell entitlement prop-drilling), **F** (`/settings/billing` + `/checkout/return`), **G** (admin discount codes), **H** (`/admin/billing`). All need at minimum a Stripe test-mode key. `billing_discount_codes` exists after this plan but has no writer and no UI — that is Unit G, and the table shipping early is deliberate so Unit G is a pure application change.

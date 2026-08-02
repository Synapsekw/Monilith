# E6 — Billing & Platform Implementation Plan

> ## ⚠️ SUPERSEDED (2026-08-02) — do not execute this plan
>
> Its spec (`../specs/2026-07-12-e6-billing-platform-design.md`) was superseded by
> `../specs/2026-08-01-billing-and-monetization-design.md`. The active plan is
> **`2026-08-02-billing-batch1-schema-and-pricing.md`**, which uses different table
> names (`org_billing` / `billing_discount_codes`, not `org_subscriptions` /
> `stripe_webhook_events`) and adds tiers, a trial, discount codes and a public
> pricing page that this plan has no concept of.
>
> **Nothing here was ever built.** Verified 2026-08-02 against the repo and live DEV:
> no `src/lib/stripe`, no `stripe` dependency, no matching tables or columns.
>
> **Retained deliberately, for two reasons:**
>
> - **Harvest Tasks 1, 4 and 6** (Stripe client + env, `applyStripeEvent`, webhook route)
>   when the Stripe track is planned. They are sound, and they demonstrate the point the
>   north-star gets wrong: the sync and webhook path is fully buildable and testable with
>   **no Stripe credentials** — every env var optional, the client injected, signatures
>   forged with `stripe.webhooks.generateTestHeaderString`. Only end-to-end verification
>   waits on the account.
> - **Track B (Tasks 8–13) — F17 usage dashboard + AI weekly-digest narrative — has no
>   successor spec.** It is unbuilt and tracked nowhere else. It needs its own decision;
>   it is not part of the August billing design.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. UI tasks additionally require the `pulse-ui` + `frontend-design` skills.

**Goal:** Add Stripe self-serve subscriptions that drive the existing E1 entitlement (F16) and an AI-usage dashboard + AI-written weekly-digest narrative (F17), without changing the E1 gateway/entitlement read contract.

**Architecture:** Stripe holds Products/Prices; a code plan-catalog maps tier ↔ Price ID ↔ credit limit. A signature-verified webhook route calls a pure `applyStripeEvent` sync that upserts `org_subscriptions` and projects tier/limit/mode into `org_ai_settings` (the unchanged entitlement read side). F17 rolls the indexed `ai_usage` ledger into a bounded monthly summary and generates a once-per-week narrative through the E1 `runAi` gateway, cached on the `digest_runs` row.

**Tech Stack:** Next.js 16 (App Router, Route Handlers, Server Actions), Supabase (Postgres + RLS, service role), Stripe Node SDK, Zod, Vitest, recharts/shadcn charts, Tailwind v4 (Keystone).

**Spec:** `docs/superpowers/specs/2026-07-12-e6-billing-platform-design.md`

**Reference reading before coding:** Stripe Node SDK (`stripe.checkout.sessions.create`, `stripe.billingPortal.sessions.create`, `stripe.webhooks.constructEvent`, `stripe.webhooks.generateTestHeaderString`); Next.js 16 Route Handler raw-body access (`node_modules/next/dist/docs/`); existing patterns in `src/lib/ai/settings-actions.ts` (`requireOrgAdmin`), `src/lib/ai/gateway.ts` (`runAi`), `src/lib/digest/run.ts`, `src/lib/actions/result.ts`, `src/lib/supabase/typed-rpc.ts`.

---

## External blocker (state before starting)

Per spec §8, a **real** checkout needs a Stripe account, per-tier Prices, `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_*` env vars, and a registered webhook endpoint. **This plan is buildable and fully testable without them** — every Stripe env var is `optional()`, the Stripe client is injected/mocked in tests, and billing self-disables when unconfigured. Do not block the build on the account; flag to the user that end-to-end verification waits on their Stripe setup.

---

## File Structure

New (F16): `src/lib/stripe/{client,plans,sync,checkout-actions}.ts`, `src/app/api/stripe/webhook/route.ts`, `src/components/settings/BillingForm.tsx`, one billing migration.
New (F17): `src/lib/ai/usage-summary.ts`, `src/lib/digest/narrative.ts`, `src/components/settings/UsageDashboard.tsx`, one usage/digest migration.
Modified: `src/lib/env.server.ts`, `src/app/(app)/settings/page.tsx`, `src/lib/digest/run.ts`, `src/lib/digest/render.ts`, `src/types/database.types.ts`, `package.json`.

---

## TASK TRACK A — F16 Stripe self-serve

### Task 1: Stripe client + env

**Interfaces:**

- Consumes: `src/lib/env.server.ts` (`getServerEnv`), Stripe SDK.
- Produces: `getStripe()` (memoized client or `null` when unconfigured), `stripeConfigured()`; new optional env vars.

**Files:**

- Modify: `package.json` (add `stripe`)
- Modify: `src/lib/env.server.ts`
- Create: `src/lib/stripe/client.ts`
- Test: `src/lib/stripe/client.test.ts`

- [ ] **Step 1: Add the dependency**

Run: `pnpm add stripe`

- [ ] **Step 2: Extend the server env schema** — add to `serverEnvSchema` in `src/lib/env.server.ts` (all optional; absent ⇒ billing self-disables, matching the digest vars):

```ts
  STRIPE_SECRET_KEY: z.string().min(1, "STRIPE_SECRET_KEY must be non-empty when set").optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1, "STRIPE_WEBHOOK_SECRET must be non-empty when set").optional(),
  STRIPE_PRICE_STARTER: z.string().min(1).optional(),
  STRIPE_PRICE_PRO: z.string().min(1).optional(),
  STRIPE_PRICE_ENTERPRISE: z.string().min(1).optional(),
```

Add the matching keys to the `safeParse({...})` object literal (static reads, matching the file's style).

- [ ] **Step 3: Write the failing test** `src/lib/stripe/client.test.ts`

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetServerEnvForTests } from "@/lib/env.server";

afterEach(() => {
  resetServerEnvForTests();
  vi.unstubAllEnvs();
});

describe("stripe client", () => {
  it("returns null when STRIPE_SECRET_KEY is absent", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    const { getStripe, stripeConfigured } = await import("@/lib/stripe/client");
    expect(stripeConfigured()).toBe(false);
    expect(getStripe()).toBeNull();
  });

  it("returns a client when configured", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    const { getStripe, stripeConfigured } = await import("@/lib/stripe/client");
    expect(stripeConfigured()).toBe(true);
    expect(getStripe()).not.toBeNull();
  });
});
```

- [ ] **Step 4: Run it and confirm it fails** — Run: `pnpm vitest run src/lib/stripe/client.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 5: Implement `src/lib/stripe/client.ts`**

```ts
import "server-only";
import Stripe from "stripe";
import { getServerEnv } from "@/lib/env.server";

let cached: Stripe | null | undefined;

export function stripeConfigured(): boolean {
  return Boolean(getServerEnv().STRIPE_SECRET_KEY);
}

/** Memoized Stripe client, or null when STRIPE_SECRET_KEY is unset (billing self-disabled). */
export function getStripe(): Stripe | null {
  if (cached !== undefined) return cached;
  const key = getServerEnv().STRIPE_SECRET_KEY;
  cached = key ? new Stripe(key) : null;
  return cached;
}

/** Test-only: clear the memo. */
export function resetStripeClientForTests(): void {
  cached = undefined;
}
```

(Reset the memo in the test's `afterEach` via `resetStripeClientForTests()`.)

- [ ] **Step 6: Run tests** — Run: `pnpm vitest run src/lib/stripe/client.test.ts` — Expected: PASS.

- [ ] **Step 7: Commit** — `git add package.json pnpm-lock.yaml src/lib/env.server.ts src/lib/stripe/client.ts src/lib/stripe/client.test.ts && git commit -m "feat(billing): add stripe client + optional env"`

---

### Task 2: Plan catalog (tier ↔ price ↔ credit limit)

**Interfaces:**

- Consumes: `getServerEnv()` (price IDs), the tier enum (`none|starter|pro|enterprise`).
- Produces: `PAID_TIERS`, `priceIdForTier(tier)`, `tierForPriceId(priceId)`, `creditLimitForTier(tier)`, `planCatalog()` (display metadata for the UI).

**Files:**

- Create: `src/lib/stripe/plans.ts`
- Test: `src/lib/stripe/plans.test.ts`

- [ ] **Step 1: Write the failing test** `src/lib/stripe/plans.test.ts`

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetServerEnvForTests } from "@/lib/env.server";

afterEach(() => {
  resetServerEnvForTests();
  vi.unstubAllEnvs();
});

describe("plan catalog", () => {
  it("round-trips tier -> price -> tier", async () => {
    vi.stubEnv("STRIPE_PRICE_PRO", "price_pro_1");
    const { priceIdForTier, tierForPriceId } =
      await import("@/lib/stripe/plans");
    expect(priceIdForTier("pro")).toBe("price_pro_1");
    expect(tierForPriceId("price_pro_1")).toBe("pro");
  });

  it("maps an unknown price to null", async () => {
    const { tierForPriceId } = await import("@/lib/stripe/plans");
    expect(tierForPriceId("price_unknown")).toBeNull();
  });

  it("exposes a credit limit per tier", async () => {
    const { creditLimitForTier } = await import("@/lib/stripe/plans");
    expect(creditLimitForTier("none")).toBe(0);
    expect(creditLimitForTier("pro")).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails** — Run: `pnpm vitest run src/lib/stripe/plans.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/stripe/plans.ts`**

```ts
import "server-only";
import { getServerEnv } from "@/lib/env.server";

export type PaidTier = "starter" | "pro" | "enterprise";
export type Tier = "none" | PaidTier;
export const PAID_TIERS: readonly PaidTier[] = ["starter", "pro", "enterprise"];

/** Monthly credit ceiling granted by each tier (1 credit = $0.01, per src/lib/ai/pricing.ts). */
const CREDIT_LIMIT: Record<Tier, number> = {
  none: 0,
  starter: 2000, // $20/mo of managed AI
  pro: 10000, // $100/mo
  enterprise: 50000, // $500/mo
};

export function creditLimitForTier(tier: Tier): number {
  return CREDIT_LIMIT[tier] ?? 0;
}

export function priceIdForTier(tier: PaidTier): string | null {
  const env = getServerEnv();
  const map: Record<PaidTier, string | undefined> = {
    starter: env.STRIPE_PRICE_STARTER,
    pro: env.STRIPE_PRICE_PRO,
    enterprise: env.STRIPE_PRICE_ENTERPRISE,
  };
  return map[tier] ?? null;
}

export function tierForPriceId(priceId: string): PaidTier | null {
  return PAID_TIERS.find((t) => priceIdForTier(t) === priceId) ?? null;
}

export type PlanCard = {
  tier: PaidTier;
  priceId: string | null;
  creditLimit: number;
  name: string;
  blurb: string;
};

/** Display catalog for the billing UI (only tiers with a configured Price are purchasable). */
export function planCatalog(): PlanCard[] {
  const meta: Record<PaidTier, { name: string; blurb: string }> = {
    starter: { name: "Starter", blurb: "AI at the seams for a small team." },
    pro: { name: "Pro", blurb: "Full AI platform for a growing org." },
    enterprise: { name: "Enterprise", blurb: "High-volume managed AI." },
  };
  return PAID_TIERS.map((tier) => ({
    tier,
    priceId: priceIdForTier(tier),
    creditLimit: creditLimitForTier(tier),
    ...meta[tier],
  }));
}
```

(Credit-limit numbers are placeholders to confirm with the user in spec §7; wire them as constants so a change is one edit.)

- [ ] **Step 4: Run tests** — Run: `pnpm vitest run src/lib/stripe/plans.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit** — `git add src/lib/stripe/plans.ts src/lib/stripe/plans.test.ts && git commit -m "feat(billing): plan catalog mapping tier<->price<->credits"`

---

### Task 3: Billing migration (`org_subscriptions` + `stripe_webhook_events`)

**Interfaces:**

- Consumes: `organizations`, `has_org_role`.
- Produces: tables `org_subscriptions`, `stripe_webhook_events`; regenerated `database.types.ts`.

**Files:**

- Create: `supabase/migrations/<stamp>_billing_subscriptions.sql` (via `scripts/new-migration.sh billing_subscriptions`)
- Modify: `src/types/database.types.ts`

- [ ] **Step 1: Mint the migration file** — Run: `scripts/new-migration.sh billing_subscriptions` (never hand-stamp a version — AGENTS.md).

- [ ] **Step 2: Author the SQL** (into the minted file)

```sql
-- E6 F16: Stripe subscription state (billing plane) + webhook dedup.
-- org_ai_settings stays the entitlement projection; the webhook writes both.

create table public.org_subscriptions (
  org_id                 uuid primary key references public.organizations (id) on delete cascade,
  stripe_customer_id     text,
  stripe_subscription_id text,
  status                 text,
  price_id               text,
  tier                   text not null default 'none',
  current_period_end     timestamptz,
  updated_at             timestamptz not null default now()
);

alter table public.org_subscriptions enable row level security;

-- Org admins read their own billing row (no secret material — Stripe ids only).
-- No insert/update/delete policy: the webhook writes via the service role.
create policy "org_subscriptions_select_admin"
  on public.org_subscriptions for select
  using (public.has_org_role(org_id, array['owner', 'admin']::public.org_role[]));

create trigger org_subscriptions_set_updated_at
  before update on public.org_subscriptions
  for each row execute function public.set_updated_at();

-- At-least-once webhook delivery dedup. Service-role only (RLS on, no policies).
create table public.stripe_webhook_events (
  event_id    text primary key,
  type        text not null,
  received_at timestamptz not null default now()
);
alter table public.stripe_webhook_events enable row level security;
```

- [ ] **Step 3: Apply to DEV via the `supabase-dev` MCP** — `apply_migration` with the **same version + name** as the committed file; then `list_migrations` to verify the ledger; run `scripts/reconcile-migration-version.sh` on any drift (gotcha-55).

- [ ] **Step 4: Regenerate types** — Run: `pnpm db:types` — Expected: `org_subscriptions` + `stripe_webhook_events` appear in `src/types/database.types.ts`.

- [ ] **Step 5: Run advisors** — via `supabase-dev` `get_advisors` (security + performance); resolve any RLS/index findings.

- [ ] **Step 6: Commit** — `git add supabase/migrations/*billing_subscriptions.sql src/types/database.types.ts && git commit -m "feat(billing): org_subscriptions + webhook dedup schema"`

---

### Task 4: Sync core — `applyStripeEvent`

**Interfaces:**

- Consumes: Task 2 catalog (`tierForPriceId`, `creditLimitForTier`), Task 3 tables, `org_ai_settings`, a service `SupabaseClient<Database>`, `readOrgAiSettings`.
- Produces: `applyStripeEvent(event, svc)` — pure, Stripe-verified event ⇒ DB mutation.

**Files:**

- Create: `src/lib/stripe/sync.ts`
- Test: `src/lib/stripe/sync.test.ts`

- [ ] **Step 1: Write the failing test** `src/lib/stripe/sync.test.ts` — build minimal Stripe event fixtures + a fake service client that records upserts.

```ts
import { describe, expect, it, vi } from "vitest";
import { applyStripeEvent } from "@/lib/stripe/sync";

vi.mock("@/lib/stripe/plans", () => ({
  tierForPriceId: (p: string) => (p === "price_pro_1" ? "pro" : null),
  creditLimitForTier: (t: string) => (t === "pro" ? 10000 : 0),
}));

function fakeSvc() {
  const calls: Record<string, unknown[]> = {};
  const svc = {
    from(table: string) {
      return {
        upsert(row: unknown) {
          (calls[table] ??= []).push(row);
          return Promise.resolve({ error: null });
        },
        select() {
          return {
            eq() {
              return {
                maybeSingle: () => Promise.resolve({ data: null, error: null }),
              };
            },
          };
        },
      };
    },
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
  };
  return { svc, calls };
}

describe("applyStripeEvent", () => {
  it("checkout.session.completed → sets tier/limit/managed on org_ai_settings", async () => {
    const { svc, calls } = fakeSvc();
    const event = {
      id: "evt_1",
      type: "checkout.session.completed",
      data: {
        object: {
          client_reference_id: "org-1",
          customer: "cus_1",
          subscription: "sub_1",
          metadata: { org_id: "org-1" },
        },
      },
    } as never;
    await applyStripeEvent(event, svc as never);
    expect(calls["org_subscriptions"]?.[0]).toMatchObject({
      org_id: "org-1",
      stripe_customer_id: "cus_1",
    });
  });

  it("customer.subscription.deleted → reverts to tier none / per_user", async () => {
    const { svc, calls } = fakeSvc();
    const event = {
      id: "evt_2",
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_1",
          customer: "cus_1",
          status: "canceled",
          items: { data: [{ price: { id: "price_pro_1" } }] },
        },
      },
    } as never;
    await applyStripeEvent(event, svc as never);
    expect(calls["org_ai_settings"]?.[0]).toMatchObject({
      tier: "none",
      monthly_credit_limit: 0,
    });
  });
});
```

- [ ] **Step 2: Run it, confirm it fails** — Run: `pnpm vitest run src/lib/stripe/sync.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/stripe/sync.ts`**

```ts
import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import {
  tierForPriceId,
  creditLimitForTier,
  type Tier,
} from "@/lib/stripe/plans";
import { readOrgAiSettings } from "@/lib/ai/org-settings";

type Svc = SupabaseClient<Database>;

/** Resolve org id + the subscription's price from any handled event. */
async function resolveContext(
  event: Stripe.Event,
  svc: Svc,
): Promise<{
  orgId: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  priceId: string | null;
  status: string | null;
  periodEnd: string | null;
}> {
  const obj = event.data.object as Record<string, unknown>;
  if (event.type === "checkout.session.completed") {
    const s = obj as unknown as Stripe.Checkout.Session;
    return {
      orgId: (s.client_reference_id ?? s.metadata?.org_id ?? null) as
        | string
        | null,
      customerId: (s.customer as string) ?? null,
      subscriptionId: (s.subscription as string) ?? null,
      priceId: null,
      status: "active",
      periodEnd: null,
    };
  }
  // subscription.updated / .deleted
  const sub = obj as unknown as Stripe.Subscription;
  const priceId = sub.items?.data?.[0]?.price?.id ?? null;
  const { data } = await svc
    .from("org_subscriptions")
    .select("org_id")
    .eq("stripe_customer_id", (sub.customer as string) ?? "")
    .maybeSingle();
  return {
    orgId: (data?.org_id as string) ?? null,
    customerId: (sub.customer as string) ?? null,
    subscriptionId: sub.id,
    priceId,
    status: sub.status,
    periodEnd: sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString()
      : null,
  };
}

/** Verified Stripe event → billing state + entitlement projection. Idempotent per event upstream. */
export async function applyStripeEvent(
  event: Stripe.Event,
  svc: Svc,
): Promise<void> {
  const ctx = await resolveContext(event, svc);
  if (!ctx.orgId) return; // unknown org — nothing to do (already logged by caller)

  const active =
    event.type !== "customer.subscription.deleted" &&
    (ctx.status === "active" || ctx.status === "trialing");
  const tier: Tier =
    active && ctx.priceId
      ? (tierForPriceId(ctx.priceId) ?? "none")
      : event.type === "checkout.session.completed"
        ? ("pending" as Tier)
        : "none";

  await svc.from("org_subscriptions").upsert(
    {
      org_id: ctx.orgId,
      stripe_customer_id: ctx.customerId,
      stripe_subscription_id: ctx.subscriptionId,
      status: ctx.status,
      price_id: ctx.priceId,
      tier: tier === "pending" ? "none" : tier,
      current_period_end: ctx.periodEnd,
    },
    { onConflict: "org_id" },
  );

  // Project into the entitlement read side (spec §2). Checkout completed with no price
  // yet defers to the following subscription.updated event, so only touch settings when
  // we can resolve a concrete tier (active) or on an explicit cancel.
  const settings = await readOrgAiSettings(svc, ctx.orgId);
  if (active && ctx.priceId) {
    const resolved = tierForPriceId(ctx.priceId) ?? "none";
    const nextMode = settings.mode === "org_byo" ? "org_byo" : "managed"; // BYO no-flip (spec §7.4)
    await svc.from("org_ai_settings").upsert(
      {
        org_id: ctx.orgId,
        tier: resolved,
        monthly_credit_limit: creditLimitForTier(resolved),
        ai_mode: nextMode,
      },
      { onConflict: "org_id" },
    );
  } else if (event.type === "customer.subscription.deleted") {
    const nextMode = settings.mode === "managed" ? "per_user" : settings.mode; // fail-safe revert
    await svc.from("org_ai_settings").upsert(
      {
        org_id: ctx.orgId,
        tier: "none",
        monthly_credit_limit: 0,
        ai_mode: nextMode,
      },
      { onConflict: "org_id" },
    );
  }
}
```

(Confirm `Stripe.Subscription.current_period_end` / `items` field names against the installed SDK version while implementing; adjust the accessor if the SDK differs. The test locks the observable behavior.)

- [ ] **Step 4: Run tests** — Run: `pnpm vitest run src/lib/stripe/sync.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit** — `git add src/lib/stripe/sync.ts src/lib/stripe/sync.test.ts && git commit -m "feat(billing): applyStripeEvent sync — subscription -> entitlement"`

---

### Task 5: Checkout + portal Server Actions

**Interfaces:**

- Consumes: Task 1 `getStripe`, Task 2 `priceIdForTier`/`planCatalog`, `requireOrgAdmin` pattern, `org_subscriptions`, `ActionResult`/`fail`.
- Produces: `createCheckoutSession(input)`, `createBillingPortalSession()` → `ActionResult<{ url: string }>`.

**Files:**

- Create: `src/lib/stripe/checkout-actions.ts`
- Test: `src/lib/stripe/checkout-actions.test.ts`

- [ ] **Step 1: Write the failing test** — mock `getStripe` (a fake with `customers.create`, `checkout.sessions.create`, `billingPortal.sessions.create`), mock the admin guard + service client; assert admin gating, customer reuse, and returned URL.

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({
    customers: { create: vi.fn(async () => ({ id: "cus_new" })) },
    checkout: {
      sessions: {
        create: vi.fn(async (a: unknown) => ({
          url: "https://stripe/checkout",
          _a: a,
        })),
      },
    },
    billingPortal: {
      sessions: {
        create: vi.fn(async () => ({ url: "https://stripe/portal" })),
      },
    },
  }),
  stripeConfigured: () => true,
}));
// ...mock requireOrgAdmin -> { userId, orgId } and the service client...

it("createCheckoutSession returns a url for an admin", async () => {
  const { createCheckoutSession } =
    await import("@/lib/stripe/checkout-actions");
  const res = await createCheckoutSession({ tier: "pro" });
  expect(res.ok && res.data.url).toBe("https://stripe/checkout");
});
```

- [ ] **Step 2: Run it, confirm it fails** — Run: `pnpm vitest run src/lib/stripe/checkout-actions.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/stripe/checkout-actions.ts`** — "use server"; reuse the `requireOrgAdmin()` shape from `src/lib/ai/settings-actions.ts`; create-or-reuse `stripe_customer_id` (read `org_subscriptions`, else `customers.create` and upsert it); build the Checkout Session (`mode:'subscription'`, `line_items:[{price, quantity:1}]`, `client_reference_id: orgId`, `metadata:{org_id}`, success/cancel = `${APP_BASE_URL}/settings?billing=…`); portal session from the stored customer. Guard: `stripeConfigured()` false ⇒ `fail("Billing is not configured.")`.

- [ ] **Step 4: Run tests** — Run: `pnpm vitest run src/lib/stripe/checkout-actions.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit** — `git add src/lib/stripe/checkout-actions.ts src/lib/stripe/checkout-actions.test.ts && git commit -m "feat(billing): checkout + portal server actions"`

---

### Task 6: Webhook route handler

**Interfaces:**

- Consumes: Task 1 `getStripe` + `STRIPE_WEBHOOK_SECRET`, Task 4 `applyStripeEvent`, `stripe_webhook_events`, `createServiceClient`.
- Produces: `POST /api/stripe/webhook`.

**Files:**

- Create: `src/app/api/stripe/webhook/route.ts`
- Test: `src/app/api/stripe/webhook/route.test.ts`

- [ ] **Step 1: Write the failing test** — use the real Stripe SDK `stripe.webhooks.generateTestHeaderString` with a known secret to sign a fixture body; assert: valid signature → `applyStripeEvent` called + 200; tampered signature → 400; replayed `event.id` → 200 without re-calling sync (dedup).

- [ ] **Step 2: Run it, confirm it fails** — Run: `pnpm vitest run src/app/api/stripe/webhook/route.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement the route**

```ts
import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe/client";
import { getServerEnv } from "@/lib/env.server";
import { createServiceClient } from "@/lib/supabase/service";
import { applyStripeEvent } from "@/lib/stripe/sync";

const HANDLED = new Set([
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

export async function POST(req: Request) {
  const stripe = getStripe();
  const secret = getServerEnv().STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret)
    return NextResponse.json(
      { error: "billing not configured" },
      { status: 503 },
    );

  const sig = req.headers.get("stripe-signature") ?? "";
  const body = await req.text(); // RAW body — required for signature verification
  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch {
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }

  if (!HANDLED.has(event.type)) return NextResponse.json({ received: true });

  const svc = createServiceClient();
  const { error: dupErr } = await svc
    .from("stripe_webhook_events")
    .insert({ event_id: event.id, type: event.type });
  if (dupErr?.code === "23505") return NextResponse.json({ received: true }); // already processed
  if (dupErr)
    return NextResponse.json({ error: "dedup insert failed" }, { status: 500 });

  await applyStripeEvent(event, svc);
  return NextResponse.json({ received: true });
}
```

(If Next.js 16 requires an explicit runtime/body config for raw access, add it per `node_modules/next/dist/docs/` — the digest route in `src/app/api/digest/run/route.ts` is the in-repo reference for a POST handler.)

- [ ] **Step 4: Run tests** — Run: `pnpm vitest run src/app/api/stripe/webhook/route.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit** — `git add src/app/api/stripe/webhook/route.ts src/app/api/stripe/webhook/route.test.ts && git commit -m "feat(billing): stripe webhook route with signature verify + dedup"`

---

### Task 7: Billing UI card

**Interfaces:**

- Consumes: Task 2 `planCatalog`, Task 5 actions, `org_subscriptions` status (read server-side), `pulse-ui` tokens.
- Produces: `BillingForm` mounted in `/settings` for admins.

**Files:**

- Create: `src/components/settings/BillingForm.tsx`
- Test: `src/components/settings/BillingForm.test.tsx`
- Modify: `src/app/(app)/settings/page.tsx`

- [ ] **Step 0: Load `pulse-ui` + `frontend-design` skills** (mandatory for UI — AGENTS.md #3).

- [ ] **Step 1: Write the failing component test** — render `BillingForm` unpaid → shows plan cards + "Subscribe"; render active → shows current tier + "Manage subscription". Mock the two actions; assert clicking triggers the action and redirects (`window.location.assign` stubbed).

- [ ] **Step 2: Run it, confirm it fails** — Run: `pnpm vitest run src/components/settings/BillingForm.test.tsx` — Expected: FAIL.

- [ ] **Step 3: Implement `BillingForm.tsx`** — client component; props `{ catalog, subscription }` (server-fetched). Unpaid ⇒ plan picker (map `catalog`, each "Subscribe" → `createCheckoutSession({tier})` → `location.assign(url)`); active ⇒ current plan summary + "Manage subscription" → `createBillingPortalSession()`. Keystone card styling. When `!stripeConfigured`, render a muted "Billing is not available yet." state (server passes a `configured` flag).

- [ ] **Step 4: Mount in `settings/page.tsx`** — add a server read of `org_subscriptions` (service client, admin-only, mirrors the AI card gating) + `planCatalog()`, and render `<BillingForm .../>` inside the admin masonry near the "AI — Organization" card.

- [ ] **Step 5: Run tests** — Run: `pnpm vitest run src/components/settings/BillingForm.test.tsx` — Expected: PASS.

- [ ] **Step 6: Commit** — `git add src/components/settings/BillingForm.tsx src/components/settings/BillingForm.test.tsx "src/app/(app)/settings/page.tsx" && git commit -m "feat(billing): settings billing card"`

---

## TASK TRACK B — F17 Usage dashboard + digest narrative

### Task 8: Usage-summary + narrative migration

**Interfaces:**

- Consumes: `ai_usage` + `ai_usage_org_created_idx`, `digest_runs`, `has_org_role`.
- Produces: `ai_usage_summary(p_org, p_from, p_to)` fn; `digest_runs.narrative` column; regenerated types.

**Files:**

- Create: `supabase/migrations/<stamp>_usage_summary_and_digest_narrative.sql` (via `scripts/new-migration.sh usage_summary_and_digest_narrative`)
- Modify: `src/types/database.types.ts`

- [ ] **Step 1: Mint** — Run: `scripts/new-migration.sh usage_summary_and_digest_narrative`.

- [ ] **Step 2: Author the SQL**

```sql
-- E6 F17: bounded monthly usage rollup + cached digest narrative.
alter table public.digest_runs add column if not exists narrative text;

-- Per-month rollup over the (org_id, created_at) index. Service-role only,
-- mirroring the E1 ai_usage functions' grants. Bounded by the [from,to] window.
create or replace function public.ai_usage_summary(
  p_org uuid, p_from timestamptz, p_to timestamptz
) returns table (month timestamptz, credits numeric, cost_usd numeric, calls integer)
language sql security definer set search_path = public as $$
  select date_trunc('month', created_at) as month,
         coalesce(sum(credits), 0) as credits,
         coalesce(sum(cost_usd), 0) as cost_usd,
         count(*)::integer as calls
  from public.ai_usage
  where org_id = p_org and created_at >= p_from and created_at < p_to
  group by 1 order by 1;
$$;

create or replace function public.ai_usage_by_feature_this_month(p_org uuid)
returns table (feature text, credits numeric, calls integer)
language sql security definer set search_path = public as $$
  select feature, coalesce(sum(credits), 0) as credits, count(*)::integer as calls
  from public.ai_usage
  where org_id = p_org and created_at >= date_trunc('month', now())
  group by feature order by 2 desc;
$$;

revoke all on function public.ai_usage_summary(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.ai_usage_by_feature_this_month(uuid) from public, anon, authenticated;
grant execute on function public.ai_usage_summary(uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.ai_usage_by_feature_this_month(uuid) to service_role;
```

- [ ] **Step 3: Apply to DEV** via `supabase-dev` `apply_migration` (same version+name), verify with `list_migrations`, reconcile on drift.

- [ ] **Step 4: Regenerate types** — Run: `pnpm db:types`.

- [ ] **Step 5: Advisors** — `get_advisors` (security definer + index coverage).

- [ ] **Step 6: Commit** — `git add supabase/migrations/*usage_summary_and_digest_narrative.sql src/types/database.types.ts && git commit -m "feat(usage): monthly rollup fns + digest narrative column"`

---

### Task 9: Usage summary read module

**Interfaces:**

- Consumes: Task 8 RPCs, `createServiceClient`, `getAiEntitlement`.
- Produces: `getUsageSummary(orgId)` → `{ entitlement, months, features }`.

**Files:**

- Create: `src/lib/ai/usage-summary.ts`
- Test: `src/lib/ai/usage-summary.test.ts`

- [ ] **Step 1: Write the failing test** — mock the service client's `rpc` for both functions + `getAiEntitlement`; assert `getUsageSummary` returns the 6-month window bound and the shaped result.

- [ ] **Step 2: Run it, confirm it fails** — Run: `pnpm vitest run src/lib/ai/usage-summary.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/ai/usage-summary.ts`** — `server-only`; compute `from = date_trunc('month', now()) - 5 months`, `to = now()+1month`; call `ai_usage_summary` + `ai_usage_by_feature_this_month`; fetch `getAiEntitlement(orgId)`; return `{ entitlement: { creditsUsed, creditsLimit, mode, tier }, months, features }`. Never serialize `Infinity` (BYO/per_user unmetered) — coerce to `null` like the entitlement code does.

- [ ] **Step 4: Run tests** — Run: `pnpm vitest run src/lib/ai/usage-summary.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit** — `git add src/lib/ai/usage-summary.ts src/lib/ai/usage-summary.test.ts && git commit -m "feat(usage): bounded monthly usage summary read"`

---

### Task 10: Usage dashboard UI

**Interfaces:**

- Consumes: Task 9 `getUsageSummary`, recharts/shadcn charts, `pulse-ui`.
- Produces: `UsageDashboard` card in `/settings` for admins.

**Files:**

- Create: `src/components/settings/UsageDashboard.tsx`
- Test: `src/components/settings/UsageDashboard.test.tsx`
- Modify: `src/app/(app)/settings/page.tsx`

- [ ] **Step 0: Load `pulse-ui` + `frontend-design`.**

- [ ] **Step 1: Write the failing test** — render with a fixture summary → shows "credits used / limit", a per-feature list, a 6-month trend; range toggle (this-month vs 6-month) flips **client-side** with no action call.

- [ ] **Step 2: Run it, confirm it fails** — Run: `pnpm vitest run src/components/settings/UsageDashboard.test.tsx` — Expected: FAIL.

- [ ] **Step 3: Implement `UsageDashboard.tsx`** — client component fed the server-preloaded 6-month window; quota meter (used/limit; "unmetered" for BYO/per_user); per-feature bar; trend line via the existing chart battery. The month/range toggle operates on preloaded data only (0 round-trips, per the budget). Keystone styling.

- [ ] **Step 4: Mount in `settings/page.tsx`** — server-call `getUsageSummary(org.id)` (admin-only) and render `<UsageDashboard/>` in the admin masonry.

- [ ] **Step 5: Run tests** — Run: `pnpm vitest run src/components/settings/UsageDashboard.test.tsx` — Expected: PASS.

- [ ] **Step 6: Commit** — `git add src/components/settings/UsageDashboard.tsx src/components/settings/UsageDashboard.test.tsx "src/app/(app)/settings/page.tsx" && git commit -m "feat(usage): settings usage dashboard card"`

---

### Task 11: Digest narrative generator

**Interfaces:**

- Consumes: E1 `runAi` (`src/lib/ai/gateway.ts`), `readOrgAiSettings`, `requireAiEntitlement`, digest `totals`/`boards` shapes (`DigestBoardRow`).
- Produces: `generateDigestNarrative(orgId, boards, totals)` → `string | null` (null = skip/failed).

**Files:**

- Create: `src/lib/digest/narrative.ts`
- Test: `src/lib/digest/narrative.test.ts`

- [ ] **Step 1: Write the failing test** — mock `readOrgAiSettings` + `runAi`: (a) `managed` mode → returns a string; (b) `per_user`/`off` mode → returns `null` without calling `runAi` (no session user in cron); (c) `runAi` throws → returns `null` (non-fatal).

```ts
it("skips per_user mode (no session user in cron)", async () => {
  // mock readOrgAiSettings -> { mode: "per_user" }
  const res = await generateDigestNarrative("org-1", [], {
    newCount: 1,
    incompleteCount: 0,
    overdueCount: 0,
  });
  expect(res).toBeNull();
});
it("returns null and swallows a runAi failure", async () => {
  // mock mode "managed"; runAi rejects
  const res = await generateDigestNarrative("org-1", boards, totals);
  expect(res).toBeNull();
});
```

- [ ] **Step 2: Run it, confirm it fails** — Run: `pnpm vitest run src/lib/digest/narrative.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `src/lib/digest/narrative.ts`**

```ts
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { readOrgAiSettings } from "@/lib/ai/org-settings";
import { runAi } from "@/lib/ai/gateway";
import { requireAiEntitlement } from "@/lib/ai/entitlement";
import type { DigestBoardRow } from "@/lib/validations/digest";

type Totals = {
  newCount: number;
  incompleteCount: number;
  overdueCount: number;
};

/**
 * One short, calm narrative paragraph for the weekly digest. Runs ONLY for
 * managed/org_byo orgs — the cron has no session user, so per_user/off are
 * skipped (plain digest). Never throws: any failure returns null and the
 * digest sends unchanged. Snapshot is board NAMES + counts only (no raw cells).
 */
export async function generateDigestNarrative(
  orgId: string,
  boards: DigestBoardRow[],
  totals: Totals,
): Promise<string | null> {
  try {
    const svc = createServiceClient();
    const settings = await readOrgAiSettings(svc, orgId);
    if (settings.mode !== "managed" && settings.mode !== "org_byo") return null;
    await requireAiEntitlement(orgId, "digest_narrative");

    const snapshot = {
      totals,
      boards: boards.slice(0, 30).map((b) => ({
        name: b.boardName,
        overdue: b.overdueItems,
        incomplete: b.incompleteItems,
        new: b.newItems,
      })),
    };
    return await runAi(
      {
        orgId,
        userId: settings.updatedBy ?? orgId,
        feature: "digest_narrative",
      },
      async (resolved) => {
        const { text, usage, model } = await resolved.adapter.complete({
          apiKey: resolved.apiKey,
          system:
            "You write one calm, concrete sentence or two summarizing a team's week. No hype, no emojis.",
          prompt: `Summarize this weekly work snapshot in <=45 words:\n${JSON.stringify(snapshot)}`,
        });
        return { result: text.trim(), usage, model };
      },
    );
  } catch {
    return null; // non-fatal — the digest must still send
  }
}
```

(Confirm the exact adapter call surface against `src/lib/ai/providers/types.ts` / how `generate.ts` invokes the adapter while implementing; match that signature. `settings.updatedBy` may need adding to `OrgAiSettings` — if not present, pass `orgId` as the ledger `user_id` sentinel for system calls, or extend `readOrgAiSettings` to select `updated_by`.)

- [ ] **Step 4: Run tests** — Run: `pnpm vitest run src/lib/digest/narrative.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit** — `git add src/lib/digest/narrative.ts src/lib/digest/narrative.test.ts && git commit -m "feat(digest): metered, gated, non-fatal narrative generator"`

---

### Task 12: Wire narrative into the digest run + renderers

**Interfaces:**

- Consumes: Task 11 `generateDigestNarrative`, Task 8 `digest_runs.narrative`, `DigestEmailInput`.
- Produces: narrative persisted on the run + rendered in HTML/text.

**Files:**

- Modify: `src/lib/digest/run.ts` (`processOrg`)
- Modify: `src/lib/digest/render.ts`
- Test: `src/lib/digest/render.test.ts` (extend) + `src/lib/digest/run.test.ts` (extend)

- [ ] **Step 1: Write the failing renderer test** — extend `render.test.ts`: `renderDigestHtml`/`renderDigestText` with `narrative: "Foo bar."` includes it; without it, output is unchanged (byte-for-byte on the non-narrative path).

- [ ] **Step 2: Run it, confirm it fails** — Run: `pnpm vitest run src/lib/digest/render.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** — add optional `narrative?: string` to `DigestEmailInput`; render it as a lead `<p>` (HTML) / first line (text) when present. In `processOrg` (`run.ts`): after computing `totals`/`boards` and **before** the "skipped" early-return branch is not required — generate narrative on the send path only (after the skip check), call `generateDigestNarrative(org.id, boards, totals)`, store it in the `digest_runs` `update({ ..., narrative })` on the "sent" branch, and pass it into the `sendEmails` render input.

- [ ] **Step 4: Extend `run.test.ts`** — assert a `managed`-mode org's sent run persists a narrative (mock `generateDigestNarrative`), and a failure/`null` still sends.

- [ ] **Step 5: Run tests** — Run: `pnpm vitest run src/lib/digest/` — Expected: PASS.

- [ ] **Step 6: Commit** — `git add src/lib/digest/run.ts src/lib/digest/render.ts src/lib/digest/render.test.ts src/lib/digest/run.test.ts && git commit -m "feat(digest): render + persist weekly narrative"`

---

### Task 13: Opt-in integration tests (DEV DB)

**Interfaces:**

- Consumes: Task 3/8 schema, `applyStripeEvent`, `getUsageSummary`, `PULSE_TEST_DB` gating.
- Produces: rolled-back-txn integration coverage that the sync mutates real entitlement + the rollup reads over the index.

**Files:**

- Create: `src/lib/stripe/sync.rls.integration.test.ts`
- Create: `src/lib/ai/usage-summary.integration.test.ts`

- [ ] **Step 1: Write the tests** — follow the existing opt-in pattern (`org_ai_settings.rls.integration.test.ts`): `describe.skipIf(!process.env.PULSE_TEST_DB)`, seed an org, run `applyStripeEvent` (active → assert `org_ai_settings.tier`/`monthly_credit_limit`/`ai_mode` mutated; deleted → reverted), and insert `ai_usage` rows then assert `ai_usage_summary` monthly aggregates. All inside a rolled-back transaction (no DEV pollution).

- [ ] **Step 2: Run with the flag** — Run: `PULSE_TEST_DB=1 pnpm vitest run src/lib/stripe/sync.rls.integration.test.ts src/lib/ai/usage-summary.integration.test.ts` — Expected: PASS. (CI leaves them SKIPPED.)

- [ ] **Step 3: Commit** — `git add src/lib/stripe/sync.rls.integration.test.ts src/lib/ai/usage-summary.integration.test.ts && git commit -m "test(billing,usage): opt-in DEV integration coverage"`

---

## Execution DAG (AGENTS.md #6)

**Dependency edges (from Consumes/Produces):**

- T1 (client+env) → T2, T4, T5, T6
- T2 (catalog) → T4, T5, T7
- T3 (billing migration) → T4, T5, T6, T7, T13
- T4 (sync) → T6, T13
- T5 (checkout actions) → T7
- T6 (webhook) → (T13)
- T7 (billing UI) → settings mount
- T8 (usage/digest migration) → T9, T11, T12, T13
- T9 (usage read) → T10, T13
- T10 (usage UI) → settings mount
- T11 (narrative gen) → T12
- T12 (wire narrative) → —

**Parallel batches (waves of concurrent subagents):**

- **Batch 1 (no unmet deps):** T1, T2, T3, T8. _(T3 and T8 both touch `supabase/migrations/` + regen types — mint both via `scripts/new-migration.sh`, apply/regen serially to avoid a version collision and a types-regen race; author the SQL in parallel.)_
- **Batch 2:** T4, T5, T9, T11. _(F16 sync/checkout + F17 usage-read/narrative — disjoint files.)_
- **Batch 3:** T6, T7, T10, T12. _(webhook, billing UI, usage UI, narrative wiring — disjoint; T7 & T10 both edit `settings/page.tsx`, so serialize those two edits or hand both to one subagent.)_
- **Batch 4:** T13 (integration) + the final full gate.

**Critical path (wall-clock floor):** `T1 → T3 → T4 → T6 → T13` (the F16 webhook chain), length 5. F17's longest chain `T8 → T11 → T12` (length 3) and `T8 → T9 → T10` run fully in parallel under it. So E6's floor ≈ the 5-task billing chain; F17 adds no wall-clock beyond it.

**Shared-file serialization notes:** `settings/page.tsx` is edited by T7 and T10 → serialize (or one subagent does both mounts). `supabase/migrations/` + `database.types.ts` touched by T3 and T8 → serialize the apply + regen (gotcha-43/gotcha-55). `env.server.ts` only T1. `org_ai_settings` write path is F16-only (sync) on this branch; the read side is untouched, so E2–E5 in sibling worktrees are unaffected.

---

## Performance & data-fetching budget (AGENTS.md #5)

- **First paint** `/settings`: `BillingForm` (subscription status) + `UsageDashboard` (6-month rollup) each read once server-side. No client fetch on mount.
- **Checkout/portal:** one Server Action per explicit click → redirect to Stripe. Never a view toggle.
- **Usage range toggle:** client state over the preloaded 6-month window, 0 new round-trips (History API `replaceState` only if URL-reflected). A request beyond the window = one Server Action.
- **Bounded/indexed:** `ai_usage_summary` aggregates over `ai_usage_org_created_idx (org_id, created_at)` with an explicit `[from,to]` bound + `date_trunc('month')` grouping — no unbounded `select *`. Webhook writes are O(1) upserts keyed by `org_id`/`event_id`.
- **Narrative:** generated once per (org, week) inside the idempotent `digest_runs` claim and cached on the row — 0 per-recipient/per-view AI calls; rides the existing weekly cron (no new schedule/service).

---

## Closure

- **Definition of done:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green → `scripts/finish-task.sh` merges `task/e6-billing` into `develop` and cleans up.
- **How to test (user walkthrough)** — F17 is testable immediately (Anthropic key already in env); F16 needs the Stripe setup from spec §8. Provide, at closure: (1) F17 — trigger a digest run for a `managed`-mode org and confirm the email/`digest_runs.narrative`; open `/settings` and confirm the Usage card shows credits-used/limit + trend. (2) F16 — once Stripe env is set: `/settings` → Billing → Subscribe → complete Stripe test checkout → confirm the org's tier/limit updated (webhook via `stripe listen` locally) → "Manage subscription" opens the portal → cancel → tier reverts to `none`/`per_user`.
- **Not-yet-testable flag:** F16 end-to-end is **blocked on the user providing the Stripe account + Prices + env vars + webhook endpoint** (spec §8). Say so explicitly at handoff.

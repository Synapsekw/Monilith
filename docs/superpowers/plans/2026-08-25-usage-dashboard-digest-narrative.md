# F17 — AI usage breakdown + weekly-digest narrative — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. UI tasks additionally require the `pulse-ui` skill.

**Goal:** Surface existing `ai_usage` spend as a per-feature/6-month breakdown card on `/settings/ai`, and add a short AI-generated narrative to the existing weekly digest (email + in-app notification), without touching billing/entitlement semantics or building new metering.

**Architecture:** Two new bounded, indexed SQL rollup functions read `ai_usage` over `ai_usage_org_created_idx`; a new `getUsageSummary()` read module feeds a new `UsageBreakdown` client card mounted on the existing `/settings/ai` page. A new `generateDigestNarrative()` — an adapter-agnostic `generateStructured` call copying the already-shipped `draftReportNarrative` pattern — runs once per (org, week) inside the existing idempotent `digest_runs` claim, is cached on a new `digest_runs.narrative` column, and rides into both the email render and the `notifications` payload.

**Tech Stack:** Next.js 16 (App Router, Server Components), Supabase (Postgres + RLS, service role), Zod, Vitest, recharts (already a dependency), Tailwind v4 (Keystone).

**Spec:** `docs/superpowers/specs/2026-08-25-usage-dashboard-digest-narrative-design.md`

**Reference reading before coding:** `src/lib/ai/gateway.ts` (`runAi`, `ResolvedAiCall`), `src/lib/ai/entitlement.ts` (`getAiEntitlement`, `requireAiEntitlement`), `src/lib/reports/ai-actions.ts` + `src/lib/reports/ai-draft.ts` + `src/lib/reports/ai-draft-schema.ts` (the narrative-generation pattern to copy), `src/lib/digest/run.ts` + `src/lib/digest/render.ts` + `src/lib/validations/digest.ts`, `src/app/(app)/settings/ai/page.tsx` + `src/components/settings/OrgAiSettingsForm.tsx` (existing credits meter — do not duplicate), `src/lib/supabase/typed-rpc.ts`.

## Global Constraints

- Reuse `getAiEntitlement`/`requireAiEntitlement` — never re-derive credits-used/limit.
- Every new RPC is `SECURITY DEFINER`, `revoke all ... from public, anon, authenticated`, `grant execute ... to service_role` — mirrors `ai_credits_used_this_month`'s grants exactly.
- Every new hot-path read is bounded + scans `ai_usage_org_created_idx (org_id, created_at)` with an explicit `[from, to)` window — no unbounded `select *`.
- `runAi`'s callback receives `(resolved: ResolvedAiCall, reportUsage)` and returns `Promise<{ result: T; usage: AiUsageTokens }>` — there is no `.complete()` method. Free-text generation goes through `adapter.generateStructured<T>({ ...toRequestArgs(opts), system, user, schema })` with a JSON schema, exactly like `draftReportNarrative`.
- `generateDigestNarrative` must never throw — any failure (entitlement, provider, parse) returns `null` and the digest sends unchanged.
- The narrative rides BOTH the email render (`DigestEmailInput.narrative`) AND the `notifications` payload (`digestNotificationPayloadSchema.narrative`) — prod currently ships no `RESEND_API_KEY`, so the in-app path is the one real users see today.
- Commit identity: `Danijel Jovanovic <info@synapse-solutions.ai>` (already pinned by `start-task.sh`).

---

## File Structure

New:

- `supabase/migrations/<stamp>_usage_summary_and_digest_narrative.sql`
- `src/lib/ai/usage-summary.ts` + `.test.ts`
- `src/lib/ai/usage-summary.integration.test.ts` (opt-in, `PULSE_TEST_DB`)
- `src/components/settings/UsageBreakdown.tsx` + `.test.tsx`
- `src/lib/digest/narrative-schema.ts`
- `src/lib/digest/narrative.ts` + `.test.ts`

Modified:

- `src/types/database.types.ts` (regenerated)
- `src/app/(app)/settings/ai/page.tsx` (mount `UsageBreakdown`)
- `src/lib/digest/render.ts` + `.test.ts` (optional `narrative` field)
- `src/lib/digest/run.ts` + `.test.ts` (call generator, persist, fold into notification payload)
- `src/lib/validations/digest.ts` (`digestNotificationPayloadSchema` gains optional `narrative`)
- `src/components/notifications/NotificationsList.tsx` + `.test.tsx` (render narrative when present)
- `src/lib/ai/model-map.ts` (register `digest_narrative: "standard"` feature tier)

---

## Task 1: Migration — rollup RPCs + narrative column

**Interfaces:**

- Consumes: `ai_usage` (+ `ai_usage_org_created_idx`), `digest_runs`.
- Produces: `ai_usage_summary(p_org uuid, p_from timestamptz, p_to timestamptz)` → `table(month timestamptz, credits numeric, cost_usd numeric, calls integer)`; `ai_usage_by_feature_this_month(p_org uuid)` → `table(feature text, credits numeric, calls integer)`; `digest_runs.narrative text` (nullable).

**Files:**

- Create: `supabase/migrations/<stamp>_usage_summary_and_digest_narrative.sql` (via `scripts/new-migration.sh usage_summary_and_digest_narrative`)
- Modify: `src/types/database.types.ts`

- [ ] **Step 1: Mint the migration**

Run: `scripts/new-migration.sh usage_summary_and_digest_narrative`. Note the printed `<stamp>`.

- [ ] **Step 2: Author the SQL**

```sql
-- F17: bounded monthly usage rollup + cached digest narrative.
alter table public.digest_runs add column if not exists narrative text;

-- 6-month rollup over ai_usage_org_created_idx (org_id, created_at), bounded
-- by the caller's [from, to) window. Service-role only, mirroring
-- ai_credits_used_this_month's grants.
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

-- This-month per-feature breakdown, same index, bounded to the current month.
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

- [ ] **Step 3: Apply to DEV** — via `supabase-dev` MCP `apply_migration`, passing the SAME version stamp + name as the committed file. Verify with `list_migrations`. If the ledger stamp drifts from the filename, run `scripts/reconcile-migration-version.sh`.

- [ ] **Step 4: Regenerate types** — In a task worktree `pnpm db:types` throws `LegacyProjectNotLinkedError` (known gotcha). Instead: call the `supabase-dev` MCP `generate_typescript_types` tool, then run `pnpm prettier --write src/types/database.types.ts`.

- [ ] **Step 5: Verify the ledger** — Run: `pnpm db:ledger-check` — Expected: clean (no drift either direction).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/*usage_summary_and_digest_narrative.sql src/types/database.types.ts
git commit -m "feat(usage): monthly rollup fns + digest narrative column"
```

---

## Task 2: Usage summary read module

**Interfaces:**

- Consumes: Task 1's `ai_usage_summary`/`ai_usage_by_feature_this_month` (via `typedRpc`), `getAiEntitlement` (`src/lib/ai/entitlement.ts`), `createServiceClient` (`src/lib/supabase/service.ts`).
- Produces: `getUsageSummary(orgId: string): Promise<UsageSummary>` where
  ```ts
  export type UsageSummary = {
    entitlement: {
      mode: AiMode;
      tier: string;
      creditsUsed: number;
      creditsLimit: number | null; // null = unmetered (Infinity coerced)
    };
    months: {
      month: string;
      credits: number;
      costUsd: number;
      calls: number;
    }[];
    features: { feature: string; credits: number; calls: number }[];
  };
  ```

**Files:**

- Create: `src/lib/ai/usage-summary.ts`
- Test: `src/lib/ai/usage-summary.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({}) }));
vi.mock("@/lib/supabase/typed-rpc", () => ({ typedRpc: vi.fn() }));
vi.mock("@/lib/ai/entitlement", () => ({ getAiEntitlement: vi.fn() }));

import { typedRpc } from "@/lib/supabase/typed-rpc";
import { getAiEntitlement } from "@/lib/ai/entitlement";
import { getUsageSummary } from "@/lib/ai/usage-summary";

describe("getUsageSummary", () => {
  it("shapes the 6-month rollup, per-feature breakdown, and entitlement", async () => {
    vi.mocked(getAiEntitlement).mockResolvedValue({
      mode: "managed",
      tier: "pro",
      creditsLimit: 1000,
      creditsUsed: 250,
      creditsRemaining: 750,
    });
    vi.mocked(typedRpc).mockImplementation(async (_client, fn) => {
      if (fn === "ai_usage_summary") {
        return {
          data: [
            {
              month: "2026-08-01T00:00:00Z",
              credits: 250,
              cost_usd: 1.5,
              calls: 10,
            },
          ],
          error: null,
        };
      }
      if (fn === "ai_usage_by_feature_this_month") {
        return {
          data: [{ feature: "ask_pulse", credits: 200, calls: 8 }],
          error: null,
        };
      }
      throw new Error(`unexpected rpc ${fn}`);
    });

    const summary = await getUsageSummary("org-1");

    expect(summary.entitlement).toEqual({
      mode: "managed",
      tier: "pro",
      creditsUsed: 250,
      creditsLimit: 1000,
    });
    expect(summary.months).toEqual([
      { month: "2026-08-01T00:00:00Z", credits: 250, costUsd: 1.5, calls: 10 },
    ]);
    expect(summary.features).toEqual([
      { feature: "ask_pulse", credits: 200, calls: 8 },
    ]);
  });

  it("coerces an unmetered (Infinity) credits limit to null", async () => {
    vi.mocked(getAiEntitlement).mockResolvedValue({
      mode: "org_byo",
      tier: "none",
      creditsLimit: 0,
      creditsUsed: 0,
      creditsRemaining: Infinity,
    });
    vi.mocked(typedRpc).mockResolvedValue({ data: [], error: null });

    const summary = await getUsageSummary("org-1");
    expect(summary.entitlement.creditsLimit).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm vitest run src/lib/ai/usage-summary.test.ts` — Expected: FAIL (module doesn't exist).

- [ ] **Step 3: Implement `src/lib/ai/usage-summary.ts`**

```ts
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import { getAiEntitlement, type AiEntitlement } from "@/lib/ai/entitlement";

export type UsageSummary = {
  entitlement: {
    mode: AiEntitlement["mode"];
    tier: string;
    creditsUsed: number;
    /** null = unmetered (org_byo/per_user/off — getAiEntitlement returns Infinity there). */
    creditsLimit: number | null;
  };
  months: { month: string; credits: number; costUsd: number; calls: number }[];
  features: { feature: string; credits: number; calls: number }[];
};

/**
 * Bounded usage read for the /settings/ai admin card: a 6-month rollup
 * (current month + 5 prior) plus this month's per-feature breakdown, both
 * scanning ai_usage_org_created_idx with an explicit window — no unbounded
 * select. `creditsLimit` mirrors managed mode's ceiling; org_byo/per_user/off
 * are unmetered (getAiEntitlement's creditsRemaining is Infinity there),
 * coerced to null because Infinity does not survive JSON serialization.
 */
export async function getUsageSummary(orgId: string): Promise<UsageSummary> {
  const svc = createServiceClient();
  const now = new Date();
  const from = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1),
  );
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const [entitlement, monthsRes, featuresRes] = await Promise.all([
    getAiEntitlement(orgId),
    typedRpc(svc, "ai_usage_summary", {
      p_org: orgId,
      p_from: from.toISOString(),
      p_to: to.toISOString(),
    }),
    typedRpc(svc, "ai_usage_by_feature_this_month", { p_org: orgId }),
  ]);
  if (monthsRes.error) throw monthsRes.error;
  if (featuresRes.error) throw featuresRes.error;

  return {
    entitlement: {
      mode: entitlement.mode,
      tier: entitlement.tier,
      creditsUsed: entitlement.creditsUsed,
      creditsLimit: Number.isFinite(entitlement.creditsRemaining)
        ? entitlement.creditsLimit
        : null,
    },
    months: (monthsRes.data ?? []).map((r) => ({
      month: r.month as string,
      credits: Number(r.credits),
      costUsd: Number(r.cost_usd),
      calls: r.calls,
    })),
    features: (featuresRes.data ?? []).map((r) => ({
      feature: r.feature as string,
      credits: Number(r.credits),
      calls: r.calls,
    })),
  };
}
```

- [ ] **Step 4: Run tests** — Run: `pnpm vitest run src/lib/ai/usage-summary.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/usage-summary.ts src/lib/ai/usage-summary.test.ts
git commit -m "feat(usage): bounded monthly usage summary read"
```

---

## Task 3: Usage breakdown UI, mounted on `/settings/ai`

**Interfaces:**

- Consumes: Task 2's `getUsageSummary(orgId)` / `UsageSummary` type, `isOrgAdminCached`, `resolveActiveOrg`, `requireUser` (all already imported in `settings/ai/page.tsx`).
- Produces: `<UsageBreakdown summary={UsageSummary} />` — a card admins see below the existing `OrgAiSettingsForm`.

**Files:**

- Create: `src/components/settings/UsageBreakdown.tsx`
- Test: `src/components/settings/UsageBreakdown.test.tsx`
- Modify: `src/app/(app)/settings/ai/page.tsx`

- [ ] **Step 0: Load the `pulse-ui` skill** before writing any markup/styling.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UsageBreakdown } from "@/components/settings/UsageBreakdown";
import type { UsageSummary } from "@/lib/ai/usage-summary";

const summary: UsageSummary = {
  entitlement: {
    mode: "managed",
    tier: "pro",
    creditsUsed: 250,
    creditsLimit: 1000,
  },
  months: [
    { month: "2026-03-01T00:00:00Z", credits: 100, costUsd: 0.5, calls: 5 },
    { month: "2026-08-01T00:00:00Z", credits: 250, costUsd: 1.5, calls: 10 },
  ],
  features: [
    { feature: "ask_pulse", credits: 200, calls: 8 },
    { feature: "item_assist", credits: 50, calls: 20 },
  ],
};

describe("UsageBreakdown", () => {
  it("renders per-feature credits and the 6-month trend by default", () => {
    render(<UsageBreakdown summary={summary} />);
    expect(screen.getByText("ask_pulse")).toBeInTheDocument();
    expect(screen.getByText("item_assist")).toBeInTheDocument();
    // 6-month view is the default range.
    expect(screen.getByRole("button", { name: /6 months/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("switches to this-month range with no new data (pure client toggle)", () => {
    render(<UsageBreakdown summary={summary} />);
    fireEvent.click(screen.getByRole("button", { name: /this month/i }));
    expect(screen.getByRole("button", { name: /this month/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Still the same preloaded feature list — no fetch, no unmount of data.
    expect(screen.getByText("ask_pulse")).toBeInTheDocument();
  });

  it("shows unmetered instead of a ratio when creditsLimit is null", () => {
    render(
      <UsageBreakdown
        summary={{
          ...summary,
          entitlement: { ...summary.entitlement, creditsLimit: null },
        }}
      />,
    );
    expect(screen.getByText(/unmetered/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm vitest run src/components/settings/UsageBreakdown.test.tsx` — Expected: FAIL.

- [ ] **Step 3: Implement `UsageBreakdown.tsx`**

A client component. Structure (follow `pulse-ui` tokens — dark-first monochrome + periwinkle accent, `SettingsSection`/`SettingRow` primitives already used on this page):

```tsx
"use client";
import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { UsageSummary } from "@/lib/ai/usage-summary";

type Range = "month" | "6months";

/** Per-feature breakdown + 6-month trend, fed the server-preloaded summary.
 *  The range toggle is pure client state — 0 new round-trips per AGENTS.md
 *  working agreement #5 (data is already preloaded for both ranges). */
export function UsageBreakdown({ summary }: { summary: UsageSummary }) {
  const [range, setRange] = useState<Range>("6months");
  const { entitlement, months, features } = summary;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          {entitlement.creditsLimit === null
            ? "Usage this month — unmetered"
            : `${entitlement.creditsUsed} / ${entitlement.creditsLimit} credits this month`}
        </p>
        <div className="flex gap-1" role="group" aria-label="Usage range">
          <button
            type="button"
            aria-pressed={range === "month"}
            className={`rounded-md px-2 py-1 text-xs ${range === "month" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-state-hover"}`}
            onClick={() => setRange("month")}
          >
            This month
          </button>
          <button
            type="button"
            aria-pressed={range === "6months"}
            className={`rounded-md px-2 py-1 text-xs ${range === "6months" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-state-hover"}`}
            onClick={() => setRange("6months")}
          >
            6 months
          </button>
        </div>
      </div>

      {range === "month" ? (
        <div className="space-y-1.5">
          {features.length === 0 && (
            <p className="text-muted-foreground text-xs">
              No AI activity yet this month.
            </p>
          )}
          {features.map((f) => (
            <div
              key={f.feature}
              className="flex items-center justify-between text-xs"
            >
              <span className="text-muted-foreground">{f.feature}</span>
              <span>
                {f.credits.toFixed(0)} credits · {f.calls} calls
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="h-40 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={months}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis
                dataKey="month"
                tickFormatter={(m: string) =>
                  new Date(m).toLocaleDateString(undefined, { month: "short" })
                }
                fontSize={11}
              />
              <YAxis fontSize={11} />
              <Tooltip
                labelFormatter={(m: string) =>
                  new Date(m).toLocaleDateString(undefined, {
                    month: "long",
                    year: "numeric",
                  })
                }
              />
              <Line
                type="monotone"
                dataKey="credits"
                stroke="var(--color-primary)"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
```

(The `BarChart` import above is unused if the per-feature list stays a plain row list rather than a bar chart — drop it, or switch the per-feature block to a `BarChart` if that reads better once you see it rendered; either satisfies the test, which only checks for feature-name text and the toggle's `aria-pressed` state.)

- [ ] **Step 4: Mount in `settings/ai/page.tsx`** — inside the existing `isAdmin && orgAi.ok` block, alongside `OrgAiSettingsForm`:

```tsx
import { getUsageSummary } from "@/lib/ai/usage-summary";
import { UsageBreakdown } from "@/components/settings/UsageBreakdown";
```

Fetch it in the same `Promise.all` that already loads `credentials, providers, orgAi, isAdmin` — but only when `isAdmin` is known, so gate it after that resolves (matches the page's existing "only an admin pays for the catalog reads" pattern): after computing `isAdmin`, if `isAdmin`, `await getUsageSummary(org.id)` once; render a new `SettingsSection` ("Usage", "Where this month's AI spend is going.") containing `<UsageBreakdown summary={usage} />` directly below the "Organization AI" section.

- [ ] **Step 5: Run tests** — Run: `pnpm vitest run src/components/settings/UsageBreakdown.test.tsx` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/UsageBreakdown.tsx src/components/settings/UsageBreakdown.test.tsx "src/app/(app)/settings/ai/page.tsx"
git commit -m "feat(usage): usage breakdown card on settings/ai"
```

---

## Task 4: Digest narrative generator

**Interfaces:**

- Consumes: `runAi` (`src/lib/ai/gateway.ts`), `readOrgAiSettings` (`src/lib/ai/org-settings.ts`), `requireAiEntitlement` (`src/lib/ai/entitlement.ts`), `toRequestArgs` (`src/lib/ai/providers/request.ts`), `createServiceClient`, `DigestBoardRow` (`src/lib/validations/digest.ts`).
- Produces: `generateDigestNarrative(orgId: string, boards: DigestBoardRow[], totals: Totals): Promise<string | null>` where `Totals = { newCount: number; incompleteCount: number; overdueCount: number }`.

**Files:**

- Create: `src/lib/digest/narrative-schema.ts`
- Create: `src/lib/digest/narrative.ts`
- Test: `src/lib/digest/narrative.test.ts`
- Modify: `src/lib/ai/model-map.ts` (register the feature tier)

- [ ] **Step 1: Register the feature tier** — in `src/lib/ai/model-map.ts`, add `digest_narrative: "standard",` to `FEATURE_TIERS` (alongside `report_narrative` in the "Structured generation" group).

- [ ] **Step 2: Write `narrative-schema.ts`**

```ts
import { z } from "zod";

export const DIGEST_NARRATIVE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["narrative"],
  properties: {
    narrative: { type: "string" },
  },
} as const;

export const digestNarrativeSchema = z.object({
  narrative: z.string().max(400),
});
```

- [ ] **Step 3: Write the failing test** `src/lib/digest/narrative.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({}) }));
vi.mock("@/lib/ai/org-settings", () => ({ readOrgAiSettings: vi.fn() }));
vi.mock("@/lib/ai/entitlement", () => ({ requireAiEntitlement: vi.fn() }));
vi.mock("@/lib/ai/gateway", () => ({ runAi: vi.fn() }));

import { readOrgAiSettings } from "@/lib/ai/org-settings";
import { requireAiEntitlement } from "@/lib/ai/entitlement";
import { runAi } from "@/lib/ai/gateway";
import { generateDigestNarrative } from "@/lib/digest/narrative";

const boards = [
  {
    boardId: "11111111-1111-4111-8111-111111111111",
    boardName: "Launch",
    totalItems: 5,
    doneItems: 1,
    overdueItems: 2,
    incompleteItems: 3,
    newItems: 1,
    newSample: ["Kickoff"],
    incompleteSample: ["Design"],
  },
];
const totals = { newCount: 1, incompleteCount: 3, overdueCount: 2 };

describe("generateDigestNarrative", () => {
  it("returns a narrative string for managed mode", async () => {
    vi.mocked(readOrgAiSettings).mockResolvedValue({
      mode: "managed",
    } as never);
    vi.mocked(runAi).mockResolvedValue("A calm summary of the week.");
    const res = await generateDigestNarrative("org-1", boards, totals);
    expect(res).toBe("A calm summary of the week.");
    expect(requireAiEntitlement).toHaveBeenCalledWith(
      "org-1",
      "digest_narrative",
    );
  });

  it("returns a narrative string for org_byo mode", async () => {
    vi.mocked(readOrgAiSettings).mockResolvedValue({
      mode: "org_byo",
    } as never);
    vi.mocked(runAi).mockResolvedValue("BYO week summary.");
    const res = await generateDigestNarrative("org-1", boards, totals);
    expect(res).toBe("BYO week summary.");
  });

  it("skips per_user mode (no session user in cron)", async () => {
    vi.mocked(readOrgAiSettings).mockResolvedValue({
      mode: "per_user",
    } as never);
    const res = await generateDigestNarrative("org-1", boards, totals);
    expect(res).toBeNull();
    expect(runAi).not.toHaveBeenCalled();
  });

  it("skips off mode", async () => {
    vi.mocked(readOrgAiSettings).mockResolvedValue({ mode: "off" } as never);
    const res = await generateDigestNarrative("org-1", boards, totals);
    expect(res).toBeNull();
  });

  it("returns null and swallows a runAi failure", async () => {
    vi.mocked(readOrgAiSettings).mockResolvedValue({
      mode: "managed",
    } as never);
    vi.mocked(runAi).mockRejectedValue(new Error("provider down"));
    const res = await generateDigestNarrative("org-1", boards, totals);
    expect(res).toBeNull();
  });

  it("returns null when entitlement is exhausted", async () => {
    vi.mocked(readOrgAiSettings).mockResolvedValue({
      mode: "managed",
    } as never);
    vi.mocked(requireAiEntitlement).mockRejectedValueOnce(new Error("quota"));
    const res = await generateDigestNarrative("org-1", boards, totals);
    expect(res).toBeNull();
  });
});
```

- [ ] **Step 4: Run it, confirm it fails**

Run: `pnpm vitest run src/lib/digest/narrative.test.ts` — Expected: FAIL.

- [ ] **Step 5: Implement `src/lib/digest/narrative.ts`**

```ts
import "server-only";
import { readOrgAiSettings } from "@/lib/ai/org-settings";
import { runAi } from "@/lib/ai/gateway";
import { requireAiEntitlement } from "@/lib/ai/entitlement";
import { createServiceClient } from "@/lib/supabase/service";
import { toRequestArgs } from "@/lib/ai/providers/request";
import {
  DIGEST_NARRATIVE_JSON_SCHEMA,
  digestNarrativeSchema,
} from "@/lib/digest/narrative-schema";
import type { DigestBoardRow } from "@/lib/validations/digest";

type Totals = {
  newCount: number;
  incompleteCount: number;
  overdueCount: number;
};

const SYSTEM =
  "You write one calm, concrete sentence or two summarizing a team's week on a work-management tool. No hype, no emojis, no markdown.";

/**
 * One short narrative paragraph (<=400 chars) for the weekly digest. Runs
 * ONLY for managed/org_byo orgs — the digest cron has no session user, so
 * per_user/off are skipped and the plain digest sends unchanged. Never
 * throws: any failure (entitlement, provider, parse) returns null. Snapshot
 * sent to the model is board NAMES + counts only, capped at 30 boards — no
 * raw cell values, matching draftReportNarrative's privacy posture.
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
      { orgId, userId: orgId, feature: "digest_narrative" },
      async ({ adapter, apiKey, baseUrl, model }) => {
        const { data, usage } = await adapter.generateStructured<{
          narrative?: string;
        }>({
          ...toRequestArgs({ apiKey, baseUrl, model: model.requestModel }),
          system: SYSTEM,
          user: `Summarize this weekly work snapshot in <=45 words:\n${JSON.stringify(snapshot)}`,
          schema: DIGEST_NARRATIVE_JSON_SCHEMA,
        });
        const parsed = digestNarrativeSchema.parse(data);
        return { result: parsed.narrative, usage };
      },
    );
  } catch {
    return null;
  }
}
```

`userId: orgId` is the system-call ledger sentinel — the cron has no session user, and `org_ai_settings` doesn't currently expose `updated_by` through `readOrgAiSettings`'s return type; using the org id keeps `ai_usage.user_id` non-null and attributable to "this org's system calls" without a schema change. (If a reviewer prefers a real user id, `org_ai_settings.updated_by` is selectable — but that's the admin who last touched settings, not necessarily meaningful for a cron run, so the sentinel is the more honest choice.)

- [ ] **Step 6: Run tests** — Run: `pnpm vitest run src/lib/digest/narrative.test.ts` — Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/digest/narrative-schema.ts src/lib/digest/narrative.ts src/lib/digest/narrative.test.ts src/lib/ai/model-map.ts
git commit -m "feat(digest): metered, gated, non-fatal narrative generator"
```

---

## Task 5: Render the narrative in the digest email

**Interfaces:**

- Consumes: nothing new — pure addition to `DigestEmailInput`.
- Produces: `DigestEmailInput.narrative?: string`, rendered as a lead paragraph (HTML) / first line (text).

**Files:**

- Modify: `src/lib/digest/render.ts`
- Test: `src/lib/digest/render.test.ts` (extend)

- [ ] **Step 1: Write the failing test** — append to `src/lib/digest/render.test.ts`:

```ts
describe("renderDigestHtml with a narrative", () => {
  it("includes the narrative as a lead paragraph when present", () => {
    const html = renderDigestHtml({
      ...input,
      narrative: "Great <week> overall.",
    });
    expect(html).toContain("Great &lt;week&gt; overall.");
  });

  it("omits the narrative block entirely when absent (byte-identical to no-narrative path)", () => {
    const withNarrative = renderDigestHtml({ ...input, narrative: undefined });
    expect(withNarrative).toBe(renderDigestHtml(input));
  });
});

describe("renderDigestText with a narrative", () => {
  it("includes the narrative as the first line when present", () => {
    const text = renderDigestText({
      ...input,
      narrative: "Great week overall.",
    });
    expect(text.split("\n")[0]).toBe("Great week overall.");
  });

  it("is unchanged when narrative is absent", () => {
    expect(renderDigestText({ ...input, narrative: undefined })).toBe(
      renderDigestText(input),
    );
  });
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm vitest run src/lib/digest/render.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** — in `render.ts`:

```ts
export type DigestEmailInput = {
  orgName: string;
  periodStart: string;
  totals: { newCount: number; incompleteCount: number; overdueCount: number };
  boards: DigestBoardRow[];
  appBaseUrl: string;
  unsubscribeUrl: string;
  /** AI-generated weekly summary (Task 4) — absent when narrative
   *  generation was skipped/failed; the digest renders identically to
   *  before in that case. */
  narrative?: string;
};
```

In `renderDigestHtml`, immediately after the `<h1>` line, add (only when present):

```ts
${
  input.narrative
    ? `<p style="margin:0 0 16px;font-size:14px;color:#333;">${escapeHtml(input.narrative)}</p>`
    : ""
}
```

In `renderDigestText`, prepend to `lines` (only when present):

```ts
const lines = [
  ...(input.narrative ? [input.narrative, ``] : []),
  `Weekly plan health - ${input.orgName} (week of ${input.periodStart})`,
  ...
```

- [ ] **Step 4: Run tests** — Run: `pnpm vitest run src/lib/digest/render.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/digest/render.ts src/lib/digest/render.test.ts
git commit -m "feat(digest): render the weekly narrative as a lead line"
```

---

## Task 6: Wire the narrative into the digest run + notification payload

**Interfaces:**

- Consumes: Task 4's `generateDigestNarrative`, Task 5's `DigestEmailInput.narrative`, Task 1's `digest_runs.narrative` column.
- Produces: `digest_runs.narrative` persisted on the `sent` branch; `notifications.payload.narrative` (optional) for `kind = 'health_digest'`.

**Files:**

- Modify: `src/lib/digest/run.ts`
- Modify: `src/lib/validations/digest.ts`
- Test: `src/lib/digest/run.test.ts` (extend + adjust existing exact-match assertions)

- [ ] **Step 1: Extend `digestNotificationPayloadSchema`** in `src/lib/validations/digest.ts`:

```ts
export const digestNotificationPayloadSchema = z.object({
  newCount: count,
  incompleteCount: count,
  overdueCount: count,
  periodStart: isoDate,
  narrative: z.string().max(400).optional(),
});
```

- [ ] **Step 2: Update the two existing `run.test.ts` assertions that will break** — the "email-disabled mode" test currently asserts `notif?.values` with `toEqual([...])` exact-matching a payload with exactly 4 keys; add `vi.mock("@/lib/digest/narrative", ...)` (see Step 3 below) returning `null` by default so those two pre-existing tests keep passing unmodified once the mock is in place (payload stays 4 keys when narrative is null — Step 4's implementation must omit the key entirely, not send `narrative: null`).

- [ ] **Step 3: Add the module mock + new test cases** — near the top of `run.test.ts`, alongside the existing `vi.mock` calls:

```ts
// vi.hoisted: vi.mock's factory below is hoisted above this file's imports,
// so a plain `const` it closes over would be a TDZ error — vi.hoisted runs
// first and is the supported way to share a mutable mock between the two.
const { mockGenerateDigestNarrative } = vi.hoisted(() => ({
  mockGenerateDigestNarrative: vi.fn<() => string | null>(() => null),
}));
vi.mock("@/lib/digest/narrative", () => ({
  generateDigestNarrative: (...args: unknown[]) =>
    Promise.resolve(mockGenerateDigestNarrative(...args)),
}));
```

Reset it in `beforeEach`: `mockGenerateDigestNarrative.mockReset().mockReturnValue(null);` — and replace every `narrativeResult = "..."` in the new tests below with `mockGenerateDigestNarrative.mockReturnValue("...")` (drop the standalone `narrativeResult` variable entirely — the mock fn IS the state).

Then, inside `describe("runWeeklyDigest", ...)`, add:

```ts
it("persists the narrative on the sent run and folds it into notifications", async () => {
  mockGenerateDigestNarrative.mockReturnValue("A calm week overall.");
  const { client, calls } = makeClient(
    baseResponder({
      digestRows: [NONZERO_ROW],
      members: [{ user_id: "u1", role: "owner" }],
      profiles: [{ id: "u1", email: "a@x.com", email_digest_opt_out: false }],
    }),
  );
  currentClient = client;

  await runWeeklyDigest(new Date("2026-07-01T12:00:00Z"));

  const finalize = calls.find(
    (c) => c.table === "digest_runs" && c.op === "update",
  );
  expect(finalize?.values).toMatchObject({
    status: "sent",
    narrative: "A calm week overall.",
  });
  const notif = calls.find(
    (c) => c.table === "notifications" && c.op === "insert",
  );
  expect(notif?.values).toEqual([
    expect.objectContaining({
      payload: expect.objectContaining({ narrative: "A calm week overall." }),
    }),
  ]);
});

it("sends unchanged when the narrative generator returns null", async () => {
  mockGenerateDigestNarrative.mockReturnValue(null);
  const { client, calls } = makeClient(
    baseResponder({
      digestRows: [NONZERO_ROW],
      members: [{ user_id: "u1", role: "owner" }],
      profiles: [{ id: "u1", email: "a@x.com", email_digest_opt_out: false }],
    }),
  );
  currentClient = client;

  const summary = await runWeeklyDigest(new Date("2026-07-01T12:00:00Z"));
  expect(summary).toMatchObject({ sent: 1 });
  const notif = calls.find(
    (c) => c.table === "notifications" && c.op === "insert",
  );
  expect(notif?.values?.[0]).not.toHaveProperty("payload.narrative");
});
```

- [ ] **Step 4: Run it, confirm the two new tests fail (and the pre-existing ones still fail until Step 5 wires the call)**

Run: `pnpm vitest run src/lib/digest/run.test.ts` — Expected: FAIL on the two new tests.

- [ ] **Step 5: Implement in `run.ts`** — import `generateDigestNarrative`; in `processOrg`, after `totals` is computed and the all-zero skip check has already returned, and before the `sendEmails` call:

```ts
import { generateDigestNarrative } from "@/lib/digest/narrative";
```

```ts
const narrative = await generateDigestNarrative(org.id, boards, totals);

// 1) Email first (skipped entirely when the provider isn't configured).
const emailSentCount = await sendEmails(
  org,
  boards,
  totals,
  period,
  recipients,
  narrative,
);

// 2) Notifications after email success — a retry can't duplicate them.
const payload = {
  ...totals,
  periodStart: period.periodStart,
  ...(narrative ? { narrative } : {}),
};
```

Update `sendEmails`'s signature to accept and forward `narrative: string | null`:

```ts
async function sendEmails(
  org: { name: string },
  boards: DigestBoardRow[],
  totals: Totals,
  period: { periodStart: string },
  recipients: Recipient[],
  narrative: string | null,
): Promise<number> {
  ...
  const input = {
    orgName: org.name,
    periodStart: period.periodStart,
    totals,
    boards,
    appBaseUrl: APP_BASE_URL,
    unsubscribeUrl,
    ...(narrative ? { narrative } : {}),
  };
```

And in the final `digest_runs` update on the `sent` branch:

```ts
await supabase
  .from("digest_runs")
  .update({
    status: "sent",
    stats: { ...totals, boards: boards.length },
    email_sent_count: emailSentCount,
    narrative,
    completed_at: new Date().toISOString(),
  })
  .eq("id", runId);
```

- [ ] **Step 6: Run tests** — Run: `pnpm vitest run src/lib/digest/run.test.ts` — Expected: PASS (all, including the two pre-existing ones).

- [ ] **Step 7: Commit**

```bash
git add src/lib/digest/run.ts src/lib/digest/run.test.ts src/lib/validations/digest.ts
git commit -m "feat(digest): wire the narrative into the run + notification payload"
```

---

## Task 7: Show the narrative in the in-app notification list

**Interfaces:**

- Consumes: Task 6's `digestNotificationPayloadSchema` (now with optional `narrative`).
- Produces: `NotificationsList`'s `health_digest` label prefers the narrative sentence when present.

**Files:**

- Modify: `src/components/notifications/NotificationsList.tsx`
- Test: `src/components/notifications/NotificationsList.test.tsx` (extend)

- [ ] **Step 1: Write the failing test** — add to the existing `health_digest` describe block in `NotificationsList.test.tsx`:

```tsx
it("prefers the narrative sentence over the counts line when present", () => {
  render(
    <NotificationsList
      notifications={[
        notif({
          id: "hd-2",
          kind: "health_digest",
          actor_id: null,
          board_id: null,
          item_id: null,
          payload: {
            newCount: 4,
            incompleteCount: 3,
            overdueCount: 2,
            periodStart: "2026-06-29",
            narrative: "A calm, productive week overall.",
          },
        }),
      ]}
      onOpen={() => {}}
    />,
  );
  expect(
    screen.getByText("Weekly digest: A calm, productive week overall."),
  ).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm vitest run src/components/notifications/NotificationsList.test.tsx` — Expected: FAIL.

- [ ] **Step 3: Implement** — in the `health_digest` case of `label()`:

```ts
case "health_digest": {
  const parsed = digestNotificationPayloadSchema.safeParse(n.payload);
  if (!parsed.success) return "Weekly plan health digest";
  return parsed.data.narrative
    ? `Weekly digest: ${parsed.data.narrative}`
    : `Weekly digest: ${parsed.data.newCount} new · ${parsed.data.incompleteCount} incomplete · ${parsed.data.overdueCount} overdue`;
}
```

- [ ] **Step 4: Run tests** — Run: `pnpm vitest run src/components/notifications/NotificationsList.test.tsx` — Expected: PASS (including the two pre-existing `health_digest` tests, unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/components/notifications/NotificationsList.tsx src/components/notifications/NotificationsList.test.tsx
git commit -m "feat(digest): surface the weekly narrative in the notification list"
```

---

## Task 8: Opt-in integration test (DEV DB)

**Interfaces:**

- Consumes: Task 1's `ai_usage_summary`/`ai_usage_by_feature_this_month`, `PULSE_TEST_DB` gating pattern (`src/lib/ai/org-ai-settings.rls.integration.test.ts`).
- Produces: rolled-back-transaction coverage that the rollups read real rows over the index.

**Files:**

- Create: `src/lib/ai/usage-summary.integration.test.ts`

- [ ] **Step 1: Read the existing pattern** — `src/lib/ai/org-ai-settings.rls.integration.test.ts`, to match its `describe.skipIf(!process.env.PULSE_TEST_DB)`, service-role setup, and rolled-back-transaction seeding style exactly.

- [ ] **Step 2: Write the test**

```ts
import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Database } from "@/types/database.types";

describe.skipIf(!process.env.PULSE_TEST_DB)(
  "ai_usage_summary + ai_usage_by_feature_this_month (integration)",
  () => {
    it("aggregates seeded ai_usage rows over the real index", async () => {
      const svc = createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
      );
      const orgId = randomUUID();
      // Seed two rows in the current month, one for a different feature.
      const { error: insErr } = await svc.from("ai_usage").insert([
        {
          org_id: orgId,
          user_id: null,
          feature: "ask_pulse",
          provider: "anthropic",
          model: "claude-sonnet-5",
          input_tokens: 100,
          output_tokens: 50,
          cost_usd: 0.01,
          credits: 5,
        },
        {
          org_id: orgId,
          user_id: null,
          feature: "item_assist",
          provider: "anthropic",
          model: "claude-haiku-4-5",
          input_tokens: 20,
          output_tokens: 10,
          cost_usd: 0.001,
          credits: 1,
        },
      ]);
      expect(insErr).toBeNull();

      try {
        const now = new Date();
        const from = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
        );
        const to = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
        );

        const { data: rollup, error: rollupErr } = await svc.rpc(
          "ai_usage_summary",
          { p_org: orgId, p_from: from.toISOString(), p_to: to.toISOString() },
        );
        expect(rollupErr).toBeNull();
        expect(rollup).toHaveLength(1);
        expect(Number(rollup![0].credits)).toBe(6);
        expect(rollup![0].calls).toBe(2);

        const { data: byFeature, error: featErr } = await svc.rpc(
          "ai_usage_by_feature_this_month",
          { p_org: orgId },
        );
        expect(featErr).toBeNull();
        expect(byFeature).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ feature: "ask_pulse", calls: 1 }),
            expect.objectContaining({ feature: "item_assist", calls: 1 }),
          ]),
        );
      } finally {
        // No transaction wrapper available via the JS client for DDL-adjacent
        // RPC calls — clean up explicitly instead (matches how ai_usage rows
        // are seeded/cleaned in this repo's other opt-in integration tests).
        await svc.from("ai_usage").delete().eq("org_id", orgId);
      }
    });
  },
);
```

- [ ] **Step 3: Run with the flag**

Run: `PULSE_TEST_DB=1 pnpm vitest run src/lib/ai/usage-summary.integration.test.ts` — Expected: PASS. (CI leaves it SKIPPED without the flag.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai/usage-summary.integration.test.ts
git commit -m "test(usage): opt-in DEV integration coverage for the rollup RPCs"
```

---

## Execution DAG (AGENTS.md #6)

**Dependency edges (from Consumes/Produces):**

- T1 (migration) → T2 (usage-summary read), T6 (run.ts writes `digest_runs.narrative`), T8 (integration test)
- T2 (usage-summary) → T3 (UI), T8
- T3 (UI) → —
- T4 (narrative generator) → T6 (run.ts calls it)
- T5 (render.ts) → T6 (run.ts passes `narrative` into the render input)
- T6 (run.ts wiring + payload schema) → T7 (NotificationsList reads the schema field)

**Parallel batches (waves of concurrent subagents):**

- **Batch 1 (no unmet deps):** T1, T4, T5 — disjoint files (`supabase/migrations/*` + `database.types.ts` vs `narrative*.ts` + `model-map.ts` vs `render.ts`). Run concurrently.
- **Batch 2:** T2 (needs T1's RPCs + regenerated types), T6 (needs T4 + T5's outputs) — disjoint files (`usage-summary.ts` vs `run.ts`/`validations/digest.ts`). Run concurrently.
- **Batch 3:** T3 (needs T2), T7 (needs T6) — disjoint files (`UsageBreakdown.tsx` + `settings/ai/page.tsx` vs `NotificationsList.tsx`). Run concurrently.
- **Batch 4:** T8 (needs T1 + T2) + the final full gate (`pnpm typecheck && pnpm lint && pnpm test && pnpm build`).

**Critical path (wall-clock floor):** `T1 → T2 → T3` (length 3), tied with `T1 → T6 → T7` (length 3, since T6 also needs T4/T5 which land in the same first batch). Four batches deep.

**Shared-file serialization notes:** `settings/ai/page.tsx` is touched only by T3 (T7 edits a different settings file). `supabase/migrations/` + `database.types.ts` touched only by T1 — nothing else in this plan mints a migration, so no cross-task serialization needed there (unlike the July plan's T3/T8 collision, which doesn't apply here since F16/Stripe is a separate, unscheduled track). `run.ts`/`validations/digest.ts` touched only by T6.

---

## Performance & data-fetching budget (AGENTS.md #5)

- **First paint `/settings/ai`:** `UsageBreakdown` reads once server-side (`getUsageSummary`, admin-only, folded into the page's existing admin-gated reads). No client fetch on mount.
- **Usage range toggle (this month / 6 months):** pure client state over the preloaded summary — 0 new server round-trips, no `<Link>`/router navigation involved.
- **Bounded/indexed:** `ai_usage_summary` and `ai_usage_by_feature_this_month` both scan `ai_usage_org_created_idx (org_id, created_at)` with an explicit bound (`[from, to)` for the rollup; `>= date_trunc('month', now())` for the per-feature read) — no unbounded `select *`.
- **Narrative:** generated once per (org, week) inside the existing idempotent `digest_runs` claim and cached on the row — 0 per-recipient/per-view AI calls; rides the existing weekly cron, no new schedule or service.

---

## Closure

- **Definition of done:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green. Per this session's explicit instructions, **do not run `scripts/finish-task.sh`** — the coordinating session merges this worktree in separately.
- **How to test (user walkthrough), once merged:**
  1. Go to `/settings/ai` as an org admin whose org is in `managed` or `org_byo` AI mode. Below "Organization AI", a new "Usage" card shows a per-feature credit breakdown (toggle "This month") and a 6-month credits trend line (toggle "6 months") — switching the toggle is instant, no page reload.
  2. Trigger a digest run for a `managed`-mode org with AI configured (e.g. call `runWeeklyDigest()` directly in a script, or wait for the weekly cron) and confirm `digest_runs.narrative` is populated for that org's row, and that the org's members see a "Weekly digest: <narrative sentence>" entry in their notification bell (`/`, notification icon) instead of the old bare counts line.
  3. If `RESEND_API_KEY` is configured in the environment under test, also confirm the narrative appears as the lead paragraph of the digest email.

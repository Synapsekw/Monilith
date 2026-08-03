"use client";

import { useState, useTransition } from "react";
import { setOrgAiPlan } from "@/lib/platform/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const SELECT_CLASS =
  "border-input bg-transparent focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border px-2.5 text-sm transition-colors outline-none focus-visible:ring-3 disabled:opacity-50 dark:bg-input/30";

// Must match setOrgAiPlanSchema's enum exactly — a value here that the schema
// rejects surfaces as a generic "Invalid input" with no clue which field.
const TIERS = ["none", "core", "pulse", "trial", "enterprise"] as const;

/**
 * Platform-admin control for an org's AI entitlement (tier + monthly credit
 * ceiling). The operator grants the allowance here; `ai_mode` is intentionally
 * read-only — the org's own admins choose how to spend it. Mirrors
 * AiProviderForm's inline-message + useTransition pattern (no toast primitive).
 */
export function OrgAiPlanForm({
  orgId,
  initial,
}: {
  orgId: string;
  initial: { tier: string; monthlyCreditLimit: number; mode: string };
}) {
  const [tier, setTier] = useState(initial.tier);
  const [limit, setLimit] = useState(String(initial.monthlyCreditLimit));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function save() {
    setError(null);
    setSaved(false);
    start(async () => {
      const res = await setOrgAiPlan({
        orgId,
        tier,
        monthlyCreditLimit: Number(limit),
      });
      if (res.ok) {
        setSaved(true);
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="ai-plan-tier">Tier</Label>
        <select
          id="ai-plan-tier"
          className={cn(SELECT_CLASS, "capitalize")}
          value={tier}
          disabled={pending}
          onChange={(e) => {
            setTier(e.target.value);
            setError(null);
            setSaved(false);
          }}
        >
          {TIERS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ai-plan-credits">Monthly credit limit</Label>
        <Input
          id="ai-plan-credits"
          type="number"
          min={0}
          max={1_000_000}
          step={1}
          value={limit}
          disabled={pending}
          onChange={(e) => {
            setLimit(e.target.value);
            setError(null);
            setSaved(false);
          }}
        />
        <p className="text-muted-foreground text-xs">
          Credits reset monthly. Set to 0 to grant no allowance.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Mode</Label>
        <p className="text-sm capitalize">{initial.mode.replace(/_/g, " ")}</p>
        <p className="text-muted-foreground text-xs">
          Mode is chosen by the org&rsquo;s admins.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={pending} size="sm">
          {pending ? "Saving…" : "Save"}
        </Button>
        {saved && !error && (
          <span className="text-muted-foreground text-xs" role="alert">
            Plan updated.
          </span>
        )}
        {error && (
          <span className="text-destructive text-xs" role="alert">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { setOrgAiPlan } from "@/lib/platform/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFieldStatus } from "@/components/ui/field-status";
import { useRestoreFocusAfterPending } from "@/lib/hooks/use-restore-focus-after-pending";
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
 * OrgAiSettingsForm's inline-message + useTransition pattern (no toast
 * primitive); the AiProviderForm this used to cite was deleted when the org AI
 * surface moved to /settings/ai.
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
  // One outcome, one message. "Plan updated." used to be a `role="alert"`,
  // which interrupts a screen reader to report success; the tone now decides
  // that, and the message describes the Save button that produced it (the
  // failure can come from either field, so it belongs to neither).
  const status = useFieldStatus(
    error ?? (saved ? "Plan updated." : null),
    error ? "error" : "success",
  );
  // Save disables itself for the duration of the transition and stays mounted,
  // so focus would otherwise be dropped on `<body>`.
  const saveRef = useRestoreFocusAfterPending<HTMLButtonElement>(pending);

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
        <Button
          ref={saveRef}
          onClick={save}
          disabled={pending}
          size="sm"
          aria-describedby={status.controlProps["aria-describedby"]}
        >
          {pending ? "Saving…" : "Save"}
        </Button>
        {saved && !error && (
          <span
            {...status.messageProps}
            className="text-muted-foreground text-xs"
          >
            Plan updated.
          </span>
        )}
        {error && (
          <span {...status.messageProps} className="text-destructive text-xs">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

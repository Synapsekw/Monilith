"use client";

import { useState, useTransition } from "react";
import { updateOrgTimezone } from "@/lib/org/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const ZONES: string[] =
  typeof Intl !== "undefined" && typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")
    : ["UTC"];

interface TimezoneFormProps {
  orgId: string;
  currentTimezone: string;
}

export function TimezoneForm({ orgId, currentTimezone }: TimezoneFormProps) {
  const [tz, setTz] = useState(currentTimezone);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const isUnchanged = tz === currentTimezone;

  function save() {
    setMsg(null);
    start(async () => {
      const res = await updateOrgTimezone({ orgId, timezone: tz });
      if (res.ok) {
        setMsg("Saved.");
        setIsError(false);
      } else {
        setMsg(res.error);
        setIsError(true);
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="timezone-select">Timezone</Label>
        <select
          id="timezone-select"
          value={tz}
          onChange={(e) => {
            setTz(e.target.value);
            setMsg(null);
          }}
          className={cn(
            "border-border bg-background text-foreground hover:bg-accent focus-visible:ring-ring/50 focus-visible:border-ring w-full rounded-md border px-3 py-2 text-sm transition-colors",
            "focus-visible:ring-3 focus-visible:outline-none",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
          disabled={pending}
        >
          {ZONES.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
        <p className="text-muted-foreground text-xs">
          Date automations fire at 8:00 AM in this timezone.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={pending || isUnchanged} size="sm">
          {pending ? "Saving…" : "Save"}
        </Button>
        {msg && (
          <span
            className={cn(
              "text-xs",
              isError ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {msg}
          </span>
        )}
      </div>
    </div>
  );
}

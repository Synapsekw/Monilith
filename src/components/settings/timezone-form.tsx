"use client";

import { useState, useTransition } from "react";
import { updateOrgTimezone } from "@/lib/org/actions";
import { Button } from "@/components/ui/button";
import { TimezonePicker } from "@/components/ui/timezone-picker";
import { cn } from "@/lib/utils";

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
      {/* The label and helper copy live on the enclosing SettingRow so every
          control in the section shares one alignment grid — see
          src/components/settings/setting-row.tsx. */}
      <TimezonePicker
        value={tz}
        onChange={(v) => {
          // Org timezone is never "Automatic"; ignore a null selection.
          if (v) setTz(v);
          setMsg(null);
        }}
        disabled={pending}
      />

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

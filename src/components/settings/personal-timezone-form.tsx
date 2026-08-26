"use client";

import { useState, useTransition } from "react";
import { updateProfileTimezone } from "@/lib/profile/actions";
import { Button } from "@/components/ui/button";
import { TimezonePicker } from "@/components/ui/timezone-picker";
import { useRestoreFocusAfterPending } from "@/lib/hooks/use-restore-focus-after-pending";
import { cn } from "@/lib/utils";

const MSG_ID = "personal-timezone-msg";

export function PersonalTimezoneForm({
  currentTimezone,
}: {
  currentTimezone: string | null;
}) {
  const [tz, setTz] = useState<string | null>(currentTimezone);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  // The Save button disables itself the instant `pending` flips true,
  // synchronously inside `save()` below — the same click that gave it focus.
  // A browser has nowhere else to send focus when the active element is
  // disabled out from under it, so it drops to `<body>` and a keyboard or
  // screen-reader user loses their place on the page. This restores it once
  // the save resolves (but never steals focus the user moved on purpose).
  const saveRef = useRestoreFocusAfterPending<HTMLButtonElement>(pending);

  const isUnchanged = tz === currentTimezone;

  function save() {
    setMsg(null);
    start(async () => {
      const res = await updateProfileTimezone({ timezone: tz });
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
          setTz(v);
          setMsg(null);
        }}
        allowAutomatic
        disabled={pending}
        label="Time zone"
      />

      <div className="flex items-center gap-3">
        <Button
          ref={saveRef}
          onClick={save}
          disabled={pending || isUnchanged}
          aria-describedby={msg ? MSG_ID : undefined}
          size="sm"
        >
          {pending ? "Saving…" : "Save"}
        </Button>
        {msg && (
          <span
            id={MSG_ID}
            role={isError ? "alert" : "status"}
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

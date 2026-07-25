"use client";

import { useId, useState, useTransition } from "react";
import { updateOrgName } from "@/lib/org/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Rename the org. Follows the TimezoneForm idiom — useTransition plus an
 * inline message rather than a toast, so the feedback stays next to the field
 * that produced it.
 *
 * Non-admins get a read-only value rather than a disabled input: RLS rejects
 * their write anyway, and a control you can focus but never submit reads as a
 * bug rather than a permission.
 */
export function OrgNameForm({
  orgId,
  currentName,
  canEdit,
}: {
  orgId: string;
  currentName: string;
  canEdit: boolean;
}) {
  const id = useId();
  const [name, setName] = useState(currentName);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  if (!canEdit) {
    return <p className="text-muted-foreground text-sm">{currentName}</p>;
  }

  const trimmed = name.trim();
  const unchanged = trimmed === currentName.trim();

  function save() {
    setMsg(null);
    start(async () => {
      const res = await updateOrgName({ orgId, name: trimmed });
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
    <div className="space-y-2">
      <label htmlFor={id} className="sr-only">
        Organization name
      </label>
      <Input
        id={id}
        value={name}
        disabled={pending}
        onChange={(e) => {
          setName(e.target.value);
          setMsg(null);
        }}
      />
      <div className="flex items-center gap-3">
        <Button
          onClick={save}
          disabled={pending || unchanged || trimmed === ""}
          size="sm"
        >
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

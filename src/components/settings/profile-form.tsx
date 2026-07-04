"use client";

import { useState, useTransition } from "react";
import { updateProfileFullName } from "@/lib/profile/actions";
import { MAX_FULL_NAME_LENGTH } from "@/lib/validations/profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Set or clear the signed-in user's display name. Mirrors the inline
 * message pattern of the timezone forms (the app has no toast primitive yet).
 * Trimming/empty→null normalization matches `updateProfileFullNameSchema`.
 */
export function ProfileForm({
  currentFullName,
}: {
  currentFullName: string | null;
}) {
  const [name, setName] = useState(currentFullName ?? "");
  const [saved, setSaved] = useState(currentFullName ?? "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const trimmed = name.trim();
  const tooLong = trimmed.length > MAX_FULL_NAME_LENGTH;
  const isUnchanged = trimmed === saved.trim();

  function save() {
    setMsg(null);
    const next = trimmed.length > 0 ? trimmed : null;
    start(async () => {
      const res = await updateProfileFullName({ fullName: next });
      if (res.ok) {
        setName(trimmed);
        setSaved(trimmed);
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
        <Label htmlFor="display-name">Display name</Label>
        <Input
          id="display-name"
          value={name}
          maxLength={MAX_FULL_NAME_LENGTH}
          placeholder="Your name"
          autoComplete="name"
          disabled={pending}
          aria-invalid={tooLong || undefined}
          onChange={(e) => {
            setName(e.target.value);
            setMsg(null);
          }}
        />
        <p className="text-muted-foreground text-xs">
          Shown across boards, comments, and presence. Leave blank to fall back
          to your email.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button
          onClick={save}
          disabled={pending || isUnchanged || tooLong}
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

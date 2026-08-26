"use client";

import { useState, useTransition } from "react";
import { updateProfileFullName } from "@/lib/profile/actions";
import { MAX_FULL_NAME_LENGTH } from "@/lib/validations/profile";
import { AvatarUploader } from "@/components/settings/avatar-uploader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingRow } from "@/components/settings/setting-row";
import { useFieldStatus } from "@/components/ui/field-status";
import { useRestoreFocusAfterPending } from "@/lib/hooks/use-restore-focus-after-pending";
import { cn } from "@/lib/utils";

/**
 * Set or clear the signed-in user's display name and avatar. Mirrors the inline
 * message pattern of the timezone forms.
 * Trimming/empty→null normalization matches `updateProfileFullNameSchema`.
 *
 * Emits SettingRows rather than its own layout so the photo and name land on
 * the same label/control grid as every other row in the section — otherwise
 * Profile is the one page where nothing lines up.
 */
export function ProfileForm({
  userId,
  currentFullName,
  currentAvatarUrl,
}: {
  userId: string;
  currentFullName: string | null;
  currentAvatarUrl: string | null;
}) {
  const [name, setName] = useState(currentFullName ?? "");
  const [saved, setSaved] = useState(currentFullName ?? "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  // The save message is the input's accessible description; the tone decides
  // whether it interrupts (error) or announces politely ("Saved.").
  const status = useFieldStatus(msg, isError ? "error" : "success");
  // Save disables itself mid-click, which drops focus to `<body>`; reclaim it
  // once the save resolves. See timezone-form.tsx.
  const saveRef = useRestoreFocusAfterPending<HTMLButtonElement>(pending);

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
    <>
      <SettingRow
        label="Photo"
        description="PNG, JPEG, or WebP. Squared and resized automatically."
      >
        <AvatarUploader
          userId={userId}
          name={(currentFullName ?? "").trim() || "?"}
          currentAvatarUrl={currentAvatarUrl}
        />
      </SettingRow>

      <SettingRow
        label="Display name"
        htmlFor="display-name"
        description="Shown across boards, comments, and presence. Leave blank to fall back to your email."
      >
        <div className="space-y-3">
          <Input
            id="display-name"
            value={name}
            maxLength={MAX_FULL_NAME_LENGTH}
            placeholder="Your name"
            autoComplete="name"
            disabled={pending}
            {...status.controlProps}
            // Two independent reasons to be invalid: the local length guard
            // (which never produces a message) and a server error (which does).
            aria-invalid={tooLong || status.controlProps["aria-invalid"]}
            onChange={(e) => {
              setName(e.target.value);
              setMsg(null);
            }}
          />
          <div className="flex items-center gap-3">
            <Button
              ref={saveRef}
              onClick={save}
              disabled={pending || isUnchanged || tooLong}
              size="sm"
            >
              {pending ? "Saving…" : "Save"}
            </Button>
            {msg && (
              <span
                {...status.messageProps}
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
      </SettingRow>
    </>
  );
}

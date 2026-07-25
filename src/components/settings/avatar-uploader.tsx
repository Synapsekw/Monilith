"use client";

import Image from "next/image";
import { useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  removeProfileAvatar,
  updateProfileAvatar,
} from "@/lib/profile/actions";
import { buildAvatarPath } from "@/lib/profile/avatar-path";
import {
  AVATAR_OUTPUT_MIME,
  processAvatarImage,
} from "@/lib/profile/avatar-image";
import {
  AVATAR_ACCEPTED_TYPES,
  AVATAR_MAX_BYTES,
} from "@/lib/validations/profile";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const AVATARS_BUCKET = "avatars";

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/**
 * Set, replace, or remove the signed-in user's avatar. The browser normalizes
 * the picked image to a small square webp (center-crop → downscale) and uploads
 * it client-direct to the public `avatars` bucket (Storage Insert policy), then
 * a Server Action writes the public URL and invalidates the profile + roster
 * caches. Mirrors the inline-message idiom of the sibling profile forms.
 */
export function AvatarUploader({
  userId,
  name,
  currentAvatarUrl,
}: {
  userId: string;
  name: string;
  currentAvatarUrl: string | null;
}) {
  const [url, setUrl] = useState(currentAvatarUrl);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setMsg(null);
    if (!AVATAR_ACCEPTED_TYPES.includes(file.type as never)) {
      setMsg("Use a PNG, JPEG, or WebP image.");
      setIsError(true);
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setMsg("Image must be 5 MB or smaller.");
      setIsError(true);
      return;
    }
    start(async () => {
      const supabase = createClient();
      const path = buildAvatarPath(userId, AVATAR_OUTPUT_MIME);
      try {
        const blob = await processAvatarImage(file);
        const { error } = await supabase.storage
          .from(AVATARS_BUCKET)
          .upload(path, blob, {
            contentType: AVATAR_OUTPUT_MIME,
            upsert: true,
          });
        if (error) throw new Error(error.message);
        const res = await updateProfileAvatar({ storagePath: path });
        if (!res.ok) {
          // Orphan cleanup: the object landed but the row write failed.
          await supabase.storage.from(AVATARS_BUCKET).remove([path]);
          throw new Error(res.error);
        }
        // Read-your-own-writes locally: point the preview at the new object.
        const { data } = supabase.storage
          .from(AVATARS_BUCKET)
          .getPublicUrl(path);
        setUrl(data.publicUrl);
        setMsg("Saved.");
        setIsError(false);
      } catch (err) {
        setMsg(err instanceof Error ? err.message : "Upload failed.");
        setIsError(true);
      }
    });
  }

  function onRemove() {
    setMsg(null);
    start(async () => {
      const res = await removeProfileAvatar();
      if (res.ok) {
        setUrl(null);
        setMsg("Removed.");
        setIsError(false);
      } else {
        setMsg(res.error);
        setIsError(true);
      }
    });
  }

  return (
    <div className="flex items-center gap-4">
      <span className="bg-surface-muted flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-medium">
        {url ? (
          <Image
            src={url}
            alt="Your avatar"
            width={56}
            height={56}
            unoptimized
            className="size-full object-cover"
          />
        ) : (
          initials(name)
        )}
      </span>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept={AVATAR_ACCEPTED_TYPES.join(",")}
            className="sr-only"
            aria-label="Upload avatar image"
            onChange={onPick}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => inputRef.current?.click()}
          >
            {pending ? "Uploading…" : url ? "Change" : "Upload"}
          </Button>
          {url && (
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={onRemove}
            >
              Remove
            </Button>
          )}
        </div>
        {/* Only transient messages live here — the static format hint is the
            enclosing SettingRow's description, so it sits with the label like
            every other row in the section. */}
        {msg ? (
          <span
            className={cn(
              "text-xs",
              isError ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {msg}
          </span>
        ) : null}
      </div>
    </div>
  );
}

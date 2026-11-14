"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Printer, Settings2, Sparkles, UserPlus, Users } from "lucide-react";
import { memberInitials } from "@/components/boards/cells/member-avatar";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { FolderAccessHead } from "@/lib/folders/sharing-types";

// Loaded on first open: the dialog and its actions stay out of the folder
// page's first paint.
const ShareFolderDialog = dynamic(
  () => import("./ShareFolderDialog").then((m) => m.ShareFolderDialog),
  { ssr: false },
);

const STACK = 3;

type HeaderMember = {
  userId: string;
  fullName: string | null;
  avatarUrl: string | null;
};

/** Spec §5.1 header extras. Export prints canvas tabs only. `onCustomize`
 *  enters Customize mode, a client-only draft edit of the layout.
 *  Invite opens the folder's share dialog; the stack beside it shows who the
 *  folder is shared with. */
export function HeaderActions({
  folderId,
  folderName,
  canExport,
  access,
  members,
  editing = false,
  onCustomize,
}: {
  folderId: string;
  folderName: string;
  canExport: boolean;
  access: FolderAccessHead;
  members: HeaderMember[];
  editing?: boolean;
  onCustomize?: () => void;
}) {
  const router = useRouter();
  const inviteButton = useRef<HTMLButtonElement>(null);
  const [shareOpen, setShareOpen] = useState(false);
  // Mounted on first open and kept, so the close animation and focus return run.
  const [shareMounted, setShareMounted] = useState(false);
  const byId = new Map(members.map((m) => [m.userId, m]));
  const shown = access.memberIds.slice(0, STACK);
  const more = access.count - shown.length;

  return (
    <div className="flex items-center gap-2" data-print-hide>
      {access.count > 0 && (
        <div
          className="flex items-center"
          aria-label={`Shared with ${access.count} ${access.count === 1 ? "person" : "people"}`}
        >
          {shown.map((id) => (
            <Avatar
              key={id}
              aria-hidden
              className="border-content-surface -ml-1.5 size-7 border-2 first:ml-0"
            >
              {byId.get(id)?.avatarUrl ? (
                <AvatarImage
                  src={byId.get(id)?.avatarUrl ?? undefined}
                  alt=""
                />
              ) : null}
              <AvatarFallback className="bg-surface-muted text-muted-foreground text-3xs font-medium">
                {memberInitials(byId.get(id)?.fullName ?? "") || "?"}
              </AvatarFallback>
            </Avatar>
          ))}
          {more > 0 && (
            <span
              aria-hidden
              className="bg-surface-muted text-muted-foreground border-content-surface text-3xs -ml-1.5 flex size-7 items-center justify-center rounded-full border-2 font-mono"
            >
              +{more}
            </span>
          )}
        </div>
      )}
      <Button
        ref={inviteButton}
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setShareMounted(true);
          setShareOpen(true);
        }}
      >
        {access.canManage ? (
          <>
            <UserPlus className="size-4" /> Invite
          </>
        ) : (
          <>
            <Users className="size-4" /> People
          </>
        )}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!canExport}
        onClick={() => window.print()}
        title={canExport ? undefined : "Switch to a canvas tab to export"}
      >
        <Printer className="size-4" /> Export PDF
      </Button>
      <Button asChild size="sm">
        <Link href={`/ask?folder=${folderId}`}>
          <Sparkles className="size-4" /> Ask about this folder
        </Link>
      </Button>
      {!editing && onCustomize ? (
        <Button type="button" variant="outline" size="sm" onClick={onCustomize}>
          <Settings2 className="size-4" /> Customize
        </Button>
      ) : null}
      {shareMounted && (
        <ShareFolderDialog
          folderId={folderId}
          folderName={folderName}
          open={shareOpen}
          onOpenChange={setShareOpen}
          returnFocusRef={inviteButton}
          // The avatar stack and count come from the page's own payload.
          onChanged={() => router.refresh()}
        />
      )}
    </div>
  );
}

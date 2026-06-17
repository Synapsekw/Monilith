"use client";

import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useItemCollab } from "@/lib/collaboration/use-item-collab";
import { useUpdateMutations } from "@/lib/collaboration/use-update-mutations";
import { useItemAttachments } from "@/lib/collaboration/use-item-attachments";
import { useAttachmentMutations } from "@/lib/collaboration/use-attachment-mutations";
import type { Column, Member } from "@/lib/collaboration/activity";
import { ActivityTab } from "./ActivityTab";
import { UpdatesTab } from "./UpdatesTab";
import { FilesTab } from "./FilesTab";

type Tab = "fields" | "updates" | "activity" | "files";

export function ItemPanel({
  itemId,
  itemName,
  orgId,
  boardId,
  currentUserId,
  columns,
  members,
  onClose,
}: {
  itemId: string | null;
  itemName: string;
  orgId: string;
  boardId: string;
  currentUserId: string;
  columns: readonly Column[];
  members: readonly Member[];
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("updates");
  const { updates, activity } = useItemCollab(itemId);
  const mutations = useUpdateMutations(itemId ?? "none", currentUserId, {
    orgId,
    boardId,
  });
  // Files query is lazy — enabled only once the Files tab has been opened, so
  // opening the panel itself stays 0 round-trips (gotcha-09).
  const filesOpened = tab === "files";
  const { list: attachments, previewUrls } = useItemAttachments(
    itemId,
    filesOpened,
  );
  const attachmentMutations = useAttachmentMutations(
    itemId ?? "none",
    currentUserId,
    { orgId, boardId },
  );

  return (
    <Sheet open={!!itemId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{itemName}</SheetTitle>
          <SheetDescription className="sr-only">
            Item details, updates, and activity.
          </SheetDescription>
        </SheetHeader>

        <div className="flex gap-1 border-b">
          {(["fields", "updates", "activity", "files"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-2 text-sm capitalize ${
                tab === t
                  ? "border-primary border-b-2 font-medium"
                  : "text-muted-foreground"
              }`}
            >
              {t === "activity" ? "Activity Log" : t}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {tab === "fields" && (
            <p className="text-muted-foreground py-6 text-sm">
              Edit fields in the board grid. (Inline field editing in the panel
              is a fast-follow.)
            </p>
          )}
          {tab === "updates" && (
            <UpdatesTab
              cache={updates.data}
              members={members}
              onAdd={mutations.addUpdate}
              onDelete={mutations.deleteUpdate}
            />
          )}
          {tab === "activity" && (
            <ActivityTab
              cache={activity.data}
              columns={columns}
              members={members}
            />
          )}
          {tab === "files" && (
            <FilesTab
              cache={attachments.data}
              previewUrls={previewUrls}
              members={members}
              currentUserId={currentUserId}
              isUploading={attachmentMutations.isUploading}
              uploadError={attachmentMutations.uploadError}
              onUpload={attachmentMutations.uploadFile}
              onDelete={attachmentMutations.deleteAttachment}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

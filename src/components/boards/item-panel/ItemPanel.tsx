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
import { usePresenceFocus } from "@/lib/boards/use-presence-focus";
import { presenceTarget } from "@/lib/boards/presence-target";
import { itemPresenceTargetSchema } from "@/lib/validations/presence";
import { ItemViewersBar } from "@/components/boards/presence/ItemViewersBar";
import { ActivityTab } from "./ActivityTab";
import { UpdatesTab } from "./UpdatesTab";
import { FilesTab } from "./FilesTab";
import {
  CreatedByCell,
  CreatedAtCell,
} from "@/components/boards/cells/created";

type Tab = "fields" | "updates" | "activity" | "files";

export function ItemPanel({
  itemId,
  itemName,
  orgId,
  boardId,
  currentUserId,
  columns,
  members,
  createdBy,
  createdAt,
  onClose,
}: {
  itemId: string | null;
  itemName: string;
  orgId: string;
  boardId: string;
  currentUserId: string;
  columns: readonly Column[];
  // Superset of activity's Member: the created-by row also renders the avatar
  // (optional so activity consumers passing bare {userId, fullName} still fit).
  members: readonly (Member & { avatarUrl?: string | null })[];
  createdBy: string | null;
  createdAt: string | null;
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

  // While the panel is open, broadcast a "viewing this item" focus over the
  // existing presence channel so other open panels can show us. Ephemeral —
  // no DB write, no server round-trip (gotcha-09 / spec perf budget). Validate
  // the id at the boundary before it flows into a presence-channel `track`.
  const validItemId =
    itemId && itemPresenceTargetSchema.safeParse(itemId).success
      ? itemId
      : null;
  usePresenceFocus(
    validItemId
      ? { viewKind: "panel", targetId: presenceTarget.item(validItemId) }
      : null,
    validItemId != null,
  );

  return (
    <Sheet open={!!itemId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader>
          <div className="flex items-center justify-between gap-3">
            <SheetTitle>{itemName}</SheetTitle>
            <ItemViewersBar itemId={itemId} />
          </div>
          <SheetDescription className="sr-only">
            Item details, updates, and activity.
          </SheetDescription>
        </SheetHeader>

        <div
          role="tablist"
          aria-label="Item panel sections"
          className="flex gap-1 border-b"
        >
          {(["fields", "updates", "activity", "files"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`focus-visible:ring-ring rounded-sm px-3 py-2 text-sm capitalize transition-colors focus-visible:ring-2 focus-visible:outline-none pointer-coarse:min-h-11 ${
                tab === t
                  ? "border-primary border-b-2 font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "activity" ? "Activity Log" : t}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Keyed by tab so each switch re-mounts the wrapper and plays the
              150ms fade (reduced-motion handled globally in globals.css). */}
          <div key={tab} className="animate-fadein">
            {tab === "fields" && (
              <div className="space-y-4 py-6">
                <p className="text-muted-foreground text-sm">
                  Edit fields in the board grid. (Inline field editing in the
                  panel is a fast-follow.)
                </p>
                <dl className="space-y-2 border-t pt-4">
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-muted-foreground text-sm">
                      Created by
                    </dt>
                    <dd>
                      {(() => {
                        const creator = members.find(
                          (m) => m.userId === createdBy,
                        );
                        return (
                          <CreatedByCell
                            name={creator?.fullName ?? null}
                            avatarUrl={creator?.avatarUrl ?? null}
                          />
                        );
                      })()}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-muted-foreground text-sm">
                      Created at
                    </dt>
                    <dd>
                      <CreatedAtCell iso={createdAt} />
                    </dd>
                  </div>
                </dl>
              </div>
            )}
            {tab === "updates" && (
              <UpdatesTab
                cache={updates.data}
                isError={updates.isError}
                members={members}
                onAdd={mutations.addUpdate}
                onDelete={mutations.deleteUpdate}
              />
            )}
            {tab === "activity" && (
              <ActivityTab
                cache={activity.data}
                isError={activity.isError}
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
        </div>
      </SheetContent>
    </Sheet>
  );
}

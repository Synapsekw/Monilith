"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getItemAttachments } from "@/lib/collaboration/attachments";
import { getAttachmentPreviewUrls } from "@/lib/collaboration/actions";
import { isPreviewable } from "@/lib/collaboration/attachments-format";
import type { AttachmentsCache } from "@/lib/collaboration/attachments-cache";

export function itemAttachmentsKey(itemId: string) {
  return ["item-attachments", itemId] as const;
}

/**
 * Lazy attachments surface for the Files tab. The list query is `enabled`
 * only once the tab has been opened (`active`), so opening the panel costs 0
 * round-trips. After the list resolves it batch-mints inline preview URLs for
 * the previewable rows in one Server Action call (re-minted as the list grows).
 */
export function useItemAttachments(itemId: string | null, active: boolean) {
  const enabled = !!itemId && active;

  const list = useQuery({
    queryKey: itemAttachmentsKey(itemId ?? "none"),
    enabled,
    staleTime: Infinity,
    queryFn: async (): Promise<AttachmentsCache> => {
      const attachments = await getItemAttachments(itemId!);
      return { attachments };
    },
  });

  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});

  // Batch-mint inline preview URLs for the previewable rows. Keyed on the set
  // of previewable ids so it re-mints when the list grows but not on every
  // render. URLs are short-TTL; re-running on cache change keeps them fresh.
  const previewableIds = (list.data?.attachments ?? [])
    .filter((a) => isPreviewable(a.mime_type))
    .map((a) => a.id);
  const previewKey = previewableIds.join(",");

  useEffect(() => {
    // No synchronous setState here (react-hooks/set-state-in-effect): the async
    // fetch below replaces the whole map; entries for removed ids are keyed by
    // attachments that no longer render, so they're harmless and need no clear.
    if (!enabled || previewableIds.length === 0) return;
    let cancelled = false;
    void getAttachmentPreviewUrls({ attachmentIds: previewableIds }).then(
      (res) => {
        if (!cancelled && res.ok) setPreviewUrls(res.data.urls);
      },
    );
    return () => {
      cancelled = true;
    };
    // previewKey captures the id set; previewableIds is derived from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, previewKey]);

  return { list, previewUrls, key: itemAttachmentsKey(itemId ?? "none") };
}

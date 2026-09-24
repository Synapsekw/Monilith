"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { showMutationError } from "@/lib/ui/mutation-toast";
import { saveFolderLayout } from "@/lib/folders/layout-actions";
import { PRESET_KEYS, type PresetKey } from "@/lib/folders/presets";
import type { FolderLayoutConfig } from "@/lib/validations/folder-layout";

const PRESET_LABEL: Record<PresetKey, string> = {
  project: "Project",
  crm: "CRM",
  support: "Support",
  blank: "Blank",
};

/**
 * Sticky footer for Customize mode (spec §6). The only place in edit mode
 * that talks to the server: everything else (hide/move/rename/…) is the
 * `useLayoutDraft` reducer, held entirely in the browser until this bar's
 * Save button runs.
 */
export function CustomizeBar({
  folderId,
  version,
  preset,
  config,
  dirty,
  onReset,
  onCancel,
  onSaved,
}: {
  folderId: string;
  /** The concurrency token read with the page — 0 means no row yet. */
  version: number;
  preset: PresetKey;
  config: FolderLayoutConfig;
  dirty: boolean;
  onReset: (preset: PresetKey) => void;
  onCancel: () => void;
  /** Called after a successful save; the caller owns `router.refresh()` and
   *  leaving edit mode. */
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    const res = await saveFolderLayout({ folderId, version, preset, config });
    setSaving(false);
    if (!res.ok) {
      showMutationError("Couldn't save the layout", new Error(res.error));
      return; // stay in edit mode — the draft isn't lost
    }
    onSaved();
  }

  return (
    <div className="bg-surface sticky bottom-0 z-10 flex items-center justify-between gap-2 border-t p-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            Reset to preset <ChevronDown className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {PRESET_KEYS.map((key) => (
            <DropdownMenuItem key={key} onSelect={() => onReset(key)}>
              {PRESET_LABEL[key]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="flex items-center gap-2">
        {dirty ? (
          <span className="text-muted-foreground hidden text-xs sm:inline">
            Unsaved changes
          </span>
        ) : null}
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" disabled={saving} onClick={handleSave}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

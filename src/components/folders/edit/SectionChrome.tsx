"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Columns3, EyeOff, Sliders } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { BuiltinPanel, KpiKey } from "@/lib/validations/folder-layout";
import { KpiPicker } from "./KpiPicker";

/** Display name for a builtin panel's chrome header when the section has no
 *  custom title — matches each panel's own default `title` prop exactly. */
const PANEL_LABEL: Record<BuiltinPanel, string> = {
  kpis: "KPI cards",
  burn: "Planned vs completed",
  boardStatus: "Status by board",
  attention: "Needs attention",
  intelligence: "Intelligence",
  milestones: "Next milestones",
};

const WIDTHS: { label: string; w: 12 | 8 | 4 }[] = [
  { label: "Full", w: 12 },
  { label: "Two-thirds", w: 8 },
  { label: "One-third", w: 4 },
];

/**
 * The Customize-mode overlay every canvas section renders inside (spec §6).
 * Wraps the LIVE panel — the same component Overview renders outside edit
 * mode — with a toolbar. Reordering is keyboard-operable Move up/down buttons
 * first; drag is not implemented here (out of scope for spec 1's list-based
 * canvas, deferred with the rest of the drag affordance to spec 2's free
 * canvas).
 */
export function SectionChrome({
  panel,
  title,
  cards,
  index,
  count,
  onHide,
  onMoveUp,
  onMoveDown,
  onSetWidth,
  onRename,
  onSetCards,
  children,
}: {
  panel: BuiltinPanel;
  title?: string;
  /** Only present for the `kpis` panel — opens the card picker. */
  cards?: KpiKey[];
  index: number;
  count: number;
  onHide: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onSetWidth: (w: 12 | 8 | 4) => void;
  onRename: (label: string) => void;
  onSetCards?: (cards: KpiKey[]) => void;
  children: React.ReactNode;
}) {
  const displayTitle = title ?? PANEL_LABEL[panel];
  const [label, setLabel] = useState(displayTitle);
  // Re-seeds `label` when the section's title changes from OUTSIDE typing —
  // "Reset to preset" replaces the whole draft config, and section ids are
  // shared across every preset, so this component never unmounts/remounts
  // and a plain `useState(displayTitle)` would keep showing the pre-reset
  // text. Adjusting state during render (React's documented pattern for
  // this, not a `useEffect`) means an in-progress edit is untouched: `title`
  // only changes on blur/reset, never on each keystroke.
  const [syncedTitle, setSyncedTitle] = useState(displayTitle);
  if (displayTitle !== syncedTitle) {
    setSyncedTitle(displayTitle);
    setLabel(displayTitle);
  }

  return (
    <div className="border-border-hover bg-surface/60 flex flex-col gap-2 rounded-lg border border-dashed p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => onRename(label)}
          aria-label={`Rename ${PANEL_LABEL[panel]}`}
          className="h-7 max-w-56 text-xs font-semibold"
        />
        <div className="flex items-center gap-1">
          {onSetCards ? (
            <Popover>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Choose KPI cards"
                    >
                      <Sliders />
                    </Button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent>Choose KPI cards</TooltipContent>
              </Tooltip>
              <PopoverContent align="end" className="w-64">
                <KpiPicker cards={cards ?? []} onChange={onSetCards} />
              </PopoverContent>
            </Popover>
          ) : (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Section width"
                    >
                      <Columns3 />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Section width</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                {WIDTHS.map((opt) => (
                  <DropdownMenuItem
                    key={opt.w}
                    onSelect={() => onSetWidth(opt.w)}
                  >
                    {opt.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Move up"
            disabled={index === 0}
            onClick={onMoveUp}
          >
            <ArrowUp />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Move down"
            disabled={index === count - 1}
            onClick={onMoveDown}
          >
            <ArrowDown />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Hide ${PANEL_LABEL[panel]}`}
            onClick={onHide}
          >
            <EyeOff />
          </Button>
        </div>
      </div>
      {children}
    </div>
  );
}

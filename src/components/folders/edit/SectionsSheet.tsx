"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, EyeOff, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import {
  BUILTIN_PANELS,
  type BuiltinPanel,
  type LayoutSection,
  type LayoutTab,
} from "@/lib/validations/folder-layout";

const PANEL_LABEL: Record<BuiltinPanel, string> = {
  kpis: "KPI cards",
  burn: "Planned vs completed",
  boardStatus: "Status by board",
  attention: "Needs attention",
  intelligence: "Intelligence",
  milestones: "Next milestones",
};

function TabRow({
  tab,
  index,
  count,
  onRename,
  onHide,
  onMove,
}: {
  tab: LayoutTab;
  index: number;
  count: number;
  onRename: (label: string) => void;
  onHide: () => void;
  onMove: (dir: "up" | "down") => void;
}) {
  const [label, setLabel] = useState(tab.label);
  return (
    <li className="flex items-center gap-2">
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => onRename(label)}
        aria-label={`Rename ${tab.label} tab`}
        className="h-7 flex-1 text-xs"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Move ${tab.label} tab up`}
        disabled={index === 0}
        onClick={() => onMove("up")}
      >
        <ArrowUp />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Move ${tab.label} tab down`}
        disabled={index === count - 1}
        onClick={() => onMove("down")}
      >
        <ArrowDown />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Hide ${tab.label} tab`}
        disabled={count <= 1}
        onClick={onHide}
      >
        <EyeOff />
      </Button>
    </li>
  );
}

/**
 * Customize-mode drawer: add back a hidden built-in panel to the active
 * canvas tab, and manage the tab strip itself (rename / hide / reorder). Every
 * action here is a draft mutation — nothing hits the server until Save.
 */
export function SectionsSheet({
  sections,
  tabs,
  onAddSection,
  onRenameTab,
  onHideTab,
  onMoveTab,
}: {
  /** The active canvas tab's current sections — panels already present are
   *  left off the "add back" list. */
  sections: LayoutSection[];
  tabs: LayoutTab[];
  onAddSection: (panel: BuiltinPanel) => void;
  onRenameTab: (id: string, label: string) => void;
  onHideTab: (id: string) => void;
  onMoveTab: (id: string, dir: "up" | "down") => void;
}) {
  const present = new Set(
    sections.filter((s) => s.type === "builtin").map((s) => s.panel),
  );
  const hidden = BUILTIN_PANELS.filter((p) => !present.has(p));

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Plus className="size-4" /> Sections
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Sections &amp; tabs</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-4 overflow-y-auto">
          <section className="flex flex-col gap-2">
            <h3 className="text-muted-foreground text-xs font-semibold uppercase">
              Hidden sections
            </h3>
            {hidden.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Every section is on the canvas.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {hidden.map((panel) => (
                  <li key={panel} className="flex items-center justify-between">
                    <span className="text-sm">{PANEL_LABEL[panel]}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onAddSection(panel)}
                    >
                      <Plus className="size-4" /> Add
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <Separator />
          <section className="flex flex-col gap-2">
            <h3 className="text-muted-foreground text-xs font-semibold uppercase">
              Tabs
            </h3>
            <ul className="flex flex-col gap-2">
              {tabs.map((tab, i) => (
                <TabRow
                  key={tab.id}
                  tab={tab}
                  index={i}
                  count={tabs.length}
                  onRename={(label) => onRenameTab(tab.id, label)}
                  onHide={() => onHideTab(tab.id)}
                  onMove={(dir) => onMoveTab(tab.id, dir)}
                />
              ))}
            </ul>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

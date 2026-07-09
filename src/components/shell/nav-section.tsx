"use client";

import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Kicker } from "@/components/ui/kicker";
import { useUIStore } from "@/stores/ui";

/**
 * A labelled, collapsible sidebar group. Collapse state lives in `useUIStore`
 * (client-only, persisted) keyed by `storageKey`, so folding a group is 0 server
 * round-trips. Default open (absent key). The chevron and — when there is no
 * `titleHref` — the title both toggle; a `titleHref` makes the title a real link
 * (e.g. Dashboards → /dashboards) while the chevron still toggles.
 */
export function NavSection({
  storageKey,
  title,
  titleHref,
  icon: Icon,
  action,
  children,
}: {
  storageKey: string;
  title: string;
  titleHref?: string;
  icon?: ComponentType<{ className?: string }>;
  action?: ReactNode;
  children: ReactNode;
}) {
  const collapsedSections = useUIStore((s) => s.collapsedSections);
  const toggleSection = useUIStore((s) => s.toggleSection);
  const open = !collapsedSections[storageKey];
  const bodyId = `nav-section-${storageKey}`;

  // Keystone section label: a mono `<Kicker>` eyebrow whose dim `--kicker`
  // color brightens to `--foreground` when the (group) toggle is hovered.
  const titleCn = "group flex items-center";
  const kickerCn =
    "transition-colors duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:text-foreground";

  return (
    <div className="flex flex-col gap-0.5 px-2 pt-2">
      <div className="flex items-center gap-1.5 px-1.5 py-1">
        <button
          type="button"
          onClick={() => toggleSection(storageKey)}
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={`${open ? "Collapse" : "Expand"} ${title}`}
          className="text-muted-foreground hover:text-foreground flex size-5 items-center justify-center rounded transition-colors"
        >
          {open ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
        </button>
        {Icon ? <Icon className="text-muted-foreground size-3.5" /> : null}
        {titleHref ? (
          <Link href={titleHref} className={titleCn}>
            <Kicker className={kickerCn}>{title}</Kicker>
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => toggleSection(storageKey)}
            aria-expanded={open}
            aria-controls={bodyId}
            className={titleCn}
          >
            <Kicker className={kickerCn}>{title}</Kicker>
          </button>
        )}
        {action ? (
          <div className="ml-auto flex items-center">{action}</div>
        ) : null}
      </div>
      <div id={bodyId} hidden={!open} className="flex flex-col gap-0.5">
        {children}
      </div>
    </div>
  );
}

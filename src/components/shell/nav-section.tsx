"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { Kicker } from "@/components/ui/kicker";
import { useUIStore } from "@/stores/ui";
import { cn } from "@/lib/utils";

/**
 * A labelled, collapsible sidebar group in the Keystone "ledger" style:
 *
 *   [ KICKER ][ ───── hairline rule ───── ][ chevron ][ actions ]
 *
 * Collapse state lives in `useUIStore.collapsedSections` (client-only,
 * persisted) keyed by `storageKey`, so folding is 0 server round-trips.
 * Default open (absent key).
 *
 * The whole header (kicker + rule + chevron) is ONE toggle button whose
 * accessible name is the title. With `titleHref` the kicker becomes a real
 * link (Dashboards → /dashboards) and the rule + chevron form the toggle,
 * labelled "Collapse/Expand <title>". Actions stay outside the button.
 *
 * The chevron is hidden until the header is hovered/focused, always visible
 * while the section is closed (so a folded group still says so), and always
 * visible under a coarse pointer (no hover on touch).
 */
export function NavSection({
  storageKey,
  title,
  titleHref,
  action,
  children,
}: {
  storageKey: string;
  title: string;
  titleHref?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const collapsedSections = useUIStore((s) => s.collapsedSections);
  const toggleSection = useUIStore((s) => s.toggleSection);
  const open = !collapsedSections[storageKey];
  const bodyId = `nav-section-${storageKey}`;

  const kicker = (
    <Kicker className="ease-keystone group-hover/sec:text-foreground transition-colors duration-300">
      {title}
    </Kicker>
  );
  const rule = (
    <span
      aria-hidden="true"
      data-nav-rule
      className="bg-border ease-keystone group-hover/sec:bg-border-bright h-px min-w-3 flex-1 transition-colors duration-300"
    />
  );
  const chevron = (
    <span
      aria-hidden="true"
      data-nav-chevron
      className={cn(
        "text-muted-foreground ease-keystone flex shrink-0 transition-[opacity,transform] duration-200 group-focus-within/sec:opacity-100 group-hover/sec:opacity-100 pointer-coarse:opacity-100",
        open ? "opacity-0" : "-rotate-90",
      )}
    >
      <ChevronDown className="size-3.5" />
    </span>
  );
  const toggleBase =
    "flex min-w-0 flex-1 items-center gap-2 rounded focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

  return (
    <div className="flex flex-col gap-0.5 px-2 pt-3.5">
      <div className="group/sec flex h-6.5 items-center gap-2 pr-1 pl-7">
        {titleHref ? (
          <>
            <Link
              href={titleHref}
              className="focus-visible:ring-ring shrink-0 rounded focus-visible:ring-2 focus-visible:outline-none"
            >
              {kicker}
            </Link>
            <button
              type="button"
              onClick={() => toggleSection(storageKey)}
              aria-expanded={open}
              aria-controls={bodyId}
              aria-label={`${open ? "Collapse" : "Expand"} ${title}`}
              className={toggleBase}
            >
              {rule}
              {chevron}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => toggleSection(storageKey)}
            aria-expanded={open}
            aria-controls={bodyId}
            className={toggleBase}
          >
            {kicker}
            {rule}
            {chevron}
          </button>
        )}
        {action ? (
          <div className="flex shrink-0 items-center">{action}</div>
        ) : null}
      </div>
      <div id={bodyId} hidden={!open} className="flex flex-col gap-0.5">
        {children}
      </div>
    </div>
  );
}

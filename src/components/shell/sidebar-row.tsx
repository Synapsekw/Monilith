import Link from "next/link";
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ComponentType,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

/**
 * The sidebar's one row grammar (spec: 2026-09-11-sidebar-keystone-polish).
 *
 * Every navigable row — top-level links, folder headers, board rows (plain,
 * shared, sortable), dashboard rows, footer links — is built from these three
 * pieces so text edges, hover and active state are identical everywhere:
 *
 *   [ 24px lead slot ][ label (pl-1) … ][ trailing ]
 *
 * The row itself carries NO `gap-*` and NO `pl-*` (BoardsNav's alignment
 * suite pins that): the 4px between slot and label is the label's `pl-1`.
 * Text edge = sidebar px-2 (8) + slot (24) + pl-1 (4) = 36px.
 *
 * Active = `--state-selected` tint + a 3px `--brand` bar on the sidebar's
 * outer edge (`before:-left-2` cancels the sidebar's px-2). Rows nested in a
 * folder body (`pl-3`) pass `before:-left-5` so the bar stays on the edge.
 * Never a solid brand fill under `text-foreground` — white on periwinkle is
 * ~2:1 and fails AA. `sidebar-active-guard.test.ts` pins that.
 */
export const SIDEBAR_LEAD_CLASS =
  "flex size-6 shrink-0 items-center justify-center";

const ROW_BASE =
  "group/row relative flex items-center rounded-md pr-1 transition-colors";
const ROW_IDLE =
  "text-muted-foreground hover:bg-state-hover hover:text-foreground";
const ROW_ACTIVE =
  "bg-state-selected text-foreground before:absolute before:-left-2 before:w-[3px] before:rounded-r-full before:bg-primary before:content-['']";

export function sidebarRowClass({
  active = false,
  child = false,
  className,
}: {
  active?: boolean;
  child?: boolean;
  className?: string;
}): string {
  return cn(
    ROW_BASE,
    child ? "min-h-7" : "min-h-8",
    active ? ROW_ACTIVE : ROW_IDLE,
    active &&
      (child
        ? "before:top-1 before:bottom-1"
        : "before:top-1.5 before:bottom-1.5"),
    className,
  );
}

export function sidebarLabelClass(child = false): string {
  return cn(
    "min-w-0 flex-1 truncate py-1 pr-1 pl-1",
    child ? "text-xs font-medium" : "text-sm",
  );
}

export type SidebarRowProps = ComponentPropsWithoutRef<"div"> & {
  active?: boolean;
  child?: boolean;
  /** `undefined` → inert 24px spacer; `null` → nothing (the caller renders its
   *  own leading element as its first child); a node → rendered in the slot. */
  lead?: ReactNode | null;
  trailing?: ReactNode;
};

export const SidebarRow = forwardRef<HTMLDivElement, SidebarRowProps>(
  function SidebarRow(
    { active, child, lead, trailing, className, children, ...rest },
    ref,
  ) {
    return (
      <div
        ref={ref}
        className={sidebarRowClass({ active, child, className })}
        {...rest}
      >
        {lead === null ? null : (
          <span
            className={SIDEBAR_LEAD_CLASS}
            aria-hidden={lead === undefined ? true : undefined}
          >
            {lead}
          </span>
        )}
        {children}
        {trailing}
      </div>
    );
  },
);

export type SidebarLinkProps = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  active?: boolean;
  child?: boolean;
  className?: string;
};

export function SidebarLink({
  href,
  label,
  icon: Icon,
  active = false,
  child = false,
  className,
}: SidebarLinkProps) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={sidebarRowClass({ active, child, className })}
    >
      <span className={SIDEBAR_LEAD_CLASS}>
        <Icon className="size-4" />
      </span>
      <span className={sidebarLabelClass(child)}>{label}</span>
    </Link>
  );
}

/* ---------- collapsed rail ---------- */

const TILE_BASE =
  "relative flex size-9 max-w-full flex-col items-center justify-center gap-0.5 rounded-md text-sm font-medium transition-colors pointer-coarse:size-auto pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:px-1 pointer-coarse:py-1.5";
const TILE_IDLE =
  "text-muted-foreground hover:bg-state-hover hover:text-foreground";
const TILE_ACTIVE =
  "bg-state-selected text-foreground before:absolute before:-left-2.5 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r-full before:bg-primary before:content-['']";

export function railTileClass({
  active = false,
  className,
}: {
  active?: boolean;
  className?: string;
}): string {
  return cn(TILE_BASE, active ? TILE_ACTIVE : TILE_IDLE, className);
}

/** Decorative 16px hairline between rail groups. */
export function RailDivider() {
  return (
    <span aria-hidden="true" className="bg-border my-1.5 h-px w-4 shrink-0" />
  );
}

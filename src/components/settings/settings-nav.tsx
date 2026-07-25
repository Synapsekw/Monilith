"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Kicker } from "@/components/ui/kicker";
import { cn } from "@/lib/utils";

export type SettingsNavItem = { href: string; label: string };
export type SettingsNavGroup = { label: string; items: SettingsNavItem[] };

/**
 * Settings sub-navigation. A client component only because the active state
 * comes from usePathname(); the links are ordinary <Link> navigations, so each
 * section fetches its own data and nothing else (spec §Performance).
 *
 * Chrome stays monochrome — the active item is a neutral surface step, not a
 * brand fill. The accent is reserved for actions and focus.
 */
export function SettingsNav({ groups }: { groups: SettingsNavGroup[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Settings" className="flex flex-col">
      {groups.map((group) => (
        <div key={group.label} className="mb-5 last:mb-0">
          <Kicker className="mb-2 block px-2">{group.label}</Kicker>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "ease-keystone block rounded-sm px-2 py-1.5 text-sm transition-colors",
                      "focus-visible:ring-ring/50 focus-visible:ring-2 focus-visible:outline-none",
                      active
                        ? "bg-surface-muted text-foreground font-medium"
                        : "text-muted-foreground hover:bg-surface-muted/60 hover:text-foreground",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Switch } from "@/components/ui/switch";
import { DirhamSign } from "@/components/boards/CurrencyAmount";
import type { CacheColumn } from "@/lib/boards/cache";
import {
  COMMON_CURRENCY_CODES,
  CURRENCY_CODES,
  currencyLabel,
  currencyOf,
  dirhamSignEnabled,
  isCurrencyCode,
  type CurrencyCode,
} from "@/lib/boards/currency";
import { cn } from "@/lib/utils";

const RECENT_KEY = "pulse.currency.recent";
const RECENT_MAX = 3;

/** Last-picked codes, newest first. Per-device (localStorage); [] when unavailable. */
export function readRecentCurrencies(): CurrencyCode[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(raw)
      ? raw.filter(isCurrencyCode).slice(0, RECENT_MAX)
      : [];
  } catch {
    return [];
  }
}

export function pushRecentCurrency(code: CurrencyCode): void {
  try {
    const next = [code, ...readRecentCurrencies().filter((c) => c !== code)];
    localStorage.setItem(RECENT_KEY, JSON.stringify(next.slice(0, RECENT_MAX)));
  } catch {
    // localStorage unavailable (private mode/SSR) — recents silently absent.
  }
}

/**
 * Body of the "Change currency" dialog. QUICK SELECTION is the acceptance bar
 * (spec §5.2): autofocused search over "CODE — Display Name", Recent (local
 * picks) and Common (GCC + majors) groups visible with zero typing, and
 * INSTANT APPLY — selecting a code saves + closes, no confirm button. Pure
 * client picker (0 round-trips to open — spec §6); only the save persists,
 * via the existing updateColumnSettings action. Amounts are never converted.
 */
export function CurrencyDialog({
  column,
  onSave,
}: {
  column: CacheColumn;
  onSave: (settings: Record<string, unknown>) => void;
}) {
  const current = currencyOf(column.settings);
  // Snapshot once per open; updated list shows on the NEXT open.
  const [recent] = useState<CurrencyCode[]>(() => readRecentCurrencies());

  function pick(code: CurrencyCode) {
    pushRecentCurrency(code);
    onSave({
      ...((column.settings as Record<string, unknown>) ?? {}),
      currency: code,
    });
  }

  function item(code: CurrencyCode, group: string) {
    return (
      <CommandItem
        key={`${group}:${code}`}
        // Match code, currency name, AND group so search-by-anything works
        // (e.g. "kuwait" hits via the display name "Kuwaiti Dinar").
        value={`${group} ${currencyLabel(code)}`}
        onSelect={() => pick(code)}
      >
        <Check
          className={cn(
            "size-4",
            code === current ? "opacity-100" : "opacity-0",
          )}
        />
        {currencyLabel(code)}
      </CommandItem>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Command>
        {/* autoFocus = search-first: the fastest path is type → Enter. */}
        <CommandInput autoFocus placeholder="Search currencies…" />
        <CommandList className="max-h-64">
          <CommandEmpty>No currency found.</CommandEmpty>
          {recent.length > 0 && (
            <CommandGroup heading="Recent">
              {recent.map((code) => item(code, "recent"))}
            </CommandGroup>
          )}
          <CommandGroup heading="Common">
            {COMMON_CURRENCY_CODES.map((code) => item(code, "common"))}
          </CommandGroup>
          <CommandGroup heading="All currencies">
            {CURRENCY_CODES.map((code) => item(code, "all"))}
          </CommandGroup>
        </CommandList>
      </Command>
      <p className="text-muted-foreground text-xs">
        Amounts are not converted.
      </p>
      {current === "AED" && (
        <label className="flex items-center justify-between gap-2 text-xs">
          <span className="flex items-center gap-1">
            Use new dirham sign (
            <DirhamSign className="inline-block" />)
          </span>
          <Switch
            aria-label="Use new dirham sign"
            checked={dirhamSignEnabled(column.settings)}
            onCheckedChange={(checked) =>
              onSave({
                ...((column.settings as Record<string, unknown>) ?? {}),
                dirham_sign: checked,
              })
            }
          />
        </label>
      )}
    </div>
  );
}

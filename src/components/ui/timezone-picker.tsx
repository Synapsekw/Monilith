"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import {
  listTimeZones,
  timezoneLabel,
  detectDeviceTimeZone,
} from "@/lib/datetime/timezone";

export function TimezonePicker({
  value,
  onChange,
  allowAutomatic = false,
  disabled = false,
}: {
  value: string | null;
  onChange: (tz: string | null) => void;
  allowAutomatic?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // One reference instant per mount keeps offset labels stable across renders.
  const ref = useMemo(() => new Date(), []);
  const options = useMemo(
    () => listTimeZones().map((zone) => ({ zone, label: timezoneLabel(zone, ref) })),
    [ref],
  );

  const triggerLabel =
    value === null
      ? allowAutomatic
        ? `Automatic — ${detectDeviceTimeZone()}`
        : "Select timezone"
      : timezoneLabel(value, ref);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-label={triggerLabel}
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Search timezone…" />
          <CommandList>
            <CommandEmpty>No timezone found.</CommandEmpty>
            <CommandGroup>
              {allowAutomatic && (
                <CommandItem
                  value="Automatic device"
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === null ? "opacity-100" : "opacity-0",
                    )}
                  />
                  Automatic — {detectDeviceTimeZone()}
                </CommandItem>
              )}
              {options.map((o) => (
                <CommandItem
                  key={o.zone}
                  value={`${o.label} ${o.zone}`}
                  onSelect={() => {
                    onChange(o.zone);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === o.zone ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {o.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

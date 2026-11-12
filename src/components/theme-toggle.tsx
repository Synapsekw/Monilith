"use client";

import { useEffect } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  THEME_PRESETS,
  swatchAccentFill,
  type ThemePresetId,
} from "@/lib/theme/presets";
import { useThemePreset } from "@/lib/theme/use-theme-preset";

export function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme();
  // No `initial` here: the dropdown content only mounts once the menu is
  // opened (client-only at that point), so there is no server-rendered
  // `aria-checked` to mismatch against.
  const { preset, setPreset, error, refresh } = useThemePreset();

  // The menu closes on select, so an inline error message would never be
  // seen — surface a reverted choice as a toast instead.
  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  return (
    <DropdownMenu onOpenChange={(open) => open && refresh()}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label="Toggle theme"
        >
          <Sun className="size-4 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
          <Moon className="absolute size-4 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")}>
          <Sun className="size-4" /> Light
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          <Moon className="size-4" /> Dark
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          <Monitor className="size-4" /> System
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={preset}
          onValueChange={(value) => setPreset(value as ThemePresetId)}
        >
          {THEME_PRESETS.map((p) => {
            const swatch =
              resolvedTheme === "dark" ? p.swatch.dark : p.swatch.light;
            // Same rule as the settings tiles: a second accent stretches the
            // dot into a pill, or the gradient cannot be seen.
            const pill = swatch.accent2 !== undefined;
            return (
              <DropdownMenuRadioItem key={p.id} value={p.id}>
                {/* Inline hex is correct here and nowhere else: the swatch IS
                    the data — it previews palettes that aren't active yet, so
                    semantic tokens can't stand in for it. */}
                <span
                  aria-hidden
                  data-swatch-accent=""
                  data-swatch-shape={pill ? "pill" : "dot"}
                  className={
                    pill
                      ? "h-3 w-6 shrink-0 rounded-full"
                      : "size-3 shrink-0 rounded-full"
                  }
                  style={{ background: swatchAccentFill(swatch) }}
                />
                {p.label}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

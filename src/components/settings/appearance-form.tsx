"use client";

import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
] as const;

/**
 * Theme picker. next-themes persists to localStorage and writes the `dark`
 * class, so there is no server round-trip and nothing to save — selection is
 * the commit. Mirrors the header ThemeToggle, which stays where it is; this
 * exists because Settings is where people look for it.
 *
 * Real radio inputs (visually hidden) rather than buttons, so the group is
 * keyboard-navigable with arrow keys and announces as a radiogroup.
 */
export function AppearanceForm() {
  const { theme, setTheme } = useTheme();

  return (
    <fieldset className="flex gap-2">
      <legend className="sr-only">Theme</legend>
      {OPTIONS.map((opt) => (
        <label
          key={opt.value}
          className={cn(
            "border-border ease-keystone flex-1 cursor-pointer rounded-sm border px-3 py-2 text-center text-sm transition-colors",
            "has-[:focus-visible]:ring-ring/50 has-[:focus-visible]:ring-2",
            theme === opt.value
              ? "border-border-bright bg-surface-muted text-foreground font-medium"
              : "text-muted-foreground hover:border-border-hover hover:text-foreground",
          )}
        >
          <input
            type="radio"
            name="theme"
            value={opt.value}
            className="sr-only"
            checked={theme === opt.value}
            onChange={() => setTheme(opt.value)}
          />
          {opt.label}
        </label>
      ))}
    </fieldset>
  );
}

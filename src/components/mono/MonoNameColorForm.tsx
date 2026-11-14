"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { MonoAvatar } from "./MonoAvatar";
import {
  DEFAULT_MONO_COLOR,
  MONO_PRESET_COLORS,
  isMonoColor,
} from "./mono-palette";

export type MonoNameColor = { name: string; color: string };

/** The first-open picker (rail) and the rename/recolour form (settings). */
export function MonoNameColorForm({
  initialName = "",
  initialColor = DEFAULT_MONO_COLOR,
  submitLabel,
  onSubmit,
}: {
  initialName?: string;
  initialColor?: string;
  submitLabel: string;
  /** Resolves to an error message, or null on success. */
  onSubmit: (value: MonoNameColor) => Promise<string | null>;
}) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(
    isMonoColor(initialColor) ? initialColor.toLowerCase() : DEFAULT_MONO_COLOR,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const trimmed = name.trim();
  const valid =
    trimmed.length >= 1 && trimmed.length <= 40 && isMonoColor(color);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        startTransition(async () => {
          try {
            setError(await onSubmit({ name: trimmed, color }));
          } catch {
            setError("Something went wrong. Try again.");
          }
        });
      }}
    >
      <div className="flex justify-center">
        <MonoAvatar
          color={color}
          mood="hello"
          size={88}
          label={trimmed ? `${trimmed}, your Mono` : "Your Mono"}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mono-name">Name</Label>
        <Input
          id="mono-name"
          value={name}
          maxLength={40}
          autoComplete="off"
          placeholder="Nova"
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">Colour</legend>
        <div className="flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="Colour" className="flex gap-2">
            {MONO_PRESET_COLORS.map((c) => (
              <button
                key={c.hex}
                type="button"
                role="radio"
                aria-checked={color === c.hex}
                aria-label={c.name}
                onClick={() => setColor(c.hex)}
                className={cn(
                  "focus-visible:ring-ring size-7 rounded-full border-2 transition-transform focus-visible:ring-2 focus-visible:outline-none pointer-coarse:size-11",
                  color === c.hex
                    ? "border-foreground scale-110"
                    : "border-transparent",
                )}
                style={{ backgroundColor: c.hex }}
              />
            ))}
          </div>
          <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <input
              type="color"
              aria-label="Custom colour"
              value={color}
              onChange={(e) => setColor(e.target.value.toLowerCase())}
              className="size-7 cursor-pointer rounded-full border-0 bg-transparent p-0 pointer-coarse:size-11"
            />
            Custom
          </label>
        </div>
      </fieldset>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={!valid || pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}

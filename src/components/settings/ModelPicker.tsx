"use client";

import { useId, useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import type { ModelTier } from "@/lib/ai/models/feed-parse";
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

/**
 * One selectable catalog entry. `modelId` is the CATALOG KEY
 * (`ai_models.model_id`) — what a pin stores and the usage ledger records.
 * There is deliberately no field for the wire id (`native_model_id`): only an
 * adapter may ever see that, so the picker cannot display or store it.
 */
export type ModelOption = {
  provider: string;
  providerLabel: string;
  modelId: string;
  label: string;
  tier: ModelTier;
  supportsTools: boolean;
  /**
   * `ai_models.context_length`, straight from the catalog row — null only for
   * the handful of rows the daily feed refresh has not backfilled yet. Same
   * field, same nullability as `ResolvedModel.contextLength`
   * (`src/lib/ai/models/resolve.ts`); threaded through here so the per-agent
   * reference-document budget meter (`DocumentPicker`) can compute the same
   * number the run loop will, from the model the owner has actually selected,
   * with zero extra server round-trips.
   */
  contextLength: number | null;
};

export type ModelValue = { provider: string; modelId: string };

export type EmptyProvider = { provider: string; providerLabel: string };

/**
 * The `emptyProviders` argument, derived: every enabled provider that has no
 * selectable model in `options`. Both surfaces that render this picker (the org
 * default and the per-agent pin) need the same answer, so it is computed here
 * rather than twice — and it takes a structural `{ id, label }` so a client
 * component never has to reach into the server-only provider-row module.
 */
export function providersWithoutModels(
  providers: { id: string; label: string }[],
  options: ModelOption[],
): EmptyProvider[] {
  return providers
    .filter((p) => !options.some((o) => o.provider === p.id))
    .map((p) => ({ provider: p.id, providerLabel: p.label }));
}

/**
 * Shared provider+model picker, used by the org default (here) and, next, the
 * per-agent pin.
 *
 * Receives EVERY option as a prop from a server component and filters purely in
 * client state — opening it, searching it and switching provider are 0 server
 * round-trips (working agreement #5). Never fetch the catalog from here.
 *
 * Every label comes from the option that a `ProviderRow` / `ai_models` row
 * produced. Nothing here knows a fixed set of providers: the registry is open
 * by design, and a static provider map is exactly what used to throw the whole
 * settings page on a Mistral or Kimi value.
 *
 * When `value` names a model that is not in `options`, the model has been
 * retired (or its provider's key removed) out from under the user. The value
 * stays visible with a note rather than silently resetting, because a silent
 * reset hides why an agent's output changed.
 */
export function ModelPicker({
  options,
  value,
  onChange,
  emptyProviders = [],
  allowInherit = false,
  inheritLabel = "Use org default",
  disabled = false,
  emptyHint,
  label = "Model",
  describedBy,
}: {
  options: ModelOption[];
  value: ModelValue | null;
  onChange: (v: ModelValue | null) => void;
  /**
   * Enabled providers that currently have NO selectable model. They are listed
   * as their own (unselectable) group so the gap reads as a configuration state
   * — a provider's catalog is only verifiable with that provider's own key, so
   * "nothing here" means "no key yet", not "this provider is broken".
   * Derive it with {@link providersWithoutModels}.
   */
  emptyProviders?: EmptyProvider[];
  allowInherit?: boolean;
  inheritLabel?: string;
  disabled?: boolean;
  /** Replaces the default "no models yet" line. */
  emptyHint?: string;
  /**
   * The field's static name, e.g. "Model" or "Default model" — the trigger's
   * accessible NAME. Stays static regardless of selection: the chosen model
   * is exposed separately as the accessible DESCRIPTION (`aria-describedby`,
   * wired to the same text sighted users see in the trigger), not folded
   * into the name. See {@link TimezonePicker} — same shared shape, same fix.
   */
  label?: string;
  /**
   * Id(s) of text the CALLER owns that belongs to this control's accessible
   * description — a validation error beside the field, typically from
   * `useFieldStatus` (`controlProps["aria-describedby"]`,
   * `src/components/ui/field-status.tsx`).
   *
   * MERGED with, never substituted for, the picker's own value description:
   * `aria-describedby` is a space-separated id LIST, so replacing it would
   * cost a screen-reader user the one thing the trigger says about its own
   * state. Order is deliberate — what is selected, then what is wrong with it.
   *
   * Deliberately describedby ONLY, no `aria-invalid` counterpart: the trigger
   * is a `<Button>`, whose variants style `aria-invalid` with a destructive
   * border and ring, and this field's error is announced, not restyled.
   */
  describedBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const valueId = useId();

  // Grouped by provider, insertion-ordered: the server hands options over
  // already sorted (providers by label, models cheapest-first within one).
  const groups = useMemo(() => {
    const byProvider = new Map<string, ModelOption[]>();
    for (const o of options) {
      const list = byProvider.get(o.provider);
      if (list) list.push(o);
      else byProvider.set(o.provider, [o]);
    }
    return [...byProvider.values()];
  }, [options]);

  const selected = useMemo(
    () =>
      value
        ? (options.find(
            (o) => o.provider === value.provider && o.modelId === value.modelId,
          ) ?? null)
        : null,
    [options, value],
  );
  const retired = value !== null && selected === null;

  // Nothing to offer AND nothing to undo — the only useful thing left is the
  // sentence. With a value still set the picker stays, however empty, because
  // it is the only way back out of a stored choice.
  if (options.length === 0 && value === null)
    return (
      <p className="text-muted-foreground text-xs">
        {emptyHint ??
          "Add an API key to see models — a provider's models appear once you save a key for it."}
      </p>
    );

  return (
    <div className="space-y-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-label={label}
            aria-describedby={
              describedBy ? `${valueId} ${describedBy}` : valueId
            }
            aria-expanded={open}
            disabled={disabled}
            className="border-border hover:border-border-hover w-full justify-between font-normal transition-colors"
          >
            <span id={valueId} className="truncate">
              {selected ? (
                <>
                  {selected.label}
                  <span className="text-muted-foreground">
                    {" · "}
                    {selected.providerLabel}
                  </span>
                </>
              ) : retired ? (
                <span className="font-mono text-xs">{value.modelId}</span>
              ) : allowInherit ? (
                inheritLabel
              ) : (
                "Pick a model"
              )}
            </span>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] p-0"
          align="start"
        >
          <Command>
            <CommandInput placeholder="Search models…" />
            <CommandList>
              <CommandEmpty>No model matches.</CommandEmpty>
              {allowInherit && (
                <CommandGroup>
                  <CommandItem
                    value={inheritLabel}
                    onSelect={() => {
                      onChange(null);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 size-4",
                        value === null ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {inheritLabel}
                  </CommandItem>
                </CommandGroup>
              )}
              {groups.map((models) => (
                <CommandGroup
                  key={models[0].provider}
                  heading={models[0].providerLabel}
                >
                  {models.map((m) => (
                    <CommandItem
                      key={`${m.provider}/${m.modelId}`}
                      // Searchable by human label AND by catalog key: admins
                      // paste the id they saw in an agent or the ledger.
                      value={`${m.providerLabel} ${m.label} ${m.modelId}`}
                      onSelect={() => {
                        onChange({ provider: m.provider, modelId: m.modelId });
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 size-4 shrink-0",
                          m.provider === value?.provider &&
                            m.modelId === value?.modelId
                            ? "opacity-100"
                            : "opacity-0",
                        )}
                      />
                      <span className="truncate">{m.label}</span>
                      <span className="text-kicker text-2xs ml-auto shrink-0 pl-2 font-mono tracking-[0.12em] uppercase">
                        {m.tier}
                        {!m.supportsTools && " · no tools"}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ))}
              {emptyProviders.map((p) => (
                <CommandGroup key={p.provider} heading={p.providerLabel}>
                  <CommandItem disabled value={`${p.providerLabel} no models`}>
                    <span className="text-muted-foreground text-xs">
                      Add an API key to see models
                    </span>
                  </CommandItem>
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {retired && (
        <p className="text-muted-foreground text-xs">
          That model is no longer available — pick another one. Until you do,
          each feature runs on its own tier.
        </p>
      )}
    </div>
  );
}

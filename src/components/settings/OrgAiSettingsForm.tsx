"use client";

import { useState, useTransition } from "react";
import {
  setAiMode,
  setOrgByoKey,
  removeOrgByoKey,
  setOrgDefaultModel,
} from "@/lib/ai/settings-actions";
import { type AiMode } from "@/lib/ai/org-settings";
import type { ProviderRow } from "@/lib/ai/providers/provider-rows";
import {
  ModelPicker,
  type ModelOption,
  type ModelValue,
} from "@/components/settings/ModelPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Initial = {
  mode: AiMode;
  tier: string;
  creditsLimit: number;
  creditsUsed: number;
  byoProvider: string | null;
  byoKeyLast4: string | null;
  defaultProvider: string | null;
  defaultModelId: string | null;
};

const MODES: { id: AiMode; title: string; hint: string }[] = [
  { id: "off", title: "Off", hint: "No AI features" },
  {
    id: "managed",
    title: "Managed",
    hint: "Included in your plan — uses the workspace allowance",
  },
  {
    id: "org_byo",
    title: "Organization key",
    hint: "One shared key for everyone",
  },
  {
    id: "per_user",
    title: "Members' own keys",
    hint: "Each member adds a personal key",
  },
];

/** The provider that serves `managed` mode — see gateway.ts, whose platform key
 *  is Anthropic's, so a default on any other provider cannot apply there. */
const MANAGED_PROVIDER = "anthropic";

/**
 * Admin Settings → "Organization AI". Picks how AI is powered for the whole org
 * (off / managed allowance / one shared org key / each member's own key),
 * manages the shared org key, and sets the org-wide default model.
 *
 * Every piece of provider metadata — label, key placeholder — comes from the
 * `ai_providers` rows passed in, exactly as `AiKeyList` does. This form used to
 * index a hardcoded three-entry map with `byo_provider`, which is now an open
 * `string`: a Mistral or Kimi value read `.label` off `undefined` and threw the
 * whole settings page for every admin in the org. The map is gone, not guarded.
 *
 * Nothing here fetches. Mode, key state and the chosen model are client state
 * over data the page loaded once, so every in-page interaction is 0 server
 * round-trips (working agreement #5); only the four mutations talk to the
 * server. Mode changes are optimistic and revert on failure; inline messages,
 * so an error sits on the control that caused it.
 */
export function OrgAiSettingsForm({
  initial,
  providers,
  modelOptions,
}: {
  initial: Initial;
  providers: ProviderRow[];
  modelOptions: ModelOption[];
}) {
  // `mode` is optimistic; `confirmed` is the last server-acknowledged mode we
  // revert to when a change is rejected.
  const [mode, setMode] = useState<AiMode>(initial.mode);
  const [confirmed, setConfirmed] = useState<AiMode>(initial.mode);
  const [modeError, setModeError] = useState<string | null>(null);
  const [modePending, startMode] = useTransition();

  const [byoProvider, setByoProvider] = useState<string | null>(
    initial.byoProvider,
  );
  const [byoKeyLast4, setByoKeyLast4] = useState<string | null>(
    initial.byoKeyLast4,
  );
  const [provider, setProvider] = useState<string>(
    initial.byoProvider ?? providers[0]?.id ?? "",
  );
  const [key, setKey] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keyPending, startKey] = useTransition();

  const [defaultModel, setDefaultModel] = useState<ModelValue | null>(
    initial.defaultProvider && initial.defaultModelId
      ? { provider: initial.defaultProvider, modelId: initial.defaultModelId }
      : null,
  );
  const [defaultError, setDefaultError] = useState<string | null>(null);
  const [defaultPending, startDefault] = useTransition();

  // Never an index into a fixed map: a provider row can disappear (disabled)
  // while a stored id still names it, and the id is a better label than a crash.
  const labelOf = (id: string) =>
    providers.find((p) => p.id === id)?.label ?? id;
  const selectedProvider = providers.find((p) => p.id === provider) ?? null;

  // Providers with no selectable model yet. Listed inside the picker rather than
  // hidden, because "no models" here means "nobody has saved a key for it" — a
  // provider's catalog ids are only verifiable with that provider's own key.
  const emptyProviders = providers
    .filter((p) => !modelOptions.some((o) => o.provider === p.id))
    .map((p) => ({ provider: p.id, providerLabel: p.label }));

  function chooseMode(next: AiMode) {
    if (next === mode || modePending) return;
    setModeError(null);
    setMode(next); // optimistic
    startMode(async () => {
      const res = await setAiMode({ mode: next });
      if (res.ok) {
        setConfirmed(next);
      } else {
        setMode(confirmed); // revert
        setModeError(res.error);
      }
    });
  }

  function saveKey() {
    setKeyError(null);
    startKey(async () => {
      const res = await setOrgByoKey({ provider, key: key.trim() });
      if (res.ok) {
        setByoProvider(res.data.provider);
        setByoKeyLast4(res.data.hint);
        setKey("");
      } else {
        setKeyError(res.error);
      }
    });
  }

  function removeKey() {
    setKeyError(null);
    startKey(async () => {
      const res = await removeOrgByoKey();
      if (res.ok) {
        setByoProvider(null);
        setByoKeyLast4(null);
      } else {
        setKeyError(res.error);
      }
    });
  }

  function chooseDefaultModel(next: ModelValue | null) {
    if (!next) return;
    const previous = defaultModel;
    setDefaultError(null);
    setDefaultModel(next); // optimistic
    startDefault(async () => {
      const res = await setOrgDefaultModel(next);
      if (!res.ok) {
        setDefaultModel(previous); // revert
        setDefaultError(res.error);
      }
    });
  }

  // A default only takes effect when its provider is the one actually serving
  // the request (see gateway.ts · defaultModelIdFor). Say so rather than hiding
  // the choice: the mode can change tomorrow, and a silently inert setting is
  // worse than an explained one.
  const inertBecause =
    defaultModel === null
      ? null
      : mode === "managed" && defaultModel.provider !== MANAGED_PROVIDER
        ? `Managed AI runs on ${labelOf(MANAGED_PROVIDER)}, so this applies only once the organization uses its own keys.`
        : mode === "org_byo" &&
            byoProvider !== null &&
            defaultModel.provider !== byoProvider
          ? `The organization key is a ${labelOf(byoProvider)} key, so this applies only to ${labelOf(defaultModel.provider)} runs.`
          : null;

  const usedPct =
    initial.creditsLimit > 0
      ? Math.min(
          100,
          Math.round((initial.creditsUsed / initial.creditsLimit) * 100),
        )
      : 0;

  return (
    <div className="space-y-5">
      <fieldset
        className="space-y-1"
        disabled={modePending}
        aria-label="AI mode"
      >
        {MODES.map((m) => (
          <label
            key={m.id}
            className="hover:bg-state-hover flex cursor-pointer items-start gap-3 rounded-md px-2 py-2"
          >
            <input
              type="radio"
              name="org-ai-mode"
              value={m.id}
              className="accent-primary mt-0.5 size-4"
              checked={mode === m.id}
              onChange={() => chooseMode(m.id)}
            />
            <span className="space-y-0.5">
              <span className="block text-sm font-medium">{m.title}</span>
              <span className="text-muted-foreground block text-xs">
                {m.hint}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {modeError && (
        <p role="alert" className="text-destructive text-xs">
          {modeError}
        </p>
      )}

      {mode === "managed" && (
        <div className="space-y-1.5">
          <p className="text-muted-foreground text-xs">
            {initial.creditsUsed} / {initial.creditsLimit} credits this month
          </p>
          <div
            className="bg-muted h-1.5 w-full overflow-hidden rounded-full"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={initial.creditsLimit}
            aria-valuenow={initial.creditsUsed}
          >
            <div
              className="bg-primary h-full rounded-full"
              style={{ width: `${usedPct}%` }}
            />
          </div>
        </div>
      )}

      <div className="border-border space-y-3 border-t pt-4">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Organization key</p>
          <p className="text-muted-foreground text-xs">
            One shared key powers AI for everyone when the org-key mode is on.
          </p>
        </div>

        {byoKeyLast4 ? (
          <div className="border-border hover:border-border-hover flex items-center justify-between rounded-lg border px-3 py-2.5 transition-colors">
            <div className="min-w-0 space-y-0.5">
              <p className="truncate text-sm font-medium">
                {byoProvider ? labelOf(byoProvider) : "Organization key"}
              </p>
              <p className="text-muted-foreground truncate font-mono text-xs">
                {byoKeyLast4}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:bg-destructive/10 shrink-0"
              onClick={removeKey}
              disabled={keyPending}
            >
              Remove
            </Button>
          </div>
        ) : providers.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No AI providers are enabled for this deployment yet.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Provider</Label>
              <div className="flex flex-wrap gap-2">
                {providers.map((p) => (
                  <Button
                    key={p.id}
                    type="button"
                    size="sm"
                    variant={p.id === provider ? "default" : "outline"}
                    disabled={keyPending}
                    onClick={() => {
                      setProvider(p.id);
                      setKeyError(null);
                    }}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="org-ai-key">Organization API key</Label>
              <Input
                id="org-ai-key"
                type="password"
                value={key}
                autoComplete="off"
                spellCheck={false}
                placeholder={selectedProvider?.keyPlaceholder ?? ""}
                aria-invalid={keyError ? true : undefined}
                disabled={keyPending}
                onChange={(e) => {
                  setKey(e.target.value);
                  setKeyError(null);
                }}
              />
              <p className="text-muted-foreground text-xs">
                Stored encrypted. Used to run AI features for the whole
                organization.
              </p>
            </div>

            <Button
              onClick={saveKey}
              disabled={keyPending || key.trim().length < 10}
              size="sm"
            >
              {keyPending ? "Verifying…" : "Validate & save"}
            </Button>
          </div>
        )}

        {keyError && (
          <p role="alert" className="text-destructive text-xs">
            {keyError}
          </p>
        )}
      </div>

      <div className="border-border space-y-3 border-t pt-4">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Default model</p>
          <p className="text-muted-foreground text-xs">
            Every AI feature runs on this model when its provider is the one
            serving the request — including features that would otherwise pick a
            cheaper or stronger model for the job. Agents with their own model
            keep it.
          </p>
        </div>

        <ModelPicker
          options={modelOptions}
          emptyProviders={emptyProviders}
          value={defaultModel}
          onChange={chooseDefaultModel}
          disabled={defaultPending}
        />

        {inertBecause && (
          <p className="text-muted-foreground text-xs">{inertBecause}</p>
        )}

        {defaultError && (
          <p role="alert" className="text-destructive text-xs">
            {defaultError}
          </p>
        )}
      </div>
    </div>
  );
}

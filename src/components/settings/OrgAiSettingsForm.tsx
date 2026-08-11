"use client";

import { useState, useTransition } from "react";
import {
  setAiMode,
  setOrgByoKey,
  removeOrgByoKey,
} from "@/lib/ai/settings-actions";
import {
  ALL_PROVIDERS,
  PROVIDER_CATALOG,
  type AiProvider,
} from "@/lib/ai/providers/catalog";
import { type AiMode } from "@/lib/ai/org-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Initial = {
  mode: AiMode;
  tier: string;
  creditsLimit: number;
  creditsUsed: number;
  byoProvider: AiProvider | null;
  byoKeyLast4: string | null;
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

/**
 * Admin Settings → "AI — Organization" card. Picks how AI is powered for the
 * whole org (off / managed allowance / one shared org key / each member's own
 * key) and manages the shared org key. Mode changes are optimistic and revert
 * on failure; the org-key panel mirrors AiKeyList's interaction + copy.
 * Inline messages, so an error sits on the control that caused it.
 */
export function OrgAiSettingsForm({ initial }: { initial: Initial }) {
  // `mode` is optimistic; `confirmed` is the last server-acknowledged mode we
  // revert to when a change is rejected.
  const [mode, setMode] = useState<AiMode>(initial.mode);
  const [confirmed, setConfirmed] = useState<AiMode>(initial.mode);
  const [modeError, setModeError] = useState<string | null>(null);
  const [modePending, startMode] = useTransition();

  const [byoProvider, setByoProvider] = useState<AiProvider | null>(
    initial.byoProvider,
  );
  const [byoKeyLast4, setByoKeyLast4] = useState<string | null>(
    initial.byoKeyLast4,
  );
  const [provider, setProvider] = useState<AiProvider>(
    initial.byoProvider ?? "anthropic",
  );
  const [key, setKey] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keyPending, startKey] = useTransition();

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

      <div className="space-y-3 border-t pt-4">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Organization key</p>
          <p className="text-muted-foreground text-xs">
            One shared key powers AI for everyone when the org-key mode is on.
          </p>
        </div>

        {byoKeyLast4 ? (
          <div className="bg-muted/40 flex items-center justify-between rounded-md border px-3 py-2">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">
                {PROVIDER_CATALOG[byoProvider ?? "anthropic"].label}
              </p>
              <p className="text-muted-foreground text-xs">{byoKeyLast4}</p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={removeKey}
              disabled={keyPending}
            >
              Remove
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Provider</Label>
              <div className="flex flex-wrap gap-2">
                {ALL_PROVIDERS.map((p) => (
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
                placeholder={PROVIDER_CATALOG[provider].placeholder}
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
    </div>
  );
}

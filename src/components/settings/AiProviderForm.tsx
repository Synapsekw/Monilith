"use client";

import { useState, useTransition } from "react";
import { saveAiKey, removeAiKey } from "@/lib/ai/credentials-actions";
import {
  ALL_PROVIDERS,
  PROVIDER_CATALOG,
  type AiProvider,
} from "@/lib/ai/providers/catalog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Configured = { provider: AiProvider; hint: string; updatedAt: string };

/**
 * Personal Settings → AI card: pick a provider, paste + save an API key
 * (verified live server-side before storing), and manage the configured
 * state (Replace / Remove). Mirrors ProfileForm's inline-message pattern —
 * the app has no toast primitive. The raw key is never rendered back, only
 * the masked hint returned by the server action / passed in via `initial`.
 */
export function AiProviderForm({ initial }: { initial: Configured | null }) {
  const [configured, setConfigured] = useState<Configured | null>(initial);
  const [editing, setEditing] = useState(initial === null);
  const [provider, setProvider] = useState<AiProvider>(
    initial?.provider ?? "anthropic",
  );
  const [key, setKey] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    start(async () => {
      const res = await saveAiKey({ provider, key: key.trim() });
      if (res.ok) {
        setConfigured({
          provider: res.data.provider,
          hint: res.data.hint,
          updatedAt: new Date().toISOString(),
        });
        setKey("");
        setEditing(false);
      } else {
        setError(res.error);
      }
    });
  }

  function remove() {
    setError(null);
    start(async () => {
      const res = await removeAiKey();
      if (res.ok) {
        setConfigured(null);
        setEditing(true);
      } else {
        setError(res.error);
      }
    });
  }

  if (configured && !editing) {
    const updated = new Date(configured.updatedAt).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    return (
      <div className="space-y-3">
        <div className="bg-muted/40 flex items-center justify-between rounded-md border px-3 py-2">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">
              {PROVIDER_CATALOG[configured.provider].label}
            </p>
            <p className="text-muted-foreground text-xs">
              {configured.hint} · Updated {updated}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
            >
              Replace
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={remove}
              disabled={pending}
            >
              Remove
            </Button>
          </div>
        </div>
        {error && <p className="text-destructive text-xs">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!configured && (
        <p className="text-muted-foreground text-xs">
          Not configured — add a provider key below to enable AI features.
        </p>
      )}

      <div className="space-y-1.5">
        <Label>Provider</Label>
        <div className="flex flex-wrap gap-2">
          {ALL_PROVIDERS.map((p) => (
            <Button
              key={p.id}
              type="button"
              size="sm"
              variant={p.id === provider ? "default" : "outline"}
              onClick={() => {
                setProvider(p.id);
                setError(null);
              }}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="ai-key">API key</Label>
        <Input
          id="ai-key"
          type="password"
          value={key}
          autoComplete="off"
          placeholder={PROVIDER_CATALOG[provider].placeholder}
          disabled={pending}
          onChange={(e) => {
            setKey(e.target.value);
            setError(null);
          }}
        />
        <p className="text-muted-foreground text-xs">
          Stored encrypted. Used only to run AI features for your account.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button
          onClick={save}
          disabled={pending || key.trim().length < 10}
          size="sm"
        >
          {pending ? "Verifying…" : "Save"}
        </Button>
        {configured && (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              setEditing(false);
              setKey("");
              setError(null);
            }}
          >
            Cancel
          </Button>
        )}
        {error && <span className="text-destructive text-xs">{error}</span>}
      </div>
    </div>
  );
}

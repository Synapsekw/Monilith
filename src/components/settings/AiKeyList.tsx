"use client";

import { useId, useState, useTransition } from "react";
import { saveAiKey, removeAiKey } from "@/lib/ai/credentials-actions";
import type { ProviderRow } from "@/lib/ai/providers/provider-rows";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** One stored key, as the settings page reads it back — masked, never raw. */
export type ConfiguredKey = {
  provider: string;
  hint: string;
  updatedAt: string;
};

/**
 * Formats an `updated_at` stamp in UTC on purpose. This component server-renders
 * and then hydrates; `toLocaleDateString` with the ambient locale/zone resolves
 * differently in node than in the browser, and the mismatch is a hydration
 * error on a date nobody reads to the day. Pin both and it is stable.
 */
function formatUpdated(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Personal Settings → AI: one row per enabled provider, each key added,
 * replaced and removed on its own.
 *
 * Replaces `AiProviderForm`, which modelled a SINGLE key because
 * `ai_credential_set` used to delete every other provider's row. It rendered
 * `credentials[0]` and removed only that provider, so a user holding two keys
 * could neither see nor remove the second one.
 *
 * Every piece of provider metadata — label, key placeholder — comes from the
 * `ai_providers` row passed in. The old form read a hardcoded three-entry map,
 * which threw on a Mistral or Kimi credential and took the whole page with it;
 * the registry is open by design, so nothing here may assume a fixed set.
 *
 * Inline messages rather than toasts: an error belongs to the row that caused
 * it. Model availability is deliberately NOT shown here — see the settings
 * page for why.
 */
export function AiKeyList({
  providers,
  initial,
}: {
  providers: ProviderRow[];
  initial: ConfiguredKey[];
}) {
  const [configured, setConfigured] = useState<Record<string, ConfiguredKey>>(
    () => Object.fromEntries(initial.map((c) => [c.provider, c])),
  );
  // Which provider's key field is open. One at a time keeps the page calm and
  // makes a single draft field correct.
  const [editing, setEditing] = useState<string | null>(null);
  const [draftKey, setDraftKey] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  // `busy` names the provider a request is in flight for, so one slow save
  // disables its own row's buttons instead of freezing all five.
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const idPrefix = useId();

  function open(provider: string) {
    setEditing(provider);
    setDraftKey("");
    setErrors((e) => ({ ...e, [provider]: "" }));
  }

  function close() {
    setEditing(null);
    setDraftKey("");
  }

  function save(provider: string) {
    const key = draftKey.trim();
    setErrors((e) => ({ ...e, [provider]: "" }));
    setBusy(provider);
    start(async () => {
      const res = await saveAiKey({ provider, key });
      if (res.ok) {
        setConfigured((c) => ({
          ...c,
          [provider]: {
            provider,
            hint: res.data.hint,
            updatedAt: new Date().toISOString(),
          },
        }));
        close();
      } else {
        setErrors((e) => ({ ...e, [provider]: res.error }));
      }
      setBusy(null);
    });
  }

  function remove(provider: string) {
    setErrors((e) => ({ ...e, [provider]: "" }));
    setBusy(provider);
    start(async () => {
      const res = await removeAiKey({ provider });
      if (res.ok) {
        setConfigured((c) => {
          const next = { ...c };
          delete next[provider];
          return next;
        });
        if (editing === provider) close();
      } else {
        setErrors((e) => ({ ...e, [provider]: res.error }));
      }
      setBusy(null);
    });
  }

  if (providers.length === 0) {
    return (
      <p className="text-muted-foreground py-4 text-sm">
        No AI providers are enabled for this deployment yet.
      </p>
    );
  }

  return (
    <ul className="space-y-2 py-4">
      {providers.map((p) => {
        const cfg = configured[p.id];
        const isEditing = editing === p.id;
        const isBusy = pending && busy === p.id;
        const labelId = `${idPrefix}-${p.id}-label`;
        const fieldId = `${idPrefix}-${p.id}-key`;
        const error = errors[p.id];

        return (
          <li
            key={p.id}
            className="border-border hover:border-border-hover rounded-lg border transition-colors"
          >
            <div className="flex items-center justify-between gap-4 px-3 py-2.5">
              <div className="min-w-0">
                <p
                  id={labelId}
                  className="text-foreground truncate text-sm font-medium"
                >
                  {p.label}
                </p>
                {cfg ? (
                  <p className="text-muted-foreground mt-0.5 truncate text-xs">
                    <span className="font-mono">{cfg.hint}</span>
                    {" · Updated "}
                    {formatUpdated(cfg.updatedAt)}
                  </p>
                ) : (
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    Not connected
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {cfg ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-describedby={labelId}
                      aria-expanded={isEditing}
                      disabled={isBusy}
                      onClick={() => (isEditing ? close() : open(p.id))}
                    >
                      Replace
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:bg-destructive/10"
                      aria-describedby={labelId}
                      disabled={isBusy}
                      onClick={() => remove(p.id)}
                    >
                      Remove
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-describedby={labelId}
                    aria-expanded={isEditing}
                    disabled={isBusy}
                    onClick={() => (isEditing ? close() : open(p.id))}
                  >
                    Add key
                  </Button>
                )}
              </div>
            </div>

            {isEditing && (
              <div className="border-border space-y-1.5 border-t px-3 py-3">
                <Label htmlFor={fieldId}>API key</Label>
                <Input
                  id={fieldId}
                  type="password"
                  value={draftKey}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={p.keyPlaceholder}
                  aria-invalid={error ? true : undefined}
                  disabled={isBusy}
                  onChange={(e) => {
                    setDraftKey(e.target.value);
                    setErrors((prev) => ({ ...prev, [p.id]: "" }));
                  }}
                />
                <p className="text-muted-foreground text-xs">
                  Stored encrypted. Checked against {p.label} before it is
                  saved, and used only to run AI features for your account.
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <Button
                    type="button"
                    size="sm"
                    disabled={isBusy || draftKey.trim().length < 10}
                    onClick={() => save(p.id)}
                  >
                    {isBusy ? "Verifying…" : "Save"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={isBusy}
                    onClick={close}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {error && (
              <p role="alert" className="text-destructive px-3 pb-2.5 text-xs">
                {error}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

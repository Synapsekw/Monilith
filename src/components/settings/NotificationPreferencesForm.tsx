"use client";

import { useState, useTransition } from "react";
import { setNotificationPreference } from "@/lib/settings/notification-prefs-actions";
import {
  CONTROLLABLE_IN_APP_KINDS,
  IN_APP_KIND_LABELS,
  type AppNotificationPrefKind,
} from "@/lib/settings/notification-prefs";

/**
 * Per-type in-app notification toggles. Opt-out: a kind in `disabledKinds` is
 * OFF. Each checkbox is optimistic and reverts on failure (mirrors
 * DigestPreferenceForm). "Enabled" = checkbox checked = no disabled row.
 */
export function NotificationPreferencesForm({
  disabledKinds,
}: {
  disabledKinds: readonly AppNotificationPrefKind[];
}) {
  const [disabled, setDisabled] = useState<Set<AppNotificationPrefKind>>(
    () => new Set(disabledKinds),
  );
  const [pending, startTransition] = useTransition();

  function toggle(kind: AppNotificationPrefKind, nextEnabled: boolean) {
    setDisabled((prev) => {
      const next = new Set(prev);
      if (nextEnabled) next.delete(kind);
      else next.add(kind);
      return next;
    });
    startTransition(async () => {
      const res = await setNotificationPreference({
        kind,
        enabled: nextEnabled,
      });
      if (!res.ok) {
        // revert
        setDisabled((prev) => {
          const next = new Set(prev);
          if (nextEnabled) next.add(kind);
          else next.delete(kind);
          return next;
        });
      }
    });
  }

  return (
    <fieldset className="space-y-3">
      <legend className="text-muted-foreground mb-1 text-xs font-medium">
        In-app
      </legend>
      {CONTROLLABLE_IN_APP_KINDS.map((kind) => {
        const enabled = !disabled.has(kind);
        const copy = IN_APP_KIND_LABELS[kind];
        return (
          <label
            key={kind}
            className="flex items-start gap-2 text-sm"
            title={copy.description}
          >
            <input
              type="checkbox"
              aria-label={copy.label}
              className="accent-primary mt-0.5 size-4"
              checked={enabled}
              disabled={pending}
              onChange={(e) => toggle(kind, e.target.checked)}
            />
            <span>
              <span className="block">{copy.label}</span>
              <span className="text-muted-foreground block text-xs">
                {copy.description}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

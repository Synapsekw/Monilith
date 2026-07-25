"use client";

import { useState, useTransition } from "react";
import { setNotificationPreference } from "@/lib/settings/notification-prefs-actions";
import {
  CONTROLLABLE_IN_APP_KINDS,
  IN_APP_KIND_LABELS,
  type AppNotificationPrefKind,
} from "@/lib/settings/notification-prefs";
import { SettingRow } from "@/components/settings/setting-row";
import { Switch } from "@/components/ui/switch";

/**
 * Per-type in-app notification toggles. Opt-out: a kind in `disabledKinds` is
 * OFF. Each switch is optimistic and reverts on failure (mirrors
 * DigestPreferenceForm). "Enabled" = switch on = no disabled row.
 *
 * Emits one SettingRow per kind so the toggles align with every other control
 * in the section rather than forming a separate checkbox list.
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
    <>
      {CONTROLLABLE_IN_APP_KINDS.map((kind) => {
        const enabled = !disabled.has(kind);
        const copy = IN_APP_KIND_LABELS[kind];
        return (
          <SettingRow
            key={kind}
            label={copy.label}
            description={copy.description}
          >
            <div className="md:flex md:justify-end">
              <Switch
                aria-label={copy.label}
                checked={enabled}
                disabled={pending}
                onCheckedChange={(next) => toggle(kind, next)}
              />
            </div>
          </SettingRow>
        );
      })}
    </>
  );
}

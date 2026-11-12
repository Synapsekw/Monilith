"use client";

import { useState, useTransition } from "react";
import { updateProfileCelebrateDone } from "@/lib/profile/actions";
import { Switch } from "@/components/ui/switch";
import { applyCelebrateDone } from "@/components/ui/done-burst";

const ERROR_ID = "celebrate-done-error";

/**
 * Whether marking an item done plays the short celebration. Same shape as the
 * other settings switches (`BriefingPreferenceForm`): the visible label lives
 * on the enclosing SettingRow, so this renders the control alone and carries
 * the label as `aria-label`.
 *
 * Optimistic: the switch flips on the click and the Server Action makes it
 * durable. A failure flips it back and says why — unlike a theme change, there
 * is nothing else on screen that would reveal a silently reverted switch.
 *
 * The switch is `aria-busy` rather than `disabled` while saving: disabling the
 * focused control drops keyboard focus on the floor. A second toggle during a
 * save is ignored instead.
 */
export function CelebrateDoneForm({
  initialCelebrateDone,
}: {
  initialCelebrateDone: boolean;
}) {
  const [celebrateDone, setCelebrateDone] = useState(initialCelebrateDone);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <div className="md:flex md:justify-end">
        <Switch
          aria-label="Celebrate completed items"
          aria-busy={pending}
          aria-describedby={error ? ERROR_ID : undefined}
          checked={celebrateDone}
          onCheckedChange={(next) => {
            if (pending) return;
            setError(null);
            setCelebrateDone(next);
            // Takes effect in this tab now — the shell only re-reads the
            // account's value on the next navigation that re-renders it.
            applyCelebrateDone(next);
            startTransition(async () => {
              const res = await updateProfileCelebrateDone({
                celebrateDone: next,
              });
              if (res.ok) return;
              setCelebrateDone(!next);
              applyCelebrateDone(!next);
              setError(res.error);
            });
          }}
        />
      </div>
      {error ? (
        <p
          id={ERROR_ID}
          role="alert"
          className="text-destructive text-xs md:text-right"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

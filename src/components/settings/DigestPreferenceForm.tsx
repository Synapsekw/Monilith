"use client";

import { useState, useTransition } from "react";
import { setEmailDigestOptOut } from "@/lib/settings/digest-actions";
import { Switch } from "@/components/ui/switch";

/**
 * Weekly-digest email preference. Stored inverted (email_digest_opt_out) so
 * existing users stay subscribed without a backfill; the switch shows the
 * positive framing. In-app digest notifications are unaffected.
 *
 * The visible label lives on the enclosing SettingRow, so this renders the
 * control alone and carries the label as aria-label.
 */
export function DigestPreferenceForm({
  initialOptOut,
}: {
  initialOptOut: boolean;
}) {
  const [optOut, setOptOut] = useState(initialOptOut);
  const [pending, startTransition] = useTransition();

  return (
    <div className="md:flex md:justify-end">
      <Switch
        aria-label="Email me the weekly plan health digest"
        checked={!optOut}
        disabled={pending}
        onCheckedChange={(checked) => {
          const next = !checked;
          setOptOut(next);
          startTransition(async () => {
            const res = await setEmailDigestOptOut({ optOut: next });
            if (!res.ok) setOptOut(!next); // revert on failure
          });
        }}
      />
    </div>
  );
}

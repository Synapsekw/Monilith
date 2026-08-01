"use client";

import { useState, useTransition } from "react";
import { setEmailBriefingOptOut } from "@/lib/settings/digest-actions";
import { Switch } from "@/components/ui/switch";

/**
 * Daily agent-briefing email preference. Mirrors DigestPreferenceForm exactly
 * (stored inverted — `email_briefing_opt_out` — so existing agents keep
 * emailing by default; the switch shows the positive framing). This is the
 * recovery control the unsubscribe email's "You can turn it back on any time
 * in Settings" line promises.
 *
 * The visible label lives on the enclosing SettingRow, so this renders the
 * control alone and carries the label as aria-label.
 */
export function BriefingPreferenceForm({
  initialOptOut,
}: {
  initialOptOut: boolean;
}) {
  const [optOut, setOptOut] = useState(initialOptOut);
  const [pending, startTransition] = useTransition();

  return (
    <div className="md:flex md:justify-end">
      <Switch
        aria-label="Email me my daily agent briefing"
        checked={!optOut}
        disabled={pending}
        onCheckedChange={(checked) => {
          const next = !checked;
          setOptOut(next);
          startTransition(async () => {
            const res = await setEmailBriefingOptOut({ optOut: next });
            if (!res.ok) setOptOut(!next); // revert on failure
          });
        }}
      />
    </div>
  );
}

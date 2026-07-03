"use client";

import { useState, useTransition } from "react";
import { setEmailDigestOptOut } from "@/lib/settings/digest-actions";

/**
 * Weekly-digest email preference. Stored inverted (email_digest_opt_out) so
 * existing users stay subscribed without a backfill; the checkbox shows the
 * positive framing. In-app digest notifications are unaffected.
 */
export function DigestPreferenceForm({
  initialOptOut,
}: {
  initialOptOut: boolean;
}) {
  const [optOut, setOptOut] = useState(initialOptOut);
  const [pending, startTransition] = useTransition();

  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="accent-primary size-4"
        checked={!optOut}
        disabled={pending}
        onChange={(e) => {
          const next = !e.target.checked;
          setOptOut(next);
          startTransition(async () => {
            const res = await setEmailDigestOptOut({ optOut: next });
            if (!res.ok) setOptOut(!next); // revert on failure
          });
        }}
      />
      Email me the weekly plan health digest
    </label>
  );
}

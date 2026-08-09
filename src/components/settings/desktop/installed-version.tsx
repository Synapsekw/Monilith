"use client";

import { useSyncExternalStore } from "react";
import { ArrowUpCircle, CheckCircle2 } from "lucide-react";
import { getInstalledShellVersion } from "@/lib/desktop/bridge";
import { compareShellVersions } from "@/lib/desktop/release-contract";

/**
 * Answers "do I need to update?" in the page, for someone reading it inside the
 * desktop app.
 *
 * Before this, the page showed one version — the latest — with nothing to
 * compare it against, so a user had to open Monolith → About, remember a
 * number, and come back. The shell knows what it is; it just had no way to say
 * so until `version` was added to the preload bridge.
 *
 * Renders NOTHING in a browser, and nothing on a shell too old to report a
 * version. Both are the honest answer: this component can only speak when it
 * actually knows, and a wrong "you're up to date" is worse than silence.
 */
/** The bridge is injected once at window creation and never changes, so there
 *  is nothing to subscribe to. Defined at module scope to stay referentially
 *  stable — a new function each render would resubscribe on every render. */
const subscribe = () => () => {};

export function InstalledVersion({ latest }: { latest: string }) {
  // `window` does not exist during SSR, so a render-time read would make the
  // server and client HTML disagree. useSyncExternalStore is the sanctioned
  // way to read a browser-only value: it takes a separate server snapshot
  // (null) and reconciles on hydration. The obvious alternative —
  // useState + useEffect — is a cascading render and is lint-blocked.
  // Both snapshots return a string or null, which is stable by value, so this
  // cannot loop.
  const installed = useSyncExternalStore(
    subscribe,
    getInstalledShellVersion,
    () => null,
  );

  if (!installed) return null;

  const behind = compareShellVersions(installed, latest) < 0;
  const Icon = behind ? ArrowUpCircle : CheckCircle2;

  return (
    <p className="text-muted-foreground mt-2 flex items-center gap-1.5 text-xs">
      {/* Icon AND text carry the state — never colour alone (WCAG AA). */}
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {behind ? (
        <span>
          You’re running{" "}
          <span className="text-foreground font-medium">{installed}</span> —
          update available.
        </span>
      ) : (
        <span>
          You’re running{" "}
          <span className="text-foreground font-medium">{installed}</span> — up
          to date.
        </span>
      )}
    </p>
  );
}

"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * A read-only value the user needs to paste somewhere else — the MCP server
 * URL. Selectable text plus an explicit copy button.
 *
 * The failure branch is deliberate: clipboard writes can be blocked (insecure
 * origin, permissions policy), and a button that silently does nothing is worse
 * than no button. On failure we tell the user to copy manually rather than
 * flashing "Copied" at them.
 */
export function CopyField({ label, value }: { label: string; value: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <code className="border-border bg-surface-muted text-foreground min-w-0 flex-1 truncate rounded-sm border px-3 py-2 font-mono text-xs">
          {value}
        </code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={copy}
          aria-label={`Copy ${label.toLowerCase()}`}
        >
          {state === "copied" ? (
            <Check className="size-3.5" />
          ) : (
            <Copy className="size-3.5" />
          )}
          {state === "copied" ? "Copied" : "Copy"}
        </Button>
      </div>
      {state === "failed" ? (
        <p className="text-muted-foreground text-xs">
          Couldn&apos;t reach the clipboard — select the value and use your
          browser&apos;s copy shortcut to copy it.
        </p>
      ) : null}
    </div>
  );
}

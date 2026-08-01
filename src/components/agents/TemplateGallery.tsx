"use client";

import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kicker } from "@/components/ui/kicker";
import { AGENT_TEMPLATES, type AgentTemplate } from "@/lib/agents/agent-config";

/**
 * Template gallery — the entry point for creating a new agent. Picking a card
 * hands the template to the caller (which opens the editor prefilled); this
 * component itself makes no server calls. Cards use the shared `.card-lift`
 * hover treatment (Keystone: surface steps + hairline brighten, no shadow).
 */
export function TemplateGallery({
  onSelect,
  onBack,
}: {
  onSelect: (template: AgentTemplate) => void;
  /** Omit when there's no roster to return to (e.g. shown inline under the
   *  empty state) — the back control is hidden rather than a no-op. */
  onBack?: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {onBack ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="w-fit"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Back to your agents
        </Button>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {AGENT_TEMPLATES.map((template) => (
          <button
            key={template.id}
            type="button"
            onClick={() => onSelect(template)}
            className="bg-surface hover:border-border-hover card-lift ease-keystone focus-visible:ring-ring flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <Kicker>
              Daily · {String(template.runAtLocalHour).padStart(2, "0")}:00
            </Kicker>
            <p className="text-sm font-semibold">{template.name}</p>
            <p className="text-muted-foreground text-xs">{template.blurb}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

"use client";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ReportConfig, ReportBlock } from "@/lib/reports/config";
import { Button } from "@/components/ui/button";

export function toggleBlock(config: ReportConfig, index: number): ReportConfig {
  const blocks = config.blocks.map((b, i) =>
    i === index ? { ...b, enabled: !b.enabled } : b,
  );
  return { ...config, blocks };
}

export function moveBlock(
  config: ReportConfig,
  from: number,
  to: number,
): ReportConfig {
  if (to < 0 || to >= config.blocks.length) return config;
  const blocks = [...config.blocks];
  const [moved] = blocks.splice(from, 1);
  blocks.splice(to, 0, moved);
  return { ...config, blocks };
}

const LABELS: Record<ReportBlock["type"], string> = {
  cover: "Cover",
  summary: "Executive summary",
  kpis: "Key metrics",
  chart: "Chart",
  table: "Board table",
  group_summaries: "Group summaries",
  spotlight: "Item spotlight",
  notes: "Notes",
  appendix: "Appendix",
};

export function SectionRail({
  config,
  onChange,
}: {
  config: ReportConfig;
  onChange: (next: ReportConfig) => void;
}) {
  return (
    <ul className="flex flex-col">
      {config.blocks.map((b, i) => (
        <li
          key={i}
          className="group hover:bg-accent flex items-center gap-2.5 rounded-md px-1.5 py-1.5 transition-colors"
        >
          <input
            id={`section-toggle-${i}`}
            type="checkbox"
            checked={b.enabled}
            onChange={() => onChange(toggleBlock(config, i))}
            aria-label={`Toggle ${LABELS[b.type]}`}
            className="accent-primary size-3.5 shrink-0"
          />
          <label
            htmlFor={`section-toggle-${i}`}
            className="min-w-0 flex-1 cursor-pointer truncate text-sm"
          >
            {LABELS[b.type]}
          </label>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
            disabled={i === 0}
            onClick={() => onChange(moveBlock(config, i, i - 1))}
            aria-label={`Move ${LABELS[b.type]} up`}
          >
            <ChevronUp className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
            disabled={i === config.blocks.length - 1}
            onClick={() => onChange(moveBlock(config, i, i + 1))}
            aria-label={`Move ${LABELS[b.type]} down`}
          >
            <ChevronDown className="size-3.5" />
          </Button>
        </li>
      ))}
    </ul>
  );
}

"use client";
import type { ReportConfig, ReportBlock } from "@/lib/reports/config";

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
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {config.blocks.map((b, i) => (
        <li
          key={i}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 0",
          }}
        >
          <input
            type="checkbox"
            checked={b.enabled}
            onChange={() => onChange(toggleBlock(config, i))}
            aria-label={`Toggle ${LABELS[b.type]}`}
          />
          <span style={{ flex: 1 }}>{LABELS[b.type]}</span>
          <button
            type="button"
            onClick={() => onChange(moveBlock(config, i, i - 1))}
            aria-label={`Move ${LABELS[b.type]} up`}
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onChange(moveBlock(config, i, i + 1))}
            aria-label={`Move ${LABELS[b.type]} down`}
          >
            ↓
          </button>
        </li>
      ))}
    </ul>
  );
}

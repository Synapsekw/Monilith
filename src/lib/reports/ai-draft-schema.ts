import { z } from "zod";

export const REPORT_NARRATIVE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "highlights", "risks"],
  properties: {
    summary: { type: "string" },
    highlights: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
  },
} as const;

export const reportNarrativeSchema = z.object({
  summary: z.string().max(8000),
  highlights: z.array(z.string().max(500)).max(20),
  risks: z.array(z.string().max(500)).max(20),
});
export type ReportNarrative = z.infer<typeof reportNarrativeSchema>;

export function validateNarrative(raw: unknown): ReportNarrative {
  return reportNarrativeSchema.parse(raw);
}

import { z } from "zod";

export const DIGEST_NARRATIVE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["narrative"],
  properties: {
    narrative: { type: "string" },
  },
} as const;

export const digestNarrativeSchema = z.object({
  narrative: z.string().max(400),
});

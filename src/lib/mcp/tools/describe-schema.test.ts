import { describe, expect, it } from "vitest";
import { columnKindSchema } from "@/lib/validations/boards";
import { widgetKindSchema } from "@/lib/validations/dashboards";
import { viewKindSchema } from "@/lib/validations/view-actions";
import { REPORT_SCOPES } from "@/lib/reports/queries";
import {
  describeSchemaDescriptor,
  SCHEMA_TOPICS,
  COLUMN_KIND_SCHEMA,
  VIEW_TYPE_SCHEMA,
  WIDGET_KIND_SCHEMA,
  REPORT_SHAPE_SCHEMA,
} from "./describe-schema";

const invoke = (input: Record<string, unknown>) =>
  describeSchemaDescriptor.invoke(
    {
      getClient: async () => {
        throw new Error("must not touch the DB");
      },
      actorId: "u1",
    },
    input,
  );

describe("describe_schema", () => {
  // The whole reason it can be capability-free: it costs nothing.
  it("reads no database", async () => {
    await expect(invoke({ topic: "column_kinds" })).resolves.toBeDefined();
  });

  it("is a capability-free, board-less read", () => {
    expect(describeSchemaDescriptor.capability).toBeNull();
    expect(describeSchemaDescriptor.scope).toBe("none");
  });

  // Enumerated from the Zod declarations themselves, never a hand-copied
  // list — that is the whole anti-drift property. A kind added later without a
  // description fails the build instead of shipping a vocabulary gap the model
  // silently works around.
  it("describes every column kind", () => {
    for (const kind of columnKindSchema.options) {
      expect(COLUMN_KIND_SCHEMA[kind], kind).toBeDefined();
      expect(COLUMN_KIND_SCHEMA[kind]!.settings, kind).toBeTruthy();
    }
  });

  it("describes every widget kind", () => {
    for (const kind of widgetKindSchema.options) {
      expect(WIDGET_KIND_SCHEMA[kind], kind).toBeDefined();
      expect(WIDGET_KIND_SCHEMA[kind]!.settings, kind).toBeTruthy();
    }
  });

  it("describes every view type", () => {
    for (const kind of viewKindSchema.options) {
      expect(VIEW_TYPE_SCHEMA[kind], kind).toBeDefined();
      expect(VIEW_TYPE_SCHEMA[kind]!.settings, kind).toBeTruthy();
    }
  });

  // Enumerated from `REPORT_SCOPES` — the same array `toScope`'s runtime
  // narrowing in `src/lib/reports/queries.ts` checks against — never a
  // hand-copied literal. `ReportScope` itself is a TS union with no `.options`
  // to enumerate, so `REPORT_SCOPES` is the single source of truth.
  it("describes every report scope", () => {
    for (const scope of REPORT_SCOPES) {
      expect(REPORT_SHAPE_SCHEMA[scope], scope).toBeDefined();
    }
  });

  it("returns every topic when asked for all", async () => {
    const r = await invoke({});
    const payload = JSON.parse(r.content[0]!.text);
    for (const topic of SCHEMA_TOPICS) {
      if (topic === "all") continue;
      expect(payload[topic], topic).toBeDefined();
    }
  });

  it("returns only the requested topic", async () => {
    const r = await invoke({ topic: "column_kinds" });
    const payload = JSON.parse(r.content[0]!.text);
    expect(Object.keys(payload)).toEqual(["column_kinds"]);
  });
});

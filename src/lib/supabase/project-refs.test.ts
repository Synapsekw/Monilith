import { describe, expect, it } from "vitest";
import {
  SUPABASE_PROJECT_REFS,
  labelSupabaseTarget,
} from "@/lib/supabase/project-refs";

describe("labelSupabaseTarget", () => {
  it("labels the DEV project ref", () => {
    expect(
      labelSupabaseTarget(`https://${SUPABASE_PROJECT_REFS.dev}.supabase.co`),
    ).toBe("dev");
  });

  it("labels the PROD project ref", () => {
    expect(
      labelSupabaseTarget(`https://${SUPABASE_PROJECT_REFS.prod}.supabase.co`),
    ).toBe("prod");
  });

  it("labels anything else unknown", () => {
    expect(labelSupabaseTarget("https://pulse-test.supabase.co")).toBe(
      "unknown",
    );
    expect(labelSupabaseTarget("http://localhost:54321")).toBe("unknown");
  });

  it("labels undefined unknown", () => {
    expect(labelSupabaseTarget(undefined)).toBe("unknown");
  });
});

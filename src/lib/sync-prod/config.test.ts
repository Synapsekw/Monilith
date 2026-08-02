import { describe, it, expect } from "vitest";
import { loadStorageEndpoints } from "./config";

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: "https://hjqcahbbbdaknbbnfnvl.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "dev-service-key",
  PROD_SUPABASE_URL: "https://jzsyqhxynswolgijkktn.supabase.co",
  PROD_SUPABASE_SERVICE_ROLE_KEY: "prod-service-key",
};

describe("loadStorageEndpoints", () => {
  it("maps valid env into dev/prod endpoints", () => {
    expect(loadStorageEndpoints(valid)).toEqual({
      dev: {
        url: valid.NEXT_PUBLIC_SUPABASE_URL,
        serviceKey: "dev-service-key",
      },
      prod: { url: valid.PROD_SUPABASE_URL, serviceKey: "prod-service-key" },
    });
  });

  it("throws naming the missing prod var", () => {
    const { PROD_SUPABASE_SERVICE_ROLE_KEY: _omitted, ...rest } = valid;
    expect(() => loadStorageEndpoints(rest)).toThrow(
      /PROD_SUPABASE_SERVICE_ROLE_KEY/,
    );
  });

  it("refuses when dev and prod URLs are identical", () => {
    expect(() =>
      loadStorageEndpoints({
        ...valid,
        PROD_SUPABASE_URL: valid.NEXT_PUBLIC_SUPABASE_URL,
      }),
    ).toThrow(/onto itself/);
  });
});

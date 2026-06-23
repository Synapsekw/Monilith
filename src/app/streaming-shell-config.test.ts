import { describe, expect, it } from "vitest";
import config from "../../next.config";

describe("next.config", () => {
  it("has Cache Components enabled so the shell prerenders + data streams", () => {
    expect(config.cacheComponents).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { signBody, verifyBody } from "./hmac";

const SECRET = "test-secret";
describe("agentic hmac", () => {
  it("round-trips a signed body", () => {
    const body = JSON.stringify({ job_id: "j1" });
    expect(verifyBody(body, signBody(body, SECRET), SECRET)).toBe(true);
  });
  it("rejects a tampered body", () => {
    const sig = signBody(JSON.stringify({ job_id: "j1" }), SECRET);
    expect(verifyBody(JSON.stringify({ job_id: "j2" }), sig, SECRET)).toBe(
      false,
    );
  });
  it("rejects a wrong secret", () => {
    const body = JSON.stringify({ job_id: "j1" });
    expect(verifyBody(body, signBody(body, SECRET), "other")).toBe(false);
  });
});

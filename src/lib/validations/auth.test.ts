import { describe, expect, it } from "vitest";
import { signInSchema, signUpSchema } from "./auth";

describe("signInSchema", () => {
  it("accepts a valid email and password", () => {
    const result = signInSchema.safeParse({
      email: "user@example.com",
      password: "secret",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid email", () => {
    const result = signInSchema.safeParse({
      email: "not-an-email",
      password: "secret",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty password", () => {
    const result = signInSchema.safeParse({
      email: "user@example.com",
      password: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing email", () => {
    const result = signInSchema.safeParse({ password: "secret" });
    expect(result.success).toBe(false);
  });
});

describe("signUpSchema", () => {
  it("accepts a valid email, 8+ char password, and org name", () => {
    const result = signUpSchema.safeParse({
      email: "user@example.com",
      password: "password123",
      orgName: "Acme Inc.",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.orgName).toBe("Acme Inc.");
    }
  });

  it("rejects an invalid email", () => {
    const result = signUpSchema.safeParse({
      email: "nope",
      password: "password123",
      orgName: "Acme",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a password shorter than 8 characters", () => {
    const result = signUpSchema.safeParse({
      email: "user@example.com",
      password: "short",
      orgName: "Acme",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/8/);
    }
  });

  it("rejects a missing org name", () => {
    const result = signUpSchema.safeParse({
      email: "user@example.com",
      password: "password123",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a blank/whitespace org name", () => {
    const result = signUpSchema.safeParse({
      email: "user@example.com",
      password: "password123",
      orgName: "   ",
    });
    expect(result.success).toBe(false);
  });

  it("trims the org name", () => {
    const result = signUpSchema.safeParse({
      email: "user@example.com",
      password: "password123",
      orgName: "  Acme  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.orgName).toBe("Acme");
    }
  });
});

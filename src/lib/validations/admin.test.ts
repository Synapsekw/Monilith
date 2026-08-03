import { describe, expect, it } from "vitest";
import {
  setMemberRoleSchema,
  memberTargetSchema,
  inviteMemberSchema,
  revokeInviteSchema,
  platformUserTargetSchema,
  setOrgAiPlanSchema,
} from "./admin";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("admin validations", () => {
  it("setMemberRoleSchema accepts a valid role change", () => {
    expect(
      setMemberRoleSchema.safeParse({
        orgId: uuid,
        userId: uuid,
        role: "admin",
      }).success,
    ).toBe(true);
  });
  it("setMemberRoleSchema rejects an unknown role", () => {
    expect(
      setMemberRoleSchema.safeParse({
        orgId: uuid,
        userId: uuid,
        role: "superuser",
      }).success,
    ).toBe(false);
  });
  it("memberTargetSchema requires uuids", () => {
    expect(
      memberTargetSchema.safeParse({ orgId: "nope", userId: uuid }).success,
    ).toBe(false);
  });
  it("inviteMemberSchema rejects inviting an owner", () => {
    expect(
      inviteMemberSchema.safeParse({
        orgId: uuid,
        email: "a@b.com",
        role: "owner",
      }).success,
    ).toBe(false);
  });
  it("inviteMemberSchema defaults role to member", () => {
    const r = inviteMemberSchema.parse({ orgId: uuid, email: "a@b.com" });
    expect(r.role).toBe("member");
  });
  it("inviteMemberSchema rejects a bad email", () => {
    expect(
      inviteMemberSchema.safeParse({
        orgId: uuid,
        email: "nope",
        role: "member",
      }).success,
    ).toBe(false);
  });
  it("revokeInviteSchema + platformUserTargetSchema require uuids", () => {
    expect(revokeInviteSchema.safeParse({ inviteId: uuid }).success).toBe(true);
    expect(platformUserTargetSchema.safeParse({ userId: uuid }).success).toBe(
      true,
    );
  });
});

describe("setOrgAiPlanSchema tier vocabulary", () => {
  it("accepts every billing tier", () => {
    for (const tier of ["none", "core", "pulse", "trial", "enterprise"]) {
      const r = setOrgAiPlanSchema.safeParse({
        orgId: uuid,
        tier,
        monthlyCreditLimit: 500,
      });
      expect(r.success, `${tier} should parse`).toBe(true);
    }
  });

  it("rejects the retired pre-billing tiers", () => {
    for (const tier of ["starter", "pro"]) {
      const r = setOrgAiPlanSchema.safeParse({
        orgId: uuid,
        tier,
        monthlyCreditLimit: 500,
      });
      expect(r.success, `${tier} should be rejected`).toBe(false);
    }
  });
});

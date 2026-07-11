import { z } from "zod";

export const orgRoleSchema = z.enum(["owner", "admin", "member", "guest"]);

export const setMemberRoleSchema = z.object({
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
  role: orgRoleSchema,
});
export type SetMemberRoleInput = z.infer<typeof setMemberRoleSchema>;

export const memberTargetSchema = z.object({
  orgId: z.string().uuid(),
  userId: z.string().uuid(),
});
export type MemberTargetInput = z.infer<typeof memberTargetSchema>;

// Invites never grant owner; owner is granted only by promotion of an existing member.
export const inviteMemberSchema = z.object({
  orgId: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(["admin", "member", "guest"]).default("member"),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const revokeInviteSchema = z.object({ inviteId: z.string().uuid() });
export type RevokeInviteInput = z.infer<typeof revokeInviteSchema>;

// Platform: assign/revoke any role anywhere — same shape as org role change.
export const platformSetOrgRoleSchema = setMemberRoleSchema;
export type PlatformSetOrgRoleInput = SetMemberRoleInput;

export const platformUserTargetSchema = z.object({ userId: z.string().uuid() });
export type PlatformUserTargetInput = z.infer<typeof platformUserTargetSchema>;

// Platform: grant an org's AI allowance (tier + monthly credit ceiling). This is
// the operator-controlled entitlement only — `ai_mode` stays with the org admin.
export const setOrgAiPlanSchema = z.object({
  orgId: z.string().uuid(),
  tier: z.enum(["none", "starter", "pro", "enterprise"]),
  monthlyCreditLimit: z.number().int().min(0).max(1_000_000),
});
export type SetOrgAiPlanInput = z.infer<typeof setOrgAiPlanSchema>;

// Platform: set a temporary password for a user (admin-typed). Min 8 chars.
export const platformSetPasswordSchema = z.object({
  userId: z.string().uuid(),
  password: z.string().min(8, "Password must be at least 8 characters."),
});
export type PlatformSetPasswordInput = z.infer<
  typeof platformSetPasswordSchema
>;

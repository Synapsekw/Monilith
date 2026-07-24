import { z } from "zod";
import { isHttpUrl } from "@/lib/validations/boards";

export const registerClientSchema = z.object({
  client_name: z.string().trim().min(1).max(200),
  redirect_uris: z
    .array(z.string().url().refine(isHttpUrl, "URL must be http or https"))
    .min(1)
    .max(10),
});
export type RegisterClientInput = z.infer<typeof registerClientSchema>;

export const authorizeRequestSchema = z.object({
  client_id: z.string().min(1),
  redirect_uri: z.string().url().refine(isHttpUrl, "URL must be http or https"),
  response_type: z.literal("code"),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal("S256"),
  state: z.string().optional(),
});
export type AuthorizeRequestInput = z.infer<typeof authorizeRequestSchema>;

const authorizationCodeGrant = z.object({
  grant_type: z.literal("authorization_code"),
  code: z.string().min(1),
  client_id: z.string().min(1),
  code_verifier: z.string().min(43).max(128),
  redirect_uri: z.string().url().refine(isHttpUrl, "URL must be http or https"),
});
const refreshTokenGrant = z.object({
  grant_type: z.literal("refresh_token"),
  refresh_token: z.string().min(1),
  client_id: z.string().min(1),
});
export const tokenExchangeSchema = z.discriminatedUnion("grant_type", [
  authorizationCodeGrant,
  refreshTokenGrant,
]);
export type TokenExchangeInput = z.infer<typeof tokenExchangeSchema>;

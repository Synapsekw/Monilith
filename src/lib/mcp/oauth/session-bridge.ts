import "server-only";
import { randomUUID } from "node:crypto";
import {
  createClient,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { getServerEnv } from "@/lib/env.server";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { typedRpc } from "@/lib/supabase/typed-rpc";
import type { Database } from "@/types/database.types";
import {
  BridgeRevokedError,
  BridgeSessionDeadError,
  BridgeUnavailableError,
  describeAuthError,
  isDeadSessionError,
} from "./bridge-errors";
import { claimBridgeHeal, readBridgeSecretId } from "./token-store";

function anonClient(): SupabaseClient<Database> {
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/**
 * What's actually stored in the Vault secret behind bridge_secret_id: not
 * just the refresh token, but the *current* access token + its expiry, so
 * getBridgedClient() can serve most requests as a pure Vault read (no GoTrue
 * call, no secret rotation). Only refreshed once the cached access token is
 * actually near expiry — see getBridgedClient() below.
 */
const bridgeSecretPayloadSchema = z.object({
  refreshToken: z.string(),
  accessToken: z.string().min(1),
  /** Epoch ms. */
  accessExpiresAt: z.number(),
});
type BridgeSecretPayload = z.infer<typeof bridgeSecretPayloadSchema>;

/** A small buffer so we refresh slightly before GoTrue would reject the token. */
const ACCESS_TOKEN_REFRESH_BUFFER_MS = 60_000;

/**
 * The Vault secret name for a bridge, which MUST be unique per secret — never
 * per user.
 *
 * `vault.secrets.name` carries a UNIQUE index (`secrets_name_idx`) and
 * `oauth_bridge_rotate_secret` inserts through `vault.create_secret(p_secret,
 * p_name, …)`, so a name derived only from the user id lets the FIRST bridge a
 * user ever mints squat that name permanently. Every later mint for the same
 * user then died with
 *
 *   duplicate key value violates unique constraint "secrets_name_idx"
 *
 * surfacing as a bare HTTP 500 from POST /api/oauth/token — i.e. a user who had
 * connected one MCP client could never connect a second, and a user with a
 * personal agent (the since-retired agent owner client minted through this
 * same function) could not connect an MCP client at all.
 *
 * Two clients must NOT share one bridge anyway: each holds its own GoTrue
 * session, and collapsing them onto one Vault row would make each client's
 * refresh rotate the other's token out from under it. So one secret per mint,
 * with the user id kept as a prefix purely so secrets stay greppable per user
 * during ops.
 */
function bridgeSecretName(userId: string): string {
  return `mcp_bridge:${userId}:${randomUUID()}`;
}

function payloadFromSession(session: Session): BridgeSecretPayload {
  const accessExpiresAt = session.expires_at
    ? session.expires_at * 1000
    : Date.now() + session.expires_in * 1000;
  return {
    refreshToken: session.refresh_token,
    accessToken: session.access_token,
    accessExpiresAt,
  };
}

/**
 * Mints a real GoTrue session for `userId` without sending email
 * (generateLink + verifyOtp, gated behind the service-role key). The user
 * must have an email address. Callers decide whether to store anything.
 */
export async function mintSessionForUser(userId: string): Promise<Session> {
  const { SUPABASE_SERVICE_ROLE_KEY } = getServerEnv();
  const admin = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data: userRes, error: userErr } =
    await admin.auth.admin.getUserById(userId);
  if (userErr || !userRes.user?.email)
    throw new Error(userErr?.message ?? "User has no email; cannot bridge.");
  const { data: linkData, error: linkErr } =
    await admin.auth.admin.generateLink({
      type: "magiclink",
      email: userRes.user.email,
    });
  if (linkErr || !linkData)
    throw new Error(linkErr?.message ?? "generateLink failed.");
  const { data: sessionData, error: verifyErr } =
    await anonClient().auth.verifyOtp({
      token_hash: linkData.properties.hashed_token,
      type: "magiclink",
    });
  if (verifyErr || !sessionData.session)
    throw new Error(verifyErr?.message ?? "verifyOtp failed.");
  return sessionData.session;
}

/**
 * Mints a real GoTrue session for `userId` (see mintSessionForUser) and
 * stores it in Vault. Returns the new bridge_secret_id to persist on a NEW
 * oauth_tokens row (the authorization-code exchange).
 *
 * Not for replacing the secret of an existing row: that must be a
 * compare-and-set on the row, which is `healBridge` / `getBridgedClient`.
 */
export async function mintBridgeSecret(userId: string): Promise<string> {
  const svc = createServiceClient();
  const session = await mintSessionForUser(userId);

  const { data: secretId, error: rpcErr } = await typedRpc(
    svc,
    "oauth_bridge_rotate_secret",
    {
      p_old_secret_id: null,
      p_secret: JSON.stringify(payloadFromSession(session)),
      p_name: bridgeSecretName(userId),
    },
  );
  if (rpcErr || !secretId)
    throw new Error(rpcErr?.message ?? "Vault store failed.");
  return secretId;
}

export function clientFromAccessToken(
  accessToken: string,
): SupabaseClient<Database> {
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    },
  );
}

type ServiceClient = SupabaseClient<Database>;
type Bridged = { client: SupabaseClient<Database>; newBridgeSecretId: string };

/**
 * `oauth_bridge_swap_secret` is added by
 * 20261115173811_oauth_token_idle_expiry_and_bridge_swap.sql and is not in the
 * generated types until the orchestrator regenerates them, so `typedRpc` cannot
 * name it yet. This is the function's exact SQL signature; once the types are
 * regenerated, replace `swapBridgeSecret`'s body with a plain `typedRpc` call.
 */
type SwapSecretRpc = {
  rpc(
    fn: "oauth_bridge_swap_secret",
    args: {
      p_token_id: string;
      p_expected_secret_id: string;
      p_secret: string;
      p_name: string;
    },
  ): PromiseLike<{ data: string | null; error: { message: string } | null }>;
};

/**
 * Stores `session` as the bridge secret of `tokenRowId`, compare-and-set on
 * the secret the caller read. One transaction in the database: the new secret
 * is created, the row re-pointed and the old secret deleted together, or — when
 * the row is gone or already points somewhere else — nothing happens at all and
 * this returns null. So a caller that loses the race never leaves a secret
 * behind and never overwrites the winner's.
 */
async function swapBridgeSecret(
  svc: ServiceClient,
  tokenRowId: string,
  expectedSecretId: string,
  session: Session,
): Promise<string | null> {
  const { data, error } = await (svc as unknown as SwapSecretRpc).rpc(
    "oauth_bridge_swap_secret",
    {
      p_token_id: tokenRowId,
      p_expected_secret_id: expectedSecretId,
      p_secret: JSON.stringify(payloadFromSession(session)),
      // A fresh unique name, never a per-user one: see bridgeSecretName().
      p_name: bridgeSecretName(session.user.id),
    },
  );
  if (error) throw new BridgeUnavailableError(`vault swap: ${error.message}`);
  return data;
}

/** Reads and validates a bridge secret. Never returns a half-usable payload. */
async function readBridgeSecret(
  svc: ServiceClient,
  bridgeSecretId: string,
): Promise<BridgeSecretPayload> {
  const { data: secretJson, error } = await typedRpc(
    svc,
    "oauth_bridge_get_secret",
    { p_secret_id: bridgeSecretId },
  );
  // An RPC error says nothing about the session — Vault may just be unreachable.
  if (error) throw new BridgeUnavailableError(`vault read: ${error.message}`);
  // No error and no row: the secret this token points at does not exist. That
  // is a definite state, not an outage — nothing will ever bring it back.
  if (!secretJson) throw new BridgeSessionDeadError("bridge secret missing");

  let raw: unknown;
  try {
    raw = JSON.parse(secretJson);
  } catch {
    throw new BridgeUnavailableError("bridge secret is not valid JSON");
  }
  const parsed = bridgeSecretPayloadSchema.safeParse(raw);
  if (!parsed.success)
    throw new BridgeUnavailableError("bridge secret has an unexpected shape");
  return parsed.data;
}

function isFresh(payload: BridgeSecretPayload): boolean {
  return Date.now() < payload.accessExpiresAt - ACCESS_TOKEN_REFRESH_BUFFER_MS;
}

/** Exchanges the stored refresh token, classifying a failure (bridge-errors.ts). */
async function refreshBridgeSession(refreshToken: string): Promise<Session> {
  let result: Awaited<
    ReturnType<SupabaseClient<Database>["auth"]["refreshSession"]>
  >;
  try {
    result = await anonClient().auth.refreshSession({
      refresh_token: refreshToken,
    });
  } catch (e) {
    // auth-js returns auth errors and only throws what it could not classify.
    throw new BridgeUnavailableError(`refresh threw: ${describeAuthError(e)}`);
  }
  const { data, error } = result;
  if (error) {
    if (isDeadSessionError(error))
      throw new BridgeSessionDeadError(describeAuthError(error));
    throw new BridgeUnavailableError(`refresh: ${describeAuthError(error)}`);
  }
  if (!data.session)
    throw new BridgeUnavailableError("refresh returned no session");
  return data.session;
}

/**
 * The caller lost a secret swap, or found its secret already replaced: another
 * request got there first. Serve from whatever the token row points at NOW.
 * Never mints, never writes.
 */
async function adoptCurrentBridge(
  svc: ServiceClient,
  tokenRowId: string,
  staleSecretId: string,
): Promise<Bridged> {
  const row = await readTokenBridge(tokenRowId);
  if (!row.bridgeSecretId || row.bridgeSecretId === staleSecretId)
    throw new BridgeUnavailableError("bridge swap lost with no winner");
  const payload = await readBridgeSecret(svc, row.bridgeSecretId);
  // The winner stored a session moments ago; a stale one here means something
  // else is wrong, and the next call will sort it out from a clean read.
  if (!isFresh(payload))
    throw new BridgeUnavailableError("winning bridge secret is not fresh");
  return {
    client: clientFromAccessToken(payload.accessToken),
    newBridgeSecretId: row.bridgeSecretId,
  };
}

async function readTokenBridge(
  tokenRowId: string,
): Promise<{ bridgeSecretId: string | null }> {
  let row: Awaited<ReturnType<typeof readBridgeSecretId>>;
  try {
    row = await readBridgeSecretId(tokenRowId);
  } catch (e) {
    throw new BridgeUnavailableError(
      `token row read: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!row.found) throw new BridgeRevokedError();
  return { bridgeSecretId: row.bridgeSecretId };
}

/**
 * Resolves the Supabase session stored behind `bridgeSecretId` to a
 * request-scoped client authenticated as that session's user.
 *
 * The Vault secret caches the last-minted access token alongside its
 * expiry, so the common case (access token still valid) is a pure Vault
 * read — no GoTrue call, no secret rotation, no DB write. Only when the
 * cached access token is expired (or within `ACCESS_TOKEN_REFRESH_BUFFER_MS`
 * of expiring) is the session refreshed, which rotates the GoTrue refresh
 * token and therefore the Vault secret.
 *
 * Pass `tokenRowId` (every real connection does — see `getRequestClient`) and
 * that rotation is a compare-and-set on the token row
 * (`oauth_bridge_swap_secret`): MCP clients routinely dispatch several tool
 * calls at once, and when they all find the access token expired each one
 * refreshes. Exactly one of them replaces the secret; the others adopt it.
 * Before this, each created its own secret and the last row update won,
 * orphaning the rest in Vault with a live session inside. The token row is
 * already up to date when this returns — there is nothing left to persist.
 *
 * Without `tokenRowId` there is no row to compare against (integration tests
 * that bridge a bare secret); the secret is rotated in place and the caller
 * owns `newBridgeSecretId`.
 *
 * Failures are classified, never thrown raw: `BridgeSessionDeadError` only on
 * positive proof that the session is gone, `BridgeUnavailableError` for
 * everything else. See bridge-errors.ts.
 */
export async function getBridgedClient(
  bridgeSecretId: string,
  tokenRowId?: string,
): Promise<Bridged> {
  const svc = createServiceClient();
  const cached = await readBridgeSecret(svc, bridgeSecretId);

  if (isFresh(cached)) {
    return {
      client: clientFromAccessToken(cached.accessToken),
      newBridgeSecretId: bridgeSecretId,
    };
  }

  const session = await refreshBridgeSession(cached.refreshToken);

  if (tokenRowId) {
    const swapped = await swapBridgeSecret(
      svc,
      tokenRowId,
      bridgeSecretId,
      session,
    );
    if (!swapped) return adoptCurrentBridge(svc, tokenRowId, bridgeSecretId);
    return {
      client: clientFromAccessToken(session.access_token),
      newBridgeSecretId: swapped,
    };
  }

  const { data: newSecretId, error: rotErr } = await typedRpc(
    svc,
    "oauth_bridge_rotate_secret",
    {
      p_old_secret_id: bridgeSecretId,
      p_secret: JSON.stringify(payloadFromSession(session)),
      // A fresh unique name, not the old one: the rpc DELETEs p_old_secret_id
      // before inserting, but that only frees THIS bridge's name — a sibling
      // bridge for the same user still holds its own row, so a per-user name
      // would collide here exactly as it did on mint.
      p_name: bridgeSecretName(session.user.id),
    },
  );
  if (rotErr || !newSecretId)
    throw new BridgeUnavailableError(
      `vault rotate: ${rotErr?.message ?? "no id returned"}`,
    );

  return {
    client: clientFromAccessToken(session.access_token),
    newBridgeSecretId: newSecretId,
  };
}

/** How a call that did not win the heal waits for the one that did. */
const HEAL_WAIT_ATTEMPTS = 5;
const HEAL_WAIT_MS = 300;

/**
 * Replaces a connection's dead Supabase session with a fresh one for the same
 * user ("self-heal"). Call it ONLY after `getBridgedClient` threw
 * `BridgeSessionDeadError` for `deadSecretId`.
 *
 * The MCP token was verified to get here, so the user's grant still stands;
 * what died is the session behind it. Safe under concurrency and bounded:
 *
 *   1. If the row already points at a different secret, someone else replaced
 *      it — adopt theirs, mint nothing.
 *   2. Otherwise claim the heal (`claimBridgeHeal`): one caller per token per
 *      60 s, across all server instances. Callers that do not get the claim
 *      wait briefly for the winner's secret and adopt it; if none appears (the
 *      cooldown is holding back a second heal), they fail retryably.
 *   3. The winner mints a session and swaps it in compare-and-set. If the swap
 *      loses after all, nothing was stored and it adopts the current secret.
 *
 * A mint failure propagates (a deleted user, a user with no email, GoTrue
 * down). The claim is not released, so the next attempt is a minute away —
 * which is what keeps a misclassified outage from becoming a mint storm.
 */
export async function healBridge(
  input: { tokenRowId: string; userId: string; deadSecretId: string },
  opts: { waitMs?: number } = {},
): Promise<Bridged> {
  const { tokenRowId, userId, deadSecretId } = input;
  const svc = createServiceClient();

  const row = await readTokenBridge(tokenRowId);
  if (row.bridgeSecretId !== deadSecretId)
    return adoptCurrentBridge(svc, tokenRowId, deadSecretId);

  let claimed: boolean;
  try {
    claimed = await claimBridgeHeal(tokenRowId, deadSecretId);
  } catch (e) {
    throw new BridgeUnavailableError(
      `heal claim: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (!claimed) {
    const waitMs = opts.waitMs ?? HEAL_WAIT_MS;
    for (let attempt = 0; attempt < HEAL_WAIT_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      const now = await readTokenBridge(tokenRowId);
      if (now.bridgeSecretId !== deadSecretId)
        return adoptCurrentBridge(svc, tokenRowId, deadSecretId);
    }
    throw new BridgeUnavailableError("heal in progress or cooling down");
  }

  const session = await mintSessionForUser(userId);
  const swapped = await swapBridgeSecret(
    svc,
    tokenRowId,
    deadSecretId,
    session,
  );
  if (!swapped) return adoptCurrentBridge(svc, tokenRowId, deadSecretId);
  return {
    client: clientFromAccessToken(session.access_token),
    newBridgeSecretId: swapped,
  };
}

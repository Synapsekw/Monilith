import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/session";
import { authorizeRequestSchema } from "@/lib/validations/mcp-oauth";
import { getOauthClient } from "@/lib/mcp/oauth/client-store";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = authorizeRequestSchema.safeParse(
    Object.fromEntries(url.searchParams),
  );
  if (!parsed.success) {
    return new Response(`invalid_request: ${parsed.error.issues[0]?.message}`, {
      status: 400,
    });
  }

  const client = await getOauthClient(parsed.data.client_id);
  if (!client || !client.redirect_uris.includes(parsed.data.redirect_uri)) {
    return new Response("invalid_client", { status: 400 });
  }

  const user = await getUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  }

  const consentUrl = new URL("/oauth/consent", url.origin);
  consentUrl.search = url.search;
  redirect(consentUrl.toString());
}

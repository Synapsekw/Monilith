import { Suspense } from "react";
import { requireUser } from "@/lib/auth/session";
import { authorizeRequestSchema } from "@/lib/validations/mcp-oauth";
import { getOauthClient } from "@/lib/mcp/oauth/client-store";
import { approveConsent } from "./actions";

// Both dynamic reads resolve inside the Suspense boundary (Cache Components) —
// same pattern as src/app/(auth)/change-password/page.tsx.
async function ConsentGate({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, user] = await Promise.all([searchParams, requireUser()]);
  const parsed = authorizeRequestSchema.safeParse(params);
  if (!parsed.success) {
    return (
      <p>Invalid authorization request: {parsed.error.issues[0]?.message}</p>
    );
  }
  const client = await getOauthClient(parsed.data.client_id);
  if (!client) return <p>Unknown client.</p>;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <h1 className="text-xl font-semibold">
        {client.client_name} wants to access your Pulse account
      </h1>
      <p className="text-muted-foreground text-sm">
        Signed in as {user.email}. This grants read and write access to your
        boards and items — exactly what you can see and do when logged in.
      </p>
      <form action={approveConsent} className="flex gap-3">
        {Object.entries(parsed.data).map(([key, value]) =>
          value === undefined ? null : (
            <input key={key} type="hidden" name={key} value={value} />
          ),
        )}
        <button
          type="submit"
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium"
        >
          Allow access
        </button>
      </form>
    </main>
  );
}

export default function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense>
      <ConsentGate searchParams={searchParams} />
    </Suspense>
  );
}

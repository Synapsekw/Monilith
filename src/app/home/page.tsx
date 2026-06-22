import { redirect } from "next/navigation";
import { MonolithMark } from "@/components/brand/monolith-mark";
import { AppShell } from "@/components/app-shell";
import {
  getUser,
  getUserOrgs,
  enforcePasswordChange,
} from "@/lib/auth/session";
import { isPlatformAdmin } from "@/lib/platform/guard";
import { isOrgAdmin } from "@/lib/org/guard";
import { listMyBoards, listSharedBoards } from "@/lib/boards/queries";
import { createClient } from "@/lib/supabase/server";

/**
 * Authenticated entry dispatcher. The public landing (`/`) is a static hero with
 * no per-user data; the cookie-reading "where does this user go" logic lives
 * here so `/` can be prerendered and served from the edge. `proxy.ts` redirects
 * logged-in visitors who hit `/` to this route; a logged-out visitor who reaches
 * it directly is sent to /login. Routing logic is unchanged from the prior `/`.
 */
export default async function Home() {
  const user = await getUser();
  if (!user) redirect("/login");

  enforcePasswordChange(user);

  const orgs = await getUserOrgs();
  if (orgs.length === 0) redirect("/onboarding");

  const org = orgs[0];

  const boards = await listMyBoards();
  if (boards.length > 0) redirect(`/boards/${boards[0].id}`);

  // A member who owns no boards but has one shared with them should land on it,
  // not on the empty welcome screen (the sidebar's "Shared with me" only renders
  // under /boards/*). Mirrors the owned-board redirect above.
  const sharedBoards = await listSharedBoards();
  if (sharedBoards.length > 0) redirect(`/boards/${sharedBoards[0].id}`);

  const supabase = await createClient();
  const [{ data: workspaces }, platformAdmin, orgAdmin] = await Promise.all([
    supabase.from("workspaces").select("id, name"),
    isPlatformAdmin(),
    isOrgAdmin(),
  ]);

  return (
    <AppShell
      user={{
        email: user.email,
        full_name:
          typeof user.user_metadata?.full_name === "string"
            ? user.user_metadata.full_name
            : null,
      }}
      org={{ name: org.name }}
      workspaces={workspaces ?? []}
      boards={[]}
      sharedBoards={[]}
      isPlatformAdmin={platformAdmin}
      isOrgAdmin={orgAdmin}
    >
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="bg-surface flex size-12 items-center justify-center rounded-xl border">
          <MonolithMark className="text-foreground size-6" />
        </div>
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight">
            Welcome to {org.name}
          </h1>
          <p className="text-muted-foreground max-w-md text-sm text-pretty">
            The only workspace you need.
          </p>
        </div>
      </div>
    </AppShell>
  );
}

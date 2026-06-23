import { Suspense } from "react";
import { redirect } from "next/navigation";
import { MonolithMark } from "@/components/brand/monolith-mark";
import { AuthenticatedShell } from "@/components/shell/authenticated-shell";
import {
  getUser,
  getUserOrgs,
  enforcePasswordChange,
} from "@/lib/auth/session";
import { listMyBoards, listSharedBoards } from "@/lib/boards/queries";

/**
 * Authenticated entry dispatcher. The public landing (`/`) is a static hero with
 * no per-user data; the cookie-reading "where does this user go" logic lives
 * here so `/` can be prerendered and served from the edge. `proxy.ts` redirects
 * logged-in visitors who hit `/` to this route; a logged-out visitor who reaches
 * it directly is sent to /login. Routing logic is unchanged from the prior `/`.
 */
export async function HomeDispatch() {
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

  return (
    <AuthenticatedShell>
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
    </AuthenticatedShell>
  );
}

export default function Home() {
  // The cookie-bound dispatch (redirects + welcome shell) streams behind a
  // Suspense boundary so the route satisfies Cache Components.
  return (
    <Suspense fallback={null}>
      <HomeDispatch />
    </Suspense>
  );
}

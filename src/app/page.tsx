import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";
import { MonolithHero } from "@/components/landing/monolith-hero";
import { AppShell } from "@/components/app-shell";
import {
  getUser,
  getUserOrgs,
  enforcePasswordChange,
} from "@/lib/auth/session";
import { isPlatformAdmin } from "@/lib/platform/guard";
import { listBoards } from "@/lib/boards/queries";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const user = await getUser();
  if (!user) return <MonolithHero />;

  enforcePasswordChange(user);

  const orgs = await getUserOrgs();
  if (orgs.length === 0) redirect("/onboarding");

  const org = orgs[0];

  const boards = await listBoards();
  if (boards.length > 0) redirect(`/boards/${boards[0].id}`);

  const supabase = await createClient();
  const [{ data: workspaces }, platformAdmin] = await Promise.all([
    supabase.from("workspaces").select("id, name"),
    isPlatformAdmin(),
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
      isPlatformAdmin={platformAdmin}
    >
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="bg-surface flex size-12 items-center justify-center rounded-xl border">
          <Sparkles className="text-primary size-6" />
        </div>
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight">
            Welcome to {org.name}
          </h1>
          <p className="text-muted-foreground max-w-md text-sm text-pretty">
            Your workspace is ready. Press{" "}
            <kbd className="bg-muted rounded border px-1.5 font-mono text-xs">
              ⌘K
            </kbd>{" "}
            to open the command palette, or create your first board using the
            sidebar.
          </p>
        </div>
      </div>
    </AppShell>
  );
}

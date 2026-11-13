import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { createClient } from "@/lib/supabase/server";
import { getMyMono, listMonoBoards } from "@/lib/monos/queries";
import { SettingsSection } from "@/components/settings/settings-section";
import { MyMonoSettings } from "@/components/mono/MyMonoSettings";

export const metadata = { title: "My Mono · Settings" };

/** Three bounded reads: the caller's Mono (point read), the boards it is on
 *  (≤100, indexed by user_id), and the caller's name for the owner label. */
export default async function MyMonoSettingsPage() {
  const user = await requireUser();
  const org = await resolveActiveOrg();
  if (!org) redirect("/onboarding");
  const supabase = await createClient();
  const [mono, { data: me }] = await Promise.all([
    getMyMono(supabase, org.id),
    supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle(),
  ]);
  const boards = mono ? await listMonoBoards(supabase, mono.userId) : [];

  return (
    <SettingsSection
      title="My Mono"
      description="Your own agent in this organization. Only you can chat with it, assign it or @mention it."
    >
      <MyMonoSettings
        mono={mono}
        boards={boards}
        ownerName={me?.full_name ?? null}
      />
    </SettingsSection>
  );
}

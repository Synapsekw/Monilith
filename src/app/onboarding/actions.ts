"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUser, getUserOrgs } from "@/lib/auth/session";
import { onboardingSchema } from "@/lib/validations/onboarding";

export type OnboardingState = {
  error?: string;
};

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const suffix = crypto.randomUUID().slice(0, 6);
  return base ? `${base}-${suffix}` : suffix;
}

export async function createWorkspaceOrg(
  _prevState: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const parsed = onboardingSchema.safeParse({
    orgName: formData.get("orgName"),
    workspaceName: formData.get("workspaceName"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid details" };
  }

  const user = await getUser();
  if (!user) {
    return { error: "You must be signed in to continue." };
  }

  // Server-side re-check of the onboarding page's gate: the action is directly
  // invokable, so without this a member could loop it to mint orgs. getUserOrgs
  // throws on DB failure — map that to a friendly retry message rather than
  // letting the raw error escape the action.
  try {
    const orgs = await getUserOrgs();
    if (orgs.length > 0) {
      return { error: "You already belong to an organization." };
    }
  } catch {
    return { error: "Could not verify your account. Please try again." };
  }

  const supabase = await createClient();

  // One transaction: org + owner membership + first workspace. The previous
  // two-step (RPC then a separate workspaces insert) could fail halfway,
  // leaving an org with no workspace and letting a retry mint a second org.
  const { data: org, error: orgError } = await supabase.rpc(
    "create_organization",
    {
      p_name: parsed.data.orgName,
      p_slug: slugify(parsed.data.orgName),
      p_workspace_name: parsed.data.workspaceName,
    },
  );

  if (orgError || !org) {
    // P0001 = the RPC's own `raise exception` guard messages, written to be
    // user-facing ("You already have an organization."). Anything else is raw
    // Postgres text — keep it out of the UI.
    return {
      error:
        orgError?.code === "P0001"
          ? orgError.message
          : "Could not create your organization. Please try again.",
    };
  }

  // redirect() throws — must be called outside the try/catch logic above.
  redirect("/");
}

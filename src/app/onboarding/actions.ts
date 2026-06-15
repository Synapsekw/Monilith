"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You must be signed in to continue." };
  }

  const { data: org, error: orgError } = await supabase.rpc(
    "create_organization",
    {
      p_name: parsed.data.orgName,
      p_slug: slugify(parsed.data.orgName),
    },
  );

  if (orgError || !org) {
    return {
      error: orgError?.message ?? "Could not create your organization.",
    };
  }

  const { error: workspaceError } = await supabase.from("workspaces").insert({
    org_id: org.id,
    name: parsed.data.workspaceName,
    created_by: user.id,
  });

  if (workspaceError) {
    return { error: workspaceError.message };
  }

  // redirect() throws — must be called outside the try/catch logic above.
  redirect("/");
}

import { redirect } from "next/navigation";
import { requireUser, getUserOrgs } from "@/lib/auth/session";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { TimezoneForm } from "@/components/settings/timezone-form";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireUser();
  const orgs = await getUserOrgs();
  const org = orgs[0];
  if (!org) redirect("/onboarding");

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-foreground font-heading text-2xl font-semibold tracking-tight">
          Settings
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage your organization preferences.
        </p>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Organization</CardTitle>
            <CardDescription>
              General settings for your organization.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Org name — read-only */}
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Name</p>
              <p className="text-muted-foreground bg-muted/40 rounded-md border px-3 py-2 text-sm">
                {org.name}
              </p>
            </div>

            {/* Timezone form */}
            <TimezoneForm
              orgId={org.id}
              currentTimezone={org.timezone ?? "UTC"}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

import { redirect } from "next/navigation";
import { Hourglass } from "lucide-react";
import { signOut } from "@/app/auth/actions";
import { getUser, loginRedirectPath } from "@/lib/auth/session";
import { readAccountApproval } from "@/lib/auth/approval";
import { CheckApprovalForm } from "@/components/auth/check-approval-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Kicker } from "@/components/ui/kicker";

/**
 * The waiting screen's body. Uses getUser(), NOT requireUser(): requireUser
 * sends an unapproved account here, so using it would loop. No session ->
 * login; approved -> /home. The status is read live (this page is the one place
 * a stale cached "pending" must not be shown).
 */
export async function PendingApprovalGate() {
  const user = await getUser();
  if (!user) redirect(await loginRedirectPath());
  const status = await readAccountApproval(user.id);
  if (status === "approved") redirect("/home");

  const rejected = status === "rejected";
  return (
    <Card className="shadow-panel">
      <CardHeader>
        <div className="bg-surface mb-1 flex size-9 items-center justify-center rounded-lg border">
          <Hourglass className="text-primary size-4" />
        </div>
        <Kicker>ACCOUNT</Kicker>
        <CardTitle>
          {rejected
            ? "Your account was not approved"
            : "Your account is waiting for approval"}
        </CardTitle>
        <CardDescription>
          {rejected
            ? "An administrator reviewed your account and did not approve it. If you think this is a mistake, contact your administrator."
            : "An administrator has to approve your account before you can use Monolith. Check back soon, or come back later."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-sm">
          Signed in as{" "}
          <span className="text-foreground font-medium">{user.email}</span>
        </p>
        <CheckApprovalForm />
        <form action={signOut}>
          <Button type="submit" variant="ghost" className="w-full">
            Sign out
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

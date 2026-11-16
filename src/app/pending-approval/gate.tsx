import { redirect } from "next/navigation";
import { Hourglass } from "lucide-react";
import { signOut } from "@/app/auth/actions";
import { getUser, loginRedirectPath } from "@/lib/auth/session";
import { readAccountApproval } from "@/lib/auth/approval";
import { createClient } from "@/lib/supabase/server";
import { fetchPendingInvitations } from "@/lib/collaboration/invitations-data";
import { invitationSummary } from "@/lib/collaboration/invitations";
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

/** The waiting screen names at most this many invitations. */
const MAX_INVITATIONS_SHOWN = 3;

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
  // An invited person lands here straight after setting their password. Say
  // that the invitation is safe and what unlocks it, so the wait does not read
  // as the invitation having failed. One bounded read of the person's own
  // invitations; a failed read is an empty list (the generic wording).
  const invitations = rejected
    ? []
    : (await fetchPendingInvitations(await createClient())).slice(
        0,
        MAX_INVITATIONS_SHOWN,
      );
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
            : "An administrator has to approve your account before you can use Monolith. You can close this page and sign in again later."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-sm">
          Signed in as{" "}
          <span className="text-foreground font-medium">{user.email}</span>
        </p>
        {invitations.length > 0 ? (
          <div
            data-testid="pending-invitations"
            className="bg-surface space-y-1.5 rounded-lg border p-3 text-sm"
          >
            <ul className="space-y-1">
              {invitations.map((i) => (
                <li key={i.id} className="text-foreground">
                  {invitationSummary(i)}.
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground">
              {invitations.length === 1
                ? "Your invitation is saved. You get access as soon as your account is approved."
                : "Your invitations are saved. You get access as soon as your account is approved."}
            </p>
          </div>
        ) : null}
        <CheckApprovalForm rejected={rejected} />
        <form action={signOut}>
          <Button type="submit" variant="ghost" className="w-full">
            Sign out
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

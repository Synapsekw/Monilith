"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/session";
import { readAccountApproval } from "@/lib/auth/approval";
import { finishAccountSetup } from "@/lib/auth/finish-setup";
import { approvalTag } from "@/lib/cache/tags";
import { fail, type ActionResult } from "@/lib/actions/result";

/**
 * "Check again" on the waiting screen. Reads the status LIVE (never the cached
 * value: the cache may still hold the "pending" the person was just sent here
 * with). Still waiting -> ok, and the page re-renders its message. Approved ->
 * expire this account's cached status so the gate sees it at once, run the
 * first-sign-in setup that the callback skipped, then go home.
 */
export async function checkApproval(): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return fail("Not authenticated.");

  let status;
  try {
    status = await readAccountApproval(user.id);
  } catch {
    return fail("We couldn't check your account status. Please try again.");
  }
  if (status !== "approved") return { ok: true, data: undefined };

  updateTag(approvalTag(user.id));
  const setup = await finishAccountSetup(user);
  if (!setup.ok)
    return fail(
      "We couldn't finish setting up your account. Please try again.",
    );

  // redirect() throws — kept outside any try/catch.
  redirect("/home");
}

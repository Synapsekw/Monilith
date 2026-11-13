import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { resolveActiveOrg } from "@/lib/org/active";
import { isOrgAdminCached } from "@/lib/org/guard";
import { SettingsNav } from "@/components/settings/settings-nav";
import { settingsNavGroups } from "./settings-nav-groups";

/**
 * The per-user half of the settings shell: the nav with the admin-gated
 * Members entry, plus the "no organization → onboarding" gate every settings
 * section shares. It lives here, behind the layout's Suspense boundary, and
 * NOT in the layout body — awaiting these reads in the layout put them above
 * every boundary, so every settings page prerendered to an empty shell and its
 * first byte waited on them (see `src/test/static-shell.test.ts`).
 *
 * All three reads are shared with the rest of the request: `requireUser` is a
 * local JWT verify, `resolveActiveOrg` is request-memoised (the app shell and
 * the page resolve it too), and `isOrgAdminCached` is the narrow, tagged
 * `org_members` role lookup — not `isOrgAdmin()`, which derives the role from
 * the heavy get_org_members RPC.
 *
 * The redirect is thrown from a streaming context now (the shell has already
 * flushed), so it reaches the browser as a client-side redirect rather than a
 * 307 — the same form as every page-level `redirect("/onboarding")` under the
 * `(app)` shell. It cannot move to the routing layer the way the `/settings`
 * index redirect did (next.config.ts): it depends on a DB read, and the proxy
 * deliberately runs none.
 */
export async function SettingsNavData() {
  const user = await requireUser();
  const org = await resolveActiveOrg();
  if (!org) redirect("/onboarding");
  const isAdmin = await isOrgAdminCached(user.id, org.id);

  return <SettingsNav groups={settingsNavGroups(isAdmin)} />;
}

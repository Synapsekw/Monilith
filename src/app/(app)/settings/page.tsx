import { redirect } from "next/navigation";

/**
 * `/settings` has no content of its own — the first Account section is home.
 * Existing links to `/settings` (user menu, workspace switcher) land here and
 * bounce, so they keep working unchanged.
 */
export default function SettingsIndexPage() {
  redirect("/settings/profile");
}

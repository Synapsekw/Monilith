import { getSidebarNavData } from "@/components/shell/sidebar-nav-data";
import { MobileNav } from "@/components/shell/mobile-nav";

/**
 * Streamed nav data for the mobile drawer. Shares `getSidebarNavData()` with the
 * desktop rail (`SidebarNavData`); the `use cache` reads dedupe the second call
 * within a request, so this is code reuse without a second Supabase round-trip.
 * Rendered behind its own <Suspense> in the header so the hamburger paints
 * immediately (disabled fallback) and hydrates when the lists arrive.
 */
export async function MobileNavData() {
  const data = await getSidebarNavData();
  return <MobileNav {...data} />;
}

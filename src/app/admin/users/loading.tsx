import { AdminListSkeleton } from "@/components/admin/AdminListSkeleton";

/**
 * Instant loading fallback for the platform users list. Column template is
 * USER_ROW_GRID, spelled out here as a literal so Tailwind emits the tracks.
 * Static Server Component.
 */
export default function AdminUsersLoading() {
  return (
    <AdminListSkeleton
      label="users"
      gridClass="grid grid-cols-[1.6fr_2fr_0.7fr_120px] gap-3"
      cellWidths={["w-44", "w-40", "w-16", null]}
      rows={10}
      toolbar="search"
    />
  );
}

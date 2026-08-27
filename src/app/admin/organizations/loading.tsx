import { AdminListSkeleton } from "@/components/admin/AdminListSkeleton";

/**
 * Instant loading fallback for the platform organizations list. Static Server
 * Component.
 */
export default function AdminOrganizationsLoading() {
  return (
    <AdminListSkeleton
      label="organizations"
      gridClass="grid grid-cols-[2fr_1.4fr_1fr_0.8fr_90px] gap-3"
      cellWidths={["w-48", "w-32", "w-20", "w-8", null]}
      rows={10}
      toolbar="search"
    />
  );
}

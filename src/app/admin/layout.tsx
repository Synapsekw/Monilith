import type { ReactNode } from "react";
import { requirePlatformAdmin } from "@/lib/platform/guard";
import { AuthenticatedShell } from "@/components/shell/authenticated-shell";
import { Toaster } from "@/components/ui/sonner";

export const metadata = { title: "Platform admin" };

export const unstable_instant = false;

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  // The gate runs before any Suspense boundary so a non-admin gets a real
  // redirect, never a mid-stream client redirect. This is a fast auth check
  // (not the heavy shell data, which streams inside AuthenticatedShell).
  await requirePlatformAdmin();

  return (
    <>
      <AuthenticatedShell>
        <div className="w-full px-6 py-8 lg:px-10">{children}</div>
      </AuthenticatedShell>
      {/* Admin sits outside the `(app)` group, so it inherits nothing from that
          group's layout — including the app-wide toaster. Without this mount,
          the row actions' `toast.error` for a refused reset/suspend/reactivate
          renders into a toaster that is not on the page, which is the same
          silent failure the toasts exist to end. */}
      <Toaster />
    </>
  );
}

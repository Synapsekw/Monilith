import type { ReactNode } from "react";
import { requirePlatformAdmin } from "@/lib/platform/guard";
import { AuthenticatedShell } from "@/components/shell/authenticated-shell";

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
    <AuthenticatedShell>
      <div className="w-full px-6 py-8 lg:px-10">{children}</div>
    </AuthenticatedShell>
  );
}

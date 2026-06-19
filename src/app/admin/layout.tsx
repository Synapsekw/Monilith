import type { ReactNode } from "react";
import { requirePlatformAdmin } from "@/lib/platform/guard";

export const metadata = { title: "Platform admin" };

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  // The gate: redirects non-admins; never reveals the route (see guard.ts).
  await requirePlatformAdmin();
  return <div className="mx-auto max-w-4xl px-6 py-10">{children}</div>;
}

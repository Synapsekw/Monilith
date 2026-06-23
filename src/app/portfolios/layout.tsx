import type { ReactNode } from "react";
import { AuthenticatedShell } from "@/components/shell/authenticated-shell";

export const unstable_instant = false;

export default function PortfoliosLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <AuthenticatedShell>{children}</AuthenticatedShell>;
}

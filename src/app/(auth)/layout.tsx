import type { ReactNode } from "react";
import { Brand } from "@/components/brand/brand";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="bg-background flex min-h-svh flex-col items-center justify-center gap-6 px-4 py-10">
      <Brand />
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}

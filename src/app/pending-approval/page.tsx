import { Suspense } from "react";
import { Brand } from "@/components/brand/brand";
import { PendingApprovalGate } from "./gate";

export const metadata = { title: "Waiting for approval" };

// Outside the (auth) group on purpose: the gate must not wrap this page, and
// it uses getUser() (not requireUser()) so a pending account does not loop.
// The cookie-bound reads stream behind Suspense (Cache Components), as on the
// neighbouring auth pages.
export default function PendingApprovalPage() {
  return (
    <main className="bg-background flex min-h-svh flex-col items-center justify-center gap-6 px-4 py-10">
      <Brand />
      <div className="w-full max-w-sm">
        <Suspense>
          <PendingApprovalGate />
        </Suspense>
      </div>
    </main>
  );
}

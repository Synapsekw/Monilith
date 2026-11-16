import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

/**
 * What a guest sees on an org-wide planning page they reached by URL (the
 * sidebar does not offer these to guests). The page would otherwise render
 * empty, with create buttons the database refuses.
 */
export function GuestUnavailable({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-3xl p-8">
      <PageHeader className="mb-6" kicker="Planning" title={title} />
      <EmptyState
        mascot
        title={`${title} is not available to guests`}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboards">Go to your folders</Link>
          </Button>
        }
      >
        You are a guest in this organization, so you see the folders and boards
        that were shared with you.
      </EmptyState>
    </div>
  );
}

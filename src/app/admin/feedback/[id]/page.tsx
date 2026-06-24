import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getFeedback } from "@/lib/feedback/queries";
import { adminUpdateFeedback } from "@/lib/feedback/actions";
import { AdminFeedbackDetail } from "@/components/feedback/AdminFeedbackDetail";

export const metadata = { title: "Platform admin · feedback detail" };

export default async function AdminFeedbackDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const row = await getFeedback(id);
  if (!row) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link
        href="/admin/feedback"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm transition-colors"
      >
        <ChevronLeft className="size-3.5" />
        Back to feedback
      </Link>

      <header>
        <h1 className="text-foreground font-heading text-xl font-semibold tracking-tight">
          Feedback detail
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Review and triage this submission.
        </p>
      </header>

      <AdminFeedbackDetail row={row} save={adminUpdateFeedback} />
    </div>
  );
}

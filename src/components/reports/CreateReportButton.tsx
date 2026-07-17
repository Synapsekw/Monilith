"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { createReport } from "@/lib/reports/actions";

export function CreateReportButton({ boardId }: { boardId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await createReport({ boardId, name: "Status Report" });
          if (res.ok) router.push(`/boards/${boardId}/reports/${res.data.id}`);
        })
      }
    >
      New report
    </button>
  );
}

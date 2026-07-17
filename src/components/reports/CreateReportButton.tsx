"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Plus } from "lucide-react";
import { createReport } from "@/lib/reports/actions";
import { showMutationError } from "@/lib/ui/mutation-toast";
import { Button } from "@/components/ui/button";

export function CreateReportButton({ boardId }: { boardId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await createReport({ boardId, name: "Status Report" });
          if (res.ok) {
            router.push(`/boards/${boardId}/reports/${res.data.id}`);
          } else {
            showMutationError(
              "Couldn't create the report.",
              new Error(res.error),
            );
          }
        })
      }
    >
      <Plus data-icon="inline-start" />
      New report
    </Button>
  );
}

"use client";

import { useState } from "react";
import { submitFeedback, listMyFeedback } from "@/lib/feedback/actions";
import { SubmitFeedbackForm } from "./SubmitFeedbackForm";
import { MyRequestsList } from "./MyRequestsList";
import { cn } from "@/lib/utils";

type Tab = "new" | "mine";

export function FeedbackPopover() {
  const [tab, setTab] = useState<Tab>("new");

  return (
    <div className="flex w-80 flex-col">
      {/* Header */}
      <div className="border-border flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-foreground text-sm font-semibold">Feedback</h2>
        {/* Tab toggle */}
        <div className="border-border bg-muted/40 flex gap-0.5 rounded-md border p-0.5">
          <button
            type="button"
            onClick={() => setTab("new")}
            className={cn(
              "rounded-[calc(var(--radius-md)-2px)] px-2.5 py-0.5 text-xs font-medium transition-all",
              tab === "new"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            New
          </button>
          <button
            type="button"
            onClick={() => setTab("mine")}
            className={cn(
              "rounded-[calc(var(--radius-md)-2px)] px-2.5 py-0.5 text-xs font-medium transition-all",
              tab === "mine"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            My requests
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="overflow-y-auto p-4" style={{ maxHeight: "420px" }}>
        {tab === "new" ? (
          <SubmitFeedbackForm
            submit={submitFeedback}
            onDone={() => setTab("mine")}
          />
        ) : (
          <MyRequestsList load={listMyFeedback} />
        )}
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, CheckCircle, AlertCircle } from "lucide-react";
import { FEEDBACK_STATUSES } from "@/lib/validations/feedback";
import type { AdminUpdateFeedbackInput } from "@/lib/validations/feedback";
import type { ActionResult } from "@/lib/feedback/actions";
import type { Tables } from "@/types/database.types";
import { cn } from "@/lib/utils";
import {
  STATUS_BG,
  statusToneClasses,
  type StatusColor,
} from "@/components/ui/status-pill";

type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

const STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: "New",
  triaged: "Triaged",
  planned: "Planned",
  in_progress: "In progress",
  resolved: "Resolved",
  declined: "Declined",
};

// Feedback triage states on the sanctioned status palette. statusToneClasses
// derives AA-legible text per fill (was a hardcoded `text-white`, which fails
// on the pale orange/green/teal fills in dark mode).
const STATUS_TONE: Record<FeedbackStatus, StatusColor> = {
  new: "blue",
  triaged: "teal",
  planned: "purple",
  in_progress: "orange",
  resolved: "green",
  declined: "gray",
};

const KIND_LABELS: Record<string, string> = {
  bug: "Bug",
  feature_request: "Feature request",
};

type Props = {
  row: Tables<"feedback">;
  save: (i: AdminUpdateFeedbackInput) => Promise<ActionResult>;
};

export function AdminFeedbackDetail({ row, save }: Props) {
  const [status, setStatus] = useState<FeedbackStatus>(
    row.status as FeedbackStatus,
  );
  const [adminResponse, setAdminResponse] = useState(row.admin_response ?? "");
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleSave() {
    setPending(true);
    setSaved(false);
    setSaveError(null);
    const result = await save({
      id: row.id,
      status,
      adminResponse: adminResponse || undefined,
    });
    setPending(false);
    if (result.ok) {
      setSaved(true);
    } else {
      setSaveError(result.error);
    }
  }

  return (
    <div className="space-y-8">
      {/* Report header */}
      <div className="bg-surface rounded-xl border p-6">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {KIND_LABELS[row.kind] ?? row.kind}
          </span>
          <span className="text-muted-foreground text-xs">·</span>
          <span className="text-muted-foreground text-xs">
            {new Date(row.created_at).toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </span>
        </div>
        <h2 className="text-foreground text-lg font-semibold">{row.title}</h2>
        <p className="text-muted-foreground mt-3 text-sm leading-relaxed whitespace-pre-wrap">
          {row.body}
        </p>
      </div>

      {/* Triage controls */}
      <div className="bg-surface rounded-xl border p-6">
        <h3 className="text-foreground mb-4 text-sm font-semibold">Triage</h3>

        {/* Status picker */}
        <div className="mb-4">
          <label className="text-muted-foreground mb-1.5 block text-xs font-medium">
            Status
          </label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
                  statusToneClasses(STATUS_TONE[status], "solid"),
                )}
                aria-label="Change status"
              >
                {STATUS_LABELS[status]}
                <ChevronDown className="size-3.5 opacity-70" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              {FEEDBACK_STATUSES.map((s) => (
                <DropdownMenuItem
                  key={s}
                  onSelect={() => setStatus(s)}
                  className={cn(
                    "flex items-center gap-2",
                    s === status && "font-medium",
                  )}
                >
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      STATUS_BG[STATUS_TONE[s]],
                    )}
                  />
                  {STATUS_LABELS[s]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Response textarea */}
        <div className="mb-5">
          <label
            htmlFor="admin-response"
            className="text-muted-foreground mb-1.5 block text-xs font-medium"
          >
            Public response{" "}
            <span className="font-normal opacity-70">
              (visible to submitter)
            </span>
          </label>
          <Textarea
            id="admin-response"
            placeholder="Public response…"
            value={adminResponse}
            onChange={(e) => setAdminResponse(e.target.value)}
            rows={4}
            className="resize-none text-sm"
          />
        </div>

        {/* Save button + feedback */}
        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={pending} size="sm">
            {pending ? "Saving…" : "Save"}
          </Button>
          {saved && (
            <span className="text-muted-foreground flex items-center gap-1 text-xs">
              <CheckCircle className="text-status-green size-3.5" />
              Saved
            </span>
          )}
          {saveError && (
            <span className="text-destructive flex items-center gap-1 text-xs">
              <AlertCircle className="size-3.5" />
              {saveError}
            </span>
          )}
        </div>
      </div>

      {/* Previous response (if any was already saved) */}
      {row.admin_response && (
        <div className="bg-surface rounded-xl border p-6">
          <p className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
            Previous response
          </p>
          <p className="text-foreground text-sm leading-relaxed whitespace-pre-wrap">
            {row.admin_response}
          </p>
          {row.responded_at && (
            <p className="text-muted-foreground mt-2 text-xs">
              {new Date(row.responded_at).toLocaleDateString()}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

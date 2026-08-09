"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LayoutTemplate } from "lucide-react";
import { saveReportAsTemplate } from "@/lib/reports/actions";
import { showMutationError } from "@/lib/ui/mutation-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * "Save as template" for the report currently open in the builder.
 *
 * A template is a layout, not a document: it copies this report's config into
 * the org gallery with no board binding, so anyone can start a new report from
 * it. The name is asked for rather than derived — a template is browsed by
 * name in a shared list, and "Copy of Q3 Status Report" is not a name anyone
 * picks on purpose.
 *
 * It saves the config that is CURRENTLY STORED, so the dialog says so: unsaved
 * edits in the builder are not what gets captured.
 */
export function TemplateActions({
  reportId,
  reportName,
  disabled = false,
}: {
  reportId: string;
  reportName: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    start(async () => {
      const res = await saveReportAsTemplate({ reportId, name: name.trim() });
      if (!res.ok) {
        setError(res.error);
        showMutationError(
          "Couldn't save this report as a template.",
          new Error(res.error),
        );
        return;
      }
      setOpen(false);
      // A new row exists in the org's template gallery — server data changed,
      // so this refresh is warranted (unlike the builder's in-page toggles).
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setName(reportName);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled}>
          <LayoutTemplate data-icon="inline-start" />
          Save as template
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save as template</DialogTitle>
          <DialogDescription>
            Adds this report&apos;s saved layout to your organization&apos;s
            template gallery. It carries no board data — save the report first
            if you want recent edits included.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="template-name">Template name</Label>
            <Input
              id="template-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Weekly status layout"
              aria-invalid={error ? true : undefined}
              autoFocus
            />
          </div>
          {error ? (
            <p role="alert" className="text-destructive text-xs">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={pending || name.trim() === ""}>
              {pending ? "Saving…" : "Save template"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

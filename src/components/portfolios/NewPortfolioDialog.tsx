"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createPortfolio } from "@/lib/portfolios/actions";
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
import { FieldStatus, useFieldStatus } from "@/components/ui/field-status";
import { useRestoreFocusAfterPending } from "@/lib/hooks/use-restore-focus-after-pending";

export function NewPortfolioDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const nameStatus = useFieldStatus(error);
  // Only the failure path keeps this dialog mounted — which is exactly when
  // the submit button needs to reclaim the focus its own `disabled` dropped.
  const submitRef = useRestoreFocusAfterPending<HTMLButtonElement>(isPending);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createPortfolio({ name });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.push(`/portfolios/${res.data.portfolio.id}`);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm">
          <Plus className="size-4" />
          New portfolio
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New portfolio</DialogTitle>
          <DialogDescription>
            Name a portfolio to roll up boards across your org.
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
            <Label htmlFor="portfolio-name">Portfolio name</Label>
            <Input
              id="portfolio-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Q3 initiatives"
              {...nameStatus.controlProps}
              autoFocus
            />
          </div>
          <FieldStatus field={nameStatus} />
          <DialogFooter>
            <Button
              ref={submitRef}
              type="submit"
              disabled={isPending || !name.trim()}
            >
              {isPending ? "Creating…" : "Create portfolio"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

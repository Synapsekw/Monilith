"use client";

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores/ui";

export function AskPulseTrigger() {
  const setOpen = useUIStore((s) => s.setAskPulseOpen);

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setOpen(true)}
      className="text-muted-foreground gap-2"
    >
      <Sparkles className="size-4" />
      <span className="hidden sm:inline">Ask</span>
    </Button>
  );
}

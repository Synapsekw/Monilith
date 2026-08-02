"use client";

import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores/ui";

export function CommandTrigger() {
  const setOpen = useUIStore((s) => s.setCommandOpen);

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => setOpen(true)}
      className="text-muted-foreground gap-2"
    >
      <Search className="size-4" />
      <span className="hidden sm:inline">Search…</span>
      <kbd className="bg-muted text-3xs ml-2 hidden rounded border px-1.5 font-mono sm:inline">
        ⌘K
      </kbd>
    </Button>
  );
}

"use client";

import { Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { FeedbackPopover } from "./FeedbackPopover";

export function FeedbackButton() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground data-[state=open]:bg-state-selected data-[state=open]:text-foreground gap-1.5"
          aria-label="Open feedback"
        >
          <Megaphone className="size-4" />
          <span className="hidden text-xs sm:inline">Feedback</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-auto p-0">
        <FeedbackPopover />
      </PopoverContent>
    </Popover>
  );
}

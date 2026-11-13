import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";

/**
 * Smoothness guardrails for the modal primitives. jsdom renders no pixels, so
 * these pin the classes that decide the cost: a full-viewport backdrop blur
 * re-blurs the whole page on every frame of the scrim's fade, and a 300ms
 * ease-in-out slide makes the item panel feel late.
 */
function slot(name: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-slot="${name}"]`);
  if (!el) throw new Error(`no [data-slot="${name}"] in the document`);
  return el;
}

describe("modal overlays", () => {
  it("Dialog scrim has no backdrop blur and keeps the 50% scrim", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
          <DialogDescription>Body</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    const overlay = slot("dialog-overlay");
    expect(overlay.className).not.toContain("backdrop-blur");
    expect(overlay).toHaveClass("bg-black/50");
  });

  it("AlertDialog scrim has no backdrop blur and matches the Dialog scrim", () => {
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogTitle>Title</AlertDialogTitle>
          <AlertDialogDescription>Body</AlertDialogDescription>
        </AlertDialogContent>
      </AlertDialog>,
    );
    const overlay = slot("alert-dialog-overlay");
    expect(overlay.className).not.toContain("backdrop-blur");
    expect(overlay).toHaveClass("bg-black/50");
  });

  it("Sheet slides for 200ms on the keystone ease-out curve, scrim unblurred", () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Title</SheetTitle>
          <SheetDescription>Body</SheetDescription>
        </SheetContent>
      </Sheet>,
    );
    const content = slot("sheet-content");
    expect(content).toHaveClass("duration-200", "ease-keystone");
    expect(content.className).not.toContain("duration-300");
    expect(content.className).not.toContain("ease-in-out");
    expect(slot("sheet-overlay").className).not.toContain("backdrop-blur");
  });
});

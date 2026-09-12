import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";
import { NAME_FREEZE_EDGE } from "@/components/boards/SummaryRow";

// Root cause this guards: tailwind-merge 3.6.0 classifies the project's
// custom `text-cell` / `text-item` utilities (custom `--text-*` theme keys,
// meant to set font-size) as belonging to the text-COLOR group, not
// font-size — custom `--text-*` theme keys are invisible to twMerge's
// size-group detection. So if a size token like `text-cell`/`text-item` and
// a color class like `text-foreground` are ever passed into the SAME cn()
// call, twMerge treats them as conflicting members of one group and keeps
// only the last one, silently deleting the other (proof:
// twMerge("text-foreground text-cell") === "text-cell", and reversed,
// twMerge("text-cell text-foreground") === "text-foreground"). This broke
// TimeTrackingCell's collapsed-trigger cell (rendered at inherited ~14px
// instead of 13px) and GroupHeaderRow's group-name cell (rendered muted grey
// instead of full foreground). The fix keeps the size token OUT of cn()
// entirely, composing it as a separate plain className. This test
// reproduces each call site's real className composition (including the
// real cn() arguments) and asserts BOTH the size token and the color class
// survive in the final merged className string.
describe("text-cell / text-item survive className composition (tailwind-merge text-color misclassification guard)", () => {
  it("TimeTrackingCell collapsed trigger: text-cell size token + text-foreground color both present", () => {
    const isEmpty = false;
    const className = `text-cell ${cn(
      "flex items-center gap-1 rounded px-1 py-0.5 transition-colors",
      "hover:bg-state-hover focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
      isEmpty && "text-muted-foreground/40",
      !isEmpty && "text-foreground",
    )}`;

    expect(className.split(/\s+/)).toContain("text-cell");
    expect(className.split(/\s+/)).toContain("text-foreground");
  });

  it("GroupHeaderRow frozen Name cell: text-item size token + text-foreground color both present", () => {
    const className = `text-item ${cn(
      "bg-surface text-foreground relative sticky left-0 z-10 flex items-center gap-2 px-4 pt-3.5 pb-2.5 font-semibold",
      NAME_FREEZE_EDGE,
    )}`;

    expect(className.split(/\s+/)).toContain("text-item");
    expect(className.split(/\s+/)).toContain("text-foreground");
  });
});

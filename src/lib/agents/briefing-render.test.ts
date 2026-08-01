import { describe, it, expect } from "vitest";
import { renderBriefingHtml, renderBriefingText } from "./briefing-render";
import type { Briefing } from "./briefing";

const briefing: Briefing = {
  today: "2026-08-01",
  totals: { overdue: 1, today: 0, week: 0 },
  groups: [
    {
      bucket: "overdue",
      label: "Overdue",
      items: [
        {
          itemId: "i1",
          itemName: "<script>alert(1)</script>",
          boardId: "b1",
          boardName: "Sprint 24",
          groupName: null,
          status: null,
          dueDate: "2026-07-30",
        },
      ],
    },
  ],
};

const input = {
  agentName: "Morning Brief",
  briefing,
  appBaseUrl: "https://app.example.com",
  unsubscribeUrl: "https://app.example.com/api/digest/unsubscribe?uid=u&sig=s",
  summary: "One item is overdue.",
};

describe("renderBriefingHtml", () => {
  it("escapes user-provided item names", () => {
    const html = renderBriefingHtml(input);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("includes the agent name and the unsubscribe url", () => {
    const html = renderBriefingHtml(input);
    expect(html).toContain("Morning Brief");
    expect(html).toContain(input.unsubscribeUrl);
  });

  it("includes the model summary", () => {
    expect(renderBriefingHtml(input)).toContain("One item is overdue.");
  });
});

describe("renderBriefingText", () => {
  it("renders a plain-text alternative with the bucket label", () => {
    const text = renderBriefingText(input);
    expect(text).toContain("Overdue");
    expect(text).toContain("Sprint 24");
    expect(text).not.toContain("<td");
  });
});

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

const threadUrl = "https://app.example.com/ask/conv-1";

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

  it("omits the thread link entirely when no threadUrl is given", () => {
    const html = renderBriefingHtml(input);
    expect(html).not.toContain("Open this briefing");
  });

  it("renders an 'Open this briefing' link, before 'Open My Work' and separated by &middot;, when a threadUrl is given", () => {
    const html = renderBriefingHtml({ ...input, threadUrl });

    const linkHtml = `<a href="${threadUrl}" style="color:#5b6fd6;">Open this briefing</a>`;
    expect(html).toContain(linkHtml);

    // Placement: thread link, then a &middot; separator, then "Open My Work".
    const threadIdx = html.indexOf(linkHtml);
    const separatorIdx = html.indexOf("&middot;", threadIdx);
    const myWorkIdx = html.indexOf("Open My Work", separatorIdx);
    expect(threadIdx).toBeGreaterThan(-1);
    expect(separatorIdx).toBeGreaterThan(threadIdx);
    expect(myWorkIdx).toBeGreaterThan(separatorIdx);
  });

  it("adding a threadUrl changes nothing else — removing the inserted link recovers the no-link output exactly", () => {
    const withLink = renderBriefingHtml({ ...input, threadUrl });
    const withoutLink = renderBriefingHtml(input);
    const inserted = `<a href="${threadUrl}" style="color:#5b6fd6;">Open this briefing</a>\n    &middot; `;

    expect(withLink.replace(inserted, "")).toBe(withoutLink);
  });
});

describe("renderBriefingText", () => {
  it("renders a plain-text alternative with the bucket label", () => {
    const text = renderBriefingText(input);
    expect(text).toContain("Overdue");
    expect(text).toContain("Sprint 24");
    expect(text).not.toContain("<td");
  });

  it("omits the thread link line entirely when no threadUrl is given", () => {
    const text = renderBriefingText(input);
    expect(text).not.toContain("Open this briefing");
  });

  it("adds an 'Open this briefing: <url>' line directly before the Unsubscribe line when a threadUrl is given", () => {
    const text = renderBriefingText({ ...input, threadUrl });
    const lines = text.split("\n");

    const unsubscribeIdx = lines.findIndex((l) => l.startsWith("Unsubscribe:"));
    expect(unsubscribeIdx).toBeGreaterThan(0);
    expect(lines[unsubscribeIdx - 1]).toBe(`Open this briefing: ${threadUrl}`);
  });

  it("adding a threadUrl changes nothing else — removing the inserted line recovers the no-link output exactly", () => {
    const withLink = renderBriefingText({ ...input, threadUrl });
    const withoutLink = renderBriefingText(input);

    expect(withLink.replace(`Open this briefing: ${threadUrl}\n`, "")).toBe(
      withoutLink,
    );
  });
});

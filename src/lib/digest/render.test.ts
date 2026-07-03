import { describe, expect, it } from "vitest";
import { renderDigestHtml, renderDigestText } from "@/lib/digest/render";

const input = {
  orgName: "Acme <Inc>",
  periodStart: "2026-06-29",
  totals: { newCount: 4, incompleteCount: 3, overdueCount: 2 },
  boards: [
    {
      boardId: "11111111-1111-1111-1111-111111111111",
      boardName: "Launch <plan>",
      totalItems: 10,
      doneItems: 4,
      overdueItems: 2,
      incompleteItems: 3,
      newItems: 1,
      newSample: ["Kickoff & scope"],
      incompleteSample: ["Design <review>"],
    },
  ],
  appBaseUrl: "https://pulse.example.com",
  unsubscribeUrl:
    "https://pulse.example.com/api/digest/unsubscribe?uid=u&sig=s",
};

describe("renderDigestHtml", () => {
  it("contains totals, board rows, and both links", () => {
    const html = renderDigestHtml(input);
    expect(html).toContain("4"); // new
    expect(html).toContain("Launch &lt;plan&gt;"); // escaped board name
    expect(html).toContain("Kickoff &amp; scope"); // escaped item name
    expect(html).toContain(input.unsubscribeUrl);
    expect(html).toContain("https://pulse.example.com/dashboards");
    expect(html).not.toContain("<plan>"); // no raw user HTML
  });
});

describe("renderDigestText", () => {
  it("lists totals and board names in plain text", () => {
    const text = renderDigestText(input);
    expect(text).toContain("Launch <plan>"); // plain text, unescaped
    expect(text).toContain("2 overdue");
    expect(text).toContain(input.unsubscribeUrl);
  });
});

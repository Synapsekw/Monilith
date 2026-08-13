import { describe, it, expect } from "vitest";
import { renderBriefingHtml, renderBriefingText } from "./briefing-render";

const input = {
  agentName: "Morning Brief",
  today: "2026-08-01",
  summary: "One item is overdue.",
  proposalCount: 0,
  appBaseUrl: "https://app.example.com",
  unsubscribeUrl: "https://app.example.com/api/digest/unsubscribe?uid=u&sig=s",
};

const threadUrl = "https://app.example.com/ask/conv-1";

describe("renderBriefingHtml", () => {
  // The summary is MODEL output over item names authored by other people, so
  // it is untrusted for exactly the same reason the old item table was.
  it("escapes the model-written summary", () => {
    const html = renderBriefingHtml({
      ...input,
      summary: "<script>alert(1)</script>",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes the agent name", () => {
    const html = renderBriefingHtml({ ...input, agentName: "<b>Bold</b>" });
    expect(html).not.toContain("<b>Bold</b>");
    expect(html).toContain("&lt;b&gt;Bold&lt;/b&gt;");
  });

  it("includes the agent name, the date and the unsubscribe url", () => {
    const html = renderBriefingHtml(input);
    expect(html).toContain("Morning Brief");
    expect(html).toContain("2026-08-01");
    expect(html).toContain(input.unsubscribeUrl);
  });

  it("includes the model summary", () => {
    expect(renderBriefingHtml(input)).toContain("One item is overdue.");
  });

  // Verbatim copy from the spec. An owner who never reads this line never
  // discovers the proposal queue.
  it("carries the approval line verbatim when actions are pending", () => {
    const html = renderBriefingHtml({ ...input, proposalCount: 3 });
    expect(html).toContain(
      "<strong>3 actions await your approval.</strong> Open the run in Settings → Agents to review them.",
    );
  });

  it("omits the approval block entirely at zero", () => {
    const html = renderBriefingHtml(input);
    expect(html).not.toContain("await your approval");
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
  it("renders a plain-text alternative with no markup", () => {
    const text = renderBriefingText(input);
    expect(text).toContain("Morning Brief — briefing for 2026-08-01");
    expect(text).toContain("One item is overdue.");
    expect(text).not.toContain("<td");
    expect(text).not.toContain("<p");
  });

  it("carries the SAME approval sentence as the HTML", () => {
    const text = renderBriefingText({ ...input, proposalCount: 3 });
    expect(text).toContain(
      "3 actions await your approval. Open the run in Settings → Agents to review them.",
    );
  });

  it("omits the approval line at zero", () => {
    expect(renderBriefingText(input)).not.toContain("await your approval");
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

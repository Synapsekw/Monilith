import { describe, expect, it } from "vitest";
import { inviteNoticeHeadline, renderInviteNotice } from "./invite-notice";

const BASE = "https://app.example.com";

describe("inviteNoticeHeadline", () => {
  it("names the inviter, the folder and the org", () => {
    expect(
      inviteNoticeHeadline({
        inviterName: "Ann",
        orgName: "Acme",
        folderName: "Launch",
        appBaseUrl: BASE,
      }),
    ).toBe("Ann invited you to the folder Launch in Acme");
  });

  it("drops the folder for an org invitation", () => {
    expect(
      inviteNoticeHeadline({
        inviterName: "Ann",
        orgName: "Acme",
        appBaseUrl: BASE,
      }),
    ).toBe("Ann invited you to Acme");
  });

  it("stays readable with nothing known", () => {
    expect(inviteNoticeHeadline({ appBaseUrl: BASE })).toBe(
      "Someone invited you to an organization",
    );
  });
});

describe("renderInviteNotice", () => {
  it("links to the app and never to a one-time token", () => {
    const m = renderInviteNotice({
      inviterName: "Ann",
      orgName: "Acme",
      folderName: "Launch",
      appBaseUrl: BASE,
    });
    expect(m.subject).toBe("Ann invited you to the folder Launch in Acme");
    expect(m.html).toContain('href="https://app.example.com/home"');
    expect(m.text).toContain("https://app.example.com/home");
    expect(m.html).not.toContain("token");
    expect(m.html).toContain("MONOLITH");
    expect(m.html).not.toMatch(/Pulse/);
  });

  it("escapes names a person controls", () => {
    const m = renderInviteNotice({
      inviterName: '<img src=x onerror="alert(1)">',
      orgName: "A&B",
      folderName: "<b>x</b>",
      appBaseUrl: BASE,
    });
    expect(m.html).not.toContain("<img src=x");
    expect(m.html).not.toContain("<b>x</b>");
    expect(m.html).toContain("A&amp;B");
    expect(m.html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});

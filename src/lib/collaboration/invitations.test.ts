import { describe, expect, it } from "vitest";
import {
  invitationAcceptedMessage,
  invitationDestination,
  invitationSummary,
} from "./invitations";

const base = { org_name: "Acme", role: "guest" as const };

describe("invitationSummary", () => {
  it("names the inviter, the folder and the org for a folder invite", () => {
    expect(
      invitationSummary({
        ...base,
        inviter_name: "Ann",
        folder_name: "Launch",
        folder_count: 1,
      }),
    ).toBe("Ann invited you to the folder Launch in Acme");
  });

  it("says there are more folders when the invite carries several", () => {
    expect(
      invitationSummary({
        ...base,
        inviter_name: "Ann",
        folder_name: "Launch",
        folder_count: 3,
      }),
    ).toBe("Ann invited you to the folder Launch and 2 more in Acme");
  });

  it("does not invent an inviter for a folder invite without one", () => {
    expect(
      invitationSummary({ ...base, inviter_name: null, folder_name: "Launch" }),
    ).toBe("Someone invited you to the folder Launch in Acme");
  });

  it("falls back to org and role for an org invitation", () => {
    expect(
      invitationSummary({ ...base, role: "member", inviter_name: "Ann" }),
    ).toBe("Ann invited you to Acme as member");
  });

  it("keeps the original wording when no context is available (migration not applied)", () => {
    expect(invitationSummary({ ...base, role: "member" })).toBe(
      "You've been invited to Acme as member",
    );
  });
});

describe("invitationDestination", () => {
  it("is the folder for a folder invite", () => {
    expect(invitationDestination({ folder_id: "f-1" })).toBe("/folders/f-1");
  });
  it("is the app entry otherwise", () => {
    expect(invitationDestination({ folder_id: null })).toBe("/");
    expect(invitationDestination({})).toBe("/");
  });
});

describe("invitationAcceptedMessage", () => {
  it("names the folder when there is one", () => {
    expect(invitationAcceptedMessage({ ...base, folder_name: "Launch" })).toBe(
      "You now have access to the folder Launch in Acme",
    );
  });
  it("names the org otherwise", () => {
    expect(invitationAcceptedMessage(base)).toBe("You joined Acme");
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { NotificationsList } from "@/components/notifications/NotificationsList";
import type { AppNotification } from "@/lib/collaboration/notifications-cache";

function notif(over: Partial<AppNotification>): AppNotification {
  return {
    id: "n1",
    actor_id: "a1",
    automation_id: null,
    board_id: "b1",
    created_at: new Date().toISOString(),
    item_id: "i1",
    kind: "mention",
    org_id: "o1",
    read_at: null,
    recipient_id: "r1",
    update_id: null,
    ...over,
  } as AppNotification;
}

describe("NotificationsList", () => {
  it("renders an empty state when there are no notifications", () => {
    render(<NotificationsList notifications={[]} onOpen={() => {}} />);
    expect(screen.getByText(/no notifications/i)).toBeInTheDocument();
  });

  it.each([
    ["mention", /mentioned you in an update/i],
    ["assigned", /assigned you to an item/i],
    ["update_on_item", /updated an item you follow/i],
    ["automation", /an automation ran on an item/i],
    ["feedback_response", /updated your feedback request/i],
  ] as const)("renders the %s kind", (kind, matcher) => {
    render(
      <NotificationsList
        notifications={[notif({ id: kind, kind })]}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText(matcher)).toBeInTheDocument();
  });

  it("empty state uses the standardized EmptyState", () => {
    render(<NotificationsList notifications={[]} onOpen={() => {}} />);
    const empty = screen.getByText(/no notifications/i);
    expect(empty.className).toContain("py-8");
    expect(empty.className).toContain("text-muted-foreground");
  });

  it("rows keep the dot slot when read so text aligns", () => {
    render(
      <NotificationsList
        notifications={[notif({ read_at: new Date().toISOString() })]}
        onOpen={() => {}}
      />,
    );
    const row = screen.getByRole("button");
    const dot = row.querySelector("span.size-2");
    expect(dot).toBeTruthy();
    expect(dot!.className).toContain("bg-transparent");
  });

  it("still marks the unread dot with the brand color and a label", () => {
    render(
      <NotificationsList
        notifications={[notif({ read_at: null })]}
        onOpen={() => {}}
      />,
    );
    const dot = screen.getByLabelText("unread");
    expect(dot.className).toContain("bg-primary");
  });

  it("row button has hover transition and branded focus ring", () => {
    render(
      <NotificationsList
        notifications={[notif({ read_at: new Date().toISOString() })]}
        onOpen={() => {}}
      />,
    );
    const row = screen.getByRole("button");
    expect(row.className).toContain("transition-colors");
    expect(row.className).toContain("focus-visible:ring");
  });

  it("invokes onOpen with the notification when a row is clicked", () => {
    const onOpen = vi.fn();
    const n = notif({ id: "auto-1", kind: "automation" });
    render(<NotificationsList notifications={[n]} onOpen={onOpen} />);
    fireEvent.click(screen.getByText(/an automation ran on an item/i));
    expect(onOpen).toHaveBeenCalledWith(n);
  });
});

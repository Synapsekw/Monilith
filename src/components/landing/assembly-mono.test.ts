import { act, fireEvent, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountMono } from "./assembly-mono";
import { createHttpTransport } from "./assembly-mono/core";

let dispose: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  HTMLDialogElement.prototype.show = function () {
    this.open = true;
    this.style.display = "block";
  };
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
    this.style.display = "block";
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.style.display = "none";
  };
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function landing() {
  const root = document.createElement("div");
  root.innerHTML = '<dialog class="screen-dialog"></dialog>';
  document.body.append(root);
  dispose = mountMono(root);
  return {
    root,
    host: root.querySelector<HTMLElement>("#mono-widget")!,
    viewer: root.querySelector("dialog")!,
  };
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("Mono landing integration", () => {
  it("uses decorative vectors for welcome and send arrows", () => {
    const { host } = landing();
    const shadow = host.shadowRoot!;
    expect(shadow.querySelector(".mono-prompts")?.textContent).not.toContain(
      "↗",
    );
    expect(
      shadow.querySelectorAll('.mono-prompt svg[aria-hidden="true"]'),
    ).toHaveLength(3);
    expect(
      shadow.querySelector('.mono-send svg[aria-hidden="true"]'),
    ).not.toBeNull();
  });
  it.each([
    "older assistant offer",
    "latest assistant offer",
    "Contact the team",
  ])(
    "%s prefills the latest conversation details and sends only the edited, explicitly confirmed review",
    async (entry) => {
      const draft = {
        name: "Avery Visitor",
        phone: "+971501234567",
        email: "avery@example.com",
        reason: "Discuss a team workspace",
        company: "Example Studio",
        preferred_time: "Thursday afternoon",
        timezone: "Dubai (UTC+4)",
      };
      const fetcher = vi
        .fn<typeof fetch>()
        .mockImplementation(async (input, options) => {
          const action = new URL(String(input)).searchParams.get("action");
          if (action === "chat") {
            return Response.json({
              reply: "Your details are ready to review.",
              contact_request: draft,
            });
          }
          if (action === "callback") {
            const body = JSON.parse(String(options?.body));
            return Response.json({
              delivery: "accepted",
              reply: "Request submitted for review.",
              request_id: body.request_id,
            });
          }
          return Response.json({
            mode: "live",
            token: "test-token",
            callbacks_enabled: true,
            reporting_enabled: false,
            history: [
              {
                role: "assistant",
                content: "Earlier details.",
                contact_request: {
                  ...draft,
                  email: "earlier@example.com",
                  reason: "Earlier request",
                },
              },
            ],
          });
        });
      vi.stubGlobal("fetch", fetcher);
      const { host } = landing();
      const ui = within(host.shadowRoot!.querySelector("div")!);
      fireEvent.click(
        ui.getByRole("button", { hidden: true, name: /Ask Mono/ }),
      );
      await settle();
      fireEvent.input(ui.getByLabelText("Ask Mono about Monolith"), {
        target: {
          value:
            "Use avery@example.com and Thursday afternoon for the team workspace discussion.",
        },
      });
      fireEvent.submit(host.shadowRoot!.querySelector(".mono-form")!);
      await settle();
      const callbacks = () =>
        fetcher.mock.calls.filter(([url]) =>
          String(url).includes("action=callback"),
        );
      expect(callbacks()).toHaveLength(0);
      const offers = ui.getAllByRole("button", {
        hidden: true,
        name: "Review contact details",
      });
      expect(offers).toHaveLength(2);
      fireEvent.click(
        entry.includes("assistant offer")
          ? offers[entry === "older assistant offer" ? 0 : 1]
          : ui.getByRole("button", { hidden: true, name: "Contact the team" }),
      );
      for (const [label, value] of Object.entries({
        "Your name": "Avery Visitor",
        "Phone with country code": "+971501234567",
        Email: "avery@example.com",
        "What would you like to discuss?": "Discuss a team workspace",
        Company: "Example Studio",
        "Preferred time": "Thursday afternoon",
        "Time zone": "Dubai (UTC+4)",
      }))
        expect(ui.getByLabelText(label)).toHaveValue(value);
      fireEvent.change(ui.getByLabelText("Company"), {
        target: { value: "Reviewed Studio" },
      });
      fireEvent.change(ui.getByLabelText("Preferred time"), {
        target: { value: "Friday afternoon" },
      });
      fireEvent.click(
        ui.getByRole("button", { hidden: true, name: "Review request" }),
      );
      expect(ui.getByText("avery@example.com")).toBeInTheDocument();
      expect(ui.getByText("Discuss a team workspace")).toBeInTheDocument();
      expect(ui.getByText("Reviewed Studio")).toBeInTheDocument();
      expect(ui.getByText("Friday afternoon")).toBeInTheDocument();
      const send = ui.getByRole("button", {
        hidden: true,
        name: "Confirm & send",
      });
      expect(send).toBeDisabled();
      expect(callbacks()).toHaveLength(0);
      fireEvent.click(ui.getByRole("checkbox", { hidden: true }));
      expect(send).toBeEnabled();
      expect(callbacks()).toHaveLength(0);
      fireEvent.click(send);
      await settle();
      expect(callbacks()).toHaveLength(1);
      expect(JSON.parse(String(callbacks()[0][1]?.body))).toMatchObject({
        confirmed: true,
        lead: {
          name: "Avery Visitor",
          phone: "+971501234567",
          email: "avery@example.com",
          reason: "Discuss a team workspace",
          company: "Reviewed Studio",
          preferred_time: "Friday afternoon",
          timezone: "Dubai (UTC+4)",
        },
      });
      expect(ui.getByText("Request submitted.")).toBeInTheDocument();
      fireEvent.click(
        ui.getByRole("button", { hidden: true, name: "Back to chat" }),
      );
      fireEvent.click(
        ui.getByRole("button", { hidden: true, name: "New conversation" }),
      );
      await settle();
      fireEvent.click(
        ui.getByRole("button", { hidden: true, name: "Contact the team" }),
      );
      expect(ui.getByLabelText("Your name")).toHaveValue("");
      expect(ui.getByLabelText("Email")).toHaveValue("");
    },
  );

  it("uses the public endpoint once, offers a local guide and yields to the screenshot viewer", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ mode: "preview" }));
    vi.stubGlobal("fetch", fetcher);
    const { root, host, viewer } = landing();
    // jsdom caches the closed native dialog style inside Shadow DOM.
    // Browser QA covers visibility; these checks assert open state and behavior.
    const ui = within(host.shadowRoot!.querySelector("div")!);
    fireEvent.click(ui.getByRole("button", { hidden: true, name: /Ask Mono/ }));
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toContain("/api/mono?action=status");
    expect(host.shadowRoot!.querySelector("dialog")).toHaveAttribute("open");
    expect(ui.getByText("Site guide")).toBeInTheDocument();
    fireEvent.click(
      ui.getByRole("button", { hidden: true, name: /Show me the workspace/ }),
    );
    await settle();
    expect(
      ui
        .getByRole("link", { hidden: true, name: /Explore the workspace/ })
        .getAttribute("href"),
    ).toMatch(/#product$/);
    viewer.open = true;
    await settle();
    expect(host.hidden).toBe(true);
    expect(host.shadowRoot!.querySelector("dialog")).not.toHaveAttribute(
      "open",
    );
    viewer.open = false;
    await settle();
    expect(host.hidden).toBe(false);
    dispose!();
    dispose = undefined;
    expect(root.querySelector("#mono-widget")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([400, 403, 415, 429])(
    "keeps reviewed details after a definite %s rejection and requires fresh confirmation before retrying",
    async (status) => {
      const lead = {
        name: "Test visitor",
        phone: "+971501234567",
        email: "visitor@example.com",
        reason: "Workspace setup",
        company: "Reviewed company",
        preferred_time: "Friday afternoon",
        timezone: "Dubai (UTC+4)",
      };
      let attempts = 0;
      let connections = 0;
      const delivered: unknown[] = [];
      const fetcher = vi
        .fn<typeof fetch>()
        .mockImplementation(async (input, options) => {
          const action = new URL(String(input)).searchParams.get("action");
          if (action === "callback") {
            attempts += 1;
            if (attempts === 1)
              return Response.json(
                { error: "Request rejected before dispatch" },
                { status },
              );
            const body = JSON.parse(String(options?.body));
            delivered.push(body.lead);
            return Response.json({
              delivery: "accepted",
              reply: "Request submitted.",
              request_id: body.request_id,
            });
          }
          connections += 1;
          if (status === 403 && connections === 2)
            return Response.json(
              { error: "Temporarily unavailable" },
              { status: 503 },
            );
          return Response.json({
            mode: "live",
            token: connections === 1 ? "expired-token" : "fresh-token",
            callbacks_enabled: true,
            history:
              connections === 1
                ? [
                    {
                      role: "assistant",
                      content: "Review your details.",
                      contact_request: { ...lead, company: "Earlier company" },
                    },
                  ]
                : [],
          });
        });
      vi.stubGlobal("fetch", fetcher);
      const { host } = landing();
      const ui = within(host.shadowRoot!.querySelector("div")!);
      const click = (name: string) =>
        fireEvent.click(ui.getByRole("button", { hidden: true, name }));
      fireEvent.click(
        ui.getByRole("button", { hidden: true, name: /Ask Mono/ }),
      );
      await settle();
      click("Contact the team");
      fireEvent.change(ui.getByLabelText("Company"), {
        target: { value: lead.company },
      });
      click("Review request");
      fireEvent.click(ui.getByRole("checkbox", { hidden: true }));
      click("Confirm & send");
      await settle();
      expect(attempts).toBe(1);
      expect(delivered).toHaveLength(0);
      expect(
        ui.getByRole("heading", { hidden: true, name: "Request not sent." }),
      ).toBeInTheDocument();
      expect(
        ui.queryByRole("button", { hidden: true, name: "Check delivery" }),
      ).toBeNull();
      click("Back to chat");
      expect(
        ui.getByRole("button", { hidden: true, name: "New conversation" }),
      ).toBeEnabled();
      expect(
        ui.getByRole("button", { hidden: true, name: "Contact the team" }),
      ).not.toHaveAttribute("hidden");
      click("Contact the team");
      const recovery =
        status === 403 ? "Reconnect & review" : "Review and retry";
      click(recovery);
      await settle();
      if (status === 403) {
        expect(
          ui.getByText(
            "Couldn’t reconnect. Your details are saved here. Please try again.",
          ),
        ).toBeInTheDocument();
        expect(attempts).toBe(1);
        click(recovery);
        await settle();
      }
      expect(attempts).toBe(1);
      expect(ui.getByRole("checkbox", { hidden: true })).not.toBeChecked();
      expect(
        ui.getByRole("button", { hidden: true, name: "Confirm & send" }),
      ).toBeDisabled();
      expect(ui.getByText(lead.company)).toBeInTheDocument();
      click("Edit details");
      for (const [label, value] of Object.entries({
        "Your name": lead.name,
        "Phone with country code": lead.phone,
        Email: lead.email,
        "What would you like to discuss?": lead.reason,
        Company: lead.company,
        "Preferred time": lead.preferred_time,
        "Time zone": lead.timezone,
      }))
        expect(ui.getByLabelText(label)).toHaveValue(value);
      click("Review request");
      expect(ui.getByRole("checkbox", { hidden: true })).not.toBeChecked();
      expect(
        ui.getByRole("button", { hidden: true, name: "Confirm & send" }),
      ).toBeDisabled();
      fireEvent.click(ui.getByRole("checkbox", { hidden: true }));
      expect(attempts).toBe(1);
      expect(delivered).toHaveLength(0);
      click("Confirm & send");
      await settle();
      expect(attempts).toBe(2);
      expect(delivered).toEqual([lead]);
      const retry = fetcher.mock.calls.filter(([url]) =>
        String(url).includes("action=callback"),
      )[1];
      expect(retry[1]?.headers).toMatchObject({
        "X-Mono-Token": status === 403 ? "fresh-token" : "expired-token",
      });
      expect(JSON.parse(String(retry[1]?.body))).toMatchObject({
        confirmed: true,
        lead,
      });
      expect(
        ui.getByRole("heading", { hidden: true, name: "Request submitted." }),
      ).toBeInTheDocument();
    },
  );

  it.each(["unknown receipt", "network failure", 409, 500, 503])(
    "requires review and explicit consent; %s can only check delivery",
    async (failure) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockImplementation(async (input) => {
          const action = new URL(String(input)).searchParams.get("action");
          if (action === "callback") {
            if (failure === "network failure")
              throw new TypeError("Failed to fetch");
            if (typeof failure === "number")
              return Response.json(
                { error: "Delivery is uncertain" },
                { status: failure },
              );
            return Response.json({
              delivery: "unknown",
              reply: "Delivery not confirmed.",
              request_id: "receipt-1",
            });
          }
          return Response.json({
            mode: "live",
            token: "test-token",
            callbacks_enabled: true,
            reporting_enabled: false,
            history: [],
          });
        });
      vi.stubGlobal("fetch", fetcher);
      const { host } = landing();
      // jsdom caches the closed native dialog style inside Shadow DOM.
      // Browser QA covers visibility; these checks assert open state and behavior.
      const ui = within(host.shadowRoot!.querySelector("div")!);
      fireEvent.click(
        ui.getByRole("button", { hidden: true, name: /Ask Mono/ }),
      );
      await settle();
      fireEvent.click(
        ui.getByRole("button", { hidden: true, name: "Contact the team" }),
      );
      fireEvent.change(ui.getByLabelText("Your name"), {
        target: { value: "Test visitor" },
      });
      fireEvent.change(ui.getByLabelText("Email"), {
        target: { value: "visitor@example.com" },
      });
      fireEvent.change(ui.getByLabelText("What would you like to discuss?"), {
        target: { value: "Workspace setup" },
      });
      fireEvent.click(ui.getByRole("button", { hidden: true, name: /Review/ }));
      const send = ui.getByRole("button", {
        hidden: true,
        name: "Confirm & send",
      });
      expect(send).toBeDisabled();
      expect(
        fetcher.mock.calls.filter(([url]) =>
          String(url).includes("action=callback"),
        ),
      ).toHaveLength(0);
      fireEvent.click(ui.getByRole("checkbox", { hidden: true }));
      fireEvent.click(send);
      await settle();
      const callback = fetcher.mock.calls.find(([url]) =>
        String(url).includes("action=callback"),
      )!;
      expect(JSON.parse(String(callback[1]?.body))).toMatchObject({
        confirmed: true,
        lead: { name: "Test visitor", email: "visitor@example.com" },
      });
      expect(
        ui.queryByRole("button", { hidden: true, name: "Confirm & send" }),
      ).toBeNull();
      expect(
        ui.getByRole("button", { hidden: true, name: "New conversation" }),
      ).toBeDisabled();
      fireEvent.click(
        ui.getByRole("button", { hidden: true, name: "Check delivery" }),
      );
      await settle();
      expect(
        fetcher.mock.calls.filter(([url]) =>
          String(url).includes("action=callback"),
        ),
      ).toHaveLength(1);
      expect(fetcher.mock.calls.at(-1)?.[0]).toContain("action=status");
    },
  );

  it("clears pending requests and all timers on navigation away", async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation((_input, options) => {
        signals.push(options!.signal!);
        return new Promise<Response>(() => {});
      }),
    );
    const { host } = landing();
    fireEvent.click(
      within(host.shadowRoot!.querySelector("div")!).getByRole("button", {
        name: /Ask Mono/,
      }),
    );
    await settle();
    dispose!();
    dispose = undefined;
    expect(signals[0].aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("Mono transport", () => {
  it("keeps retry identity and CSRF token in same-origin requests then blocks sends after expiry", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ mode: "live", token: "first" }))
      .mockResolvedValueOnce(Response.json({ reply: "Hello" }))
      .mockResolvedValueOnce(
        Response.json({ error: "Session expired" }, { status: 403 }),
      );
    const transport = createHttpTransport({
      base: "https://preview.example/landing",
      fetch: fetcher,
    });
    await expect(transport.respond("hi")).rejects.toThrow("Reconnect");
    await transport.connect();
    await transport.respond("hello", {
      requestId: "same-id",
      page: "/landing",
    });
    await expect(
      transport.respond("hello", { requestId: "same-id", page: "/landing" }),
    ).rejects.toThrow("Session expired");
    const request = fetcher.mock.calls[1];
    expect(request[0]).toBe("https://preview.example/api/mono?action=chat");
    expect(request[1]).toMatchObject({
      credentials: "same-origin",
      cache: "no-store",
      headers: { "X-Mono-Token": "first" },
    });
    expect(JSON.parse(String(request[1]?.body))).toMatchObject({
      request_id: "same-id",
    });
    await expect(transport.respond("again")).rejects.toThrow("Reconnect");
    expect(() =>
      createHttpTransport({
        base: "https://preview.example/",
        endpoint: "https://other.example/api/mono",
      }),
    ).toThrow("same-origin");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";
import { offlineRecoveryKey } from "@/lib/offline/constants";
import { OfflineNavigationGuard } from "./OfflineNavigationGuard";

/**
 * `window.location` is configurable in jsdom (its own properties are not), so
 * the whole object is swapped for a stub and restored afterwards. That gives us
 * a spyable `assign` AND lets each test claim a current URL without navigating.
 */
const ORIGINAL_LOCATION = Object.getOwnPropertyDescriptor(
  window,
  "location",
) as PropertyDescriptor;
const ORIGIN = new URL(document.baseURI).origin;

let assign: ReturnType<typeof vi.fn>;

function stubLocation(path: string): void {
  const url = new URL(path, ORIGIN);
  assign = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: {
      href: url.href,
      origin: url.origin,
      protocol: url.protocol,
      host: url.host,
      hostname: url.hostname,
      port: url.port,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      assign,
      replace: vi.fn(),
      reload: vi.fn(),
      toString: () => url.href,
    },
  });
}

function link(attrs: Record<string, string>, inner = "Go"): HTMLAnchorElement {
  const a = document.createElement("a");
  for (const [key, value] of Object.entries(attrs)) a.setAttribute(key, value);
  a.innerHTML = inner;
  document.body.appendChild(a);
  return a;
}

/**
 * Dispatch a click and report whether the guard claimed it. The bubble-phase
 * observer runs after every capture listener, so it reads the final verdict —
 * and then prevents the default itself, which stops jsdom from logging "Not
 * implemented: navigation to another Document" for every click we deliberately
 * leave to the browser.
 */
function click(target: Element, init: MouseEventInit = {}): boolean {
  let prevented = false;
  const observe = (event: Event) => {
    prevented = event.defaultPrevented;
    event.preventDefault();
  };
  document.addEventListener("click", observe);
  try {
    target.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
        ...init,
      }),
    );
  } finally {
    document.removeEventListener("click", observe);
  }
  return prevented;
}

describe("OfflineNavigationGuard", () => {
  beforeEach(() => {
    stubLocation("/boards/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });

  afterEach(() => {
    onlineManager.setOnline(true);
    Object.defineProperty(window, "location", ORIGINAL_LOCATION);
    document.querySelectorAll("a").forEach((a) => a.remove());
  });

  it("offline: turns an in-app link click into a document navigation", () => {
    onlineManager.setOnline(false);
    render(<OfflineNavigationGuard />);

    expect(click(link({ href: "/boards/bbbb" }))).toBe(true);

    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith(`${ORIGIN}/boards/bbbb`);
  });

  it("offline: intercepts a click that starts on a child of the link", () => {
    onlineManager.setOnline(false);
    render(<OfflineNavigationGuard />);

    const anchor = link({ href: "/goals" }, "<span>Goals</span>");

    expect(click(anchor.querySelector("span") as Element)).toBe(true);
    expect(assign).toHaveBeenCalledWith(`${ORIGIN}/goals`);
  });

  it("offline: preserves the query string of the target link", () => {
    onlineManager.setOnline(false);
    render(<OfflineNavigationGuard />);

    click(link({ href: "/boards/bbbb?view=kanban" }));

    expect(assign).toHaveBeenCalledWith(`${ORIGIN}/boards/bbbb?view=kanban`);
  });

  it("offline: leaves modified clicks to the browser", () => {
    onlineManager.setOnline(false);
    render(<OfflineNavigationGuard />);
    const anchor = link({ href: "/boards/bbbb" });

    for (const modifier of ["metaKey", "ctrlKey", "shiftKey", "altKey"]) {
      expect(click(anchor, { [modifier]: true })).toBe(false);
    }
    expect(assign).not.toHaveBeenCalled();
  });

  it("offline: leaves non-primary-button clicks to the browser", () => {
    onlineManager.setOnline(false);
    render(<OfflineNavigationGuard />);

    expect(click(link({ href: "/boards/bbbb" }), { button: 1 })).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });

  it("offline: leaves target/download/cross-origin/non-http links alone", () => {
    onlineManager.setOnline(false);
    render(<OfflineNavigationGuard />);

    const untouched: Record<string, string>[] = [
      { href: "/boards/bbbb", target: "_blank" },
      { href: "/exports/board.csv", download: "board.csv" },
      { href: "https://example.com/boards/bbbb" },
      { href: "mailto:support@example.com" },
    ];
    for (const attrs of untouched) {
      expect(click(link(attrs))).toBe(false);
    }
    expect(assign).not.toHaveBeenCalled();
  });

  it("offline: leaves a hash-only change to the current page alone", () => {
    onlineManager.setOnline(false);
    render(<OfflineNavigationGuard />);

    const anchor = link({
      href: "/boards/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa#notes",
    });

    expect(click(anchor)).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });

  it("offline: leaves a click another handler already claimed alone", () => {
    onlineManager.setOnline(false);
    // Registered on `document` BEFORE the guard mounts, so it runs first in the
    // same capture phase — the shape of a menu/dialog that navigates itself.
    const claim = (e: Event) => e.preventDefault();
    document.addEventListener("click", claim, true);
    try {
      render(<OfflineNavigationGuard />);
      click(link({ href: "/boards/bbbb" }));
      expect(assign).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("click", claim, true);
    }
  });

  it("online: attaches no listener, so link clicks are untouched", () => {
    onlineManager.setOnline(true);
    render(<OfflineNavigationGuard />);

    expect(click(link({ href: "/boards/bbbb" }))).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });

  it("stops intercepting once connectivity returns", () => {
    onlineManager.setOnline(false);
    render(<OfflineNavigationGuard />);

    act(() => onlineManager.setOnline(true));
    expect(click(link({ href: "/boards/bbbb" }))).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });

  it("stops intercepting after unmount", () => {
    onlineManager.setOnline(false);
    const { unmount } = render(<OfflineNavigationGuard />);

    unmount();
    expect(click(link({ href: "/boards/bbbb" }))).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });

  it("renders nothing", () => {
    const { container } = render(<OfflineNavigationGuard />);
    expect(container).toBeEmptyDOMElement();
  });

  describe("offline recovery one-shot", () => {
    const HERE = offlineRecoveryKey(
      "/boards/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    const ELSEWHERE = offlineRecoveryKey("/boards/bbbb");

    beforeEach(() => window.sessionStorage.clear());
    afterEach(() => window.sessionStorage.clear());

    it("online: clears the key for the current pathname on mount", () => {
      onlineManager.setOnline(true);
      window.sessionStorage.setItem(HERE, "1");
      window.sessionStorage.setItem(ELSEWHERE, "1");

      render(<OfflineNavigationGuard />);

      expect(window.sessionStorage.getItem(HERE)).toBeNull();
      // Other pathnames keep their own one-shot until they too render clean.
      expect(window.sessionStorage.getItem(ELSEWHERE)).toBe("1");
    });

    it("offline: leaves the key in place, so the one-shot still binds", () => {
      onlineManager.setOnline(false);
      window.sessionStorage.setItem(HERE, "1");

      render(<OfflineNavigationGuard />);

      expect(window.sessionStorage.getItem(HERE)).toBe("1");
    });

    it("clears the key when connectivity returns", () => {
      onlineManager.setOnline(false);
      window.sessionStorage.setItem(HERE, "1");
      render(<OfflineNavigationGuard />);
      expect(window.sessionStorage.getItem(HERE)).toBe("1");

      act(() => onlineManager.setOnline(true));

      expect(window.sessionStorage.getItem(HERE)).toBeNull();
    });
  });
});

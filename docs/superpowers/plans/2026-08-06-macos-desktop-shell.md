# macOS Desktop Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed, notarized macOS app that runs Monolith in a native window with menus, a dock badge, a global hotkey, launch-at-login, deep links, native save/open, and auto-update.

**Architecture:** An Electron main process opens one `BrowserWindow` on `https://www.monolith.works` in a persistent session. The renderer is sandboxed and context-isolated; a preload script exposes one narrow typed bridge. Navigation is allowlisted to the production origin — everything else opens in the system browser. At boot the shell checks `/desktop-release.json` and hard-blocks if it is older than `minSupportedShell`.

**Tech Stack:** Electron, TypeScript, `electron-builder`, `electron-updater`, `@electron/notarize`, `@playwright/test` (Electron driver).

## Repository

This plan builds a **new repository, `monolith-desktop`** — not a package inside the Monolith repo. A pnpm workspace at the Monolith root would change `pnpm install` semantics in every task worktree and endanger `start-task.sh` / `finish-task.sh`.

**One task (Task 4, Step 1) makes a small companion change in the Monolith repo.** It is called out explicitly where it occurs. Everything else is self-contained.

`public/desktop-release.json` is delivered by **Plan 1, Task 9** and must be live before Task 3 can be verified against production.

## Global Constraints

- **Production origin is `https://www.monolith.works`** and is the single allowlisted navigation target. Note the deployment runs the DEV Supabase project — that is deliberate and irrelevant to the shell.
- **Security posture is non-negotiable:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, no remote module. The renderer runs code fetched over the network; treat it as untrusted.
- **Every URL that is not the production origin opens in the system browser**, never in-window.
- **`webUtils.getPathForFile` is the only way to get a dropped file's path.** `File.path` was removed in Electron 32 and reading it fails silently.
- **The Edit menu must exist with standard roles.** Without it, Cmd+C/V/X/A do nothing — the classic first bug in every Electron port.
- **Never disable web security, never enable `allowRunningInsecureContent`,** and never widen the navigation allowlist to make something convenient work.
- **Commit identity:** `Danijel Jovanovic <info@synapse-solutions.ai>`.

## Free, and deliberately not tasked

Two items the spec lists need **no implementation** — recorded here so nobody goes looking for the missing task:

- **Native notifications.** Chromium renders the web `Notification` API as real macOS notifications inside Electron. The app's existing notification code works unchanged. Verify it in manual acceptance; write no code.
- **Finder drag-in.** Electron hands the page real `File` objects, so the existing HTML upload path already accepts files dragged from Finder. Only _paths_ would need `webUtils.getPathForFile`, and nothing here needs a path.

**Windows is not in this plan.** Unit I of the spec — NSIS packaging, Azure Trusted Signing, registry protocol registration, the `MAX_PATH` workaround — follows as its own small plan once macOS ships.

---

## File Structure

| File                       | Responsibility                                             |
| -------------------------- | ---------------------------------------------------------- |
| `src/main/index.ts`        | App lifecycle, single-instance lock, wiring                |
| `src/main/config.ts`       | Origin, shell version, IPC channel names                   |
| `src/main/window.ts`       | The `BrowserWindow` and its web preferences                |
| `src/main/security.ts`     | Navigation allowlist + external-link handling              |
| `src/main/menu.ts`         | Application and Edit menus                                 |
| `src/main/badge.ts`        | Dock badge from the renderer's unread count                |
| `src/main/shortcuts.ts`    | Global hotkey, launch-at-login                             |
| `src/main/deep-link.ts`    | `monolith://` protocol handling                            |
| `src/main/downloads.ts`    | Save dialog + reveal/open in the native app                |
| `src/main/version-gate.ts` | `/desktop-release.json` handshake                          |
| `src/main/updater.ts`      | `electron-updater` wiring                                  |
| `src/preload/index.ts`     | The one typed bridge exposed to the renderer               |
| `src/shared/ipc.ts`        | Channel names and payload types shared by main and preload |
| `electron-builder.yml`     | Packaging, signing, notarization, update feed              |
| `scripts/notarize.cjs`     | `afterSign` notarization hook                              |
| `tests/smoke.spec.ts`      | Playwright-Electron acceptance                             |

---

### Task 1: Scaffold with a locked-down window

**Files:**

- Create: `package.json`, `tsconfig.json`, `.gitignore`
- Create: `src/shared/ipc.ts`, `src/main/config.ts`, `src/main/window.ts`, `src/main/security.ts`, `src/main/index.ts`
- Test: `tests/security.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `PRODUCTION_ORIGIN: string`, `SHELL_VERSION: string` from `src/main/config`; `isAllowedUrl(url: string): boolean`, `applyNavigationPolicy(contents: WebContents): void` from `src/main/security`; `createMainWindow(): BrowserWindow` from `src/main/window`.

- [ ] **Step 1: Initialise the repository**

```bash
mkdir monolith-desktop && cd monolith-desktop
git init && git branch -M main
git config user.name "Danijel Jovanovic"
git config user.email "info@synapse-solutions.ai"
pnpm init
pnpm add -D electron typescript @types/node vitest @playwright/test electron-builder @electron/notarize
pnpm add electron-updater
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "outDir": "out",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": true
  },
  "include": ["src"]
}
```

Create `.gitignore`:

```
node_modules/
out/
dist/
*.log
.env
```

- [ ] **Step 2: Write the failing security test**

Create `tests/security.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isAllowedUrl } from "../src/main/security";

describe("isAllowedUrl", () => {
  it("allows the production origin", () => {
    expect(isAllowedUrl("https://www.monolith.works/boards/abc")).toBe(true);
  });

  it("refuses a lookalike host", () => {
    // The whole point of the allowlist: a hijacked link must not render inside
    // a window that shares a session with the real app.
    expect(isAllowedUrl("https://www.monolith.works.evil.com/")).toBe(false);
    expect(isAllowedUrl("https://monolith.works.co/")).toBe(false);
  });

  it("refuses plain http on the right host", () => {
    expect(isAllowedUrl("http://www.monolith.works/")).toBe(false);
  });

  it("refuses non-http schemes", () => {
    expect(isAllowedUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedUrl("javascript:alert(1)")).toBe(false);
  });

  it("refuses malformed input rather than throwing", () => {
    expect(isAllowedUrl("not a url")).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/security.test.ts`
Expected: FAIL — cannot resolve `../src/main/security`.

- [ ] **Step 4: Write config and security**

Create `src/main/config.ts`:

```ts
export const PRODUCTION_ORIGIN = "https://www.monolith.works";

/** Compared against `minSupportedShell` from /desktop-release.json. */
export const SHELL_VERSION = "1.0.0";

export const DEEP_LINK_SCHEME = "monolith";
```

Create `src/main/security.ts`:

```ts
import { shell, type WebContents } from "electron";
import { PRODUCTION_ORIGIN } from "./config";

/**
 * Exact-origin allowlist. Compares the PARSED origin, never a string prefix:
 * `https://www.monolith.works.evil.com` starts with the right characters and
 * would pass a `startsWith` check while being an attacker's host.
 */
export function isAllowedUrl(url: string): boolean {
  try {
    return new URL(url).origin === PRODUCTION_ORIGIN;
  } catch {
    return false;
  }
}

/**
 * Anything not on the allowlist leaves the app. An external page rendered
 * in-window would share this window's session — including the Supabase auth
 * cookies — so "open it here" is never the safe default.
 */
export function applyNavigationPolicy(contents: WebContents): void {
  contents.on("will-navigate", (event, url) => {
    if (isAllowedUrl(url)) return;
    event.preventDefault();
    void shell.openExternal(url);
  });

  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedUrl(url)) return { action: "allow" };
    void shell.openExternal(url);
    return { action: "deny" };
  });

  // Defence in depth: refuse any attempt to attach a webview.
  contents.on("will-attach-webview", (event) => event.preventDefault());
}
```

- [ ] **Step 5: Write the window and entry point**

Create `src/main/window.ts`:

```ts
import { BrowserWindow } from "electron";
import { join } from "node:path";
import { PRODUCTION_ORIGIN } from "./config";
import { applyNavigationPolicy } from "./security";

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    titleBarStyle: "hiddenInset",
    // Matches the app's dark background so the window does not flash white
    // before the first paint.
    backgroundColor: "#0e0e10",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      // The renderer runs code fetched over the network. All three of these
      // are required; relaxing any one of them gives remote code a path to
      // Node. Never "temporarily" disable them to debug something.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  applyNavigationPolicy(window.webContents);
  window.once("ready-to-show", () => window.show());
  void window.loadURL(PRODUCTION_ORIGIN);

  return window;
}
```

Create `src/main/index.ts`:

```ts
import { app, BrowserWindow } from "electron";
import { createMainWindow } from "./window";

let mainWindow: BrowserWindow | null = null;

// A second launch must focus the running app, not open a rival window with a
// second copy of the session. Deep links (Task 5) also arrive through this.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  void app.whenReady().then(() => {
    mainWindow = createMainWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
      }
    });
  });

  // macOS keeps the app alive with no windows; every other platform quits.
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
```

Add to `package.json`:

```json
{
  "main": "out/main/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsc && electron .",
    "test": "vitest run",
    "smoke": "playwright test"
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run tests/security.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 7: Launch it**

Run: `pnpm dev`
Expected: a dark window opens on the Monolith login page. Sign in and confirm the board renders.

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json .gitignore src tests
git commit -m "feat: scaffold the Electron shell with a locked-down window"
```

---

### Task 2: Application and Edit menus

**Files:**

- Create: `src/main/menu.ts`
- Modify: `src/main/index.ts`

**Interfaces:**

- Consumes: `PRODUCTION_ORIGIN` (Task 1).
- Produces: `buildAppMenu(window: BrowserWindow): Menu`, `installAppMenu(window: BrowserWindow): void`.

- [ ] **Step 1: Write the menu**

Create `src/main/menu.ts`:

```ts
import {
  app,
  Menu,
  shell,
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from "electron";
import { PRODUCTION_ORIGIN } from "./config";

/**
 * Electron ships NO default Edit menu. Without these roles, Cmd+C, Cmd+V,
 * Cmd+X, Cmd+A and Cmd+Z do nothing at all in the app — the single most common
 * bug in a first Electron port, and one users report as "copy is broken",
 * never as "the menu is missing".
 */
export function buildAppMenu(window: BrowserWindow): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        { role: "toggleDevTools" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }],
    },
    {
      role: "help",
      submenu: [
        {
          label: "Monolith on the Web",
          click: () => void shell.openExternal(PRODUCTION_ORIGIN),
        },
      ],
    },
  ];

  void window;
  return Menu.buildFromTemplate(template);
}

export function installAppMenu(window: BrowserWindow): void {
  Menu.setApplicationMenu(buildAppMenu(window));
}
```

- [ ] **Step 2: Install it**

In `src/main/index.ts`, after `mainWindow = createMainWindow();`:

```ts
installAppMenu(mainWindow);
```

with `import { installAppMenu } from "./menu";`.

- [ ] **Step 3: Verify by hand**

Run: `pnpm dev`
Expected: an Edit menu exists. In a board cell, Cmd+C then Cmd+V works. Cmd+A selects text.

- [ ] **Step 4: Commit**

```bash
git add src/main/menu.ts src/main/index.ts
git commit -m "feat: add application and Edit menus so clipboard shortcuts work"
```

---

### Task 3: Preload bridge and the version gate

**Files:**

- Create: `src/preload/index.ts`, `src/main/version-gate.ts`
- Modify: `src/shared/ipc.ts`, `src/main/index.ts`
- Test: `tests/version-gate.test.ts`

**Interfaces:**

- Consumes: `SHELL_VERSION`, `PRODUCTION_ORIGIN` (Task 1).
- Produces: `IPC` channel constants and `type DesktopBridge` from `src/shared/ipc`; `isShellSupported(shell: string, min: string): boolean`, `checkVersionGate(): Promise<{ supported: boolean; latest: string | null }>` from `src/main/version-gate`; `window.monolith` in the renderer.

- [ ] **Step 1: Write the failing test**

Create `tests/version-gate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isShellSupported } from "../src/main/version-gate";

describe("isShellSupported", () => {
  it("accepts an equal version", () => {
    expect(isShellSupported("1.0.0", "1.0.0")).toBe(true);
  });

  it("accepts a newer shell", () => {
    expect(isShellSupported("1.2.0", "1.0.0")).toBe(true);
    expect(isShellSupported("2.0.0", "1.9.9")).toBe(true);
    expect(isShellSupported("1.0.10", "1.0.9")).toBe(true); // numeric, not lexical
  });

  it("refuses an older shell", () => {
    expect(isShellSupported("1.0.0", "1.1.0")).toBe(false);
    expect(isShellSupported("0.9.9", "1.0.0")).toBe(false);
  });

  it("fails OPEN on unparseable input", () => {
    // A malformed contract must never brick every installed app. Blocking is
    // reserved for a version we can actually prove is too old.
    expect(isShellSupported("1.0.0", "banana")).toBe(true);
    expect(isShellSupported("", "1.0.0")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/version-gate.test.ts`
Expected: FAIL — cannot resolve `../src/main/version-gate`.

- [ ] **Step 3: Write the version gate**

Create `src/main/version-gate.ts`:

```ts
import { PRODUCTION_ORIGIN, SHELL_VERSION } from "./config";

function parse(version: string): number[] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/**
 * Compares numerically, segment by segment — `1.0.10` is newer than `1.0.9`,
 * which a string comparison gets backwards.
 *
 * Fails OPEN: if either version is unparseable we permit the shell to run. A
 * typo in the published contract must not brick every installed copy of the
 * app, and the cost of running one build too old is far smaller.
 */
export function isShellSupported(shell: string, min: string): boolean {
  const a = parse(shell);
  const b = parse(min);
  if (!a || !b) return true;

  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true;
}

export async function checkVersionGate(): Promise<{
  supported: boolean;
  latest: string | null;
}> {
  try {
    const res = await fetch(`${PRODUCTION_ORIGIN}/desktop-release.json`, {
      cache: "no-store",
    });
    if (!res.ok) return { supported: true, latest: null };

    const body = (await res.json()) as {
      minSupportedShell?: string;
      latestShell?: string;
    };
    return {
      supported: isShellSupported(SHELL_VERSION, body.minSupportedShell ?? ""),
      latest: body.latestShell ?? null,
    };
  } catch {
    // Offline at boot is normal for this app. Never block on a failed check.
    return { supported: true, latest: null };
  }
}
```

- [ ] **Step 4: Write the shared IPC contract and preload**

Create `src/shared/ipc.ts`:

```ts
export const IPC = {
  setBadge: "monolith:set-badge",
  saveFile: "monolith:save-file",
  openPath: "monolith:open-path",
  deepLink: "monolith:deep-link",
} as const;

/** The complete surface exposed to remote code. Keep it this small. */
export type DesktopBridge = {
  readonly isDesktop: true;
  readonly platform: NodeJS.Platform;
  setBadge(count: number): void;
  onDeepLink(handler: (url: string) => void): () => void;
};
```

Create `src/preload/index.ts`:

```ts
import { contextBridge, ipcRenderer } from "electron";
import { IPC, type DesktopBridge } from "../shared/ipc";

/**
 * The ONLY bridge between remote code and the main process. Every member is a
 * narrow, typed verb — never `ipcRenderer` itself, and never a generic
 * `invoke(channel, ...args)`, which would hand the renderer the whole IPC
 * surface and defeat context isolation entirely.
 */
const bridge: DesktopBridge = {
  isDesktop: true,
  platform: process.platform,

  setBadge(count: number) {
    // Coerced and clamped here: this value arrives from remote code.
    const safe = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
    ipcRenderer.send(IPC.setBadge, safe);
  },

  onDeepLink(handler: (url: string) => void) {
    const listener = (_e: unknown, url: string) => handler(url);
    ipcRenderer.on(IPC.deepLink, listener);
    return () => {
      ipcRenderer.removeListener(IPC.deepLink, listener);
    };
  },
};

contextBridge.exposeInMainWorld("monolith", bridge);
```

- [ ] **Step 5: Block on an unsupported shell**

In `src/main/index.ts`, inside `app.whenReady().then(...)` before creating the window:

```ts
const gate = await checkVersionGate();
if (!gate.supported) {
  await dialog.showMessageBox({
    type: "warning",
    message: "Update required",
    detail: `This version of Monolith is too old to run. Please install ${gate.latest ?? "the latest version"}.`,
    buttons: ["Quit"],
  });
  app.quit();
  return;
}
```

Add `dialog` to the `electron` import and `import { checkVersionGate } from "./version-gate";`. Make the `whenReady` callback `async`.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run`
Expected: PASS, all tests.

- [ ] **Step 7: Commit**

```bash
git add src/shared/ipc.ts src/preload/index.ts src/main/version-gate.ts src/main/index.ts tests/version-gate.test.ts
git commit -m "feat: add the preload bridge and the desktop version gate"
```

---

### Task 4: Dock badge

This is the one task with a companion change in the Monolith repo.

**Files:**

- Create: `src/main/badge.ts`
- Modify: `src/main/index.ts`
- Modify (Monolith repo): `src/components/notifications/NotificationsBell.tsx`

**Interfaces:**

- Consumes: `IPC` (Task 3).
- Produces: `registerBadgeHandler(): void`.

- [ ] **Step 1: Dispatch the count from the web app (Monolith repo)**

In the Monolith repo, in `src/components/notifications/NotificationsBell.tsx`, the component already reads `const { query, unread } = useNotifications(...)`. Add an effect that hands the count to the shell when one is present:

```tsx
useEffect(() => {
  // The desktop shell exposes `window.monolith` via its preload bridge; in a
  // plain browser this is undefined and the effect is a no-op. Guarding on the
  // object rather than a user-agent sniff keeps the web build unaware of the
  // desktop app.
  const bridge = (window as { monolith?: { setBadge(n: number): void } })
    .monolith;
  bridge?.setBadge(unread);
}, [unread]);
```

Commit that in the Monolith repo on its own branch, with the four gates green:

```bash
git add src/components/notifications/NotificationsBell.tsx
git commit -m "feat(desktop): publish the unread count to the desktop shell when present"
```

- [ ] **Step 2: Write the badge handler**

Create `src/main/badge.ts`:

```ts
import { app, ipcMain } from "electron";
import { IPC } from "../shared/ipc";

/**
 * `app.badgeCount` is macOS/Linux only. The value is re-clamped here even
 * though the preload already clamped it: the preload runs in the renderer
 * process, so its guarantees are only as strong as that process.
 */
export function registerBadgeHandler(): void {
  ipcMain.on(IPC.setBadge, (_event, count: unknown) => {
    const safe =
      typeof count === "number" && Number.isFinite(count)
        ? Math.max(0, Math.floor(count))
        : 0;
    app.badgeCount = safe;
  });
}
```

- [ ] **Step 3: Register it**

In `src/main/index.ts`, before creating the window: `registerBadgeHandler();`

- [ ] **Step 4: Verify by hand**

Run: `pnpm dev` against a build of the web app carrying Step 1. Trigger a notification.
Expected: the dock icon shows the unread count and it clears when notifications are read.

- [ ] **Step 5: Commit**

```bash
git add src/main/badge.ts src/main/index.ts
git commit -m "feat: show the unread notification count on the dock icon"
```

---

### Task 5: Global hotkey, launch-at-login, deep links

**Files:**

- Create: `src/main/shortcuts.ts`, `src/main/deep-link.ts`
- Modify: `src/main/index.ts`, `electron-builder.yml` (created in Task 7)

**Interfaces:**

- Consumes: `DEEP_LINK_SCHEME` (Task 1), `IPC` (Task 3).
- Produces: `registerGlobalShortcut(window: BrowserWindow): void`, `setLaunchAtLogin(enabled: boolean): void`, `registerDeepLinks(getWindow: () => BrowserWindow | null): void`, `toAppPath(url: string): string | null`.

- [ ] **Step 1: Write the failing test**

Create `tests/deep-link.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toAppPath } from "../src/main/deep-link";

describe("toAppPath", () => {
  it("maps a board deep link to an app path", () => {
    expect(toAppPath("monolith://boards/abc-123")).toBe("/boards/abc-123");
  });

  it("preserves a query string", () => {
    expect(toAppPath("monolith://boards/abc?thread=t1")).toBe(
      "/boards/abc?thread=t1",
    );
  });

  it("refuses a foreign scheme", () => {
    expect(toAppPath("https://evil.com/boards/abc")).toBeNull();
  });

  it("refuses a path escape", () => {
    // A deep link is attacker-supplied: anyone can craft one and email it.
    expect(toAppPath("monolith://../../etc/passwd")).toBeNull();
  });

  it("refuses malformed input", () => {
    expect(toAppPath("monolith:")).toBeNull();
    expect(toAppPath("nonsense")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/deep-link.test.ts`
Expected: FAIL — cannot resolve `../src/main/deep-link`.

- [ ] **Step 3: Write deep-link handling**

Create `src/main/deep-link.ts`:

```ts
import { app, type BrowserWindow } from "electron";
import { DEEP_LINK_SCHEME, PRODUCTION_ORIGIN } from "./config";

/**
 * Convert `monolith://boards/abc?x=1` into `/boards/abc?x=1`.
 *
 * Deep links are attacker-supplied — anyone can put one in an email — so this
 * refuses anything containing a path escape and returns null rather than
 * guessing. The caller loads the result against the production origin only.
 */
export function toAppPath(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== `${DEEP_LINK_SCHEME}:`) return null;

  const path = `/${parsed.host}${parsed.pathname}`.replace(/\/{2,}/g, "/");
  if (path.includes("..")) return null;
  if (path === "/") return null;

  return `${path}${parsed.search}`;
}

export function registerDeepLinks(getWindow: () => BrowserWindow | null): void {
  if (!app.isDefaultProtocolClient(DEEP_LINK_SCHEME)) {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
  }

  const open = (url: string) => {
    const path = toAppPath(url);
    const window = getWindow();
    if (!path || !window) return;
    void window.loadURL(`${PRODUCTION_ORIGIN}${path}`);
    if (window.isMinimized()) window.restore();
    window.focus();
  };

  // macOS delivers deep links here when the app is already running.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    open(url);
  });

  // Windows and Linux deliver them as argv on the second instance.
  app.on("second-instance", (_event, argv) => {
    const link = argv.find((a) => a.startsWith(`${DEEP_LINK_SCHEME}://`));
    if (link) open(link);
  });
}
```

- [ ] **Step 4: Write shortcuts**

Create `src/main/shortcuts.ts`:

```ts
import { app, globalShortcut, type BrowserWindow } from "electron";

const SUMMON_ACCELERATOR = "CommandOrControl+Shift+M";

/**
 * Summon-and-focus only. A global shortcut is a system-wide claim — if another
 * app already owns this chord, `register` returns false and we leave it alone
 * rather than fighting over it.
 */
export function registerGlobalShortcut(window: BrowserWindow): boolean {
  const ok = globalShortcut.register(SUMMON_ACCELERATOR, () => {
    if (window.isMinimized()) window.restore();
    if (!window.isVisible()) window.show();
    window.focus();
  });

  app.on("will-quit", () => globalShortcut.unregisterAll());
  return ok;
}

export function setLaunchAtLogin(enabled: boolean): void {
  app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true });
}
```

- [ ] **Step 5: Wire them up**

In `src/main/index.ts`, after the window is created:

```ts
registerGlobalShortcut(mainWindow);
registerDeepLinks(() => mainWindow);
```

`registerDeepLinks` must be called after the single-instance lock is acquired, because it adds a second `second-instance` listener.

- [ ] **Step 6: Give launch-at-login a control**

`setLaunchAtLogin` needs a way to be turned on, or it is dead code. Add a checkbox item to the application submenu in `src/main/menu.ts`, immediately after `{ role: "about" }`:

```ts
        { type: "separator" },
        {
          label: "Open at Login",
          type: "checkbox",
          checked: app.getLoginItemSettings().openAtLogin,
          click: (item) => setLaunchAtLogin(item.checked),
        },
```

with `import { setLaunchAtLogin } from "./shortcuts";`. Reading `getLoginItemSettings()` at build time means the checkmark reflects the real system state rather than a guess the app keeps separately.

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm vitest run`
Expected: PASS, all suites.

- [ ] **Step 8: Commit**

```bash
git add src/main/shortcuts.ts src/main/deep-link.ts src/main/menu.ts src/main/index.ts tests/deep-link.test.ts
git commit -m "feat: add the global summon hotkey, launch-at-login and monolith:// deep links"
```

---

### Task 6: Native downloads

Finder drag-in needs no work: Electron hands the page real `File` objects, so the existing HTML upload path already works. What the browser cannot do is choose a real save location and open a file in its native app.

**Files:**

- Create: `src/main/downloads.ts`
- Modify: `src/main/index.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `registerDownloadHandler(window: BrowserWindow): void`.

- [ ] **Step 1: Write the handler**

Create `src/main/downloads.ts`:

```ts
import { dialog, shell, type BrowserWindow } from "electron";
import { basename } from "node:path";

/**
 * Exports (Excel, PDF) arrive as ordinary browser downloads. In a browser the
 * user gets the download shelf; here they get a real macOS save panel, and the
 * option to open the file in whatever app owns that type.
 */
export function registerDownloadHandler(window: BrowserWindow): void {
  window.webContents.session.on("will-download", (_event, item) => {
    const suggested = item.getFilename();

    void dialog
      .showSaveDialog(window, {
        defaultPath: suggested,
        title: `Save ${basename(suggested)}`,
      })
      .then((result) => {
        if (result.canceled || !result.filePath) {
          item.cancel();
          return;
        }
        item.setSavePath(result.filePath);

        item.once("done", (_e, state) => {
          if (state !== "completed") return;
          void dialog
            .showMessageBox(window, {
              type: "info",
              message: "Download complete",
              detail: basename(result.filePath as string),
              buttons: ["Open", "Show in Finder", "Done"],
              defaultId: 2,
              cancelId: 2,
            })
            .then(({ response }) => {
              if (response === 0)
                void shell.openPath(result.filePath as string);
              if (response === 1)
                shell.showItemInFolder(result.filePath as string);
            });
        });
      });
  });
}
```

- [ ] **Step 2: Register it**

In `src/main/index.ts`, after the window is created: `registerDownloadHandler(mainWindow);`

- [ ] **Step 3: Verify by hand**

Run: `pnpm dev`. Export a board to Excel.
Expected: a native save panel appears; after saving, "Open" launches it in Excel/Numbers and "Show in Finder" reveals it.

- [ ] **Step 4: Verify drag-in still works**

Drag a file from Finder onto an item's attachment area.
Expected: it uploads exactly as it does in the browser.

- [ ] **Step 5: Commit**

```bash
git add src/main/downloads.ts src/main/index.ts
git commit -m "feat: save exports through a native panel and open them in place"
```

---

### Task 7: Package, sign, notarize, auto-update

**Files:**

- Create: `electron-builder.yml`, `scripts/notarize.cjs`, `build/entitlements.mac.plist`
- Create: `src/main/updater.ts`
- Modify: `src/main/index.ts`, `package.json`

**Interfaces:**

- Consumes: everything above.
- Produces: a notarized `.dmg` and an update feed.

- [ ] **Step 1: Write the entitlements**

Create `build/entitlements.mac.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <!-- Electron requires both JIT and unsigned executable memory in the
       hardened runtime; without them the app crashes on launch after signing. -->
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.network.client</key><true/>
  <key>com.apple.security.files.user-selected.read-write</key><true/>
</dict>
</plist>
```

- [ ] **Step 2: Write the builder config**

Create `electron-builder.yml`:

```yaml
appId: ai.synapse.monolith
productName: Monolith
directories:
  output: dist
  buildResources: build
files:
  - out/**/*
  - package.json
mac:
  category: public.app-category.productivity
  target:
    - target: dmg
      arch: [arm64, x64]
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  # Registers monolith:// with Launch Services.
  protocols:
    - name: Monolith
      schemes: [monolith]
afterSign: scripts/notarize.cjs
publish:
  provider: generic
  url: https://releases.monolith.works/desktop
```

- [ ] **Step 3: Write the notarization hook**

Create `scripts/notarize.cjs`:

```js
const { notarize } = require("@electron/notarize");

// Runs after electron-builder signs the app. Skips silently when credentials
// are absent so a local `pnpm package` still works without them.
exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== "darwin") return;

  const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
  if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
    console.log("Skipping notarization: Apple credentials not set.");
    return;
  }

  await notarize({
    appPath: `${appOutDir}/${context.packager.appInfo.productFilename}.app`,
    appleId: APPLE_ID,
    appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
    teamId: APPLE_TEAM_ID,
  });
};
```

- [ ] **Step 4: Wire the updater**

Create `src/main/updater.ts`:

```ts
import { autoUpdater } from "electron-updater";

/**
 * Checks on launch and every six hours. Downloads in the background and
 * installs on quit, so an update never interrupts work in progress.
 */
export function startAutoUpdates(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  void autoUpdater.checkForUpdatesAndNotify().catch(() => undefined);
  setInterval(
    () => void autoUpdater.checkForUpdatesAndNotify().catch(() => undefined),
    6 * 60 * 60 * 1000,
  );
}
```

Call `startAutoUpdates();` in `src/main/index.ts` after the window is created, guarded by `if (app.isPackaged)`.

- [ ] **Step 5: Add the package script**

In `package.json`:

```json
"package": "tsc && electron-builder --mac"
```

- [ ] **Step 6: Notarize a build early**

Run: `APPLE_ID=… APPLE_APP_SPECIFIC_PASSWORD=… APPLE_TEAM_ID=… pnpm package`
Expected: `dist/Monolith-<version>-arm64.dmg` exists and notarization succeeds. Install it on a machine that has never seen the app and confirm macOS raises **no** unidentified-developer warning.

Do this step before the shell feels finished. Notarization failures are configuration problems, and discovering them at the end is how a release slips a week.

- [ ] **Step 7: Commit**

```bash
git add electron-builder.yml scripts/notarize.cjs build/entitlements.mac.plist src/main/updater.ts src/main/index.ts package.json
git commit -m "feat: package, sign, notarize and auto-update the macOS app"
```

---

### Task 8: Playwright-Electron smoke suite

**Files:**

- Create: `playwright.config.ts`, `tests/smoke.spec.ts`

**Interfaces:**

- Consumes: everything above.
- Produces: the acceptance proof for the shell.

- [ ] **Step 1: Write the config**

Create `playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
});
```

- [ ] **Step 2: Write the smoke suite**

Create `tests/smoke.spec.ts`:

```ts
import { _electron as electron, expect, test } from "@playwright/test";

test("the shell opens the production app in a locked-down window", async () => {
  const app = await electron.launch({ args: ["."] });
  const window = await app.firstWindow();

  await expect
    .poll(() => window.url(), { timeout: 30_000 })
    .toContain("www.monolith.works");

  // Remote code must not be able to reach Node.
  const leaked = await window.evaluate(
    () =>
      typeof (globalThis as Record<string, unknown>).require !== "undefined" ||
      typeof (globalThis as Record<string, unknown>).process !== "undefined",
  );
  expect(leaked).toBe(false);

  // The bridge is present, and is only the bridge.
  const bridgeKeys = await window.evaluate(() =>
    Object.keys((globalThis as { monolith?: object }).monolith ?? {}).sort(),
  );
  expect(bridgeKeys).toEqual([
    "isDesktop",
    "onDeepLink",
    "platform",
    "setBadge",
  ]);

  await app.close();
});

test("an external link does not open in-window", async () => {
  const app = await electron.launch({ args: ["."] });
  const window = await app.firstWindow();
  await expect
    .poll(() => window.url(), { timeout: 30_000 })
    .toContain("monolith.works");

  const before = window.url();
  await window.evaluate(() => {
    const a = document.createElement("a");
    a.href = "https://example.com";
    a.target = "_blank";
    document.body.append(a);
    a.click();
  });
  await new Promise((r) => setTimeout(r, 1500));

  expect(await app.windows()).toHaveLength(1);
  expect(window.url()).toBe(before);

  await app.close();
});
```

- [ ] **Step 3: Run the suite**

Run: `pnpm build && pnpm smoke`
Expected: PASS, 2 tests.

- [ ] **Step 4: Commit**

```bash
git add playwright.config.ts tests/smoke.spec.ts
git commit -m "test: prove the window is sandboxed and external links leave the app"
```

---

## Execution DAG

| Task | Depends on |
| ---- | ---------- |
| 1    | —          |
| 2    | 1          |
| 3    | 1          |
| 4    | 3          |
| 5    | 1, 3       |
| 6    | 1          |
| 7    | 1          |
| 8    | all        |

| Batch | Tasks      | Notes                                                    |
| ----- | ---------- | -------------------------------------------------------- |
| 1     | 1          | Everything waits on the scaffold                         |
| 2     | 2, 3, 6, 7 | Four concurrent; **7 early on purpose** (notarize early) |
| 3     | 4, 5       | Both consume the preload bridge                          |
| 4     | 8          | Serialising acceptance                                   |

**Critical path:** 1 → 3 → 4 → 8.

## How to test (manual acceptance)

1. Install the signed `.dmg` on a machine that has never run the app. macOS raises **no** unidentified-developer warning.
2. Sign in. Quit with Cmd+Q and reopen — still signed in.
3. In a board cell: Cmd+C, Cmd+V, Cmd+A all work.
4. Trigger a notification. The dock icon shows a badge; reading it clears the badge.
5. Press Cmd+Shift+M from another app. Monolith comes forward.
6. Click a link to any external site inside the app. It opens in your default browser and no second window appears.
7. Click an emailed briefing link. It opens **in the app**, on the right thread.
8. Export a board to Excel. A native save panel appears; "Open" launches it.
9. Drag a file from Finder onto an item. It uploads.
10. Publish a newer build to the feed, reopen, and confirm it updates on next quit.
11. Enable launch-at-login, restart the Mac, confirm Monolith starts hidden.

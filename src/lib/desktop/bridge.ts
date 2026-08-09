/**
 * The desktop shell's preload bridge, as the web app sees it.
 *
 * The shell exposes `window.monolith` from a sandboxed, context-isolated
 * preload. In a plain browser it is simply absent, which is the discriminator
 * the app uses everywhere — never a user-agent sniff, so the web build stays
 * unaware the desktop app exists.
 *
 * Typed in ONE place because it was previously re-declared inline at each call
 * site, and an inline `as { monolith?: { … } }` cast is a private copy of a
 * contract that lives in another repository: the two drift silently, and the
 * cast keeps compiling while the field it names is gone.
 *
 * Keep this a mirror of `DesktopBridge` in `monolith-desktop/src/shared/ipc.ts`,
 * and keep every member OPTIONAL — an older installed shell will not have
 * fields added later, and it is the one client we can never force to upgrade.
 */
export type DesktopBridge = {
  readonly isDesktop?: true;
  readonly platform?: string;
  /** Absent on shells built before the version was exposed. */
  readonly version?: string;
  setBadge?(count: number): void;
};

/** The bridge, or null in a browser. Safe during SSR. */
export function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  return (window as { monolith?: DesktopBridge }).monolith ?? null;
}

/**
 * The running shell's version, or null when it cannot be known: a browser, or a
 * shell old enough to predate the field.
 *
 * `"unknown"` is the preload's own fallback when the version failed to reach
 * it. It is mapped to null deliberately — showing a user "You're running
 * unknown" is worse than showing them nothing.
 */
export function getInstalledShellVersion(): string | null {
  const version = getDesktopBridge()?.version;
  if (!version || version === "unknown") return null;
  return version;
}

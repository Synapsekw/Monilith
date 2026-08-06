import { Apple, Download, Info } from "lucide-react";
import { SettingsSection } from "@/components/settings/settings-section";
import { Kicker } from "@/components/ui/kicker";
import { getDesktopRelease } from "@/lib/desktop/read-release";
import { DOWNLOAD_ARCHS } from "@/lib/desktop/release-contract";

export const metadata = { title: "Desktop app · Settings" };

/**
 * Deliberately a Server Component with no client boundary: two download links
 * and static copy need no JavaScript.
 *
 * In particular there is NO architecture auto-detection. Rosetta makes Safari
 * and Chrome report "Intel Mac OS X" on Apple Silicon, so a user-agent sniff
 * would confidently hand M-series users the wrong binary. Both builds are
 * offered with plain labels and a way to check instead.
 */
export default function DesktopSettingsPage() {
  const release = getDesktopRelease();

  return (
    <>
      <SettingsSection
        title="Desktop app"
        description="Run Monolith in its own window, with menus, a dock badge and a global shortcut."
      >
        <div className="space-y-6 py-4">
          <p className="text-muted-foreground text-sm">
            The desktop app wraps the same Monolith you use in the browser, so
            your boards, sign-in and notifications are exactly as you left them.
            It adds native window behaviour: clipboard shortcuts, an unread
            count on the dock icon, <kbd className="text-xs">⌘⇧M</kbd> to summon
            it from anywhere, and file exports through a real save panel.
          </p>

          <div>
            <Kicker>Download for macOS</Kicker>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {DOWNLOAD_ARCHS.map((arch) => (
                <a
                  key={arch.key}
                  href={release.downloads[arch.key]}
                  className="bg-surface hover:border-border-hover focus-visible:ring-ring group flex items-center gap-3 rounded-lg border p-4 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                >
                  <span className="bg-surface-muted grid size-10 shrink-0 place-items-center rounded-lg">
                    <Apple className="size-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-foreground block text-sm font-medium">
                      {arch.label}
                    </span>
                    <span className="text-muted-foreground block text-xs">
                      {arch.hint}
                    </span>
                  </span>
                  <Download
                    className="text-muted-foreground group-hover:text-foreground size-4 shrink-0 transition-colors"
                    aria-hidden="true"
                  />
                </a>
              ))}
            </div>
            <p className="text-kicker mt-2 text-xs">
              Version {release.latestShell} · Not sure which? Apple menu → About
              This Mac. “Apple M1” or newer means Apple Silicon.
            </p>
          </div>

          <div>
            <Kicker>Installing</Kicker>
            <ol className="text-muted-foreground mt-3 list-decimal space-y-1.5 pl-5 text-sm">
              <li>Open the downloaded .dmg file.</li>
              <li>Drag Monolith into your Applications folder.</li>
              <li>Launch it from Launchpad or Spotlight and sign in.</li>
            </ol>
          </div>

          {/*
            This notice is not decoration. The current build is unsigned, so
            macOS Gatekeeper WILL refuse a downloaded copy with "Monolith is
            damaged and can't be opened" — a message that reads like a corrupt
            file rather than a signing problem. Saying so here is the difference
            between a known limitation and a support ticket. Remove this block
            once notarization ships.
          */}
          <div className="bg-surface-muted flex gap-3 rounded-lg border p-4">
            <Info
              className="text-muted-foreground mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <div className="space-y-1.5 text-sm">
              <p className="text-foreground font-medium">
                This build isn’t signed by Apple yet
              </p>
              <p className="text-muted-foreground">
                macOS will refuse to open it and may say the app is “damaged”.
                It isn’t — it just hasn’t been notarized. To run it anyway, open
                Terminal and run:
              </p>
              <code className="bg-surface-sunken text-foreground block overflow-x-auto rounded-sm border px-2.5 py-1.5 font-mono text-xs">
                xattr -dr com.apple.quarantine /Applications/Monolith.app
              </code>
            </div>
          </div>
        </div>
      </SettingsSection>
    </>
  );
}

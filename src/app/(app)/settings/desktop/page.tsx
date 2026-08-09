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

          {/*
            The Terminal step is FIRST, and that ordering is the whole point.

            An earlier version of this page listed it last, targeting
            /Applications/Monolith.app — advice that can never be followed.
            Gatekeeper blocks the drag OUT of the quarantined disk image, so the
            app never reaches /Applications for the command to act on. The
            attribute has to come off the .dmg itself, before it is mounted.

            Worth knowing: `com.apple.quarantine` is stamped on by the browser
            that downloads the file, not by anything in the build. That is why a
            locally built copy installs with no ceremony at all, and why this is
            not an Electron quirk — any unsigned app downloaded this way behaves
            identically.

            Delete this whole block once notarization ships; the remaining steps
            stand on their own.
          */}
          <div>
            <Kicker>Installing</Kicker>
            <ol className="text-muted-foreground mt-3 list-decimal space-y-2.5 pl-5 text-sm">
              <li>
                <span className="text-foreground font-medium">
                  Open Terminal and run this first
                </span>{" "}
                — the build isn’t notarized by Apple yet, so macOS will refuse
                to install it until the download flag is cleared:
                <code className="bg-surface-sunken text-foreground mt-1.5 block overflow-x-auto rounded-sm border px-2.5 py-1.5 font-mono text-xs">
                  xattr -dr com.apple.quarantine ~/Downloads/Monolith-*.dmg
                </code>
              </li>
              <li>Open the .dmg file.</li>
              <li>Drag Monolith into your Applications folder.</li>
              <li>Launch it from Launchpad or Spotlight and sign in.</li>
            </ol>
          </div>

          <div className="bg-surface-muted flex gap-3 rounded-lg border p-4">
            <Info
              className="text-muted-foreground mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <div className="space-y-1.5 text-sm">
              <p className="text-foreground font-medium">Why the extra step?</p>
              <p className="text-muted-foreground">
                This build isn’t signed by Apple yet, so macOS quarantines it on
                download and may claim the app is “damaged”. It isn’t. Run the
                command in step 1 <span className="font-medium">before</span>{" "}
                opening the .dmg — once it’s mounted, macOS blocks the drag and
                there’s nothing left to fix. This step disappears once the app
                is notarized.
              </p>
            </div>
          </div>

          {/*
            Updating is a SEPARATE list, not a footnote on Installing, because
            it is not the same procedure: it opens with "quit the app", a step
            that does not exist on a first install and that macOS enforces —
            Finder refuses to replace a running .app. Leaving it implicit sends
            people to a "the app is in use" error with no explanation.

            The xattr command is repeated in full rather than cross-referenced.
            An instruction that says "see step 1 above" is one the reader has to
            reassemble while following a different list, and the page-test now
            asserts EVERY copy of that command targets the .dmg.
          */}
          <div>
            <Kicker>Updating</Kicker>
            <p className="text-muted-foreground mt-3 text-sm">
              Monolith checks for a new version each time it launches and offers
              to download one. You can also check whenever you like from{" "}
              <span className="text-foreground font-medium">
                Monolith → Check for Updates…
              </span>{" "}
              in the menu bar. Updates can’t install themselves until the app is
              notarized, so applying one is a quick re-download:
            </p>
            <ol className="text-muted-foreground mt-3 list-decimal space-y-2.5 pl-5 text-sm">
              <li>
                <span className="text-foreground font-medium">
                  Quit Monolith first
                </span>{" "}
                — macOS won’t let you replace an app while it’s running.
              </li>
              <li>Download the latest build using the links above.</li>
              <li>
                Clear the download flag on the new .dmg, exactly as you did when
                installing:
                <code className="bg-surface-sunken text-foreground mt-1.5 block overflow-x-auto rounded-sm border px-2.5 py-1.5 font-mono text-xs">
                  xattr -dr com.apple.quarantine ~/Downloads/Monolith-*.dmg
                </code>
              </li>
              <li>
                Open it and drag Monolith into Applications, replacing the
                existing copy when macOS asks.
              </li>
              <li>
                Launch it — you’ll still be signed in, with your boards exactly
                as you left them.
              </li>
            </ol>
          </div>
        </div>
      </SettingsSection>
    </>
  );
}

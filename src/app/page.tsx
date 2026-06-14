import { Sparkles } from "lucide-react";
import { AppShell } from "@/components/app-shell";

export default function Home() {
  return (
    <AppShell>
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="bg-surface flex size-12 items-center justify-center rounded-xl border">
          <Sparkles className="text-primary size-6" />
        </div>
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight">
            Welcome to Pulse
          </h1>
          <p className="text-muted-foreground max-w-md text-sm text-pretty">
            Your Work OS shell is ready. Press{" "}
            <kbd className="bg-muted rounded border px-1.5 font-mono text-xs">
              ⌘K
            </kbd>{" "}
            to open the command palette. Auth, workspaces, and boards come next.
          </p>
        </div>
      </div>
    </AppShell>
  );
}

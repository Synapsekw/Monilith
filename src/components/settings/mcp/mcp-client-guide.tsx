"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const CLIENTS = [
  { id: "desktop", label: "Claude Desktop" },
  { id: "web", label: "claude.ai" },
  { id: "code", label: "Claude Code" },
  { id: "other", label: "Other client" },
] as const;

type ClientId = (typeof CLIENTS)[number]["id"];

function Steps({ children }: { children: ReactNode }) {
  return (
    <ol className="text-muted-foreground list-decimal space-y-2 pl-5 text-sm">
      {children}
    </ol>
  );
}

function Command({ children }: { children: ReactNode }) {
  return (
    <code className="border-border bg-surface-muted text-foreground mt-1.5 block overflow-x-auto rounded-sm border px-3 py-2 font-mono text-xs">
      {children}
    </code>
  );
}

/**
 * Per-client setup steps. Switching clients is an in-page toggle over content
 * the page already has, so it uses the History API only — never a <Link> or
 * router navigation, which would re-run every query on the page
 * (AGENTS.md §5). Mirrors the tab idiom in OrgAdminConsole.
 */
export function McpClientGuide({ serverUrl }: { serverUrl: string }) {
  const [client, setClient] = useState<ClientId>("desktop");

  function select(next: ClientId) {
    setClient(next);
    const url = new URL(window.location.href);
    url.searchParams.set("client", next);
    window.history.pushState(null, "", `${url.pathname}${url.search}`);
  }

  return (
    <div className="space-y-4 py-4">
      <div role="tablist" className="border-border flex gap-1 border-b">
        {CLIENTS.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={client === c.id}
            onClick={() => select(c.id)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              "focus-visible:ring-ring/50 rounded-t-sm focus-visible:ring-2 focus-visible:outline-none",
              client === c.id
                ? "border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground hover:border-border-hover border-transparent",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      {client === "desktop" && (
        <Steps>
          <li>Open Claude Desktop and go to Settings → Connectors.</li>
          <li>
            Choose <b>Add custom connector</b>.
          </li>
          <li>
            Name it <b>Pulse</b> and paste the server URL from above.
          </li>
          <li>
            Click <b>Connect</b>. A Pulse sign-in page opens in your browser —
            approve the request there.
          </li>
          <li>
            Back in Claude, ask &ldquo;list my Pulse boards&rdquo; to confirm it
            works.
          </li>
        </Steps>
      )}

      {client === "web" && (
        <Steps>
          <li>Open claude.ai and go to Settings → Connectors.</li>
          <li>
            Choose <b>Add custom connector</b> and paste the server URL from
            above.
          </li>
          <li>Approve the Pulse sign-in prompt that opens.</li>
          <li>
            Start a new chat and ask &ldquo;list my Pulse boards&rdquo; to
            confirm it works.
          </li>
        </Steps>
      )}

      {client === "code" && (
        <Steps>
          <li>
            Run this in your terminal:
            <Command>claude mcp add --transport http pulse {serverUrl}</Command>
          </li>
          <li>
            Run <code className="font-mono text-xs">/mcp</code> inside Claude
            Code and authenticate when prompted.
          </li>
          <li>
            Ask &ldquo;list my Pulse boards&rdquo; to confirm the connection.
          </li>
        </Steps>
      )}

      {client === "other" && (
        <Steps>
          <li>
            Pulse speaks the Model Context Protocol over streamable HTTP, with
            OAuth 2.1 (dynamic client registration + PKCE) for authentication.
          </li>
          <li>
            Point your client at the server URL from above. It discovers the
            authorization server automatically via the standard
            <code className="mx-1 font-mono text-xs">
              /.well-known/oauth-protected-resource
            </code>
            metadata — no manual client ID or secret to configure.
          </li>
          <li>Complete the sign-in in the browser window your client opens.</li>
        </Steps>
      )}
    </div>
  );
}

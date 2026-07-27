import { headers } from "next/headers";
import { listMyConnections } from "@/lib/mcp/oauth/connections";
import { SettingsSection } from "@/components/settings/settings-section";
import { CopyField } from "@/components/settings/mcp/copy-field";
import { McpClientGuide } from "@/components/settings/mcp/mcp-client-guide";
import { McpToolsTable } from "@/components/settings/mcp/mcp-tools-table";
import { ConnectedAppsList } from "@/components/settings/mcp/connected-apps-list";

export const metadata = { title: "Connect via MCP · Settings" };

/**
 * The public origin of this deployment, derived from the request.
 *
 * Hardcoding would hand a localhost URL to production users and a production
 * URL to local dev; the well-known metadata routes
 * (src/app/.well-known/oauth-protected-resource/route.ts) derive their origin
 * the same way and must agree with what we print here.
 */
async function getOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export default async function McpSettingsPage() {
  const [connections, origin] = await Promise.all([
    listMyConnections(),
    getOrigin(),
  ]);
  const serverUrl = `${origin}/api/mcp`;

  return (
    <>
      <SettingsSection
        title="Connect via MCP"
        description="Let Claude and other AI clients read and update your Monolith boards."
      >
        <div className="space-y-4 py-4">
          <p className="text-muted-foreground text-sm">
            The Model Context Protocol (MCP) is an open standard that lets AI
            apps talk to tools like Monolith. Once connected, you can ask your
            AI client to find items, summarize a board, or create and update
            work — without leaving the conversation.
          </p>
          <div>
            <p className="text-foreground mb-1.5 text-sm font-medium">
              Your server URL
            </p>
            <CopyField label="Server URL" value={serverUrl} />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Add it to your client"
        description="Pick your app for the exact steps."
      >
        <McpClientGuide serverUrl={serverUrl} />
      </SettingsSection>

      <SettingsSection
        title="What a connected client can do"
        description="These are the only actions available over MCP."
      >
        <McpToolsTable />
      </SettingsSection>

      <SettingsSection
        title="Access and safety"
        description="What you're granting when you connect an app."
      >
        <ul className="text-muted-foreground list-disc space-y-2 py-4 pl-5 text-sm">
          <li>
            The client connects <b className="text-foreground">as you</b>. It
            sees exactly the boards and items you can see — never another
            member&apos;s private work, never another organization&apos;s data.
          </li>
          <li>
            You sign in on Monolith itself. The client never sees your password.
          </li>
          <li>
            Nothing can be deleted over MCP — no delete tool exists on the
            server.
          </li>
          <li>
            You can revoke any app below at any time, and it loses access
            immediately.
          </li>
        </ul>
      </SettingsSection>

      <SettingsSection
        title="Connected apps"
        description="Apps and clients currently holding MCP access to your account."
      >
        <ConnectedAppsList connections={connections} />
      </SettingsSection>

      <SettingsSection
        title="Troubleshooting"
        description="If something isn't working."
      >
        <dl className="space-y-4 py-4 text-sm">
          <div>
            <dt className="text-foreground font-medium">
              The client won&apos;t connect
            </dt>
            <dd className="text-muted-foreground mt-1">
              Check the URL ends in <code className="font-mono">/api/mcp</code>,
              and that you&apos;re signed in to Monolith in the same browser the
              approval window opens in.
            </dd>
          </div>
          <div>
            <dt className="text-foreground font-medium">
              It connected, then stopped working
            </dt>
            <dd className="text-muted-foreground mt-1">
              Access may have been revoked here, or the connection expired.
              Remove the connector in your client and add it again.
            </dd>
          </div>
          <div>
            <dt className="text-foreground font-medium">No boards come back</dt>
            <dd className="text-muted-foreground mt-1">
              The connection is scoped to your account. If you belong to more
              than one organization, boards outside your active one aren&apos;t
              visible over MCP.
            </dd>
          </div>
        </dl>
      </SettingsSection>
    </>
  );
}

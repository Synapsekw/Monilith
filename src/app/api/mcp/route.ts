import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { resolveMcpAuth } from "@/lib/mcp/context";
import { registerTools } from "@/lib/mcp/tools/register";

// mcp-handler v2 dropped its own transport config object: routing belongs to
// the host framework, so the handler serves whatever route it is mounted at
// (no `basePath`), the legacy SSE transport is gone (no `disableSse`), and the
// execution ceiling is a Next.js route-segment export rather than a handler
// option — hence `maxDuration` below.
export const maxDuration = 60;

async function baseHandler(req: Request) {
  const handler = createMcpHandler(
    (server) => {
      if (req.auth) registerTools(server, req.auth);
    },
    { serverInfo: { name: "monolith", version: "1.0.0" } },
  );
  return handler(req);
}

const authedHandler = withMcpAuth(baseHandler, resolveMcpAuth, {
  required: true,
});

export { authedHandler as GET, authedHandler as POST };

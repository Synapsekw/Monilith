import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { resolveMcpAuth } from "@/lib/mcp/context";
import { registerTools } from "@/lib/mcp/tools/register";

async function baseHandler(req: Request) {
  const handler = createMcpHandler(
    (server) => {
      if (req.auth) registerTools(server, req.auth);
    },
    { serverInfo: { name: "pulse", version: "1.0.0" } },
    { basePath: "/api", disableSse: true, maxDuration: 60 },
  );
  return handler(req);
}

const authedHandler = withMcpAuth(baseHandler, resolveMcpAuth, {
  required: true,
});

export { authedHandler as GET, authedHandler as POST };

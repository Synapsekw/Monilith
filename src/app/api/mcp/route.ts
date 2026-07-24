import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { resolveMcpAuth } from "@/lib/mcp/context";
import { registerTools } from "@/lib/mcp/tools/register";

const handler = createMcpHandler(
  (server) => {
    registerTools(server);
  },
  { serverInfo: { name: "pulse", version: "1.0.0" } },
  { basePath: "/api", disableSse: true, maxDuration: 60 },
);

const authedHandler = withMcpAuth(handler, resolveMcpAuth, { required: true });

export { authedHandler as GET, authedHandler as POST };

import { monoClientIp } from "@/lib/mono/config";
import { createMonoService } from "@/lib/mono/service";
import { createSupabaseMonoStore } from "@/lib/mono/supabase-store";

export const maxDuration = 60;

// This approved public website protocol uses the existing widget's POST
// contract; it does not perform authenticated workspace mutations.
const handle = createMonoService({
  env: process.env,
  store: createSupabaseMonoStore,
});
export async function GET(request: Request) {
  return handle(request, { ip: monoClientIp(request, process.env) });
}
export async function POST(request: Request) {
  return handle(request, { ip: monoClientIp(request, process.env) });
}

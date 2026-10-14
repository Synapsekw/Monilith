import "server-only";
export class MonoPublicError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export function rejectMono(status: number, message: string): never {
  throw new MonoPublicError(status, message);
}
export function monoResponse(body: unknown, status = 200, cookie?: string) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...(cookie ? { "Set-Cookie": cookie } : {}),
    },
  });
}
export async function boundedJson(
  message: Request | Response,
  limit: number,
): Promise<unknown> {
  if (Number(message.headers.get("content-length")) > limit)
    rejectMono(413, "That request is too large.");
  const reader = message.body?.getReader();
  if (!reader) rejectMono(400, "Missing request.");
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      rejectMono(413, "That request is too large.");
    }
    parts.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString());
  } catch {
    rejectMono(400, "Invalid request.");
  }
}

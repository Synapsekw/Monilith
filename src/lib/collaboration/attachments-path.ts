const MAX_NAME = 120;

/**
 * Make an arbitrary upload filename safe for a Storage object key. Pure.
 * Steps, in order:
 *   1. take the basename (drop everything before the last `/` or `\`),
 *   2. split off a short trailing `.ext`,
 *   3. on the base: remove control chars, keep only `[A-Za-z0-9._ -]`,
 *      collapse runs of whitespace/hyphens to a single `-`, trim stray
 *      leading/trailing `-`/`.`,
 *   4. fall back to `"file"` if nothing safe remains,
 *   5. cap length, preserving the extension.
 */
export function sanitizeFileName(raw: string): string {
  const basename = (raw.split(/[\\/]/).pop() ?? "").trim();
  const extMatch = basename.match(/\.[A-Za-z0-9]{1,12}$/);
  const ext = extMatch ? extMatch[0] : "";
  const rawBase = ext
    ? basename.slice(0, basename.length - ext.length)
    : basename;
  const base = rawBase

    .replace(/[\x00-\x1f\x7f]/g, "") // control chars
    .replace(/[^A-Za-z0-9._ -]/g, "") // conservative safe set
    .replace(/[\s-]+/g, "-") // collapse whitespace + hyphen runs
    .replace(/^[-.]+|[-.]+$/g, ""); // trim stray leading/trailing -/.
  const safeBase = base.length > 0 ? base : "file";
  const room = Math.max(1, MAX_NAME - ext.length);
  return `${safeBase.slice(0, room)}${ext}`;
}

/**
 * Build the bucket object key: <org>/<board>/<item>/<uuid>-<sanitized name>.
 * The leading org segment is what Storage RLS authorizes against. Pure.
 */
export function buildStoragePath(input: {
  orgId: string;
  boardId: string;
  itemId: string;
  fileName: string;
}): string {
  const safe = sanitizeFileName(input.fileName);
  return `${input.orgId}/${input.boardId}/${input.itemId}/${crypto.randomUUID()}-${safe}`;
}

/**
 * Build the bucket object key for a Files-column attachment, which nests the
 * column id one level deeper than an item-level attachment:
 * <org>/<board>/<item>/<column>/<uuid>-<sanitized name>. This matches the
 * prefix guard in `createAttachment` (the column-scoped branch). Pure.
 */
export function buildColumnFilePath(input: {
  orgId: string;
  boardId: string;
  itemId: string;
  columnId: string;
  fileName: string;
}): string {
  const safe = sanitizeFileName(input.fileName);
  return `${input.orgId}/${input.boardId}/${input.itemId}/${input.columnId}/${crypto.randomUUID()}-${safe}`;
}

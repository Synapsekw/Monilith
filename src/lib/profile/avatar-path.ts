/** Pure helpers for avatar object keys. The leading path segment MUST be the
 *  owner's user id — Storage RLS authorizes writes against it. Object key shape:
 *  `{user_id}/{uuid}.{ext}`. A fresh uuid per upload gives every replacement an
 *  immutable public URL (no CDN/browser cache staleness). */

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export function extForMime(mime: string): string {
  const ext = MIME_EXT[mime];
  if (!ext) throw new Error(`Unsupported avatar type: ${mime}`);
  return ext;
}

export function buildAvatarPath(userId: string, mime: string): string {
  return `${userId}/${crypto.randomUUID()}.${extForMime(mime)}`;
}

/** Extract the storage object key from a Supabase public avatars URL, or null
 *  if the string is not one (used to delete the previous object on replace). */
export function pathFromPublicUrl(url: string | null): string | null {
  if (!url) return null;
  const marker = "/storage/v1/object/public/avatars/";
  const i = url.indexOf(marker);
  if (i === -1) return null;
  const key = url.slice(i + marker.length).split("?")[0];
  return key.length > 0 ? key : null;
}

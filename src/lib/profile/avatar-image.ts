"use client";

/** Target edge (px) for the normalized square avatar. Consumers render small
 *  circular chips; 512 is crisp on retina without bloating the upload. */
export const AVATAR_EDGE = 512;
export const AVATAR_OUTPUT_MIME = "image/webp";
export const AVATAR_OUTPUT_QUALITY = 0.85;

/** Pure geometry: the centered square source rect for a WxH image. Testable
 *  without a DOM. */
export function squareCrop(
  width: number,
  height: number,
): { sx: number; sy: number; size: number } {
  const size = Math.min(width, height);
  return {
    sx: Math.round((width - size) / 2),
    sy: Math.round((height - size) / 2),
    size,
  };
}

/** Load a File, center-crop to a square, downscale to AVATAR_EDGE, and re-encode
 *  to a small webp Blob. Browser-only (uses createImageBitmap + canvas). Throws
 *  on decode failure so the caller can surface an error. */
export async function processAvatarImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("Could not read that image.");
  });
  const { sx, sy, size } = squareCrop(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_EDGE;
  canvas.height = AVATAR_EDGE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not available.");
  ctx.drawImage(bitmap, sx, sy, size, size, 0, 0, AVATAR_EDGE, AVATAR_EDGE);
  bitmap.close?.();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, AVATAR_OUTPUT_MIME, AVATAR_OUTPUT_QUALITY),
  );
  if (!blob) throw new Error("Could not process that image.");
  return blob;
}

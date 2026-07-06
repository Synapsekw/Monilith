import { ImageResponse } from "next/og";

// Apple touch icon (iOS home screen / Safari pinned). iOS applies its own
// rounded-corner mask, so the tile is full-bleed; the cleaved-monolith mark
// matches the standalone mark, the favicon, and the collapsed nav rail.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// The cleaved mark (off-white on transparent), centred in a 180 box. Rendered
// as an <img> data URI so next/og rasterises the angled paths via resvg.
const markSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180" fill="none"><g fill="#F5F5F6" transform="translate(90 90) scale(1.45) translate(-50 -51)"><path d="M36 26 L64 18 L64 27 L36 35 Z"/><path d="M36 43 L64 35 L64 84 L36 84 Z"/></g></svg>`;

export default function AppleIcon() {
  const src = `data:image/svg+xml;base64,${Buffer.from(markSvg).toString("base64")}`;

  return new ImageResponse(
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        background: "#0D0D0F",
      }}
    >
      <img width={180} height={180} src={src} alt="" />
    </div>,
    { ...size },
  );
}

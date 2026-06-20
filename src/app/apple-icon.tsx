import { ImageResponse } from "next/og";

// Apple touch icon (iOS home screen / Safari pinned). iOS applies its own
// rounded-corner mask, so the tile is full-bleed; the cleaved-slab mark matches
// the in-app Brand logo and the SVG favicon.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// The mark only (off-white slab on transparent), centred in a 180 box. Rendered
// as an <img> data URI so next/og rasterises the angled path via resvg.
const markSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180" fill="none"><path d="M8.6 5 15.4 3.2V20.8H8.6Z" fill="#F5F5F6" transform="translate(90 90) scale(6.8) translate(-12 -12)"/></svg>`;

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

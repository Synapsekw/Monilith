import type { MetadataRoute } from "next";

// Static web app manifest (served at /manifest.webmanifest). Pure + synchronous
// on purpose: no env, Supabase, or request-time API, so Next prerenders it
// statically and it adds ZERO boot-time/CI env requirements. Offline is out of
// scope — no service worker references here. Icons reuse the cleaved-slab mark.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Monolith — Work OS",
    short_name: "Monolith",
    description:
      "Monolith — a cloud-native Work OS. Visual boards, deep hierarchy, goals, and automations in one coherent product.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0d0d0f",
    theme_color: "#0d0d0f",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

/**
 * Static raster imports (`import shot from "./x.jpg"`) resolve to next/image's
 * StaticImageData. Next declares the same ambient modules in the generated,
 * gitignored `next-env.d.ts` — which does not exist in a fresh worktree until
 * `next dev`/`next build` has run, so `pnpm typecheck` would fail first. This
 * file makes the declaration part of the committed source.
 */
declare module "*.jpg" {
  const content: import("next/image").StaticImageData;
  export default content;
}
declare module "*.jpeg" {
  const content: import("next/image").StaticImageData;
  export default content;
}
declare module "*.png" {
  const content: import("next/image").StaticImageData;
  export default content;
}
declare module "*.webp" {
  const content: import("next/image").StaticImageData;
  export default content;
}

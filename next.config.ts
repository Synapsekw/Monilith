import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this project. Without this, Turbopack walks up and
  // finds C:\Users\D\package-lock.json (the user's global husky/lint-staged setup)
  // and mis-infers the root. See node_modules/next/.../turbopack.md#root-directory.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;

import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const mapStylePath = fileURLToPath(
  new URL("../../packages/map-style", import.meta.url)
);

const nextConfig: NextConfig = {
  turbopack: {
    root: repoRoot,
    resolveAlias: {
      "@local-map/map-style": mapStylePath,
    },
  },
};

export default nextConfig;

import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

/** Monorepo root (parent of `apps/`) so Turbopack can resolve `packages/map-style` via tsconfig paths. */
const monorepoRoot = fileURLToPath(new URL("../../", import.meta.url));

const nextConfig: NextConfig = {
    turbopack: {
        root: monorepoRoot,
    },
};

export default nextConfig;

import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const appRoot = fileURLToPath(new URL(".", import.meta.url));

const nextConfig: NextConfig = {
    turbopack: {
        root: appRoot,
    },
};

export default nextConfig;

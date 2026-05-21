import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

/** Monorepo root (parent of `apps/`) so Turbopack can resolve `packages/map-style` via tsconfig paths. */
const monorepoRoot = fileURLToPath(new URL("../../", import.meta.url));

const nextConfig: NextConfig = {
    turbopack: {
        root: monorepoRoot,
    },
    async redirects() {
        return [
            { source: "/dashboard", destination: "/dashboard/core-review", permanent: false },
            { source: "/buildings", destination: "/dashboard/core-review/buildings", permanent: false },
            { source: "/buildings/:path*", destination: "/dashboard/core-review/buildings/:path*", permanent: false },
            { source: "/places", destination: "/dashboard/core-review/places", permanent: false },
            { source: "/places/:path*", destination: "/dashboard/core-review/places/:path*", permanent: false },
            { source: "/streets", destination: "/dashboard/core-review/roads", permanent: false },
            { source: "/streets/:path*", destination: "/dashboard/core-review/roads/:path*", permanent: false },
            { source: "/admin-areas", destination: "/dashboard/core-review/admin-areas", permanent: false },
            { source: "/admin-areas/:path*", destination: "/dashboard/core-review/admin-areas/:path*", permanent: false },
            { source: "/categories", destination: "/dashboard/references/poi-categories", permanent: false },
            { source: "/categories/:path*", destination: "/dashboard/references/poi-categories/:path*", permanent: false },
            { source: "/stats", destination: "/dashboard/stats", permanent: false },
            { source: "/stats/:path*", destination: "/dashboard/stats/:path*", permanent: false },
            { source: "/import-review", destination: "/dashboard/import-review", permanent: false },
            { source: "/import-review/:path*", destination: "/dashboard/import-review/:path*", permanent: false },
            {
                source: "/dashboard/buildings",
                destination: "/dashboard/core-review/buildings",
                permanent: false,
            },
            {
                source: "/dashboard/buildings/:path*",
                destination: "/dashboard/core-review/buildings/:path*",
                permanent: false,
            },
            { source: "/dashboard/places", destination: "/dashboard/core-review/places", permanent: false },
            {
                source: "/dashboard/places/:path*",
                destination: "/dashboard/core-review/places/:path*",
                permanent: false,
            },
            { source: "/dashboard/streets", destination: "/dashboard/core-review/roads", permanent: false },
            {
                source: "/dashboard/streets/:path*",
                destination: "/dashboard/core-review/roads/:path*",
                permanent: false,
            },
            {
                source: "/dashboard/admin-areas",
                destination: "/dashboard/core-review/admin-areas",
                permanent: false,
            },
            {
                source: "/dashboard/admin-areas/:path*",
                destination: "/dashboard/core-review/admin-areas/:path*",
                permanent: false,
            },
            {
                source: "/dashboard/categories",
                destination: "/dashboard/references/poi-categories",
                permanent: false,
            },
            {
                source: "/dashboard/categories/:path*",
                destination: "/dashboard/references/poi-categories/:path*",
                permanent: false,
            },
        ];
    },
};

export default nextConfig;

import { Prisma } from "@prisma/client";

import type { CoreReviewEntitySlug } from "./core-review.types.js";
import type { CoreReviewListStatusOptions } from "./core-review-list-status.js";

export type CoreReviewLifecycleConfig = CoreReviewListStatusOptions & {
    table: string;
    idKind: "public_id" | "numeric_id";
    supportsSoftDelete: boolean;
    softDeleteExtraSets?: Prisma.Sql[];
    restoreExtraSets?: Prisma.Sql[];
};

const LIFECYCLE_BY_SLUG: Record<CoreReviewEntitySlug, CoreReviewLifecycleConfig> = {
    places: {
        table: "core.core_places",
        idKind: "public_id",
        hasDeletedAt: true,
        hasIsActive: false,
        supportsSoftDelete: true,
        softDeleteExtraSets: [Prisma.sql`is_public = false`],
    },
    buildings: {
        table: "core.core_buildings",
        idKind: "public_id",
        hasDeletedAt: true,
        hasIsActive: true,
        supportsSoftDelete: true,
    },
    streets: {
        table: "core.core_streets",
        idKind: "public_id",
        hasDeletedAt: true,
        hasIsActive: true,
        supportsSoftDelete: true,
        softDeleteExtraSets: [
            Prisma.sql`last_edited_at = now()`,
            Prisma.sql`manual_override = true`,
            Prisma.sql`routing_status = 'needs_rebuild'`,
        ],
        restoreExtraSets: [Prisma.sql`routing_status = 'needs_rebuild'`],
    },
    "land-areas": {
        table: "core.core_land_areas",
        idKind: "public_id",
        hasDeletedAt: true,
        hasIsActive: true,
        supportsSoftDelete: true,
    },
    "water-lines": {
        table: "core.core_water_lines",
        idKind: "numeric_id",
        hasDeletedAt: true,
        hasIsActive: true,
        supportsSoftDelete: true,
    },
    "water-polygons": {
        table: "core.core_water_polygons",
        idKind: "numeric_id",
        hasDeletedAt: true,
        hasIsActive: true,
        supportsSoftDelete: true,
    },
    addresses: {
        table: "core.core_addresses",
        idKind: "public_id",
        hasDeletedAt: true,
        hasIsActive: false,
        supportsSoftDelete: true,
    },
    "admin-areas": {
        table: "core.core_admin_areas",
        idKind: "public_id",
        hasDeletedAt: true,
        hasIsActive: true,
        supportsSoftDelete: true,
    },
};

export function getCoreReviewLifecycleConfig(slug: CoreReviewEntitySlug): CoreReviewLifecycleConfig {
    return LIFECYCLE_BY_SLUG[slug];
}

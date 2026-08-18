import { coreReviewPath } from "@/src/lib/dashboardNavigation";

/** Core-review edit route for a promoted import-review candidate, when configured. */
export function candidateCoreReviewHref(
    apiFamily: string,
    promotedCoreId: string | null | undefined
): string | null {
    const id = promotedCoreId?.trim();
    if (!id || !/^\d+$/.test(id)) {
        return null;
    }

    const segmentByFamily: Record<string, string> = {
        places: "places",
        buildings: "buildings",
        roads: "roads",
        "land-areas": "land-areas",
        addresses: "addresses",
        admin_areas: "admin-areas",
        water_lines: "water-lines",
        water_polygons: "water-polygons",
    };

    const segment = segmentByFamily[apiFamily.trim().toLowerCase().replace(/-/g, "_")];
    if (!segment) {
        return null;
    }

    return coreReviewPath(`${segment}/${id}/edit`);
}

import type { CoreReviewEntitySlug } from "@/src/lib/api";

type DetailRecord = Record<string, unknown>;

function hasPublicId(detail: DetailRecord): boolean {
    return Boolean(detail.public_id ?? detail.publicId);
}

/** True when PATCH /core-review/:entity/:id returned a full detail payload (skip redundant GET). */
export function isCompleteCoreReviewUpdateDetail(
    slug: CoreReviewEntitySlug | string,
    detail: unknown,
): detail is DetailRecord {
    if (!detail || typeof detail !== "object" || Array.isArray(detail)) {
        return false;
    }

    const d = detail as DetailRecord;
    if (!hasPublicId(d)) {
        return false;
    }

    switch (slug) {
        case "streets":
            return (
                d.geometry !== undefined &&
                (d.road_class_id !== undefined || d.roadClassId !== undefined)
            );
        case "places":
            return (
                (typeof d.lat === "number" && typeof d.lng === "number") ||
                d.geometry !== undefined
            );
        case "buildings":
            return d.geometry !== undefined;
        default:
            return true;
    }
}

export async function resolveDetailAfterCoreReviewUpdate<T>(args: {
    slug: CoreReviewEntitySlug | string;
    recordId: string;
    updated: T;
    fetchDetail: (id: string) => Promise<T>;
}): Promise<T> {
    if (isCompleteCoreReviewUpdateDetail(args.slug, args.updated)) {
        return args.updated;
    }
    return args.fetchDetail(args.recordId);
}

export type MergePreviewStopFields = {
    readonly name: string;
    readonly name_mm: string | null;
    readonly name_en: string | null;
    readonly stop_type: string;
    readonly admin_area_id: number | null;
    readonly confidence_score: number | null;
    readonly review_status: string;
    readonly is_active: boolean;
    readonly longitude: number | null;
    readonly latitude: number | null;
};

export type MergePreviewScalarComparison<T> = {
    readonly current: T;
    readonly candidate: T;
    readonly same: boolean;
};

export type MergePreviewGeomComparison = {
    readonly current: { readonly lat: number; readonly lng: number } | null;
    readonly candidate: { readonly lat: number; readonly lng: number } | null;
    readonly same: boolean;
    readonly distanceMeters: number | null;
};

export type TransportStopMergeFieldComparison = {
    readonly name: MergePreviewScalarComparison<string>;
    readonly name_mm: MergePreviewScalarComparison<string | null>;
    readonly name_en: MergePreviewScalarComparison<string | null>;
    readonly stop_type: MergePreviewScalarComparison<string>;
    readonly geom: MergePreviewGeomComparison;
    readonly admin_area_id: MergePreviewScalarComparison<number | null>;
    readonly confidence_score: MergePreviewScalarComparison<number | null>;
    readonly review_status: MergePreviewScalarComparison<string>;
    readonly is_active: MergePreviewScalarComparison<boolean>;
};

function compareScalar<T>(current: T, candidate: T): MergePreviewScalarComparison<T> {
    return {
        current,
        candidate,
        same: current === candidate,
    };
}

export function buildStopMergeFieldComparison(
    current: MergePreviewStopFields,
    candidate: MergePreviewStopFields,
    geomSame: boolean,
    distanceMeters: number | null,
): TransportStopMergeFieldComparison {
    const currentGeom =
        current.longitude !== null && current.latitude !== null
            ? { lng: current.longitude, lat: current.latitude }
            : null;
    const candidateGeom =
        candidate.longitude !== null && candidate.latitude !== null
            ? { lng: candidate.longitude, lat: candidate.latitude }
            : null;

    return {
        name: compareScalar(current.name, candidate.name),
        name_mm: compareScalar(current.name_mm, candidate.name_mm),
        name_en: compareScalar(current.name_en, candidate.name_en),
        stop_type: compareScalar(current.stop_type, candidate.stop_type),
        geom: {
            current: currentGeom,
            candidate: candidateGeom,
            same: geomSame,
            distanceMeters,
        },
        admin_area_id: compareScalar(current.admin_area_id, candidate.admin_area_id),
        confidence_score: compareScalar(current.confidence_score, candidate.confidence_score),
        review_status: compareScalar(current.review_status, candidate.review_status),
        is_active: compareScalar(current.is_active, candidate.is_active),
    };
}

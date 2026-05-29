import type { ImportReviewEntityType } from "@/src/components/map/DataReviewCandidateMap";
import {
    formatVerificationStatusLabel,
    verificationStatusOptions,
} from "@/src/features/core-review/config/verificationStatus";
import type { CoreEntityFormValues } from "@/src/lib/core-review/entityConfigs/types";

/** @deprecated Use verificationStatusOptions from verificationStatus.ts */
export const TRANSPORT_VERIFICATION_STATUS_OPTIONS = verificationStatusOptions;

export const TRANSPORT_MODE_TYPE_OPTIONS = [
    { value: "local_bus", label: "Local bus" },
    { value: "express_bus", label: "Express bus" },
    { value: "train", label: "Train" },
    { value: "ferry", label: "Ferry" },
    { value: "airport_access", label: "Airport access" },
] as const;

export type CoreReviewTransportRouteStopRow = {
    routeVariantId?: string;
    stopId?: string;
    stopSequence?: number;
    distanceFromStartM?: number | null;
    isTimingPoint?: boolean;
};

export function coreReviewTransportMapEntityType(
    entityKey: "bus-stops" | "bus-route-variants",
): ImportReviewEntityType {
    return entityKey === "bus-stops" ? "place" : "road";
}

export function formatTransportVerificationStatus(status: string | null | undefined): string {
    if (!status?.trim()) {
        return "—";
    }
    return formatVerificationStatusLabel(status);
}

export function formatTransportModeType(mode: string | null | undefined): string {
    if (!mode?.trim()) {
        return "—";
    }
    return TRANSPORT_MODE_TYPE_OPTIONS.find((o) => o.value === mode)?.label ?? mode;
}

export function hasRenderableGeometry(geometry: unknown): boolean {
    if (!geometry || typeof geometry !== "object" || !("type" in geometry)) {
        return false;
    }
    const type = (geometry as { type?: string }).type;
    return type === "Point" || type === "LineString" || type === "MultiLineString";
}

export function transportWriteExtras(values: CoreEntityFormValues): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    const status = String(values.verification_status ?? "").trim();
    if (status) {
        payload.verification_status = status;
    }
    const scoreRaw = String(values.confidence_score ?? "").trim();
    if (scoreRaw !== "") {
        const score = Number.parseFloat(scoreRaw);
        if (Number.isFinite(score)) {
            payload.confidence_score = score;
        }
    }
    return payload;
}

export function transportLineageSummary(sourceRefs: unknown, normalizedData: unknown): string | null {
    const refs =
        sourceRefs && typeof sourceRefs === "object" && !Array.isArray(sourceRefs)
            ? (sourceRefs as Record<string, unknown>)
            : null;
    const normalized =
        normalizedData && typeof normalizedData === "object" && !Array.isArray(normalizedData)
            ? (normalizedData as Record<string, unknown>)
            : null;

    const parts: string[] = [];
    const importBatch = refs?.import_batch_id ?? refs?.importBatchId;
    const promotedCoreId = refs?.promoted_core_id ?? refs?.promotedCoreId;
    const source = refs?.source;
    if (source != null && String(source).trim()) {
        parts.push(`source: ${String(source)}`);
    }
    if (importBatch != null && String(importBatch).trim()) {
        parts.push(`import batch: ${String(importBatch)}`);
    }
    if (promotedCoreId != null && String(promotedCoreId).trim()) {
        parts.push(`promoted core id: ${String(promotedCoreId)}`);
    }
    const pipeline = normalized?.pipeline ?? normalized?.promotion_pipeline;
    if (pipeline != null && String(pipeline).trim()) {
        parts.push(`pipeline: ${String(pipeline)}`);
    }
    return parts.length > 0 ? parts.join(" · ") : null;
}

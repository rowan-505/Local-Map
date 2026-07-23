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

/** Coerce Prisma/pg bigint or numeric values into JSON-safe numbers. */
export function jsonSafeNumber(
    value: bigint | number | string | null | undefined,
): number | null {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === "bigint") {
        return Number(value);
    }
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
}

/** Coerce Prisma/pg bigint IDs into JSON-safe decimal strings. */
export function jsonSafeId(
    value: bigint | number | string | null | undefined,
): string | null {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }
    return String(value);
}

export const MERGE_TERMINAL_CONFLICT_BLOCKER = "MERGE_TERMINAL_CONFLICT";

export type MergePreviewTerminalRow = {
    readonly id: bigint | number | string;
    readonly public_id: string;
    readonly linked_stop_id: bigint | number | string;
    readonly name: string | null;
};

export type MergePreviewTerminalSummary = {
    readonly id: string;
    readonly publicId: string;
    readonly name: string;
};

export type MergePreviewTerminalConflict = {
    readonly exists: boolean;
    readonly canonicalTerminal: MergePreviewTerminalSummary | null;
    readonly duplicateTerminal: MergePreviewTerminalSummary | null;
};

function mapTerminalSummary(row: MergePreviewTerminalRow | null): MergePreviewTerminalSummary | null {
    if (!row) {
        return null;
    }
    const id = jsonSafeId(row.id);
    if (!id) {
        return null;
    }
    return {
        id,
        publicId: row.public_id,
        name: row.name?.trim() || "Unnamed terminal",
    };
}

/**
 * Builds terminal-conflict preview for two stops identified by numeric IDs.
 * When both have active linked terminals, merge must be blocked.
 */
export function buildStopMergeTerminalConflict(
    canonicalStopId: bigint,
    duplicateStopId: bigint,
    rows: readonly MergePreviewTerminalRow[],
): MergePreviewTerminalConflict {
    const canonicalRow =
        rows.find((row) => BigInt(row.linked_stop_id) === canonicalStopId) ?? null;
    const duplicateRow =
        rows.find((row) => BigInt(row.linked_stop_id) === duplicateStopId) ?? null;
    const canonicalTerminal = mapTerminalSummary(canonicalRow);
    const duplicateTerminal = mapTerminalSummary(duplicateRow);
    return {
        exists: canonicalTerminal !== null && duplicateTerminal !== null,
        canonicalTerminal,
        duplicateTerminal,
    };
}

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

export type MergePreviewUsageMembership = {
    readonly routeId: string;
    readonly routeCode: string;
    readonly routeName: string;
    readonly variantId: string;
    readonly variantCode: string;
    readonly directionName: string | null;
    readonly routeStopId: string;
    readonly stopSequence: number;
};

export type MergePreviewSameVariantPair = {
    readonly routeId: string;
    readonly routeCode: string;
    readonly routeName: string;
    readonly variantId: string;
    readonly variantCode: string;
    readonly directionName: string | null;
    readonly currentRouteStopId: string;
    readonly currentSequence: number;
    readonly candidateRouteStopId: string;
    readonly candidateSequence: number;
};

export type MergePreviewAffectedRoute = {
    readonly routeId: string;
    readonly routeCode: string;
    readonly routeName: string;
};

export type MergePreviewAffectedVariant = {
    readonly variantId: string;
    readonly variantCode: string;
    readonly routeId: string;
    readonly routeCode: string;
    readonly directionName: string | null;
};

export type MergePreviewDuplicateMembershipConflict = {
    readonly routeId: string;
    readonly routeCode: string;
    readonly variantId: string;
    readonly variantCode: string;
    readonly directionName: string | null;
    readonly currentRouteStopId: string;
    readonly currentSequence: number;
    readonly candidateRouteStopId: string;
    readonly candidateSequence: number;
};

export type MergePreviewSequenceConflict = {
    readonly routeId: string;
    readonly routeCode: string;
    readonly variantId: string;
    readonly variantCode: string;
    readonly directionName: string | null;
    readonly stopSequence: number;
    readonly currentRouteStopId: string;
    readonly candidateRouteStopId: string;
};

export type MergePreviewConflictAnalysis = {
    readonly affectedRoutes: MergePreviewAffectedRoute[];
    readonly affectedVariants: MergePreviewAffectedVariant[];
    readonly duplicateMembershipConflicts: MergePreviewDuplicateMembershipConflict[];
    readonly sequenceConflicts: MergePreviewSequenceConflict[];
    readonly mergeAllowed: boolean;
    readonly mergeBlockers: string[];
};

/**
 * Build merge-preview conflict analysis from usage memberships.
 * Duplicate membership (both stops in the same variant at different sequences) is
 * reported but does not block merge after transport_route_stops_variant_stop_unique
 * was dropped — callers still require acknowledgment at merge time.
 * Same-sequence pairs are hard blockers (would violate sequence uniqueness).
 */
export function buildStopMergeConflictAnalysis(
    currentUsage: readonly MergePreviewUsageMembership[],
    candidateUsage: readonly MergePreviewUsageMembership[],
): MergePreviewConflictAnalysis {
    const routeMap = new Map<string, MergePreviewAffectedRoute>();
    const variantMap = new Map<string, MergePreviewAffectedVariant>();

    const indexUsage = (rows: readonly MergePreviewUsageMembership[]) => {
        for (const row of rows) {
            if (!routeMap.has(row.routeId)) {
                routeMap.set(row.routeId, {
                    routeId: row.routeId,
                    routeCode: row.routeCode,
                    routeName: row.routeName,
                });
            }
            if (!variantMap.has(row.variantId)) {
                variantMap.set(row.variantId, {
                    variantId: row.variantId,
                    variantCode: row.variantCode,
                    routeId: row.routeId,
                    routeCode: row.routeCode,
                    directionName: row.directionName,
                });
            }
        }
    };

    indexUsage(currentUsage);
    indexUsage(candidateUsage);

    const candidateByVariant = new Map<string, MergePreviewUsageMembership[]>();
    for (const row of candidateUsage) {
        const list = candidateByVariant.get(row.variantId) ?? [];
        list.push(row);
        candidateByVariant.set(row.variantId, list);
    }

    const duplicateMembershipConflicts: MergePreviewDuplicateMembershipConflict[] = [];
    const sequenceConflicts: MergePreviewSequenceConflict[] = [];

    for (const current of currentUsage) {
        const candidates = candidateByVariant.get(current.variantId);
        if (!candidates || candidates.length === 0) {
            continue;
        }
        for (const candidate of candidates) {
            const pair = {
                routeId: current.routeId,
                routeCode: current.routeCode,
                variantId: current.variantId,
                variantCode: current.variantCode,
                directionName: current.directionName,
                currentRouteStopId: current.routeStopId,
                currentSequence: current.stopSequence,
                candidateRouteStopId: candidate.routeStopId,
                candidateSequence: candidate.stopSequence,
            };
            if (current.stopSequence === candidate.stopSequence) {
                sequenceConflicts.push({
                    routeId: pair.routeId,
                    routeCode: pair.routeCode,
                    variantId: pair.variantId,
                    variantCode: pair.variantCode,
                    directionName: pair.directionName,
                    stopSequence: current.stopSequence,
                    currentRouteStopId: pair.currentRouteStopId,
                    candidateRouteStopId: pair.candidateRouteStopId,
                });
            } else {
                duplicateMembershipConflicts.push(pair);
            }
        }
    }

    const mergeBlockers: string[] = [];
    if (sequenceConflicts.length > 0) {
        mergeBlockers.push("sequence_conflict");
    }

    return {
        affectedRoutes: [...routeMap.values()].sort((a, b) =>
            a.routeCode.localeCompare(b.routeCode),
        ),
        affectedVariants: [...variantMap.values()].sort((a, b) => {
            const routeCmp = a.routeCode.localeCompare(b.routeCode);
            return routeCmp !== 0 ? routeCmp : a.variantCode.localeCompare(b.variantCode);
        }),
        duplicateMembershipConflicts,
        sequenceConflicts,
        mergeAllowed: mergeBlockers.length === 0,
        mergeBlockers,
    };
}

/** Extract Prisma client error code (e.g. P2002, P2010) when present. */
export function extractPrismaErrorCode(error: unknown): string | null {
    if (!error || typeof error !== "object") {
        return null;
    }
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^P\d{4}$/.test(code)) {
        return code;
    }
    return null;
}

/** Best-effort constraint / table name from Prisma meta or driver message. */
export function extractConstraintMeta(error: unknown): {
    readonly constraintName: string | null;
    readonly tableName: string | null;
} {
    if (!error || typeof error !== "object") {
        return { constraintName: null, tableName: null };
    }
    const meta = (error as { meta?: Record<string, unknown> }).meta ?? {};
    const constraintName =
        typeof meta.constraint === "string"
            ? meta.constraint
            : typeof meta.target === "string"
              ? meta.target
              : Array.isArray(meta.target)
                ? meta.target.map(String).join(",")
                : null;
    const tableName = typeof meta.table === "string" ? meta.table : null;
    if (constraintName || tableName) {
        return { constraintName, tableName };
    }
    if (error instanceof Error) {
        const constraintMatch = /constraint \"([^\"]+)\"/i.exec(error.message);
        const tableMatch = /relation \"([^\"]+)\"/i.exec(error.message);
        return {
            constraintName: constraintMatch?.[1] ?? null,
            tableName: tableMatch?.[1] ?? null,
        };
    }
    return { constraintName: null, tableName: null };
}

/** Extract Postgres SQLSTATE from Prisma / driver errors when present. */
export function extractSqlErrorCode(error: unknown): string | null {
    if (!error || typeof error !== "object") {
        return null;
    }
    const meta = (error as { meta?: { code?: unknown; database_error_code?: unknown } }).meta;
    if (typeof meta?.code === "string" && /^\d{5}$/.test(meta.code)) {
        return meta.code;
    }
    if (typeof meta?.database_error_code === "string" && /^\d{5}$/.test(meta.database_error_code)) {
        return meta.database_error_code;
    }
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^\d{5}$/.test(code)) {
        return code;
    }
    if (error instanceof Error) {
        const match = /\b([0-9A-Z]{5})\b/.exec(error.message);
        if (match?.[1] && /^\d{5}$/.test(match[1])) {
            return match[1];
        }
        const prismaMatch = /Code:\s*`?(\d{5})`?/i.exec(error.message);
        if (prismaMatch?.[1]) {
            return prismaMatch[1];
        }
    }
    return null;
}

/** True when an error already carries an HTTP auth status (do not remap to 500). */
export function isHttpAuthError(error: unknown): error is { statusCode: 401 | 403 } {
    if (!error || typeof error !== "object") {
        return false;
    }
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    return statusCode === 401 || statusCode === 403;
}

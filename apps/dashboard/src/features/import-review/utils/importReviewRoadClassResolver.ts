import type { ImportReviewBuildingListItem } from "@/src/lib/api";
import type { RoadClassOption } from "@/src/lib/api";

export type ImportReviewRoadClassOptionInput = Pick<RoadClassOption, "id" | "code">;

export type ResolvedImportReviewRoadClass = {
    /** Dropdown value (ref.ref_road_classes id string) when mappable. */
    roadClassId: string | null;
    /** OSM/ref code when id is unknown but code is known. */
    roadClassCode: string | null;
    /** Same label the road list column should show. */
    displayLabel: string | null;
    /** Which priority step produced the resolution (tests / debug). */
    resolutionSource: string | null;
};

export type ImportReviewRoadClassLookup = {
    idByCode: Map<string, string>;
    codeById: Map<string, string>;
    labelById: Map<string, string>;
};

function typedColumnFields(fields: unknown): Record<string, unknown> {
    if (fields && typeof fields === "object" && !Array.isArray(fields)) {
        return fields as Record<string, unknown>;
    }
    return {};
}

function trimString(value: unknown): string | null {
    if (value === null || value === undefined) {
        return null;
    }
    const s = String(value).trim();
    return s.length > 0 ? s : null;
}

function normPick(data: unknown, key: string): unknown {
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
        return undefined;
    }
    const o = data as Record<string, unknown>;
    if (key in o) {
        return o[key];
    }
    const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    if (camel in o) {
        return o[camel];
    }
    return undefined;
}

function highwayFromNormalized(data: unknown): string | null {
    const tags = normPick(data, "tags");
    if (tags && typeof tags === "object" && !Array.isArray(tags)) {
        const hw = (tags as Record<string, unknown>).highway;
        if (typeof hw === "string" && hw.trim()) {
            return hw.trim();
        }
    }
    const direct = normPick(data, "highway");
    if (typeof direct === "string" && direct.trim()) {
        return direct.trim();
    }
    return null;
}

function highwayFromSourceRefs(source_refs: unknown): string | null {
    if (source_refs === null || typeof source_refs !== "object" || Array.isArray(source_refs)) {
        return null;
    }
    const root = source_refs as Record<string, unknown>;
    const candidates: unknown[] = [
        normPick(root, "highway"),
        normPick(root, "tags") && typeof normPick(root, "tags") === "object"
            ? (normPick(root, "tags") as Record<string, unknown>).highway
            : undefined,
        root.osm && typeof root.osm === "object" && !Array.isArray(root.osm)
            ? (root.osm as Record<string, unknown>).highway
            : undefined,
    ];
    for (const value of candidates) {
        const text = trimString(value);
        if (text) {
            return text;
        }
    }
    return null;
}

/** Normalize list labels like `secondary — Secondary` to bare code when needed. */
export function normalizeRoadClassCodeToken(raw: string | null | undefined): string | null {
    const trimmed = trimString(raw);
    if (!trimmed) {
        return null;
    }
    const beforeDash = trimmed.split("—")[0]?.split(" - ")[0]?.trim();
    return beforeDash && beforeDash.length > 0 ? beforeDash : trimmed;
}

export function buildImportReviewRoadClassLookup(
    options: readonly ImportReviewRoadClassOptionInput[]
): ImportReviewRoadClassLookup {
    const idByCode = new Map<string, string>();
    const codeById = new Map<string, string>();
    const labelById = new Map<string, string>();

    for (const option of options) {
        const id = trimString(option.id);
        const code = normalizeRoadClassCodeToken(option.code);
        if (!id) {
            continue;
        }
        if (code) {
            idByCode.set(code.toLowerCase(), id);
            codeById.set(id, code);
            labelById.set(id, code);
        } else {
            labelById.set(id, id);
        }
    }

    return { idByCode, codeById, labelById };
}

function resolveFromId(
    id: string,
    lookup: ImportReviewRoadClassLookup,
    source: string
): ResolvedImportReviewRoadClass {
    const trimmedId = id.trim();
    const code = lookup.codeById.get(trimmedId) ?? null;
    const displayLabel = lookup.labelById.get(trimmedId) ?? code ?? trimmedId;
    return {
        roadClassId: trimmedId,
        roadClassCode: code,
        displayLabel,
        resolutionSource: source,
    };
}

function resolveFromCode(
    code: string,
    lookup: ImportReviewRoadClassLookup,
    source: string
): ResolvedImportReviewRoadClass {
    const normalized = normalizeRoadClassCodeToken(code);
    if (!normalized) {
        return { roadClassId: null, roadClassCode: null, displayLabel: null, resolutionSource: null };
    }
    const mappedId = lookup.idByCode.get(normalized.toLowerCase()) ?? null;
    return {
        roadClassId: mappedId,
        roadClassCode: normalized,
        displayLabel: normalized,
        resolutionSource: source,
    };
}

/**
 * Single resolver for road list ROAD CLASS column and edit-drawer dropdown seed/save.
 *
 * Priority:
 * A. fields.road_class_id
 * B. fields.road_class_code or fields.class_code
 * C. candidate road_class_id (road_candidate_road_class_id / row.road_class_id)
 * D. candidate.class_code
 * E. candidate.road_class_code (road_class column / road_candidate_class_label)
 * F. normalized_data.highway
 * G. source_refs highway tag
 */
export function resolveImportReviewRoadClassValue(
    row: ImportReviewBuildingListItem,
    roadClassOptions: readonly ImportReviewRoadClassOptionInput[]
): ResolvedImportReviewRoadClass {
    const lookup = buildImportReviewRoadClassLookup(roadClassOptions);
    const ov = typedColumnFields(row);
    const empty: ResolvedImportReviewRoadClass = {
        roadClassId: null,
        roadClassCode: null,
        displayLabel: null,
        resolutionSource: null,
    };

    if (Object.prototype.hasOwnProperty.call(ov, "road_class_id")) {
        const overrideId = ov.road_class_id === null ? null : trimString(ov.road_class_id);
        if (overrideId) {
            return resolveFromId(overrideId, lookup, "fields.road_class_id");
        }
    } else if (trimString(ov.road_class_id)) {
        return resolveFromId(trimString(ov.road_class_id)!, lookup, "fields.road_class_id");
    }

    for (const [source, raw] of [
        ["fields.road_class_code", ov.road_class_code],
        ["fields.class_code", ov.class_code],
    ] as const) {
        const code = trimString(raw);
        if (code) {
            return resolveFromCode(code, lookup, source);
        }
    }

    const candidateId =
        trimString(row.road_candidate_road_class_id) ??
        trimString((row as Record<string, unknown>).road_class_id);
    if (candidateId) {
        return resolveFromId(candidateId, lookup, "candidate.road_class_id");
    }

    const classCode = trimString(row.class_code) ?? trimString(row.effective_class_code);
    if (classCode) {
        return resolveFromCode(classCode, lookup, "candidate.class_code");
    }

    const candidateLabel = trimString(row.road_candidate_class_label);
    if (candidateLabel) {
        return resolveFromCode(candidateLabel, lookup, "candidate.road_candidate_class_label");
    }

    const roadClassText = trimString((row as Record<string, unknown>).road_class);
    if (roadClassText) {
        return resolveFromCode(roadClassText, lookup, "candidate.road_class");
    }

    const highway =
        highwayFromNormalized(row.normalized_data) ?? highwayFromSourceRefs(row.source_refs);
    if (highway) {
        return resolveFromCode(highway, lookup, "imported.highway");
    }

    return empty;
}

/** List column display — uses the same resolver as the edit drawer. */
export function deriveRoadListRoadClassLabel(
    row: ImportReviewBuildingListItem,
    roadClassOptions: readonly ImportReviewRoadClassOptionInput[]
): string | null {
    const resolved = resolveImportReviewRoadClassValue(row, roadClassOptions);
    return resolved.displayLabel;
}

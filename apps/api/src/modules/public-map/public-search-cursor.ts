import type { SearchPublicMapMode } from "./public-map.repo.js";
import type {
    PublicSearchCategory,
    PublicSearchTransportMode,
    PublicSearchTransportType,
} from "./public-search-filters.js";
import {
    normalizePublicSearchLang,
    type PublicSearchLang,
} from "./public-search-language.js";

export const PUBLIC_SEARCH_CURSOR_VERSION = 3 as const;

/** Continuation position in the unified search sort order. */
export type PublicSearchCursorAfter = {
    readonly score: number;
    readonly importanceScore: number;
    readonly displayName: string;
    readonly entityType: string;
    readonly entityId: string;
};

/** Query binding stored in the cursor so pages cannot be mixed across searches. */
export type PublicSearchCursorContext = {
    readonly q: string;
    /** Search match strategy: prefix (2-char) or full. */
    readonly mode: SearchPublicMapMode;
    /** Legacy comma-separated entity types (intersected with category filters). */
    readonly types: readonly string[];
    readonly lat: number | null;
    readonly lng: number | null;
    readonly category: PublicSearchCategory;
    readonly transportType: PublicSearchTransportType;
    readonly transportMode: PublicSearchTransportMode;
    /** Display language binding for localized result labels (null = API default chain). */
    readonly lang: PublicSearchLang | null;
};

export type PublicSearchCursorPayload = {
    readonly v: typeof PUBLIC_SEARCH_CURSOR_VERSION;
    readonly ctx: PublicSearchCursorContext;
    readonly after: PublicSearchCursorAfter;
};

export class InvalidPublicSearchCursorError extends Error {
    constructor(message = "Invalid search cursor") {
        super(message);
        this.name = "InvalidPublicSearchCursorError";
    }
}

export function normalizePublicSearchCursorContext(input: {
    q: string;
    mode: SearchPublicMapMode;
    types: readonly string[];
    lat?: number | null | undefined;
    lng?: number | null | undefined;
    category?: PublicSearchCategory | undefined;
    transportType?: PublicSearchTransportType | undefined;
    transportMode?: PublicSearchTransportMode | undefined;
    lang?: PublicSearchLang | null | undefined;
}): PublicSearchCursorContext {
    return {
        q: input.q.trim(),
        mode: input.mode,
        types: [...new Set(input.types.map((type) => type.trim().toLowerCase()))].sort(),
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        category: input.category ?? "all",
        transportType: input.transportType ?? "all",
        transportMode: input.transportMode ?? "all",
        lang: input.lang ?? null,
    };
}

export function normalizePublicSearchSortScore(value: number | null | undefined): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function publicSearchCursorAfterFromRow(row: {
    score: number | null;
    importance_score: number;
    display_name: string | null;
    entity_type: string;
    entity_id: string;
}): PublicSearchCursorAfter {
    return {
        score: normalizePublicSearchSortScore(row.score),
        importanceScore: row.importance_score,
        displayName: row.display_name ?? "",
        entityType: row.entity_type,
        entityId: row.entity_id,
    };
}

/**
 * Deterministic sort key for unified public search:
 * score DESC, importance DESC, display_name ASC, entity_type ASC, entity_id ASC.
 * Returns negative when `a` ranks higher than `b`.
 */
export function compareUnifiedSearchSortKeys(
    a: PublicSearchCursorAfter,
    b: PublicSearchCursorAfter,
): number {
    if (a.score !== b.score) return b.score - a.score;
    if (a.importanceScore !== b.importanceScore) return b.importanceScore - a.importanceScore;
    if (a.displayName !== b.displayName) return a.displayName.localeCompare(b.displayName);
    if (a.entityType !== b.entityType) return a.entityType.localeCompare(b.entityType);
    const aId = BigInt(a.entityId);
    const bId = BigInt(b.entityId);
    if (aId < bId) return -1;
    if (aId > bId) return 1;
    return 0;
}

/** True when `row` sorts strictly after `after` (eligible for the next page). */
export function isUnifiedSearchRowAfterCursor(
    row: PublicSearchCursorAfter,
    after: PublicSearchCursorAfter,
): boolean {
    return compareUnifiedSearchSortKeys(row, after) > 0;
}

export function encodePublicSearchCursor(payload: PublicSearchCursorPayload): string {
    return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodePublicSearchCursor(cursor: string): PublicSearchCursorPayload {
    let parsed: unknown;
    try {
        const json = Buffer.from(cursor, "base64url").toString("utf8");
        parsed = JSON.parse(json) as unknown;
    } catch {
        throw new InvalidPublicSearchCursorError();
    }

    if (!parsed || typeof parsed !== "object") {
        throw new InvalidPublicSearchCursorError();
    }

    const record = parsed as Record<string, unknown>;
    const version = record.v;
    if (version !== 1 && version !== 2 && version !== 3) {
        throw new InvalidPublicSearchCursorError();
    }

    const ctx = record.ctx;
    const after = record.after;
    if (!ctx || typeof ctx !== "object" || !after || typeof after !== "object") {
        throw new InvalidPublicSearchCursorError();
    }

    const ctxRecord = ctx as Record<string, unknown>;
    const afterRecord = after as Record<string, unknown>;

    if (typeof ctxRecord.q !== "string" || ctxRecord.q.trim() === "") {
        throw new InvalidPublicSearchCursorError();
    }
    if (ctxRecord.mode !== "full" && ctxRecord.mode !== "prefix") {
        throw new InvalidPublicSearchCursorError();
    }
    if (!Array.isArray(ctxRecord.types) || !ctxRecord.types.every((t) => typeof t === "string")) {
        throw new InvalidPublicSearchCursorError();
    }

    const lat = ctxRecord.lat;
    const lng = ctxRecord.lng;
    if (lat !== null && (typeof lat !== "number" || !Number.isFinite(lat))) {
        throw new InvalidPublicSearchCursorError();
    }
    if (lng !== null && (typeof lng !== "number" || !Number.isFinite(lng))) {
        throw new InvalidPublicSearchCursorError();
    }

    if (typeof afterRecord.score !== "number" || !Number.isFinite(afterRecord.score)) {
        throw new InvalidPublicSearchCursorError();
    }
    if (
        typeof afterRecord.importanceScore !== "number" ||
        !Number.isFinite(afterRecord.importanceScore)
    ) {
        throw new InvalidPublicSearchCursorError();
    }
    if (typeof afterRecord.displayName !== "string") {
        throw new InvalidPublicSearchCursorError();
    }
    if (typeof afterRecord.entityType !== "string" || afterRecord.entityType.trim() === "") {
        throw new InvalidPublicSearchCursorError();
    }
    if (typeof afterRecord.entityId !== "string" || !/^\d+$/.test(afterRecord.entityId)) {
        throw new InvalidPublicSearchCursorError();
    }

    const categoryRaw = ctxRecord.category;
    const transportTypeRaw = ctxRecord.transportType;
    const transportModeRaw = ctxRecord.transportMode;

    const category =
        version >= 2 && typeof categoryRaw === "string" ? categoryRaw : "all";
    const transportType =
        version >= 2 && typeof transportTypeRaw === "string" ? transportTypeRaw : "all";
    const transportMode =
        version >= 2 && typeof transportModeRaw === "string" ? transportModeRaw : "all";

    const langRaw = ctxRecord.lang;
    const lang =
        version >= 3 && (langRaw === "my" || langRaw === "en" || langRaw === "und")
            ? langRaw
            : null;

    if (
        category !== "all" &&
        category !== "places" &&
        category !== "areas" &&
        category !== "roads" &&
        category !== "transport" &&
        category !== "addresses"
    ) {
        throw new InvalidPublicSearchCursorError();
    }
    if (
        transportType !== "all" &&
        transportType !== "stops" &&
        transportType !== "stations" &&
        transportType !== "terminals" &&
        transportType !== "routes"
    ) {
        throw new InvalidPublicSearchCursorError();
    }
    if (
        transportMode !== "all" &&
        transportMode !== "bus" &&
        transportMode !== "train" &&
        transportMode !== "express" &&
        transportMode !== "ferry" &&
        transportMode !== "flight" &&
        transportMode !== "other"
    ) {
        throw new InvalidPublicSearchCursorError();
    }

    return {
        v: PUBLIC_SEARCH_CURSOR_VERSION,
        ctx: {
            q: ctxRecord.q.trim(),
            mode: ctxRecord.mode,
            types: [...ctxRecord.types].map((type) => type.trim().toLowerCase()).sort(),
            lat: lat ?? null,
            lng: lng ?? null,
            category,
            transportType,
            transportMode,
            lang,
        },
        after: {
            score: afterRecord.score,
            importanceScore: afterRecord.importanceScore,
            displayName: afterRecord.displayName,
            entityType: afterRecord.entityType,
            entityId: afterRecord.entityId,
        },
    };
}

export function assertPublicSearchCursorMatchesRequest(
    cursorContext: PublicSearchCursorContext,
    requestContext: PublicSearchCursorContext,
): void {
    const normalizedCursor = normalizePublicSearchCursorContext(cursorContext);
    const normalizedRequest = normalizePublicSearchCursorContext(requestContext);

    if (normalizedCursor.q !== normalizedRequest.q) {
        throw new InvalidPublicSearchCursorError("Search cursor does not match query");
    }
    if (normalizedCursor.mode !== normalizedRequest.mode) {
        throw new InvalidPublicSearchCursorError("Search cursor does not match query mode");
    }
    if (normalizedCursor.lat !== normalizedRequest.lat || normalizedCursor.lng !== normalizedRequest.lng) {
        throw new InvalidPublicSearchCursorError("Search cursor does not match reference location");
    }
    if (normalizedCursor.types.join("\0") !== normalizedRequest.types.join("\0")) {
        throw new InvalidPublicSearchCursorError("Search cursor does not match type filter");
    }
    if (normalizedCursor.category !== normalizedRequest.category) {
        throw new InvalidPublicSearchCursorError("Search cursor does not match category filter");
    }
    if (normalizedCursor.transportType !== normalizedRequest.transportType) {
        throw new InvalidPublicSearchCursorError("Search cursor does not match transport type filter");
    }
    if (normalizedCursor.transportMode !== normalizedRequest.transportMode) {
        throw new InvalidPublicSearchCursorError("Search cursor does not match transport mode filter");
    }
    if (normalizedCursor.lang !== normalizedRequest.lang) {
        throw new InvalidPublicSearchCursorError("Search cursor does not match language");
    }
}

export { normalizePublicSearchLang };

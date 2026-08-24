import { Prisma } from "@prisma/client";

/** Match strategy from `planPublicSearch` — mirrored here to avoid a repo import cycle. */
export type UnifiedSearchRankingMode = "prefix" | "full";

/**
 * Canonical unified public search ranking weights.
 * SQL score expressions are generated from these values — do not duplicate elsewhere.
 */
export const UNIFIED_SEARCH_RANKING_WEIGHTS = {
    codeExact: 100,
    nameExact: 80,
    /** Strong exact alias match (search_document_names), below primary name exact. */
    aliasExact: 65,
    prefix: 40,
    fullText: 30,
    trigramMultiplier: 25,
    multiToken: 60,
    verified: 8,
    importanceMultiplier: 0.15,
    confidenceMultiplier: 0.05,
    distanceMax: 20,
    distanceDecayMeters: 5000,
    /** Distance multiplier when the row only has a weak fuzzy text match. */
    distanceWeakTextMultiplier: 0.35,
} as const;

/** Minimum pg_trgm similarity for fuzzy-only eligibility and scoring (by query length). */
export const UNIFIED_SEARCH_FUZZY_THRESHOLDS = {
    shortQueryMaxLength: 3,
    short: 0.38,
    mediumQueryMaxLength: 5,
    medium: 0.3,
    long: 0.24,
} as const;

/** Small entity-type preference — must not override a strong exact text match. */
export const UNIFIED_SEARCH_ENTITY_TYPE_WEIGHTS = {
    settlement: 13,
    place: 12,
    admin_area: 10,
    address: 8,
    transport_terminal: 8,
    street_group: 6,
    street: 6,
    transport_route: 4,
    transport_route_variant: 4,
    bus_route: 4,
    bus_route_variant: 4,
    transport_stop_station: 6,
    transport_stop: 2,
    bus_stop: 2,
    building: 0,
    land_area: -2,
    water_line: -2,
    water_polygon: -2,
} as const;

/** Review-quality adjustments from transport address_parts or verified places. */
export const UNIFIED_SEARCH_REVIEW_QUALITY_WEIGHTS = {
    verified: 4,
    manual_protected: 4,
    reviewed: 3,
    needs_review: -6,
    imported_unreviewed: -25,
    verifiedPlaceFallback: 3,
} as const;

/** Per-component score breakdown for tests and admin diagnostics (not returned publicly). */
export type UnifiedSearchScoreExplanation = {
    codeMatch: number;
    exactMatch: number;
    aliasExactMatch: number;
    prefixMatch: number;
    fullText: number;
    trigram: number;
    multiToken: number;
    entityTypeWeight: number;
    reviewQualityWeight: number;
    verificationWeight: number;
    importanceWeight: number;
    confidenceWeight: number;
    distanceWeight: number;
    finalScore: number;
};

/** Document fields required to explain ranking outside Postgres. */
export type UnifiedSearchRankingDocument = {
    code?: string | null;
    displayName?: string | null;
    primaryNameMy?: string | null;
    primaryNameEn?: string | null;
    primaryNameUnd?: string | null;
    trigramText?: string | null;
    ftsMatches?: boolean;
    trigramSimilarity?: number;
    allTokensMatch?: boolean;
    aliasExactMatch?: boolean;
    importanceScore?: number;
    confidenceScore?: number;
    isVerified?: boolean;
    distanceMeters?: number | null;
    entityType?: string;
    stopType?: string | null;
    reviewStatus?: string | null;
};

export type BuildUnifiedSearchScoreSqlParams = {
    qNorm: string;
    prefix: string;
    isPrefixMode: boolean;
    multiTokenMatch: Prisma.Sql | null;
    fuzzyThreshold: number;
    hasRef: boolean;
    lat?: number;
    lng?: number;
};

export type BuildUnifiedSearchCandidateMatchSqlParams = {
    qNorm: string;
    prefix: string;
    isPrefixMode: boolean;
    multiTokenMatch: Prisma.Sql | null;
    fuzzyThreshold: number;
};

function normalizeOptionalText(value: string | null | undefined): string {
    return (value ?? "").trim().toLowerCase();
}

export function resolveFuzzySimilarityThreshold(
    qNorm: string,
    mode: UnifiedSearchRankingMode,
): number {
    if (mode === "prefix") {
        return 1;
    }
    const len = qNorm.trim().length;
    const thresholds = UNIFIED_SEARCH_FUZZY_THRESHOLDS;
    if (len <= thresholds.shortQueryMaxLength) {
        return thresholds.short;
    }
    if (len <= thresholds.mediumQueryMaxLength) {
        return thresholds.medium;
    }
    return thresholds.long;
}

function hasExactCodeMatch(qNorm: string, doc: UnifiedSearchRankingDocument): boolean {
    return normalizeOptionalText(doc.code) === qNorm;
}

function hasExactNameMatch(qNorm: string, doc: UnifiedSearchRankingDocument): boolean {
    return (
        normalizeOptionalText(doc.displayName) === qNorm ||
        normalizeOptionalText(doc.primaryNameMy) === qNorm ||
        normalizeOptionalText(doc.primaryNameEn) === qNorm ||
        normalizeOptionalText(doc.primaryNameUnd) === qNorm
    );
}

function hasPrefixMatch(qNorm: string, doc: UnifiedSearchRankingDocument): boolean {
    const display = normalizeOptionalText(doc.displayName);
    const trigram = normalizeOptionalText(doc.trigramText);
    return display.startsWith(qNorm) || trigram.startsWith(qNorm);
}

function hasAliasExactMatch(qNorm: string, doc: UnifiedSearchRankingDocument): boolean {
    if (doc.aliasExactMatch === true) {
        return !hasExactNameMatch(qNorm, doc);
    }
    return false;
}

export function hasStrongUnifiedSearchTextMatch(
    qNorm: string,
    mode: UnifiedSearchRankingMode,
    doc: UnifiedSearchRankingDocument,
): boolean {
    if (hasExactCodeMatch(qNorm, doc) || hasExactNameMatch(qNorm, doc)) {
        return true;
    }
    if (hasAliasExactMatch(qNorm, doc)) {
        return true;
    }
    if (hasPrefixMatch(qNorm, doc)) {
        return true;
    }
    if (mode !== "prefix" && doc.ftsMatches === true) {
        return true;
    }
    if (mode !== "prefix" && doc.allTokensMatch === true) {
        return true;
    }
    return false;
}

export function isUnifiedSearchFuzzyEligible(
    qNorm: string,
    mode: UnifiedSearchRankingMode,
    doc: UnifiedSearchRankingDocument,
): boolean {
    if (mode === "prefix") {
        return false;
    }
    if (hasStrongUnifiedSearchTextMatch(qNorm, mode, doc)) {
        return true;
    }
    const similarity = doc.trigramSimilarity ?? 0;
    return similarity >= resolveFuzzySimilarityThreshold(qNorm, mode);
}

export function isUnifiedSearchCandidateEligible(
    qNorm: string,
    mode: UnifiedSearchRankingMode,
    doc: UnifiedSearchRankingDocument,
): boolean {
    if (mode === "prefix") {
        return (
            hasExactCodeMatch(qNorm, doc) ||
            normalizeOptionalText(doc.displayName).startsWith(qNorm) ||
            normalizeOptionalText(doc.trigramText).startsWith(qNorm)
        );
    }
    if (doc.allTokensMatch === true) {
        return true;
    }
    if (hasExactCodeMatch(qNorm, doc) || hasExactNameMatch(qNorm, doc)) {
        return true;
    }
    if (hasAliasExactMatch(qNorm, doc) || doc.aliasExactMatch === true) {
        return true;
    }
    if (hasPrefixMatch(qNorm, doc)) {
        return true;
    }
    if (doc.ftsMatches === true) {
        return true;
    }
    const trigram = normalizeOptionalText(doc.trigramText);
    if (trigram.includes(qNorm)) {
        return isUnifiedSearchFuzzyEligible(qNorm, mode, doc);
    }
    return isUnifiedSearchFuzzyEligible(qNorm, mode, doc);
}

export function computeUnifiedSearchEntityTypeWeight(
    entityType: string | null | undefined,
    stopType?: string | null,
): number {
    const normalizedType = (entityType ?? "").trim().toLowerCase();
    const normalizedStopType = (stopType ?? "").trim().toLowerCase();

    if (
        normalizedType === "transport_stop" ||
        normalizedType === "bus_stop"
    ) {
        if (normalizedStopType === "station" || normalizedStopType === "airport") {
            return UNIFIED_SEARCH_ENTITY_TYPE_WEIGHTS.transport_stop_station;
        }
        return UNIFIED_SEARCH_ENTITY_TYPE_WEIGHTS.transport_stop;
    }

    return (
        UNIFIED_SEARCH_ENTITY_TYPE_WEIGHTS[
            normalizedType as keyof typeof UNIFIED_SEARCH_ENTITY_TYPE_WEIGHTS
        ] ?? 0
    );
}

export function computeUnifiedSearchReviewQualityWeight(input: {
    reviewStatus?: string | null;
    isVerified?: boolean;
    entityType?: string | null;
}): number {
    const reviewStatus = normalizeOptionalText(input.reviewStatus);
    const weights = UNIFIED_SEARCH_REVIEW_QUALITY_WEIGHTS;

    if (reviewStatus === "verified") return weights.verified;
    if (reviewStatus === "manual_protected") return weights.manual_protected;
    if (reviewStatus === "reviewed") return weights.reviewed;
    if (reviewStatus === "needs_review") return weights.needs_review;
    if (reviewStatus === "imported_unreviewed") return weights.imported_unreviewed;

    const entityType = (input.entityType ?? "").trim().toLowerCase();
    if (
        input.isVerified === true &&
        (entityType === "place" || entityType === "admin_area" || entityType === "address")
    ) {
        return weights.verifiedPlaceFallback;
    }

    return 0;
}

export function computeUnifiedSearchDistanceWeight(
    distanceMeters: number | null | undefined,
    strongTextMatch: boolean,
): number {
    if (distanceMeters == null || !Number.isFinite(distanceMeters) || distanceMeters < 0) {
        return 0;
    }
    const { distanceMax, distanceDecayMeters, distanceWeakTextMultiplier } =
        UNIFIED_SEARCH_RANKING_WEIGHTS;
    const base = distanceMax * Math.exp(-distanceMeters / distanceDecayMeters);
    return strongTextMatch ? base : base * distanceWeakTextMultiplier;
}

export function sumUnifiedSearchScoreExplanation(
    explanation: Omit<UnifiedSearchScoreExplanation, "finalScore">,
): number {
    return (
        explanation.codeMatch +
        explanation.exactMatch +
        explanation.aliasExactMatch +
        explanation.prefixMatch +
        explanation.fullText +
        explanation.trigram +
        explanation.multiToken +
        explanation.entityTypeWeight +
        explanation.reviewQualityWeight +
        explanation.verificationWeight +
        explanation.importanceWeight +
        explanation.confidenceWeight +
        explanation.distanceWeight
    );
}

export function explainUnifiedSearchScore(
    qNorm: string,
    mode: UnifiedSearchRankingMode,
    doc: UnifiedSearchRankingDocument,
): UnifiedSearchScoreExplanation | null {
    if (!isUnifiedSearchCandidateEligible(qNorm, mode, doc)) {
        return null;
    }

    const normalizedQuery = qNorm.trim().toLowerCase();
    const isPrefixMode = mode === "prefix";
    const weights = UNIFIED_SEARCH_RANKING_WEIGHTS;
    const fuzzyThreshold = resolveFuzzySimilarityThreshold(normalizedQuery, mode);
    const strongTextMatch = hasStrongUnifiedSearchTextMatch(normalizedQuery, mode, doc);

    const codeMatch = hasExactCodeMatch(normalizedQuery, doc) ? weights.codeExact : 0;
    const exactMatch = hasExactNameMatch(normalizedQuery, doc) ? weights.nameExact : 0;
    const aliasExactMatch = hasAliasExactMatch(normalizedQuery, doc) ? weights.aliasExact : 0;
    const prefixMatch = hasPrefixMatch(normalizedQuery, doc) ? weights.prefix : 0;

    const fullText = !isPrefixMode && doc.ftsMatches === true ? weights.fullText : 0;
    const trigramSimilarity = doc.trigramSimilarity ?? 0;
    const trigram =
        !isPrefixMode && trigramSimilarity >= fuzzyThreshold
            ? trigramSimilarity * weights.trigramMultiplier
            : 0;
    const multiToken = !isPrefixMode && doc.allTokensMatch === true ? weights.multiToken : 0;

    const entityTypeWeight = computeUnifiedSearchEntityTypeWeight(doc.entityType, doc.stopType);
    const reviewQualityWeight = computeUnifiedSearchReviewQualityWeight({
        reviewStatus: doc.reviewStatus,
        isVerified: doc.isVerified,
        entityType: doc.entityType,
    });
    const importanceWeight = (doc.importanceScore ?? 0) * weights.importanceMultiplier;
    const confidenceWeight = (doc.confidenceScore ?? 0) * weights.confidenceMultiplier;
    const verificationWeight = doc.isVerified === true ? weights.verified : 0;
    const distanceWeight = computeUnifiedSearchDistanceWeight(
        doc.distanceMeters,
        strongTextMatch,
    );

    const partial = {
        codeMatch,
        exactMatch,
        aliasExactMatch,
        prefixMatch,
        fullText,
        trigram,
        multiToken,
        entityTypeWeight,
        reviewQualityWeight,
        verificationWeight,
        importanceWeight,
        confidenceWeight,
        distanceWeight,
    };

    return {
        ...partial,
        finalScore: sumUnifiedSearchScoreExplanation(partial),
    };
}

function buildNameExactSql(qNorm: string): Prisma.Sql {
    return Prisma.sql`(
        lower(d.display_name) = ${qNorm}
        OR lower(d.primary_name_my) = ${qNorm}
        OR lower(d.primary_name_en) = ${qNorm}
        OR lower(d.primary_name_und) = ${qNorm}
    )`;
}

function buildPrefixSql(prefix: string): Prisma.Sql {
    return Prisma.sql`(
        lower(d.display_name) LIKE ${prefix}
        OR d.trigram_text LIKE ${prefix}
    )`;
}

function buildAliasExactSql(qNorm: string): Prisma.Sql {
    return Prisma.sql`EXISTS (
        SELECT 1
        FROM search.search_document_names n_alias
        WHERE n_alias.search_document_id = d.id
          AND lower(n_alias.normalized_name) = ${qNorm}
    )`;
}

function buildStrongTextSql(
    qNorm: string,
    prefix: string,
    isPrefixMode: boolean,
    multiTokenMatch: Prisma.Sql | null,
): Prisma.Sql {
    if (isPrefixMode) {
        return Prisma.sql`(
            lower(d.code) = ${qNorm}
            OR ${buildNameExactSql(qNorm)}
            OR ${buildPrefixSql(prefix)}
        )`;
    }

    const multiTokenClause = multiTokenMatch
        ? Prisma.sql`OR (${multiTokenMatch})`
        : Prisma.empty;

    return Prisma.sql`(
        lower(d.code) = ${qNorm}
        OR ${buildNameExactSql(qNorm)}
        OR ${buildAliasExactSql(qNorm)}
        OR ${buildPrefixSql(prefix)}
        OR d.search_vector @@ plainto_tsquery('simple', ${qNorm})
        ${multiTokenClause}
    )`;
}

/** Candidate filter for unified search — exact/prefix/strong paths always pass; fuzzy needs threshold. */
export function buildUnifiedSearchCandidateMatchSql(
    params: BuildUnifiedSearchCandidateMatchSqlParams,
): Prisma.Sql {
    const { qNorm, prefix, isPrefixMode, multiTokenMatch, fuzzyThreshold } = params;

    if (isPrefixMode) {
        return Prisma.sql`(
            lower(d.code) = ${qNorm}
            OR lower(d.display_name) LIKE ${prefix}
            OR d.trigram_text LIKE ${prefix}
        )`;
    }

    if (multiTokenMatch) {
        return Prisma.sql`(${multiTokenMatch})`;
    }

    return Prisma.sql`(
        ${buildStrongTextSql(qNorm, prefix, false, null)}
        OR similarity(coalesce(d.trigram_text, ''), ${qNorm}) >= ${fuzzyThreshold}
    )`;
}

/** Build the SQL score expression used inside the unified search `scored` CTE. */
export function buildUnifiedSearchScoreSql(params: BuildUnifiedSearchScoreSqlParams): Prisma.Sql {
    const w = UNIFIED_SEARCH_RANKING_WEIGHTS;
    const review = UNIFIED_SEARCH_REVIEW_QUALITY_WEIGHTS;
    const {
        qNorm,
        prefix,
        isPrefixMode,
        multiTokenMatch,
        fuzzyThreshold,
        hasRef,
        lat,
        lng,
    } = params;

    const multiTokenScore = multiTokenMatch
        ? Prisma.sql`+ (CASE WHEN (${multiTokenMatch}) THEN ${w.multiToken} ELSE 0 END)`
        : Prisma.empty;

    const fuzzyScore = isPrefixMode
        ? Prisma.empty
        : Prisma.sql`
                  + (CASE WHEN d.search_vector @@ plainto_tsquery('simple', ${qNorm}) THEN ${w.fullText} ELSE 0 END)
                  + (CASE
                        WHEN similarity(coalesce(d.trigram_text, ''), ${qNorm}) >= ${fuzzyThreshold}
                        THEN similarity(coalesce(d.trigram_text, ''), ${qNorm}) * ${w.trigramMultiplier}
                        ELSE 0
                     END)
                  ${multiTokenScore}`;

    const strongTextSql = buildStrongTextSql(qNorm, prefix, isPrefixMode, multiTokenMatch);

    const nearbyScore = hasRef
        ? Prisma.sql`(
              CASE
                  WHEN d.centroid IS NULL THEN 0
                  WHEN (${strongTextSql}) THEN ${w.distanceMax}
                  ELSE ${w.distanceMax * w.distanceWeakTextMultiplier}
              END
              * exp(
                  - ST_Distance(
                        d.centroid::geography,
                        ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
                    ) / ${w.distanceDecayMeters}
              )
          )`
        : Prisma.sql`0`;

    const entityTypeWeightSql = Prisma.sql`(
        CASE d.entity_type
            WHEN 'settlement' THEN ${UNIFIED_SEARCH_ENTITY_TYPE_WEIGHTS.settlement}
            WHEN 'place' THEN ${UNIFIED_SEARCH_ENTITY_TYPE_WEIGHTS.place}
            WHEN 'admin_area' THEN ${UNIFIED_SEARCH_ENTITY_TYPE_WEIGHTS.admin_area}
            WHEN 'address' THEN ${UNIFIED_SEARCH_ENTITY_TYPE_WEIGHTS.address}
            WHEN 'transport_terminal' THEN ${UNIFIED_SEARCH_ENTITY_TYPE_WEIGHTS.transport_terminal}
            WHEN 'street_group' THEN ${UNIFIED_SEARCH_ENTITY_TYPE_WEIGHTS.street_group}
            WHEN 'street' THEN ${UNIFIED_SEARCH_ENTITY_TYPE_WEIGHTS.street}
            WHEN 'transport_route' THEN ${UNIFIED_SEARCH_ENTITY_TYPE_WEIGHTS.transport_route}
            WHEN 'transport_route_variant' THEN ${UNIFIED_SEARCH_ENTITY_TYPE_WEIGHTS.transport_route_variant}
            WHEN 'bus_route' THEN ${UNIFIED_SEARCH_ENTITY_TYPE_WEIGHTS.bus_route}
            WHEN 'bus_route_variant' THEN ${UNIFIED_SEARCH_ENTITY_TYPE_WEIGHTS.bus_route_variant}
            WHEN 'building' THEN ${UNIFIED_SEARCH_ENTITY_TYPE_WEIGHTS.building}
            WHEN 'land_area' THEN ${UNIFIED_SEARCH_ENTITY_TYPE_WEIGHTS.land_area}
            WHEN 'water_line' THEN ${UNIFIED_SEARCH_ENTITY_TYPE_WEIGHTS.water_line}
            WHEN 'water_polygon' THEN ${UNIFIED_SEARCH_ENTITY_TYPE_WEIGHTS.water_polygon}
            WHEN 'transport_stop' THEN CASE
                WHEN lower(coalesce(nullif(btrim(d.category_name_en), ''), nullif(d.address_parts->>'stop_type', ''), ''))
                    IN ('station', 'airport')
                THEN ${UNIFIED_SEARCH_ENTITY_TYPE_WEIGHTS.transport_stop_station}
                ELSE ${UNIFIED_SEARCH_ENTITY_TYPE_WEIGHTS.transport_stop}
            END
            WHEN 'bus_stop' THEN CASE
                WHEN lower(coalesce(nullif(btrim(d.category_name_en), ''), nullif(d.address_parts->>'stop_type', ''), ''))
                    IN ('station', 'airport')
                THEN ${UNIFIED_SEARCH_ENTITY_TYPE_WEIGHTS.transport_stop_station}
                ELSE ${UNIFIED_SEARCH_ENTITY_TYPE_WEIGHTS.bus_stop}
            END
            ELSE 0
        END
    )`;

    const reviewQualitySql = Prisma.sql`(
        CASE lower(coalesce(nullif(btrim(d.address_parts->>'review_status'), ''), ''))
            WHEN 'verified' THEN ${review.verified}
            WHEN 'manual_protected' THEN ${review.manual_protected}
            WHEN 'reviewed' THEN ${review.reviewed}
            WHEN 'needs_review' THEN ${review.needs_review}
            WHEN 'imported_unreviewed' THEN ${review.imported_unreviewed}
            ELSE CASE
                WHEN d.is_verified
                     AND d.entity_type IN ('place', 'settlement', 'admin_area', 'address')
                THEN ${review.verifiedPlaceFallback}
                ELSE 0
            END
        END
    )`;

    return Prisma.sql`(
                        (CASE WHEN lower(d.code) = ${qNorm} THEN ${w.codeExact} ELSE 0 END)
                      + (CASE WHEN ${buildNameExactSql(qNorm)} THEN ${w.nameExact} ELSE 0 END)
                      + (CASE
                            WHEN ${buildAliasExactSql(qNorm)}
                                 AND NOT (${buildNameExactSql(qNorm)})
                            THEN ${w.aliasExact}
                            ELSE 0
                         END)
                      + (CASE WHEN ${buildPrefixSql(prefix)} THEN ${w.prefix} ELSE 0 END)
                      ${fuzzyScore}
                      + ${nearbyScore}
                      + (COALESCE(d.importance_score, 0) * ${w.importanceMultiplier})
                      + (COALESCE(d.confidence_score, 0) * ${w.confidenceMultiplier})
                      + (CASE WHEN d.is_verified THEN ${w.verified} ELSE 0 END)
                      + ${entityTypeWeightSql}
                      + ${reviewQualitySql}
                    )::double precision`;
}

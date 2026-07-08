/**
 * Stop matching-key normalization for Phase 6 YBS stop resolution.
 *
 * Does not touch the database.
 */

import { createHash } from "node:crypto";

const NULL_TEXT_VALUES = new Set(["n/a", "n/a - n/a"]);

export const YBS_STOP_SOURCE_NAME = "external_ybs_app";
export const YBS_STOP_SOURCE_KIND = "visible_app_extraction";

export const RISKY_STOP_NAMES_MY = [
    "ဈေးရှေ့",
    "ကျောင်းရှေ့",
    "လမ်းဆုံ",
    "တံတားထိပ်",
    "ဘုရား",
    "ဆေးရုံ",
    "မှတ်တိုင်",
    "ဆည်မြောင်း",
] as const;

export type SideGroup = "inbound" | "outbound" | "unknown" | "shared_terminal";
export type DirectionFamily = "inbound" | "outbound" | "unknown";

export type StopMatchConfidenceReason =
    | "exact_source_link"
    | "exact_boarding_side_key"
    | "exact_name_area_side"
    | "reviewed_stop_match"
    | "uncertain_created_separate_stop";

export const RISKY_STOP_NAMES_EN = [
    "terminal",
    "gate",
    "bus stop",
    "bus stops",
    "stop",
    "junction",
    "interchange",
] as const;

export type StopIdentityMetadata = {
    source_app: "ybs_go";
    stop_place_key: string;
    boarding_side_key: string;
    side_group: SideGroup;
    direction_family: DirectionFamily;
    duplicate_review_required: boolean;
    possible_duplicate_stop_ids: number[];
    matched_from_existing_stop_id: number | null;
    match_confidence_reason: StopMatchConfidenceReason | null;
};

export type StopMatchingFields = {
    stop_name_my: string | null;
    stop_name_en: string | null;
    area_text_my: string | null;
    area_text_en: string | null;
};

export type NormalizedStopMatchingFields = {
    normalized_name_my: string | null;
    normalized_name_en: string | null;
    normalized_area_my: string | null;
    normalized_area_en: string | null;
};

export function normalizeDashSpacing(text: string): string {
    return text
        .replace(/\s*-\s*/gu, " - ")
        .replace(/\s+/gu, " ")
        .trim();
}

export function normalizeMatchingText(
    value: unknown,
    options: { lowercaseEnglish?: boolean } = {},
): string | null {
    if (value === null || value === undefined) {
        return null;
    }

    if (typeof value !== "string") {
        return null;
    }

    let collapsed = normalizeDashSpacing(value.trim());
    if (!collapsed) {
        return null;
    }

    if (NULL_TEXT_VALUES.has(collapsed.toLowerCase())) {
        return null;
    }

    if (options.lowercaseEnglish) {
        collapsed = collapsed.toLowerCase();
    }

    return collapsed;
}

export function normalizeStopMatchingFields(
    fields: StopMatchingFields,
): NormalizedStopMatchingFields {
    return {
        normalized_name_my: normalizeMatchingText(fields.stop_name_my),
        normalized_name_en: normalizeMatchingText(fields.stop_name_en, {
            lowercaseEnglish: true,
        }),
        normalized_area_my: normalizeMatchingText(fields.area_text_my),
        normalized_area_en: normalizeMatchingText(fields.area_text_en, {
            lowercaseEnglish: true,
        }),
    };
}

/** Name + area identity (same physical place, direction-agnostic). */
export function buildStopPlaceKey(fields: NormalizedStopMatchingFields): string {
    const parts = [
        fields.normalized_name_my ?? "",
        fields.normalized_name_en ?? "",
        fields.normalized_area_my ?? "",
        fields.normalized_area_en ?? "",
    ];
    return parts.join("|");
}

/** @deprecated Use buildStopPlaceKey — kept for legacy artifacts. */
export function buildCandidateKey(fields: NormalizedStopMatchingFields): string {
    return buildStopPlaceKey(fields);
}

export function resolveDirectionFamily(directionKey: string): DirectionFamily {
    const direction = directionKey.trim().toLowerCase();
    if (direction === "inbound") {
        return "inbound";
    }
    if (direction === "outbound") {
        return "outbound";
    }
    return "unknown";
}

export function resolveSideGroup(directionKey: string, sharedTerminal: boolean): SideGroup {
    if (sharedTerminal) {
        return "shared_terminal";
    }
    return resolveDirectionFamily(directionKey);
}

/** Boarding identity: place + direction (default import candidate_key). */
export function buildBoardingStopKey(
    fields: NormalizedStopMatchingFields,
    directionKey: string,
): string {
    const direction = directionKey.trim().toLowerCase();
    return `${buildStopPlaceKey(fields)}|${direction}`;
}

/** Same-side physical boarding stop: place + side_group. */
export function buildBoardingSideKey(stopPlaceKey: string, sideGroup: SideGroup): string {
    return `${stopPlaceKey}|${sideGroup}`;
}

export function buildBoardingSideKeyFromFields(
    fields: NormalizedStopMatchingFields,
    directionKey: string,
    sharedTerminal: boolean,
): string {
    const stopPlaceKey = buildStopPlaceKey(fields);
    const sideGroup = resolveSideGroup(directionKey, sharedTerminal);
    return buildBoardingSideKey(stopPlaceKey, sideGroup);
}

export function sideGroupsAreCompatible(
    left: SideGroup,
    right: SideGroup,
    options: { allowSharedTerminal?: boolean } = {},
): boolean {
    if (left === right) {
        return true;
    }

    if (options.allowSharedTerminal && (left === "shared_terminal" || right === "shared_terminal")) {
        return true;
    }

    if (left === "unknown" || right === "unknown") {
        return left === right;
    }

    return false;
}

export function extractSideGroupFromNormalizedData(
    normalizedData: Record<string, unknown> | null | undefined,
): SideGroup | null {
    if (!normalizedData || typeof normalizedData !== "object") {
        return null;
    }

    const raw = normalizedData.side_group;
    if (raw === "inbound" || raw === "outbound" || raw === "unknown" || raw === "shared_terminal") {
        return raw;
    }

    if (isExplicitSharedTerminal(normalizedData)) {
        return "shared_terminal";
    }

    const directionKey =
        (typeof normalizedData.direction_key === "string" && normalizedData.direction_key) ||
        (typeof normalizedData.direction_family === "string" && normalizedData.direction_family) ||
        null;

    if (directionKey) {
        return resolveSideGroup(directionKey, false);
    }

    const ybsGo = normalizedData.ybs_go;
    if (ybsGo && typeof ybsGo === "object") {
        const record = ybsGo as Record<string, unknown>;
        if (typeof record.direction_key === "string") {
            return resolveSideGroup(record.direction_key, false);
        }
    }

    return null;
}

export function extractBoardingSideKeyFromNormalizedData(
    normalizedData: Record<string, unknown> | null | undefined,
    fallbackFields?: NormalizedStopMatchingFields,
): string | null {
    if (!normalizedData || typeof normalizedData !== "object") {
        return null;
    }

    const explicit =
        (typeof normalizedData.boarding_side_key === "string" && normalizedData.boarding_side_key) ||
        (typeof normalizedData.boarding_stop_key === "string" && normalizedData.boarding_stop_key) ||
        null;
    if (explicit) {
        return explicit;
    }

    const stopPlaceKey =
        (typeof normalizedData.stop_place_key === "string" && normalizedData.stop_place_key) ||
        (fallbackFields ? buildStopPlaceKey(fallbackFields) : null);
    const sideGroup = extractSideGroupFromNormalizedData(normalizedData);
    if (stopPlaceKey && sideGroup) {
        return buildBoardingSideKey(stopPlaceKey, sideGroup);
    }

    return null;
}

export function buildStopIdentityMetadata(input: {
    fields: NormalizedStopMatchingFields;
    directionKey: string;
    sharedTerminal: boolean;
    duplicateReviewRequired?: boolean;
    possibleDuplicateStopIds?: number[];
    matchedFromExistingStopId?: number | null;
    matchConfidenceReason?: StopMatchConfidenceReason | null;
}): StopIdentityMetadata {
    const stopPlaceKey = buildStopPlaceKey(input.fields);
    const sideGroup = resolveSideGroup(input.directionKey, input.sharedTerminal);
    const directionFamily = resolveDirectionFamily(input.directionKey);

    return {
        source_app: "ybs_go",
        stop_place_key: stopPlaceKey,
        boarding_side_key: buildBoardingSideKey(stopPlaceKey, sideGroup),
        side_group: sideGroup,
        direction_family: directionFamily,
        duplicate_review_required: input.duplicateReviewRequired ?? false,
        possible_duplicate_stop_ids: input.possibleDuplicateStopIds ?? [],
        matched_from_existing_stop_id: input.matchedFromExistingStopId ?? null,
        match_confidence_reason: input.matchConfidenceReason ?? null,
    };
}

export function buildCandidateId(candidateKey: string): string {
    const digest = createHash("sha256").update(candidateKey, "utf8").digest("hex").slice(0, 12);
    return `ybs-go-stop-${digest}`;
}

/** Legacy source link format (name+area only). Prefer buildDirectionAwareStopExternalId. */
export function buildSourceExternalId(candidateKey: string): string {
    return `stop:ybs_go:${candidateKey}`;
}

/** Per route_stop source link: route + direction + sequence. */
export function buildDirectionAwareStopExternalId(
    routeCode: string,
    directionKey: string,
    sequence: number,
): string {
    return `stop:ybs_go:${routeCode.trim()}:${directionKey.trim().toLowerCase()}:seq:${sequence}`;
}

export function isExplicitSharedTerminal(
    normalizedData: Record<string, unknown> | null | undefined,
): boolean {
    if (!normalizedData || typeof normalizedData !== "object") {
        return false;
    }
    return normalizedData.shared_terminal === true;
}

export function buildVariantCode(routeCode: string, directionKey: string): string {
    const direction = directionKey.trim().toUpperCase();
    return `${routeCode}-${direction}`;
}

export function isRiskyStopName(nameMy: string | null): boolean {
    if (!nameMy) {
        return false;
    }

    const normalized = normalizeMatchingText(nameMy);
    if (!normalized) {
        return false;
    }

    return RISKY_STOP_NAMES_MY.some((risky) => normalized === risky || normalized.includes(risky));
}

export function hasCleanMatchingName(fields: NormalizedStopMatchingFields): boolean {
    return Boolean(fields.normalized_name_my);
}

export function hasAreaContext(fields: NormalizedStopMatchingFields): boolean {
    return Boolean(fields.normalized_area_my || fields.normalized_area_en);
}

/** Strict area match: both sides must have area context and at least one area field matches exactly. */
export function areasMatchStrictly(
    left: NormalizedStopMatchingFields,
    right: NormalizedStopMatchingFields,
): boolean {
    if (!hasAreaContext(left) || !hasAreaContext(right)) {
        return false;
    }

    const myMatch =
        left.normalized_area_my &&
        right.normalized_area_my &&
        left.normalized_area_my === right.normalized_area_my;
    const enMatch =
        left.normalized_area_en &&
        right.normalized_area_en &&
        left.normalized_area_en === right.normalized_area_en;

    return Boolean(myMatch || enMatch);
}

export function myanmarNameMatches(
    left: NormalizedStopMatchingFields,
    right: NormalizedStopMatchingFields,
): boolean {
    return Boolean(
        left.normalized_name_my &&
            right.normalized_name_my &&
            left.normalized_name_my === right.normalized_name_my,
    );
}

export function strongBilingualPairMatches(
    left: NormalizedStopMatchingFields,
    right: NormalizedStopMatchingFields,
): boolean {
    return Boolean(
        left.normalized_name_my &&
            right.normalized_name_my &&
            left.normalized_name_my === right.normalized_name_my &&
            left.normalized_name_en &&
            right.normalized_name_en &&
            left.normalized_name_en === right.normalized_name_en,
    );
}

export function hasStrongNameMatch(
    left: NormalizedStopMatchingFields,
    right: NormalizedStopMatchingFields,
): boolean {
    return myanmarNameMatches(left, right) || strongBilingualPairMatches(left, right);
}

export function isRiskyStopNameEn(nameEn: string | null): boolean {
    if (!nameEn) {
        return false;
    }

    const normalized = normalizeMatchingText(nameEn, { lowercaseEnglish: true });
    if (!normalized) {
        return false;
    }

    return RISKY_STOP_NAMES_EN.some(
        (risky) => normalized === risky || normalized.includes(risky),
    );
}

/** Generic or terminal-like names without area context must not drive reuse. */
export function isAmbiguousGenericStop(fields: NormalizedStopMatchingFields): boolean {
    const riskyMy = isRiskyStopName(fields.normalized_name_my);
    const riskyEn = isRiskyStopNameEn(fields.normalized_name_en);
    if (!riskyMy && !riskyEn) {
        return false;
    }
    return !hasAreaContext(fields);
}

export function canSafelyReuseByIdentity(input: {
    candidateFields: NormalizedStopMatchingFields;
    existingFields: NormalizedStopMatchingFields;
    candidateSideGroup: SideGroup;
    existingSideGroup: SideGroup;
    allowSharedTerminal?: boolean;
    existingReviewStatus?: string | null;
}): { ok: true } | { ok: false; reason: string } {
    const {
        candidateFields,
        existingFields,
        candidateSideGroup,
        existingSideGroup,
        allowSharedTerminal = false,
        existingReviewStatus = null,
    } = input;

    const sideCompatible = sideGroupsAreCompatible(candidateSideGroup, existingSideGroup, {
        allowSharedTerminal,
    });
    if (!sideCompatible) {
        return { ok: false, reason: "opposite_side_or_direction_conflict" };
    }

    const candidateUnknown = candidateSideGroup === "unknown";
    const existingUnknown = existingSideGroup === "unknown";
    if (candidateUnknown || existingUnknown) {
        const reviewed =
            existingReviewStatus === "reviewed" ||
            existingReviewStatus === "verified" ||
            existingReviewStatus === "manual_protected";
        if (!reviewed) {
            return { ok: false, reason: "unknown_side_group" };
        }
    }

    if (!hasStrongNameMatch(candidateFields, existingFields)) {
        return { ok: false, reason: "name_not_strong_match" };
    }

    if (!areasMatchStrictly(candidateFields, existingFields)) {
        return { ok: false, reason: "area_context_mismatch" };
    }

    if (isAmbiguousGenericStop(candidateFields) || isAmbiguousGenericStop(existingFields)) {
        return { ok: false, reason: "ambiguous_generic_name_without_area" };
    }

    return { ok: true };
}

/** @deprecated Prefer areasMatchStrictly for reuse decisions. */
export function areasAreCompatible(
    left: NormalizedStopMatchingFields,
    right: NormalizedStopMatchingFields,
): boolean {
    return areasMatchStrictly(left, right);
}

export function extractAreaFromNormalizedData(
    normalizedData: Record<string, unknown> | null | undefined,
): { area_text_my: string | null; area_text_en: string | null } {
    if (!normalizedData || typeof normalizedData !== "object") {
        return { area_text_my: null, area_text_en: null };
    }

    const ybsGo = normalizedData.ybs_go;
    if (!ybsGo || typeof ybsGo !== "object") {
        return { area_text_my: null, area_text_en: null };
    }

    const record = ybsGo as Record<string, unknown>;
    return {
        area_text_my: normalizeMatchingText(record.area_text_my),
        area_text_en: normalizeMatchingText(record.area_text_en, { lowercaseEnglish: true }),
    };
}

export function combineRawText(parts: Array<string | null | undefined>): string | null {
    const values = parts
        .map((part) => (typeof part === "string" ? part.trim() : ""))
        .filter(Boolean);
    return values.length > 0 ? values.join("\n") : null;
}

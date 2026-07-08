/**
 * Stage 5 route identity and normalization for YBS Phase 4 extraction.
 *
 * Does not touch the database.
 */

export type RouteIdentityStatus =
    | "unique_numeric_route_candidate"
    | "duplicate_number_separate_route"
    | "named_route_candidate"
    | "trial_route_candidate"
    | "truncated_code_needs_detail"
    | "unknown_needs_review";

export type CardBounds = {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    centerX: number;
    centerY: number;
};

/** Shared identity fields used by route index and later normalization stages. */
export type RouteIdentityFields = {
    route_display_code: string | null;
    route_number: number | null;
    route_code_candidate: string | null;
    route_title_my: string | null;
    route_title_en: string | null;
    operator_name: string | null;
    public_name_candidate: string | null;
    identity_status: RouteIdentityStatus;
    duplicate_number_group_key: string | null;
    duplicate_number_group_index: number | null;
    needs_detail_confirmation: boolean;
};

export type RouteIdentityInput = {
    list_order: number;
    route_display_code: string | null;
    route_number: number | null;
    route_title_my: string | null;
    route_title_en: string | null;
    operator_name: string | null;
    badge_is_truncated?: boolean;
};

export type RouteIdentityRecord = RouteIdentityFields &
    RouteIdentityInput & {
        raw_card_text: string[];
        card_bounds: CardBounds | null;
    };

const SUFFIX_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const MYANMAR_DIGIT_MAP: Record<string, string> = {
    "၀": "0",
    "၁": "1",
    "၂": "2",
    "၃": "3",
    "၄": "4",
    "၅": "5",
    "၆": "6",
    "၇": "7",
    "၈": "8",
    "၉": "9",
};

/** Strip the leading route-number prefix from a visible list title. */
export function normalizePublicRouteTitle(title: string | null | undefined): string | null {
    if (!title) {
        return null;
    }

    const withoutPrefix = title
        .trim()
        .replace(/^\([၀-၉\d][^)]*\)\s*/, "")
        .replace(/^\(စမ်းသပ်\)\s*/, "")
        .trim();

    return withoutPrefix || null;
}

/** True when the visible list title is a YBS trial route. */
export function isTrialRouteTitle(title: string | null | undefined): boolean {
    if (!title) {
        return false;
    }

    return /^\(စမ်းသပ်\)/.test(title.trim());
}

/** True when the left badge is a descriptive corridor label such as "Sula - Dala". */
export function isDescriptiveRouteBadge(displayCode: string | null | undefined): boolean {
    if (!displayCode || isTruncatedBadge(displayCode) || isNamedOfficialDisplayCode(displayCode)) {
        return false;
    }

    const trimmed = displayCode.trim();
    if (trimmed.length < 6 || trimmed.length > 40) {
        return false;
    }

    if (/^[၀-၉\d]/.test(trimmed)) {
        return false;
    }

    return /^[A-Za-z][A-Za-z0-9\s\-().\u1000-\u109F]+$/.test(trimmed) && /[\s-]/.test(trimmed);
}

function isTrialRouteCandidate(input: RouteIdentityInput): boolean {
    const title = input.route_title_my ?? input.route_title_en;
    return isTrialRouteTitle(title) || (input.route_number === null && isDescriptiveRouteBadge(input.route_display_code));
}

function slugifyRouteCodePart(value: string): string {
    const normalized = value
        .trim()
        .replace(/\s+/g, "-")
        .replace(/[\\/]+/g, "-")
        .replace(/[^A-Za-z0-9\u1000-\u109F()-]+/g, "")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");

    return normalized.toUpperCase().slice(0, 40) || "ROUTE";
}

function buildTrialRouteBaseSlug(input: RouteIdentityInput): string {
    const badge = input.route_display_code?.trim();
    if (badge && !isTruncatedBadge(badge)) {
        const fromBadge = slugifyRouteCodePart(badge);
        if (fromBadge.length >= 4) {
            return fromBadge;
        }
    }

    const publicTitle = normalizePublicRouteTitle(input.route_title_my ?? input.route_title_en);
    if (publicTitle) {
        return slugifyRouteCodePart(publicTitle);
    }

    return `ORDER${input.list_order}`;
}

function buildTrialRouteCode(baseSlug: string, suffix?: string): string {
    return suffix ? `TRIAL-${baseSlug}-${suffix}` : `TRIAL-${baseSlug}`;
}

/** True when the visible title looks truncated or too short to trust. */
export function isUnclearRouteTitle(title: string | null | undefined): boolean {
    if (!title) {
        return true;
    }

    const trimmed = title.trim();
    return trimmed.endsWith("...") || trimmed.endsWith("…") || trimmed.length < 8;
}

/** True when the badge text ends with ellipsis or looks cut off. */
export function isTruncatedBadge(displayCode: string | null | undefined): boolean {
    if (!displayCode) {
        return false;
    }

    const trimmed = displayCode.trim();
    return trimmed.endsWith("...") || trimmed.endsWith("…");
}

/** True when the badge is an official named code such as APS. */
export function isNamedOfficialDisplayCode(displayCode: string | null | undefined): boolean {
    if (!displayCode) {
        return false;
    }

    if (isTruncatedBadge(displayCode)) {
        return false;
    }

    const trimmed = displayCode.trim();
    if (/^[၀-၉\d]/.test(trimmed)) {
        return false;
    }

    return /^[A-Za-z][A-Za-z0-9-]{1,15}$/.test(trimmed);
}

function parseLeadingRouteNumber(value: string | null | undefined): number | null {
    if (!value) {
        return null;
    }

    const match = value.trim().match(/^([၀-၉\d]+)/);
    if (!match) {
        return null;
    }

    return myanmarDigitsToNumber(match[1]) ?? Number(match[1]);
}

function myanmarDigitsToNumber(text: string): number | null {
    if (!/^[၀-၉\d]+$/.test(text.trim())) {
        return null;
    }

    const normalized = text
        .trim()
        .split("")
        .map((char) => MYANMAR_DIGIT_MAP[char] ?? char)
        .join("");

    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
}

function suffixForIndex(index: number): string {
    if (index < SUFFIX_LETTERS.length) {
        return SUFFIX_LETTERS[index];
    }

    return `Z${index - SUFFIX_LETTERS.length + 1}`;
}

function compareIdentityInputs(left: RouteIdentityInput, right: RouteIdentityInput): number {
    const leftTitle = normalizePublicRouteTitle(left.route_title_my ?? left.route_title_en) ?? "";
    const rightTitle = normalizePublicRouteTitle(right.route_title_my ?? right.route_title_en) ?? "";
    const titleCompare = leftTitle.localeCompare(rightTitle, "my");
    if (titleCompare !== 0) {
        return titleCompare;
    }

    const leftOperator = left.operator_name ?? "";
    const rightOperator = right.operator_name ?? "";
    const operatorCompare = leftOperator.localeCompare(rightOperator, "en");
    if (operatorCompare !== 0) {
        return operatorCompare;
    }

    return left.list_order - right.list_order;
}

function buildUniqueNumericCode(routeNumber: number): string {
    return `YBS-${routeNumber}`;
}

function buildDuplicateNumericCode(routeNumber: number, suffix: string): string {
    return `YBS-${routeNumber}-${suffix}`;
}

function buildNamedOfficialCode(displayCode: string): string {
    return displayCode.trim().toUpperCase();
}

function buildPublicNameCandidate(input: RouteIdentityInput): string | null {
    return normalizePublicRouteTitle(input.route_title_my ?? input.route_title_en);
}

function needsDetailConfirmation(status: RouteIdentityStatus, title: string | null | undefined): boolean {
    if (
        status === "truncated_code_needs_detail" ||
        status === "unknown_needs_review"
    ) {
        return true;
    }

    return isUnclearRouteTitle(title);
}

function assignSingleIdentity(
    input: RouteIdentityInput,
    options: {
        duplicateGroupKey: string | null;
        duplicateGroupIndex: number | null;
        routeCodeCandidate: string | null;
        identityStatus: RouteIdentityStatus;
        raw_card_text: string[];
        card_bounds: CardBounds | null;
    },
): RouteIdentityRecord {
    const title = input.route_title_my ?? input.route_title_en;

    return {
        ...input,
        public_name_candidate: buildPublicNameCandidate(input),
        route_code_candidate: options.routeCodeCandidate,
        identity_status: options.identityStatus,
        duplicate_number_group_key: options.duplicateGroupKey,
        duplicate_number_group_index: options.duplicateGroupIndex,
        needs_detail_confirmation: needsDetailConfirmation(options.identityStatus, title),
        raw_card_text: options.raw_card_text,
        card_bounds: options.card_bounds,
    };
}

/**
 * Assign route identity fields for one batch of route index rows.
 *
 * Same route_number appearing more than once => YBS-<n>-A/B/C suffixes.
 * Suffix order: normalized title, operator name, list_order.
 */
export function assignRouteIdentities(
    inputs: Array<
        RouteIdentityInput & {
            raw_card_text: string[];
            card_bounds: CardBounds | null;
        }
    >,
): RouteIdentityRecord[] {
    const sortedInputs = [...inputs].sort((left, right) => left.list_order - right.list_order);
    const records: RouteIdentityRecord[] = [];

    const numericGroups = new Map<number, RouteIdentityInput[]>();
    for (const input of sortedInputs) {
        if (input.route_number === null) {
            continue;
        }

        const group = numericGroups.get(input.route_number) ?? [];
        group.push(input);
        numericGroups.set(input.route_number, group);
    }

    const numericCodeByOrder = new Map<number, string>();
    const numericMetaByOrder = new Map<
        number,
        {
            duplicateGroupKey: string | null;
            duplicateGroupIndex: number | null;
            identityStatus: RouteIdentityStatus;
        }
    >();

    for (const [routeNumber, group] of numericGroups.entries()) {
        const sortedGroup = [...group].sort(compareIdentityInputs);
        const duplicateGroupKey = sortedGroup.length > 1 ? buildUniqueNumericCode(routeNumber) : null;
        const identityStatus: RouteIdentityStatus =
            sortedGroup.length === 1
                ? "unique_numeric_route_candidate"
                : "duplicate_number_separate_route";

        sortedGroup.forEach((input, index) => {
            const routeCode =
                sortedGroup.length === 1
                    ? buildUniqueNumericCode(routeNumber)
                    : buildDuplicateNumericCode(routeNumber, suffixForIndex(index));

            numericCodeByOrder.set(input.list_order, routeCode);
            numericMetaByOrder.set(input.list_order, {
                duplicateGroupKey,
                duplicateGroupIndex: sortedGroup.length > 1 ? index + 1 : null,
                identityStatus,
            });
        });
    }

    const trialGroups = new Map<string, RouteIdentityInput[]>();
    for (const input of sortedInputs) {
        if (!isTrialRouteCandidate(input)) {
            continue;
        }

        const baseSlug = buildTrialRouteBaseSlug(input);
        const group = trialGroups.get(baseSlug) ?? [];
        group.push(input);
        trialGroups.set(baseSlug, group);
    }

    const trialCodeByOrder = new Map<number, string>();
    for (const [baseSlug, group] of trialGroups.entries()) {
        const sortedGroup = [...group].sort(compareIdentityInputs);
        sortedGroup.forEach((input, index) => {
            const routeCode =
                sortedGroup.length === 1
                    ? buildTrialRouteCode(baseSlug)
                    : buildTrialRouteCode(baseSlug, suffixForIndex(index));
            trialCodeByOrder.set(input.list_order, routeCode);
        });
    }

    for (const input of sortedInputs) {
        const { raw_card_text, card_bounds, badge_is_truncated, ...identityInput } = input;
        const truncated = badge_is_truncated || isTruncatedBadge(identityInput.route_display_code);

        if (truncated) {
            records.push(
                assignSingleIdentity(identityInput, {
                    routeCodeCandidate: null,
                    identityStatus: "truncated_code_needs_detail",
                    duplicateGroupKey: null,
                    duplicateGroupIndex: null,
                    raw_card_text,
                    card_bounds,
                }),
            );
            continue;
        }

        if (isNamedOfficialDisplayCode(identityInput.route_display_code) && identityInput.route_number === null) {
            records.push(
                assignSingleIdentity(identityInput, {
                    routeCodeCandidate: buildNamedOfficialCode(identityInput.route_display_code!),
                    identityStatus: "named_route_candidate",
                    duplicateGroupKey: null,
                    duplicateGroupIndex: null,
                    raw_card_text,
                    card_bounds,
                }),
            );
            continue;
        }

        if (identityInput.route_number !== null && numericCodeByOrder.has(identityInput.list_order)) {
            const meta = numericMetaByOrder.get(identityInput.list_order)!;
            records.push(
                assignSingleIdentity(identityInput, {
                    routeCodeCandidate: numericCodeByOrder.get(identityInput.list_order)!,
                    identityStatus: meta.identityStatus,
                    duplicateGroupKey: meta.duplicateGroupKey,
                    duplicateGroupIndex: meta.duplicateGroupIndex,
                    raw_card_text,
                    card_bounds,
                }),
            );
            continue;
        }

        if (trialCodeByOrder.has(identityInput.list_order)) {
            records.push(
                assignSingleIdentity(identityInput, {
                    routeCodeCandidate: trialCodeByOrder.get(identityInput.list_order)!,
                    identityStatus: "trial_route_candidate",
                    duplicateGroupKey: null,
                    duplicateGroupIndex: null,
                    raw_card_text,
                    card_bounds,
                }),
            );
            continue;
        }

        records.push(
            assignSingleIdentity(identityInput, {
                routeCodeCandidate: null,
                identityStatus: "unknown_needs_review",
                duplicateGroupKey: null,
                duplicateGroupIndex: null,
                raw_card_text,
                card_bounds,
            }),
        );
    }

    return records.sort((left, right) => left.list_order - right.list_order);
}

/** Stable key before route_code_candidate exists. */
export function routeIdentityInputKey(input: RouteIdentityInput): string {
    return [
        input.route_number ?? "null",
        input.route_title_my ?? input.route_title_en ?? "",
        input.operator_name ?? "",
    ].join("|||");
}

/** Stable key after route identity assignment. */
export function routeIdentityRecordKey(record: RouteIdentityFields): string {
    return record.route_code_candidate ?? [
        "pending",
        record.route_number ?? "null",
        record.public_name_candidate ?? "",
        record.operator_name ?? "",
    ].join("|||");
}

/**
 * Build identity fields for a confirmed detail extraction.
 * Use when the operator already opened one route and CLI route_code is trusted.
 */
export function identityFromConfirmedRouteCode(
    routeCode: string,
    input: Omit<RouteIdentityInput, "list_order"> & {
        list_order?: number;
        raw_card_text?: string[];
        card_bounds?: CardBounds | null;
    },
): RouteIdentityRecord {
    const fullInput: RouteIdentityInput = {
        list_order: input.list_order ?? 1,
        route_display_code: input.route_display_code,
        route_number: input.route_number,
        route_title_my: input.route_title_my,
        route_title_en: input.route_title_en,
        operator_name: input.operator_name,
    };

    return assignSingleIdentity(fullInput, {
        routeCodeCandidate: routeCode,
        identityStatus: "unique_numeric_route_candidate",
        duplicateGroupKey: null,
        duplicateGroupIndex: null,
        raw_card_text: input.raw_card_text ?? [],
        card_bounds: input.card_bounds ?? null,
    });
}

/** Snapshot stored on extracted route JSON from the route index. */
export type RouteIndexIdentitySnapshot = RouteIdentityFields & {
    list_order: number;
    raw_card_text: string[];
    card_bounds: CardBounds | null;
};

/** Snapshot built from the route detail screen after opening. */
export type RouteDetailIdentitySnapshot = RouteIdentityFields & {
    route_name_my: string | null;
    route_name_en: string | null;
    source: "route_detail_screen";
};

export type RouteDetailMetadataInput = {
    route_number: number | null;
    route_name_my: string | null;
    route_name_en?: string | null;
    operator_name: string | null;
};

export type RouteIdentityReconciliation = {
    route_code_candidate: string | null;
    identity_status: RouteIdentityStatus | "needs_review";
    warnings: string[];
};

export function buildRouteIndexIdentitySnapshot(
    record: RouteIdentityRecord,
): RouteIndexIdentitySnapshot {
    return {
        list_order: record.list_order,
        route_display_code: record.route_display_code,
        route_number: record.route_number,
        route_code_candidate: record.route_code_candidate,
        route_title_my: record.route_title_my,
        route_title_en: record.route_title_en,
        operator_name: record.operator_name,
        public_name_candidate: record.public_name_candidate,
        identity_status: record.identity_status,
        duplicate_number_group_key: record.duplicate_number_group_key,
        duplicate_number_group_index: record.duplicate_number_group_index,
        needs_detail_confirmation: record.needs_detail_confirmation,
        raw_card_text: record.raw_card_text,
        card_bounds: record.card_bounds,
    };
}

export function buildRouteDetailIdentitySnapshot(
    metadata: RouteDetailMetadataInput,
    routeCodeCandidate: string | null,
): RouteDetailIdentitySnapshot {
    const titleMy = metadata.route_name_my;
    const titleEn = metadata.route_name_en ?? null;

    return {
        source: "route_detail_screen",
        route_display_code: metadata.route_number === null ? null : String(metadata.route_number),
        route_number: metadata.route_number,
        route_code_candidate: routeCodeCandidate,
        route_title_my: titleMy,
        route_title_en: titleEn,
        route_name_my: titleMy,
        route_name_en: titleEn,
        operator_name: metadata.operator_name,
        public_name_candidate: normalizePublicRouteTitle(titleMy ?? titleEn),
        identity_status: routeCodeCandidate
            ? "unique_numeric_route_candidate"
            : "unknown_needs_review",
        duplicate_number_group_key: null,
        duplicate_number_group_index: null,
        needs_detail_confirmation: routeCodeCandidate === null,
    };
}

function titlesLikelyMatch(
    left: string | null | undefined,
    right: string | null | undefined,
): boolean {
    const leftNorm = normalizePublicRouteTitle(left);
    const rightNorm = normalizePublicRouteTitle(right);

    if (!leftNorm || !rightNorm) {
        return false;
    }

    if (leftNorm === rightNorm) {
        return true;
    }

    return leftNorm.includes(rightNorm) || rightNorm.includes(leftNorm);
}

/** Compare index navigation identity with detail-screen identity. */
export function reconcileRouteIdentities(
    indexIdentity: RouteIndexIdentitySnapshot,
    detailIdentity: RouteDetailIdentitySnapshot,
): RouteIdentityReconciliation {
    const warnings: string[] = [];
    let changed = false;

    if (
        indexIdentity.route_number !== null &&
        detailIdentity.route_number !== null &&
        indexIdentity.route_number !== detailIdentity.route_number
    ) {
        changed = true;
        warnings.push(
            `Route number changed: index ${indexIdentity.route_number} vs detail ${detailIdentity.route_number}.`,
        );
    }

    const indexTitle = indexIdentity.route_title_my ?? indexIdentity.route_title_en;
    const detailTitle = detailIdentity.route_name_my ?? detailIdentity.route_name_en;

    if (indexTitle && detailTitle && !titlesLikelyMatch(indexTitle, detailTitle)) {
        changed = true;
        warnings.push("Route title differs between route index and detail screen.");
    }

    if (
        indexIdentity.operator_name &&
        detailIdentity.operator_name &&
        indexIdentity.operator_name.trim().toLowerCase() !==
            detailIdentity.operator_name.trim().toLowerCase()
    ) {
        warnings.push("Operator name differs between route index and detail screen.");
    }

    if (changed) {
        warnings.unshift("ROUTE_IDENTITY_CHANGED_OR_UNCLEAR");
    }

    const routeCodeCandidate =
        detailIdentity.route_code_candidate ??
        indexIdentity.route_code_candidate ??
        null;

    let identity_status: RouteIdentityReconciliation["identity_status"] =
        detailIdentity.identity_status;

    if (changed || routeCodeCandidate === null) {
        identity_status = "needs_review";
    }

    return {
        route_code_candidate: routeCodeCandidate,
        identity_status,
        warnings,
    };
}

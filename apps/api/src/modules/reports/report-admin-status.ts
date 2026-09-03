/**
 * Admin PATCH /status transitions. Request-info and user replies are separate.
 *
 * Field survey reports resolve with `resolved`, not `accepted`. Accepted is only
 * for public reports and must not imply a canonical transport edit.
 */
export const PUBLIC_ADMIN_STATUS_TRANSITIONS: Record<string, readonly string[]> = {
    submitted: ["in_review", "duplicate"],
    in_review: ["accepted", "rejected", "duplicate"],
};

export const FIELD_ADMIN_STATUS_TRANSITIONS: Record<string, readonly string[]> = {
    submitted: ["in_review"],
    in_review: ["resolved", "rejected"],
};

export function isFieldSurveySource(sourceCode: string | null | undefined): boolean {
    return sourceCode === "field_survey";
}

export function allowedAdminStatusTargets(
    from: string,
    sourceCode: string | null | undefined
): readonly string[] {
    const table = isFieldSurveySource(sourceCode)
        ? FIELD_ADMIN_STATUS_TRANSITIONS
        : PUBLIC_ADMIN_STATUS_TRANSITIONS;
    return table[from] ?? [];
}

export function isAllowedAdminStatusTransition(
    from: string,
    to: string,
    sourceCode: string | null | undefined
): boolean {
    if (from === to) {
        return false;
    }
    return allowedAdminStatusTargets(from, sourceCode).includes(to);
}

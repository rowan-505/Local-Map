"use client";

import { isImportReviewDevAdminHeaderConfigured } from "@/src/lib/importReviewDevAdminHeader";
import { rolesFromJwtAccessToken } from "@/src/lib/jwtRoles";

/**
 * Enables import-review action controls client-side — mirrors API coarse `admin` role OR the
 * optional dev-only IMPORT_REVIEW_ADMIN_TOKEN header handshake.
 *
 * JWT decode stays UX-only; API enforces 401 / 403.
 */
export function deriveImportReviewEditorUxCanMutate(): boolean {
    if (typeof window === "undefined") {
        return false;
    }
    if (isImportReviewDevAdminHeaderConfigured()) {
        return true;
    }
    const roles = rolesFromJwtAccessToken(window.localStorage.getItem("accessToken"));
    if (roles.length === 0) {
        return false;
    }
    return roles.includes("admin");
}

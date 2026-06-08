"use client";

import type { QueryClient } from "@tanstack/react-query";

import type { CoreReviewEntitySlug, CoreReviewListResponse } from "@/src/lib/api";

export type CoreReviewLifecyclePatch = "soft-delete" | "restore";

function applyLifecyclePatch(row: Record<string, unknown>, patch: CoreReviewLifecyclePatch): Record<string, unknown> {
    if (patch === "soft-delete") {
        // Prefer setting the canonical deleted timestamp fields; list UI treats any of these as deleted.
        const now = new Date().toISOString();
        return {
            ...row,
            deletedAt: (row.deletedAt ?? now) || now,
            deleted_at: (row.deleted_at ?? now) || now,
            isActive: false,
            is_active: false,
        };
    }
    return {
        ...row,
        deletedAt: null,
        deleted_at: null,
        isActive: true,
        is_active: true,
    };
}

export function patchCoreReviewListRowEverywhere<T extends Record<string, unknown>>(
    queryClient: QueryClient,
    apiSlug: CoreReviewEntitySlug,
    rowId: string,
    patch: (row: T) => T
): void {
    queryClient.setQueriesData<CoreReviewListResponse<T>>(
        { queryKey: ["core-review", "list", apiSlug] },
        (prev) => {
            if (!prev) return prev;
            return {
                ...prev,
                data: prev.data.map((row) => {
                    const key = String(
                        (row as { publicId?: string; public_id?: string; id?: string }).publicId ??
                            (row as { public_id?: string }).public_id ??
                            (row as { id?: string }).id ??
                            "",
                    );
                    return key === rowId ? patch(row) : row;
                }),
            };
        }
    );
}

export function patchCoreReviewLifecycleEverywhere(
    queryClient: QueryClient,
    apiSlug: CoreReviewEntitySlug,
    rowId: string,
    patch: CoreReviewLifecyclePatch
): void {
    patchCoreReviewListRowEverywhere<Record<string, unknown>>(queryClient, apiSlug, rowId, (row) =>
        applyLifecyclePatch(row, patch)
    );
}


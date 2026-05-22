import type { PrismaClient } from "@prisma/client";

import { RefBoundaryStatusesRepository } from "../ref/ref-boundary-statuses.repo.js";
import { CoreReviewValidationError } from "./core-review-write.errors.js";
import { pickAlias } from "./core-review-write.schema.js";

function trimCode(value: unknown): string | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }
    const trimmed = String(value).trim();
    return trimmed || undefined;
}

function setAlias(
    body: Record<string, unknown>,
    camel: string,
    snake: string,
    value: unknown,
): void {
    body[camel] = value;
    body[snake] = value;
}

function hasAlias(body: Record<string, unknown>, camel: string, snake: string): boolean {
    return pickAlias(body, camel, snake) !== undefined;
}

/** Apply ref-driven defaults for admin area boundary fields on create. */
export async function applyAdminAreaBoundaryDefaultsForCreate(
    prisma: PrismaClient,
    body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
    const out = { ...body };
    const boundaryRepo = new RefBoundaryStatusesRepository(prisma);

    const statusCode = trimCode(pickAlias(out, "boundaryStatus", "boundary_status")) ?? "official";
    setAlias(out, "boundaryStatus", "boundary_status", statusCode);

    const statusRow = await boundaryRepo.getActiveBoundaryStatusByCode(statusCode);
    if (!statusRow) {
        throw new CoreReviewValidationError("boundaryStatus is invalid or inactive", [
            { path: "boundaryStatus", message: "Invalid or inactive boundary status code" },
        ]);
    }

    if (!hasAlias(out, "isOfficialBoundary", "is_official_boundary")) {
        setAlias(
            out,
            "isOfficialBoundary",
            "is_official_boundary",
            statusRow.default_is_official_boundary,
        );
    }

    if (!hasAlias(out, "boundaryConfidenceScore", "boundary_confidence_score")) {
        setAlias(
            out,
            "boundaryConfidenceScore",
            "boundary_confidence_score",
            statusRow.default_boundary_confidence_score,
        );
    }

    if (!hasAlias(out, "addressUsage", "address_usage")) {
        const usageCode = statusRow.default_address_usage_code ?? "official";
        setAlias(out, "addressUsage", "address_usage", usageCode);
    }

    return out;
}

/** When boundary status changes on patch, fill missing related fields from ref defaults. */
export async function applyAdminAreaBoundaryDefaultsForPatch(
    prisma: PrismaClient,
    body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
    const statusCode = trimCode(pickAlias(body, "boundaryStatus", "boundary_status"));
    if (!statusCode) {
        return body;
    }

    const out = { ...body };
    setAlias(out, "boundaryStatus", "boundary_status", statusCode);

    const statusRow = await new RefBoundaryStatusesRepository(prisma).getActiveBoundaryStatusByCode(
        statusCode,
    );
    if (!statusRow) {
        throw new CoreReviewValidationError("boundaryStatus is invalid or inactive", [
            { path: "boundaryStatus", message: "Invalid or inactive boundary status code" },
        ]);
    }

    if (!hasAlias(out, "isOfficialBoundary", "is_official_boundary")) {
        setAlias(
            out,
            "isOfficialBoundary",
            "is_official_boundary",
            statusRow.default_is_official_boundary,
        );
    }
    if (!hasAlias(out, "boundaryConfidenceScore", "boundary_confidence_score")) {
        setAlias(
            out,
            "boundaryConfidenceScore",
            "boundary_confidence_score",
            statusRow.default_boundary_confidence_score,
        );
    }
    if (!hasAlias(out, "addressUsage", "address_usage")) {
        const usageCode = statusRow.default_address_usage_code ?? "official";
        setAlias(out, "addressUsage", "address_usage", usageCode);
    }

    return out;
}

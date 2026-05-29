import { Prisma, type PrismaClient } from "@prisma/client";

import { ImportReviewSchemaCapabilityRegistry } from "../../modules/import-review/import-review-schema-capabilities.js";
import type {
    VerificationSummaryCaps,
    VerificationSummaryEntityConfig,
    VerificationSummaryFamilyRow,
    VerificationSummaryResponse,
    VerificationSummarySupport,
} from "./verification-summary.types.js";
import { VERIFICATION_SUMMARY_STATUSES } from "./verification-summary.types.js";

type Caps = VerificationSummaryCaps &
    Awaited<ReturnType<ImportReviewSchemaCapabilityRegistry["getTargetColumnCapabilities"]>>;

function qtable(qualifiedTable: string): Prisma.Sql {
    return Prisma.raw(qualifiedTable);
}

function hasAll(caps: Caps, columns: readonly string[]): boolean {
    return columns.every((column) => caps.hasColumn(column));
}

/** Canonical status for counting; verification_status wins, is_verified fallback for null/empty only. */
export function effectiveVerificationStatusExpr(caps: VerificationSummaryCaps, alias = "t"): Prisma.Sql {
    if (caps.hasVerificationStatus && caps.hasIsVerified) {
        return Prisma.sql`COALESCE(
            NULLIF(${Prisma.raw(alias)}.verification_status, ''),
            CASE WHEN ${Prisma.raw(alias)}.is_verified THEN 'verified' ELSE 'unverified' END
        )`;
    }
    if (caps.hasVerificationStatus) {
        return Prisma.sql`COALESCE(NULLIF(${Prisma.raw(alias)}.verification_status, ''), 'unverified')`;
    }
    return Prisma.sql`CASE WHEN ${Prisma.raw(alias)}.is_verified THEN 'verified' ELSE 'unverified' END`;
}

export function verificationSummarySupport(caps: VerificationSummaryCaps): VerificationSummarySupport {
    if (caps.columns.size === 0) {
        return {
            table_exists: false,
            verification_supported: false,
            unsupported_reason: "Target table does not exist.",
            missing_verification_columns: ["is_verified", "verification_status"],
        };
    }

    const missing = ["is_verified", "verification_status"].filter((column) => !caps.hasColumn(column));
    const verificationSupported = caps.hasVerificationStatus || caps.hasIsVerified;

    return {
        table_exists: true,
        verification_supported: verificationSupported,
        unsupported_reason: verificationSupported
            ? null
            : missing.length > 0
              ? `Missing verification column(s): ${missing.join(", ")}.`
              : "Missing verification_status and is_verified columns.",
        missing_verification_columns: missing,
    };
}

export function verificationSummaryCountSelect(caps: VerificationSummaryCaps): Prisma.Sql | null {
    if (!caps.hasVerificationStatus && !caps.hasIsVerified) {
        return null;
    }

    const status = effectiveVerificationStatusExpr(caps);
    return Prisma.sql`
        count(*)::bigint AS total,
        count(*) FILTER (WHERE ${status} = 'unverified')::bigint AS unverified,
        count(*) FILTER (WHERE ${status} = 'verified')::bigint AS verified,
        count(*) FILTER (WHERE ${status} = 'needs_fix')::bigint AS needs_fix,
        count(*) FILTER (WHERE ${status} = 'questionable')::bigint AS questionable,
        count(*) FILTER (WHERE ${status} = 'rejected_after_core_review')::bigint AS rejected_after_core_review
    `;
}

export async function buildVerificationSummary(
    prisma: PrismaClient,
    configs: readonly VerificationSummaryEntityConfig[]
): Promise<VerificationSummaryResponse> {
    const registry = new ImportReviewSchemaCapabilityRegistry(prisma);
    const families: VerificationSummaryFamilyRow[] = [];
    const totals = Object.fromEntries(VERIFICATION_SUMMARY_STATUSES.map((status) => [status, 0])) as Record<
        string,
        number
    >;
    totals.total = 0;

    for (const config of configs) {
        const caps = await registry.getTargetColumnCapabilities(config.table);
        const support = verificationSummarySupport(caps);
        const emptyRow: VerificationSummaryFamilyRow = {
            family: config.family,
            label: config.label,
            table: config.table,
            path: config.path,
            source_label: config.sourceLabel ?? null,
            total: 0,
            unverified: 0,
            verified: 0,
            needs_fix: 0,
            questionable: 0,
            rejected_after_core_review: 0,
            support,
        };

        if (!support.table_exists || !hasAll(caps, config.idColumns)) {
            families.push(emptyRow);
            continue;
        }

        const countSelect = verificationSummaryCountSelect(caps);
        if (!countSelect) {
            families.push(emptyRow);
            continue;
        }

        const rows = await prisma.$queryRaw<Record<string, bigint>[]>(Prisma.sql`
            SELECT ${countSelect}
            FROM ${qtable(config.table)} AS t
            ${caps.hasDeletedAt ? Prisma.sql`WHERE t.deleted_at IS NULL` : Prisma.empty}
        `);
        const row = rows[0] ?? {};
        const item: VerificationSummaryFamilyRow = {
            ...emptyRow,
            total: Number(row.total ?? 0n),
            unverified: Number(row.unverified ?? 0n),
            verified: Number(row.verified ?? 0n),
            needs_fix: Number(row.needs_fix ?? 0n),
            questionable: Number(row.questionable ?? 0n),
            rejected_after_core_review: Number(row.rejected_after_core_review ?? 0n),
        };
        families.push(item);
        totals.total += item.total;
        for (const status of VERIFICATION_SUMMARY_STATUSES) {
            totals[status] += item[status];
        }
    }

    return { statuses: VERIFICATION_SUMMARY_STATUSES, families, totals };
}

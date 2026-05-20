import type { PrismaClient } from "@prisma/client";

import {
    ImportReviewBatchAmbiguousError,
    ImportReviewBatchNotFoundError,
    ImportReviewInvalidScopeError,
} from "./import-review-errors.js";
import { logImportReviewBatchResolveHintsDev } from "./import-review-database-url.js";

export type ImportReviewBatchSelectedBy =
    | "review_batch_id"
    | "source_snapshot_version_unique"
    | "source_snapshot_version_latest";

export type ImportReviewBatchChoice = {
    id: string;
    batch_name: string;
    status: string;
    uploaded_at: string;
    total_candidate_count: number;
    entity_families: string[];
};

export type ImportReviewScopeQuery = {
    source_snapshot_version?: string | undefined;
    review_batch_id?: bigint | undefined;
    latest?: boolean | undefined;
};

/** Fully resolved workspace scope targeting one `import_review.review_batches` row. */
export type ImportReviewScopeResolved = {
    snapshotVersion: string;
    reviewBatchId: bigint;
    sourceSnapshotIdLocal: bigint | null;
    batchName: string;
    status: string;
    uploadedAt: Date;
    totalCandidateCount: number;
    entityFamilies: string[];
    selectedBy: ImportReviewBatchSelectedBy;
};

type ReviewBatchRowDb = {
    id: bigint;
    batch_name: string;
    source_snapshot_version: string;
    source_snapshot_id_local: bigint | null;
    status: string;
    entity_families: string[];
    total_candidate_count: number;
    uploaded_at: Date;
};

function toBatchChoice(row: ReviewBatchRowDb): ImportReviewBatchChoice {
    return {
        id: row.id.toString(),
        batch_name: row.batch_name,
        status: row.status,
        uploaded_at: row.uploaded_at.toISOString(),
        total_candidate_count: row.total_candidate_count,
        entity_families: [...row.entity_families],
    };
}

function toScopeResolved(
    row: ReviewBatchRowDb,
    selectedBy: ImportReviewBatchSelectedBy
): ImportReviewScopeResolved {
    return {
        reviewBatchId: row.id,
        snapshotVersion: row.source_snapshot_version,
        sourceSnapshotIdLocal: row.source_snapshot_id_local,
        batchName: row.batch_name,
        status: row.status,
        uploadedAt: row.uploaded_at,
        totalCandidateCount: row.total_candidate_count,
        entityFamilies: [...row.entity_families],
        selectedBy,
    };
}

export async function resolveImportReviewBatchScope(
    prisma: PrismaClient,
    query: ImportReviewScopeQuery
): Promise<ImportReviewScopeResolved> {
    if (query.review_batch_id != null) {
        const rows = await prisma.$queryRaw<ReviewBatchRowDb[]>`
            SELECT
                id,
                batch_name,
                source_snapshot_version,
                source_snapshot_id_local,
                status,
                entity_families,
                total_candidate_count,
                uploaded_at
            FROM import_review.review_batches
            WHERE id = ${query.review_batch_id}
            LIMIT 2
        `;
        if (rows.length === 0) {
            throw new ImportReviewBatchNotFoundError(query.review_batch_id.toString());
        }
        if (rows.length > 1) {
            throw new ImportReviewInvalidScopeError("review_batch_id resolution was ambiguous");
        }
        return toScopeResolved(rows[0]!, "review_batch_id");
    }

    const v = query.source_snapshot_version?.trim();
    if (!v) {
        throw new ImportReviewInvalidScopeError(
            "Provide source_snapshot_version (alias: snapshot_version) or review_batch_id"
        );
    }

    const rows = await prisma.$queryRaw<ReviewBatchRowDb[]>`
        SELECT
            id,
            batch_name,
            source_snapshot_version,
            source_snapshot_id_local,
            status,
            entity_families,
            total_candidate_count,
            uploaded_at
        FROM import_review.review_batches
        WHERE source_snapshot_version = ${v}
          AND status IS DISTINCT FROM 'archived'
        ORDER BY uploaded_at DESC, id DESC
    `;

    if (rows.length === 0) {
        await logImportReviewBatchResolveHintsDev(prisma, v);
        throw new ImportReviewBatchNotFoundError(v);
    }

    if (rows.length === 1) {
        return toScopeResolved(rows[0]!, "source_snapshot_version_unique");
    }

    if (query.latest === true) {
        return toScopeResolved(rows[0]!, "source_snapshot_version_latest");
    }

    throw new ImportReviewBatchAmbiguousError(
        v,
        rows.map(toBatchChoice)
    );
}

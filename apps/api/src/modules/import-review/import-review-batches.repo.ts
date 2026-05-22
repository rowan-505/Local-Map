import type { PrismaClient } from "@prisma/client";

export type ImportReviewBatchListRowDb = {
    id: bigint;
    batch_name: string;
    source_snapshot_version: string;
    status: string;
    uploaded_at: Date;
    created_at: Date;
    updated_at: Date;
    total_candidate_count: number;
    entity_families: string[];
};

export class ImportReviewBatchesRepository {
    constructor(private readonly prisma: PrismaClient) {}

    /** Lightweight batch rows — no geometry or large JSONB fields. */
    async listBySourceSnapshotVersion(sourceSnapshotVersion: string): Promise<ImportReviewBatchListRowDb[]> {
        return this.prisma.$queryRaw<ImportReviewBatchListRowDb[]>`
            SELECT
                id,
                batch_name,
                source_snapshot_version,
                status,
                uploaded_at,
                created_at,
                updated_at,
                total_candidate_count,
                entity_families
            FROM import_review.review_batches
            WHERE source_snapshot_version = ${sourceSnapshotVersion}
              AND status IS DISTINCT FROM 'archived'
            ORDER BY uploaded_at DESC, id DESC
        `;
    }
}

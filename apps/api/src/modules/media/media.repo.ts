import { Prisma, type PrismaClient } from "@prisma/client";

export type MediaAssetRow = {
    id: bigint;
    public_id: string;
    media_type: string;
    storage_scope: string;
    object_key: string;
    mime_type: string;
    byte_size: bigint;
    width: number | null;
    height: number | null;
    duration_ms: number | null;
    source_asset_id: bigint | null;
    status: string;
    created_by: bigint;
    created_at: Date;
    ready_at: Date | null;
};

export type ReportMediaRow = {
    id: bigint;
    report_id: bigint;
    asset_id: bigint;
    note: string | null;
    sort_order: number;
    created_at: Date;
};

export type ReportMediaEvidenceRow = {
    public_id: string;
    mime_type: string;
    byte_size: bigint;
    width: number | null;
    height: number | null;
    note: string | null;
    sort_order: number;
    published: boolean;
};

export type MediaPublishContext = {
    asset: MediaAssetRow;
    reportMediaId: bigint;
    reportId: bigint;
    reportPublicId: string;
    reportSourceCode: string;
    stopPublicId: string | null;
};

export type StopMediaRow = {
    id: bigint;
    stop_id: bigint;
    asset_id: bigint;
    source_report_media_id: bigint | null;
    note: string | null;
    is_primary: boolean;
    is_active: boolean;
    published_at: Date;
    created_at: Date;
};

export type PublicStopPhotoRow = {
    note: string | null;
    is_primary: boolean;
    detail_object_key: string;
    card_object_key: string | null;
    width: number | null;
    height: number | null;
};

const assetSelect = Prisma.sql`
    SELECT
        a.id,
        a.public_id::text AS public_id,
        a.media_type,
        a.storage_scope,
        a.object_key,
        a.mime_type,
        a.byte_size,
        a.width,
        a.height,
        a.duration_ms,
        a.source_asset_id,
        a.status,
        a.created_by,
        a.created_at,
        a.ready_at
    FROM media.assets a
`;

export class MediaRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async insertPending(input: {
        publicId: string;
        mediaType: string;
        storageScope: string;
        objectKey: string;
        mimeType: string;
        byteSize: number;
        createdBy: bigint;
    }): Promise<MediaAssetRow> {
        const rows = await this.prisma.$queryRaw<MediaAssetRow[]>(Prisma.sql`
            INSERT INTO media.assets (
                public_id, media_type, storage_scope, object_key, mime_type, byte_size,
                status, created_by
            ) VALUES (
                ${input.publicId}::uuid,
                ${input.mediaType},
                ${input.storageScope},
                ${input.objectKey},
                ${input.mimeType},
                ${input.byteSize},
                'pending',
                ${input.createdBy}
            )
            RETURNING
                id,
                public_id::text AS public_id,
                media_type,
                storage_scope,
                object_key,
                mime_type,
                byte_size,
                width,
                height,
                duration_ms,
                source_asset_id,
                status,
                created_by,
                created_at,
                ready_at
        `);
        return rows[0]!;
    }

    async findByPublicId(publicId: string): Promise<MediaAssetRow | null> {
        const rows = await this.prisma.$queryRaw<MediaAssetRow[]>(Prisma.sql`
            ${assetSelect}
            WHERE a.public_id = ${publicId}::uuid
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    async markReady(input: { publicId: string; createdBy: bigint }): Promise<MediaAssetRow | null> {
        const rows = await this.prisma.$queryRaw<MediaAssetRow[]>(Prisma.sql`
            UPDATE media.assets
            SET status = 'ready', ready_at = now()
            WHERE public_id = ${input.publicId}::uuid
              AND created_by = ${input.createdBy}
              AND status = 'pending'
            RETURNING
                id,
                public_id::text AS public_id,
                media_type,
                storage_scope,
                object_key,
                mime_type,
                byte_size,
                width,
                height,
                duration_ms,
                source_asset_id,
                status,
                created_by,
                created_at,
                ready_at
        `);
        return rows[0] ?? null;
    }

    async nextReportMediaSortOrder(reportId: bigint): Promise<number> {
        const rows = await this.prisma.$queryRaw<{ next: number }[]>(Prisma.sql`
            SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
            FROM feedback.report_media
            WHERE report_id = ${reportId}
        `);
        return rows[0]?.next ?? 0;
    }

    async attachToReport(input: {
        reportId: bigint;
        assetId: bigint;
        note: string | null;
        sortOrder: number;
    }): Promise<ReportMediaRow> {
        const rows = await this.prisma.$queryRaw<ReportMediaRow[]>(Prisma.sql`
            INSERT INTO feedback.report_media (report_id, asset_id, note, sort_order)
            VALUES (${input.reportId}, ${input.assetId}, ${input.note}, ${input.sortOrder})
            ON CONFLICT (report_id, asset_id) DO UPDATE
            SET note = COALESCE(EXCLUDED.note, report_media.note)
            RETURNING id, report_id, asset_id, note, sort_order, created_at
        `);
        return rows[0]!;
    }

    async listReadyPrivateForReport(reportId: bigint): Promise<ReportMediaEvidenceRow[]> {
        return this.prisma.$queryRaw<ReportMediaEvidenceRow[]>(Prisma.sql`
            SELECT
                a.public_id::text AS public_id,
                a.mime_type,
                a.byte_size,
                a.width,
                a.height,
                rm.note,
                rm.sort_order,
                EXISTS (
                    SELECT 1
                    FROM transport.stop_media sm
                    WHERE sm.source_report_media_id = rm.id
                      AND sm.is_active
                ) AS published
            FROM feedback.report_media rm
            INNER JOIN media.assets a ON a.id = rm.asset_id
            WHERE rm.report_id = ${reportId}
              AND a.status = 'ready'
              AND a.storage_scope = 'private'
            ORDER BY rm.sort_order ASC, rm.id ASC
        `);
    }

    async findLinkedByPublicId(publicId: string): Promise<MediaAssetRow | null> {
        const rows = await this.prisma.$queryRaw<MediaAssetRow[]>(Prisma.sql`
            SELECT
                a.id,
                a.public_id::text AS public_id,
                a.media_type,
                a.storage_scope,
                a.object_key,
                a.mime_type,
                a.byte_size,
                a.width,
                a.height,
                a.duration_ms,
                a.source_asset_id,
                a.status,
                a.created_by,
                a.created_at,
                a.ready_at
            FROM media.assets a
            INNER JOIN feedback.report_media rm ON rm.asset_id = a.id
            INNER JOIN feedback.user_reports r ON r.id = rm.report_id
            WHERE a.public_id = ${publicId}::uuid
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    async findPublishContext(assetPublicId: string): Promise<MediaPublishContext | null> {
        const rows = await this.prisma.$queryRaw<
            (MediaAssetRow & {
                report_media_id: bigint;
                report_id: bigint;
                report_public_id: string;
                report_source_code: string;
                stop_public_id: string | null;
            })[]
        >(Prisma.sql`
            SELECT
                a.id,
                a.public_id::text AS public_id,
                a.media_type,
                a.storage_scope,
                a.object_key,
                a.mime_type,
                a.byte_size,
                a.width,
                a.height,
                a.duration_ms,
                a.source_asset_id,
                a.status,
                a.created_by,
                a.created_at,
                a.ready_at,
                rm.id AS report_media_id,
                r.id AS report_id,
                r.public_id::text AS report_public_id,
                COALESCE(r.source_code, 'public') AS report_source_code,
                COALESCE(
                    CASE
                        WHEN (r.report_data->>'stopPublicId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                        THEN r.report_data->>'stopPublicId'
                        ELSE NULL
                    END,
                    CASE
                        WHEN r.target_entity_type = 'stop' THEN r.target_public_id::text
                        ELSE NULL
                    END
                ) AS stop_public_id
            FROM media.assets a
            INNER JOIN feedback.report_media rm ON rm.asset_id = a.id
            INNER JOIN feedback.user_reports r ON r.id = rm.report_id
            WHERE a.public_id = ${assetPublicId}::uuid
            LIMIT 1
        `);
        const row = rows[0];
        if (!row) {
            return null;
        }
        const { report_media_id, report_id, report_public_id, report_source_code, stop_public_id, ...asset } = row;
        return {
            asset,
            reportMediaId: report_media_id,
            reportId: report_id,
            reportPublicId: report_public_id,
            reportSourceCode: report_source_code,
            stopPublicId: stop_public_id,
        };
    }

    async hasActiveStopMediaForReportMedia(reportMediaId: bigint): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<{ has_row: boolean }[]>(Prisma.sql`
            SELECT EXISTS (
                SELECT 1
                FROM transport.stop_media sm
                WHERE sm.source_report_media_id = ${reportMediaId}
                  AND sm.is_active
            ) AS has_row
        `);
        return rows[0]?.has_row === true;
    }

    async findStopIdByPublicId(stopPublicId: string): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT s.id
            FROM transport.stops s
            WHERE s.public_id = ${stopPublicId}::uuid
              AND s.deleted_at IS NULL
            LIMIT 1
        `);
        return rows[0]?.id ?? null;
    }

    async insertReadyPublic(input: {
        publicId: string;
        objectKey: string;
        mimeType: string;
        byteSize: number;
        width: number;
        height: number;
        sourceAssetId: bigint;
        createdBy: bigint;
    }): Promise<MediaAssetRow> {
        const rows = await this.prisma.$queryRaw<MediaAssetRow[]>(Prisma.sql`
            INSERT INTO media.assets (
                public_id, media_type, storage_scope, object_key, mime_type, byte_size,
                width, height, source_asset_id, status, created_by, ready_at
            ) VALUES (
                ${input.publicId}::uuid,
                'image',
                'public',
                ${input.objectKey},
                ${input.mimeType},
                ${input.byteSize},
                ${input.width},
                ${input.height},
                ${input.sourceAssetId},
                'ready',
                ${input.createdBy},
                now()
            )
            RETURNING
                id,
                public_id::text AS public_id,
                media_type,
                storage_scope,
                object_key,
                mime_type,
                byte_size,
                width,
                height,
                duration_ms,
                source_asset_id,
                status,
                created_by,
                created_at,
                ready_at
        `);
        return rows[0]!;
    }

    async insertStopMedia(input: {
        stopId: bigint;
        assetId: bigint;
        sourceReportMediaId: bigint;
        note: string | null;
        isPrimary: boolean;
        audit: { actorUserId: bigint | null; ipAddress: string | null; userAgent: string | null };
    }): Promise<StopMediaRow> {
        const rows = await this.prisma.$transaction(async (tx) => {
            if (input.isPrimary) {
                await tx.$executeRaw(Prisma.sql`
                    UPDATE transport.stop_media
                    SET is_primary = false
                    WHERE stop_id = ${input.stopId}
                      AND is_active
                      AND is_primary
                `);
            }
            const inserted = await tx.$queryRaw<StopMediaRow[]>(Prisma.sql`
                INSERT INTO transport.stop_media (
                    stop_id, asset_id, source_report_media_id, note, is_primary, is_active
                ) VALUES (
                    ${input.stopId},
                    ${input.assetId},
                    ${input.sourceReportMediaId},
                    ${input.note},
                    ${input.isPrimary},
                    true
                )
                RETURNING id, stop_id, asset_id, source_report_media_id, note, is_primary, is_active, published_at, created_at
            `);
            const after = inserted[0]!;
            const afterJson = JSON.stringify({
                stop_id: after.stop_id.toString(),
                asset_id: after.asset_id.toString(),
                source_report_media_id: after.source_report_media_id?.toString() ?? null,
                is_primary: after.is_primary,
            });
            await tx.$executeRaw(Prisma.sql`
                INSERT INTO system.audit_logs
                    (actor_user_id, action_type, entity_type, entity_id, before_snapshot, after_snapshot, ip_address, user_agent)
                VALUES (
                    ${input.audit.actorUserId},
                    'publish_stop_photo',
                    'transport_stop_media',
                    ${after.id},
                    NULL,
                    ${afterJson}::jsonb,
                    ${input.audit.ipAddress},
                    ${input.audit.userAgent}
                )
            `);
            return inserted;
        });
        return rows[0]!;
    }

    async listActivePublicStopPhotos(stopPublicId: string): Promise<PublicStopPhotoRow[]> {
        return this.prisma.$queryRaw<PublicStopPhotoRow[]>(Prisma.sql`
            SELECT
                sm.note,
                sm.is_primary,
                detail.object_key AS detail_object_key,
                card.object_key AS card_object_key,
                detail.width,
                detail.height
            FROM transport.stop_media sm
            INNER JOIN transport.stops s ON s.id = sm.stop_id
            INNER JOIN media.assets detail ON detail.id = sm.asset_id
            LEFT JOIN media.assets card
                ON card.source_asset_id = detail.source_asset_id
               AND card.id <> detail.id
               AND card.storage_scope = 'public'
               AND card.status = 'ready'
               AND card.object_key LIKE '%/c640.jpg'
            WHERE s.public_id = ${stopPublicId}::uuid
              AND sm.is_active
              AND detail.storage_scope = 'public'
              AND detail.status = 'ready'
            ORDER BY sm.is_primary DESC, sm.published_at DESC, sm.id DESC
        `);
    }
}

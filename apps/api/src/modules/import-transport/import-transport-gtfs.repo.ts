import { Prisma, type PrismaClient } from "@prisma/client";

import type {
    ImportTransportGtfsExportsListQuery,
    ImportTransportGtfsOtpBuildsListQuery,
} from "./import-transport-gtfs.schema.js";
import type { ReadinessCounts } from "./import-transport-gtfs-readiness.js";

type ExportBuildRowDb = {
    id: bigint;
    build_code: string;
    scope: string;
    status: string;
    output_path: string | null;
    file_size_bytes: bigint | null;
    checksum: string | null;
    route_count: number;
    variant_count: number;
    stop_count: number;
    service_count: number;
    warning_count: number;
    error_count: number;
    started_at: Date | null;
    finished_at: Date | null;
    created_at: Date;
    notes: string | null;
    file_count: bigint;
    latest_otp_build_status: string | null;
};

export class ImportTransportGtfsRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async gtfsExportSchemaAvailable(): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<{ exists: boolean }[]>`
            select exists(
                select 1
                from information_schema.tables
                where table_schema = 'gtfs_export'
                  and table_name = 'export_builds'
            ) as exists
        `;
        return rows[0]?.exists === true;
    }

    async fetchReadinessSnapshot(): Promise<ReadinessCounts | null> {
        const viewRows = await this.prisma.$queryRaw<{ exists: boolean }[]>`
            select exists(
                select 1
                from information_schema.views
                where table_schema = 'core_transport'
                  and table_name = 'v_gtfs_readiness_summary'
            ) as exists
        `;
        if (!viewRows[0]?.exists) {
            return null;
        }

        const readinessRows = await this.prisma.$queryRaw<ReadinessCounts[]>`
            select
                active_routes,
                active_variants,
                active_stops,
                variants_too_few_stops,
                duplicate_sequences,
                stops_without_names,
                variants_without_frequency,
                variants_without_path
            from core_transport.v_gtfs_readiness_summary
        `;

        return readinessRows[0] ?? null;
    }

    async createDryRunExport(input: {
        build_code: string;
        scope: string;
        status: string;
        route_count: number;
        variant_count: number;
        stop_count: number;
        warning_count: number;
        error_count: number;
        notes: string;
        started_at: Date;
        finished_at: Date;
    }): Promise<bigint> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            insert into gtfs_export.export_builds (
                build_code,
                scope,
                status,
                route_count,
                variant_count,
                stop_count,
                warning_count,
                error_count,
                notes,
                started_at,
                finished_at
            )
            values (
                ${input.build_code},
                ${input.scope},
                ${input.status},
                ${input.route_count},
                ${input.variant_count},
                ${input.stop_count},
                ${input.warning_count},
                ${input.error_count},
                ${input.notes},
                ${input.started_at},
                ${input.finished_at}
            )
            returning id
        `;
        return rows[0]!.id;
    }

    async createValidationReport(input: {
        export_build_id: bigint;
        validator_name: string;
        report_status: string;
        error_count: number;
        warning_count: number;
        info_count: number;
        report_summary: string;
        started_at: Date;
        finished_at: Date;
    }): Promise<void> {
        await this.prisma.$executeRaw`
            insert into gtfs_export.validation_reports (
                export_build_id,
                validator_name,
                report_status,
                error_count,
                warning_count,
                info_count,
                report_summary,
                started_at,
                finished_at
            )
            values (
                ${input.export_build_id},
                ${input.validator_name},
                ${input.report_status},
                ${input.error_count},
                ${input.warning_count},
                ${input.info_count},
                ${input.report_summary},
                ${input.started_at},
                ${input.finished_at}
            )
        `;
    }

    async listExports(
        query: ImportTransportGtfsExportsListQuery
    ): Promise<{ rows: ExportBuildRowDb[]; total: bigint }> {
        const parts: Prisma.Sql[] = [Prisma.sql`true`];
        if (query.scope) {
            parts.push(Prisma.sql`eb.scope = ${query.scope}`);
        }
        if (query.status) {
            parts.push(Prisma.sql`eb.status = ${query.status}`);
        }
        const where = Prisma.join(parts, " AND ");

        const [rows, totalRows] = await Promise.all([
            this.prisma.$queryRaw<ExportBuildRowDb[]>`
                select
                    eb.id,
                    eb.build_code,
                    eb.scope,
                    eb.status,
                    eb.output_path,
                    eb.file_size_bytes,
                    eb.checksum,
                    eb.route_count,
                    eb.variant_count,
                    eb.stop_count,
                    eb.service_count,
                    eb.warning_count,
                    eb.error_count,
                    eb.started_at,
                    eb.finished_at,
                    eb.created_at,
                    eb.notes,
                    count(ef.id)::bigint as file_count,
                    (
                        select ob.build_status
                        from gtfs_export.otp_graph_builds as ob
                        where ob.export_build_id = eb.id
                        order by ob.created_at desc
                        limit 1
                    ) as latest_otp_build_status
                from gtfs_export.export_builds as eb
                left join gtfs_export.export_files as ef
                    on ef.export_build_id = eb.id
                where ${where}
                group by eb.id
                order by eb.created_at desc
                limit ${query.limit} offset ${query.offset}
            `,
            this.prisma.$queryRaw<{ count: bigint }[]>`
                select count(*)::bigint as count
                from gtfs_export.export_builds as eb
                where ${where}
            `,
        ]);

        return { rows, total: totalRows[0]?.count ?? 0n };
    }

    async getExportById(id: bigint): Promise<ExportBuildRowDb | null> {
        const rows = await this.prisma.$queryRaw<ExportBuildRowDb[]>`
            select
                eb.id,
                eb.build_code,
                eb.scope,
                eb.status,
                eb.output_path,
                eb.file_size_bytes,
                eb.checksum,
                eb.route_count,
                eb.variant_count,
                eb.stop_count,
                eb.service_count,
                eb.warning_count,
                eb.error_count,
                eb.started_at,
                eb.finished_at,
                eb.created_at,
                eb.notes,
                count(ef.id)::bigint as file_count,
                (
                    select ob.build_status
                    from gtfs_export.otp_graph_builds as ob
                    where ob.export_build_id = eb.id
                    order by ob.created_at desc
                    limit 1
                ) as latest_otp_build_status
            from gtfs_export.export_builds as eb
            left join gtfs_export.export_files as ef
                on ef.export_build_id = eb.id
            where eb.id = ${id}
            group by eb.id
        `;
        return rows[0] ?? null;
    }

    async listExportFiles(exportBuildId: bigint) {
        return this.prisma.$queryRaw<
            Array<{
                id: bigint;
                file_name: string;
                file_path: string;
                row_count: bigint | null;
                checksum: string | null;
                created_at: Date;
            }>
        >`
            select id, file_name, file_path, row_count, checksum, created_at
            from gtfs_export.export_files
            where export_build_id = ${exportBuildId}
            order by file_name asc
        `;
    }

    async getLatestValidationReport(exportBuildId: bigint) {
        const rows = await this.prisma.$queryRaw<
            Array<{
                id: bigint;
                validator_name: string;
                validator_version: string | null;
                report_status: string;
                error_count: number;
                warning_count: number;
                info_count: number;
                report_summary: string | null;
                artifact_path: string | null;
                started_at: Date | null;
                finished_at: Date | null;
                created_at: Date;
            }>
        >`
            select
                id,
                validator_name,
                validator_version,
                report_status,
                error_count,
                warning_count,
                info_count,
                report_summary,
                artifact_path,
                started_at,
                finished_at,
                created_at
            from gtfs_export.validation_reports
            where export_build_id = ${exportBuildId}
            order by created_at desc
            limit 1
        `;
        return rows[0] ?? null;
    }

    async listValidationIssues(exportBuildId: bigint, limit: number, offset: number) {
        const [rows, totalRows] = await Promise.all([
            this.prisma.$queryRaw<
                Array<{
                    id: bigint;
                    gtfs_file: string;
                    row_ref: string | null;
                    issue_code: string;
                    severity: string;
                    message: string;
                    is_resolved: boolean;
                    created_at: Date;
                }>
            >`
                select id, gtfs_file, row_ref, issue_code, severity, message, is_resolved, created_at
                from gtfs_export.validation_issues
                where export_build_id = ${exportBuildId}
                order by
                    case severity when 'error' then 1 when 'warning' then 2 else 3 end,
                    created_at desc
                limit ${limit} offset ${offset}
            `,
            this.prisma.$queryRaw<{ count: bigint }[]>`
                select count(*)::bigint as count
                from gtfs_export.validation_issues
                where export_build_id = ${exportBuildId}
            `,
        ]);
        return { rows, total: totalRows[0]?.count ?? 0n };
    }

    async listOtpBuildsForExport(exportBuildId: bigint) {
        return this.listOtpBuilds({ export_build_id: Number(exportBuildId), limit: 20, offset: 0 });
    }

    async listOtpBuilds(query: ImportTransportGtfsOtpBuildsListQuery) {
        const parts: Prisma.Sql[] = [Prisma.sql`true`];
        if (query.export_build_id != null) {
            parts.push(Prisma.sql`ob.export_build_id = ${BigInt(query.export_build_id)}`);
        }
        if (query.scope) {
            parts.push(Prisma.sql`ob.scope = ${query.scope}`);
        }
        if (query.build_status) {
            parts.push(Prisma.sql`ob.build_status = ${query.build_status}`);
        }
        const where = Prisma.join(parts, " AND ");

        const [rows, totalRows] = await Promise.all([
            this.prisma.$queryRaw<
                Array<{
                    id: bigint;
                    public_id: string;
                    export_build_id: bigint | null;
                    build_code: string;
                    scope: string;
                    otp_version: string | null;
                    build_status: string;
                    gtfs_input_path: string | null;
                    graph_artifact_path: string | null;
                    error_message: string | null;
                    started_at: Date | null;
                    finished_at: Date | null;
                    created_at: Date;
                    updated_at: Date;
                }>
            >`
                select
                    id,
                    public_id,
                    export_build_id,
                    build_code,
                    scope,
                    otp_version,
                    build_status,
                    gtfs_input_path,
                    graph_artifact_path,
                    error_message,
                    started_at,
                    finished_at,
                    created_at,
                    updated_at
                from gtfs_export.otp_graph_builds as ob
                where ${where}
                order by ob.created_at desc
                limit ${query.limit} offset ${query.offset}
            `,
            this.prisma.$queryRaw<{ count: bigint }[]>`
                select count(*)::bigint as count
                from gtfs_export.otp_graph_builds as ob
                where ${where}
            `,
        ]);

        return { rows, total: totalRows[0]?.count ?? 0n };
    }
}

import {
    ImportTransportGtfsExportNotFoundError,
    ImportTransportGtfsSchemaMissingError,
} from "./import-transport-gtfs.errors.js";
import { ImportTransportGtfsRepository } from "./import-transport-gtfs.repo.js";
import {
    buildDryRunBuildCode,
    buildExportNotes,
    mapReadinessRow,
    parseNotesSnapshot,
    readinessValidationCounts,
} from "./import-transport-gtfs-readiness.js";
import type {
    ImportTransportGtfsExportsListQuery,
    ImportTransportGtfsOtpBuildsListQuery,
    PostImportTransportGtfsExportBody,
} from "./import-transport-gtfs.schema.js";
import type {
    ImportTransportGtfsCreateExportResult,
    ImportTransportGtfsExportDetail,
    ImportTransportGtfsExportListItem,
    ImportTransportGtfsExportValidationResponse,
    ImportTransportGtfsListResponse,
    ImportTransportGtfsOtpBuildListItem,
    ImportTransportGtfsValidationIssue,
    ImportTransportGtfsValidationReport,
} from "./import-transport-gtfs.types.js";
import { PLANNED_GTFS_EXPORT_FILES as plannedFiles } from "./import-transport-gtfs.types.js";

const OTP_CONSUMPTION_NOTE =
    "OpenTripPlanner consumes GTFS export files and graph artifacts — not Postgres.";

function toIso(value: Date | null | undefined): string | null {
    return value ? value.toISOString() : null;
}

function isDryRunNotes(notes: string | null): boolean {
    if (!notes?.trim()) {
        return false;
    }
    try {
        const parsed = JSON.parse(notes) as { dry_run?: boolean };
        return parsed.dry_run === true;
    } catch {
        return false;
    }
}

function validationStatusFromExport(status: string, errorCount: number): string {
    if (status === "valid" || status === "invalid" || status === "validating") {
        return status;
    }
    if (errorCount > 0) {
        return "invalid";
    }
    if (status === "draft" || status === "building" || status === "built") {
        return "pending";
    }
    return status;
}

type ExportBuildRow = NonNullable<Awaited<ReturnType<ImportTransportGtfsRepository["getExportById"]>>>;

export class ImportTransportGtfsService {
    constructor(private readonly repo: ImportTransportGtfsRepository) {}

    private async ensureSchema(): Promise<void> {
        if (!(await this.repo.gtfsExportSchemaAvailable())) {
            throw new ImportTransportGtfsSchemaMissingError();
        }
    }

    async listExports(
        query: ImportTransportGtfsExportsListQuery
    ): Promise<ImportTransportGtfsListResponse<ImportTransportGtfsExportListItem>> {
        await this.ensureSchema();
        const { rows, total } = await this.repo.listExports(query);
        return {
            items: rows.map((row) => this.mapListItem(row)),
            total: Number(total),
            limit: query.limit,
            offset: query.offset,
        };
    }

    async getExportById(id: bigint): Promise<ImportTransportGtfsExportDetail> {
        await this.ensureSchema();
        const row = await this.repo.getExportById(id);
        if (!row) {
            throw new ImportTransportGtfsExportNotFoundError(id.toString());
        }
        return this.mapDetail(row);
    }

    async getExportValidation(exportId: bigint): Promise<ImportTransportGtfsExportValidationResponse> {
        await this.ensureSchema();
        const row = await this.repo.getExportById(exportId);
        if (!row) {
            throw new ImportTransportGtfsExportNotFoundError(exportId.toString());
        }

        const [report, issuesResult] = await Promise.all([
            this.repo.getLatestValidationReport(exportId),
            this.repo.listValidationIssues(exportId, 100, 0),
        ]);

        return {
            export_build_id: exportId.toString(),
            export_status: row.status,
            validation_report: report ? this.mapValidationReport(report) : null,
            issues: issuesResult.rows.map((issue) => this.mapValidationIssue(issue)),
            issue_total: Number(issuesResult.total),
            core_transport_snapshot: parseNotesSnapshot(row.notes),
            otp_consumption_note: OTP_CONSUMPTION_NOTE,
        };
    }

    async listOtpBuilds(
        query: ImportTransportGtfsOtpBuildsListQuery
    ): Promise<ImportTransportGtfsListResponse<ImportTransportGtfsOtpBuildListItem>> {
        await this.ensureSchema();
        const { rows, total } = await this.repo.listOtpBuilds(query);
        return {
            items: rows.map((row) => this.mapOtpBuild(row)),
            total: Number(total),
            limit: query.limit,
            offset: query.offset,
        };
    }

    async createExport(body: PostImportTransportGtfsExportBody): Promise<ImportTransportGtfsCreateExportResult> {
        await this.ensureSchema();

        const dryRun = body.dry_run !== false;
        const scope = body.scope ?? "yangon_local_bus";
        const now = new Date();

        const readiness = await this.repo.fetchReadinessSnapshot();
        if (!readiness) {
            throw new ImportTransportGtfsSchemaMissingError();
        }

        const snapshot = mapReadinessRow(readiness, now);
        const validation = readinessValidationCounts(snapshot);
        const status = validation.blocking ? "invalid" : dryRun ? "draft" : "building";
        const buildCode = buildDryRunBuildCode(scope, now);

        const exportId = await this.repo.createDryRunExport({
            build_code: buildCode,
            scope,
            status,
            route_count: snapshot.active_routes,
            variant_count: snapshot.active_variants,
            stop_count: snapshot.active_stops,
            warning_count: validation.warning_count,
            error_count: validation.error_count,
            notes: buildExportNotes({ dry_run: dryRun, snapshot }),
            started_at: now,
            finished_at: now,
        });

        await this.repo.createValidationReport({
            export_build_id: exportId,
            validator_name: "core_transport_readiness",
            report_status: "completed",
            error_count: validation.error_count,
            warning_count: validation.warning_count,
            info_count: 0,
            report_summary: validation.summary,
            started_at: now,
            finished_at: now,
        });

        const exportDetail = await this.getExportById(exportId);
        return {
            export: exportDetail,
            dry_run: dryRun,
            message: dryRun
                ? "Created GTFS export dry-run batch with core_transport readiness snapshot. No GTFS files were generated."
                : "Created GTFS export batch record. Full file generation is not implemented in the API yet.",
        };
    }

    private async mapDetail(row: ExportBuildRow): Promise<ImportTransportGtfsExportDetail> {
        const [files, validationReport, otpBuilds] = await Promise.all([
            this.repo.listExportFiles(row.id),
            this.repo.getLatestValidationReport(row.id),
            this.repo.listOtpBuildsForExport(row.id),
        ]);

        return {
            ...this.mapListItem(row),
            checksum: row.checksum,
            file_size_bytes: row.file_size_bytes == null ? null : Number(row.file_size_bytes),
            notes: row.notes,
            files: files.map((file) => ({
                id: file.id.toString(),
                file_name: file.file_name,
                file_path: file.file_path,
                row_count: file.row_count == null ? null : Number(file.row_count),
                checksum: file.checksum,
                created_at: file.created_at.toISOString(),
            })),
            planned_files: [...plannedFiles],
            validation_report: validationReport ? this.mapValidationReport(validationReport) : null,
            otp_builds: otpBuilds.rows.map((build) => this.mapOtpBuild(build)),
        };
    }

    private mapListItem(row: ExportBuildRow): ImportTransportGtfsExportListItem {
        return {
            id: row.id.toString(),
            build_code: row.build_code,
            scope: row.scope,
            status: row.status,
            output_path: row.output_path,
            route_count: row.route_count,
            variant_count: row.variant_count,
            stop_count: row.stop_count,
            service_count: row.service_count,
            warning_count: row.warning_count,
            error_count: row.error_count,
            created_at: row.created_at.toISOString(),
            started_at: toIso(row.started_at),
            finished_at: toIso(row.finished_at),
            core_transport_snapshot: parseNotesSnapshot(row.notes),
            validation_status: validationStatusFromExport(row.status, row.error_count),
            latest_otp_build_status: row.latest_otp_build_status,
            file_count: Number(row.file_count),
            dry_run: isDryRunNotes(row.notes),
        };
    }

    private mapValidationReport(row: {
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
    }): ImportTransportGtfsValidationReport {
        return {
            id: row.id.toString(),
            validator_name: row.validator_name,
            validator_version: row.validator_version,
            report_status: row.report_status,
            error_count: row.error_count,
            warning_count: row.warning_count,
            info_count: row.info_count,
            report_summary: row.report_summary,
            artifact_path: row.artifact_path,
            started_at: toIso(row.started_at),
            finished_at: toIso(row.finished_at),
            created_at: row.created_at.toISOString(),
        };
    }

    private mapValidationIssue(row: {
        id: bigint;
        gtfs_file: string;
        row_ref: string | null;
        issue_code: string;
        severity: string;
        message: string;
        is_resolved: boolean;
        created_at: Date;
    }): ImportTransportGtfsValidationIssue {
        return {
            id: row.id.toString(),
            gtfs_file: row.gtfs_file,
            row_ref: row.row_ref,
            issue_code: row.issue_code,
            severity: row.severity,
            message: row.message,
            is_resolved: row.is_resolved,
            created_at: row.created_at.toISOString(),
        };
    }

    private mapOtpBuild(row: {
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
    }): ImportTransportGtfsOtpBuildListItem {
        return {
            id: row.id.toString(),
            public_id: row.public_id,
            export_build_id: row.export_build_id?.toString() ?? null,
            build_code: row.build_code,
            scope: row.scope,
            otp_version: row.otp_version,
            build_status: row.build_status,
            gtfs_input_path: row.gtfs_input_path,
            graph_artifact_path: row.graph_artifact_path,
            error_message: row.error_message,
            started_at: toIso(row.started_at),
            finished_at: toIso(row.finished_at),
            created_at: row.created_at.toISOString(),
            updated_at: row.updated_at.toISOString(),
        };
    }
}

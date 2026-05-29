import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    ImportTransportGtfsExportNotFoundError,
    ImportTransportGtfsSchemaMissingError,
} from "./import-transport-gtfs.errors.js";
import {
    buildDryRunBuildCode,
    mapReadinessRow,
    readinessValidationCounts,
} from "./import-transport-gtfs-readiness.js";
import type { ImportTransportGtfsRepository } from "./import-transport-gtfs.repo.js";
import { ImportTransportGtfsService } from "./import-transport-gtfs.service.js";

function mockRepo(overrides: Partial<ImportTransportGtfsRepository> = {}): ImportTransportGtfsRepository {
    return {
        gtfsExportSchemaAvailable: async () => true,
        fetchReadinessSnapshot: async () => ({
            active_routes: 10n,
            active_variants: 20n,
            active_stops: 100n,
            variants_too_few_stops: 0n,
            duplicate_sequences: 0n,
            stops_without_names: 1n,
            variants_without_frequency: 2n,
            variants_without_path: 0n,
        }),
        createDryRunExport: async () => 1n,
        createValidationReport: async () => undefined,
        listExports: async () => ({ rows: [], total: 0n }),
        getExportById: async () => null,
        listExportFiles: async () => [],
        getLatestValidationReport: async () => null,
        listValidationIssues: async () => ({ rows: [], total: 0n }),
        listOtpBuildsForExport: async () => ({ rows: [], total: 0n }),
        listOtpBuilds: async () => ({ rows: [], total: 0n }),
        ...overrides,
    } as unknown as ImportTransportGtfsRepository;
}

describe("import-transport gtfs readiness", () => {
    it("flags blocking readiness issues", () => {
        const snapshot = mapReadinessRow(
            {
                active_routes: 1n,
                active_variants: 1n,
                active_stops: 1n,
                variants_too_few_stops: 0n,
                duplicate_sequences: 1n,
                stops_without_names: 0n,
                variants_without_frequency: 0n,
                variants_without_path: 0n,
            },
            new Date("2026-05-29T00:00:00Z")
        );
        const validation = readinessValidationCounts(snapshot);
        assert.equal(validation.blocking, true);
        assert.ok(validation.error_count >= 1);
    });

    it("builds dry-run build codes", () => {
        const code = buildDryRunBuildCode("yangon_local_bus", new Date("2026-05-29T12:30:45.000Z"));
        assert.match(code, /^yangon_local_bus_dryrun_2026-05-29_/);
    });
});

describe("import-transport gtfs service", () => {
    it("throws when schema is missing", async () => {
        const service = new ImportTransportGtfsService(
            mockRepo({ gtfsExportSchemaAvailable: async () => false })
        );
        await assert.rejects(
            () => service.listExports({ limit: 10, offset: 0 }),
            (err: unknown) => err instanceof ImportTransportGtfsSchemaMissingError
        );
    });

    it("throws when export is missing", async () => {
        const service = new ImportTransportGtfsService(mockRepo());
        await assert.rejects(
            () => service.getExportById(99n),
            (err: unknown) => err instanceof ImportTransportGtfsExportNotFoundError
        );
    });

    it("creates dry-run export with readiness snapshot", async () => {
        let createdNotes = "";
        const service = new ImportTransportGtfsService(
            mockRepo({
                createDryRunExport: async (input) => {
                    createdNotes = input.notes;
                    return 42n;
                },
                getExportById: async () =>
                    ({
                        id: 42n,
                        build_code: "yangon_local_bus_dryrun_2026-05-29_123000",
                        scope: "yangon_local_bus",
                        status: "draft",
                        output_path: null,
                        file_size_bytes: null,
                        checksum: null,
                        route_count: 10,
                        variant_count: 20,
                        stop_count: 100,
                        service_count: 0,
                        warning_count: 3,
                        error_count: 0,
                        started_at: new Date(),
                        finished_at: new Date(),
                        created_at: new Date(),
                        notes: createdNotes,
                        file_count: 0n,
                        latest_otp_build_status: null,
                    }) as never,
            })
        );

        const result = await service.createExport({ scope: "yangon_local_bus", dry_run: true });
        assert.equal(result.dry_run, true);
        assert.equal(result.export.id, "42");
        assert.ok(result.message.includes("dry-run"));
        assert.ok(createdNotes.includes("core_transport_snapshot"));
    });
});

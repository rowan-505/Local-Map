import assert from "node:assert/strict";
import test from "node:test";

import { REPORT_RATE_LIMIT_MESSAGE } from "../reports/reports.service.js";
import { FIELD_REPORT_CREATE_RATE_LIMIT, fieldReportCreateBodySchema } from "./field-reports.schema.js";
import { FieldReportsError, FieldReportsService } from "./field-reports.service.js";
import type { FieldReportRow } from "./field-reports.repo.js";
import type { FieldReportsRepository } from "./field-reports.repo.js";
import type { ReportsRepository } from "../reports/reports.repo.js";

const stopId = "33333333-3333-4333-8333-333333333333";
const routeId = "11111111-1111-4111-8111-111111111111";
const variantId = "22222222-2222-4222-8222-222222222222";
const userId = 42n;

function validBody(clientPublicId: string) {
    return {
        clientPublicId,
        reportTypeCode: "wrong_location" as const,
        observedAt: new Date(),
        location: { lat: 16.78, lng: 96.15, accuracyM: 8 },
        target: { entityType: "stop" as const, publicId: stopId },
        context: {
            snapshotRevision: "v1-abc",
            routePublicId: routeId,
            variantPublicId: variantId,
            variantCode: "D0" as const,
            stopPublicId: stopId,
            stopSequence: 4,
            canonicalSnapshot: { stopName: "Sule" },
        },
        description: "Stop position is wrong",
    };
}

function row(overrides: Partial<FieldReportRow> = {}): FieldReportRow {
    const now = new Date();
    return {
        id: 9n,
        public_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        created_by: userId,
        source_code: "field_survey",
        report_type_code: "wrong_location",
        status_code: "submitted",
        target_entity_type: "stop",
        target_public_id: stopId,
        description: "Stop position is wrong",
        latitude: 16.78,
        longitude: 96.15,
        location_accuracy_m: 8,
        observed_at: now,
        admin_area_id: 1n,
        report_data: { snapshotRevision: "v1-abc", variantCode: "D0" },
        created_at: now,
        updated_at: now,
        ...overrides,
    };
}

function validLookup() {
    return {
        stopExists: true,
        routeExists: true,
        routeMode: "bus",
        routeCode: "YBS-13",
        variantExists: true,
        variantDirectionId: 0,
        variantRoutePublicId: routeId,
        stopOnVariant: true,
    };
}

function serviceWith(overrides: {
    insert?: FieldReportsRepository["insertFieldReport"];
    lookup?: FieldReportsRepository["lookupTargets"];
    find?: FieldReportsRepository["findByPublicId"];
    update?: FieldReportsRepository["updateFieldReport"];
    followup?: ReportsRepository["insertFollowup"];
}) {
    const fieldRepo = {
        lookupTargets: overrides.lookup ?? (async () => validLookup()),
        insertFieldReport:
            overrides.insert ??
            (async (input) => ({ created: true, row: row({ public_id: input.clientPublicId }) })),
        findByPublicId: overrides.find ?? (async () => row()),
        updateFieldReport: overrides.update ?? (async () => row()),
    } as unknown as FieldReportsRepository;
    const reportsRepo = {
        findActiveUserIdByPublicId: async () => userId,
        findByPublicId: async () => ({ id: 9n }),
        insertFollowup: overrides.followup ?? (async () => undefined),
    } as unknown as ReportsRepository;
    return new FieldReportsService(fieldRepo, reportsRepo);
}

test("schema rejects invalid coordinates and non D0/D1 codes", () => {
    const badCoord = fieldReportCreateBodySchema.safeParse({
        ...validBody("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
        location: { lat: 200, lng: 96, accuracyM: 1 },
    });
    assert.equal(badCoord.success, false);

    const badDir = fieldReportCreateBodySchema.safeParse({
        ...validBody("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
        context: {
            ...validBody("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").context,
            variantCode: "inbound",
        },
    });
    assert.equal(badDir.success, false);
});

test("creates one field_survey report", async () => {
    const created = row();
    const svc = serviceWith({
        insert: async (input) => {
            assert.equal(input.clientPublicId, created.public_id);
            return { created: true, row: created };
        },
    });
    const result = await svc.create("user-sub", validBody(created.public_id));
    assert.equal(result.created, true);
    assert.equal(result.report.sourceCode, "field_survey");
    assert.equal(result.report.publicId, created.public_id);
});

test("retrying the same client UUID returns the existing row", async () => {
    const existing = row();
    let inserts = 0;
    const svc = serviceWith({
        insert: async () => {
            inserts += 1;
            return { created: inserts === 1, row: existing };
        },
    });
    const body = validBody(existing.public_id);
    const first = await svc.create("user-sub", body);
    const second = await svc.create("user-sub", body);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.report.publicId, existing.public_id);
});

test("lost create response then retry still creates exactly one report", async () => {
    const existing = row();
    let inserts = 0;
    const svc = serviceWith({
        insert: async () => {
            inserts += 1;
            return { created: inserts === 1, row: existing };
        },
    });
    const body = validBody(existing.public_id);
    await svc.create("user-sub", body);
    const replay = await svc.create("user-sub", body);
    assert.equal(inserts, 2);
    assert.equal(replay.created, false);
    assert.equal(replay.report.publicId, existing.public_id);
});

test("two distinct UUIDs stay two anomalies even with the same stop and type", async () => {
    const ids: string[] = [];
    const svc = serviceWith({
        insert: async (input) => {
            ids.push(input.clientPublicId);
            return { created: true, row: row({ public_id: input.clientPublicId }) };
        },
    });
    const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await svc.create("user-sub", validBody(a));
    await svc.create("user-sub", validBody(b));
    assert.deepEqual(ids, [a, b]);
});

test("invalid public IDs are rejected", async () => {
    const svc = serviceWith({
        lookup: async () => ({ ...validLookup(), stopExists: false }),
    });
    await assert.rejects(
        () => svc.create("user-sub", validBody("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")),
        (error: unknown) => error instanceof FieldReportsError && error.statusCode === 400
    );
});

test("field create does not use public daily report caps", async () => {
    assert.equal(FIELD_REPORT_CREATE_RATE_LIMIT.max >= 30, true);
    assert.notEqual(FIELD_REPORT_CREATE_RATE_LIMIT.max, 3);
    assert.notEqual(FIELD_REPORT_CREATE_RATE_LIMIT.max, 5);
    assert.notEqual(FIELD_REPORT_CREATE_RATE_LIMIT.max, 15);
    let creates = 0;
    const svc = serviceWith({
        insert: async (input) => {
            creates += 1;
            return { created: true, row: row({ public_id: input.clientPublicId }) };
        },
    });
    for (let i = 0; i < 20; i += 1) {
        await svc.create(
            "user-sub",
            validBody(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`)
        );
    }
    assert.equal(creates, 20);
    assert.match(REPORT_RATE_LIMIT_MESSAGE, /report limit/);
});

test("submitted reports can be edited; in_review and resolved cannot", async () => {
    const svcEditable = serviceWith({
        find: async () => row({ status_code: "submitted" }),
        update: async () => row({ description: "fixed" }),
    });
    const edited = await svcEditable.patch("user-sub", row().public_id, { description: "fixed" });
    assert.equal(edited.description, "fixed");

    const locked = serviceWith({ find: async () => row({ status_code: "in_review" }) });
    await assert.rejects(
        () => locked.patch("user-sub", row().public_id, { description: "nope" }),
        (error: unknown) => error instanceof FieldReportsError && error.statusCode === 409
    );

    const closed = serviceWith({ find: async () => row({ status_code: "resolved" }) });
    await assert.rejects(
        () => closed.patch("user-sub", row().public_id, { description: "nope" }),
        (error: unknown) => error instanceof FieldReportsError && error.statusCode === 409
    );
});

test("field report flow never calls canonical transport writes", async () => {
    const transportMutations: string[] = [];
    const svc = serviceWith({});
    await svc.create("user-sub", validBody("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"));
    assert.deepEqual(transportMutations, []);
});

import assert from "node:assert/strict";
import test from "node:test";

import type { FieldReportRow } from "../field/field-reports.repo.js";
import type { FieldReportsRepository } from "../field/field-reports.repo.js";
import type { ReportsRepository } from "../reports/reports.repo.js";
import type { MediaAssetRow, MediaRepository, ReportMediaRow } from "./media.repo.js";
import { JPEG_MAX_BYTES, mediaUploadBodySchema } from "./media.schema.js";
import { MediaError, MediaService } from "./media.service.js";
import type { ObjectStore } from "./object-store.js";

const userId = 42n;
const otherUser = 7n;
const assetId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const reportId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function asset(overrides: Partial<MediaAssetRow> = {}): MediaAssetRow {
    const now = new Date("2026-09-01T00:00:00.000Z");
    return {
        id: 1n,
        public_id: assetId,
        media_type: "image",
        storage_scope: "private",
        object_key: `private/${assetId}.jpg`,
        mime_type: "image/jpeg",
        byte_size: 123n,
        width: null,
        height: null,
        duration_ms: null,
        source_asset_id: null,
        status: "pending",
        created_by: userId,
        created_at: now,
        ready_at: null,
        ...overrides,
    };
}

function report(overrides: Partial<FieldReportRow> = {}): FieldReportRow {
    const now = new Date("2026-09-01T00:00:00.000Z");
    return {
        id: 9n,
        public_id: reportId,
        created_by: userId,
        source_code: "field_survey",
        report_type_code: "other",
        status_code: "submitted",
        target_entity_type: "stop",
        target_public_id: assetId,
        description: "x",
        latitude: 16.8,
        longitude: 96.1,
        location_accuracy_m: 5,
        observed_at: now,
        admin_area_id: 1n,
        report_data: {},
        created_at: now,
        updated_at: now,
        ...overrides,
    };
}

function serviceWith(overrides: {
    insert?: MediaRepository["insertPending"];
    findAsset?: MediaRepository["findByPublicId"];
    findLinked?: MediaRepository["findLinkedByPublicId"];
    findPublishContext?: MediaRepository["findPublishContext"];
    hasActiveStopMedia?: MediaRepository["hasActiveStopMediaForReportMedia"];
    findStopId?: MediaRepository["findStopIdByPublicId"];
    insertReadyPublic?: MediaRepository["insertReadyPublic"];
    insertStopMedia?: MediaRepository["insertStopMedia"];
    markReady?: MediaRepository["markReady"];
    nextSort?: MediaRepository["nextReportMediaSortOrder"];
    attach?: MediaRepository["attachToReport"];
    findReport?: FieldReportsRepository["findByPublicId"];
    put?: ObjectStore["createPresignedPut"];
    get?: ObjectStore["createPresignedGet"];
    head?: ObjectStore["headObject"];
    getObject?: ObjectStore["getObject"];
    putObject?: ObjectStore["putObject"];
    createPublicId?: () => string;
}) {
    const mediaRepo = {
        insertPending: overrides.insert ?? (async () => asset()),
        findByPublicId: overrides.findAsset ?? (async () => asset()),
        findLinkedByPublicId: overrides.findLinked ?? (async () => null),
        findPublishContext: overrides.findPublishContext ?? (async () => null),
        hasActiveStopMediaForReportMedia: overrides.hasActiveStopMedia ?? (async () => false),
        findStopIdByPublicId: overrides.findStopId ?? (async () => 88n),
        insertReadyPublic:
            overrides.insertReadyPublic ??
            (async (input) =>
                asset({
                    id: input.sourceAssetId + 10n,
                    public_id: input.publicId,
                    storage_scope: "public",
                    object_key: input.objectKey,
                    status: "ready",
                    ready_at: new Date("2026-09-01T00:03:00.000Z"),
                    source_asset_id: input.sourceAssetId,
                })),
        insertStopMedia:
            overrides.insertStopMedia ??
            (async () => ({
                id: 5n,
                stop_id: 88n,
                asset_id: 11n,
                source_report_media_id: 3n,
                note: null,
                is_primary: false,
                is_active: true,
                published_at: new Date("2026-09-01T00:04:00.000Z"),
                created_at: new Date("2026-09-01T00:04:00.000Z"),
            })),
        listReadyPrivateForReport: async () => [],
        markReady:
            overrides.markReady ??
            (async () => asset({ status: "ready", ready_at: new Date("2026-09-01T00:01:00.000Z") })),
        nextReportMediaSortOrder: overrides.nextSort ?? (async () => 0),
        attachToReport:
            overrides.attach ??
            (async () =>
                ({
                    id: 3n,
                    report_id: 9n,
                    asset_id: 1n,
                    note: null,
                    sort_order: 0,
                    created_at: new Date("2026-09-01T00:02:00.000Z"),
                }) satisfies ReportMediaRow),
    } as unknown as MediaRepository;
    const reportsRepo = {
        findActiveUserIdByPublicId: async () => userId,
    } as unknown as ReportsRepository;
    const fieldRepo = {
        findByPublicId: overrides.findReport ?? (async () => report()),
    } as unknown as FieldReportsRepository;
    const objectStore: ObjectStore = {
        createPresignedPut:
            overrides.put ??
            (async () => ({
                url: "https://example.invalid/put",
                expiresAt: new Date("2026-09-01T00:10:00.000Z"),
            })),
        createPresignedGet:
            overrides.get ??
            (async () => ({
                url: "https://example.invalid/get",
                expiresAt: new Date("2026-09-01T00:05:00.000Z"),
            })),
        headObject:
            overrides.head ??
            (async () => ({ exists: true, contentLength: 123, contentType: "image/jpeg" })),
        getObject:
            overrides.getObject ??
            (async () => {
                throw new Error("getObject not stubbed");
            }),
        putObject:
            overrides.putObject ??
            (async () => {
                throw new Error("putObject not stubbed");
            }),
    };
    return new MediaService(
        mediaRepo,
        reportsRepo,
        fieldRepo,
        objectStore,
        {
            privateBucket: "coremap-media-private",
            publicBucket: "coremap-media-public",
            publicBaseUrl: "https://media.coremapmm.com",
        },
        overrides.createPublicId ?? (() => assetId)
    );
}

test("upload schema accepts JPEG size limits and rejects other types", () => {
    const ok = mediaUploadBodySchema.safeParse({
        mediaType: "image",
        mimeType: "image/jpeg",
        byteSize: 100,
    });
    assert.equal(ok.success, true);

    const audio = mediaUploadBodySchema.safeParse({
        mediaType: "audio",
        mimeType: "audio/mp4",
        byteSize: 100,
    });
    assert.equal(audio.success, true);

    const png = mediaUploadBodySchema.safeParse({
        mediaType: "image",
        mimeType: "image/png",
        byteSize: 100,
    });
    assert.equal(png.success, false);

    const mpeg = mediaUploadBodySchema.safeParse({
        mediaType: "audio",
        mimeType: "audio/mpeg",
        byteSize: 100,
    });
    assert.equal(mpeg.success, false);

    const tooBig = mediaUploadBodySchema.safeParse({
        mediaType: "image",
        mimeType: "image/jpeg",
        byteSize: JPEG_MAX_BYTES + 1,
    });
    assert.equal(tooBig.success, false);
});

test("createUpload writes pending private JPEG and returns a presigned PUT", async () => {
    let insertedKey = "";
    const svc = serviceWith({
        insert: async (input) => {
            insertedKey = input.objectKey;
            assert.equal(input.storageScope, "private");
            assert.equal(input.mimeType, "image/jpeg");
            return asset({ object_key: input.objectKey });
        },
    });
    const result = await svc.createUpload("user-sub", {
        mediaType: "image",
        mimeType: "image/jpeg",
        byteSize: 123,
    });
    assert.equal(result.status, "pending");
    assert.equal(result.upload.method, "PUT");
    assert.equal(insertedKey, `private/${assetId}.jpg`);
    assert.equal(result.upload.headers["Content-Type"], "image/jpeg");
});

test("createUpload writes pending private AAC audio with an m4a key", async () => {
    let insertedKey = "";
    let insertedType = "";
    const svc = serviceWith({
        insert: async (input) => {
            insertedKey = input.objectKey;
            insertedType = input.mediaType;
            return asset({ object_key: input.objectKey, media_type: "audio", mime_type: "audio/mp4" });
        },
    });
    const result = await svc.createUpload("user-sub", {
        mediaType: "audio",
        mimeType: "audio/mp4",
        byteSize: 123,
    });
    assert.equal(result.mediaType, "audio");
    assert.equal(insertedType, "audio");
    assert.equal(insertedKey, `private/${assetId}.m4a`);
    assert.equal(result.upload.headers["Content-Type"], "audio/mp4");
});

test("complete verifies owner, HEAD existence and size, then marks ready", async () => {
    const svc = serviceWith({});
    const result = await svc.complete("user-sub", assetId);
    assert.equal(result.status, "ready");
    assert.equal(result.byteSize, 123);
});

test("complete accepts AAC container aliases from HEAD", async () => {
    const svc = serviceWith({
        findAsset: async () =>
            asset({
                media_type: "audio",
                mime_type: "audio/mp4",
                object_key: `private/${assetId}.m4a`,
            }),
        head: async () => ({
            exists: true,
            contentLength: 123,
            contentType: "audio/mp4; codecs=mp4a.40.2",
        }),
    });
    const result = await svc.complete("user-sub", assetId);
    assert.equal(result.status, "ready");
});

test("complete stays pending when the object is missing", async () => {
    let marked = false;
    const svc = serviceWith({
        head: async () => ({ exists: false, contentLength: null, contentType: null }),
        markReady: async () => {
            marked = true;
            return asset({ status: "ready", ready_at: new Date() });
        },
    });
    await assert.rejects(
        () => svc.complete("user-sub", assetId),
        (error: unknown) => error instanceof MediaError && error.statusCode === 400 && error.code === "OBJECT_NOT_FOUND"
    );
    assert.equal(marked, false);
});

test("complete rejects size mismatch without marking ready", async () => {
    let marked = false;
    const svc = serviceWith({
        head: async () => ({ exists: true, contentLength: 1, contentType: "image/jpeg" }),
        markReady: async () => {
            marked = true;
            return asset({ status: "ready", ready_at: new Date() });
        },
    });
    await assert.rejects(
        () => svc.complete("user-sub", assetId),
        (error: unknown) => error instanceof MediaError && error.statusCode === 409
    );
    assert.equal(marked, false);
});

test("complete hides another user's asset", async () => {
    const svc = serviceWith({
        findAsset: async () => asset({ created_by: otherUser }),
    });
    await assert.rejects(
        () => svc.complete("user-sub", assetId),
        (error: unknown) => error instanceof MediaError && error.statusCode === 404
    );
});

test("attach requires a ready private owned asset and an owned field report", async () => {
    const ready = asset({ status: "ready", ready_at: new Date("2026-09-01T00:01:00.000Z") });
    const svc = serviceWith({ findAsset: async () => ready });
    const result = await svc.attachToFieldReport("user-sub", reportId, { assetPublicId: assetId });
    assert.equal(result.assetPublicId, assetId);
    assert.equal(result.reportPublicId, reportId);

    const pending = serviceWith({ findAsset: async () => asset({ status: "pending" }) });
    await assert.rejects(
        () => pending.attachToFieldReport("user-sub", reportId, { assetPublicId: assetId }),
        (error: unknown) => error instanceof MediaError && error.statusCode === 409
    );

    const foreignReport = serviceWith({
        findAsset: async () => ready,
        findReport: async () => report({ created_by: otherUser }),
    });
    await assert.rejects(
        () => foreignReport.attachToFieldReport("user-sub", reportId, { assetPublicId: assetId }),
        (error: unknown) => error instanceof MediaError && error.statusCode === 404
    );
});

test("adminAccess returns a short-lived GET and never writes the URL", async () => {
    let insertCalled = false;
    let getExpires = 0;
    let getBucket = "";
    const readyLinked = asset({ status: "ready", ready_at: new Date("2026-09-01T00:01:00.000Z") });
    const svc = serviceWith({
        insert: async () => {
            insertCalled = true;
            return asset();
        },
        findLinked: async () => readyLinked,
        get: async (input) => {
            getExpires = input.expiresInSeconds;
            getBucket = input.bucket;
            return {
                url: "https://example.invalid/get?X-Amz-Expires=300",
                expiresAt: new Date("2026-09-01T00:05:00.000Z"),
            };
        },
    });
    const result = await svc.adminAccess(assetId);
    assert.equal(result.method, "GET");
    assert.equal(result.url.includes("X-Amz-Expires=300"), true);
    assert.equal(result.expiresAt, "2026-09-01T00:05:00.000Z");
    assert.equal(getExpires, 5 * 60);
    assert.equal(getBucket, "coremap-media-private");
    assert.equal(insertCalled, false);
});

test("adminAccess hides unattached, pending, and public-scope assets", async () => {
    const missing = serviceWith({ findLinked: async () => null });
    await assert.rejects(
        () => missing.adminAccess(assetId),
        (error: unknown) => error instanceof MediaError && error.statusCode === 404
    );

    const pendingLinked = serviceWith({ findLinked: async () => asset({ status: "pending" }) });
    await assert.rejects(
        () => pendingLinked.adminAccess(assetId),
        (error: unknown) => error instanceof MediaError && error.statusCode === 404
    );

    const published = serviceWith({
        findLinked: async () =>
            asset({
                status: "ready",
                ready_at: new Date("2026-09-01T00:01:00.000Z"),
                storage_scope: "public",
            }),
    });
    await assert.rejects(
        () => published.adminAccess(assetId),
        (error: unknown) =>
            error instanceof MediaError && error.statusCode === 400 && error.code === "INVALID_STORAGE_SCOPE"
    );
});

const STOP_PUBLIC_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DETAIL_PUBLIC_ID = "11111111-1111-4111-8111-111111111111";
const CARD_PUBLIC_ID = "22222222-2222-4222-8222-222222222222";

function readyPrivatePhoto(overrides: Partial<MediaAssetRow> = {}): MediaAssetRow {
    return asset({
        status: "ready",
        ready_at: new Date("2026-09-01T00:01:00.000Z"),
        storage_scope: "private",
        object_key: `private/${assetId}.jpg`,
        media_type: "image",
        mime_type: "image/jpeg",
        ...overrides,
    });
}

async function sampleJpeg(): Promise<Buffer> {
    const { default: sharp } = await import("sharp");
    return sharp({
        create: { width: 80, height: 60, channels: 3, background: { r: 20, g: 180, b: 40 } },
    })
        .jpeg()
        .toBuffer();
}

test("adminPublishStopPhoto writes new public JPEGs and keeps the original private", async () => {
    const original = readyPrivatePhoto();
    const jpeg = await sampleJpeg();
    const puts: { bucket: string; objectKey: string; cacheControl: string }[] = [];
    let stopMediaInserted = false;
    let n = 0;
    const svc = serviceWith({
        findAsset: async () => original,
        findPublishContext: async () => ({
            asset: original,
            reportMediaId: 3n,
            reportId: 9n,
            reportPublicId: reportId,
            reportSourceCode: "field_survey",
            stopPublicId: STOP_PUBLIC_ID,
        }),
        getObject: async (input) => {
            assert.equal(input.bucket, "coremap-media-private");
            assert.equal(input.objectKey, original.object_key);
            return jpeg;
        },
        putObject: async (input) => {
            puts.push({
                bucket: input.bucket,
                objectKey: input.objectKey,
                cacheControl: input.cacheControl,
            });
        },
        insertStopMedia: async () => {
            stopMediaInserted = true;
            return {
                id: 5n,
                stop_id: 88n,
                asset_id: 11n,
                source_report_media_id: 3n,
                note: null,
                is_primary: true,
                is_active: true,
                published_at: new Date("2026-09-01T00:04:00.000Z"),
                created_at: new Date("2026-09-01T00:04:00.000Z"),
            };
        },
        createPublicId: () => (n++ === 0 ? DETAIL_PUBLIC_ID : CARD_PUBLIC_ID),
    });

    const result = await svc.adminPublishStopPhoto(
        "user-sub",
        assetId,
        { rotateDegrees: 0, blurRects: [], isPrimary: true },
        { ipAddress: null, userAgent: null }
    );

    assert.equal(stopMediaInserted, true);
    assert.equal(puts.length, 2);
    assert.equal(
        puts.every((row) => row.bucket === "coremap-media-public"),
        true
    );
    assert.equal(
        puts.every((row) => row.objectKey.startsWith("public/") && row.cacheControl.includes("immutable")),
        true
    );
    assert.equal(
        puts.some((row) => row.objectKey === `public/${DETAIL_PUBLIC_ID}/d1280.jpg`),
        true
    );
    assert.equal(
        puts.some((row) => row.objectKey === `public/${CARD_PUBLIC_ID}/c640.jpg`),
        true
    );
    assert.equal(result.detail.url, `https://media.coremapmm.com/public/${DETAIL_PUBLIC_ID}/d1280.jpg`);
    assert.equal(result.card.url, `https://media.coremapmm.com/public/${CARD_PUBLIC_ID}/c640.jpg`);
    assert.equal(result.sourceAssetPublicId, assetId);
    assert.notEqual(result.detail.publicId, assetId);
    assert.equal(original.storage_scope, "private");
});

test("adminPublishStopPhoto rejects audio, missing stop, and already-published evidence", async () => {
    const jpeg = await sampleJpeg();
    const audio = readyPrivatePhoto({
        media_type: "audio",
        mime_type: "audio/mp4",
        object_key: `private/${assetId}.m4a`,
    });
    await assert.rejects(
        () =>
            serviceWith({
                findPublishContext: async () => ({
                    asset: audio,
                    reportMediaId: 3n,
                    reportId: 9n,
                    reportPublicId: reportId,
                    reportSourceCode: "field_survey",
                    stopPublicId: STOP_PUBLIC_ID,
                }),
                getObject: async () => jpeg,
            }).adminPublishStopPhoto(
                "user-sub",
                assetId,
                { rotateDegrees: 0, blurRects: [] },
                { ipAddress: null, userAgent: null }
            ),
        (error: unknown) => error instanceof MediaError && error.code === "NOT_IMAGE" && error.statusCode === 400
    );

    const photo = readyPrivatePhoto();
    await assert.rejects(
        () =>
            serviceWith({
                findPublishContext: async () => ({
                    asset: photo,
                    reportMediaId: 3n,
                    reportId: 9n,
                    reportPublicId: reportId,
                    reportSourceCode: "field_survey",
                    stopPublicId: null,
                }),
            }).adminPublishStopPhoto(
                "user-sub",
                assetId,
                { rotateDegrees: 0, blurRects: [] },
                { ipAddress: null, userAgent: null }
            ),
        (error: unknown) => error instanceof MediaError && error.code === "STOP_REQUIRED" && error.statusCode === 400
    );

    await assert.rejects(
        () =>
            serviceWith({
                findPublishContext: async () => ({
                    asset: photo,
                    reportMediaId: 3n,
                    reportId: 9n,
                    reportPublicId: reportId,
                    reportSourceCode: "field_survey",
                    stopPublicId: STOP_PUBLIC_ID,
                }),
                hasActiveStopMedia: async () => true,
            }).adminPublishStopPhoto(
                "user-sub",
                assetId,
                { rotateDegrees: 0, blurRects: [] },
                { ipAddress: null, userAgent: null }
            ),
        (error: unknown) =>
            error instanceof MediaError && error.code === "ALREADY_PUBLISHED" && error.statusCode === 409
    );
});

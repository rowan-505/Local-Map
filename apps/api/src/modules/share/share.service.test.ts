import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SHARE_CODE_REGEX } from "./share.schema.js";
import type { InsertShareLinkInput, ShareRepository } from "./share.repo.js";
import { ShareError, ShareService, generateShareCode } from "./share.service.js";
import type { ShareLinkRow } from "./share.types.js";

const BASE_URL = "http://localhost:5173";

const round5 = (value: number) => Math.round(value * 1e5) / 1e5;
const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * In-memory ShareRepository stand-in. Implements the same dedup matching as the
 * DB unique indexes so the service's dedup/reuse path is exercised without a DB.
 */
class FakeShareRepository {
    rows: ShareLinkRow[] = [];
    knownPlaceIds = new Set<string>();
    recordAccessCalls = 0;
    recordAccessShouldThrow = false;

    async placeExists(placePublicId: string): Promise<boolean> {
        return this.knownPlaceIds.has(placePublicId);
    }

    async findByCode(code: string): Promise<ShareLinkRow | null> {
        return this.rows.find((row) => row.code === code) ?? null;
    }

    async findPlaceShare(placePublicId: string): Promise<ShareLinkRow | null> {
        return (
            this.rows.find(
                (row) => row.target_type === "place" && row.place_public_id === placePublicId,
            ) ?? null
        );
    }

    async findPointShare(
        lat: number,
        lng: number,
        zoom: number | null,
    ): Promise<ShareLinkRow | null> {
        const rl = round5(lat);
        const rg = round5(lng);
        const rz = round2(zoom ?? -1);
        return (
            this.rows.find(
                (row) =>
                    row.target_type === "point" &&
                    round5(row.lat ?? Number.NaN) === rl &&
                    round5(row.lng ?? Number.NaN) === rg &&
                    round2(row.zoom ?? -1) === rz,
            ) ?? null
        );
    }

    async insert(input: InsertShareLinkInput): Promise<ShareLinkRow> {
        const row: ShareLinkRow = {
            code: input.code,
            target_type: input.targetType,
            place_public_id: input.placePublicId,
            lat: input.lat,
            lng: input.lng,
            zoom: input.zoom,
            address_line: input.addressLine,
            plus_code: input.plusCode,
        };
        this.rows.push(row);
        return row;
    }

    async recordAccess(_code: string): Promise<void> {
        this.recordAccessCalls += 1;
        if (this.recordAccessShouldThrow) {
            throw new Error("simulated access tracking failure");
        }
    }
}

function makeService(repo: FakeShareRepository): ShareService {
    return new ShareService(repo as unknown as ShareRepository, BASE_URL);
}

const POINT_INPUT = {
    target_type: "point",
    lat: 16.639454,
    lng: 96.322949,
    zoom: 17,
    address_line: "Kyauktan Township, Yangon Region, Myanmar",
    plus_code: "7M8RJ8QF+Q5",
} as const;

describe("ShareService.create (point)", () => {
    it("creates a point share with a valid code and /s/ url", async () => {
        const repo = new FakeShareRepository();
        const service = makeService(repo);

        const result = await service.create({ ...POINT_INPUT });

        assert.ok(SHARE_CODE_REGEX.test(result.code), `code "${result.code}" must match the alphabet`);
        assert.ok(result.url.includes("/s/"), "url must contain /s/");
        assert.equal(result.url, `${BASE_URL}/s/${result.code}`);
        assert.equal(repo.rows.length, 1);
    });

    it("reuses the same code for an identical point (dedup)", async () => {
        const repo = new FakeShareRepository();
        const service = makeService(repo);

        const first = await service.create({ ...POINT_INPUT });
        const second = await service.create({ ...POINT_INPUT });

        assert.equal(second.code, first.code);
        assert.equal(repo.rows.length, 1, "no second row should be inserted");
    });
});

describe("ShareService.resolve (point)", () => {
    it("returns the stored point snapshot", async () => {
        const repo = new FakeShareRepository();
        const service = makeService(repo);

        const { code } = await service.create({ ...POINT_INPUT });
        const resolved = await service.resolve(code);

        assert.equal(resolved.target_type, "point");
        if (resolved.target_type !== "point") return; // narrow for TS
        assert.equal(resolved.lat, POINT_INPUT.lat);
        assert.equal(resolved.lng, POINT_INPUT.lng);
        assert.equal(resolved.zoom, POINT_INPUT.zoom);
        assert.equal(resolved.address_line, POINT_INPUT.address_line);
        assert.equal(resolved.plus_code, POINT_INPUT.plus_code);
    });

    it("increments access tracking but never fails the resolve", async () => {
        const repo = new FakeShareRepository();
        repo.recordAccessShouldThrow = true;
        const service = makeService(repo);

        const { code } = await service.create({ ...POINT_INPUT });
        const resolved = await service.resolve(code);

        assert.equal(resolved.target_type, "point");
        assert.equal(repo.recordAccessCalls, 1);
    });

    it("throws a 404 ShareError for an unknown code", async () => {
        const repo = new FakeShareRepository();
        const service = makeService(repo);

        await assert.rejects(service.resolve("missing"), (error: unknown) => {
            assert.ok(error instanceof ShareError);
            assert.equal(error.statusCode, 404);
            return true;
        });
    });
});

describe("ShareService.create (place)", () => {
    const PLACE_ID = "1f3d2c4e-5a6b-4c8d-9e0f-1a2b3c4d5e6f";

    it("creates a place share when the place exists", async () => {
        const repo = new FakeShareRepository();
        repo.knownPlaceIds.add(PLACE_ID);
        const service = makeService(repo);

        const result = await service.create({ target_type: "place", place_public_id: PLACE_ID });

        assert.ok(SHARE_CODE_REGEX.test(result.code));
        assert.equal(result.url, `${BASE_URL}/s/${result.code}`);

        const resolved = await service.resolve(result.code);
        assert.equal(resolved.target_type, "place");
        if (resolved.target_type !== "place") return;
        assert.equal(resolved.place_public_id, PLACE_ID);
    });

    it("reuses the same code for the same place (dedup)", async () => {
        const repo = new FakeShareRepository();
        repo.knownPlaceIds.add(PLACE_ID);
        const service = makeService(repo);

        const first = await service.create({ target_type: "place", place_public_id: PLACE_ID });
        const second = await service.create({ target_type: "place", place_public_id: PLACE_ID });

        assert.equal(second.code, first.code);
        assert.equal(repo.rows.length, 1);
    });

    it("throws a 404 ShareError when the place does not exist", async () => {
        const repo = new FakeShareRepository();
        const service = makeService(repo);

        await assert.rejects(
            service.create({ target_type: "place", place_public_id: PLACE_ID }),
            (error: unknown) => {
                assert.ok(error instanceof ShareError);
                assert.equal(error.statusCode, 404);
                return true;
            },
        );
    });
});

describe("generateShareCode", () => {
    it("produces codes of the requested length using only the alphabet", () => {
        for (let i = 0; i < 50; i += 1) {
            const code = generateShareCode(7);
            assert.equal(code.length, 7);
            assert.ok(/^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]+$/.test(code));
        }
    });
});

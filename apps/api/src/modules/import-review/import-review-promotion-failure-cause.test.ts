import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Prisma } from "@prisma/client";

import { extractPromotionFailureCause } from "./import-review-promotion-failure-cause.js";

describe("extractPromotionFailureCause", () => {
    it("extracts prisma code and sqlstate from PrismaClientKnownRequestError", () => {
        const err = new Prisma.PrismaClientKnownRequestError("Raw query failed", {
            code: "P2010",
            clientVersion: "6.0.0",
            meta: { code: "42703", message: 'column "name_local" of relation "core_places" does not exist' },
        });
        const cause = extractPromotionFailureCause(err);
        assert.equal(cause.prisma_code, "P2010");
        assert.equal(cause.sqlstate, "42703");
        assert.match(cause.message, /name_local/);
        assert.equal(cause.raw_message, "Raw query failed");
    });

    it("extracts constraint name when present in message", () => {
        const cause = extractPromotionFailureCause(
            new Error('duplicate key violates unique constraint "core_places_external_id_key"')
        );
        assert.equal(cause.constraint, "core_places_external_id_key");
    });
});

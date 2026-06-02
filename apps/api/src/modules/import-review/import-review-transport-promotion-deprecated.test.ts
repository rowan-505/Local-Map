import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import type { FastifyReply } from "fastify";

const moduleDir = dirname(fileURLToPath(import.meta.url));

function readPromotionModule(name: string): string {
    return readFileSync(join(moduleDir, name), "utf8");
}

import {
    DEFAULT_PUBLISH_ENTITY_FAMILIES,
    PROMOTABLE_PUBLISH_FAMILIES,
    VALIDATABLE_PUBLISH_FAMILIES,
    resolvePublishEntityFamilies,
} from "./import-review-promotion-config.js";
import {
    ImportReviewTransportPromotionDeprecatedError,
    TRANSPORT_PROMOTION_DEPRECATED_MESSAGE,
} from "./import-review-promotion.errors.js";
import { buildApiErrorResponse } from "../../lib/api-error-response.js";
import { sendImportReviewError } from "./import-review-error-handler.js";
import {
    DEPRECATED_CORE_BUS_PUBLISH_FAMILIES,
    assertDeprecatedCoreBusPublishFamiliesNotRequested,
    findDeprecatedCoreBusPublishFamilies,
    isDeprecatedCoreBusPublishFamily,
} from "./import-review-transport-promotion-deprecated.js";

describe("deprecated core.core_bus_* publish families", () => {
    it("lists all four legacy bus publish families", () => {
        assert.deepEqual(DEPRECATED_CORE_BUS_PUBLISH_FAMILIES, [
            "bus_routes",
            "bus_route_variants",
            "bus_route_stops",
            "bus_stops",
        ]);
    });

    it("excludes bus families from default, validatable, and promotable publish lists", () => {
        for (const family of DEPRECATED_CORE_BUS_PUBLISH_FAMILIES) {
            assert.equal(
                (DEFAULT_PUBLISH_ENTITY_FAMILIES as readonly string[]).includes(family),
                false,
                `${family} must not be in DEFAULT_PUBLISH_ENTITY_FAMILIES`
            );
            assert.equal(
                (VALIDATABLE_PUBLISH_FAMILIES as readonly string[]).includes(family),
                false,
                `${family} must not be in VALIDATABLE_PUBLISH_FAMILIES`
            );
            assert.equal(
                (PROMOTABLE_PUBLISH_FAMILIES as readonly string[]).includes(family),
                false,
                `${family} must not be in PROMOTABLE_PUBLISH_FAMILIES`
            );
        }
    });

    it("detects deprecated bus families", () => {
        assert.equal(isDeprecatedCoreBusPublishFamily("bus_stops"), true);
        assert.equal(isDeprecatedCoreBusPublishFamily("buildings"), false);
        assert.deepEqual(findDeprecatedCoreBusPublishFamilies(["buildings", "bus_routes"]), [
            "bus_routes",
        ]);
    });

    it("blocks resolvePublishEntityFamilies when bus families are requested", () => {
        for (const family of DEPRECATED_CORE_BUS_PUBLISH_FAMILIES) {
            assert.throws(
                () => resolvePublishEntityFamilies([family], false),
                (err: unknown) => {
                    assert.ok(err instanceof ImportReviewTransportPromotionDeprecatedError);
                    assert.equal(err.message, TRANSPORT_PROMOTION_DEPRECATED_MESSAGE);
                    assert.deepEqual(err.entityFamilies, [family]);
                    return true;
                }
            );
        }
    });

    it("throws TRANSPORT_PROMOTION_DEPRECATED error with required message", () => {
        assert.throws(
            () => assertDeprecatedCoreBusPublishFamiliesNotRequested(["bus_route_stops"]),
            (err: unknown) => {
                assert.ok(err instanceof ImportReviewTransportPromotionDeprecatedError);
                assert.equal(err.name, "ImportReviewTransportPromotionDeprecatedError");
                assert.equal(err.statusCode, 409);
                assert.equal(err.message, TRANSPORT_PROMOTION_DEPRECATED_MESSAGE);
                assert.deepEqual(err.entityFamilies, ["bus_route_stops"]);
                return true;
            }
        );
    });

    it("still allows non-bus publish families", () => {
        const families = resolvePublishEntityFamilies(["buildings", "places"], false);
        assert.deepEqual(
            families.map((f) => f.entityFamily),
            ["buildings", "places"]
        );
    });

    it("wires deprecated bus guards into active import-review promotion entry points", () => {
        assert.match(
            readPromotionModule("import-review-promotion-config.ts"),
            /assertImportReviewPromotionFamilyAllowed/
        );
        for (const file of ["import-review-promotion-promote.ts", "import-review-promotion-validation.ts"] as const) {
            assert.match(readPromotionModule(file), /assertPublishBatchHasNoDeprecatedCoreBusItems/);
        }
        assert.match(
            readPromotionModule("import-review-promotion-promote.repo.ts"),
            /DEPRECATED_CORE_BUS_PUBLISH_MESSAGE/
        );
    });

    it("maps deprecated transport promotion error to TRANSPORT_PROMOTION_DEPRECATED API response", () => {
        let status = 0;
        let body: unknown;
        const reply = {
            code(code: number) {
                status = code;
                return {
                    send(payload: unknown) {
                        body = payload;
                    },
                };
            },
        } as FastifyReply;

        const sent = sendImportReviewError(
            reply,
            new ImportReviewTransportPromotionDeprecatedError(["bus_stops"])
        );

        assert.equal(sent, true);
        assert.equal(status, 409);
        assert.deepEqual(
            body,
            buildApiErrorResponse("TRANSPORT_PROMOTION_DEPRECATED", TRANSPORT_PROMOTION_DEPRECATED_MESSAGE, {
                entity_families: ["bus_stops"],
            })
        );
    });
});

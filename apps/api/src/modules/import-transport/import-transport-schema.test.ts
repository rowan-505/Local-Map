import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    importTransportPromotionReadyQuerySchema,
    importTransportScopeQuerySchema,
    parseImportTransportScopeQuery,
    postImportTransportPromotionBatchBodySchema,
} from "./import-transport.schema.js";

describe("import-transport schema import_batch_id coercion", () => {
    it('query import_batch_id="2" passes', () => {
        const parsed = importTransportPromotionReadyQuerySchema.safeParse({ import_batch_id: "2" });
        assert.equal(parsed.success, true);
        if (parsed.success) {
            assert.equal(parsed.data.import_batch_id, 2);
        }
    });

    it("query import_batch_id=2 (number) passes", () => {
        const parsed = importTransportPromotionReadyQuerySchema.safeParse({ import_batch_id: 2 });
        assert.equal(parsed.success, true);
        if (parsed.success) {
            assert.equal(parsed.data.import_batch_id, 2);
        }
    });

    it("body import_batch_id=2 passes", () => {
        const parsed = postImportTransportPromotionBatchBodySchema.safeParse({
            import_batch_id: 2,
            mode: "all_entities",
        });
        assert.equal(parsed.success, true);
        if (parsed.success) {
            assert.equal(parsed.data.import_batch_id, 2);
        }
    });

    it('invalid import_batch_id="abc" fails clearly', () => {
        const parsed = importTransportPromotionReadyQuerySchema.safeParse({ import_batch_id: "abc" });
        assert.equal(parsed.success, false);
        if (!parsed.success) {
            const fieldErrors = parsed.error.flatten().fieldErrors;
            assert.ok(fieldErrors.import_batch_id?.length);
        }
    });

    it("scope query coerces import_batch_id for summary-style endpoints", () => {
        const parsed = importTransportScopeQuerySchema.safeParse({ import_batch_id: "2" });
        assert.equal(parsed.success, true);
        if (parsed.success) {
            const scope = parseImportTransportScopeQuery(parsed.data);
            assert.equal(scope.import_batch_id, 2n);
            assert.equal(scope.source_snapshot_version, undefined);
        }
    });
});

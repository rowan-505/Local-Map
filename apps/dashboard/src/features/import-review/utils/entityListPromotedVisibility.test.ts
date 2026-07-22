import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { IMPORT_REVIEW_STANDARD_FILTER_FIELDS } from "../config/constants";
import {
    getImportReviewEntityConfigBySlug,
    listImportReviewNavEntityConfigs,
} from "../config/importReviewEntityConfigs";
import { importReviewQueryKeys } from "../hooks/importReviewQueryKeys";
import { isCandidateRetryNeeded } from "./importReviewPromotionListState";

const ENTITY_SLUGS = [
    "buildings",
    "places",
    "roads",
    "landuse",
    "water-lines",
    "water-polygons",
    "admin-areas",
    "routing-barriers",
    "addresses",
] as const;

describe("import-review entity list promotion visibility", () => {
    it("conflict-only filters expose comparison, decision, and apply status", () => {
        for (const slug of ENTITY_SLUGS) {
            const config = getImportReviewEntityConfigBySlug(slug);
            assert.ok(config, `missing config for ${slug}`);
            assert.ok(config!.filterFields.includes("match_status"), `${slug} comparison filter`);
            assert.ok(config!.filterFields.includes("review_decision"), `${slug} decision filter`);
            assert.ok(config!.filterFields.includes("promotion_status"), `${slug} apply filter`);
            assert.equal(config!.filterFields.includes("auto_action"), false);
            assert.equal(config!.filterFields.includes("review_status"), false);
        }
        assert.ok(IMPORT_REVIEW_STANDARD_FILTER_FIELDS.includes("match_status"));
        assert.ok(IMPORT_REVIEW_STANDARD_FILTER_FIELDS.includes("review_decision"));
        assert.ok(IMPORT_REVIEW_STANDARD_FILTER_FIELDS.includes("promotion_status"));
        assert.equal(IMPORT_REVIEW_STANDARD_FILTER_FIELDS.includes("include_promoted"), false);
    });

    it("nav entity configs include all nine promotion families", () => {
        const slugs = new Set(listImportReviewNavEntityConfigs().map((c) => c.slug));
        for (const slug of ENTITY_SLUGS) {
            assert.ok(slugs.has(slug), `nav missing ${slug}`);
        }
    });

    it("default list query key uses promotionState all_active", () => {
        const key = importReviewQueryKeys.candidatesList({
            apiFamily: "places",
            apiScopeQuery: { review_batch_id: "18" },
            limit: 50,
            offset: 0,
            sort: "updated_at_desc",
            filters: {
                match_status: "",
                auto_action: "",
                review_status: "",
                review_decision: "",
                promotion_status: "",
                class_code: "",
            },
            qApplied: "",
            promotionState: "all_active",
        });
        assert.equal(key[key.length - 1], "all_active");
    });

    it("retry_needed query key differs from default", () => {
        const base = {
            apiFamily: "places",
            apiScopeQuery: { review_batch_id: "18" },
            limit: 50,
            offset: 0,
            sort: "updated_at_desc",
            filters: {
                match_status: "",
                auto_action: "",
                review_status: "",
                review_decision: "",
                promotion_status: "",
                class_code: "",
            },
            qApplied: "",
        };
        const active = importReviewQueryKeys.candidatesList({ ...base, promotionState: "all_active" });
        const retry = importReviewQueryKeys.candidatesList({ ...base, promotionState: "retry_needed" });
        assert.notDeepEqual(active, retry);
        assert.equal(retry[retry.length - 1], "retry_needed");
    });

    it("promotion failed rows are identifiable for badge rendering", () => {
        assert.equal(
            isCandidateRetryNeeded({
                id: "1",
                promotion_status: "not_ready",
                promotion_retry_needed: true,
            } as never),
            true
        );
        assert.equal(
            isCandidateRetryNeeded({ id: "2", promotion_status: "promoted" } as never),
            false
        );
    });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    buildGeometryAnchorFields,
    computeCanUseAsGeometryAnchor,
} from "./geometry-anchor.js";
import type { ExistingStopCatalog, StopMatchResult } from "./supabase-stop-match.js";

function emptyCatalog(stops: ExistingStopCatalog["stops"] = []): ExistingStopCatalog {
    return {
        loaded_at: new Date().toISOString(),
        database_url_host: null,
        stops,
        stops_by_boarding_side_key: new Map(),
        stops_by_stop_place_key: new Map(),
        source_link_by_external_id: new Map(),
        source_link_by_stop_id: new Map(),
    };
}

function baseMatch(overrides: Partial<StopMatchResult> = {}): StopMatchResult {
    return {
        decision: "create_new_stop",
        match_method: null,
        match_confidence_reason: null,
        matched_stop_id: null,
        matched_public_id: null,
        matched_review_status: null,
        merge_actions: [],
        warnings: [],
        blocking_reasons: [],
        possible_duplicate_stop_ids: [],
        ...overrides,
    };
}

describe("computeCanUseAsGeometryAnchor", () => {
    it("allows reuse and merge when geometry exists", () => {
        assert.equal(computeCanUseAsGeometryAnchor("reuse_existing_stop", 12, true), true);
        assert.equal(
            computeCanUseAsGeometryAnchor("merge_additional_data_to_existing", 12, true),
            true,
        );
    });

    it("blocks manual review and conflict decisions", () => {
        assert.equal(computeCanUseAsGeometryAnchor("needs_manual_review", 12, true), false);
        assert.equal(computeCanUseAsGeometryAnchor("blocked_conflict", 12, true), false);
    });

    it("requires stop id and geometry", () => {
        assert.equal(computeCanUseAsGeometryAnchor("reuse_existing_stop", null, true), false);
        assert.equal(computeCanUseAsGeometryAnchor("reuse_existing_stop", 12, false), false);
    });
});

describe("buildGeometryAnchorFields", () => {
    it("marks merge matches with geometry as anchors", () => {
        const catalog = emptyCatalog([
            {
                id: 42,
                public_id: "stop-42",
                stop_code: null,
                name: "Test Stop",
                name_mm: "စမ်းရပ်",
                name_en: "Test Stop",
                review_status: "imported_unreviewed",
                normalized_data: null,
                source_refs: null,
                normalized_fields: {
                    normalized_name_my: "စမ်းရပ်",
                    normalized_name_en: "test stop",
                    normalized_area_my: null,
                    normalized_area_en: null,
                },
                stop_place_key: "စမ်းရပ်|test stop||",
                boarding_side_key: null,
                side_group: null,
                lng: 96.15,
                lat: 16.8,
                has_geom: true,
            },
        ]);

        const fields = buildGeometryAnchorFields(
            baseMatch({
                decision: "merge_additional_data_to_existing",
                match_method: "exact_name_en_with_compatible_area",
                matched_stop_id: 42,
                matched_public_id: "stop-42",
                matched_review_status: "imported_unreviewed",
            }),
            catalog,
        );

        assert.equal(fields.existing_stop_id, 42);
        assert.equal(fields.existing_stop_public_id, "stop-42");
        assert.equal(fields.existing_lng, 96.15);
        assert.equal(fields.existing_lat, 16.8);
        assert.equal(fields.existing_geom_geojson?.type, "Point");
        assert.equal(fields.existing_match_reason, "exact_name_en_with_compatible_area");
        assert.equal(fields.can_use_as_geometry_anchor, true);
    });

    it("does not mark merge matches without geometry as anchors", () => {
        const catalog = emptyCatalog([
            {
                id: 43,
                public_id: "stop-43",
                stop_code: null,
                name: "No Geom",
                name_mm: "ဂျီဩမ်",
                name_en: "No Geom",
                review_status: "imported_unreviewed",
                normalized_data: null,
                source_refs: null,
                normalized_fields: {
                    normalized_name_my: "ဂျီဩမ်",
                    normalized_name_en: "no geom",
                    normalized_area_my: null,
                    normalized_area_en: null,
                },
                stop_place_key: "ဂျီဩမ်|no geom||",
                boarding_side_key: null,
                side_group: null,
                lng: null,
                lat: null,
                has_geom: false,
            },
        ]);

        const fields = buildGeometryAnchorFields(
            baseMatch({
                decision: "merge_additional_data_to_existing",
                matched_stop_id: 43,
                matched_public_id: "stop-43",
            }),
            catalog,
        );

        assert.equal(fields.existing_geom_geojson, null);
        assert.equal(fields.can_use_as_geometry_anchor, false);
    });
});

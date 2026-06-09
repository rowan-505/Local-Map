import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { StreetRow, UpdateStreetInput } from "./streets.repo.js";
import {
    deriveCanonicalNameAfterNameEdits,
    streetOfficialNameShouldSync,
    streetRoadClassIdChanged,
    streetUpdateNeedsDetailReload,
    streetUpdateTouchesRoutingGraph,
} from "./streets-update-plan.js";

const baseRow = {
    public_id: "b9a8902c-d202-46b6-8e89-0a3bab75a648",
    canonical_name: "Old Road",
    admin_area_id: "7",
    admin_area_name: "Ward",
    source_type_id: "1",
    road_class_id: "3",
    road_class: "residential",
    road_class_name: "Residential",
    surface: "paved",
    is_oneway: false,
    bridge: false,
    tunnel: false,
    manual_override: false,
    edit_status: "published",
    routing_status: "ready",
    deleted_at: null,
    last_edited_at: new Date(),
    is_active: true,
    verification_status: "unverified",
    is_verified: false,
    created_at: new Date(),
    updated_at: new Date(),
    geometry: { type: "LineString", coordinates: [[96.1, 16.8], [96.2, 16.9]] },
    names: [],
    myanmar_name: "ဟောင်း",
    english_name: "Old Road",
} satisfies StreetRow;

describe("streetOfficialNameShouldSync", () => {
    it("skips when incoming name is absent", () => {
        assert.equal(streetOfficialNameShouldSync("Old Road", undefined), false);
    });

    it("skips when incoming name matches existing", () => {
        assert.equal(streetOfficialNameShouldSync("Old Road", "Old Road"), false);
    });

    it("syncs when incoming name differs", () => {
        assert.equal(streetOfficialNameShouldSync("Old Road", "New Road"), true);
    });
});

describe("streetUpdateNeedsDetailReload", () => {
    it("does not reload for surface-only metadata patch", () => {
        const input: UpdateStreetInput = { surface: "unpaved" };
        assert.equal(
            streetUpdateNeedsDetailReload({
                input,
                existing: baseRow,
                myanmarChanged: false,
                englishChanged: false,
                roadClassIdChanged: false,
            }),
            false,
        );
    });

    it("reloads when geometry is included", () => {
        const input: UpdateStreetInput = {
            geometry: { type: "LineString", coordinates: [[96.1, 16.8], [96.3, 17.0]] },
        };
        assert.equal(
            streetUpdateNeedsDetailReload({
                input,
                existing: baseRow,
                myanmarChanged: false,
                englishChanged: false,
                roadClassIdChanged: false,
            }),
            true,
        );
    });
});

describe("streetUpdateTouchesRoutingGraph", () => {
    it("does not mark routing rebuild for surface-only patch", () => {
        assert.equal(
            streetUpdateTouchesRoutingGraph({ surface: "dirt" }, baseRow, false),
            false,
        );
    });

    it("marks routing rebuild when geometry changes", () => {
        assert.equal(
            streetUpdateTouchesRoutingGraph(
                { geometry: { type: "LineString", coordinates: [[1, 2], [3, 4]] } },
                baseRow,
                false,
            ),
            true,
        );
    });
});

describe("deriveCanonicalNameAfterNameEdits", () => {
    it("keeps existing myanmar name when only english changes", () => {
        assert.equal(
            deriveCanonicalNameAfterNameEdits({
                existing: baseRow,
                myanmarChanged: false,
                englishChanged: true,
                englishName: "Renamed Road",
            }),
            "Renamed Road",
        );
    });
});

describe("streetRoadClassIdChanged", () => {
    it("is false when road class id is unchanged", () => {
        assert.equal(streetRoadClassIdChanged("3", 3n), false);
    });
});

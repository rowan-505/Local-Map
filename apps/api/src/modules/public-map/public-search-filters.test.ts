import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    decodePublicSearchCursor,
    encodePublicSearchCursor,
    normalizePublicSearchCursorContext,
    PUBLIC_SEARCH_CURSOR_VERSION,
} from "./public-search-cursor.js";
import {
    buildPublicSearchFilterSql,
    resolvePublicSearchFilters,
} from "./public-search-filters.js";
import { buildPublicSearchPage } from "./public-map.service.js";
import type { UnifiedSearchRow } from "./public-map.repo.js";

describe("resolvePublicSearchFilters", () => {
    it("all category preserves the full default entity surface", () => {
        const filters = resolvePublicSearchFilters({ category: "all" });
        assert.ok(filters.entityTypes.includes("place"));
        assert.ok(filters.entityTypes.includes("settlement"));
        assert.ok(filters.entityTypes.includes("transport_stop"));
        assert.ok(filters.entityTypes.includes("building"));
        assert.equal(filters.transportModeFilter, null);
        assert.equal(filters.transportStopTypes, null);
    });

    it("places category includes POIs and canonical settlements", () => {
        const filters = resolvePublicSearchFilters({ category: "places" });
        assert.deepEqual([...filters.entityTypes], ["place", "settlement"]);
        assert.ok(filters.expandedEntityTypes.includes("place"));
        assert.ok(filters.expandedEntityTypes.includes("settlement"));
    });

    it("areas category limits to admin_area rows", () => {
        const filters = resolvePublicSearchFilters({ category: "areas" });
        assert.deepEqual([...filters.entityTypes], ["admin_area"]);
    });

    it("roads category limits to grouped streets", () => {
        const filters = resolvePublicSearchFilters({ category: "roads" });
        assert.deepEqual([...filters.entityTypes], ["street_group", "street"]);
    });

    it("transport category includes all transport entity families", () => {
        const filters = resolvePublicSearchFilters({ category: "transport" });
        assert.deepEqual([...filters.entityTypes], [
            "transport_stop",
            "transport_terminal",
            "transport_route",
            "transport_route_variant",
        ]);
        assert.ok(filters.expandedEntityTypes.includes("bus_stop"));
        assert.ok(filters.expandedEntityTypes.includes("bus_route_variant"));
    });

    it("addresses category limits to address rows", () => {
        const filters = resolvePublicSearchFilters({ category: "addresses" });
        assert.deepEqual([...filters.entityTypes], ["address"]);
    });

    it("transport stops subtype narrows to stop rows with stop-type SQL filter", () => {
        const filters = resolvePublicSearchFilters({
            category: "transport",
            transportType: "stops",
        });
        assert.deepEqual([...filters.entityTypes], ["transport_stop", "bus_stop"]);
        assert.deepEqual([...filters.transportStopTypes!], ["stop", "bus_stop", "ferry_landing"]);
    });

    it("transport routes subtype limits to route families", () => {
        const filters = resolvePublicSearchFilters({
            category: "transport",
            transportType: "routes",
        });
        assert.deepEqual([...filters.entityTypes], [
            "transport_route",
            "transport_route_variant",
        ]);
        assert.equal(filters.transportStopTypes, null);
    });

    it("bus mode applies only for transport category", () => {
        const transportBus = resolvePublicSearchFilters({
            category: "transport",
            transportMode: "bus",
        });
        assert.equal(transportBus.transportModeFilter, "bus");

        const placesBus = resolvePublicSearchFilters({
            category: "places",
            transportMode: "bus",
        });
        assert.equal(placesBus.transportModeFilter, null);
    });

    it("train mode keeps transport category and train SQL filter", () => {
        const filters = resolvePublicSearchFilters({
            category: "transport",
            transportMode: "train",
        });
        assert.equal(filters.transportModeFilter, "train");
        assert.equal(filters.transportMode, "train");
    });

    it("intersects legacy types with category filters", () => {
        const filters = resolvePublicSearchFilters({
            category: "transport",
            legacyTypes: ["transport_stop"],
        });
        assert.deepEqual([...filters.entityTypes], ["transport_stop"]);
    });
});

describe("buildPublicSearchFilterSql", () => {
    it("emits entity_type, mode, and stop-type predicates for transport stop filters", () => {
        const filters = resolvePublicSearchFilters({
            category: "transport",
            transportType: "stops",
            transportMode: "bus",
        });
        const sql = buildPublicSearchFilterSql(filters);
        const combined = JSON.stringify(sql);
        assert.match(combined, /entity_type IN/);
        assert.match(combined, /category_code/);
        assert.match(combined, /stop_type/);
        assert.match(combined, /bus_stop/);
    });
});

describe("filter + pagination cursor binding", () => {
    const row = (id: string): UnifiedSearchRow => ({
        entity_type: "transport_stop",
        entity_id: id,
        public_id: null,
        display_name: `Stop ${id}`,
        subtitle: null,
        primary_name_my: null,
        primary_name_en: null,
        primary_name_und: null,
        matched_name: null,
        geometry_type: "POINT",
        lng: 96,
        lat: 17,
        min_lng: null,
        min_lat: null,
        max_lng: null,
        max_lat: null,
        has_geometry: true,
        category_code: "bus",
        category_name_my: null,
        category_name_en: "stop",
        admin_area_name_my: null,
        admin_area_name_en: null,
        score: 50,
        importance_score: 0,
        is_verified: false,
        confidence_score: 0,
        boundary_confidence_score: 0,
        address_parts: { mode: "bus", stop_type: "stop" },
    });

    it("encodes category and transport filters in cursor context", () => {
        const ctx = normalizePublicSearchCursorContext({
            q: "sule",
            mode: "full",
            types: ["transport_stop"],
            category: "transport",
            transportType: "stops",
            transportMode: "bus",
        });
        const page = buildPublicSearchPage([row("1"), row("2")], 1, ctx);
        assert.ok(page.nextCursor);
        const decoded = decodePublicSearchCursor(page.nextCursor!);
        assert.equal(decoded.v, PUBLIC_SEARCH_CURSOR_VERSION);
        assert.equal(decoded.ctx.category, "transport");
        assert.equal(decoded.ctx.transportType, "stops");
        assert.equal(decoded.ctx.transportMode, "bus");
    });

    it("round-trips v3 cursor payloads with filter chips and language", () => {
        const payload = {
            v: PUBLIC_SEARCH_CURSOR_VERSION,
            ctx: normalizePublicSearchCursorContext({
                q: "yangon",
                mode: "full",
                types: ["transport_route"],
                category: "transport",
                transportType: "routes",
                transportMode: "train",
                lang: "en",
            }),
            after: {
                score: 10,
                importanceScore: 0,
                displayName: "Yangon-Mandalay",
                entityType: "transport_route",
                entityId: "99",
            },
        };
        const decoded = decodePublicSearchCursor(encodePublicSearchCursor(payload));
        assert.equal(decoded.ctx.transportMode, "train");
        assert.equal(decoded.ctx.transportType, "routes");
        assert.equal(decoded.ctx.lang, "en");
    });
});

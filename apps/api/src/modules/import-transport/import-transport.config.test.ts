import assert from "node:assert/strict";
import test from "node:test";

import {
    IMPORT_TRANSPORT_FAMILIES,
    isImportTransportFamily,
} from "./import-transport.config.js";
import { importTransportFamilyParamSchema } from "./import-transport.schema.js";

test("import transport families are stable", () => {
    assert.deepEqual(IMPORT_TRANSPORT_FAMILIES, ["routes", "stops", "variants", "route_stops"]);
});

test("isImportTransportFamily accepts supported slugs", () => {
    assert.equal(isImportTransportFamily("routes"), true);
    assert.equal(isImportTransportFamily("route_stops"), true);
    assert.equal(isImportTransportFamily("bus_routes"), false);
});

test("importTransportFamilyParamSchema rejects unknown family", () => {
    const parsed = importTransportFamilyParamSchema.safeParse("operators");
    assert.equal(parsed.success, false);
});

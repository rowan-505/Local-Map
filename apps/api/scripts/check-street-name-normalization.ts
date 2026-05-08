/**
 * Lightweight checks for street canonical derivation.
 * Run from repo root: `npm --prefix apps/api run check:streets-names`.
 *
 * Manual regression (migration + CRUD):
 * - Apply migrations through `infrastructure/database/migrations/017_street_names_normalization.sql`.
 * - POST `/streets` with GeoJSON geometry and `myanmarName` and/or `englishName` only (omit `canonical_name`).
 * - In Postgres, confirm rows in `core.core_street_names` for that street:
 *   Myanmar: language_code `mm`, script_code `Mymr`, name_type `official`, is_primary `true`.
 *   English: language_code `en`, script_code `Latn`, name_type `official`, is_primary `true`.
 * - Confirm placeholder OSM strings such as “Unnamed residential …” remain in `core.core_street_names` with
 *   name_type `generated`, is_primary `false`.
 * - Public map: street labels/search should prefer official names and skip `generated` street names via API/tiles.
 */

import assert from "node:assert/strict";

import { deriveStreetCanonicalName } from "../src/modules/streets/streets.repo.js";

assert.equal(
    deriveStreetCanonicalName({ englishName: " Strand Road", myanmarName: "strand" }),
    "Strand Road",
);
assert.equal(deriveStreetCanonicalName({ englishName: "", myanmarName: " မြို့လမ်း " }), "မြို့လမ်း");

assert.equal(deriveStreetCanonicalName({ englishName: undefined, myanmarName: "ဘ" }), "ဘ");
assert.equal(deriveStreetCanonicalName({ englishName: "Only EN" }), "Only EN");
assert.equal(deriveStreetCanonicalName({}), "Unnamed Street");

console.log("check-street-name-normalization: OK");

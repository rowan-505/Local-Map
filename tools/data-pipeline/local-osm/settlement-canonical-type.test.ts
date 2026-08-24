import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canonicalSettlementDuplicateThresholdM,
  canonicalSettlementType,
  isCanonicalSettlementType,
  settlementCanonicalNameFromTags,
} from "./settlement-canonical-type.js";

describe("canonicalSettlementType", () => {
  it("maps OSM place values to city/town/village/local_area only", () => {
    assert.equal(canonicalSettlementType("city"), "city");
    assert.equal(canonicalSettlementType("town"), "town");
    assert.equal(canonicalSettlementType("village"), "village");
    assert.equal(canonicalSettlementType("hamlet"), "village");
    assert.equal(canonicalSettlementType("quarter"), "local_area");
    assert.equal(canonicalSettlementType("suburb"), "local_area");
    assert.equal(canonicalSettlementType("neighbourhood"), "local_area");
    assert.equal(canonicalSettlementType("neighborhood"), "local_area");
    assert.equal(canonicalSettlementType("locality"), "local_area");
  });

  it("does not invent types for unknown OSM place values", () => {
    assert.equal(canonicalSettlementType("isolated_dwelling"), null);
    assert.equal(canonicalSettlementType("farm"), null);
    assert.equal(canonicalSettlementType(""), null);
    assert.equal(canonicalSettlementType(null), null);
  });
});

describe("isCanonicalSettlementType", () => {
  it("accepts only the four CoreMap types", () => {
    assert.equal(isCanonicalSettlementType("city"), true);
    assert.equal(isCanonicalSettlementType("local_area"), true);
    assert.equal(isCanonicalSettlementType("hamlet"), false);
    assert.equal(isCanonicalSettlementType("quarter"), false);
  });
});

describe("canonicalSettlementDuplicateThresholdM", () => {
  it("uses canonical-type radii", () => {
    assert.equal(canonicalSettlementDuplicateThresholdM("city"), 500);
    assert.equal(canonicalSettlementDuplicateThresholdM("town"), 300);
    assert.equal(canonicalSettlementDuplicateThresholdM("village"), 100);
    assert.equal(canonicalSettlementDuplicateThresholdM("local_area"), 80);
    assert.equal(canonicalSettlementDuplicateThresholdM("hamlet"), null);
  });
});

describe("settlementCanonicalNameFromTags", () => {
  it("preserves original OSM names and does not invent missing ones", () => {
    assert.equal(
      settlementCanonicalNameFromTags({
        "name:my": "ရန်ကုန်",
        name: "Yangon",
      }),
      "ရန်ကုန်"
    );
    assert.equal(
      settlementCanonicalNameFromTags({ name: "Kyauktan" }),
      "Kyauktan"
    );
    assert.equal(settlementCanonicalNameFromTags({ place: "village" }), null);
    assert.equal(settlementCanonicalNameFromTags({}), null);
  });
});

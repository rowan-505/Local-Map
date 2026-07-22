import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifySourceByHash,
  geomInMyanmarBounds,
  mapDiffToSourceStatus,
  validateCandidate,
} from "./candidate-validation.js";

describe("mapDiffToSourceStatus", () => {
  it("maps legacy F1 types to source_*", () => {
    assert.equal(mapDiffToSourceStatus("new"), "source_new");
    assert.equal(mapDiffToSourceStatus("changed"), "source_changed");
    assert.equal(mapDiffToSourceStatus("unchanged"), "source_unchanged");
    assert.equal(mapDiffToSourceStatus("deleted_candidate"), "source_missing");
  });
});

describe("classifySourceByHash", () => {
  it("same snapshot vs itself → unchanged (zero false changes)", () => {
    assert.equal(
      classifySourceByHash({
        currentId: 1,
        previousId: 1,
        currentHash: "abc",
        previousHash: "abc",
      }),
      "unchanged",
    );
  });

  it("newer snapshot with one changed record", () => {
    assert.equal(
      classifySourceByHash({
        currentId: 1,
        previousId: 9,
        currentHash: "newhash",
        previousHash: "oldhash",
      }),
      "changed",
    );
  });

  it("removed OSM object → deleted_candidate / source_missing", () => {
    assert.equal(
      classifySourceByHash({
        currentId: null,
        previousId: 9,
        currentHash: null,
        previousHash: "oldhash",
      }),
      "deleted_candidate",
    );
    assert.equal(
      mapDiffToSourceStatus("deleted_candidate"),
      "source_missing",
    );
  });

  it("new identity → new", () => {
    assert.equal(
      classifySourceByHash({
        currentId: 3,
        previousId: null,
        currentHash: "x",
        previousHash: null,
      }),
      "new",
    );
  });
});

describe("validateCandidate scenarios", () => {
  const baseRoad = {
    family: "roads",
    externalId: "osm:way:1",
    hasGeometry: true,
    geometryValid: true,
    geometryType: "LINESTRING",
    inMyanmarBounds: true,
    classCode: "residential",
    classId: 1,
    canonicalName: "Main St",
    identityIsCanonicalLong: true,
    normalizedDataEmpty: false,
  };

  it("valid road", () => {
    const r = validateCandidate(baseRoad);
    assert.equal(r.status, "valid");
  });

  it("invalid geometry", () => {
    const r = validateCandidate({ ...baseRoad, geometryValid: false });
    assert.equal(r.status, "invalid");
    assert.ok(r.notes.includes("geometry_invalid"));
  });

  it("unsupported / missing category", () => {
    const r = validateCandidate({
      ...baseRoad,
      classCode: null,
      classId: null,
    });
    assert.equal(r.status, "invalid");
    assert.ok(r.notes.includes("category_or_class_mapping_missing"));
  });

  it("warning-only record (optional name missing)", () => {
    const r = validateCandidate({ ...baseRoad, canonicalName: null });
    assert.equal(r.status, "warning");
    assert.ok(r.notes.includes("optional_name_missing"));
  });

  it("bounds helper", () => {
    assert.equal(geomInMyanmarBounds(96.15, 16.8), true);
    assert.equal(geomInMyanmarBounds(0, 0), false);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isCoastlineTags,
  isCoremapLandAreaCode,
  isCoremapProtectedAreaCode,
  isLandAreaCandidateTags,
  isProtectedAreaCandidateTags,
  isWaterPolygonCandidateTags,
  normalizeLandAreaClass,
  normalizeProtectedAreaClass,
  normalizeWaterClass,
} from "./osm-category-normalize.js";

describe("normalizeLandAreaClass", () => {
  it("maps required landuse examples", () => {
    assert.equal(normalizeLandAreaClass({ landuse: "residential" }), "residential");
    assert.equal(normalizeLandAreaClass({ landuse: "commercial" }), "commercial");
    assert.equal(normalizeLandAreaClass({ landuse: "retail" }), "retail");
    assert.equal(normalizeLandAreaClass({ landuse: "industrial" }), "industrial");
    assert.equal(normalizeLandAreaClass({ landuse: "construction" }), "construction");
    assert.equal(normalizeLandAreaClass({ landuse: "farmland" }), "farmland");
    assert.equal(normalizeLandAreaClass({ landuse: "farm" }), "farmland");
    assert.equal(normalizeLandAreaClass({ landuse: "orchard" }), "orchard");
    assert.equal(normalizeLandAreaClass({ landuse: "farmyard" }), "farmyard");
    assert.equal(normalizeLandAreaClass({ landuse: "forest" }), "forest");
    assert.equal(normalizeLandAreaClass({ landuse: "grass" }), "grassland");
  });

  it("maps leisure and natural cover", () => {
    assert.equal(normalizeLandAreaClass({ leisure: "park" }), "park");
    assert.equal(
      normalizeLandAreaClass({ leisure: "recreation_ground" }),
      "recreation_ground"
    );
    assert.equal(normalizeLandAreaClass({ natural: "wood" }), "forest");
    assert.equal(normalizeLandAreaClass({ natural: "grassland" }), "grassland");
    assert.equal(normalizeLandAreaClass({ natural: "scrub" }), "scrub");
    assert.equal(normalizeLandAreaClass({ natural: "heath" }), "heath");
    assert.equal(normalizeLandAreaClass({ natural: "sand" }), "sand");
    assert.equal(normalizeLandAreaClass({ natural: "beach" }), "beach");
    assert.equal(normalizeLandAreaClass({ natural: "bare_rock" }), "bare_rock");
    assert.equal(normalizeLandAreaClass({ natural: "mud" }), "mud");
  });

  it("maps wetland subtypes and never guesses", () => {
    assert.equal(
      normalizeLandAreaClass({ natural: "wetland", wetland: "marsh" }),
      "marsh"
    );
    assert.equal(
      normalizeLandAreaClass({ natural: "wetland", wetland: "swamp" }),
      "swamp"
    );
    assert.equal(
      normalizeLandAreaClass({ natural: "wetland", wetland: "mangrove" }),
      "mangrove"
    );
    assert.equal(
      normalizeLandAreaClass({ natural: "wetland", wetland: "reedbed" }),
      "reedbed"
    );
    assert.equal(
      normalizeLandAreaClass({ natural: "wetland", wetland: "saltmarsh" }),
      "saltmarsh"
    );
    assert.equal(
      normalizeLandAreaClass({ natural: "wetland", wetland: "tidalflat" }),
      "tidalflat"
    );
    assert.equal(
      normalizeLandAreaClass({ natural: "wetland", wetland: "bog" }),
      "bog"
    );
    assert.equal(
      normalizeLandAreaClass({ natural: "wetland", wetland: "fen" }),
      "fen"
    );
    assert.equal(normalizeLandAreaClass({ natural: "wetland" }), "wetland");
    assert.equal(
      normalizeLandAreaClass({ natural: "wetland", wetland: "mystery" }),
      "wetland"
    );
  });

  it("skips unrecognized landuse values", () => {
    assert.equal(normalizeLandAreaClass({ landuse: "garages" }), null);
    assert.equal(normalizeLandAreaClass({ landuse: "allotments" }), null);
    assert.equal(normalizeLandAreaClass({ leisure: "playground" }), null);
  });

  it("prefers wetland over landuse when natural=wetland", () => {
    assert.equal(
      normalizeLandAreaClass({
        natural: "wetland",
        wetland: "marsh",
        landuse: "residential",
      }),
      "marsh"
    );
  });
});

describe("normalizeWaterClass + routing helpers", () => {
  it("routes coastline separately", () => {
    assert.equal(isCoastlineTags({ natural: "coastline" }), true);
    assert.equal(normalizeWaterClass({ natural: "coastline", waterway: "river" }, "line"), null);
  });

  it("maps water lines and polygons", () => {
    assert.equal(normalizeWaterClass({ waterway: "stream" }, "line"), "stream");
    assert.equal(normalizeWaterClass({ waterway: "river" }, "line"), "river");
    assert.equal(normalizeWaterClass({ natural: "water" }, "polygon"), "water");
    assert.equal(normalizeWaterClass({ water: "lake" }, "polygon"), "lake");
    assert.equal(
      normalizeWaterClass({ waterway: "riverbank" }, "polygon"),
      "river"
    );
  });

  it("skips property / unrecognized water values", () => {
    assert.equal(normalizeWaterClass({ waterway: "yes" }, "line"), null);
    assert.equal(normalizeWaterClass({ water: "seasonal" }, "polygon"), null);
    assert.equal(normalizeWaterClass({ waterway: "fairway" }, "line"), null);
  });

  it("detects water vs land candidate tags", () => {
    assert.equal(isWaterPolygonCandidateTags({ natural: "water" }), true);
    assert.equal(isWaterPolygonCandidateTags({ natural: "wetland" }), false);
    assert.equal(isLandAreaCandidateTags({ landuse: "residential" }), true);
    assert.equal(isLandAreaCandidateTags({ natural: "wetland" }), true);
    assert.equal(isLandAreaCandidateTags({ natural: "water" }), false);
  });
});

describe("isCoremapLandAreaCode", () => {
  it("accepts recognized CoreMap codes only", () => {
    assert.equal(isCoremapLandAreaCode("residential"), true);
    assert.equal(isCoremapLandAreaCode("marsh"), true);
    assert.equal(isCoremapLandAreaCode("garages"), false);
    assert.equal(isCoremapLandAreaCode(null), false);
  });
});

describe("normalizeProtectedAreaClass", () => {
  it("does not treat ordinary parks as protected", () => {
    assert.equal(isProtectedAreaCandidateTags({ leisure: "park" }), false);
    assert.equal(normalizeProtectedAreaClass({ leisure: "park" }), null);
    assert.equal(normalizeLandAreaClass({ leisure: "nature_reserve" }), null);
    assert.equal(isLandAreaCandidateTags({ leisure: "nature_reserve" }), false);
  });

  it("maps strong protected-area signals", () => {
    assert.equal(
      normalizeProtectedAreaClass({ boundary: "national_park" }),
      "national_park"
    );
    assert.equal(
      normalizeProtectedAreaClass({ leisure: "nature_reserve" }),
      "nature_reserve"
    );
    assert.equal(
      normalizeProtectedAreaClass({
        leisure: "nature_reserve",
        boundary: "protected_area",
        protection_title: "Wildlife Sanctuary",
      }),
      "wildlife_protected_area"
    );
    assert.equal(
      normalizeProtectedAreaClass({
        boundary: "protected_area",
        designation: "forest reserve",
      }),
      "forest_reserve"
    );
    assert.equal(
      normalizeProtectedAreaClass({
        boundary: "protected_area",
        protection_title: "Marine Protected Area",
      }),
      "marine_protected_area"
    );
    assert.equal(
      normalizeProtectedAreaClass({ boundary: "protected_area" }),
      "other"
    );
  });

  it("dedupes overlapping tags to one class", () => {
    assert.equal(
      normalizeProtectedAreaClass({
        boundary: "national_park",
        leisure: "nature_reserve",
      }),
      "national_park"
    );
    assert.equal(isCoremapProtectedAreaCode("nature_reserve"), true);
    assert.equal(isCoremapProtectedAreaCode("park"), false);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  osmClassifyIdentity,
  osmExternalId,
  osmFeatureTypeCanonical,
  osmIdentityKey,
  osmIdentityMatches,
} from "./source-identity.js";

describe("osmFeatureTypeCanonical", () => {
  it("accepts full words and short letters", () => {
    assert.equal(osmFeatureTypeCanonical("node"), "node");
    assert.equal(osmFeatureTypeCanonical("N"), "node");
    assert.equal(osmFeatureTypeCanonical("way"), "way");
    assert.equal(osmFeatureTypeCanonical("W"), "way");
    assert.equal(osmFeatureTypeCanonical("relation"), "relation");
    assert.equal(osmFeatureTypeCanonical("R"), "relation");
    assert.equal(osmFeatureTypeCanonical("rel"), "relation");
  });

  it("rejects unknown types", () => {
    assert.equal(osmFeatureTypeCanonical("area"), null);
    assert.equal(osmFeatureTypeCanonical(""), null);
    assert.equal(osmFeatureTypeCanonical(null), null);
  });
});

describe("osmExternalId canonical formatter", () => {
  it("formats node, way, and relation without colliding", () => {
    assert.equal(osmExternalId("node", 123), "osm:node:123");
    assert.equal(osmExternalId("way", 123), "osm:way:123");
    assert.equal(osmExternalId("relation", 123), "osm:relation:123");

    assert.notEqual(osmExternalId("node", 123), osmExternalId("way", 123));
    assert.notEqual(osmExternalId("way", 123), osmExternalId("relation", 123));
    assert.notEqual(osmExternalId("node", 123), osmExternalId("relation", 123));
  });

  it("normalizes short feature-type letters to canonical long form", () => {
    assert.equal(osmExternalId("N", "42"), "osm:node:42");
    assert.equal(osmExternalId("W", 42), "osm:way:42");
    assert.equal(osmExternalId("R", 42n), "osm:relation:42");
  });

  it("rejects invalid ids", () => {
    assert.equal(osmExternalId("way", ""), null);
    assert.equal(osmExternalId("way", "12a"), null);
    assert.equal(osmExternalId("way", null), null);
    assert.equal(osmExternalId("area", 1), null);
  });
});

describe("legacy compatibility matching", () => {
  it("maps legacy short production ids to the same identity key", () => {
    assert.equal(osmIdentityKey("osm:N:99"), "osm:node:99");
    assert.equal(osmIdentityKey("osm:W:99"), "osm:way:99");
    assert.equal(osmIdentityKey("osm:R:99"), "osm:relation:99");
  });

  it("matches canonical staging ids to legacy production ids", () => {
    assert.equal(osmIdentityMatches("osm:node:123", "osm:N:123"), true);
    assert.equal(osmIdentityMatches("osm:way:123", "osm:W:123"), true);
    assert.equal(osmIdentityMatches("osm:relation:123", "osm:R:123"), true);
  });

  it("does not match different feature types with the same numeric id", () => {
    assert.equal(osmIdentityMatches("osm:node:123", "osm:W:123"), false);
    assert.equal(osmIdentityMatches("osm:way:123", "osm:R:123"), false);
    assert.equal(osmIdentityMatches("osm:N:123", "osm:relation:123"), false);
  });

  it("accepts slash separators used in older fixtures", () => {
    assert.equal(osmIdentityKey("osm:node/7"), "osm:node:7");
    assert.equal(osmIdentityMatches("osm:way/7", "osm:W:7"), true);
  });
});

describe("osmClassifyIdentity", () => {
  it("classifies canonical, legacy, null, and other", () => {
    assert.equal(osmClassifyIdentity("osm:way:1"), "canonical_long");
    assert.equal(osmClassifyIdentity("osm:W:1"), "legacy_short");
    assert.equal(osmClassifyIdentity(null), "null_or_blank");
    assert.equal(osmClassifyIdentity(""), "null_or_blank");
    assert.equal(osmClassifyIdentity("manual:place:1"), "other");
  });
});

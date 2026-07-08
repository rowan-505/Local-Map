import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
    buildResolvedRouteNames,
    containsBrokenNumericRomanization,
    detectRouteNameIssues,
    normalizeEnglishEndpointPhrase,
    parseRouteEndpointsSafe,
    scoreRouteNameRepairConfidence,
} from "./route-name-endpoints.js";
import { normalizeYbsRouteDisplayNames } from "./route-display-names.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../../../..");
const MERGED_DIR = join(REPO_ROOT, "tmp/transport-imports/ybs-all/merged/routes");

function loadMergedRoute(routeCode: string): {
    route_code: string;
    route_title_my: string | null;
    route_title_en: string | null;
    route_name_en: string | null;
    variants: Array<Record<string, unknown>>;
} | null {
    const filePath = join(MERGED_DIR, `${routeCode}.json`);
    if (!existsSync(filePath)) {
        return null;
    }

    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as {
        route?: Record<string, unknown>;
        route_detail_identity?: Record<string, unknown>;
        variants?: Array<Record<string, unknown>>;
    };

    return {
        route_code: routeCode,
        route_title_my:
            (typeof parsed.route_detail_identity?.route_title_my === "string"
                ? parsed.route_detail_identity.route_title_my
                : null) ??
            (typeof parsed.route?.route_name_my === "string" ? parsed.route.route_name_my : null),
        route_title_en:
            (typeof parsed.route_detail_identity?.route_title_en === "string"
                ? parsed.route_detail_identity.route_title_en
                : null) ??
            (typeof parsed.route?.route_name_en === "string" ? parsed.route.route_name_en : null),
        route_name_en:
            typeof parsed.route?.route_name_en === "string" ? parsed.route.route_name_en : null,
        variants: parsed.variants ?? [],
    };
}

describe("parseRouteEndpointsSafe", () => {
    it("does not split romanized syllables on bare hyphens", () => {
        const parsed = parseRouteEndpointsSafe("Shit-sae-koe Kwae - Dagon Ayar A Way Pyay");
        assert.equal(parsed.origin, "Shit-sae-koe Kwae");
        assert.equal(parsed.destination, "Dagon Ayar A Way Pyay");
    });

    it("splits on spaced hyphen and arrow separators", () => {
        assert.deepEqual(parseRouteEndpointsSafe("Origin - Destination"), {
            origin: "Origin",
            destination: "Destination",
        });
        assert.deepEqual(parseRouteEndpointsSafe("Origin ↔ Destination"), {
            origin: "Origin",
            destination: "Destination",
        });
    });
});

describe("normalizeEnglishEndpointPhrase", () => {
    it("maps broken romanized numeric phrases to canonical English", () => {
        assert.equal(normalizeEnglishEndpointPhrase("Shit-sae-koe Kwae", "(၈၉) ကွေ့"), "89 Junction");
        assert.equal(normalizeEnglishEndpointPhrase("Sae-Thone Gate", "(၁၃) ဂိတ်"), "13 Gate");
        assert.equal(
            normalizeEnglishEndpointPhrase("Chauk-sae-ngar Yat Kwet", "သာကေတ(၆၅ ရပ်ကွက်)"),
            "Thaketa 65 Ward",
        );
        assert.equal(normalizeEnglishEndpointPhrase("Lan Thone Sae", "လမ်း(၃၀)"), "30th Street");
    });
});

describe("containsBrokenNumericRomanization", () => {
    it("detects multi-arrow and syllable-split endpoint names", () => {
        assert.equal(
            containsBrokenNumericRomanization("YBS 6 · Shit ↔ sae ↔ koe Kwae ↔ Dagon Ayar A Way Pyay"),
            true,
        );
        assert.equal(containsBrokenNumericRomanization("YBS 42 · Thardukan ↔ 13 Gate"), false);
    });
});

describe("confirmed merged route examples", () => {
    it("normalizes YBS-6 English endpoints from merged source", () => {
        const source = loadMergedRoute("YBS-6");
        assert.ok(source, "YBS-6 merged JSON should exist for this test");

        const resolved = buildResolvedRouteNames({
            route_code: source.route_code,
            route_title_my: source.route_title_my,
            route_title_en: source.route_title_en,
            route_name_en: source.route_name_en,
            variants: source.variants,
        });

        assert.match(resolved.primary_name_my ?? "", /^YBS 6 · /);
        assert.match(resolved.primary_name_my ?? "", /↔/);
        assert.equal(resolved.primary_name_en, "YBS 6 · 89 Junction ↔ Dagon Ayar Highway");
        assert.equal(resolved.origin_en, "89 Junction");
        assert.equal(resolved.destination_en, "Dagon Ayar Highway");
    });

    it("normalizes YBS-42 English endpoints from merged source", () => {
        const source = loadMergedRoute("YBS-42");
        assert.ok(source, "YBS-42 merged JSON should exist for this test");

        const resolved = buildResolvedRouteNames({
            route_code: source.route_code,
            route_title_my: source.route_title_my,
            route_title_en: source.route_title_en,
            route_name_en: source.route_name_en,
            variants: source.variants,
        });

        assert.equal(resolved.primary_name_en, "YBS 42 · Thardukan ↔ 13 Gate");
        assert.equal(resolved.origin_en, "Thardukan");
        assert.equal(resolved.destination_en, "13 Gate");
    });

    it("normalizes YBS-60-B English endpoints from merged source", () => {
        const source = loadMergedRoute("YBS-60-B");
        assert.ok(source, "YBS-60-B merged JSON should exist for this test");

        const resolved = buildResolvedRouteNames({
            route_code: source.route_code,
            route_title_my: source.route_title_my,
            route_title_en: source.route_title_en,
            route_name_en: source.route_name_en,
            variants: source.variants,
        });

        assert.equal(
            resolved.primary_name_en,
            "YBS 60-B · Thaketa 65 Ward ↔ Padauk Chaung / Thiri Mingalar Market",
        );
        assert.equal(resolved.origin_en, "Thaketa 65 Ward");
    });

    it("normalizes APS from inbound variant endpoints", () => {
        const source = loadMergedRoute("APS");
        assert.ok(source, "APS merged JSON should exist for this test");

        const resolved = buildResolvedRouteNames({
            route_code: "APS",
            route_title_my: source.route_title_my,
            route_title_en: source.route_title_en,
            route_name_en: source.route_name_en,
            variants: source.variants,
        });

        assert.equal(resolved.public_name, "APS · လမ်း(၃၀) ↔ အောင်မင်္ဂလာအဝေးပြေး");
        assert.equal(
            resolved.primary_name_en,
            "APS · 30th Street ↔ Aung Mingalar Highway Terminal",
        );
        assert.equal(resolved.origin_en, "30th Street");
        assert.equal(resolved.destination_en, "Aung Mingalar Highway Terminal");
    });
});

describe("detectRouteNameIssues", () => {
    it("flags broken stored English names", () => {
        const issues = detectRouteNameIssues({
            route_code: "YBS-6",
            display_code: "YBS 6",
            public_name: "YBS 6 · ၈၉ လမ်းဆုံ ↔ ဒဂုံဧရာအဝေးပြေး",
            origin_name: "Shit",
            destination_name: "sae ↔ koe Kwae ↔ Dagon Ayar A Way Pyay",
            primary_name_my: "YBS 6 · ၈၉ လမ်းဆုံ ↔ ဒဂုံဧရာအဝေးပြေး",
            primary_name_en: "YBS 6 · Shit ↔ sae ↔ koe Kwae ↔ Dagon Ayar A Way Pyay",
            alias_und: "YBS-6",
        });

        assert.ok(issues.includes("en_multiple_arrows"));
        assert.ok(issues.includes("origin_dest_contains_arrow"));
        assert.ok(issues.includes("broken_numeric_romanization"));
    });

    it("scores high confidence for repairable broken names", () => {
        const endpoints = {
            origin_my: "၈၉ လမ်းဆုံ",
            destination_my: "ဒဂုံဧရာအဝေးပြေး",
            origin_en: "89 Junction",
            destination_en: "Dagon Ayar Highway",
        };
        const confidence = scoreRouteNameRepairConfidence({
            route_code: "YBS-6",
            issues: ["en_multiple_arrows", "broken_numeric_romanization"],
            endpoints,
            is_trial_route: false,
        });
        assert.equal(confidence, "high");
    });
});

describe("normalizeYbsRouteDisplayNames integration", () => {
    it("uses variants when provided for future imports", () => {
        const source = loadMergedRoute("YBS-6");
        assert.ok(source);

        const normalized = normalizeYbsRouteDisplayNames({
            route_code: "YBS-6",
            route_number: 6,
            route_title_my: source.route_title_my,
            route_title_en: source.route_title_en,
            route_name_en: source.route_name_en,
            variants: source.variants,
        });

        assert.equal(normalized.primary_name_en, "YBS 6 · 89 Junction ↔ Dagon Ayar Highway");
        assert.deepEqual(normalized.validation_errors, []);
    });
});

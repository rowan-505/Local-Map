import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
    diagnoseLanguageMerge,
    MERGED_EXTRACTION_SCHEMA_VERSION,
    mergeLanguageRoutes,
} from "./merge-language-routes.js";

function writeRoute(filePath: string, payload: Record<string, unknown>): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

describe("merge-language-routes", () => {
    it("writes import-ready schema v3 with merged variants and stops", () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ybs-merge-"));
        const myPath = path.join(tempDir, "my", "YBS-TEST.json");
        const enPath = path.join(tempDir, "en", "YBS-TEST.json");
        const outputPath = path.join(tempDir, "merged", "YBS-TEST.json");

        writeRoute(myPath, {
            source: {
                source_name: "external_ybs_app",
                source_method: "adb_uiautomator_xml",
                language: "my",
            },
            extraction: {
                language: "my",
                outbound_stop_count: 2,
                inbound_stop_count: 1,
            },
            route: {
                route_code_candidate: "YBS-TEST",
                route_name_my: "မြန်မာအမည်",
                operator_name: "GYCT",
            },
            route_index_identity: { operator_name: "GYCT" },
            variants: [
                {
                    direction_key: "outbound",
                    real_stop_count: 2,
                    stops: [
                        {
                            sequence: 1,
                            stop_name_my: "မှတ်တိုင် အ",
                            area_text_my: "လမ်း - မြို့",
                            raw_text_my: "မှတ်တိုင် အ\nလမ်း - မြို့",
                            raw_text: "မှတ်တိုင် အ\nလမ်း - မြို့",
                        },
                        {
                            sequence: 2,
                            stop_name_my: "နှစ်ခု",
                            area_text_my: "လမ်း - မြို့",
                            raw_text_my: "နှစ်ခု\nလမ်း - မြို့",
                            raw_text: "နှစ်ခု\nလမ်း - မြို့",
                        },
                    ],
                },
                {
                    direction_key: "inbound",
                    real_stop_count: 1,
                    stops: [
                        {
                            sequence: 1,
                            stop_name_my: "ပြန်",
                            area_text_my: "လမ်း - မြို့",
                            raw_text_my: "ပြန်\nလမ်း - မြို့",
                            raw_text: "ပြန်\nလမ်း - မြို့",
                        },
                    ],
                },
            ],
        });

        writeRoute(enPath, {
            source: {
                source_name: "external_ybs_app",
                source_method: "adb_uiautomator_xml",
                language: "en",
            },
            extraction: {
                language: "en",
                outbound_stop_count: 2,
                inbound_stop_count: 1,
            },
            route: {
                route_code_candidate: "YBS-TEST",
                route_name_en: "English Name",
                route_detail_title_en_raw: "English Detail",
            },
            variants: [
                {
                    direction_key: "outbound",
                    real_stop_count: 2,
                    stops: [
                        {
                            sequence: 1,
                            stop_name_en: "Stop A",
                            area_text_en: "Road - Town",
                            raw_text_en: "Stop A\nRoad - Town",
                            raw_text: "Stop A\nRoad - Town",
                        },
                        {
                            sequence: 2,
                            stop_name_en: "Stop B",
                            area_text_en: "Road - လှည်းကူး",
                            raw_text_en: "Stop B\nRoad - လှည်းကူး",
                            raw_text: "Stop B\nRoad - လှည်းကူး",
                        },
                    ],
                },
                {
                    direction_key: "inbound",
                    real_stop_count: 1,
                    stops: [
                        {
                            sequence: 1,
                            stop_name_en: "Return Stop",
                            area_text_en: "Road - Town",
                            raw_text_en: "Return Stop\nRoad - Town",
                            raw_text: "Return Stop\nRoad - Town",
                        },
                    ],
                },
            ],
        });

        mergeLanguageRoutes({
            myanmarPath: myPath,
            englishPath: enPath,
            outputPath,
        });

        const merged = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
            extraction_schema_version: number;
            route: Record<string, unknown>;
            route_detail_identity?: Record<string, unknown>;
            extraction?: Record<string, unknown>;
            source?: Record<string, unknown>;
            variants: Array<{
                direction_key: string;
                merge_status: string;
                stops: Array<Record<string, unknown>>;
            }>;
            merge: Record<string, unknown>;
        };

        assert.equal(merged.extraction_schema_version, MERGED_EXTRACTION_SCHEMA_VERSION);
        assert.equal(merged.route.route_name_my, "မြန်မာအမည်");
        assert.equal(merged.route.route_name_en, "English Name");
        assert.equal(merged.route.route_detail_title_en_raw, "English Detail");
        assert.equal(merged.route.operator_name, "GYCT");
        assert.equal(merged.route_index_identity?.route_title_en, "English Name");
        assert.equal(merged.route_detail_identity?.route_title_en, "English Detail");
        assert.equal(merged.variants.length, 2);
        assert.ok(merged.extraction);
        assert.ok(merged.source.myanmar);
        assert.ok(merged.source.english);
        assert.equal(merged.route_detail_identity?.route_name_en, "English Name");

        const outbound = merged.variants.find((variant) => variant.direction_key === "outbound");
        assert.equal(outbound?.merge_status, "merged_by_sequence");
        assert.equal(outbound?.stops.length, 2);
        assert.equal(outbound?.stops[0].stop_name_my, "မှတ်တိုင် အ");
        assert.equal(outbound?.stops[0].stop_name_en, "Stop A");
        assert.equal(outbound?.stops[1].area_text_en_script_status, "mixed_script_from_source_app");
        assert.equal(outbound?.stops[1].merge_match_method, "direction_sequence");
        assert.equal(outbound?.stops[1].merge_confidence, 80);
        assert.ok(merged.merge);
    });

    it("blocks merge when direction stop counts differ", () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ybs-merge-"));
        const myPath = path.join(tempDir, "my.json");
        const enPath = path.join(tempDir, "en.json");
        const outputPath = path.join(tempDir, "merged.json");

        writeRoute(myPath, {
            route: { route_name_my: "မြန်မာ" },
            variants: [
                {
                    direction_key: "outbound",
                    real_stop_count: 2,
                    stops: [{ stop_name_my: "A" }, { stop_name_my: "B" }],
                },
                { direction_key: "inbound", real_stop_count: 0, stops: [] },
            ],
        });

        writeRoute(enPath, {
            route: { route_name_en: "English" },
            variants: [
                {
                    direction_key: "outbound",
                    real_stop_count: 1,
                    stops: [{ stop_name_en: "A" }],
                },
                { direction_key: "inbound", real_stop_count: 0, stops: [] },
            ],
        });

        mergeLanguageRoutes({ myanmarPath: myPath, englishPath: enPath, outputPath });
        const merged = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
            variants: Array<{ direction_key: string; merge_status: string; stops: unknown[] }>;
            warnings: string[];
        };

        const outbound = merged.variants.find((variant) => variant.direction_key === "outbound");
        assert.equal(outbound?.merge_status, "blocked_count_mismatch");
        assert.equal(outbound?.stops.length, 0);
        assert.ok(merged.warnings.some((warning) => warning.includes("LANGUAGE_DIRECTION_STOP_COUNT_MISMATCH")));
    });

    it("generates route_title_en from English outbound endpoints when app title is missing", () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ybs-merge-"));
        const myPath = path.join(tempDir, "my", "YBS-TEST.json");
        const enPath = path.join(tempDir, "en", "YBS-TEST.json");
        const outputPath = path.join(tempDir, "merged", "YBS-TEST.json");

        writeRoute(myPath, {
            route: {
                route_code_candidate: "YBS-TEST",
                route_name_my: "(၂) ပိတောက်ကွေ့ - အောင်မင်္ဂလာအဝေးပြေး",
            },
            route_index_identity: {
                route_title_my: "(၂) ပိတောက်ကွေ့ - အောင်မင်္ဂလာအဝေးပြေး",
            },
            route_detail_identity: {
                route_title_my: "(၂) ပိတောက်ကွေ့ - အောင်မင်္ဂလာအဝေးပြေး",
            },
            variants: [
                {
                    direction_key: "outbound",
                    real_stop_count: 2,
                    stops: [
                        { sequence: 1, stop_name_my: "ပိတောက်ကွေ့" },
                        { sequence: 2, stop_name_my: "အောင်မင်္ဂလာအဝေးပြေး" },
                    ],
                },
                {
                    direction_key: "inbound",
                    real_stop_count: 2,
                    stops: [
                        { sequence: 1, stop_name_my: "အောင်မင်္ဂလာအဝေးပြေး" },
                        { sequence: 2, stop_name_my: "ပိတောက်ကွေ့" },
                    ],
                },
            ],
        });

        writeRoute(enPath, {
            route: {
                route_code_candidate: "YBS-TEST",
                route_detail_title_en_raw: "(၂) ပိတောက်ကွေ့ - အောင်မင်္ဂလာအဝေးပြေး",
            },
            variants: [
                {
                    direction_key: "outbound",
                    real_stop_count: 2,
                    stops: [
                        { sequence: 1, stop_name_en: "Padauk Kwae" },
                        { sequence: 2, stop_name_en: "Aung Mingalar A Way Pyay" },
                    ],
                },
                {
                    direction_key: "inbound",
                    real_stop_count: 2,
                    stops: [
                        { sequence: 1, stop_name_en: "Aung Mingalar A Way Pyay" },
                        { sequence: 2, stop_name_en: "Padauk Kwae" },
                    ],
                },
            ],
        });

        mergeLanguageRoutes({
            myanmarPath: myPath,
            englishPath: enPath,
            outputPath,
        });

        const merged = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
            route: Record<string, unknown>;
            route_index_identity?: Record<string, unknown>;
            route_detail_identity?: Record<string, unknown>;
        };

        assert.equal(merged.route.route_name_en, "Padauk Kwae - Aung Mingalar A Way Pyay");
        assert.equal(merged.route.route_name_en_source, "generated_from_english_variant_endpoints");
        assert.equal(merged.route_index_identity?.route_title_en, "Padauk Kwae - Aung Mingalar A Way Pyay");
        assert.equal(merged.route_detail_identity?.route_title_en, "Padauk Kwae - Aung Mingalar A Way Pyay");
    });

    it("writes diagnosis reports without writing merged output", () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ybs-merge-"));
        const runRoot = path.join(tempDir, "run");
        const myPath = path.join(tempDir, "my", "YBS-TEST.json");
        const enPath = path.join(tempDir, "en", "YBS-TEST.json");
        const mergedPath = path.join(runRoot, "merged", "routes", "YBS-TEST.json");

        writeRoute(myPath, {
            route: {
                route_code_candidate: "YBS-TEST",
                route_number: 1,
                route_name_my: "မြန်မာ",
            },
            route_index_identity: { operator_name: "GYCT" },
            variants: [
                {
                    direction_key: "outbound",
                    real_stop_count: 1,
                    stops: [{ sequence: 1, stop_name_my: "က", area_text_my: "လမ်း - မြို့" }],
                },
                {
                    direction_key: "inbound",
                    real_stop_count: 1,
                    stops: [{ sequence: 1, stop_name_my: "ခ", area_text_my: "လမ်း - မြို့" }],
                },
            ],
        });

        writeRoute(enPath, {
            route: {
                route_code_candidate: "YBS-TEST",
                route_number: 1,
                route_name_en: "English",
            },
            variants: [
                {
                    direction_key: "outbound",
                    real_stop_count: 1,
                    stops: [{ sequence: 1, stop_name_en: "A", area_text_en: "Road - Town" }],
                },
                {
                    direction_key: "inbound",
                    real_stop_count: 1,
                    stops: [{ sequence: 1, stop_name_en: "Bus Details", area_text_en: "Road - Town" }],
                },
            ],
        });

        const report = diagnoseLanguageMerge({
            myanmarPath: myPath,
            englishPath: enPath,
            config: { outputRoot: runRoot },
            diagnoseOnly: true,
        });

        assert.equal(fs.existsSync(report.jsonPath), true);
        assert.equal(fs.existsSync(report.markdownPath), true);
        assert.equal(fs.existsSync(mergedPath), false);
        assert.equal(report.diagnosis.directions.inbound.decision, "blocked_dirty_stops");
        assert.equal(report.diagnosis.checks.metadata_rows_found_in_stops.length, 1);
    });
});

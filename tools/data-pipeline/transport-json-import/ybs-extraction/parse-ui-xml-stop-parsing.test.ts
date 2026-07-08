import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    BLOCKED_STOP_METADATA_IN_STOPS,
    detectStopListScrollGap,
    findScrollBoundaryOverlap,
    isBlockedStopMetadataText,
    mergeStopRowsFromDumps,
    parseFareText,
    parseRouteMetadata,
    parseStopCountText,
    parseStopPairs,
    SCROLL_BOUNDARY_DUPLICATE_REMOVED,
    stopRowKey,
    type ParsedStopRow,
    type XmlTextNode,
} from "./parse-ui-xml.js";

function node(text: string, y: number): XmlTextNode {
    return {
        text,
        resourceId: "",
        className: "android.widget.TextView",
        packageName: "com.ybsgo.app",
        bounds: `[100,${y}][900,${y + 40}]`,
        parsedBounds: {
            x1: 100,
            y1: y,
            x2: 900,
            y2: y + 40,
            centerX: 500,
            centerY: y + 20,
        },
        selected: false,
        checked: false,
    };
}

function stopRow(name: string, area: string): ParsedStopRow {
    return {
        stop_name_my: null,
        stop_name_en: name,
        area_text_my: null,
        area_text_en: area,
        raw_text_my: null,
        raw_text_en: `${name}\n${area}`,
        raw_text: `${name}\n${area}`,
    };
}

describe("parse-ui-xml stop parsing", () => {
    it("blocks Bus Details paired with a road area", () => {
        const nodes = [
            node("Stops", 100),
            node("Bus Details", 200),
            node("No. 2 Main Road - South Dagon", 260),
            node("Real Stop", 360),
            node("No. 1 Main Road - Hlegu", 420),
        ];

        const parsed = parseStopPairs(nodes, "en");

        assert.equal(parsed.stops.length, 1);
        assert.equal(parsed.stops[0].stop_name_en, "Real Stop");
        assert.equal(parsed.stops[0].area_text_en, "No. 1 Main Road - Hlegu");
        assert.equal(parsed.skipped_metadata_rows.length, 1);
        assert.equal(parsed.skipped_metadata_rows[0].stop_name, "Bus Details");
        assert.equal(parsed.skipped_metadata_rows[0].reason, "blocked_stop_name");
    });

    it("recognizes blocked metadata labels and fare/stop-count text", () => {
        assert.equal(isBlockedStopMetadataText("Bus Details"), true);
        assert.equal(isBlockedStopMetadataText("118 Stops"), true);
        assert.equal(isBlockedStopMetadataText("300 Ks"), true);
        assert.equal(isBlockedStopMetadataText("ဘတ်စ်အသေးစိတ်"), true);
        assert.equal(isBlockedStopMetadataText("Real Stop Name"), false);
    });

    it("keeps '(number) name' stop names that look like route titles", () => {
        assert.equal(isBlockedStopMetadataText("(၄၄) လမ်းဆုံ"), false);
        assert.equal(isBlockedStopMetadataText("(၂) ဈေး"), false);
        assert.equal(isBlockedStopMetadataText("(၁၀) မိုင်"), false);
        assert.equal(isBlockedStopMetadataText("(၆) ကွေ့"), false);
    });

    it("keeps digit-only stop names paired with a road area", () => {
        const nodes = [
            node("မှတ်တိုင်များ", 900),
            node("ရာသက်ပန်", 1000),
            node("ခရေပင်လမ်း - မင်္ဂလာဒုံ", 1060),
            node("၁၀၆", 1160),
            node("ခရေပင်လမ်း - မင်္ဂလာဒုံ", 1220),
            node("ဆေးကျောင်းပေါက်", 1320),
            node("ခရေပင်လမ်း - မင်္ဂလာဒုံ", 1380),
        ];

        const parsed = parseStopPairs(nodes, "my");

        assert.equal(parsed.stops.length, 3);
        assert.equal(parsed.stops[1].stop_name_my, "၁၀၆");
        assert.equal(parsed.stops[1].area_text_my, "ခရေပင်လမ်း - မင်္ဂလာဒုံ");
    });

    it("still drops standalone route badges without a road area below", () => {
        const nodes = [
            node("မှတ်တိုင်များ", 900),
            node("၁၀၆", 1000),
            node("ရာသက်ပန်", 1100),
            node("ခရေပင်လမ်း - မင်္ဂလာဒုံ", 1160),
        ];

        const parsed = parseStopPairs(nodes, "my");

        assert.equal(parsed.stops.length, 1);
        assert.equal(parsed.stops[0].stop_name_my, "ရာသက်ပန်");
    });

    it("pairs '(number) name' stops with their road area text", () => {
        const nodes = [
            node("မှတ်တိုင်များ", 900),
            node("(၄၄) လမ်းဆုံ", 1000),
            node("ဗိုလ်မှူးဗထူးလမ်း - မြောက်ဒဂုံ", 1060),
            node("ကျန်းမာရေး", 1160),
            node("ဗိုလ်မှူးဗထူးလမ်း - မြောက်ဒဂုံ", 1220),
        ];

        const parsed = parseStopPairs(nodes, "my");

        assert.equal(parsed.stops.length, 2);
        assert.equal(parsed.stops[0].stop_name_my, "(၄၄) လမ်းဆုံ");
        assert.equal(parsed.stops[1].stop_name_my, "ကျန်းမာရေး");
    });

    it("removes only adjacent scroll-boundary duplicates", () => {
        const prev = [stopRow("A", "Road - Area"), stopRow("B", "Road - Area")];
        const next = [stopRow("B", "Road - Area"), stopRow("C", "Road - Other")];

        const merged = mergeStopRowsFromDumps([prev, next]);

        assert.equal(merged.stops.length, 3);
        assert.equal(merged.stops.map((row) => row.stop_name_en).join(","), "A,B,C");
        assert.ok(
            merged.warnings.some((warning) => warning.startsWith(SCROLL_BOUNDARY_DUPLICATE_REMOVED)),
        );
    });

    it("keeps non-adjacent repeated stop names across dumps", () => {
        const prev = [stopRow("A", "Road - Area"), stopRow("B", "Road - Area")];
        const next = [stopRow("C", "Road - Other"), stopRow("A", "Road - Area")];

        const merged = mergeStopRowsFromDumps([prev, next]);

        assert.equal(merged.stops.length, 4);
        assert.equal(stopRowKey(merged.stops[0]), stopRowKey(prev[0]));
        assert.equal(stopRowKey(merged.stops[3]), stopRowKey(next[1]));
        assert.equal(
            merged.warnings.some((warning) => warning.startsWith(SCROLL_BOUNDARY_DUPLICATE_REMOVED)),
            false,
        );
    });

    it("detects scroll gaps when dump windows do not share anchor rows", () => {
        const prev = [stopRow("A", "Road - Area"), stopRow("B", "Road - Area")];
        const next = [stopRow("C", "Road - Other"), stopRow("D", "Road - Other")];

        assert.equal(findScrollBoundaryOverlap(prev, next), 0);
        assert.equal(detectStopListScrollGap(prev, next), true);
    });

    it("does not flag non-adjacent repeats as scroll gaps", () => {
        const prev = [stopRow("A", "Road - Area"), stopRow("B", "Road - Area")];
        const next = [stopRow("C", "Road - Other"), stopRow("A", "Road - Area")];

        assert.equal(findScrollBoundaryOverlap(prev, next), 0);
        assert.equal(detectStopListScrollGap(prev, next), false);
    });

    it("does not flag healthy overlap windows as scroll gaps", () => {
        const prev = [stopRow("A", "Road - Area"), stopRow("B", "Road - Area")];
        const next = [stopRow("B", "Road - Area"), stopRow("C", "Road - Other")];

        assert.equal(findScrollBoundaryOverlap(prev, next), 1);
        assert.equal(detectStopListScrollGap(prev, next), false);
    });

    it("parses single and range fare text", () => {
        assert.deepEqual(parseFareText("1,500 Ks"), {
            fare_min: 1500,
            fare_max: null,
            currency_code: "MMK",
        });
        assert.deepEqual(parseFareText("300 Ks / 500 Ks"), {
            fare_min: 300,
            fare_max: 500,
            currency_code: "MMK",
        });
    });

    it("parses English and Myanmar stop counts", () => {
        assert.equal(parseStopCountText("236 Stops"), 236);
        assert.equal(parseStopCountText("236 မှတ်တိုင်"), 236);
    });

    it("extracts fare, operator, and stop count from route detail metadata", () => {
        const nodes = [
            node("236 Stops", 100),
            node("GYCT", 120),
            node("1,500 Ks", 140),
            node("Bus Stops", 200),
        ];
        const metadata = parseRouteMetadata(nodes, "YBS-1");

        assert.equal(metadata.fare_text, "1,500 Ks");
        assert.equal(metadata.fare_min, 1500);
        assert.equal(metadata.fare_max, null);
        assert.equal(metadata.operator_name, "GYCT");
        assert.equal(metadata.stop_count, 236);
    });

    it("recognizes Myanmar route titles without a dash separator", () => {
        const nodes = [
            node("ဘတ်စ်အသေးစိတ်", 40),
            node("(၅၆) မြို့တွင်း", 80),
            node("24 မှတ်တိုင်", 100),
        ];
        const metadata = parseRouteMetadata(nodes, "YBS-56");

        assert.equal(metadata.route_name_my, "(၅၆) မြို့တွင်း");
    });

    it("reads operator from the company label instead of the route badge", () => {
        const nodes = [
            node("ဘတ်စ်အသေးစိတ်", 40),
            node("(၁၁၂) အောင်မြင့်မိုရ်အိမ်ရာ - ပန်းဆိုးတန်း", 60),
            node("112", 80),
            node("105 မှတ်တိုင်", 100),
            node("ကုမ္ပဏီ", 120),
            node("YUPT", 140),
            node("ယာဉ်စီးခ", 160),
            node("350 Ks / 400 Ks", 180),
        ];
        const metadata = parseRouteMetadata(nodes, "YBS-112");

        assert.equal(metadata.operator_name, "YUPT");
        assert.equal(metadata.fare_text, "350 Ks / 400 Ks");
    });
});

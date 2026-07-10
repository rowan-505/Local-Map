/**
 * Parse Myanmar train app route list cards from ADB uiautomator XML.
 *
 * File-only. No database access.
 */

import {
    parseCombinedTrainTitle,
    parseTrainNumberToken,
} from "../lib/text-normalize.js";
import {
    parseBounds,
    parseXmlTextNodes,
    type ParsedBounds,
} from "../../transport-json-import/ybs-extraction/parse-ui-xml.js";

export type TrainCardBounds = ParsedBounds;

export type ParsedTrainRouteCard = {
    train_number: string | null;
    direction_text: string | null;
    route_title: string | null;
    origin_destination_text: string | null;
    start_time_text: string | null;
    badges: string[];
    raw_card_text: string[];
    card_bounds: TrainCardBounds | null;
};

const CLOCK_TIME_RE = /\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/i;
const DIRECTION_RE = /^(up|down|အဆန်|အစုန်)$/i;
const ORIGIN_DEST_RE = /(.+?)\s*(?:→|->|↔|–|-)\s*(.+)/;
const TRAIN_NUMBER_INLINE_RE = /(?:train|no\.?)\s*([၀-၉\dA-Za-z-]{1,8})/i;
const PRICE_RE = /\d[\d,]*\s*(?:ks|kyat|ကျပ်)\b/i;
const BADGE_RE =
    /^(express|mail|local|urban|demu|ordinary|special|အမြန်|စာတိုက်|ဒေသတွင်း|မြို့ပြ)$/i;

const TOP_TAB_RE = /^(all|up|down|အားလုံး|အဆန်|အစုန်)$/i;

const LIST_NOISE = new Set([
    "Search",
    "Settings",
    "Explore",
    "Find route",
    "Route",
    "Home",
    "Station",
    "Community",
    "Profile",
    "ရှာမည်",
    "ရှာဖွေရန်",
    "ဆက်တင်",
    "လမ်းကြောင်း",
    "ပင်မစာမျက်နှာ",
    "ဘူတာရုံ",
    "အသိုင်းအဝိုင်း",
    "ပရိုဖိုင်",
    "Favorite",
    "Share",
    "မျှဝေမည်",
    "View Full Schedule",
    "Collapse Schedule",
    "Schedule (List)",
    "Schedule (Map)",
    "အချိန်ဇယား (စာရင်း)",
    "အချိန်ဇယား (မြေပုံ)",
]);

type TextNode = ReturnType<typeof parseXmlTextNodes>[number];

function isListNoiseText(text: string): boolean {
    const trimmed = text.trim();
    if (LIST_NOISE.has(trimmed)) {
        return true;
    }
    if (/^schedule\s*\(/i.test(trimmed) || /^အချိန်ဇယား\s*\(/u.test(trimmed)) {
        return true;
    }
    return false;
}

function parseTrainNumber(text: string): string | null {
    return parseTrainNumberToken(text);
}

function isTopTabLabel(node: TextNode, text: string): boolean {
    return node.parsedBounds.y1 < 380 && TOP_TAB_RE.test(text.trim());
}

function isListNoise(text: string, node: TextNode): boolean {
    const trimmed = text.trim();
    if (!trimmed) {
        return true;
    }
    if (isListNoiseText(trimmed)) {
        return true;
    }
    if (isTopTabLabel(node, trimmed)) {
        return true;
    }
    if (PRICE_RE.test(trimmed)) {
        return true;
    }
    return false;
}

function parseClockTime(text: string): string | null {
    const match = text.trim().match(CLOCK_TIME_RE);
    return match ? match[0].replace(/\s+/g, " ").toUpperCase() : null;
}

function isDirectionText(text: string): boolean {
    return DIRECTION_RE.test(text.trim());
}

function isBadgeText(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 32) {
        return false;
    }
    if (BADGE_RE.test(trimmed)) {
        return true;
    }
    if (parseTrainNumber(trimmed)) {
        return false;
    }
    if (CLOCK_TIME_RE.test(trimmed) || ORIGIN_DEST_RE.test(trimmed)) {
        return false;
    }
    // Short uppercase labels like "DEMU", "AAR"
    return /^[A-Z]{2,6}$/.test(trimmed);
}

function buildCardBounds(nodes: TextNode[]): TrainCardBounds | null {
    if (nodes.length === 0) {
        return null;
    }

    const x1 = Math.min(...nodes.map((node) => node.parsedBounds.x1));
    const y1 = Math.min(...nodes.map((node) => node.parsedBounds.y1));
    const x2 = Math.max(...nodes.map((node) => node.parsedBounds.x2));
    const y2 = Math.max(...nodes.map((node) => node.parsedBounds.y2));

    return parseBounds(`[${x1},${y1}][${x2},${y2}]`);
}

function classifyCardNodes(nodes: TextNode[]): ParsedTrainRouteCard {
    const texts = nodes.map((node) => node.text.trim()).filter(Boolean);
    const raw_card_text = [...texts];
    let train_number: string | null = null;
    let direction_text: string | null = null;
    let route_title: string | null = null;
    let origin_destination_text: string | null = null;
    let start_time_text: string | null = null;
    const badges: string[] = [];
    const titleCandidates: string[] = [];

    for (const node of nodes) {
        const trimmed = node.text.trim();
        if (!trimmed) {
            continue;
        }

        const combined = parseCombinedTrainTitle(trimmed);
        if (combined) {
            if (!train_number && combined.train_number) {
                train_number = combined.train_number;
            }
            if (!direction_text && combined.direction_text) {
                direction_text = combined.direction_text;
            }
            continue;
        }

        const clock = parseClockTime(trimmed);
        if (clock) {
            start_time_text = clock;
            continue;
        }

        if (isDirectionText(trimmed)) {
            direction_text = trimmed;
            continue;
        }

        const number = parseTrainNumber(trimmed);
        if (number && !train_number && node.parsedBounds.x1 < 220) {
            train_number = number;
            continue;
        }

        if (ORIGIN_DEST_RE.test(trimmed)) {
            origin_destination_text = trimmed;
            continue;
        }

        if (isBadgeText(trimmed)) {
            badges.push(trimmed);
            continue;
        }

        titleCandidates.push(trimmed);
    }

    if (!route_title && titleCandidates.length > 0) {
        route_title = titleCandidates.sort((a, b) => b.length - a.length)[0] ?? null;
    }

    return {
        train_number,
        direction_text,
        route_title,
        origin_destination_text,
        start_time_text,
        badges,
        raw_card_text,
        card_bounds: null,
    };
}

function isClockAnchor(node: TextNode): boolean {
    return Boolean(parseClockTime(node.text)) && node.parsedBounds.x1 >= 600;
}

function isTrainNumberAnchor(node: TextNode): boolean {
    return node.parsedBounds.x1 < 220 && Boolean(parseTrainNumber(node.text));
}

function anchorPriority(node: TextNode): number {
    if (isTrainNumberAnchor(node)) {
        return 2;
    }
    if (isClockAnchor(node)) {
        return 1;
    }
    return 0;
}

function findCardAnchors(nodes: TextNode[]): TextNode[] {
    const anchors: TextNode[] = [];

    for (const node of nodes) {
        if (isListNoise(node.text, node)) {
            continue;
        }
        if (isClockAnchor(node) || isTrainNumberAnchor(node)) {
            anchors.push(node);
        }
    }

    anchors.sort(
        (left, right) =>
            left.parsedBounds.centerY - right.parsedBounds.centerY ||
            left.parsedBounds.centerX - right.parsedBounds.centerX,
    );

    const deduped: TextNode[] = [];
    for (const anchor of anchors) {
        const overlapIndex = deduped.findIndex(
            (existing) =>
                Math.abs(existing.parsedBounds.centerY - anchor.parsedBounds.centerY) < 80,
        );
        if (overlapIndex === -1) {
            deduped.push(anchor);
            continue;
        }

        const existing = deduped[overlapIndex]!;
        if (anchorPriority(anchor) > anchorPriority(existing)) {
            deduped[overlapIndex] = anchor;
        }
    }

    return deduped;
}

function collectCardNodes(nodes: TextNode[], anchor: TextNode): TextNode[] {
    return nodes.filter((node) => {
        if (isListNoise(node.text, node)) {
            return false;
        }
        const verticalDistance = node.parsedBounds.y1 - anchor.parsedBounds.y1;
        return verticalDistance >= -15 && verticalDistance <= 140;
    });
}

/** Unique key for one visible route card on the list screen. */
export function trainRouteListDedupeKey(card: ParsedTrainRouteCard): string {
    return [
        card.train_number ?? "",
        card.direction_text ?? "",
        card.origin_destination_text ?? "",
        card.start_time_text ?? "",
    ]
        .join("|")
        .toLowerCase();
}

function pickRicherCard(
    left: ParsedTrainRouteCard,
    right: ParsedTrainRouteCard,
): ParsedTrainRouteCard {
    const leftScore =
        Number(Boolean(left.train_number)) +
        Number(Boolean(left.direction_text)) +
        Number(Boolean(left.route_title)) +
        Number(Boolean(left.origin_destination_text)) +
        Number(Boolean(left.start_time_text)) +
        left.badges.length +
        left.raw_card_text.length;
    const rightScore =
        Number(Boolean(right.train_number)) +
        Number(Boolean(right.direction_text)) +
        Number(Boolean(right.route_title)) +
        Number(Boolean(right.origin_destination_text)) +
        Number(Boolean(right.start_time_text)) +
        right.badges.length +
        right.raw_card_text.length;

    return rightScore > leftScore ? right : left;
}

/** Parse route cards visible on one route-list XML dump. */
export function parseTrainRouteListCards(xml: string): ParsedTrainRouteCard[] {
    const nodes = parseXmlTextNodes(xml);
    const anchors = findCardAnchors(nodes);

    const cards = anchors.map((anchor) => {
        const cardNodes = collectCardNodes(nodes, anchor);
        const card = classifyCardNodes(cardNodes);
        card.card_bounds = buildCardBounds(cardNodes);
        return card;
    });

    const seen = new Set<string>();
    return cards.filter((card) => {
        const key = trainRouteListDedupeKey(card);
        if (!key.replace(/\|/g, "").trim()) {
            return false;
        }
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

/** Merge route cards from multiple scroll dumps. */
export function mergeTrainRouteListCards(
    dumps: ParsedTrainRouteCard[][],
): ParsedTrainRouteCard[] {
    const merged = new Map<string, ParsedTrainRouteCard>();

    for (const dump of dumps) {
        for (const card of dump) {
            const key = trainRouteListDedupeKey(card);
            const existing = merged.get(key);
            merged.set(key, existing ? pickRicherCard(existing, card) : card);
        }
    }

    return [...merged.values()].sort(
        (left, right) =>
            (left.card_bounds?.centerY ?? 0) - (right.card_bounds?.centerY ?? 0),
    );
}

export function runParseTrainUiSelfTest(): void {
    const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<hierarchy>
  <node text="All" bounds="[100,200][200,250]" selected="true" class="android.widget.TextView" />
  <node text="141 (Up)" bounds="[60,420][260,460]" class="android.widget.TextView" />
  <node text="Mail" bounds="[160,455][240,485]" class="android.widget.TextView" />
  <node text="Thazi-Taunggyi" bounds="[160,485][520,520]" class="android.widget.TextView" />
  <node text="05:00 AM" bounds="[820,490][960,525]" class="android.widget.TextView" />
  <node text="Za-1" bounds="[60,620][140,660]" class="android.widget.TextView" />
  <node text="Urban" bounds="[160,655][240,685]" class="android.widget.TextView" />
  <node text="Insein-Mingaladon-Yangon" bounds="[160,685][520,720]" class="android.widget.TextView" />
  <node text="05:30 AM" bounds="[820,690][960,725]" class="android.widget.TextView" />
  <node text="၈၃ (အဆန်)" bounds="[60,760][260,800]" class="android.widget.TextView" />
  <node text="ရန်ကုန်-မော်လမြိုင်" bounds="[160,795][520,830]" class="android.widget.TextView" />
  <node text="05:00 AM" bounds="[820,800][960,835]" class="android.widget.TextView" />
</hierarchy>`;

    const cards = parseTrainRouteListCards(sampleXml);
    if (cards.length !== 3) {
        throw new Error(`expected 3 cards, got ${cards.length}`);
    }
    if (cards[0]?.train_number !== "141" || cards[0]?.direction_text !== "Up") {
        throw new Error("first card identity mismatch");
    }
    if (cards[0]?.start_time_text !== "05:00 AM") {
        throw new Error("first card time mismatch");
    }
    if (cards[1]?.train_number !== "Za-1") {
        throw new Error("urban card train number mismatch");
    }
    if (cards[2]?.train_number !== "83" || cards[2]?.direction_text !== "အဆန်") {
        throw new Error("myanmar card identity mismatch");
    }

    const merged = mergeTrainRouteListCards([cards, [cards[0]!]]);
    if (merged.length !== 3) {
        throw new Error("merge dedupe failed");
    }

    console.log("ok - parse-train-ui self-test");
}

const isSelfTestEntry =
    process.argv[1]?.includes("parse-train-ui.ts") && process.argv.includes("--self-test");

if (isSelfTestEntry) {
    runParseTrainUiSelfTest();
}

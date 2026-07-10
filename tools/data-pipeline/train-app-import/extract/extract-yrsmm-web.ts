#!/usr/bin/env npx tsx
/**
 * Extract train routes from https://yrsmm.com (YRS Move web backend).
 *
 * Use this instead of ADB extraction when the app renders inside a WebView.
 * The mobile app shows the same data; UIAutomator cannot read WebView text.
 *
 * Usage:
 *   npx tsx tools/data-pipeline/train-app-import/extract/extract-yrsmm-web.ts --step index --language en
 *   npx tsx tools/data-pipeline/train-app-import/extract/extract-yrsmm-web.ts --step details --language en
 *   npx tsx tools/data-pipeline/train-app-import/extract/extract-yrsmm-web.ts --step index --language my
 *   npx tsx tools/data-pipeline/train-app-import/extract/extract-yrsmm-web.ts --step details --language my
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
    defaultRunPaths,
    ensureRunLayout,
    rawRouteDetailPathByVariantCode,
    rawRouteListPath,
    type TrainRunPaths,
} from "../lib/paths.js";
import type {
    RawTrainRouteDetail,
    RawTrainStationRow,
    TrainLanguage,
    TrainRouteListCard,
    TrainRouteListFile,
} from "../lib/types.js";
import { TRAIN_RAW_SCHEMA_VERSION } from "../lib/types.js";
import {
    extractOperationFromDescription,
    fetchAllRouteListItemsFromApi,
    fetchRoutePropsBySlug,
    fetchRouteSlugsFromApi,
    myanmarDirectionLabel,
    parseRouteSlug,
    runYrsmmWebSelfTest,
    stationSlugToEnglishName,
    variantCodeFromSlug,
    type YrsmmRouteListItem,
    type YrsmmRouteProps,
} from "../lib/yrsmm-web.js";

function routeDirectionHint(route: Pick<YrsmmRouteListItem, "direction">): string | null {
    return route.direction?.value ?? route.direction?.text ?? null;
}

export type ExtractYrsmmWebOptions = {
    step: "index" | "details";
    language: TrainLanguage;
    runRoot?: string;
    slugs?: string[];
    force?: boolean;
};

function stationNameForLanguage(
    station: YrsmmRouteProps["station_schedules"][number],
    language: TrainLanguage,
): string {
    if (language === "en") {
        return stationSlugToEnglishName(station.slug);
    }
    return station.title;
}

function routeTitleForLanguage(
    route: Pick<YrsmmRouteListItem, "slug" | "title" | "direction">,
    language: TrainLanguage,
): string {
    const directionHint = routeDirectionHint(route);
    if (language === "en") {
        const parsed = parseRouteSlug(route.slug, directionHint);
        if (parsed.directionText) {
            return `${parsed.trainNumber} (${parsed.directionText})`;
        }
        return parsed.trainNumber;
    }
    return route.title;
}

function directionTextForLanguage(
    route: Pick<YrsmmRouteListItem, "slug" | "direction">,
    language: TrainLanguage,
): string | null {
    const directionHint = routeDirectionHint(route);
    if (language === "en") {
        return (
            parseRouteSlug(route.slug, directionHint).directionText ??
            labelFromValue(route.direction?.value) ??
            null
        );
    }
    const parsed = parseRouteSlug(route.slug, directionHint);
    return myanmarDirectionLabel(parsed.directionCode) ?? route.direction?.text ?? null;
}

function labelFromValue(value: string | undefined | null): string | null {
    if (!value) {
        return null;
    }
    return value
        .split(/[-_]/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

function typeTextForLanguage(
    route: Pick<YrsmmRouteListItem, "type">,
    language: TrainLanguage,
): string | null {
    if (language === "en") {
        return labelFromValue(route.type?.value) ?? route.type?.text ?? null;
    }
    return route.type?.text ?? null;
}

function wayTextForLanguage(route: YrsmmRouteProps, language: TrainLanguage): string | null {
    if (language === "en") {
        return labelFromValue(route.way?.value) ?? route.way?.text ?? null;
    }
    return route.way?.text ?? null;
}

function trainModelForLanguage(
    route: Pick<YrsmmRouteListItem, "train_model">,
    language: TrainLanguage,
): string | null {
    if (language === "en") {
        return route.train_model?.text?.toUpperCase() ?? labelFromValue(route.train_model?.value);
    }
    return route.train_model?.text ?? null;
}

function toRouteListCard(
    route: YrsmmRouteListItem,
    language: TrainLanguage,
    index: number,
): TrainRouteListCard {
    const directionHint = routeDirectionHint(route);
    const parsed = parseRouteSlug(route.slug, directionHint);
    const routeTitle = routeTitleForLanguage(route, language);
    const typeText = typeTextForLanguage(route, language);
    const modelText = trainModelForLanguage(route, language);
    return {
        list_index: index,
        train_number: parsed.trainNumber,
        direction_text: directionTextForLanguage(route, language),
        route_title: routeTitle,
        origin_destination_text: route.route_type_title,
        start_time_text: route.origin_station_time,
        badges: [typeText, modelText].filter((value): value is string => Boolean(value)),
        raw_card_text:
            language === "en"
                ? [
                      routeTitle,
                      route.route_type_title ?? "",
                      route.origin_station_title ?? "",
                      route.destination_station_title ?? "",
                      route.origin_station_time ?? "",
                  ].filter(Boolean)
                : [
                      route.title,
                      route.route_type_title ?? "",
                      route.origin_station_title ?? "",
                      route.destination_station_title ?? "",
                      route.origin_station_time ?? "",
                  ].filter(Boolean),
        card_bounds: null,
    };
}

function toRawStationRows(route: YrsmmRouteProps, language: TrainLanguage): RawTrainStationRow[] {
    return route.station_schedules.map((station, index) => {
        const name = stationNameForLanguage(station, language);
        const time_text = station.time?.trim() || null;
        return {
            sequence: index + 1,
            name,
            time_text,
            station_name_raw: name,
            arrival_time_raw: index === 0 ? null : time_text,
            departure_time_raw: index === 0 ? time_text : null,
            raw_row_text: `${name} | ${time_text ?? ""}`,
        };
    });
}

function toRawRouteDetail(route: YrsmmRouteProps, language: TrainLanguage): RawTrainRouteDetail {
    const directionHint = routeDirectionHint(route);
    const parsed = parseRouteSlug(route.slug, directionHint);
    const variantCode = variantCodeFromSlug(route.slug, directionHint);
    const directionText = directionTextForLanguage(route, language);
    const operation = extractOperationFromDescription(route.description, language);

    return {
        schema_version: TRAIN_RAW_SCHEMA_VERSION,
        language,
        extracted_at: new Date().toISOString(),
        variant_code: variantCode,
        train_number: parsed.trainNumber,
        direction_text: directionText,
        route_title: routeTitleForLanguage(route, language),
        route_subtitle: route.route_type_title,
        operation_text: operation.operation_text,
        origin: {
            name:
                language === "en"
                    ? stationSlugToEnglishName(
                          route.station_schedules[0]?.slug ?? route.origin_station_title ?? "",
                      ) || route.origin_station_title
                    : route.origin_station_title,
            time_text: route.origin_station_time,
        },
        destination: {
            name:
                language === "en"
                    ? stationSlugToEnglishName(
                          route.station_schedules.at(-1)?.slug ?? route.destination_station_title ?? "",
                      ) || route.destination_station_title
                    : route.destination_station_title,
            time_text: route.destination_station_time,
        },
        type: typeTextForLanguage(route, language),
        direction: directionText,
        way: wayTextForLanguage(route, language),
        train_model: trainModelForLanguage(route, language),
        total_stations_text:
            route.total_stations != null ? `${route.total_stations} Station` : null,
        traveling_time_text: route.traveling_minutes,
        stations: toRawStationRows(route, language),
        schedule_complete_marker_seen: true,
        warnings: [],
        extraction: {
            method: "yrsmm_web_inertia",
            opened_from_route_list: false,
            ended_at_collapse_schedule: true,
        },
        route_title_raw: route.title,
        train_type_raw: route.type?.text ?? null,
        train_model_raw: route.train_model?.text ?? null,
        way_raw: route.way?.text ?? null,
        operation_day_raw: operation.operation_day_raw,
        origin_raw: route.origin_station_title,
        destination_raw: route.destination_station_title,
        total_stations_raw:
            route.total_stations != null ? String(route.total_stations) : null,
        travel_duration_raw: route.traveling_minutes,
    };
}

export async function extractYrsmmWeb(options: ExtractYrsmmWebOptions): Promise<string[]> {
    const paths = defaultRunPaths(options.runRoot);
    ensureRunLayout(paths);

    const slugs =
        options.slugs && options.slugs.length > 0
            ? options.slugs
            : await fetchRouteSlugsFromApi();

    if (slugs.length === 0) {
        throw new Error("No route slugs found from yrsmm.com API.");
    }

    if (options.step === "index") {
        const listItems = await fetchAllRouteListItemsFromApi();
        const filteredItems =
            options.slugs && options.slugs.length > 0
                ? listItems.filter((item) => options.slugs!.includes(item.slug))
                : listItems;

        if (filteredItems.length === 0) {
            throw new Error("No routes matched the requested slug filter.");
        }

        const routes = filteredItems.map((item, index) =>
            toRouteListCard(item, options.language, index + 1),
        );

        const output: TrainRouteListFile = {
            schema_version: TRAIN_RAW_SCHEMA_VERSION,
            language: options.language,
            extracted_at: new Date().toISOString(),
            source: {
                app: "com.yangonrailwayservice.yrs",
                tab: "All",
                method: "yrsmm_web_inertia",
            },
            routes,
            extraction: {
                run_root: paths.runRoot,
                xml_dump_count: 0,
                xml_paths: [],
                screenshot_paths: [],
                stale_scroll_limit: 0,
                completed_with_stale_scroll: true,
            },
            warnings: [
                "Fetched route list from https://yrsmm.com/api/route (live app API, not sitemap).",
                options.language === "en"
                    ? "English titles and badges are derived locally; corridor and station labels stay in Myanmar from the API."
                    : "Myanmar titles come from yrsmm.com API data.",
            ],
        };

        const outputPath = rawRouteListPath(paths, options.language);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
        return [outputPath];
    }

    const written: string[] = [];
    const skipped: string[] = [];
    const fetchWarnings: string[] = [];
    const directionBySlug = new Map(
        (await fetchAllRouteListItemsFromApi()).map((item) => [
            item.slug,
            routeDirectionHint(item),
        ]),
    );

    for (const slug of slugs) {
        const directionHint = directionBySlug.get(slug) ?? null;
        const variantCode = variantCodeFromSlug(slug, directionHint);
        const outputPath = rawRouteDetailPathByVariantCode(paths, options.language, variantCode);
        if (!options.force && fs.existsSync(outputPath)) {
            skipped.push(outputPath);
            continue;
        }

        try {
            const route = await fetchRoutePropsBySlug(slug);
            const detail = toRawRouteDetail(route, options.language);
            const resolvedPath = rawRouteDetailPathByVariantCode(
                paths,
                options.language,
                detail.variant_code,
            );
            fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
            fs.writeFileSync(resolvedPath, `${JSON.stringify(detail, null, 2)}\n`, "utf8");
            written.push(resolvedPath);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            fetchWarnings.push(`Skipped ${slug}: ${message}`);
            console.warn(fetchWarnings[fetchWarnings.length - 1]);
        }
    }

    if (written.length === 0 && skipped.length === 0) {
        throw new Error("No route detail files could be fetched from yrsmm.com.");
    }

    console.log(`Written: ${written.length}`);
    console.log(`Skipped: ${skipped.length}`);
    if (fetchWarnings.length > 0) {
        console.log(`Fetch failures: ${fetchWarnings.length}`);
    }
    return written;
}

function parseCliArgs(argv: string[]): ExtractYrsmmWebOptions {
    let step: ExtractYrsmmWebOptions["step"] | null = null;
    let language: TrainLanguage = "en";
    let runRoot: string | undefined;
    let force = false;
    const slugs: string[] = [];

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const next = argv[i + 1];

        if (arg === "--step" && next) {
            if (next !== "index" && next !== "details") {
                throw new Error('--step must be "index" or "details"');
            }
            step = next;
            i++;
        } else if (arg === "--language" && next) {
            if (next !== "en" && next !== "my") {
                throw new Error('--language must be "en" or "my"');
            }
            language = next;
            i++;
        } else if ((arg === "--run" || arg === "--run-root") && next) {
            runRoot = next.trim();
            i++;
        } else if (arg === "--slug" && next) {
            slugs.push(next.trim());
            i++;
        } else if (arg === "--force") {
            force = true;
        }
    }

    if (!step) {
        throw new Error('Missing --step index or --step details');
    }

    return { step, language, runRoot, slugs: slugs.length > 0 ? slugs : undefined, force };
}

async function main(): Promise<void> {
    const options = parseCliArgs(process.argv.slice(2));
    const outputs = await extractYrsmmWeb(options);
    for (const output of outputs) {
        console.log(`Saved: ${output}`);
    }
    if (options.step === "index") {
        const data = JSON.parse(fs.readFileSync(outputs[0]!, "utf8")) as TrainRouteListFile;
        console.log(`Routes found: ${data.routes.length}`);
    }
}

const isCliEntry = process.argv[1]?.includes("extract-yrsmm-web.ts");
const isSelfTestEntry =
    process.argv[1]?.includes("extract-yrsmm-web.ts") && process.argv.includes("--self-test");

if (isSelfTestEntry) {
    runYrsmmWebSelfTest();
} else if (isCliEntry) {
    main().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
        process.exit(1);
    });
}

/**
 * Core train route import logic (one variant per transaction).
 *
 * DB writes are invoked only from db/import-train-route.ts.
 */

import type pg from "pg";

import {
    buildVariantImportNormalizedData,
    dedupeTrainRouteStopsForImport,
    formatAccidentalDuplicateSkipWarning,
    isIntentionalCircularClosingOccurrence,
    runCircularTrainRouteSelfTest,
} from "./circular-train-route.js";
import {
    buildTrainNormalizedData,
    buildTrainSourceRefs,
    directionIdFromCode,
    directionLabelFromCode,
    isMergeableReviewStatus,
    isProtectedReviewStatus,
    TRAIN_IMPORT_CONFIDENCE_SCORE,
    TRAIN_IMPORT_GENERATION,
    TRAIN_IMPORT_REVIEW_STATUS,
    TRAIN_MODE,
    TRAIN_ROUTE_KIND,
} from "./train-import-constants.js";
import { buildRoutePublicNames } from "./route-display-names.js";
import type { ImportReadyTrainRoute } from "./types.js";

export type ImportTrainRouteValidation = {
    ok: boolean;
    errors: string[];
    warnings: string[];
};

export type ImportTrainRoutePlan = {
    route_action: "insert" | "update" | "reuse";
    variant_action: "insert" | "update" | "reuse";
    route_stops_to_delete: number;
    route_stops_to_insert: number;
    warnings: string[];
};

export type ImportTrainRouteResult = {
    variant_code: string;
    dry_run: boolean;
    committed: boolean;
    route_id: number | null;
    variant_id: number | null;
    route_stops_inserted: number;
    route_stops_deleted: number;
    plan: ImportTrainRoutePlan;
    warnings: string[];
    errors: string[];
};

function resolveRoutePublicNames(route: ImportReadyTrainRoute): {
    public_name: string;
    public_name_my: string;
    routes_public_name: string;
} {
    const built = buildRoutePublicNames({
        train_number: route.train_number,
        origin_name_en: route.origin_name_en,
        origin_name_my: route.origin_name_my,
        destination_name_en: route.destination_name_en,
        destination_name_my: route.destination_name_my,
    });

    const public_name = route.public_name ?? built.public_name;
    const public_name_my = route.public_name_my ?? built.public_name_my;

    return {
        public_name,
        public_name_my,
        routes_public_name: public_name_my || public_name,
    };
}

function primaryOriginName(route: ImportReadyTrainRoute): string | null {
    return route.origin_name_en ?? route.origin_name_my ?? null;
}

function primaryDestinationName(route: ImportReadyTrainRoute): string | null {
    return route.destination_name_en ?? route.destination_name_my ?? null;
}

export function validateImportReadyRoute(
    route: ImportReadyTrainRoute,
    expectedVariantCode?: string,
): ImportTrainRouteValidation {
    const errors: string[] = [];
    const warnings: string[] = [...(route.warnings ?? [])];

    if (expectedVariantCode && route.variant_code !== expectedVariantCode) {
        errors.push(
            `variant_code mismatch: file has ${route.variant_code}, expected ${expectedVariantCode}`,
        );
    }

    if (route.route_quality_status !== "ready_for_import") {
        errors.push(`route_quality_status is ${route.route_quality_status}, not ready_for_import`);
    }

    if (route.import_status !== "ready") {
        errors.push(`import_status is ${route.import_status}, not ready`);
    }

    if (route.stations.length === 0) {
        errors.push("route has no stations");
    }

    for (const station of route.stations) {
        if (!station.stop_id || station.stop_id <= 0) {
            errors.push(`station sequence ${station.sequence} has no matched stop_id`);
        }
        if (!station.stop_public_id?.trim()) {
            warnings.push(`station sequence ${station.sequence} is missing stop_public_id`);
        }
    }

    return {
        ok: errors.length === 0,
        errors,
        warnings,
    };
}

async function countDeletableRouteStops(
    client: pg.PoolClient,
    variantId: number,
): Promise<number> {
    const result = await client.query<{ count: string }>(
        `
        SELECT count(*)::text AS count
        FROM transport.route_stops AS rs
        WHERE rs.route_variant_id = $1
          AND (
              rs.normalized_data->>'generation' = $2
              OR rs.source_refs->>'generation' = $2
          )
        `,
        [variantId, TRAIN_IMPORT_GENERATION],
    );
    return Number(result.rows[0]?.count ?? 0);
}

async function upsertRouteNames(
    client: pg.PoolClient,
    routeId: number,
    names: { public_name: string; public_name_my: string },
): Promise<void> {
    const rows: Array<{ language_code: string; name: string; script_code: string | null }> = [
        { language_code: "my", name: names.public_name_my, script_code: "Mymr" },
        { language_code: "en", name: names.public_name, script_code: "Latn" },
    ];

    for (const row of rows) {
        const existing = await client.query<{ id: string }>(
            `
            SELECT id::text
            FROM transport.route_names
            WHERE route_id = $1
              AND language_code = $2
              AND is_primary = true
            LIMIT 1
            `,
            [routeId, row.language_code],
        );

        if (existing.rows[0]) {
            await client.query(
                `
                UPDATE transport.route_names
                SET
                    name = $2,
                    script_code = $3,
                    updated_at = now()
                WHERE id = $1
                `,
                [existing.rows[0].id, row.name, row.script_code],
            );
            continue;
        }

        await client.query(
            `
            INSERT INTO transport.route_names (
                route_id, name, language_code, script_code, name_type, is_primary, search_weight
            )
            VALUES ($1, $2, $3, $4, 'primary', true, 100)
            `,
            [routeId, row.name, row.language_code, row.script_code],
        );
    }
}

async function assertStopsExist(
    client: pg.PoolClient,
    stopIds: number[],
): Promise<void> {
    const uniqueIds = [...new Set(stopIds.filter((id) => Number.isFinite(id) && id > 0))];
    if (uniqueIds.length === 0) {
        return;
    }

    const result = await client.query<{ id: string }>(
        `
        SELECT id::text
        FROM transport.stops
        WHERE id = ANY($1::bigint[])
          AND mode = $2
          AND deleted_at IS NULL
        `,
        [uniqueIds, TRAIN_MODE],
    );

    if (result.rows.length !== uniqueIds.length) {
        const found = new Set(result.rows.map((row) => Number(row.id)));
        const missing = uniqueIds.filter((id) => !found.has(id));
        throw new Error(`Train stop id(s) not found in pool: ${missing.join(", ")}`);
    }
}

export async function planTrainRouteImport(
    client: pg.PoolClient,
    route: ImportReadyTrainRoute,
): Promise<ImportTrainRoutePlan> {
    const warnings: string[] = [];
    let route_action: ImportTrainRoutePlan["route_action"] = "insert";
    let variant_action: ImportTrainRoutePlan["variant_action"] = "insert";
    let route_stops_to_delete = 0;

    const existingRoute = await client.query<{
        id: string;
        mode: string;
        review_status: string;
    }>(
        `
        SELECT id::text, mode, review_status
        FROM transport.routes
        WHERE route_code = $1
          AND deleted_at IS NULL
        LIMIT 1
        `,
        [route.route_code],
    );

    let routeId: number | null = null;

    if (existingRoute.rows[0]) {
        routeId = Number(existingRoute.rows[0].id);
        if (existingRoute.rows[0].mode !== TRAIN_MODE) {
            throw new Error(
                `Route ${route.route_code} exists with mode=${existingRoute.rows[0].mode}; refusing to touch non-train data`,
            );
        }
        if (isProtectedReviewStatus(existingRoute.rows[0].review_status)) {
            throw new Error(
                `Route ${route.route_code} is ${existingRoute.rows[0].review_status}; import blocked`,
            );
        }
        route_action = isMergeableReviewStatus(existingRoute.rows[0].review_status)
            ? "update"
            : "reuse";
    }

    if (routeId !== null) {
        const existingVariant = await client.query<{
            id: string;
            review_status: string;
        }>(
            `
            SELECT id::text, review_status
            FROM transport.route_variants
            WHERE route_id = $1
              AND variant_code = $2
              AND deleted_at IS NULL
            LIMIT 1
            `,
            [routeId, route.variant_code],
        );

        if (existingVariant.rows[0]) {
            const variantId = Number(existingVariant.rows[0].id);
            if (isProtectedReviewStatus(existingVariant.rows[0].review_status)) {
                throw new Error(
                    `Variant ${route.variant_code} is ${existingVariant.rows[0].review_status}; import blocked`,
                );
            }
            variant_action = isMergeableReviewStatus(existingVariant.rows[0].review_status)
                ? "update"
                : "reuse";
            route_stops_to_delete = await countDeletableRouteStops(client, variantId);
        }
    }

    const { toInsert } = dedupeTrainRouteStopsForImport(route.stations);

    return {
        route_action,
        variant_action,
        route_stops_to_delete,
        route_stops_to_insert: toInsert.length,
        warnings,
    };
}

async function upsertRoute(
    client: pg.PoolClient,
    route: ImportReadyTrainRoute,
    plan: ImportTrainRoutePlan,
): Promise<number> {
    const names = resolveRoutePublicNames(route);
    const sourceRefs = buildTrainSourceRefs({
        route_code: route.route_code,
        variant_code: route.variant_code,
        train_number: route.train_number,
    });
    const normalizedData = buildTrainNormalizedData({
        train_number: route.train_number,
        train_type: route.train_type ?? null,
        train_model: route.train_model ?? null,
        operation_day: route.operation_day ?? null,
        public_name: names.public_name,
        public_name_my: names.public_name_my,
    });
    const originName = primaryOriginName(route);
    const destinationName = primaryDestinationName(route);

    const existing = await client.query<{ id: string; review_status: string; mode: string }>(
        `
        SELECT id::text, review_status, mode
        FROM transport.routes
        WHERE route_code = $1
          AND deleted_at IS NULL
        LIMIT 1
        `,
        [route.route_code],
    );

    if (existing.rows[0]) {
        const routeId = Number(existing.rows[0].id);
        if (existing.rows[0].mode !== TRAIN_MODE) {
            throw new Error(`Route ${route.route_code} is not mode=train`);
        }
        if (plan.route_action === "update") {
            await client.query(
                `
                UPDATE transport.routes
                SET
                    public_name = $2,
                    mode = $3,
                    route_kind = $4,
                    origin_name = COALESCE($5, origin_name),
                    destination_name = COALESCE($6, destination_name),
                    confidence_score = $7,
                    review_status = $8,
                    is_active = false,
                    source_refs = source_refs || $9::jsonb,
                    normalized_data = normalized_data || $10::jsonb,
                    updated_at = now()
                WHERE id = $1
                `,
                [
                    routeId,
                    names.routes_public_name,
                    TRAIN_MODE,
                    TRAIN_ROUTE_KIND,
                    originName,
                    destinationName,
                    TRAIN_IMPORT_CONFIDENCE_SCORE,
                    TRAIN_IMPORT_REVIEW_STATUS,
                    JSON.stringify(sourceRefs),
                    JSON.stringify(normalizedData),
                ],
            );
        }
        await upsertRouteNames(client, routeId, names);
        return routeId;
    }

    const inserted = await client.query<{ id: string }>(
        `
        INSERT INTO transport.routes (
            operator_id,
            route_code,
            public_name,
            mode,
            route_kind,
            origin_name,
            destination_name,
            review_status,
            source_refs,
            normalized_data,
            confidence_score,
            is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, false)
        RETURNING id::text
        `,
        [
            null,
            route.route_code,
            names.routes_public_name,
            TRAIN_MODE,
            TRAIN_ROUTE_KIND,
            originName,
            destinationName,
            TRAIN_IMPORT_REVIEW_STATUS,
            JSON.stringify(sourceRefs),
            JSON.stringify(normalizedData),
            TRAIN_IMPORT_CONFIDENCE_SCORE,
        ],
    );

    const routeId = Number(inserted.rows[0]!.id);
    await upsertRouteNames(client, routeId, names);
    return routeId;
}

async function upsertVariant(
    client: pg.PoolClient,
    route: ImportReadyTrainRoute,
    routeId: number,
    plan: ImportTrainRoutePlan,
): Promise<number> {
    const sourceRefs = buildTrainSourceRefs({
        route_code: route.route_code,
        variant_code: route.variant_code,
        direction: route.direction,
    });
    const normalizedData = buildTrainNormalizedData(buildVariantImportNormalizedData(route));

    const directionName = directionLabelFromCode(route.direction);
    const directionId = directionIdFromCode(route.direction);
    const originName = primaryOriginName(route);
    const destinationName = primaryDestinationName(route);
    const estimatedDurationMin =
        route.travel_duration_seconds != null
            ? Math.round(route.travel_duration_seconds / 60)
            : null;

    const existing = await client.query<{ id: string; review_status: string }>(
        `
        SELECT id::text, review_status
        FROM transport.route_variants
        WHERE route_id = $1
          AND variant_code = $2
          AND deleted_at IS NULL
        LIMIT 1
        `,
        [routeId, route.variant_code],
    );

    if (existing.rows[0]) {
        const variantId = Number(existing.rows[0].id);
        if (plan.variant_action === "update") {
            await client.query(
                `
                UPDATE transport.route_variants
                SET
                    direction_name = $2,
                    direction_id = $3,
                    origin_name = COALESCE($4, origin_name),
                    destination_name = COALESCE($5, destination_name),
                    headsign = COALESCE($6, headsign),
                    estimated_duration_min = COALESCE($7, estimated_duration_min),
                    confidence_score = $8,
                    review_status = $9,
                    is_active = false,
                    source_refs = source_refs || $10::jsonb,
                    normalized_data = normalized_data || $11::jsonb,
                    updated_at = now()
                WHERE id = $1
                `,
                [
                    variantId,
                    directionName,
                    directionId,
                    originName,
                    destinationName,
                    destinationName,
                    estimatedDurationMin,
                    TRAIN_IMPORT_CONFIDENCE_SCORE,
                    TRAIN_IMPORT_REVIEW_STATUS,
                    JSON.stringify(sourceRefs),
                    JSON.stringify(normalizedData),
                ],
            );
        }
        return variantId;
    }

    const inserted = await client.query<{ id: string }>(
        `
        INSERT INTO transport.route_variants (
            route_id,
            variant_code,
            direction_name,
            direction_id,
            origin_name,
            destination_name,
            headsign,
            estimated_duration_min,
            review_status,
            source_refs,
            normalized_data,
            confidence_score,
            is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12, false)
        RETURNING id::text
        `,
        [
            routeId,
            route.variant_code,
            directionName,
            directionId,
            originName,
            destinationName,
            destinationName,
            estimatedDurationMin,
            TRAIN_IMPORT_REVIEW_STATUS,
            JSON.stringify(sourceRefs),
            JSON.stringify(normalizedData),
            TRAIN_IMPORT_CONFIDENCE_SCORE,
        ],
    );

    return Number(inserted.rows[0]!.id);
}

async function replaceSimpleTrainRouteStops(
    client: pg.PoolClient,
    route: ImportReadyTrainRoute,
    variantId: number,
): Promise<{ deleted: number; inserted: number; warnings: string[] }> {
    const deleted = await client.query<{ id: string }>(
        `
        DELETE FROM transport.route_stops AS rs
        WHERE rs.route_variant_id = $1
          AND (
              rs.normalized_data->>'generation' = $2
              OR rs.source_refs->>'generation' = $2
          )
        RETURNING id::text
        `,
        [variantId, TRAIN_IMPORT_GENERATION],
    );

    // Repeated stop_id per variant is allowed (migration 126). Skip only accidental mid-route dupes.
    const { toInsert: stationsToInsert, skipped } = dedupeTrainRouteStopsForImport(route.stations);
    const warnings = skipped.map((station) => formatAccidentalDuplicateSkipWarning(station));

    let insertedCount = 0;

    for (let index = 0; index < stationsToInsert.length; index++) {
        const station = stationsToInsert[index]!;
        const sourceRefs = buildTrainSourceRefs({
            variant_code: route.variant_code,
            sequence: station.sequence,
            stop_public_id: station.stop_public_id,
        });
        const isClosingOccurrence = isIntentionalCircularClosingOccurrence(stationsToInsert, index);
        const normalizedData = buildTrainNormalizedData({
            sequence: station.sequence,
            match_method: station.match_method ?? null,
            match_score: station.match_score ?? null,
            loop_duplicate_skipped: false,
            ...(isClosingOccurrence ? { circular_closing_occurrence: true } : {}),
        });

        await client.query(
            `
            INSERT INTO transport.route_stops (
                route_variant_id,
                stop_id,
                stop_sequence,
                pickup_type,
                drop_off_type,
                is_timing_point,
                arrival_offset_seconds,
                departure_offset_seconds,
                travel_time_from_previous_seconds,
                source_time_text,
                source_time_type,
                source_refs,
                normalized_data
            )
            VALUES (
                $1, $2, $3, 0, 0, true,
                $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb
            )
            `,
            [
                variantId,
                station.stop_id,
                station.sequence,
                station.arrival_offset_seconds ?? null,
                station.departure_offset_seconds ?? null,
                station.travel_time_from_previous_seconds ?? null,
                station.source_time_text ?? null,
                station.source_time_type ?? null,
                JSON.stringify(sourceRefs),
                JSON.stringify(normalizedData),
            ],
        );
        insertedCount++;
    }

    return {
        deleted: deleted.rowCount ?? deleted.rows.length,
        inserted: insertedCount,
        warnings,
    };
}

export async function executeTrainRouteImport(
    client: pg.PoolClient,
    route: ImportReadyTrainRoute,
    options: { dryRun: boolean },
): Promise<ImportTrainRouteResult> {
    const validation = validateImportReadyRoute(route);
    if (!validation.ok) {
        return {
            variant_code: route.variant_code,
            dry_run: options.dryRun,
            committed: false,
            route_id: null,
            variant_id: null,
            route_stops_inserted: 0,
            route_stops_deleted: 0,
            plan: {
                route_action: "insert",
                variant_action: "insert",
                route_stops_to_delete: 0,
                route_stops_to_insert: dedupeTrainRouteStopsForImport(route.stations).toInsert.length,
                warnings: validation.warnings,
            },
            warnings: validation.warnings,
            errors: validation.errors,
        };
    }

    const plan = await planTrainRouteImport(client, route);
    const warnings = [...validation.warnings, ...plan.warnings];

    await assertStopsExist(
        client,
        route.stations.map((station) => station.stop_id),
    );

    if (options.dryRun) {
        return {
            variant_code: route.variant_code,
            dry_run: true,
            committed: false,
            route_id: null,
            variant_id: null,
            route_stops_inserted: plan.route_stops_to_insert,
            route_stops_deleted: plan.route_stops_to_delete,
            plan,
            warnings,
            errors: [],
        };
    }

    const routeId = await upsertRoute(client, route, plan);
    const variantId = await upsertVariant(client, route, routeId, plan);
    const stopResult = await replaceSimpleTrainRouteStops(client, route, variantId);

    return {
        variant_code: route.variant_code,
        dry_run: false,
        committed: true,
        route_id: routeId,
        variant_id: variantId,
        route_stops_inserted: stopResult.inserted,
        route_stops_deleted: stopResult.deleted,
        plan,
        warnings: [...warnings, ...stopResult.warnings],
        errors: [],
    };
}

export function runTrainImportExecutorSelfTest(): void {
    runCircularTrainRouteSelfTest();
    const route: ImportReadyTrainRoute = {
        schema_version: 1,
        prepared_at: "2026-07-09T00:00:00.000Z",
        train_number: "11",
        direction: "UP",
        route_code: "TRAIN-11",
        variant_code: "TRAIN-11-UP",
        route_quality_status: "ready_for_import",
        total_stations: 2,
        stations: [
            {
                sequence: 1,
                station_name_en: "Yangon",
                stop_id: 1,
                stop_public_id: "stop-1",
                departure_offset_seconds: 0,
                source_time_type: "departure",
            },
            {
                sequence: 2,
                station_name_en: "Naypyitaw",
                stop_id: 2,
                stop_public_id: "stop-2",
                arrival_offset_seconds: 14400,
                source_time_type: "arrival",
            },
        ],
        import_status: "ready",
        source_name: "external_myanmar_train_app",
        source_kind: "visible_app_extraction",
    };

    const valid = validateImportReadyRoute(route, "TRAIN-11-UP");
    if (!valid.ok) {
        throw new Error(`validation failed: ${valid.errors.join(", ")}`);
    }

    const blocked = validateImportReadyRoute({
        ...route,
        route_quality_status: "needs_station_match_review",
    });
    if (blocked.ok) {
        throw new Error("expected blocked route to fail validation");
    }

    console.log("ok - train-import-executor self-test");
}

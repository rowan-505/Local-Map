/**
 * Review workflow operations: readiness checks, status transitions, stop merge,
 * and route_stop replacement. Used by TransportService.
 */

import { Prisma, type PrismaClient } from "@prisma/client";

import {
    diffScalarFields,
    insertTransportAuditLog,
    type TransportAuditContext,
} from "./transport-audit.js";
import { TransportNotFoundError, TransportReviewGuardError } from "./transport.errors.js";
import {
    assertReviewTransitionAllowed,
    buildRouteMarkReviewedReadiness,
    buildRouteReviewReadiness,
    isPlaceholderStopName,
    reviewActionToStatus,
    type RouteReviewReadiness,
    type TransportReviewAction,
} from "./transport-review.js";
import {
    DUPLICATE_NEARBY_RADIUS_M,
    approxExpandDegreesFromMeters,
} from "./transport-spatial.js";

function variantDirectionKey(input: {
    variant_code: string;
    direction_name: string | null;
    direction_id: number | null;
    canonical_ybs: boolean;
}): "outbound" | "inbound" | null {
    // direction_id is the machine identity. The return names are legacy readiness
    // field keys and do not assign geographic meaning to YBS D0/D1 variants.
    if (input.direction_id === 0) return "outbound";
    if (input.direction_id === 1) return "inbound";
    if (input.canonical_ybs) return null;
    const code = input.variant_code.toLowerCase();
    if (code.includes("outbound") || code.endsWith("-a")) return "outbound";
    if (code.includes("inbound") || code.endsWith("-b")) return "inbound";
    const direction = (input.direction_name ?? "").trim().toLowerCase();
    if (direction === "outbound" || direction === "out") return "outbound";
    if (direction === "inbound" || direction === "in") return "inbound";
    return null;
}

export class TransportReviewOperations {
    /** Last readiness duplicate-check wall time (ms); set by getRouteReviewReadiness. */
    lastDuplicateCheckDurationMs: number | null = null;

    constructor(private readonly prisma: PrismaClient) {}

    async getRouteReviewReadiness(routePublicId: string): Promise<RouteReviewReadiness> {
        const routeRows = await this.prisma.$queryRaw<
            {
                id: bigint;
                route_code: string;
                mode: string;
                name_mm: string | null;
                name_en: string | null;
            }[]
        >`
            SELECT
                r.id,
                r.route_code,
                r.mode,
                rn_mm.name AS name_mm,
                rn_en.name AS name_en
            FROM transport.routes r
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM transport.route_names AS n
                WHERE n.route_id = r.id
                  AND lower(btrim(coalesce(n.language_code, ''))) = 'my'
                ORDER BY n.is_primary DESC, n.search_weight DESC, n.id ASC
                LIMIT 1
            ) AS rn_mm ON true
            LEFT JOIN LATERAL (
                SELECT n.name
                FROM transport.route_names AS n
                WHERE n.route_id = r.id
                  AND lower(btrim(coalesce(n.language_code, ''))) = 'en'
                ORDER BY n.is_primary DESC, n.search_weight DESC, n.id ASC
                LIMIT 1
            ) AS rn_en ON true
            WHERE r.public_id = ${routePublicId}::uuid AND r.deleted_at IS NULL
            LIMIT 1
        `;
        const route = routeRows[0];
        if (!route) {
            throw new TransportNotFoundError("route", routePublicId);
        }

        const variants = await this.prisma.$queryRaw<
            {
                variant_code: string;
                direction_name: string | null;
                direction_id: number | null;
            }[]
        >`
            SELECT variant_code, direction_name, direction_id::int
            FROM transport.route_variants
            WHERE route_id = ${route.id} AND deleted_at IS NULL
        `;

        const directions = new Set(
            variants
                .map((variant) =>
                    variantDirectionKey({
                        ...variant,
                        canonical_ybs:
                            route.mode === "bus" && route.route_code.startsWith("YBS-"),
                    })
                )
                .filter((value): value is "outbound" | "inbound" => value !== null),
        );

        const duplicateRadiusM = DUPLICATE_NEARBY_RADIUS_M;
        const duplicateRadiusDeg = approxExpandDegreesFromMeters(duplicateRadiusM);

        const duplicateCheckStarted = performance.now();
        const duplicateWarningsPromise = this.prisma.$queryRaw<{ count: bigint }[]>`
                SELECT count(*)::bigint AS count
                FROM transport.route_variants rv
                JOIN transport.route_stops rs ON rs.route_variant_id = rv.id
                JOIN transport.stops s ON s.id = rs.stop_id
                WHERE rv.route_id = ${route.id}
                  AND rv.deleted_at IS NULL
                  AND s.deleted_at IS NULL
                  AND EXISTS (
                    SELECT 1 FROM transport.stops s2
                    WHERE s2.id <> s.id
                      AND s2.deleted_at IS NULL
                      AND s2.is_active = true
                      AND s2.geom && ST_Expand(s.geom, ${duplicateRadiusDeg}::float8)
                      AND ST_DWithin(
                          s.geom::geography,
                          s2.geom::geography,
                          ${duplicateRadiusM}::float8
                      )
                  )
            `;

        const [counts, sourceLink, pathReview, stopNames, duplicateWarnings, markReviewed] =
            await Promise.all([
            this.prisma.$queryRaw<
                { stop_count: bigint; path_count: bigint }[]
            >`
                SELECT
                    (SELECT count(*) FROM transport.route_variants v
                        JOIN transport.route_stops rs ON rs.route_variant_id = v.id
                        WHERE v.route_id = ${route.id} AND v.deleted_at IS NULL)::bigint AS stop_count,
                    (SELECT count(*) FROM transport.route_variants v
                        JOIN transport.route_paths p ON p.route_variant_id = v.id
                        WHERE v.route_id = ${route.id} AND v.deleted_at IS NULL AND p.deleted_at IS NULL)::bigint AS path_count
            `,
            this.prisma.$queryRaw<{ count: bigint }[]>`
                SELECT count(*)::bigint AS count FROM transport.source_links
                WHERE entity_type = 'route' AND entity_id = ${route.id}
            `,
            this.prisma.$queryRaw<{ needs_review: boolean }[]>`
                SELECT EXISTS (
                    SELECT 1
                    FROM transport.route_paths rp
                    JOIN transport.route_variants rv ON rv.id = rp.route_variant_id
                    WHERE rv.route_id = ${route.id}
                      AND rp.deleted_at IS NULL
                      AND rv.deleted_at IS NULL
                      AND (
                        rp.review_status = 'needs_review'
                        OR rp.path_kind = 'corridor_estimate'
                        OR coalesce(rp.normalized_data->>'needs_geometry_review', 'false') = 'true'
                      )
                ) AS needs_review
            `,
            this.prisma.$queryRaw<{ name_mm: string | null; name_en: string | null; name: string }[]>`
                SELECT DISTINCT s.name_mm, s.name_en, s.name
                FROM transport.stops s
                JOIN transport.route_stops rs ON rs.stop_id = s.id
                JOIN transport.route_variants rv ON rv.id = rs.route_variant_id
                WHERE rv.route_id = ${route.id} AND rv.deleted_at IS NULL AND s.deleted_at IS NULL
            `,
            duplicateWarningsPromise.then((rows) => {
                this.lastDuplicateCheckDurationMs = Number(
                    (performance.now() - duplicateCheckStarted).toFixed(1),
                );
                return rows;
            }),
            this.prisma.$queryRaw<
                {
                    variant_count: bigint;
                    stops_missing_geom: boolean;
                    variant_missing_path: boolean;
                    path_unreviewed: boolean;
                    sequence_incomplete: boolean;
                }[]
            >`
                SELECT
                    (SELECT count(*)::bigint FROM transport.route_variants v
                        WHERE v.route_id = ${route.id} AND v.deleted_at IS NULL) AS variant_count,
                    EXISTS (
                        SELECT 1
                        FROM transport.route_stops rs
                        JOIN transport.route_variants rv ON rv.id = rs.route_variant_id
                        JOIN transport.stops s ON s.id = rs.stop_id
                        WHERE rv.route_id = ${route.id}
                          AND rv.deleted_at IS NULL
                          AND s.deleted_at IS NULL
                          AND s.geom IS NULL
                    ) AS stops_missing_geom,
                    EXISTS (
                        SELECT 1
                        FROM transport.route_variants v
                        WHERE v.route_id = ${route.id}
                          AND v.deleted_at IS NULL
                          AND NOT EXISTS (
                            SELECT 1 FROM transport.route_paths p
                            WHERE p.route_variant_id = v.id AND p.deleted_at IS NULL
                          )
                    ) AS variant_missing_path,
                    EXISTS (
                        SELECT 1
                        FROM transport.route_paths rp
                        JOIN transport.route_variants rv ON rv.id = rp.route_variant_id
                        WHERE rv.route_id = ${route.id}
                          AND rp.deleted_at IS NULL
                          AND rv.deleted_at IS NULL
                          AND coalesce(rp.review_status, '') NOT IN ('reviewed', 'verified')
                    ) AS path_unreviewed,
                    EXISTS (
                        SELECT 1
                        FROM transport.route_variants v
                        LEFT JOIN transport.route_stops rs ON rs.route_variant_id = v.id
                        WHERE v.route_id = ${route.id} AND v.deleted_at IS NULL
                        GROUP BY v.id, v.normalized_data
                        HAVING count(rs.id) < 2
                            OR min(rs.stop_sequence) IS DISTINCT FROM 1
                            OR (
                                max(rs.stop_sequence) IS DISTINCT FROM count(rs.id)
                                AND NOT (
                                    (
                                        coalesce(
                                            (v.normalized_data->>'closing_duplicate_stop_skipped')::boolean,
                                            false
                                        )
                                        OR coalesce(
                                            (v.normalized_data->>'is_circular_route')::boolean,
                                            false
                                        )
                                    )
                                    AND max(rs.stop_sequence) = count(rs.id) + 1
                                )
                            )
                    ) AS sequence_incomplete
            `,
        ]);

        const hasPlaceholder = stopNames.some(
            (row) =>
                isPlaceholderStopName(row.name_mm) ||
                isPlaceholderStopName(row.name_en) ||
                isPlaceholderStopName(row.name),
        );

        return {
            ...buildRouteReviewReadiness({
                has_outbound_variant: directions.has("outbound"),
                has_inbound_variant: directions.has("inbound"),
                has_route_path: Number(counts[0]?.path_count ?? 0) > 0,
                has_route_stops: Number(counts[0]?.stop_count ?? 0) > 0,
                has_route_source_link: Number(sourceLink[0]?.count ?? 0) > 0,
                has_placeholder_stop_name: hasPlaceholder,
                has_unresolved_duplicate_warning: Number(duplicateWarnings[0]?.count ?? 0) > 0,
                path_needs_geometry_review: Boolean(pathReview[0]?.needs_review),
            }),
            ...buildRouteMarkReviewedReadiness({
                names_complete: Boolean(route.name_mm?.trim() && route.name_en?.trim()),
                has_variants: Number(markReviewed[0]?.variant_count ?? 0) > 0,
                stop_sequence_complete: !Boolean(markReviewed[0]?.sequence_incomplete),
                all_stops_have_geom: !Boolean(markReviewed[0]?.stops_missing_geom),
                all_variants_have_path: !Boolean(markReviewed[0]?.variant_missing_path),
                all_paths_reviewed: !Boolean(markReviewed[0]?.path_unreviewed),
                path_required: route.mode !== "train",
            }),
        };
    }

    async applyRouteReviewAction(
        routePublicId: string,
        action: TransportReviewAction,
        audit: TransportAuditContext,
        reason?: string,
    ): Promise<{
        public_id: string;
        review_status: string;
        readiness: RouteReviewReadiness;
    }> {
        const nextStatus = reviewActionToStatus(action);
        let readiness: RouteReviewReadiness | null = null;
        if (action === "mark_verified") {
            readiness = await this.getRouteReviewReadiness(routePublicId);
            if (!readiness.can_verify) {
                throw new TransportReviewGuardError(
                    "ROUTE_VERIFY_BLOCKED",
                    "Route cannot be verified until all blockers are resolved.",
                    readiness.blockers,
                );
            }
        }
        if (action === "mark_reviewed") {
            readiness = await this.getRouteReviewReadiness(routePublicId);
            if (!readiness.can_mark_reviewed) {
                throw new TransportReviewGuardError(
                    "ROUTE_REVIEW_BLOCKED",
                    "Route cannot be marked reviewed until all blockers are resolved.",
                    readiness.mark_reviewed_blockers,
                );
            }
        }

        const txResult = await this.prisma.$transaction(async (tx) => {
            const rows = await tx.$queryRaw<
                { id: bigint; review_status: string }[]
            >`
                SELECT id, review_status FROM transport.routes
                WHERE public_id = ${routePublicId}::uuid AND deleted_at IS NULL
                FOR UPDATE
            `;
            const before = rows[0];
            if (!before) {
                throw new TransportNotFoundError("route", routePublicId);
            }
            assertReviewTransitionAllowed(before.review_status, nextStatus);

            await tx.$queryRaw`
                UPDATE transport.routes
                SET review_status = ${nextStatus}, updated_at = now()
                WHERE id = ${before.id}
            `;

            const diff = diffScalarFields(
                { review_status: before.review_status },
                { review_status: nextStatus },
                ["review_status"],
            );
            await insertTransportAuditLog(tx, {
                action: "transport.route.review_status",
                entityType: "transport_route",
                entityId: before.id,
                entityPublicId: routePublicId,
                changedFields: diff.changedFields,
                oldValues: diff.oldValues,
                newValues: diff.newValues,
                metadata: reason ? { reason, action } : { action },
                context: audit,
            });

            return { public_id: routePublicId, review_status: nextStatus };
        });

        // Reuse the gate readiness when already computed; otherwise one post-TX calc.
        // Never run readiness twice for the same successful mutation.
        if (!readiness) {
            readiness = await this.getRouteReviewReadiness(routePublicId);
        }

        return { ...txResult, readiness };
    }

    async applyStopReviewAction(
        stopPublicId: string,
        action: TransportReviewAction,
        audit: TransportAuditContext,
        reason?: string,
    ): Promise<{ public_id: string; review_status: string }> {
        const nextStatus = reviewActionToStatus(action);
        return this.prisma.$transaction(async (tx) => {
            const rows = await tx.$queryRaw<
                { id: bigint; review_status: string }[]
            >`
                SELECT id, review_status FROM transport.stops
                WHERE public_id = ${stopPublicId}::uuid AND deleted_at IS NULL
                FOR UPDATE
            `;
            const before = rows[0];
            if (!before) {
                throw new TransportNotFoundError("stop", stopPublicId);
            }
            assertReviewTransitionAllowed(before.review_status, nextStatus);

            await tx.$queryRaw`
                UPDATE transport.stops
                SET review_status = ${nextStatus}, updated_at = now()
                WHERE id = ${before.id}
            `;

            const diff = diffScalarFields(
                { review_status: before.review_status },
                { review_status: nextStatus },
                ["review_status"],
            );
            await insertTransportAuditLog(tx, {
                action: "transport.stop.review_status",
                entityType: "transport_stop",
                entityId: before.id,
                entityPublicId: stopPublicId,
                changedFields: diff.changedFields,
                oldValues: diff.oldValues,
                newValues: diff.newValues,
                metadata: reason ? { reason, action } : { action },
                context: audit,
            });

            return { public_id: stopPublicId, review_status: nextStatus };
        });
    }

    async applyRoutePathReviewAction(
        pathId: bigint,
        action: TransportReviewAction,
        audit: TransportAuditContext,
        reason?: string,
    ): Promise<{
        id: string;
        review_status: string;
        readiness: RouteReviewReadiness;
    }> {
        const nextStatus = reviewActionToStatus(action);
        const txResult = await this.prisma.$transaction(async (tx) => {
            const rows = await tx.$queryRaw<
                {
                    id: bigint;
                    review_status: string;
                    route_variant_id: bigint;
                    route_public_id: string;
                }[]
            >`
                SELECT
                    rp.id,
                    rp.review_status,
                    rp.route_variant_id,
                    r.public_id::text AS route_public_id
                FROM transport.route_paths rp
                JOIN transport.route_variants rv ON rv.id = rp.route_variant_id
                JOIN transport.routes r ON r.id = rv.route_id
                WHERE rp.id = ${pathId} AND rp.deleted_at IS NULL
                FOR UPDATE OF rp
            `;
            const before = rows[0];
            if (!before) {
                throw new TransportNotFoundError("route_path", String(pathId));
            }
            assertReviewTransitionAllowed(before.review_status, nextStatus);

            await tx.$queryRaw`
                UPDATE transport.route_paths
                SET review_status = ${nextStatus}, updated_at = now()
                WHERE id = ${before.id}
            `;

            const diff = diffScalarFields(
                { review_status: before.review_status },
                { review_status: nextStatus },
                ["review_status"],
            );
            await insertTransportAuditLog(tx, {
                action: "transport.route_path.review_status",
                entityType: "transport_route_path",
                entityId: before.id,
                entityPublicId: null,
                changedFields: diff.changedFields,
                oldValues: diff.oldValues,
                newValues: diff.newValues,
                metadata: {
                    action,
                    route_variant_id: String(before.route_variant_id),
                    ...(reason ? { reason } : {}),
                },
                context: audit,
            });

            return {
                id: String(before.id),
                review_status: nextStatus,
                route_public_id: before.route_public_id,
            };
        });

        // One readiness calc after commit so path-reviewed blockers update without a
        // second dashboard GET.
        const readiness = await this.getRouteReviewReadiness(txResult.route_public_id);
        return {
            id: txResult.id,
            review_status: txResult.review_status,
            readiness,
        };
    }

    async replaceRouteStop(
        routeStopId: bigint,
        stopPublicId: string,
        audit: TransportAuditContext,
        reason?: string,
    ): Promise<{ route_stop_id: string; stop_id: string }> {
        return this.prisma.$transaction(async (tx) => {
            const membership = await tx.$queryRaw<
                {
                    id: bigint;
                    route_variant_id: bigint;
                    stop_id: bigint;
                    stop_sequence: number;
                }[]
            >`
                SELECT id, route_variant_id, stop_id, stop_sequence
                FROM transport.route_stops
                WHERE id = ${routeStopId}
                FOR UPDATE
            `;
            const row = membership[0];
            if (!row) {
                throw new TransportNotFoundError("route_stop", String(routeStopId));
            }

            const targetStop = await tx.$queryRaw<{ id: bigint }[]>`
                SELECT id FROM transport.stops
                WHERE public_id = ${stopPublicId}::uuid AND deleted_at IS NULL AND is_active = true
                LIMIT 1
            `;
            const newStopId = targetStop[0]?.id;
            if (!newStopId) {
                throw new TransportNotFoundError("stop", stopPublicId);
            }

            await tx.$queryRaw`
                UPDATE transport.route_stops
                SET stop_id = ${newStopId}, updated_at = now()
                WHERE id = ${row.id}
            `;

            await insertTransportAuditLog(tx, {
                action: "transport.route_stop.replace_stop",
                entityType: "transport_route_stop",
                entityId: row.id,
                entityPublicId: null,
                changedFields: ["stop_id"],
                oldValues: { stop_id: Number(row.stop_id) },
                newValues: { stop_id: Number(newStopId) },
                metadata: {
                    stop_public_id: stopPublicId,
                    stop_sequence: row.stop_sequence,
                    ...(reason ? { reason } : {}),
                },
                context: audit,
            });

            return { route_stop_id: String(row.id), stop_id: String(newStopId) };
        });
    }

    async mergeStop(
        sourceStopPublicId: string,
        targetStopPublicId: string,
        audit: TransportAuditContext,
        reason?: string,
    ): Promise<{ source_public_id: string; target_public_id: string; route_stops_updated: number }> {
        if (sourceStopPublicId === targetStopPublicId) {
            throw new TransportReviewGuardError(
                "MERGE_SAME_STOP",
                "Source and target stop must be different.",
            );
        }

        return this.prisma.$transaction(async (tx) => {
            const stops = await tx.$queryRaw<
                { id: bigint; public_id: string; review_status: string }[]
            >`
                SELECT id, public_id::text, review_status
                FROM transport.stops
                WHERE public_id IN (${sourceStopPublicId}::uuid, ${targetStopPublicId}::uuid)
                  AND deleted_at IS NULL
                FOR UPDATE
            `;
            const source = stops.find((row) => row.public_id === sourceStopPublicId);
            const target = stops.find((row) => row.public_id === targetStopPublicId);
            if (!source) {
                throw new TransportNotFoundError("stop", sourceStopPublicId);
            }
            if (!target) {
                throw new TransportNotFoundError("stop", targetStopPublicId);
            }
            if (source.review_status === "manual_protected") {
                throw new TransportReviewGuardError(
                    "MERGE_PROTECTED",
                    "Cannot merge a manual_protected stop.",
                );
            }

            const updated = await tx.$queryRaw<{ count: bigint }[]>`
                WITH updated AS (
                    UPDATE transport.route_stops rs
                    SET stop_id = ${target.id}, updated_at = now()
                    WHERE rs.stop_id = ${source.id}
                      AND NOT EXISTS (
                        SELECT 1 FROM transport.route_stops rs2
                        WHERE rs2.route_variant_id = rs.route_variant_id
                          AND rs2.stop_id = ${target.id}
                          AND rs2.id <> rs.id
                      )
                    RETURNING rs.id
                )
                SELECT count(*)::bigint AS count FROM updated
            `;

            await tx.$queryRaw`
                UPDATE transport.stops
                SET is_active = false,
                    review_status = 'rejected',
                    updated_at = now()
                WHERE id = ${source.id}
            `;

            await insertTransportAuditLog(tx, {
                action: "transport.stop.merge",
                entityType: "transport_stop",
                entityId: source.id,
                entityPublicId: sourceStopPublicId,
                changedFields: ["is_active", "review_status", "merged_into_stop_id"],
                oldValues: {
                    is_active: true,
                    review_status: source.review_status,
                },
                newValues: {
                    is_active: false,
                    review_status: "rejected",
                    merged_into_stop_id: Number(target.id),
                },
                metadata: {
                    target_stop_public_id: targetStopPublicId,
                    route_stops_updated: Number(updated[0]?.count ?? 0),
                    ...(reason ? { reason } : {}),
                },
                context: audit,
            });

            return {
                source_public_id: sourceStopPublicId,
                target_public_id: targetStopPublicId,
                route_stops_updated: Number(updated[0]?.count ?? 0),
            };
        });
    }
}

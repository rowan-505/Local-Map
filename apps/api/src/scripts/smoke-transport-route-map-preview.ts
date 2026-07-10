/**
 * Read-only smoke test: transport route search → map-preview E2E validation.
 *
 * Usage (from repo root):
 *   npm --prefix apps/api run smoke:transport-route-map-preview
 *
 * Safety:
 * - Read-only — does not mutate transport or search data
 * - Reports data blockers when no eligible route exists
 * - Exits 0 when validation completes (success or documented blocker)
 * - Exits 1 only on unexpected API/SQL failures
 */

import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(scriptDir, "../..");
const repoRoot = resolve(apiRoot, "../..");
config({ path: resolve(repoRoot, ".env") });
config({ path: resolve(apiRoot, ".env"), override: true });

import { prisma } from "../db/prisma.js";
import { PublicMapRepository } from "../modules/public-map/public-map.repo.js";
import { PublicMapService } from "../modules/public-map/public-map.service.js";
import type {
    PublicSearchHit,
    TransportRouteMapPreviewResult,
} from "../modules/public-map/public-map.service.js";

type EligibleRouteRow = {
    route_id: string;
    route_code: string;
    public_name: string;
    route_review: string;
    variant_id: string;
    variant_review: string;
    path_id: string;
    path_review: string;
    indexed: boolean;
};

type NearestCandidateRow = {
    route_id: string;
    route_code: string;
    public_name: string;
    route_review: string;
    variant_review: string;
    path_review: string | null;
    has_geom: boolean;
    indexed: boolean;
    missing: string[];
};

type ReviewCounts = {
    scope: string;
    review_status: string;
    cnt: string;
};

function isPublicSearchHit(
    item: Awaited<ReturnType<PublicMapService["search"]>>["items"][number],
): item is PublicSearchHit {
    return "entityId" in item && typeof item.entityId === "string";
}

function maskDbHost(): string {
    const url = process.env.DATABASE_URL ?? "";
    return url.replace(/:[^:@]+@/, ":***@").split("@")[1]?.split("/")[0] ?? "(unset)";
}

function isLineStringGeometry(geometry: { type: string; coordinates: unknown }): boolean {
    if (geometry.type !== "LineString" && geometry.type !== "MultiLineString") return false;
    if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) return false;
    return true;
}

function assertValidMapPreview(preview: TransportRouteMapPreviewResult): void {
    const [minLng, minLat, maxLng, maxLat] = preview.bbox;
    if (![minLng, minLat, maxLng, maxLat].every((n) => Number.isFinite(n))) {
        throw new Error(`Invalid bbox: ${JSON.stringify(preview.bbox)}`);
    }
    if (minLng > maxLng || minLat > maxLat) {
        throw new Error(`Inverted bbox: ${JSON.stringify(preview.bbox)}`);
    }
    if (!isLineStringGeometry(preview.path.geometry)) {
        throw new Error(`Expected LineString/MultiLineString geometry, got ${preview.path.geometry.type}`);
    }
    if (preview.variants.length === 0) {
        throw new Error("Expected at least one variant summary");
    }
    const primary = preview.variants.find((v) => v.isPrimary);
    if (!primary) {
        throw new Error("Expected one primary variant in variants summary");
    }
}

async function findEligibleRoutes(): Promise<EligibleRouteRow[]> {
    return prisma.$queryRaw<EligibleRouteRow[]>`
        SELECT
            r.id::text AS route_id,
            r.route_code,
            r.public_name,
            r.review_status AS route_review,
            v.id::text AS variant_id,
            v.review_status AS variant_review,
            rp.id::text AS path_id,
            rp.review_status AS path_review,
            EXISTS (
                SELECT 1
                FROM search.search_documents d
                WHERE d.entity_type = 'transport_route'
                  AND d.entity_id = r.id
                  AND d.is_public
                  AND d.is_active
            ) AS indexed
        FROM transport.routes r
        JOIN transport.route_variants v
          ON v.route_id = r.id
         AND v.deleted_at IS NULL
         AND v.is_active = true
         AND v.review_status IN ('reviewed', 'verified')
        JOIN transport.route_paths rp
          ON rp.route_variant_id = v.id
         AND rp.deleted_at IS NULL
         AND rp.is_active = true
         AND rp.review_status IN ('reviewed', 'verified')
         AND rp.geom IS NOT NULL
         AND NOT ST_IsEmpty(rp.geom)
        WHERE r.deleted_at IS NULL
          AND r.is_active = true
          AND r.review_status IN ('reviewed', 'verified')
        ORDER BY r.id
        LIMIT 5
    `;
}

async function findNearestCandidates(): Promise<NearestCandidateRow[]> {
    const rows = await prisma.$queryRaw<
        Array<{
            route_id: string;
            route_code: string;
            public_name: string;
            route_review: string;
            variant_review: string;
            path_review: string | null;
            has_geom: boolean;
            indexed: boolean;
        }>
    >`
        SELECT
            r.id::text AS route_id,
            r.route_code,
            r.public_name,
            r.review_status AS route_review,
            v.review_status AS variant_review,
            rp.review_status AS path_review,
            (rp.geom IS NOT NULL AND NOT ST_IsEmpty(rp.geom)) AS has_geom,
            EXISTS (
                SELECT 1
                FROM search.search_documents d
                WHERE d.entity_type = 'transport_route'
                  AND d.entity_id = r.id
                  AND d.is_public
                  AND d.is_active
            ) AS indexed
        FROM transport.routes r
        JOIN transport.route_variants v
          ON v.route_id = r.id
         AND v.deleted_at IS NULL
        LEFT JOIN transport.route_paths rp
          ON rp.route_variant_id = v.id
         AND rp.deleted_at IS NULL
         AND rp.is_active = true
        WHERE r.deleted_at IS NULL
          AND r.is_active = true
        ORDER BY
            CASE WHEN r.review_status IN ('reviewed', 'verified') THEN 0 ELSE 1 END,
            CASE WHEN v.review_status IN ('reviewed', 'verified') THEN 0 ELSE 1 END,
            CASE WHEN rp.review_status IN ('reviewed', 'verified') THEN 0 ELSE 1 END,
            CASE WHEN rp.geom IS NOT NULL AND NOT ST_IsEmpty(rp.geom) THEN 0 ELSE 1 END,
            CASE WHEN EXISTS (
                SELECT 1 FROM search.search_documents d
                WHERE d.entity_type = 'transport_route' AND d.entity_id = r.id AND d.is_public AND d.is_active
            ) THEN 0 ELSE 1 END,
            r.id
        LIMIT 5
    `;

    return rows.map((row) => {
        const missing: string[] = [];
        if (!["reviewed", "verified"].includes(row.route_review)) {
            missing.push(`route.review_status=${row.route_review} (need reviewed|verified)`);
        }
        if (!["reviewed", "verified"].includes(row.variant_review)) {
            missing.push(`variant.review_status=${row.variant_review} (need reviewed|verified)`);
        }
        if (!row.path_review) {
            missing.push("route_path missing");
        } else if (!["reviewed", "verified"].includes(row.path_review)) {
            missing.push(`route_path.review_status=${row.path_review} (need reviewed|verified)`);
        }
        if (!row.has_geom) {
            missing.push("route_path geometry missing or empty");
        }
        if (!row.indexed) {
            missing.push("not indexed in search.search_documents (transport_route)");
        }
        return { ...row, missing };
    });
}

async function fetchReviewCounts(): Promise<ReviewCounts[]> {
    return prisma.$queryRaw<ReviewCounts[]>`
        SELECT 'route' AS scope, review_status, count(*)::text AS cnt
        FROM transport.routes
        WHERE deleted_at IS NULL AND is_active = true
        GROUP BY review_status
        UNION ALL
        SELECT 'variant', review_status, count(*)::text
        FROM transport.route_variants
        WHERE deleted_at IS NULL
        GROUP BY review_status
        UNION ALL
        SELECT 'path', review_status, count(*)::text
        FROM transport.route_paths
        WHERE deleted_at IS NULL
        GROUP BY review_status
        ORDER BY scope, review_status
    `;
}

async function runNegativePathValidation(
    service: PublicMapService,
    routeId: string,
    searchQuery: string,
): Promise<void> {
    console.log("\n=== Negative path: searchable route without reviewed path ===");
    const page = await service.search({ q: searchQuery, limit: 20, types: ["transport_route"] });
    const hit = page.items.find(
        (item) =>
            isPublicSearchHit(item) &&
            (item.entityType === "transport_route" || item.entityType === "bus_route") &&
            item.entityId === routeId,
    );
    if (!hit) {
        console.log("[smoke] WARN: search did not return route", { routeId, searchQuery });
    } else if (isPublicSearchHit(hit)) {
        console.log("[smoke] search hit", {
            entityType: hit.entityType,
            entityId: hit.entityId,
            displayName: hit.displayName,
            routeCode: hit.transport?.routeCode ?? null,
        });
    }

    const preview = await service.getTransportRouteMapPreview({
        entityType: "transport_route",
        entityId: routeId,
        zoom: 12,
    });
    if (preview !== null) {
        throw new Error(
            `Expected map-preview null/404 for route ${routeId} without reviewed path, got geometry`,
        );
    }
    console.log("[smoke] map-preview correctly returned null (HTTP 404 equivalent)");
}

async function runSuccessPath(
    service: PublicMapService,
    route: EligibleRouteRow,
): Promise<void> {
    console.log("\n=== Success path: search → map-preview ===");
    const searchTerms = [route.route_code, route.public_name.split("·")[0]?.trim() ?? route.route_code];
    let hitEntityId: string | null = null;

    for (const q of searchTerms) {
        const page = await service.search({ q, limit: 20, types: ["transport_route", "bus_route"] });
        const hit = page.items.find(
            (item) =>
                isPublicSearchHit(item) &&
                (item.entityType === "transport_route" || item.entityType === "bus_route") &&
                item.entityId === route.route_id,
        );
        if (hit && isPublicSearchHit(hit)) {
            hitEntityId = hit.entityId;
            console.log("[smoke] search hit", { q, entityId: hit.entityId, displayName: hit.displayName });
            break;
        }
    }

    if (!hitEntityId) {
        throw new Error(
            `Route ${route.route_id} (${route.route_code}) is DB-eligible but not returned by public search`,
        );
    }

    const preview = await service.getTransportRouteMapPreview({
        entityType: "transport_route",
        entityId: hitEntityId,
        zoom: 12,
    });
    if (!preview) {
        throw new Error(
            `Map-preview returned null for eligible route ${route.route_id} — possible SQL/join bug`,
        );
    }

    assertValidMapPreview(preview);
    console.log("[smoke] map-preview OK", {
        entityId: preview.entityId,
        bbox: preview.bbox,
        geometryType: preview.path.geometry.type,
        variantCount: preview.variants.length,
        primaryVariant: preview.variants.find((v) => v.isPrimary)?.entityId,
        importantStopCount: preview.importantStops.length,
    });
}

async function main(): Promise<void> {
    console.log("[smoke] transport route map-preview validation");
    console.log("[smoke] database host:", maskDbHost());

    const repo = new PublicMapRepository(prisma);
    const service = new PublicMapService(repo);

    const eligible = await findEligibleRoutes();
    const reviewCounts = await fetchReviewCounts();

    console.log("\n--- Review status counts ---");
    for (const row of reviewCounts) {
        console.log(`  ${row.scope}: ${row.review_status} = ${row.cnt}`);
    }

    if (eligible.length > 0) {
        console.log("\n--- Eligible routes (map-preview ready) ---");
        for (const row of eligible) {
            console.log(
                `  route ${row.route_id} ${row.route_code} indexed=${row.indexed} path=${row.path_id}`,
            );
        }
        await runSuccessPath(service, eligible[0]!);
        console.log("\n[smoke] PASS — full E2E success for route", eligible[0]!.route_id);
        return;
    }

    console.log("\n--- Data blocker: no map-preview-eligible transport route ---");
    console.log(
        "Reason: map-preview requires route + variant + route_path all reviewed|verified with non-empty geometry,",
    );
    console.log(
        "and E2E search requires the route indexed in search.search_documents.",
    );

    const nearest = await findNearestCandidates();
    console.log("\n--- Nearest candidates ---");
    for (const row of nearest) {
        console.log(`  route ${row.route_id} (${row.route_code})`);
        console.log(`    name: ${row.public_name}`);
        console.log(`    route=${row.route_review} variant=${row.variant_review} path=${row.path_review ?? "none"}`);
        console.log(`    has_geom=${row.has_geom} indexed=${row.indexed}`);
        console.log(`    missing: ${row.missing.join("; ")}`);
    }

    const indexedReviewedNoPath = await prisma.$queryRaw<
        Array<{ route_id: string; route_code: string; public_name: string }>
    >`
        SELECT r.id::text AS route_id, r.route_code, r.public_name
        FROM transport.routes r
        WHERE r.deleted_at IS NULL
          AND r.is_active = true
          AND r.review_status IN ('reviewed', 'verified')
          AND EXISTS (
              SELECT 1 FROM search.search_documents d
              WHERE d.entity_type = 'transport_route' AND d.entity_id = r.id AND d.is_public AND d.is_active
          )
          AND NOT EXISTS (
              SELECT 1
              FROM transport.route_variants v
              JOIN transport.route_paths rp ON rp.route_variant_id = v.id AND rp.deleted_at IS NULL
              WHERE v.route_id = r.id AND v.deleted_at IS NULL
          )
        ORDER BY r.id
        LIMIT 1
    `;

    const negativeRoute = indexedReviewedNoPath[0];
    if (!negativeRoute) {
        throw new Error("No indexed reviewed route found for negative-path validation");
    }

    await runNegativePathValidation(service, negativeRoute.route_id, negativeRoute.route_code);
    console.log("\n[smoke] DATA BLOCKER — no successful map-preview E2E possible on this database");
    console.log("[smoke] nearest success requires promoting route_path.review_status for routes with geometry");
    console.log(
        "[smoke] local fixture option: create ZZZ_QA_ROUTE via dashboard on local DB (see docs/archive/old-docs/transport/transport-mutation-test-checklist.md)",
    );
    console.log("[smoke] negative path validated for route", negativeRoute.route_id, negativeRoute.route_code);
}

main()
    .catch((err) => {
        console.error("\n[smoke] FAIL", err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

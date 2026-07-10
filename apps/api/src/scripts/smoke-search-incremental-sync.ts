/**
 * Live smoke test: Search V2 incremental sync via canonical write services.
 *
 * Usage (from repo root):
 *   npm --prefix apps/api run smoke:search-incremental-sync
 *
 * Safety:
 * - Uses DATABASE_URL from .env (local/staging only — never production)
 * - Restores all modified rows after tests
 * - Does not edit search.search_documents directly
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
import { DEV_AUTH_BYPASS_USER } from "../plugins/auth.js";
import { EntityAdminAreaRepository } from "../modules/entity-admin-area/entity-admin-area.repo.js";
import { EntityAdminAreaService } from "../modules/entity-admin-area/entity-admin-area.service.js";
import { PlacesRepository } from "../modules/places/places.repo.js";
import { PlacesService } from "../modules/places/places.service.js";
import { PublicMapRepository } from "../modules/public-map/public-map.repo.js";
import { PublicMapService } from "../modules/public-map/public-map.service.js";
import { TransportService } from "../modules/transport/transport.service.js";

const SMOKE_TAG = "SYNC-SMOKE";
const POLL_MS = 250;
const POLL_TIMEOUT_MS = 15_000;

type SearchDocRow = {
    entity_id: string;
    display_name: string | null;
    primary_name_en: string | null;
    searchable_text: string | null;
    is_public: boolean;
    is_active: boolean;
    source_updated_at: string | null;
    indexed_at: string | null;
};

type PlaceRow = {
    id: string;
    public_id: string;
    display_name: string | null;
    primary_name: string | null;
    english_name: string | null;
    is_public: boolean;
};

type StopRow = {
    id: string;
    public_id: string;
    name_en: string | null;
    name_mm: string | null;
    is_active: boolean;
};

function assertSafeDatabaseUrl(): void {
    const url = process.env.DATABASE_URL ?? "";
    const lower = url.toLowerCase();
    if (!url) {
        throw new Error("DATABASE_URL is not set.");
    }
    if (
        lower.includes("prod") ||
        lower.includes("production") ||
        process.env.NODE_ENV === "production"
    ) {
        throw new Error("Refusing to run smoke test against a production-looking DATABASE_URL.");
    }
    console.log("[smoke] database host:", url.replace(/:[^:@]+@/, ":***@").split("@")[1]?.split("/")[0]);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function fetchSearchDocument(
    entityType: string,
    entityId: bigint,
): Promise<SearchDocRow | null> {
    const rows = await prisma.$queryRaw<SearchDocRow[]>`
        SELECT
            entity_id::text,
            display_name,
            primary_name_en,
            searchable_text,
            is_public,
            is_active,
            source_updated_at::text,
            indexed_at::text
        FROM search.search_documents
        WHERE entity_type = ${entityType}
          AND entity_id = ${entityId}
        LIMIT 1
    `;
    return rows[0] ?? null;
}

async function waitForSearchDocument(
    entityType: string,
    entityId: bigint,
    predicate: (row: SearchDocRow | null) => boolean,
    label: string,
): Promise<SearchDocRow | null> {
    const started = Date.now();
    while (Date.now() - started < POLL_TIMEOUT_MS) {
        const row = await fetchSearchDocument(entityType, entityId);
        if (predicate(row)) {
            return row;
        }
        await sleep(POLL_MS);
    }
    throw new Error(`Timed out waiting for search document: ${label}`);
}

async function publicSearchHits(query: string): Promise<string[]> {
    const repo = new PublicMapRepository(prisma);
    const service = new PublicMapService(repo);
    const page = await service.search({ q: query, limit: 20 });
    return page.items.map((item) => {
        if ("entityId" in item && typeof item.entityId === "string") {
            return `${item.entityType}:${item.entityId}:${item.displayName ?? ""}`;
        }
        return `${item.type ?? "unknown"}:${item.id}:${"displayName" in item ? (item.displayName ?? "") : ""}`;
    });
}

async function pickIndexedPlace(): Promise<PlaceRow> {
    const rows = await prisma.$queryRaw<PlaceRow[]>`
        SELECT p.id::text, p.public_id::text, p.display_name, p.primary_name,
               en.name AS english_name, p.is_public
        FROM core.core_places p
        JOIN search.search_documents d
          ON d.entity_type = 'place' AND d.entity_id = p.id AND d.is_public AND d.is_active
        JOIN core.core_place_names en
          ON en.place_id = p.id
         AND (en.language_code = 'en' OR upper(trim(coalesce(en.script_code, ''))) = 'LATN')
        WHERE p.deleted_at IS NULL AND p.is_public = true
          AND p.lat IS NOT NULL AND p.lng IS NOT NULL
          AND NULLIF(btrim(en.name), '') IS NOT NULL
        ORDER BY p.id
        LIMIT 1
    `;
    if (!rows[0]) throw new Error("No indexed public place with English name found for smoke test.");
    return rows[0];
}

async function pickIndexedStop(): Promise<StopRow> {
    const rows = await prisma.$queryRaw<StopRow[]>`
        SELECT s.id::text, s.public_id::text, s.name_en, s.name_mm, s.is_active
        FROM transport.stops s
        JOIN search.search_documents d
          ON d.entity_type = 'transport_stop' AND d.entity_id = s.id AND d.is_public AND d.is_active
        WHERE s.deleted_at IS NULL AND s.is_active = true AND s.geom IS NOT NULL
          AND s.review_status NOT IN ('imported_unreviewed', 'rejected')
        ORDER BY s.id
        LIMIT 1
    `;
    if (!rows[0]) throw new Error("No indexed transport stop found for smoke test.");
    return rows[0];
}

async function runPlaceRenameTest(placesService: PlacesService): Promise<Record<string, unknown>> {
    const place = await pickIndexedPlace();
    const entityId = BigInt(place.id);
    const beforeDoc = await fetchSearchDocument("place", entityId);
    const originalEnglish = place.english_name ?? place.primary_name ?? place.display_name ?? "Place";
    const renamedEnglish = `${originalEnglish} ${SMOKE_TAG}`;

    console.log("\n=== Test 1: place rename ===");
    console.log("[smoke] PATCH service PlacesService.updatePlace", {
        public_id: place.public_id,
        body: { englishName: renamedEnglish },
    });

    await placesService.updatePlace(
        place.public_id,
        { englishName: renamedEnglish },
        DEV_AUTH_BYPASS_USER,
    );

    const afterCanonical = await prisma.$queryRaw<Array<{ english_name: string | null }>>`
        SELECT en.name AS english_name
        FROM core.core_place_names en
        WHERE en.place_id = ${entityId}
          AND (en.language_code = 'en' OR upper(trim(coalesce(en.script_code, ''))) = 'LATN')
        ORDER BY en.is_primary DESC, en.name
        LIMIT 1
    `;

    const afterDoc = await waitForSearchDocument(
        "place",
        entityId,
        (row) =>
            row !== null &&
            (row.display_name?.includes(SMOKE_TAG) === true ||
                row.primary_name_en?.includes(SMOKE_TAG) === true ||
                row.searchable_text?.includes(SMOKE_TAG) === true),
        "place rename reflected in search_documents",
    );

    const newNameHits = await publicSearchHits(SMOKE_TAG);
    const oldNameHits = await publicSearchHits(originalEnglish);

    console.log("[smoke] verify canonical english_name", afterCanonical[0]);
    console.log("[smoke] GET /public/search old name sample hits", oldNameHits.slice(0, 5));

    const restoreEnglish = place.english_name;
    console.log("[smoke] restore PlacesService.updatePlace", {
        public_id: place.public_id,
        body: { englishName: restoreEnglish ?? null },
    });
    await placesService.updatePlace(
        place.public_id,
        { englishName: restoreEnglish ?? undefined },
        DEV_AUTH_BYPASS_USER,
    );

    await waitForSearchDocument(
        "place",
        entityId,
        (row) =>
            row !== null &&
            !row.display_name?.includes(SMOKE_TAG) &&
            !row.primary_name_en?.includes(SMOKE_TAG),
        "place rename restored in search_documents",
    );

    const restoredDoc = await fetchSearchDocument("place", entityId);

    return {
        place_id: place.id,
        public_id: place.public_id,
        before_document: beforeDoc,
        after_document: afterDoc,
        restored_document: restoredDoc,
        new_name_found_in_search: newNameHits.some((h) => h.includes(place.id)),
        restored: !restoredDoc?.display_name?.includes(SMOKE_TAG),
        pass:
            afterCanonical[0]?.english_name?.includes(SMOKE_TAG) === true &&
            afterDoc !== null &&
            newNameHits.some((h) => h.includes(`place:${place.id}`) || h.includes(place.id)),
    };
}

async function runStopRenameTest(transportService: TransportService): Promise<Record<string, unknown>> {
    const stop = await pickIndexedStop();
    const entityId = BigInt(stop.id);
    const beforeDoc = await fetchSearchDocument("transport_stop", entityId);
    const originalEn = stop.name_en ?? "Stop";
    const renamedEn = `${originalEn} ${SMOKE_TAG}`;

    console.log("\n=== Test 2: transport stop rename ===");
    console.log("[smoke] PATCH service TransportService.updateStop", {
        public_id: stop.public_id,
        body: { name_en: renamedEn },
    });

    await transportService.updateStop(stop.public_id, { name_en: renamedEn });

    const afterCanonical = await prisma.$queryRaw<StopRow[]>`
        SELECT id::text, public_id::text, name_en, name_mm, is_active
        FROM transport.stops WHERE id = ${entityId}
    `;

    const afterDoc = await waitForSearchDocument(
        "transport_stop",
        entityId,
        (row) =>
            row !== null &&
            (row.display_name?.includes(SMOKE_TAG) === true ||
                row.primary_name_en?.includes(SMOKE_TAG) === true ||
                row.searchable_text?.includes(SMOKE_TAG) === true),
        "transport stop rename reflected in search_documents",
    );

    const newNameHits = await publicSearchHits(SMOKE_TAG);

    console.log("[smoke] verify canonical", afterCanonical[0]);
    console.log("[smoke] verify search_documents", afterDoc);
    console.log("[smoke] GET /public/search new tag hits", newNameHits);

    console.log("[smoke] restore TransportService.updateStop", {
        public_id: stop.public_id,
        body: { name_en: originalEn },
    });
    await transportService.updateStop(stop.public_id, { name_en: originalEn });

    await waitForSearchDocument(
        "transport_stop",
        entityId,
        (row) =>
            row !== null && !row.display_name?.includes(SMOKE_TAG) && !row.primary_name_en?.includes(SMOKE_TAG),
        "transport stop rename restored in search_documents",
    );

    const restoredDoc = await fetchSearchDocument("transport_stop", entityId);

    return {
        stop_id: stop.id,
        public_id: stop.public_id,
        before_document: beforeDoc,
        after_document: afterDoc,
        restored_document: restoredDoc,
        new_name_found_in_search: newNameHits.some((h) => h.includes(stop.id)),
        pass:
            afterCanonical[0]?.name_en?.includes(SMOKE_TAG) === true &&
            afterDoc !== null &&
            newNameHits.some((h) => h.includes(`transport_stop:${stop.id}`) || h.includes(stop.id)),
    };
}

async function runDeactivateTest(transportService: TransportService): Promise<Record<string, unknown>> {
    const stop = await pickIndexedStop();
    const entityId = BigInt(stop.id);
    const beforeDoc = await fetchSearchDocument("transport_stop", entityId);

    console.log("\n=== Test 3: deactivate transport stop visibility ===");
    console.log("[smoke] PATCH service TransportService.updateStop", {
        public_id: stop.public_id,
        body: { is_active: false },
    });

    await transportService.updateStop(stop.public_id, { is_active: false });

    const afterCanonical = await prisma.$queryRaw<StopRow[]>`
        SELECT id::text, public_id::text, name_en, name_mm, is_active
        FROM transport.stops WHERE id = ${entityId}
    `;

    const afterDoc = await waitForSearchDocument(
        "transport_stop",
        entityId,
        (row) => row === null || row.is_active === false || row.is_public === false,
        "transport stop removed or inactive in search_documents",
    );

    const nameQuery = stop.name_en ?? stop.name_mm ?? "stop";
    const hitsAfterDeactivate = await publicSearchHits(nameQuery);

    console.log("[smoke] verify canonical is_active=false", afterCanonical[0]);
    console.log("[smoke] verify search_documents", afterDoc);
    console.log("[smoke] GET /public/search hits for stop name (should not include id)", hitsAfterDeactivate);

    console.log("[smoke] restore TransportService.updateStop", {
        public_id: stop.public_id,
        body: { is_active: true },
    });
    await transportService.updateStop(stop.public_id, { is_active: true });

    const restoredDoc = await waitForSearchDocument(
        "transport_stop",
        entityId,
        (row) => row !== null && row.is_active === true && row.is_public === true,
        "transport stop reactivated in search_documents",
    );

    const hitsAfterRestore = await publicSearchHits(nameQuery);

    return {
        stop_id: stop.id,
        public_id: stop.public_id,
        before_document: beforeDoc,
        after_document: afterDoc,
        restored_document: restoredDoc,
        still_in_search_after_deactivate: hitsAfterDeactivate.some((h) => h.includes(stop.id)),
        back_in_search_after_restore: hitsAfterRestore.some((h) => h.includes(stop.id)),
        pass:
            afterCanonical[0]?.is_active === false &&
            (afterDoc === null || afterDoc.is_active === false) &&
            !hitsAfterDeactivate.some((h) => h.includes(stop.id)) &&
            restoredDoc !== null &&
            restoredDoc.is_active === true,
    };
}

async function main(): Promise<void> {
    assertSafeDatabaseUrl();

    const placesService = new PlacesService(
        new PlacesRepository(prisma),
        new EntityAdminAreaService(new EntityAdminAreaRepository(prisma)),
        { prisma },
    );
    const transportService = new TransportService(prisma);

    const results: Record<string, unknown> = {};

    try {
        results.place_rename = await runPlaceRenameTest(placesService);
        results.stop_rename = await runStopRenameTest(transportService);
        results.deactivate = await runDeactivateTest(transportService);
    } catch (err) {
        console.error("[smoke] FAILED:", err);
        process.exitCode = 1;
    }

    console.log("\n=== Summary ===");
    console.log(JSON.stringify(results, null, 2));

    console.log("\n[smoke] running search:health...");
    const { execSync } = await import("node:child_process");
    execSync("npm run search:health", { cwd: apiRoot, stdio: "inherit" });

    const allPass =
        results.place_rename &&
        (results.place_rename as { pass?: boolean }).pass &&
        results.stop_rename &&
        (results.stop_rename as { pass?: boolean }).pass &&
        results.deactivate &&
        (results.deactivate as { pass?: boolean }).pass;

    if (!allPass) {
        process.exitCode = 1;
    }
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

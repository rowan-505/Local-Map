#!/usr/bin/env node
/**
 * Import-review direct PATCH persistence smoke test (diagnostic).
 *
 * Proves PATCH /api/import-review/:family/:id writes typed columns (API + optional DB).
 * Two passes:
 *   SIMPLE_FIELD_PERSISTENCE — name_en / name_mm / class_code smoke strings
 *   REFERENCE_FIELD_PERSISTENCE — dropdown/FK fields (category_id, building_type_id, …)
 * Does not call /overrides. Does not stop on stale PATCH response — runs GET + DB checks.
 *
 * Usage:
 *   API_BASE_URL=http://localhost:3001 ADMIN_TOKEN=... DATABASE_URL=... \
 *     node apps/api/scripts/smoke-import-review-direct-patch-persistence.mjs
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFromRoot = createRequire(path.join(__dirname, "../../../package.json"));

const API_BASE_URL = (process.env.API_BASE_URL ?? "http://localhost:3001").replace(/\/+$/, "");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "__SET_ADMIN_TOKEN__";
const REVIEW_BATCH_ID = Number.parseInt(process.env.REVIEW_BATCH_ID ?? "2", 10);
const DATABASE_URL = process.env.DATABASE_URL?.trim() || null;

const TOKEN_PLACEHOLDER = "__SET_ADMIN_TOKEN__";
const IMPORT_REVIEW_ADMIN_TOKEN_HEADER = "x-import-review-admin-token";

/** Fallback from migration 024 irr_rce_edit_type_chk; overridden after DB introspection. */
let DIRECT_EDIT_AUDIT_TYPES = ["override_update"];
let DIRECT_EDIT_AUDIT_TYPE = "override_update";

const FAMILIES = [
    "buildings",
    "places",
    "roads",
    "landuse",
    "water_lines",
    "water_polygons",
    "admin_areas",
    "routing_barriers",
];

/** @type {Record<string, { table: string; candidateTable: string }>} */
const FAMILY_DB = {
    buildings: { table: "building_candidates", candidateTable: "building_candidates" },
    places: { table: "place_candidates", candidateTable: "place_candidates" },
    roads: { table: "road_candidates", candidateTable: "road_candidates" },
    landuse: { table: "land_area_candidates", candidateTable: "land_area_candidates" },
    water_lines: { table: "water_line_candidates", candidateTable: "water_line_candidates" },
    water_polygons: { table: "water_polygon_candidates", candidateTable: "water_polygon_candidates" },
    admin_areas: { table: "admin_area_candidates", candidateTable: "admin_area_candidates" },
    routing_barriers: { table: "routing_barrier_candidates", candidateTable: "routing_barrier_candidates" },
};

/** API maps typed name columns to derived bilingual fields (see applyBilingualNameFields). */
const BILINGUAL_NAME_API_FAMILIES = new Set([
    "buildings",
    "places",
    "roads",
    "landuse",
    "water_lines",
    "water_polygons",
    "admin_areas",
]);

function log(msg) {
    // eslint-disable-next-line no-console
    console.log(msg);
}

function fail(msg) {
    // eslint-disable-next-line no-console
    console.error(msg);
}

function buildHeaders() {
    return {
        Accept: "application/json",
        "Content-Type": "application/json",
        [IMPORT_REVIEW_ADMIN_TOKEN_HEADER]: ADMIN_TOKEN,
    };
}

function ensureTruthy(value, message) {
    if (!value) {
        throw new Error(message);
    }
    return value;
}

function stableJson(value) {
    if (value === undefined) {
        return "__undefined__";
    }
    return JSON.stringify(value);
}

function checkStatus(pass) {
    return pass ? "PASS" : "FAIL";
}

function readApiFieldValue(item, field) {
    if (!item || typeof item !== "object") {
        return null;
    }
    if (field === "road_class_id") {
        const direct = item.road_class_id;
        if (direct !== null && direct !== undefined && String(direct).trim() !== "") {
            return direct;
        }
        return item.road_candidate_road_class_id ?? null;
    }
    if (field === "admin_level_id") {
        const direct = item.admin_level_id;
        if (direct !== null && direct !== undefined && String(direct).trim() !== "") {
            return direct;
        }
        return item.effective_admin_level_id ?? null;
    }
    if (field === "land_area_class_id") {
        const direct = item.land_area_class_id;
        if (direct !== null && direct !== undefined && String(direct).trim() !== "") {
            return direct;
        }
        return item.effective_land_area_class_id ?? null;
    }
    return item[field];
}

function fieldMatches(item, field, expected) {
    if (!item || typeof item !== "object") {
        return { pass: false, actual: null };
    }
    const actual = readApiFieldValue(item, field);
    const pass = String(actual) === String(expected);
    return { pass, actual };
}

function coerceJsonFieldValue(value) {
    if (value === null || value === undefined) {
        return undefined;
    }
    if (typeof value === "bigint") {
        return value.toString();
    }
    return value;
}

function apiNameDiagnostics(item, field) {
    if (!item || typeof item !== "object") {
        return {};
    }
    return {
        [field]: item[field] ?? null,
        effective_name_en: item.effective_name_en ?? null,
        effective_name_mm: item.effective_name_mm ?? null,
        overridden_fields: item.overridden_fields ?? null,
    };
}

function evaluatePersistencePass(checks, hasDb) {
    if (!checks.patch_http_status.pass) {
        return false;
    }
    if (!hasDb) {
        return (
            checks.patch_response_field.pass &&
            checks.get_detail_field.pass &&
            (checks.review_overrides_unchanged.pass || checks.review_overrides_unchanged.skipped)
        );
    }
    return (
        checks.db_column_field.pass &&
        (checks.db_audit.pass || checks.db_audit.skipped) &&
        (checks.review_overrides_unchanged.pass || checks.review_overrides_unchanged.skipped)
    );
}

function evaluateApiMappingPass(checks) {
    return checks.patch_response_field.pass && checks.get_detail_field.pass;
}

function makeTestValue() {
    return `smoke-test-${Date.now()}`;
}

async function readJsonResponse(resp) {
    const rawText = await resp.text();
    if (rawText.includes("Do not know how to serialize a BigInt")) {
        throw new Error("Response contains BigInt serialization runtime error");
    }

    let json = null;
    if (rawText.trim() !== "") {
        try {
            json = JSON.parse(rawText);
        } catch {
            throw new Error(`Non-JSON response body: ${rawText.slice(0, 500)}`);
        }
    }

    return { rawText, json };
}

async function apiGet(path, searchParams = {}) {
    const url = new URL(`${API_BASE_URL}${path}`);
    Object.entries(searchParams).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
            url.searchParams.set(key, String(value));
        }
    });

    const resp = await fetch(url, {
        method: "GET",
        headers: buildHeaders(),
    });

    const payload = await readJsonResponse(resp);
    return { resp, ...payload, url: url.toString() };
}

async function apiPatch(path, body) {
    const url = `${API_BASE_URL}${path}`;
    const resp = await fetch(url, {
        method: "PATCH",
        headers: buildHeaders(),
        body: JSON.stringify(body),
    });
    const payload = await readJsonResponse(resp);
    return { resp, ...payload, url };
}

function getCandidateId(item) {
    const id = item?.id;
    if (typeof id === "string" || typeof id === "number" || typeof id === "bigint") {
        return String(id);
    }
    throw new Error("Candidate id missing in response");
}

function buildPatchField(family, item) {
    if (family === "routing_barriers") {
        return { field: "class_code" };
    }

    const hasNameEn = typeof item.name_en === "string" && item.name_en.trim() !== "";
    const hasNameMm = typeof item.name_mm === "string" && item.name_mm.trim() !== "";

    if (hasNameEn || (!hasNameMm && !hasNameEn)) {
        return { field: "name_en" };
    }

    return { field: "name_mm" };
}

function applyRequiredFieldPreservation(family, item, fields, options = {}) {
    const { patchField = null } = options;
    const preserved = { ...fields };

    const preserveNameMm = () => {
        const nameMm = coerceJsonFieldValue(item.name_mm);
        if (nameMm !== undefined && nameMm !== "") {
            preserved.name_mm = nameMm;
        }
    };
    const preserveNameEn = () => {
        const nameEn = coerceJsonFieldValue(item.name_en);
        if (nameEn !== undefined && nameEn !== "" && !Object.prototype.hasOwnProperty.call(preserved, "name_en")) {
            preserved.name_en = nameEn;
        }
    };

    if (family === "landuse") {
        preserveNameMm();
        preserveNameEn();
        if (patchField !== "land_area_class_id" && item.land_area_class_id != null) {
            preserved.land_area_class_id = coerceJsonFieldValue(item.land_area_class_id);
        }
        if (patchField !== "class_code" && typeof item.class_code === "string" && item.class_code.trim() !== "") {
            preserved.class_code = item.class_code;
        }
    }

    if (family === "places") {
        preserveNameMm();
        preserveNameEn();
        if (patchField !== "category_id") {
            const categoryId = coerceJsonFieldValue(item.category_id);
            if (categoryId !== undefined) {
                preserved.category_id = categoryId;
            }
        }
        if (patchField !== "admin_area_id") {
            const adminAreaId = coerceJsonFieldValue(item.admin_area_id);
            if (adminAreaId !== undefined) {
                preserved.admin_area_id = adminAreaId;
            }
        }
    }

    if (family === "buildings") {
        preserveNameMm();
        preserveNameEn();
        if (patchField !== "building_type_id") {
            const buildingTypeId = coerceJsonFieldValue(item.building_type_id);
            if (buildingTypeId !== undefined) {
                preserved.building_type_id = buildingTypeId;
            }
        }
        const adminAreaId = coerceJsonFieldValue(item.admin_area_id);
        if (adminAreaId !== undefined) {
            preserved.admin_area_id = adminAreaId;
        }
    }

    if (family === "roads") {
        preserveNameMm();
        preserveNameEn();
        if (patchField !== "road_class_id") {
            const roadClassId =
                coerceJsonFieldValue(item.road_class_id) ??
                coerceJsonFieldValue(item.road_candidate_road_class_id);
            if (roadClassId !== undefined) {
                preserved.road_class_id = roadClassId;
            }
        }
    }

    if (family === "admin_areas") {
        preserveNameMm();
        preserveNameEn();
        if (patchField !== "admin_level_id") {
            const adminLevelId = coerceJsonFieldValue(item.admin_level_id);
            if (adminLevelId !== undefined) {
                preserved.admin_level_id = adminLevelId;
            }
        }
    }

    if (family === "routing_barriers") {
        if (patchField !== "class_code" && typeof item.class_code === "string" && item.class_code.trim() !== "") {
            preserved.class_code = item.class_code;
        }
        if (patchField !== "barrier_type") {
            const barrierType = coerceJsonFieldValue(item.barrier_type);
            if (barrierType !== undefined && String(barrierType).trim() !== "") {
                preserved.barrier_type = barrierType;
            }
        }
        const adminAreaId = coerceJsonFieldValue(item.admin_area_id);
        if (adminAreaId !== undefined) {
            preserved.admin_area_id = adminAreaId;
        }
    }

    return preserved;
}

function reviewOverridesUnchanged(beforeOverrides, afterOverrides) {
    if (beforeOverrides === undefined && afterOverrides === undefined) {
        return { pass: true, skipped: true, note: "field absent in response" };
    }
    const pass = stableJson(beforeOverrides) === stableJson(afterOverrides);
    return { pass, skipped: false, before: beforeOverrides, after: afterOverrides };
}

function classifyFailure(checks) {
    if (checks.patch_http_status?.pass === false) {
        return "VALIDATION_FAILED";
    }

    const dbSkipped = checks.db_column_field?.skipped === true;
    const dbOk = checks.db_column_field?.pass === true;
    const patchOk = checks.patch_response_field?.pass === true;
    const detailOk = checks.get_detail_field?.pass === true;
    const auditOk = checks.db_audit?.pass === true;
    const auditSkipped = checks.db_audit?.skipped === true;

    if (dbSkipped) {
        if (patchOk && detailOk) {
            return "OK_API_ONLY";
        }
        if (!patchOk) {
            return "API_RESPONSE_STALE";
        }
        if (!detailOk) {
            return "DETAIL_RESPONSE_STALE";
        }
        return "MIXED";
    }

    if (!dbOk) {
        return "API_UPDATE_FAILED";
    }

    if (!patchOk) {
        return "API_RESPONSE_STALE";
    }

    if (!detailOk) {
        return "DETAIL_RESPONSE_STALE";
    }

    if (!auditSkipped && !auditOk) {
        return "AUDIT_FAILED";
    }

    return "OK";
}

async function queryPlaceEssentialsRow(client, candidateId) {
    const result = await client.query(
        `
        select
            name_mm,
            name_en,
            category_id,
            admin_area_id,
            (point_geom is not null and not st_isempty(point_geom)) as has_geometry
        from import_review.place_candidates
        where id = $1::bigint
          and review_batch_id = $2
        limit 1
        `,
        [candidateId, REVIEW_BATCH_ID]
    );
    return result.rows[0] ?? null;
}

async function fetchOneCandidate(family, dbClient) {
    const listLimit = family === "places" ? 30 : 1;
    const { resp, json, url } = await apiGet(`/api/import-review/${family}`, {
        review_batch_id: REVIEW_BATCH_ID,
        limit: listLimit,
        offset: 0,
        include_geometry: false,
    });

    if (resp.status < 200 || resp.status >= 300) {
        throw new Error(`${family} list failed: HTTP ${resp.status} (${url})`);
    }
    ensureTruthy(json && Array.isArray(json.items), `${family} list response missing items[] (${url})`);

    if (family === "places" && dbClient) {
        for (const candidate of json.items) {
            const candidateId = getCandidateId(candidate);
            const essentials = await queryPlaceEssentialsRow(dbClient, candidateId);
            if (
                essentials &&
                essentials.category_id != null &&
                essentials.admin_area_id != null &&
                essentials.has_geometry
            ) {
                return { listItem: candidate, dbContext: essentials };
            }
        }
        throw new Error(
            `${family}: no candidate in review_batch_id=${REVIEW_BATCH_ID} with category_id, admin_area_id, and geometry (checked ${json.items.length} rows)`
        );
    }

    const candidate = json.items[0];
    if (!candidate) {
        throw new Error(`${family} has no candidates in review_batch_id=${REVIEW_BATCH_ID}`);
    }
    return { listItem: candidate, dbContext: null };
}

async function fetchCandidateDetail(family, candidateId) {
    const detail = await apiGet(`/api/import-review/${family}/${candidateId}`, {
        review_batch_id: REVIEW_BATCH_ID,
        include_geometry: false,
    });
    return detail;
}

async function createDbClient() {
    if (!DATABASE_URL) {
        return null;
    }
    let PgClient;
    try {
        PgClient = requireFromRoot("pg").Client;
    } catch (err) {
        throw new Error(
            `DATABASE_URL is set but pg could not be loaded: ${err instanceof Error ? err.message : String(err)}`
        );
    }
    const client = new PgClient({ connectionString: DATABASE_URL });
    await client.connect();
    return client;
}

async function loadDirectEditAuditTypes(client) {
    if (!client) {
        return;
    }
    try {
        const result = await client.query(`
            select pg_get_constraintdef(c.oid) as def
            from pg_constraint c
            join pg_class t on t.oid = c.conrelid
            join pg_namespace n on n.oid = t.relnamespace
            where n.nspname = 'import_review'
              and t.relname = 'review_candidate_edits'
              and c.conname = 'irr_rce_edit_type_chk'
            limit 1
        `);
        const def = result.rows[0]?.def;
        if (typeof def === "string") {
            const quoted = [...def.matchAll(/'([^']+)'/g)].map((m) => m[1]);
            if (quoted.length > 0) {
                DIRECT_EDIT_AUDIT_TYPES = quoted;
            }
        }
    } catch {
        // keep migration fallback
    }

    if (DIRECT_EDIT_AUDIT_TYPES.includes("override_update")) {
        DIRECT_EDIT_AUDIT_TYPE = "override_update";
    } else if (DIRECT_EDIT_AUDIT_TYPES.length > 0) {
        DIRECT_EDIT_AUDIT_TYPE = DIRECT_EDIT_AUDIT_TYPES[0];
    }

    log(`DB edit_type constraint allows: ${DIRECT_EDIT_AUDIT_TYPES.join(", ")}`);
    log(`Using direct-edit audit edit_type: ${DIRECT_EDIT_AUDIT_TYPE}`);
}

async function dbColumnExists(client, tableName, columnName) {
    const result = await client.query(
        `
        select 1
        from information_schema.columns
        where table_schema = 'import_review'
          and table_name = $1
          and column_name = $2
        limit 1
        `,
        [tableName, columnName]
    );
    return result.rowCount > 0;
}

async function regclassExists(client, qualifiedName) {
    const result = await client.query(`SELECT to_regclass($1::text) IS NOT NULL AS ok`, [qualifiedName]);
    return result.rows[0]?.ok === true;
}

/** Pick a ref row id, preferring one different from currentValue when possible. */
async function pickRefId(client, sql, currentValue) {
    const result = await client.query(sql);
    if (result.rowCount === 0) {
        return null;
    }
    const current = currentValue === null || currentValue === undefined ? null : String(currentValue);
    const alt = result.rows.find((row) => String(row.id) !== current);
    return String((alt ?? result.rows[0]).id);
}

async function fetchPlaceCandidateForReference(client) {
    const result = await client.query(
        `
        select id::text as id
        from import_review.place_candidates
        where review_batch_id = $1
          and point_geom is not null
          and not st_isempty(point_geom)
          and (
            nullif(trim(coalesce(name_mm, '')), '') is not null
            or nullif(trim(coalesce(name_en, '')), '') is not null
          )
        order by id
        limit 1
        `,
        [REVIEW_BATCH_ID]
    );
    return result.rows[0]?.id ?? null;
}

async function fetchCandidateForReferenceTest(family, dbClient) {
    if (family === "places" && dbClient) {
        const placeId = await fetchPlaceCandidateForReference(dbClient);
        if (!placeId) {
            throw new Error(
                `${family}: no place candidate with geometry and name_mm/name_en in review_batch_id=${REVIEW_BATCH_ID}`
            );
        }
        const detail = await apiGet(`/api/import-review/places/${placeId}`, {
            review_batch_id: REVIEW_BATCH_ID,
            include_geometry: false,
        });
        if (detail.resp.status < 200 || detail.resp.status >= 300) {
            throw new Error(`places detail failed: HTTP ${detail.resp.status}`);
        }
        const essentials = await queryPlaceEssentialsRow(dbClient, placeId);
        return {
            listItem: detail.json,
            dbContext: essentials,
            candidateId: placeId,
        };
    }

    const { listItem, dbContext } = await fetchOneCandidate(family, dbClient);
    return { listItem, dbContext, candidateId: getCandidateId(listItem) };
}

/**
 * Reference-field direct PATCH cases (dropdown / FK columns).
 * @type {Array<{
 *   id: string;
 *   family: string;
 *   field: string;
 *   kind: "ref_id" | "string";
 *   refSql?: string;
 *   refTable?: string;
 *   requiresDb?: boolean;
 * }>}
 */
const REFERENCE_FIELD_TESTS = [
    {
        id: "places.category_id",
        family: "places",
        field: "category_id",
        kind: "ref_id",
        refTable: "ref.ref_poi_categories",
        refSql: `
            select id::text as id
            from ref.ref_poi_categories
            order by sort_order nulls last, id
            limit 20
        `,
        requiresDb: true,
    },
    {
        id: "places.admin_area_id",
        family: "places",
        field: "admin_area_id",
        kind: "ref_id",
        refTable: "core.core_admin_areas",
        refSql: `
            select id::text as id
            from core.core_admin_areas
            where is_active = true
            order by id
            limit 20
        `,
        requiresDb: true,
    },
    {
        id: "buildings.building_type_id",
        family: "buildings",
        field: "building_type_id",
        kind: "ref_id",
        refTable: "ref.ref_building_types",
        refSql: `
            select id::text as id
            from ref.ref_building_types
            where is_active = true
              and parent_id is null
            order by sort_order nulls last, id
            limit 20
        `,
        requiresDb: true,
    },
    {
        id: "roads.road_class_id",
        family: "roads",
        field: "road_class_id",
        kind: "ref_id",
        refTable: "ref.ref_road_classes",
        refSql: `
            select id::text as id
            from ref.ref_road_classes
            order by id
            limit 20
        `,
        requiresDb: true,
    },
    {
        id: "landuse.land_area_class_id",
        family: "landuse",
        field: "land_area_class_id",
        kind: "ref_id",
        refTable: "ref.ref_land_area_classes",
        refSql: `
            select id::text as id
            from ref.ref_land_area_classes
            where is_active = true
            order by sort_order nulls last, id
            limit 20
        `,
        requiresDb: true,
    },
    {
        id: "admin_areas.admin_level_id",
        family: "admin_areas",
        field: "admin_level_id",
        kind: "ref_id",
        refTable: "ref.ref_admin_levels",
        refSql: `
            select id::text as id
            from ref.ref_admin_levels
            order by id
            limit 20
        `,
        requiresDb: true,
    },
    {
        id: "routing_barriers.class_code",
        family: "routing_barriers",
        field: "class_code",
        kind: "string",
        requiresDb: false,
    },
];

async function resolveReferenceTestValue(test, beforeDetail, dbClient) {
    if (test.kind === "string") {
        return makeTestValue();
    }
    if (!dbClient) {
        throw new Error(`${test.id}: DATABASE_URL required to resolve ${test.refTable}`);
    }
    if (test.refTable && !(await regclassExists(dbClient, test.refTable))) {
        return { skip: true, reason: `${test.refTable} not present` };
    }
    const current = beforeDetail[test.field] ?? null;
    const id = await pickRefId(dbClient, test.refSql, current);
    if (!id) {
        throw new Error(`${test.id}: no rows in ${test.refTable}`);
    }
    return { skip: false, testValue: id };
}

async function queryCandidateRow(client, familyMeta, candidateId, field) {
    const columns = ["id", field, "updated_at", "review_batch_id"];
    const hasOverrides = await dbColumnExists(client, familyMeta.table, "review_overrides");
    if (hasOverrides) {
        columns.push("review_overrides");
    }

    const sql = `
        select ${columns.map((c) => `"${c}"`).join(", ")}
        from import_review.${familyMeta.table}
        where id = $1::bigint
        limit 1
    `;
    const result = await client.query(sql, [candidateId]);
    if (result.rowCount === 0) {
        return { row: null, hasOverrides };
    }
    return { row: result.rows[0], hasOverrides };
}

async function queryLatestEdit(client, familyMeta, candidateId) {
    const result = await client.query(
        `
        select id, edit_type, created_at, before_data, after_data
        from import_review.review_candidate_edits
        where candidate_table = $1
          and candidate_id = $2::bigint
        order by created_at desc, id desc
        limit 1
        `,
        [familyMeta.candidateTable, candidateId]
    );
    return result.rows[0] ?? null;
}

function printCheckLine(label, check) {
    if (!check) {
        log(`    ${label}: SKIP`);
        return;
    }
    if (check.skipped) {
        log(`    ${label}: SKIP (${check.note ?? "n/a"})`);
        return;
    }
    const extra =
        check.actual !== undefined
            ? ` actual=${JSON.stringify(check.actual)} expected=${JSON.stringify(check.expected)}`
            : check.note
              ? ` (${check.note})`
              : "";
    log(`    ${label}: ${checkStatus(check.pass)}${extra}`);
}

async function smokeFamilyFieldPersistence({
    family,
    field,
    testValue,
    dbClient,
    candidateId,
    beforeDetail,
    patchContext,
    passLabel = "SIMPLE_FIELD_PERSISTENCE",
    testId = family,
}) {
    const familyMeta = FAMILY_DB[family];
    const beforeValue = beforeDetail[field];
    const beforeOverrides =
        "review_overrides" in beforeDetail ? beforeDetail.review_overrides : undefined;

    const fields = applyRequiredFieldPreservation(family, patchContext, { [field]: testValue }, {
        patchField: field,
    });

    const patchBody = {
        review_batch_id: REVIEW_BATCH_ID,
        latest: false,
        fields,
        review_note: `Smoke ${passLabel} ${testId} ${field}=${testValue}`,
    };

    const patchPath = `/api/import-review/${family}/${candidateId}`;
    if (patchPath.includes("/overrides")) {
        throw new Error("Smoke test must not use /overrides path");
    }

    const patchResult = await apiPatch(patchPath, patchBody);
    const patch2xx = patchResult.resp.status >= 200 && patchResult.resp.status < 300;

    const checks = {
        patch_http_status: {
            pass: patch2xx,
            status: patchResult.resp.status,
            expected: "2xx",
        },
        patch_response_field: { pass: false, skipped: true, note: "PATCH not 2xx" },
        get_detail_field: { pass: false, skipped: true, note: "pending" },
        db_column_field: { pass: false, skipped: !dbClient, note: dbClient ? "pending" : "DATABASE_URL unset" },
        db_audit: { pass: false, skipped: !dbClient, note: dbClient ? "pending" : "DATABASE_URL unset" },
        review_overrides_unchanged: { pass: true, skipped: true, note: "pending" },
    };

    let patchJson = null;
    if (patch2xx && patchResult.json && typeof patchResult.json === "object") {
        patchJson = patchResult.json;
        const patchField = fieldMatches(patchJson, field, testValue);
        checks.patch_response_field = {
            pass: patchField.pass,
            skipped: false,
            actual: patchField.actual,
            expected: testValue,
        };

        const overridesCheck = reviewOverridesUnchanged(
            beforeOverrides,
            "review_overrides" in patchJson ? patchJson.review_overrides : undefined
        );
        if (!overridesCheck.skipped) {
            checks.review_overrides_unchanged = {
                pass: overridesCheck.pass,
                skipped: false,
                note: "PATCH response review_overrides",
            };
        }
    } else if (!patch2xx) {
        checks.patch_response_field = {
            pass: false,
            skipped: false,
            note: `HTTP ${patchResult.resp.status}`,
            body: patchResult.json ?? patchResult.rawText?.slice(0, 300),
        };
        if (family === "places" && patchResult.json && typeof patchResult.json === "object") {
            checks.patch_response_field.error =
                patchResult.json.message ?? patchResult.json.error ?? null;
            checks.patch_response_field.details = patchResult.json.details ?? null;
        }
    }

    let afterDetail = null;
    let afterDetailResult = null;
    try {
        afterDetailResult = await fetchCandidateDetail(family, candidateId);
        if (afterDetailResult.resp.status >= 200 && afterDetailResult.resp.status < 300) {
            afterDetail =
                afterDetailResult.json && typeof afterDetailResult.json === "object"
                    ? afterDetailResult.json
                    : null;
            const detailField = fieldMatches(afterDetail, field, testValue);
            checks.get_detail_field = {
                pass: detailField.pass,
                skipped: false,
                actual: detailField.actual,
                expected: testValue,
            };

            if (afterDetail && "review_overrides" in afterDetail) {
                const detailOverrides = reviewOverridesUnchanged(
                    beforeOverrides,
                    afterDetail.review_overrides
                );
                if (!detailOverrides.skipped) {
                    const merged = {
                        pass: checks.review_overrides_unchanged.pass && detailOverrides.pass,
                        skipped: false,
                        note: "PATCH response + GET detail review_overrides",
                    };
                    checks.review_overrides_unchanged = merged;
                }
            }
        } else {
            checks.get_detail_field = {
                pass: false,
                skipped: false,
                note: `GET detail HTTP ${afterDetailResult.resp.status}`,
            };
        }
    } catch (err) {
        checks.get_detail_field = {
            pass: false,
            skipped: false,
            note: err instanceof Error ? err.message : String(err),
        };
    }

    let dbRow = null;
    if (dbClient) {
        const { row, hasOverrides } = await queryCandidateRow(dbClient, familyMeta, candidateId, field);
        dbRow = row;
        if (!row) {
            checks.db_column_field = {
                pass: false,
                skipped: false,
                note: `row not found in import_review.${familyMeta.table}`,
            };
        } else {
            const dbValue = row[field];
            checks.db_column_field = {
                pass: String(dbValue) === String(testValue),
                skipped: false,
                actual: dbValue,
                expected: testValue,
                before: beforeValue,
                updated_at: row.updated_at,
            };

            if (hasOverrides) {
                const dbOverrides = reviewOverridesUnchanged(beforeOverrides, row.review_overrides);
                checks.review_overrides_unchanged = {
                    pass: dbOverrides.pass,
                    skipped: false,
                    note: "DB review_overrides",
                };
            } else {
                checks.review_overrides_unchanged = {
                    pass: true,
                    skipped: true,
                    note: "review_overrides column absent (post-084)",
                };
            }
        }

        if (!patch2xx) {
            checks.db_audit = {
                pass: false,
                skipped: true,
                note: "PATCH not 2xx — skipping audit assertion for this run",
            };
        }

        const latestEdit = await queryLatestEdit(dbClient, familyMeta, candidateId);
        if (!patch2xx) {
            // already set
        } else if (!latestEdit) {
            checks.db_audit = {
                pass: false,
                skipped: false,
                note: "no review_candidate_edits row",
            };
        } else {
            const typeOk = latestEdit.edit_type === DIRECT_EDIT_AUDIT_TYPE;
            const afterData = latestEdit.after_data;
            const afterField =
                afterData && typeof afterData === "object" && field in afterData
                    ? afterData[field]
                    : null;
            const fieldOk =
                afterField === null || String(afterField) === String(testValue);
            checks.db_audit = {
                pass: typeOk && fieldOk,
                skipped: false,
                edit_type: latestEdit.edit_type,
                expected_edit_type: DIRECT_EDIT_AUDIT_TYPE,
                after_data_field: afterField,
                edit_id: latestEdit.id,
            };
        }
    }

    const classification = classifyFailure(checks);
    const hasDb = Boolean(dbClient);
    const persistencePass = evaluatePersistencePass(checks, hasDb);
    const apiMappingPass = evaluateApiMappingPass(checks);
    const apiMappingExpectedStale =
        BILINGUAL_NAME_API_FAMILIES.has(family) &&
        (field === "name_en" || field === "name_mm") &&
        persistencePass &&
        !apiMappingPass;

    log("");
    log(`=== [${passLabel}] ${testId} (id=${candidateId}) ===`);
    log(`  patch field: ${field} -> ${testValue} (before: ${JSON.stringify(beforeValue)})`);
    log(`  classification: ${classification}`);
    printCheckLine("patch_http_status", checks.patch_http_status);
    printCheckLine("patch_response_field", checks.patch_response_field);
    printCheckLine("get_detail_field", checks.get_detail_field);
    printCheckLine("db_column_field", checks.db_column_field);
    printCheckLine("db_audit", checks.db_audit);
    printCheckLine("review_overrides_unchanged", checks.review_overrides_unchanged);
    log(
        `  PATCH response keys (${patchJson ? Object.keys(patchJson).length : 0}): ${
            patchJson ? Object.keys(patchJson).sort().join(", ") : "(none)"
        }`
    );
    log(
        `  GET detail keys (${afterDetail ? Object.keys(afterDetail).length : 0}): ${
            afterDetail ? Object.keys(afterDetail).sort().join(", ") : "(none)"
        }`
    );
    if (dbRow) {
        log(`  DB row: ${JSON.stringify(dbRow)}`);
    } else if (dbClient) {
        log("  DB row: (not found)");
    }
    if (BILINGUAL_NAME_API_FAMILIES.has(family) && (field === "name_en" || field === "name_mm")) {
        log(`  API name diagnostics (PATCH): ${JSON.stringify(apiNameDiagnostics(patchJson, field))}`);
        log(`  API name diagnostics (GET):  ${JSON.stringify(apiNameDiagnostics(afterDetail, field))}`);
    }
    log(`  PERSISTENCE: ${persistencePass ? "PASS" : "FAIL"} (typed column + audit; DB is source of truth)`);
    log(
        `  API_MAPPING: ${apiMappingPass ? "PASS" : apiMappingExpectedStale ? "WARN (derived name fields; expected)" : "FAIL"}`
    );
    log(`  FAMILY RESULT: ${persistencePass ? "PASS" : "FAIL"}`);

    return {
        passLabel,
        testId,
        family,
        candidateId,
        field,
        testValue,
        beforeValue,
        classification,
        checks,
        persistencePass,
        apiMappingPass,
        apiMappingExpectedStale,
        patchKeys: patchJson ? Object.keys(patchJson) : [],
        detailKeys: afterDetail ? Object.keys(afterDetail) : [],
    };
}

async function smokeFamilyPersistence(family, dbClient) {
    const { listItem, dbContext } = await fetchOneCandidate(family, dbClient);
    const candidateId = getCandidateId(listItem);

    const beforeDetailResult = await fetchCandidateDetail(family, candidateId);
    const beforeDetail =
        beforeDetailResult.json && typeof beforeDetailResult.json === "object"
            ? beforeDetailResult.json
            : {};

    const patchContext =
        dbContext !== null
            ? {
                  ...beforeDetail,
                  ...dbContext,
                  category_id: coerceJsonFieldValue(dbContext.category_id),
                  admin_area_id: coerceJsonFieldValue(dbContext.admin_area_id),
                  name_mm: dbContext.name_mm ?? beforeDetail.name_mm,
                  name_en: dbContext.name_en ?? beforeDetail.name_en,
              }
            : beforeDetail;

    const { field } = buildPatchField(family, patchContext);
    const testValue = makeTestValue();

    return smokeFamilyFieldPersistence({
        family,
        field,
        testValue,
        dbClient,
        candidateId,
        beforeDetail,
        patchContext,
        passLabel: "SIMPLE_FIELD_PERSISTENCE",
        testId: family,
    });
}

async function smokeReferenceFieldTest(test, dbClient) {
    if (test.requiresDb && !dbClient) {
        return {
            passLabel: "REFERENCE_FIELD_PERSISTENCE",
            testId: test.id,
            family: test.family,
            skipped: true,
            persistencePass: false,
            error: "DATABASE_URL unset (required for reference id lookup)",
            classification: "SETUP_SKIPPED",
        };
    }

    const { listItem, dbContext, candidateId } = await fetchCandidateForReferenceTest(test.family, dbClient);

    const beforeDetailResult = await fetchCandidateDetail(test.family, candidateId);
    const beforeDetail =
        beforeDetailResult.json && typeof beforeDetailResult.json === "object"
            ? { ...beforeDetailResult.json, ...(listItem ?? {}) }
            : { ...(listItem ?? {}) };

    const patchContext =
        dbContext !== null
            ? {
                  ...beforeDetail,
                  ...dbContext,
                  category_id: coerceJsonFieldValue(dbContext.category_id ?? beforeDetail.category_id),
                  admin_area_id: coerceJsonFieldValue(dbContext.admin_area_id ?? beforeDetail.admin_area_id),
                  name_mm: dbContext.name_mm ?? beforeDetail.name_mm,
                  name_en: dbContext.name_en ?? beforeDetail.name_en,
              }
            : beforeDetail;

    const resolved = await resolveReferenceTestValue(test, beforeDetail, dbClient);
    if (resolved.skip) {
        return {
            passLabel: "REFERENCE_FIELD_PERSISTENCE",
            testId: test.id,
            family: test.family,
            skipped: true,
            persistencePass: true,
            classification: "SKIPPED",
            error: resolved.reason,
        };
    }

    const testValue =
        test.kind === "ref_id" ? resolved.testValue : String(resolved.testValue ?? makeTestValue());

    return smokeFamilyFieldPersistence({
        family: test.family,
        field: test.field,
        testValue,
        dbClient,
        candidateId,
        beforeDetail,
        patchContext,
        passLabel: "REFERENCE_FIELD_PERSISTENCE",
        testId: test.id,
    });
}

function printPassSummary(title, rows) {
    log("");
    log(`======== ${title} ========`);
    let failures = 0;
    let skipped = 0;
    for (const row of rows) {
        if (row.skipped) {
            skipped += 1;
            log(`  SKIP ${row.testId ?? row.family}: ${row.error ?? row.classification}`);
            continue;
        }
        if (row.error) {
            failures += 1;
            log(`  FAIL ${row.testId ?? row.family}: ${row.error}`);
            continue;
        }
        const c = row.checks;
        const apiMapLabel = row.apiMappingExpectedStale
            ? "WARN"
            : row.apiMappingPass
              ? "PASS"
              : "FAIL";
        log(
            `  ${row.persistencePass ? "PASS" : "FAIL"} ${row.testId ?? row.family} [${row.classification}] ` +
                `persist=${row.persistencePass ? "PASS" : "FAIL"} ` +
                `api_map=${apiMapLabel} ` +
                `http=${checkStatus(c.patch_http_status.pass)} ` +
                `patch_field=${checkStatus(c.patch_response_field.pass)} ` +
                `detail=${checkStatus(c.get_detail_field.pass)} ` +
                `db=${c.db_column_field.skipped ? "SKIP" : checkStatus(c.db_column_field.pass)} ` +
                `audit=${c.db_audit.skipped ? "SKIP" : checkStatus(c.db_audit.pass)}`
        );
        if (!row.persistencePass) {
            failures += 1;
        }
    }
    const ran = rows.length - skipped;
    const passed = rows.filter((r) => !r.skipped && !r.error && r.persistencePass).length;
    log("");
    log(
        `${title}: ${failures === 0 ? "PASS" : "FAIL"} ` +
            `(${passed}/${ran} ran passed, ${skipped} skipped, ${failures} failed)`
    );
    return failures;
}

async function main() {
    log(`API_BASE_URL=${API_BASE_URL}`);
    log(`REVIEW_BATCH_ID=${REVIEW_BATCH_ID}`);
    log(`DATABASE_URL=${DATABASE_URL ? "(set)" : "(not set — DB checks skipped)"}`);

    if (ADMIN_TOKEN === TOKEN_PLACEHOLDER) {
        log(
            `ADMIN_TOKEN is not set. Using placeholder (${TOKEN_PLACEHOLDER}). ` +
                `Set ADMIN_TOKEN for authenticated smoke runs.`
        );
    }

    let dbClient = null;
    try {
        dbClient = await createDbClient();
        if (dbClient) {
            log("Connected to DATABASE_URL for direct DB verification.");
            await loadDirectEditAuditTypes(dbClient);
        } else {
            log(`Using direct-edit audit edit_type (no DB): ${DIRECT_EDIT_AUDIT_TYPE}`);
        }
    } catch (err) {
        fail(`Database connection failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
        return;
    }

    const simpleResults = [];
    const referenceResults = [];

    log("");
    log("======== SIMPLE_FIELD_PERSISTENCE (name_en / name_mm / class_code) ========");

    for (const family of FAMILIES) {
        try {
            const result = await smokeFamilyPersistence(family, dbClient);
            simpleResults.push(result);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            simpleResults.push({
                passLabel: "SIMPLE_FIELD_PERSISTENCE",
                testId: family,
                family,
                persistencePass: false,
                error: message,
                classification: "SETUP_FAILED",
            });
            fail(`FAIL [SIMPLE] ${family} (setup): ${message}`);
        }
    }

    log("");
    log("======== REFERENCE_FIELD_PERSISTENCE (dropdown / FK columns) ========");

    for (const test of REFERENCE_FIELD_TESTS) {
        try {
            const result = await smokeReferenceFieldTest(test, dbClient);
            referenceResults.push(result);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            referenceResults.push({
                passLabel: "REFERENCE_FIELD_PERSISTENCE",
                testId: test.id,
                family: test.family,
                persistencePass: false,
                error: message,
                classification: "SETUP_FAILED",
            });
            fail(`FAIL [REFERENCE] ${test.id} (setup): ${message}`);
        }
    }

    if (dbClient) {
        await dbClient.end();
    }

    const simpleFailures = printPassSummary("SIMPLE_FIELD_PERSISTENCE", simpleResults);
    const referenceFailures = printPassSummary("REFERENCE_FIELD_PERSISTENCE", referenceResults);

    const apiStaleWarnCount = [...simpleResults, ...referenceResults].filter(
        (r) => r.apiMappingExpectedStale
    ).length;

    const totalFailures = simpleFailures + referenceFailures;
    if (totalFailures > 0) {
        process.exitCode = 1;
        log("");
        log(
            `Overall: FAIL — ${simpleFailures} simple + ${referenceFailures} reference check(s) failed.`
        );
    } else {
        log("");
        log("Overall: PASS — SIMPLE_FIELD_PERSISTENCE and REFERENCE_FIELD_PERSISTENCE.");
        if (apiStaleWarnCount > 0) {
            log(
                `${apiStaleWarnCount} case(s) have API_MAPPING WARN for derived name_* fields; DB column is authoritative.`
            );
        }
    }
}

main().catch((err) => {
    fail(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
});

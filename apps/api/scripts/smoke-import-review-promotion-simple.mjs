#!/usr/bin/env node
/**
 * Smoke test: simplified direct-edit promotion flow (typed columns → publish batch → validate → promote).
 *
 * Does not modify API production logic. Uses HTTP + optional DATABASE_URL evidence queries.
 *
 * Usage (default family: buildings):
 *   API_BASE_URL=http://localhost:3001 \
 *   ADMIN_TOKEN=... \
 *   DATABASE_URL=postgresql://... \
 *   REVIEW_BATCH_ID=2 \
 *   node apps/api/scripts/smoke-import-review-promotion-simple.mjs
 *
 * Optional:
 *   FAMILY=places|roads|routing_barriers
 *   ALLOW_HIGH_RISK=true          (required for roads, routing_barriers)
 *   ALLOW_PRODUCTION=true          (required when URLs look production-like)
 *   POLL_TIMEOUT_MS=180000
 *   SKIP_TYPED_PATCH=true          (skip PATCH prep; candidate must already be ready)
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFromRoot = createRequire(path.join(__dirname, "../../../package.json"));

const API_BASE_URL = (process.env.API_BASE_URL ?? "http://localhost:3001").replace(/\/+$/, "");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "__SET_ADMIN_TOKEN__";
const DATABASE_URL = process.env.DATABASE_URL?.trim() || null;
const REVIEW_BATCH_ID = Number.parseInt(process.env.REVIEW_BATCH_ID ?? "2", 10);
const FAMILY = (process.env.FAMILY ?? "buildings").trim().toLowerCase().replace(/-/g, "_");
const ALLOW_HIGH_RISK = process.env.ALLOW_HIGH_RISK === "true";
const ALLOW_PRODUCTION = process.env.ALLOW_PRODUCTION === "true";
const SKIP_TYPED_PATCH = process.env.SKIP_TYPED_PATCH === "true";
const POLL_TIMEOUT_MS = Number.parseInt(process.env.POLL_TIMEOUT_MS ?? "180000", 10);
const PROMOTION_NOTE = (process.env.PROMOTION_NOTE ?? `smoke-simple-promotion-${Date.now()}`).trim();
const SMOKE_CANDIDATE_ID = process.env.SMOKE_CANDIDATE_ID?.trim() || null;

const TOKEN_PLACEHOLDER = "__SET_ADMIN_TOKEN__";
const ACTIVE_PUBLISH_BATCH_STATUSES = ["draft", "validating", "ready", "promoting"];

/** SQL fragment shared by candidate discovery and publish-batch eligibility. */
function reviewCandidateTableRef(shortTable) {
    return `import_review.${shortTable}`;
}

function baseCandidateScopeSql(candidateTable, idExpr = null, { requireApproved = false } = {}) {
    const candidateIdExpr = idExpr ?? `${candidateTable}.id`;
    const reviewCandidateTable = reviewCandidateTableRef(candidateTable);
    const statusList = ACTIVE_PUBLISH_BATCH_STATUSES.map((s) => `'${s}'`).join(", ");
    const approvedClause = requireApproved
        ? `
      AND review_status = 'approved'
      AND review_decision = 'approved'`
        : "";
    return `
      ${approvedClause}
      AND coalesce(promotion_status, '') <> 'promoted'
      AND promoted_core_id IS NULL
      AND match_status IS DISTINCT FROM 'manual_protected'
      AND auto_action IS DISTINCT FROM 'protect_manual'
      AND (
        match_status IS DISTINCT FROM 'duplicate_candidate'
        AND match_status IS DISTINCT FROM 'possible_duplicate'
        OR (
          match_status IN ('duplicate_candidate', 'possible_duplicate')
          AND trim(coalesce(review_note, '')) <> ''
        )
      )
      AND (
        promotion_status IS NULL
        OR trim(coalesce(promotion_status::text, '')) = ''
        OR promotion_status IN ('not_ready', 'ready', 'batched')
      )
      AND NOT EXISTS (
        SELECT 1
        FROM system.system_publish_items spi
        INNER JOIN system.system_publish_batches spb ON spb.id = spi.publish_batch_id
        WHERE spi.review_candidate_table = '${reviewCandidateTable}'
          AND spi.review_candidate_id = ${candidateIdExpr}
          AND spb.status IN (${statusList})
      )
    `;
}

function eligibleForPublishBatchSql(candidateTable, idExpr = null) {
    return baseCandidateScopeSql(candidateTable, idExpr, { requireApproved: true });
}

function findCandidateScopeSql(candidateTable) {
    return baseCandidateScopeSql(candidateTable, null, { requireApproved: false });
}

const IMPORT_REVIEW_ADMIN_TOKEN_HEADER = "x-import-review-admin-token";
const HIGH_RISK_FAMILIES = new Set(["roads", "routing_barriers"]);

/** @type {Record<string, FamilySmokeConfig>} */
const FAMILY_CONFIG = {
    buildings: {
        apiPath: "buildings",
        candidateTable: "building_candidates",
        targetSchema: "core",
        targetTable: "core_map_buildings",
        highRisk: false,
        selectCandidateSql: `
            SELECT id, external_id, local_staging_id, name_en, name_mm, building_type_id,
                   review_status, review_decision, promotion_status, promoted_core_id,
                   (geom IS NOT NULL AND ST_IsValid(geom) AND NOT ST_IsEmpty(geom)) AS has_geom
            FROM import_review.building_candidates
            WHERE review_batch_id = $1
              ${findCandidateScopeSql("building_candidates")}
              AND ST_Area(geom::geography) >= 100
              AND ST_Area(geom::geography) <= 100000000000
            ORDER BY (building_type_id IS NOT NULL) DESC, has_geom DESC, id
            LIMIT 1
        `,
        typedCompare: [
            { label: "building_type_id", candidateCol: "building_type_id", coreCol: "building_type_id" },
            {
                label: "typed_name→core.name",
                candidateCol: "__expected_core_name",
                coreCol: "name",
                transform: (v) => (v == null ? null : String(v).trim()),
            },
        ],
        async ensureTyped(client, row, api) {
            const fields = {};
            const patchNotes = [];

            if (!row.has_geom) {
                throw new Error("Candidate has no valid geom; pick another review_batch_id or fix data manually.");
            }
            if (row.building_type_id == null) {
                const ref = await client.query(
                    `SELECT id FROM ref.ref_building_types WHERE coalesce(is_active, true) ORDER BY id LIMIT 1`
                );
                const id = ref.rows[0]?.id;
                if (!id) {
                    throw new Error("No ref.ref_building_types row for building_type_id fallback.");
                }
                fields.building_type_id = String(id);
                patchNotes.push(`building_type_id=${id}`);
            }
            if (!String(row.name_en ?? "").trim() && !String(row.name_mm ?? "").trim()) {
                fields.name_en = `smoke-promo-building-${row.id}`;
                patchNotes.push(`name_en=${fields.name_en}`);
            }
            if (Object.keys(fields).length > 0) {
                await api.patchColumns(fields);
            }
            patchNotes.push(...(await ensureLineageViaSql(client, "building_candidates", row)));
            return patchNotes;
        },
    },
    places: {
        apiPath: "places",
        candidateTable: "place_candidates",
        targetSchema: "core",
        targetTable: "core_places",
        highRisk: false,
        selectCandidateSql: `
            SELECT id, external_id, local_staging_id, name_en, name_mm, category_id, admin_area_id,
                   review_status, review_decision, promotion_status, promoted_core_id,
                   (point_geom IS NOT NULL AND ST_IsValid(point_geom) AND NOT ST_IsEmpty(point_geom)) AS has_geom
            FROM import_review.place_candidates
            WHERE review_batch_id = $1
              ${findCandidateScopeSql("place_candidates")}
            ORDER BY (category_id IS NOT NULL AND admin_area_id IS NOT NULL) DESC, has_geom DESC, id
            LIMIT 1
        `,
        typedCompare: [
            { label: "category_id", candidateCol: "category_id", coreCol: "category_id" },
            { label: "admin_area_id", candidateCol: "admin_area_id", coreCol: "admin_area_id" },
        ],
        geomCompare: { candidateGeom: "point_geom", coreGeom: "point_geom", maxDistanceM: 2 },
        async ensureTyped(client, row, api) {
            const fields = {};
            const patchNotes = [];
            if (!row.has_geom) {
                throw new Error("Place candidate has no valid point_geom.");
            }
            if (row.category_id == null) {
                const ref = await client.query(
                    `SELECT id FROM ref.ref_poi_categories ORDER BY id LIMIT 1`
                );
                const id = ref.rows[0]?.id;
                if (!id) throw new Error("No ref.ref_poi_categories row.");
                fields.category_id = String(id);
                patchNotes.push(`category_id=${id}`);
            }
            if (row.admin_area_id == null) {
                const ref = await client.query(
                    `SELECT id FROM core.core_admin_areas WHERE coalesce(is_active, true) ORDER BY id LIMIT 1`
                );
                const id = ref.rows[0]?.id;
                if (!id) throw new Error("No core.core_admin_areas row.");
                fields.admin_area_id = String(id);
                patchNotes.push(`admin_area_id=${id}`);
            }
            if (!String(row.name_en ?? "").trim() && !String(row.name_mm ?? "").trim()) {
                fields.name_en = `smoke-promo-place-${row.id}`;
                patchNotes.push(`name_en=${fields.name_en}`);
            }
            if (Object.keys(fields).length > 0) {
                await api.patchColumns(fields);
            }
            patchNotes.push(...(await ensureLineageViaSql(client, "place_candidates", row)));
            return patchNotes;
        },
    },
    roads: {
        apiPath: "roads",
        candidateTable: "road_candidates",
        targetSchema: "core",
        targetTable: "core_streets",
        highRisk: true,
        selectCandidateSql: `
            SELECT id, external_id, local_staging_id, name_en, name_mm, road_class_id,
                   review_status, review_decision, promotion_status, promoted_core_id,
                   (geom IS NOT NULL AND ST_IsValid(geom) AND NOT ST_IsEmpty(geom)) AS has_geom
            FROM import_review.road_candidates
            WHERE review_batch_id = $1
              ${findCandidateScopeSql("road_candidates")}
            ORDER BY (road_class_id IS NOT NULL) DESC, has_geom DESC, id
            LIMIT 1
        `,
        typedCompare: [
            { label: "road_class_id", candidateCol: "road_class_id", coreCol: "road_class_id" },
        ],
        async ensureTyped(client, row, api) {
            const fields = {};
            const patchNotes = [];
            if (!row.has_geom) {
                throw new Error("Road candidate has no valid geom.");
            }
            if (row.road_class_id == null) {
                const ref = await client.query(
                    `SELECT id FROM ref.ref_road_classes WHERE coalesce(is_active, true) ORDER BY id LIMIT 1`
                );
                const id = ref.rows[0]?.id;
                if (!id) throw new Error("No ref.ref_road_classes row.");
                fields.road_class_id = String(id);
                patchNotes.push(`road_class_id=${id}`);
            }
            if (!String(row.name_en ?? "").trim() && !String(row.name_mm ?? "").trim()) {
                fields.name_en = `smoke-promo-road-${row.id}`;
                patchNotes.push(`name_en=${fields.name_en}`);
            }
            if (Object.keys(fields).length > 0) {
                await api.patchColumns(fields);
            }
            patchNotes.push(...(await ensureLineageViaSql(client, "road_candidates", row)));
            return patchNotes;
        },
    },
    routing_barriers: {
        apiPath: "routing_barriers",
        candidateTable: "routing_barrier_candidates",
        targetSchema: "routing",
        targetTable: "routing_barriers",
        highRisk: true,
        selectCandidateSql: `
            SELECT id, external_id, local_staging_id, barrier_type, class_code,
                   review_status, review_decision, promotion_status, promoted_core_id,
                   (point_geom IS NOT NULL AND ST_IsValid(point_geom) AND NOT ST_IsEmpty(point_geom)) AS has_geom
            FROM import_review.routing_barrier_candidates
            WHERE review_batch_id = $1
              ${findCandidateScopeSql("routing_barrier_candidates")}
            ORDER BY (nullif(trim(barrier_type), '') IS NOT NULL) DESC, has_geom DESC, id
            LIMIT 1
        `,
        typedCompare: [
            {
                label: "barrier_type",
                candidateCol: "barrier_type",
                coreCol: "barrier_type",
                transform: (v) => (v == null ? null : String(v).trim()),
            },
        ],
        geomCompare: { candidateGeom: "point_geom", coreGeom: "geom", maxDistanceM: 2 },
        async ensureTyped(client, row, api) {
            const fields = {};
            const patchNotes = [];
            if (!row.has_geom) {
                throw new Error("Routing barrier candidate has no valid point_geom.");
            }
            if (!String(row.barrier_type ?? "").trim()) {
                fields.barrier_type = "gate";
                patchNotes.push("barrier_type=gate");
            }
            if (Object.keys(fields).length > 0) {
                await api.patchColumns(fields);
            }
            patchNotes.push(...(await ensureLineageViaSql(client, "routing_barrier_candidates", row)));
            return patchNotes;
        },
    },
};

function expectedCoreNameFromCandidate(row) {
    const en = String(row.name_en ?? "").trim();
    const mm = String(row.name_mm ?? "").trim();
    return en || mm || null;
}

function hasLineage(row) {
    if (row.local_staging_id != null) {
        return true;
    }
    if (String(row.external_id ?? "").trim() !== "") {
        return true;
    }
    const refs = row.source_refs;
    if (refs && typeof refs === "object" && !Array.isArray(refs) && Object.keys(refs).length > 0) {
        return true;
    }
    return false;
}

async function ensureLineageViaSql(client, candidateTable, row) {
    if (hasLineage(row)) {
        return [];
    }
    const extId = `smoke-promo-${candidateTable}-${row.id}`;
    await client.query(
        `
        UPDATE import_review.${candidateTable}
        SET external_id = $2::text, updated_at = now()
        WHERE id = $1::bigint
        `,
        [row.id, extId]
    );
    return [`external_id=${extId} (SQL lineage)`];
}

function batchValidationPromotable(vr) {
    if (!vr) {
        return false;
    }
    if (vr.can_promote === false || vr.outcome === "blocked") {
        return false;
    }
    if ((vr.blocked_count ?? 0) > 0) {
        return false;
    }
    return (
        (vr.ready_count ?? 0) + (vr.warning_count ?? 0) + (vr.valid_count ?? 0) > 0
    );
}

function normalizeTargetTableName(value) {
    if (value == null) {
        return "";
    }
    const s = String(value).trim();
    const dot = s.lastIndexOf(".");
    return dot >= 0 ? s.slice(dot + 1) : s;
}

function publishItemValidationStatus(itemRow) {
    return normalizeStatus(itemRow?.validation_result?.status ?? itemRow?.validation_status);
}

function printValidationFailureDetails(progress, publishItems) {
    log("--- validation failure detail ---");
    if (progress?.validation_result) {
        log(JSON.stringify({ validation_result: progress.validation_result }, null, 2));
    }
    if (progress?.current_message) {
        log(`current_message: ${progress.current_message}`);
    }
    if (progress?.validation_logs_summary) {
        log(`validation_logs_summary: ${progress.validation_logs_summary}`);
    }
    for (const item of publishItems ?? []) {
        const vr = item.validation_result;
        log(
            JSON.stringify(
                {
                    publish_item_id: item.id,
                    validation_status: publishItemValidationStatus(item),
                    errors: vr?.errors ?? [],
                    warnings: vr?.warnings ?? [],
                    issues: vr?.issues ?? [],
                },
                null,
                2
            )
        );
    }
}

function printPromotionFailureDetails(progress, publishItems, batchRow, stageLogs) {
    log("--- promotion failure detail ---");
    if (progress?.promotion_result) {
        log(JSON.stringify({ promotion_result: progress.promotion_result }, null, 2));
    }
    if (progress?.current_message) {
        log(`current_message: ${progress.current_message}`);
    }
    if (progress?.promotion_logs_summary) {
        log(`promotion_logs_summary: ${progress.promotion_logs_summary}`);
    }
    if (batchRow?.summary?.validation_error) {
        log(`batch.summary.validation_error: ${batchRow.summary.validation_error}`);
    }
    if (batchRow?.summary?.promotion_error) {
        log(`batch.summary.promotion_error: ${batchRow.summary.promotion_error}`);
    }
    for (const item of publishItems ?? []) {
        log(
            JSON.stringify(
                {
                    publish_item_id: item.id,
                    publish_status: item.publish_status,
                    error_message: item.error_message,
                    target_schema: item.target_schema,
                    target_table: item.target_table,
                    target_id: item.target_id,
                },
                null,
                2
            )
        );
    }
    if (stageLogs?.length) {
        printSqlEvidence("system_publish_stage_logs (recent)", stageLogs);
    }
}

async function fetchPublishBatchEvidence(db, publishBatchId, candidateId) {
    const batch = await db.query(
        `
        SELECT id, status, summary, validated_at, promoted_at, created_at
        FROM system.system_publish_batches
        WHERE id = $1::bigint
        `,
        [publishBatchId]
    );
    const items = await db.query(
        `
        SELECT id, entity_family, publish_status, publish_action,
               target_schema, target_table, target_id,
               validation_result, error_message, published_at
        FROM system.system_publish_items
        WHERE publish_batch_id = $1::bigint
          AND review_candidate_id = $2::bigint
        `,
        [publishBatchId, candidateId]
    );
    const logs = await db.query(
        `
        SELECT stage_key, stage_label, stage_status, message, details, finished_at
        FROM system.system_publish_stage_logs
        WHERE publish_batch_id = $1::bigint
        ORDER BY id DESC
        LIMIT 12
        `,
        [publishBatchId]
    );
    return {
        batch: batch.rows[0] ?? null,
        items: items.rows,
        logs: logs.rows,
    };
}

function isPromoteTerminalStatus(status) {
    const s = normalizeStatus(status);
    return ["promoted", "partially_promoted", "failed", "blocked", "ready"].includes(s);
}

const checks = [];
let finalPass = true;

function log(msg) {
    // eslint-disable-next-line no-console
    console.log(msg);
}

function record(name, pass, detail, evidence = null) {
    checks.push({ name, pass, detail, evidence });
    if (!pass) {
        finalPass = false;
    }
    const tag = pass ? "PASS" : "FAIL";
    log(`${tag} ${name}: ${detail}`);
    if (evidence != null) {
        log(typeof evidence === "string" ? evidence : JSON.stringify(evidence, null, 2));
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildHeaders() {
    return {
        Accept: "application/json",
        "Content-Type": "application/json",
        [IMPORT_REVIEW_ADMIN_TOKEN_HEADER]: ADMIN_TOKEN,
    };
}

async function readJsonResponse(resp) {
    const rawText = await resp.text();
    if (rawText.includes("Do not know how to serialize a BigInt")) {
        throw new Error("Response contains BigInt serialization error");
    }
    let json = null;
    if (rawText.trim() !== "") {
        json = JSON.parse(rawText);
    }
    return { rawText, json };
}

async function apiRequest(method, path, body) {
    const url = `${API_BASE_URL}${path}`;
    const resp = await fetch(url, {
        method,
        headers: buildHeaders(),
        body: body != null ? JSON.stringify(body) : undefined,
    });
    const payload = await readJsonResponse(resp);
    return { resp, ...payload, url };
}

function assertNotProduction() {
    if (ALLOW_PRODUCTION) {
        return;
    }
    const haystack = `${API_BASE_URL} ${DATABASE_URL ?? ""}`.toLowerCase();
    const looksLocal = /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(haystack);
    const looksProd =
        /\bprod\b|production|\.prod\.|coremap\.app|core-map\.prod/i.test(haystack) && !looksLocal;
    if (looksProd) {
        throw new Error(
            "Refusing to run: API_BASE_URL or DATABASE_URL looks production-like. Set ALLOW_PRODUCTION=true to override."
        );
    }
}

function assertFamilyAllowed(cfg) {
    if (!cfg) {
        throw new Error(`Unsupported FAMILY=${FAMILY}. Use buildings|places|roads|routing_barriers.`);
    }
    if (cfg.highRisk && !ALLOW_HIGH_RISK) {
        throw new Error(`FAMILY=${FAMILY} requires ALLOW_HIGH_RISK=true.`);
    }
}

async function createDbClient() {
    if (!DATABASE_URL) {
        return null;
    }
    const { Client } = requireFromRoot("pg");
    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    return client;
}

function printSqlEvidence(title, rows) {
    log(`--- SQL evidence: ${title} ---`);
    if (!rows?.length) {
        log("(no rows)");
        return;
    }
    log(JSON.stringify(rows, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}

async function pollBatch(batchId, predicate, label) {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let last = null;
    while (Date.now() < deadline) {
        const { resp, json } = await apiRequest("GET", `/api/import-review/promotion/batches/${batchId}/progress`);
        if (resp.status < 200 || resp.status >= 300) {
            throw new Error(`${label} progress HTTP ${resp.status}`);
        }
        last = json;
        if (predicate(json)) {
            return json;
        }
        await sleep(1500);
    }
    throw new Error(`${label} timed out after ${POLL_TIMEOUT_MS}ms; last=${JSON.stringify(last)}`);
}

function normalizeStatus(value) {
    return String(value ?? "").trim().toLowerCase();
}

async function main() {
    log("=== smoke-import-review-promotion-simple ===");
    log(`API_BASE_URL=${API_BASE_URL}`);
    log(`REVIEW_BATCH_ID=${REVIEW_BATCH_ID}`);
    log(`FAMILY=${FAMILY}`);
    log(`DATABASE_URL=${DATABASE_URL ? "(set)" : "(not set — SQL evidence skipped)"}`);

    try {
        assertNotProduction();
        if (!ADMIN_TOKEN || ADMIN_TOKEN === TOKEN_PLACEHOLDER) {
            throw new Error("Set ADMIN_TOKEN to a valid import-review admin token.");
        }
        if (!Number.isFinite(REVIEW_BATCH_ID) || REVIEW_BATCH_ID <= 0) {
            throw new Error("REVIEW_BATCH_ID must be a positive integer.");
        }

        const cfg = FAMILY_CONFIG[FAMILY];
        assertFamilyAllowed(cfg);

        const db = await createDbClient();
        if (!db) {
            record(
                "database_url",
                false,
                "DATABASE_URL is required for this smoke test (candidate pick + SQL evidence)."
            );
            throw new Error("DATABASE_URL missing");
        }
        record("database_url", true, "Connected for SQL evidence.");

        let candidateResult;
        if (SMOKE_CANDIDATE_ID) {
            candidateResult = await db.query(
                `${cfg.selectCandidateSql.replace("LIMIT 1", "")} AND id = $2::bigint LIMIT 1`,
                [REVIEW_BATCH_ID, SMOKE_CANDIDATE_ID]
            );
        } else {
            candidateResult = await db.query(cfg.selectCandidateSql, [REVIEW_BATCH_ID]);
        }
        const candidateRow = candidateResult.rows[0];
        if (!candidateRow) {
            record(
                "find_candidate",
                false,
                `No eligible ${FAMILY} candidate in review_batch_id=${REVIEW_BATCH_ID} (approved, not in active publish batch).`
            );
            throw new Error("No candidate");
        }
        const candidateId = String(candidateRow.id);
        printSqlEvidence("selected candidate (before prep)", [candidateRow]);
        record("find_candidate", true, `Using ${FAMILY} candidate id=${candidateId}.`);

        const api = {
            async patchColumns(fields) {
                const body = {
                    review_batch_id: REVIEW_BATCH_ID,
                    fields,
                    review_note: PROMOTION_NOTE,
                };
                const { resp, json, url } = await apiRequest(
                    "PATCH",
                    `/api/import-review/${cfg.apiPath}/${candidateId}`,
                    body
                );
                if (resp.status < 200 || resp.status >= 300) {
                    throw new Error(`PATCH columns failed HTTP ${resp.status} (${url}): ${JSON.stringify(json)}`);
                }
                return json;
            },
            async patchDecisionApproved() {
                const body = {
                    review_batch_id: REVIEW_BATCH_ID,
                    review_decision: "approved",
                    review_note: PROMOTION_NOTE,
                    confirm_duplicate_reviewed: true,
                    confirm_routing_warnings: true,
                };
                const { resp, json, url } = await apiRequest(
                    "PATCH",
                    `/api/import-review/${cfg.apiPath}/${candidateId}/decision`,
                    body
                );
                if (resp.status < 200 || resp.status >= 300) {
                    throw new Error(`PATCH decision failed HTTP ${resp.status} (${url}): ${JSON.stringify(json)}`);
                }
                return json;
            },
        };

        let patchNotes = [];
        if (!SKIP_TYPED_PATCH) {
            try {
                patchNotes = await cfg.ensureTyped(db, candidateRow, api);
                record(
                    "ensure_typed_columns",
                    true,
                    patchNotes.length ? `Patched: ${patchNotes.join(", ")}` : "Typed columns already sufficient."
                );
            } catch (err) {
                record(
                    "ensure_typed_columns",
                    false,
                    err instanceof Error ? err.message : String(err)
                );
                throw err;
            }
        } else {
            record("ensure_typed_columns", true, "Skipped (SKIP_TYPED_PATCH=true).");
        }

        if (
            normalizeStatus(candidateRow.review_decision) !== "approved" ||
            normalizeStatus(candidateRow.review_status) !== "approved"
        ) {
            await api.patchDecisionApproved();
            record("approve_candidate", true, "Set review_decision=approved via API.");
        } else {
            record("approve_candidate", true, "Candidate already approved.");
        }

        const afterPrep = await db.query(
            `SELECT * FROM import_review.${cfg.candidateTable} WHERE id = $1::bigint`,
            [candidateId]
        );
        printSqlEvidence("candidate after prep", afterPrep.rows);

        const eligibleCheck = await db.query(
            `SELECT id FROM import_review.${cfg.candidateTable} AS c WHERE c.id = $1::bigint ${eligibleForPublishBatchSql(cfg.candidateTable, "c.id")}`,
            [candidateId]
        );
        if (!eligibleCheck.rows[0]) {
            record(
                "pre_batch_eligibility",
                false,
                "Candidate still fails publish-batch eligibility after approve (active batch lock or duplicate guard)."
            );
            throw new Error("Candidate not eligible for batch create");
        }
        record("pre_batch_eligibility", true, "Candidate passes publish-batch create gates.");

        const batchName = `smoke-simple-${FAMILY}-${Date.now()}`;
        const createBody = {
            review_batch_id: String(REVIEW_BATCH_ID),
            mode: "selected",
            families: [FAMILY],
            candidate_ids_by_family: {
                [FAMILY]: [candidateId],
            },
            batch_name: batchName,
            note: PROMOTION_NOTE,
        };
        const createRes = await apiRequest("POST", "/api/import-review/promotion/batches", createBody);
        if (createRes.resp.status < 200 || createRes.resp.status >= 300) {
            record("create_batch", false, `HTTP ${createRes.resp.status}`, createRes.json);
            throw new Error("create batch failed");
        }
        const publishBatchId =
            createRes.json?.publish_batch_id ??
            createRes.json?.batch_id ??
            createRes.json?.batch?.id;
        if (!publishBatchId) {
            record("create_batch", false, "Missing publish_batch_id in response.", createRes.json);
            throw new Error("no batch id");
        }
        record(
            "create_batch",
            true,
            `Created publish batch id=${publishBatchId} mode=selected (${createRes.json?.items_added ?? "?"} items).`
        );

        const validateStart = await apiRequest(
            "POST",
            `/api/import-review/promotion/batches/${publishBatchId}/validate`,
            {}
        );
        if (validateStart.resp.status < 200 || validateStart.resp.status >= 300) {
            record("validate_start", false, `HTTP ${validateStart.resp.status}`, validateStart.json);
            throw new Error("validate start failed");
        }
        record("validate_start", true, validateStart.json?.message ?? "Validation started.");

        const validateDone = await pollBatch(
            publishBatchId,
            (p) => {
                const st = normalizeStatus(p.status);
                if (st === "validating") {
                    return false;
                }
                return p.validation_result != null || st === "failed" || st === "ready";
            },
            "validation"
        );
        const validateStatus = normalizeStatus(validateDone.status);
        let evidenceAfterValidate = await fetchPublishBatchEvidence(db, publishBatchId, candidateId);

        if (validateStatus === "failed") {
            printValidationFailureDetails(validateDone, evidenceAfterValidate.items);
            record(
                "validation_result",
                false,
                `Batch validation failed (status=failed). ${validateDone.current_message ?? ""}`.trim(),
                validateDone.validation_result ?? validateDone
            );
            throw new Error("Batch validation failed");
        }
        const validationResult = validateDone.validation_result;
        const vrOk = batchValidationPromotable(validationResult);
        record(
            "validation_result",
            vrOk,
            `Batch validation outcome=${validationResult?.outcome ?? "?"} ready=${validationResult?.ready_count ?? validationResult?.valid_count ?? "?"} warning=${validationResult?.warning_count ?? "?"} blocked=${validationResult?.blocked_count ?? "?"} can_promote=${validationResult?.can_promote ?? "?"}`,
            validationResult
        );
        if (!vrOk) {
            printValidationFailureDetails(validateDone, evidenceAfterValidate.items);
            throw new Error("Batch validation not promotable (blocked or empty)");
        }

        printSqlEvidence("system_publish_items after validate", evidenceAfterValidate.items);
        const itemVr = publishItemValidationStatus(evidenceAfterValidate.items[0]);
        const itemVrOk = itemVr === "ready" || itemVr === "warning" || itemVr === "valid";
        record(
            "publish_item_validation",
            itemVrOk && itemVr !== "blocked",
            `publish_item validation_result.status=${itemVr || "(missing)"}`,
            evidenceAfterValidate.items[0]?.validation_result ?? evidenceAfterValidate.items[0] ?? null
        );
        if (!itemVrOk || itemVr === "blocked") {
            printValidationFailureDetails(validateDone, evidenceAfterValidate.items);
            throw new Error("Publish item validation blocked");
        }

        const needsWarningConfirm =
            (validationResult?.warning_count ?? 0) > 0 ||
            itemVr === "warning" ||
            validationResult?.requires_warning_confirmation === true;

        const promoteBody = {
            confirmation_text: "PROMOTE",
            chunk_size: 50,
            promotion_note: PROMOTION_NOTE,
            ...(needsWarningConfirm
                ? {
                      confirm_warnings: true,
                      warning_confirmation_note: PROMOTION_NOTE,
                  }
                : {}),
        };
        const promoteStart = await apiRequest(
            "POST",
            `/api/import-review/promotion/batches/${publishBatchId}/promote`,
            promoteBody
        );
        if (promoteStart.resp.status < 200 || promoteStart.resp.status >= 300) {
            record("promote_start", false, `HTTP ${promoteStart.resp.status}`, promoteStart.json);
            throw new Error("promote start failed");
        }
        record("promote_start", true, promoteStart.json?.message ?? "Promotion started.");

        const promoteDone = await pollBatch(
            publishBatchId,
            (p) => {
                const st = normalizeStatus(p.status);
                if (st === "promoting") {
                    return false;
                }
                return isPromoteTerminalStatus(st) || p.promotion_result != null;
            },
            "promotion"
        );
        const batchTerminal = normalizeStatus(promoteDone.status);
        let evidenceAfterPromote = await fetchPublishBatchEvidence(db, publishBatchId, candidateId);
        const promotedOk =
            batchTerminal === "promoted" ||
            batchTerminal === "partially_promoted" ||
            (promoteDone.promotion_result?.success_count ?? 0) > 0;
        record(
            "promote_complete",
            promotedOk,
            `Batch status=${batchTerminal} success=${promoteDone.promotion_result?.success_count ?? "?"} failed=${promoteDone.promotion_result?.failed_count ?? "?"}`,
            promoteDone.promotion_result ?? null
        );
        if (!promotedOk) {
            printPromotionFailureDetails(
                promoteDone,
                evidenceAfterPromote.items,
                evidenceAfterPromote.batch,
                evidenceAfterPromote.logs
            );
            throw new Error("Promotion did not complete successfully");
        }

        const batchSummary = evidenceAfterPromote.batch?.summary ?? {};
        const summaryHasValidation =
            batchSummary.validation_result != null ||
            validateDone.validation_result != null;
        const summaryHasPromotion =
            batchSummary.promotion_result != null || promoteDone.promotion_result != null;
        record(
            "batch_summary",
            summaryHasValidation && summaryHasPromotion,
            `summary has validation_result=${summaryHasValidation} promotion_result=${summaryHasPromotion} batch.status=${evidenceAfterPromote.batch?.status ?? "?"}`,
            {
                status: evidenceAfterPromote.batch?.status,
                validated_at: evidenceAfterPromote.batch?.validated_at,
                promoted_at: evidenceAfterPromote.batch?.promoted_at,
                validation_result: batchSummary.validation_result ?? validateDone.validation_result,
                promotion_result: batchSummary.promotion_result ?? promoteDone.promotion_result,
            }
        );

        const candAfter = await db.query(
            `
            SELECT id, promotion_status, promoted_core_id, promoted_at, review_status, review_decision
            FROM import_review.${cfg.candidateTable}
            WHERE id = $1::bigint
            `,
            [candidateId]
        );
        printSqlEvidence("candidate after promote", candAfter.rows);
        const cand = candAfter.rows[0];
        const candPromoted = normalizeStatus(cand?.promotion_status) === "promoted";
        const hasCoreId = cand?.promoted_core_id != null;
        record(
            "candidate_promoted",
            candPromoted && hasCoreId,
            `promotion_status=${cand?.promotion_status ?? "?"} promoted_core_id=${cand?.promoted_core_id ?? "null"}`,
            cand ?? null
        );

        printSqlEvidence("system_publish_items after promote", evidenceAfterPromote.items);
        const spi = evidenceAfterPromote.items[0];
        const spiOk = normalizeStatus(spi?.publish_status) === "success";
        const targetTableNorm = normalizeTargetTableName(spi?.target_table);
        const targetOk =
            spi?.target_schema === cfg.targetSchema &&
            targetTableNorm === cfg.targetTable &&
            spi?.target_id != null;
        record(
            "publish_item_status",
            spiOk && targetOk,
            `publish_status=${spi?.publish_status} (DB uses success, not promoted) target=${spi?.target_schema}.${spi?.target_table} id=${spi?.target_id}`,
            spi ?? null
        );
        if (!spiOk || !targetOk) {
            printPromotionFailureDetails(
                promoteDone,
                evidenceAfterPromote.items,
                evidenceAfterPromote.batch,
                evidenceAfterPromote.logs
            );
            throw new Error("Publish item not successful after promote");
        }

        const coreId = cand?.promoted_core_id ?? spi?.target_id;
        if (!coreId) {
            record("core_row_exists", false, "No promoted_core_id / target_id to verify core row.");
            throw new Error("no core id");
        }

        const coreAfter = await db.query(
            `
            SELECT id, name, building_type_id, external_id, source_staging_id, is_active,
                   ST_Area(geom::geography) AS area_m2
            FROM ${cfg.targetSchema}.${cfg.targetTable}
            WHERE id = $1::bigint
            `,
            [coreId]
        );
        printSqlEvidence(`target ${cfg.targetSchema}.${cfg.targetTable}`, coreAfter.rows);
        record(
            "core_row_exists",
            coreAfter.rows.length > 0,
            `Found ${cfg.targetSchema}.${cfg.targetTable} id=${coreId}`
        );

        const candTyped = await db.query(
            `SELECT * FROM import_review.${cfg.candidateTable} WHERE id = $1::bigint`,
            [candidateId]
        );
        const candT = candTyped.rows[0] ?? {};
        const coreT = coreAfter.rows[0] ?? {};
        candT.__expected_core_name = expectedCoreNameFromCandidate(candT);

        for (const rule of cfg.typedCompare) {
            const transform = rule.transform ?? ((v) => v);
            const expected = transform(candT[rule.candidateCol]);
            const actual = transform(coreT[rule.coreCol]);
            const match =
                expected != null &&
                actual != null &&
                String(expected) === String(actual);
            record(
                `typed_match_${rule.label}`,
                match,
                `candidate.${rule.candidateCol}=${expected} core.${rule.coreCol}=${actual}`
            );
        }

        if (cfg.geomCompare && candT[cfg.geomCompare.candidateGeom] && coreT[cfg.geomCompare.coreGeom]) {
            const dist = await db.query(
                `
                SELECT ST_Distance(
                    $1::geometry::geography,
                    $2::geometry::geography
                ) AS dist_m
                `,
                [candT[cfg.geomCompare.candidateGeom], coreT[cfg.geomCompare.coreGeom]]
            );
            const distM = Number(dist.rows[0]?.dist_m ?? NaN);
            const geomOk = Number.isFinite(distM) && distM <= cfg.geomCompare.maxDistanceM;
            record(
                "typed_geom_match",
                geomOk,
                `ST_Distance ${distM.toFixed(3)}m (max ${cfg.geomCompare.maxDistanceM}m)`
            );
            printSqlEvidence("geometry distance", dist.rows);
        }

        const verifyRes = await apiRequest(
            "GET",
            `/api/import-review/promotion/batches/${publishBatchId}/verify`
        );
        if (verifyRes.resp.status >= 200 && verifyRes.resp.status < 300) {
            record(
                "verify_endpoint",
                true,
                `verification_status=${verifyRes.json?.verification_status ?? "?"}`,
                verifyRes.json
            );
        } else {
            record("verify_endpoint", false, `HTTP ${verifyRes.resp.status}`, verifyRes.json);
        }

        await db.end().catch(() => {});
    } catch (err) {
        finalPass = false;
        record("fatal", false, err instanceof Error ? err.message : String(err));
    }

    log("\n=== summary ===");
    for (const c of checks) {
        log(`${c.pass ? "PASS" : "FAIL"} ${c.name}`);
    }
    log(finalPass ? "\nOVERALL PASS" : "\nOVERALL FAIL");
    process.exit(finalPass ? 0 : 1);
}

main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
});

/**
 * @typedef {object} TypedCompareRule
 * @property {string} label
 * @property {string} candidateCol
 * @property {string} coreCol
 * @property {(value: unknown) => unknown} [transform]
 */

/**
 * @typedef {object} GeomCompareRule
 * @property {string} candidateGeom
 * @property {string} coreGeom
 * @property {number} maxDistanceM
 */

/**
 * @typedef {object} FamilySmokeConfig
 * @property {string} apiPath
 * @property {string} candidateTable
 * @property {string} targetSchema
 * @property {string} targetTable
 * @property {boolean} highRisk
 * @property {string} selectCandidateSql
 * @property {TypedCompareRule[]} typedCompare
 * @property {GeomCompareRule} [geomCompare]
 * @property {(client: import("pg").Client, row: Record<string, unknown>, api: { patchColumns: (fields: Record<string, string>) => Promise<unknown>, patchDecisionApproved: () => Promise<unknown> }) => Promise<string[]>} ensureTyped
 */

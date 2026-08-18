#!/usr/bin/env node
/**
 * Smoke test: resumable import-review promotion (selected batch → validate → dry-run → promote).
 *
 * Usage:
 *   API_BASE_URL=http://localhost:3001 \
 *   ADMIN_TOKEN=... \
 *   DATABASE_URL=postgresql://... \
 *   REVIEW_BATCH_ID=2 \
 *   FAMILY=places \
 *   COUNT=3 \
 *   node apps/api/scripts/smoke-import-review-resumable-promotion.mjs
 *
 * Optional:
 *   RUN_RESUME_TEST=true       — extra flow: call /resume while validation is in-flight
 *   ALLOW_HIGH_RISK=true       — allow roads / routing_barriers
 *   ALLOW_PRODUCTION=true
 *   POLL_TIMEOUT_MS=180000
 *   SKIP_TYPED_PATCH=true
 *   SMOKE_CANDIDATE_IDS=1,2,3
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
const FAMILY = (process.env.FAMILY ?? "places").trim().toLowerCase().replace(/-/g, "_");
const COUNT = Math.max(1, Number.parseInt(process.env.COUNT ?? "3", 10));
const ALLOW_HIGH_RISK = process.env.ALLOW_HIGH_RISK === "true";
const ALLOW_PRODUCTION = process.env.ALLOW_PRODUCTION === "true";
const SKIP_TYPED_PATCH = process.env.SKIP_TYPED_PATCH === "true";
const RUN_RESUME_TEST = process.env.RUN_RESUME_TEST === "true";
const POLL_TIMEOUT_MS = Number.parseInt(process.env.POLL_TIMEOUT_MS ?? "180000", 10);
const PROMOTION_NOTE = (process.env.PROMOTION_NOTE ?? `smoke-resumable-promotion-${Date.now()}`).trim();
const SMOKE_CANDIDATE_IDS = process.env.SMOKE_CANDIDATE_IDS?.trim()
    ? process.env.SMOKE_CANDIDATE_IDS.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
    : null;

const TOKEN_PLACEHOLDER = "__SET_ADMIN_TOKEN__";
const IMPORT_REVIEW_ADMIN_TOKEN_HEADER = "x-import-review-admin-token";
const ACTIVE_PUBLISH_BATCH_STATUSES = ["draft", "validating", "ready", "promoting"];

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

/** @type {Record<string, FamilySmokeConfig>} */
const FAMILY_CONFIG = {
    buildings: {
        apiPath: "buildings",
        candidateTable: "building_candidates",
        targetSchema: "core",
        targetTable: "core_buildings",
        highRisk: false,
        selectCandidatesSql: `
            SELECT id, external_id, local_staging_id, name_en, name_mm, building_type_id,
                   review_status, review_decision, promotion_status, promoted_core_id,
                   (geom IS NOT NULL AND ST_IsValid(geom) AND NOT ST_IsEmpty(geom)) AS has_geom
            FROM import_review.building_candidates
            WHERE review_batch_id = $1
              ${findCandidateScopeSql("building_candidates")}
              AND ST_Area(geom::geography) >= 100
              AND ST_Area(geom::geography) <= 100000000000
            ORDER BY (building_type_id IS NOT NULL) DESC, has_geom DESC, id
            LIMIT $2
        `,
        async ensureTyped(client, row, api) {
            const fields = {};
            const patchNotes = [];
            if (!row.has_geom) {
                throw new Error("Candidate has no valid geom.");
            }
            if (row.building_type_id == null) {
                const ref = await client.query(
                    `SELECT id FROM ref.ref_building_types WHERE coalesce(is_active, true) ORDER BY id LIMIT 1`
                );
                const id = ref.rows[0]?.id;
                if (!id) throw new Error("No ref.ref_building_types row.");
                fields.building_type_id = String(id);
                patchNotes.push(`building_type_id=${id}`);
            }
            if (!String(row.name_en ?? "").trim() && !String(row.name_mm ?? "").trim()) {
                fields.name_en = `smoke-resume-building-${row.id}`;
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
        selectCandidatesSql: `
            SELECT id, external_id, local_staging_id, name_en, name_mm, category_id, admin_area_id,
                   review_status, review_decision, promotion_status, promoted_core_id,
                   (point_geom IS NOT NULL AND ST_IsValid(point_geom) AND NOT ST_IsEmpty(point_geom)) AS has_geom
            FROM import_review.place_candidates
            WHERE review_batch_id = $1
              ${findCandidateScopeSql("place_candidates")}
            ORDER BY (category_id IS NOT NULL AND admin_area_id IS NOT NULL) DESC, has_geom DESC, id
            LIMIT $2
        `,
        async ensureTyped(client, row, api) {
            const fields = {};
            const patchNotes = [];
            if (!row.has_geom) {
                throw new Error("Place candidate has no valid point_geom.");
            }
            if (row.category_id == null) {
                const ref = await client.query(`SELECT id FROM ref.ref_poi_categories ORDER BY id LIMIT 1`);
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
                fields.name_en = `smoke-resume-place-${row.id}`;
                patchNotes.push(`name_en=${fields.name_en}`);
            }
            if (Object.keys(fields).length > 0) {
                await api.patchColumns(fields);
            }
            patchNotes.push(...(await ensureLineageViaSql(client, "place_candidates", row)));
            return patchNotes;
        },
    },
};

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
    log(`${pass ? "PASS" : "FAIL"} ${name}: ${detail}`);
    if (evidence != null) {
        log(typeof evidence === "string" ? evidence : JSON.stringify(evidence, null, 2));
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeStatus(value) {
    return String(value ?? "").trim().toLowerCase();
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
        throw new Error(`Unsupported FAMILY=${FAMILY}. Use places|buildings (or roads/routing_barriers with ALLOW_HIGH_RISK=true).`);
    }
    if (cfg.highRisk && !ALLOW_HIGH_RISK) {
        throw new Error(`FAMILY=${FAMILY} requires ALLOW_HIGH_RISK=true.`);
    }
    if (FAMILY === "roads" || FAMILY === "routing_barriers") {
        throw new Error(`FAMILY=${FAMILY} is not supported in this smoke script unless extended. Use places|buildings.`);
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
            throw new Error(`${label} progress HTTP ${resp.status}: ${JSON.stringify(json)}`);
        }
        last = json;
        if (predicate(json)) {
            return json;
        }
        await sleep(1200);
    }
    throw new Error(`${label} timed out after ${POLL_TIMEOUT_MS}ms; last=${JSON.stringify(last)}`);
}

function validationCountsPresent(vr) {
    return (
        vr != null &&
        typeof vr.ready_count === "number" &&
        typeof vr.warning_count === "number" &&
        typeof vr.blocked_count === "number"
    );
}

function validationCompleteProgress(p) {
    const st = normalizeStatus(p.status);
    if (st === "validating") {
        return false;
    }
    const pct = Number(p.validation_percent ?? p.percent ?? 0);
    return pct >= 100 && p.validation_result != null;
}

function promotionCompleteProgress(p) {
    const st = normalizeStatus(p.status);
    if (st === "promoting") {
        return false;
    }
    const stage = p.current_stage ?? null;
    const pct = Number(p.percent ?? 0);
    const stageDone = stage === "promote_items" ? pct >= 100 : true;
    const terminal = ["promoted", "partial", "partially_promoted", "ready", "failed"].includes(st);
    return terminal && stageDone && (p.promotion_result != null || st === "promoted" || st === "partial" || st === "partially_promoted");
}

function publishItemValidationStatus(itemRow) {
    const vr = itemRow?.validation_result;
    if (vr && typeof vr === "object" && !Array.isArray(vr)) {
        const s = vr.status;
        if (typeof s === "string") {
            return normalizeStatus(s);
        }
    }
    return normalizeStatus(itemRow?.validation_status);
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
    const extId = `smoke-resume-${candidateTable}-${row.id}`;
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

async function fetchBatchItems(db, publishBatchId) {
    const items = await db.query(
        `
        SELECT id, entity_family, review_candidate_id, publish_status, publish_action,
               target_schema, target_table, target_id,
               validation_result, error_message
        FROM system.system_publish_items
        WHERE publish_batch_id = $1::bigint
        ORDER BY id
        `,
        [publishBatchId]
    );
    return items.rows;
}

async function fetchCandidatesByIds(db, cfg, candidateIds) {
    const result = await db.query(
        `
        SELECT *
        FROM import_review.${cfg.candidateTable}
        WHERE review_batch_id = $1 AND id = ANY($2::bigint[])
        `,
        [REVIEW_BATCH_ID, candidateIds]
    );
    for (const row of result.rows) {
        if (cfg.candidateTable === "place_candidates") {
            row.has_geom =
                row.point_geom != null &&
                row.point_geom !== undefined;
        } else if (cfg.candidateTable === "building_candidates") {
            row.has_geom = row.geom != null && row.geom !== undefined;
        }
    }
    return result.rows;
}

async function prepareCandidates(db, cfg, candidateRows) {
    const apiFor = (candidateId) => ({
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
                throw new Error(`PATCH columns HTTP ${resp.status} (${url}): ${JSON.stringify(json)}`);
            }
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
                throw new Error(`PATCH decision HTTP ${resp.status} (${url}): ${JSON.stringify(json)}`);
            }
        },
    });

    for (const row of candidateRows) {
        const candidateId = String(row.id);
        const api = apiFor(candidateId);
        if (!SKIP_TYPED_PATCH) {
            await cfg.ensureTyped(db, row, api);
        }
        if (
            normalizeStatus(row.review_decision) !== "approved" ||
            normalizeStatus(row.review_status) !== "approved"
        ) {
            await api.patchDecisionApproved();
        }
        const eligible = await db.query(
            `
            SELECT id FROM import_review.${cfg.candidateTable} AS c
            WHERE c.id = $1::bigint ${eligibleForPublishBatchSql(cfg.candidateTable, "c.id")}
            `,
            [candidateId]
        );
        if (!eligible.rows[0]) {
            throw new Error(`Candidate ${candidateId} not eligible for publish batch after prep.`);
        }
    }
}

async function createSelectedBatch(cfg, candidateIds) {
    const batchName = `smoke-resumable-${FAMILY}-${Date.now()}`;
    const createBody = {
        review_batch_id: String(REVIEW_BATCH_ID),
        mode: "selected",
        families: [FAMILY],
        candidate_ids_by_family: {
            [FAMILY]: candidateIds,
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
        createRes.json?.publish_batch_id ?? createRes.json?.batch_id ?? createRes.json?.batch?.id;
    if (!publishBatchId) {
        record("create_batch", false, "Missing publish_batch_id", createRes.json);
        throw new Error("no batch id");
    }
    record(
        "create_batch",
        true,
        `publish_batch_id=${publishBatchId} items_added=${createRes.json?.items_added ?? createRes.json?.total_selected ?? "?"}`,
        { request: createBody, response: createRes.json }
    );
    return String(publishBatchId);
}

async function runValidateDryRunPromote(publishBatchId, { callResumeDuringValidation = false } = {}) {
    const validateStart = await apiRequest(
        "POST",
        `/api/import-review/promotion/batches/${publishBatchId}/validate`,
        {}
    );
    if (validateStart.resp.status < 200 || validateStart.resp.status >= 300) {
        record("validate_start", false, `HTTP ${validateStart.resp.status}`, validateStart.json);
        throw new Error("validate start failed");
    }
    record("validate_start", true, validateStart.json?.message ?? "Validation started.", validateStart.json);

    if (callResumeDuringValidation) {
        await sleep(800);
        const mid = await apiRequest("GET", `/api/import-review/promotion/batches/${publishBatchId}/progress`);
        const midSt = normalizeStatus(mid.json?.status);
        const resumeRes = await apiRequest(
            "POST",
            `/api/import-review/promotion/batches/${publishBatchId}/resume`,
            {}
        );
        const resumeOk = resumeRes.resp.status >= 200 && resumeRes.resp.status < 300;
        record(
            "resume_validation_call",
            resumeOk,
            `Called POST /resume while status=${midSt} HTTP ${resumeRes.resp.status}`,
            { before_resume: mid.json, resume_response: resumeRes.json }
        );
        if (!resumeOk) {
            throw new Error("resume during validation failed");
        }
    }

    const validateDone = await pollBatch(publishBatchId, validationCompleteProgress, "validation");
    const validatePct = Number(validateDone.validation_percent ?? validateDone.percent ?? 0);
    record(
        "validation_percent_100",
        validatePct >= 100,
        `validation_percent=${validatePct}`,
        {
            validation_percent: validateDone.validation_percent,
            percent: validateDone.percent,
            processed_count: validateDone.processed_count,
            total: validateDone.total,
        }
    );

    const vr = validateDone.validation_result;
    const countsOk = validationCountsPresent(vr);
    record(
        "validation_counts_fields",
        countsOk,
        countsOk
            ? `ready=${vr.ready_count} warning=${vr.warning_count} blocked=${vr.blocked_count}`
            : "validation_result missing ready_count/warning_count/blocked_count",
        vr
    );

    const resumable = Array.isArray(validateDone.resumable_actions) ? validateDone.resumable_actions : [];
    record(
        "progress_resumable_actions_array",
        Array.isArray(validateDone.resumable_actions),
        `resumable_actions=${JSON.stringify(resumable)}`,
        { resumable_actions: resumable }
    );

    if (normalizeStatus(validateDone.status) === "failed" || vr?.can_promote === false) {
        record("validation_promotable", false, `outcome=${vr?.outcome ?? "?"} can_promote=${vr?.can_promote ?? "?"}`, vr);
        throw new Error("validation not promotable");
    }
    record(
        "validation_promotable",
        true,
        `outcome=${vr?.outcome ?? "?"} ready=${vr?.ready_count ?? vr?.valid_count ?? 0} blocked=${vr?.blocked_count ?? 0}`,
        vr
    );

    const dryRunRes = await apiRequest(
        "POST",
        `/api/import-review/promotion/batches/${publishBatchId}/dry-run`,
        {}
    );
    if (dryRunRes.resp.status < 200 || dryRunRes.resp.status >= 300) {
        record("dry_run", false, `HTTP ${dryRunRes.resp.status}`, dryRunRes.json);
        throw new Error("dry-run failed");
    }
    record("dry_run", true, `status=${dryRunRes.json?.status ?? "?"}`, dryRunRes.json);

    const afterDryRun = await apiRequest("GET", `/api/import-review/promotion/batches/${publishBatchId}/progress`);
    const dryPassed =
        afterDryRun.json?.dry_run_result?.status === "passed" ||
        normalizeStatus(afterDryRun.json?.dry_run_result?.status) === "passed";
    record(
        "dry_run_passed_in_progress",
        dryPassed,
        `dry_run_result.status=${afterDryRun.json?.dry_run_result?.status ?? "?"}`,
        afterDryRun.json?.dry_run_result ?? null
    );
    if (!dryPassed) {
        throw new Error("dry-run did not pass");
    }

    const promoteBody = {
        confirmation_text: "PROMOTE",
        chunk_size: 50,
        promotion_note: PROMOTION_NOTE,
        ...(vr?.warning_count > 0 || vr?.requires_warning_confirmation
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
    record("promote_start", true, promoteStart.json?.message ?? "Promotion started.", promoteStart.json);

    const promoteDone = await pollBatch(publishBatchId, promotionCompleteProgress, "promotion");
    const promoPct = Number(promoteDone.percent ?? 0);
    const promoStage = promoteDone.current_stage ?? null;
    record(
        "promotion_progress_complete",
        normalizeStatus(promoteDone.status) !== "promoting",
        `status=${promoteDone.status} stage=${promoStage ?? "?"} percent=${promoPct} success=${promoteDone.promotion_result?.success_count ?? "?"}`,
        promoteDone.promotion_result ?? promoteDone
    );

    return { validateDone, promoteDone };
}

async function verifyPostPromotion(db, cfg, publishBatchId, candidateIds) {
    const items = await fetchBatchItems(db, publishBatchId);
    printSqlEvidence("system_publish_items after promote", items);

    const readyOrWarningIds = [];
    const blockedIds = [];
    for (const item of items) {
        const vs = publishItemValidationStatus(item);
        const cid = String(item.review_candidate_id);
        if (vs === "blocked") {
            blockedIds.push(cid);
        } else if (vs === "ready" || vs === "warning" || vs === "valid") {
            readyOrWarningIds.push(cid);
        }
    }

    const candRows = await db.query(
        `
        SELECT id, promotion_status, promoted_core_id, promoted_at
        FROM import_review.${cfg.candidateTable}
        WHERE id = ANY($1::bigint[])
        `,
        [candidateIds.map((id) => BigInt(id))]
    );
    printSqlEvidence(`import_review.${cfg.candidateTable} after promote`, candRows.rows);

    let promotedChecksOk = true;
    const promotedEvidence = [];
    for (const cid of readyOrWarningIds) {
        const cand = candRows.rows.find((r) => String(r.id) === cid);
        const spi = items.find((r) => String(r.review_candidate_id) === cid);
        const ok =
            normalizeStatus(cand?.promotion_status) === "promoted" &&
            cand?.promoted_core_id != null &&
            normalizeStatus(spi?.publish_status) === "success" &&
            spi?.target_id != null;
        promotedEvidence.push({
            candidate_id: cid,
            promotion_status: cand?.promotion_status,
            promoted_core_id: cand?.promoted_core_id?.toString?.() ?? cand?.promoted_core_id,
            publish_status: spi?.publish_status,
            target_id: spi?.target_id?.toString?.() ?? spi?.target_id,
        });
        if (!ok) {
            promotedChecksOk = false;
        }
        if (cand?.promoted_core_id) {
            const core = await db.query(
                `SELECT id FROM ${cfg.targetSchema}.${cfg.targetTable} WHERE id = $1::bigint`,
                [cand.promoted_core_id]
            );
            record(
                `core_row_exists_${cid}`,
                core.rows.length > 0,
                `SELECT id FROM ${cfg.targetSchema}.${cfg.targetTable} WHERE id=${cand.promoted_core_id} → ${core.rows.length} row(s)`,
                core.rows[0] ?? null
            );
        }
    }
    record(
        "promoted_candidates_have_core_id",
        promotedChecksOk && readyOrWarningIds.length > 0,
        `checked ${readyOrWarningIds.length} ready/warning item(s)`,
        promotedEvidence
    );

    if (blockedIds.length > 0) {
        const blockedEvidence = [];
        let blockedOk = true;
        for (const cid of blockedIds) {
            const cand = candRows.rows.find((r) => String(r.id) === cid);
            const spi = items.find((r) => String(r.review_candidate_id) === cid);
            const ok =
                normalizeStatus(cand?.promotion_status) !== "promoted" &&
                cand?.promoted_core_id == null &&
                normalizeStatus(spi?.publish_status) === "pending";
            blockedEvidence.push({
                candidate_id: cid,
                promotion_status: cand?.promotion_status,
                promoted_core_id: cand?.promoted_core_id,
                publish_status: spi?.publish_status,
            });
            if (!ok) {
                blockedOk = false;
            }
        }
        record(
            "blocked_items_remain_unpromoted",
            blockedOk,
            `blocked publish items=${blockedIds.length}`,
            blockedEvidence
        );
    } else {
        record(
            "blocked_items_remain_unpromoted",
            true,
            "No blocked publish items in batch (check skipped).",
            { blocked_count_from_validation: items.length }
        );
    }

    const listRes = await apiRequest(
        "GET",
        `/api/import-review/${cfg.apiPath}?review_batch_id=${REVIEW_BATCH_ID}&limit=500`
    );
    if (listRes.resp.status < 200 || listRes.resp.status >= 300) {
        record("list_default_excludes_promoted", false, `HTTP ${listRes.resp.status}`, listRes.json);
        return;
    }
    const listItems = listRes.json?.items ?? listRes.json?.data ?? [];
    const listIds = new Set(
        (Array.isArray(listItems) ? listItems : []).map((row) => String(row.id ?? row.candidate_id ?? ""))
    );
    const leaked = readyOrWarningIds.filter((id) => listIds.has(id));
    record(
        "list_default_excludes_promoted",
        leaked.length === 0,
        leaked.length === 0
            ? `GET /api/import-review/${cfg.apiPath}?review_batch_id=… (no include_promoted) omits ${readyOrWarningIds.length} promoted id(s)`
            : `Promoted candidate(s) still listed: ${leaked.join(", ")}`,
        {
            api_path: `/api/import-review/${cfg.apiPath}`,
            promoted_candidate_ids: readyOrWarningIds,
            leaked_in_list: leaked,
            list_sample_count: listIds.size,
        }
    );

    const verifyRes = await apiRequest(
        "GET",
        `/api/import-review/promotion/batches/${publishBatchId}/verify`
    );
    record(
        "verify_promotion",
        verifyRes.resp.status >= 200 && verifyRes.resp.status < 300,
        `verification_status=${verifyRes.json?.verification_status ?? "?"} HTTP ${verifyRes.resp.status}`,
        verifyRes.json
    );
}

async function main() {
    log("=== smoke-import-review-resumable-promotion ===");
    log(`API_BASE_URL=${API_BASE_URL}`);
    log(`REVIEW_BATCH_ID=${REVIEW_BATCH_ID}`);
    log(`FAMILY=${FAMILY}`);
    log(`COUNT=${COUNT}`);
    log(`RUN_RESUME_TEST=${RUN_RESUME_TEST}`);
    log(`DATABASE_URL=${DATABASE_URL ? "(set)" : "(not set)"}`);

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
            record("database_url", false, "DATABASE_URL is required.");
            throw new Error("DATABASE_URL missing");
        }
        record("database_url", true, "Connected.");

        let candidateRows;
        if (SMOKE_CANDIDATE_IDS?.length) {
            candidateRows = await fetchCandidatesByIds(db, cfg, SMOKE_CANDIDATE_IDS);
            if (candidateRows.length < SMOKE_CANDIDATE_IDS.length) {
                throw new Error(
                    `Only found ${candidateRows.length}/${SMOKE_CANDIDATE_IDS.length} SMOKE_CANDIDATE_IDS in review_batch_id=${REVIEW_BATCH_ID}.`
                );
            }
        } else {
            const picked = await db.query(cfg.selectCandidatesSql, [REVIEW_BATCH_ID, COUNT]);
            candidateRows = picked.rows;
        }

        if (candidateRows.length < 1) {
            record(
                "find_candidates",
                false,
                `No eligible ${FAMILY} candidates in review_batch_id=${REVIEW_BATCH_ID}.`
            );
            throw new Error("No candidates");
        }
        const candidateIds = candidateRows.map((r) => String(r.id));
        printSqlEvidence(`selected ${candidateRows.length} candidate(s)`, candidateRows);
        record("find_candidates", true, `Using candidate ids: ${candidateIds.join(", ")}`);

        await prepareCandidates(db, cfg, candidateRows);
        record("prepare_candidates", true, `Prepared ${candidateIds.length} candidate(s).`);

        const publishBatchId = await createSelectedBatch(cfg, candidateIds);
        await runValidateDryRunPromote(publishBatchId, { callResumeDuringValidation: false });
        await verifyPostPromotion(db, cfg, publishBatchId, candidateIds);

        if (RUN_RESUME_TEST) {
            log("\n=== optional resume flow (RUN_RESUME_TEST=true) ===");
            const resumeCandidateId = candidateIds[0];
            const resumeBatchId = await createSelectedBatch(cfg, [resumeCandidateId]);
            await runValidateDryRunPromote(resumeBatchId, { callResumeDuringValidation: true });
            record(
                "resume_flow_complete",
                true,
                `Resume batch ${resumeBatchId} finished validate → dry-run → promote.`
            );
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

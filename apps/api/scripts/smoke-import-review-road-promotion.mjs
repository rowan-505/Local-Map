#!/usr/bin/env node
/**
 * Smoke test: selected-road publish batch → validate → road dry-run (+ routing readiness) → promote.
 *
 * Exercises the same path as the Import Review Roads list “Create publish batch” flow.
 * Default: 1 road. Set CANDIDATE_COUNT=5 for five-road smoke (requires API bulk env for >3 items).
 *
 * Usage:
 *   API_BASE_URL=http://localhost:3001 \
 *   ADMIN_TOKEN=... \
 *   DATABASE_URL=postgresql://... \
 *   REVIEW_BATCH_ID=2 \
 *   node apps/api/scripts/smoke-import-review-road-promotion.mjs
 *
 * Optional:
 *   CANDIDATE_COUNT=1|5
 *   ALLOW_PRODUCTION=true
 *   POLL_TIMEOUT_MS=300000
 *   SKIP_TYPED_PATCH=true
 *   SMOKE_CANDIDATE_IDS=101,102   (comma-separated; must match count or fewer with auto-fill)
 *
 * API server env (apps/api/.env, restart API):
 *   ENABLE_IMPORT_REVIEW_ROAD_PROMOTION=true
 *   ENABLE_IMPORT_REVIEW_ROAD_BULK_PROMOTION=true   (required when CANDIDATE_COUNT > 3)
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
const CANDIDATE_COUNT = Math.min(
    5,
    Math.max(1, Number.parseInt(process.env.CANDIDATE_COUNT ?? "1", 10))
);
const ALLOW_PRODUCTION = process.env.ALLOW_PRODUCTION === "true";
const SKIP_TYPED_PATCH = process.env.SKIP_TYPED_PATCH === "true";
const POLL_TIMEOUT_MS = Number.parseInt(process.env.POLL_TIMEOUT_MS ?? "300000", 10);
const PROMOTION_NOTE = (process.env.PROMOTION_NOTE ?? `smoke-road-promotion-${Date.now()}`).trim();
const SMOKE_CANDIDATE_IDS = (process.env.SMOKE_CANDIDATE_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const TOKEN_PLACEHOLDER = "__SET_ADMIN_TOKEN__";
const FAMILY = "roads";
const ACTIVE_PUBLISH_BATCH_STATUSES = ["draft", "validating", "ready", "promoting"];
const IMPORT_REVIEW_ADMIN_TOKEN_HEADER = "x-import-review-admin-token";
const ROAD_BULK_THRESHOLD = 3;

/** Required on create + validate for roads (mirrors dashboard promotion batch UI). */
const ROAD_BATCH_LIMITS_CONFIRMATION = {
    allow_high_risk_families: true,
    confirm_large_batch: false,
    mixed_high_risk_confirm: false,
};

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

const SELECT_CANDIDATES_SQL = `
    SELECT id, external_id, local_staging_id, name_en, name_mm, road_class_id,
           review_status, review_decision, promotion_status, promoted_core_id,
           (geom IS NOT NULL AND ST_IsValid(geom) AND NOT ST_IsEmpty(geom)) AS has_geom
    FROM import_review.road_candidates
    WHERE review_batch_id = $1
      ${findCandidateScopeSql("road_candidates")}
    ORDER BY (road_class_id IS NOT NULL) DESC, has_geom DESC, id
    LIMIT $2
`;

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

function normalizeStatus(value) {
    return String(value ?? "").trim().toLowerCase();
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
    return (vr.ready_count ?? 0) + (vr.warning_count ?? 0) + (vr.valid_count ?? 0) > 0;
}

function publishItemValidationStatus(itemRow) {
    const vr = itemRow?.validation_result;
    return normalizeStatus(vr?.status ?? itemRow?.validation_status);
}

function isPromoteTerminalStatus(status) {
    const s = normalizeStatus(status);
    return ["promoted", "partially_promoted", "failed", "blocked", "ready"].includes(s);
}

function roadDryRunPassed(summary) {
    if (!summary?.ran_at?.trim()) {
        return false;
    }
    if ((summary.checked_count ?? 0) <= 0) {
        return false;
    }
    return normalizeStatus(summary.status) === "passed" && (summary.failed_count ?? 0) === 0;
}

function routingReadinessPassed(summary) {
    if (!summary?.ran_at?.trim()) {
        return false;
    }
    if (summary.type !== "db_routing_readiness") {
        return false;
    }
    return normalizeStatus(summary.status) === "passed" && (summary.failed_count ?? 0) === 0;
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

async function ensureLineageViaSql(client, row) {
    if (hasLineage(row)) {
        return [];
    }
    const extId = `smoke-road-promo-${row.id}`;
    await client.query(
        `
        UPDATE import_review.road_candidates
        SET external_id = $2::text, updated_at = now()
        WHERE id = $1::bigint
        `,
        [row.id, extId]
    );
    return [`external_id=${extId} (SQL lineage)`];
}

async function ensureRoadTyped(client, row, api) {
    const fields = {};
    const patchNotes = [];
    if (!row.has_geom) {
        throw new Error(`Road candidate ${row.id} has no valid geom.`);
    }
    if (row.road_class_id == null) {
        const ref = await client.query(
            `SELECT id FROM ref.ref_road_classes WHERE coalesce(is_active, true) ORDER BY id LIMIT 1`
        );
        const id = ref.rows[0]?.id;
        if (!id) {
            throw new Error("No ref.ref_road_classes row.");
        }
        fields.road_class_id = String(id);
        patchNotes.push(`road_class_id=${id}`);
    }
    if (!String(row.name_en ?? "").trim() && !String(row.name_mm ?? "").trim()) {
        fields.name_en = `smoke-road-promo-${row.id}`;
        patchNotes.push(`name_en=${fields.name_en}`);
    }
    if (Object.keys(fields).length > 0) {
        await api.patchColumns(row.id, fields);
    }
    patchNotes.push(...(await ensureLineageViaSql(client, row)));
    return patchNotes;
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
        const { resp, json } = await apiRequest(
            "GET",
            `/api/import-review/promotion/batches/${batchId}/progress`
        );
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

async function fetchPublishBatchEvidence(db, publishBatchId, candidateIds) {
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
               target_schema, target_table, target_id, review_candidate_id,
               validation_result, error_message, published_at
        FROM system.system_publish_items
        WHERE publish_batch_id = $1::bigint
          AND review_candidate_id = ANY($2::bigint[])
        ORDER BY id
        `,
        [publishBatchId, candidateIds]
    );
    const logs = await db.query(
        `
        SELECT stage_key, stage_label, stage_status, message, details, finished_at
        FROM system.system_publish_stage_logs
        WHERE publish_batch_id = $1::bigint
        ORDER BY id DESC
        LIMIT 20
        `,
        [publishBatchId]
    );
    return {
        batch: batch.rows[0] ?? null,
        items: items.rows,
        logs: logs.rows,
    };
}

async function verifyCandidatePromotion(db, candidateId, publishItems) {
    const candAfter = await db.query(
        `
        SELECT id, promotion_status, promoted_core_id, promoted_at
        FROM import_review.road_candidates
        WHERE id = $1::bigint
        `,
        [candidateId]
    );
    const cand = candAfter.rows[0];
    const spi = publishItems.find((r) => String(r.review_candidate_id) === String(candidateId));
    const candPromoted = normalizeStatus(cand?.promotion_status) === "promoted";
    const hasCoreId = cand?.promoted_core_id != null;
    const spiOk = normalizeStatus(spi?.publish_status) === "success";
    const targetOk =
        spi?.target_schema === "core" &&
        String(spi?.target_table ?? "").endsWith("core_streets") &&
        spi?.target_id != null;
    const coreId = cand?.promoted_core_id ?? spi?.target_id;
    let coreExists = false;
    if (coreId) {
        const coreAfter = await db.query(
            `SELECT id FROM core.core_streets WHERE id = $1::bigint`,
            [coreId]
        );
        coreExists = coreAfter.rows.length > 0;
    }
    return {
        candidateId,
        cand,
        spi,
        candPromoted,
        hasCoreId,
        spiOk,
        targetOk,
        coreExists,
        coreId,
    };
}

async function main() {
    log("=== smoke-import-review-road-promotion ===");
    log(`API_BASE_URL=${API_BASE_URL}`);
    log(`REVIEW_BATCH_ID=${REVIEW_BATCH_ID}`);
    log(`CANDIDATE_COUNT=${CANDIDATE_COUNT}`);
    log(`DATABASE_URL=${DATABASE_URL ? "(set)" : "(not set)"}`);

    if (CANDIDATE_COUNT > ROAD_BULK_THRESHOLD) {
        log(
            `Note: CANDIDATE_COUNT=${CANDIDATE_COUNT} requires ENABLE_IMPORT_REVIEW_ROAD_BULK_PROMOTION=true on the API.`
        );
    }

    try {
        assertNotProduction();
        if (!ADMIN_TOKEN || ADMIN_TOKEN === TOKEN_PLACEHOLDER) {
            throw new Error("Set ADMIN_TOKEN to a valid import-review admin token.");
        }
        if (!Number.isFinite(REVIEW_BATCH_ID) || REVIEW_BATCH_ID <= 0) {
            throw new Error("REVIEW_BATCH_ID must be a positive integer.");
        }

        const db = await createDbClient();
        if (!db) {
            record("database_url", false, "DATABASE_URL is required.");
            throw new Error("DATABASE_URL missing");
        }
        record("database_url", true, "Connected.");

        let candidateRows = [];
        if (SMOKE_CANDIDATE_IDS.length > 0) {
            const picked = await db.query(
                `
                SELECT id, external_id, local_staging_id, name_en, name_mm, road_class_id,
                       review_status, review_decision, promotion_status, promoted_core_id,
                       (geom IS NOT NULL AND ST_IsValid(geom) AND NOT ST_IsEmpty(geom)) AS has_geom
                FROM import_review.road_candidates
                WHERE review_batch_id = $1::bigint
                  AND id = ANY($2::bigint[])
                `,
                [REVIEW_BATCH_ID, SMOKE_CANDIDATE_IDS.map((id) => BigInt(id))]
            );
            candidateRows = picked.rows;
        } else {
            const found = await db.query(SELECT_CANDIDATES_SQL, [
                REVIEW_BATCH_ID,
                CANDIDATE_COUNT,
            ]);
            candidateRows = found.rows;
        }

        if (candidateRows.length < CANDIDATE_COUNT) {
            record(
                "find_candidates",
                false,
                `Found ${candidateRows.length} eligible road(s); need ${CANDIDATE_COUNT}.`
            );
            throw new Error("Not enough candidates");
        }
        candidateRows = candidateRows.slice(0, CANDIDATE_COUNT);
        const candidateIds = candidateRows.map((r) => String(r.id));
        printSqlEvidence("selected road candidates", candidateRows);
        record(
            "find_candidates",
            true,
            `Using ${candidateIds.length} road candidate(s): ${candidateIds.join(", ")}.`
        );

        const api = {
            async patchColumns(candidateId, fields) {
                const body = {
                    review_batch_id: REVIEW_BATCH_ID,
                    fields,
                    review_note: PROMOTION_NOTE,
                };
                const { resp, json, url } = await apiRequest(
                    "PATCH",
                    `/api/import-review/roads/${candidateId}`,
                    body
                );
                if (resp.status < 200 || resp.status >= 300) {
                    throw new Error(
                        `PATCH columns failed HTTP ${resp.status} (${url}): ${JSON.stringify(json)}`
                    );
                }
                return json;
            },
            async patchDecisionApproved(candidateId) {
                const body = {
                    review_batch_id: REVIEW_BATCH_ID,
                    review_decision: "approved",
                    review_note: PROMOTION_NOTE,
                    confirm_duplicate_reviewed: true,
                    confirm_routing_warnings: true,
                };
                const { resp, json, url } = await apiRequest(
                    "PATCH",
                    `/api/import-review/roads/${candidateId}/decision`,
                    body
                );
                if (resp.status < 200 || resp.status >= 300) {
                    throw new Error(
                        `PATCH decision failed HTTP ${resp.status} (${url}): ${JSON.stringify(json)}`
                    );
                }
                return json;
            },
        };

        for (const row of candidateRows) {
            const id = String(row.id);
            if (!SKIP_TYPED_PATCH) {
                const patchNotes = await ensureRoadTyped(db, row, api);
                record(
                    `ensure_typed_${id}`,
                    true,
                    patchNotes.length ? patchNotes.join(", ") : "Already sufficient."
                );
            }
            if (
                normalizeStatus(row.review_decision) !== "approved" ||
                normalizeStatus(row.review_status) !== "approved"
            ) {
                await api.patchDecisionApproved(id);
                record(`approve_${id}`, true, "Set review_decision=approved.");
            } else {
                record(`approve_${id}`, true, "Already approved.");
            }
            const eligibleCheck = await db.query(
                `
                SELECT id FROM import_review.road_candidates AS c
                WHERE c.id = $1::bigint ${eligibleForPublishBatchSql("road_candidates", "c.id")}
                `,
                [id]
            );
            if (!eligibleCheck.rows[0]) {
                record(`eligibility_${id}`, false, "Not eligible for publish batch create.");
                throw new Error(`Candidate ${id} not eligible`);
            }
            record(`eligibility_${id}`, true, "Eligible for batch create.");
        }

        const batchName = `smoke-road-selected-${candidateIds.length}-${Date.now()}`;
        const createBody = {
            review_batch_id: String(REVIEW_BATCH_ID),
            mode: "selected",
            families: [FAMILY],
            candidate_ids_by_family: {
                [FAMILY]: candidateIds,
            },
            batch_name: batchName,
            note: PROMOTION_NOTE,
            ...ROAD_BATCH_LIMITS_CONFIRMATION,
            dry_run: false,
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
            record("create_batch", false, "Missing publish_batch_id.", createRes.json);
            throw new Error("no batch id");
        }
        record(
            "create_batch",
            true,
            `publish batch id=${publishBatchId} items=${createRes.json?.items_added ?? candidateIds.length}.`
        );

        const validateStart = await apiRequest(
            "POST",
            `/api/import-review/promotion/batches/${publishBatchId}/validate`,
            ROAD_BATCH_LIMITS_CONFIRMATION
        );
        if (validateStart.resp.status < 200 || validateStart.resp.status >= 300) {
            record("validate_start", false, `HTTP ${validateStart.resp.status}`, validateStart.json);
            throw new Error("validate failed");
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
        const validationResult = validateDone.validation_result;
        const vrOk = batchValidationPromotable(validationResult);
        record(
            "validation_result",
            vrOk && normalizeStatus(validateDone.status) !== "failed",
            `status=${validateDone.status} outcome=${validationResult?.outcome ?? "?"}`,
            validationResult
        );
        if (!vrOk || normalizeStatus(validateDone.status) === "failed") {
            throw new Error("Batch validation not promotable");
        }

        const dryRunRes = await apiRequest(
            "POST",
            `/api/import-review/promotion/batches/${publishBatchId}/road-dry-run`,
            { revalidate: true, include_warnings: false }
        );
        if (dryRunRes.resp.status < 200 || dryRunRes.resp.status >= 300) {
            record("road_dry_run", false, `HTTP ${dryRunRes.resp.status}`, dryRunRes.json);
            throw new Error("road dry-run failed");
        }
        const roadDry = dryRunRes.json?.road_dry_run ?? dryRunRes.json?.summary?.road_dry_run;
        const routingReady =
            dryRunRes.json?.routing_readiness_validation ??
            dryRunRes.json?.summary?.routing_readiness_validation;
        const dryOk = roadDryRunPassed(roadDry);
        const routingOk = routingReadinessPassed(routingReady);
        record(
            "road_dry_run",
            dryOk,
            `status=${roadDry?.status ?? "?"} checked=${roadDry?.checked_count ?? "?"} failed=${roadDry?.failed_count ?? "?"}`,
            roadDry
        );
        record(
            "routing_readiness",
            routingOk,
            `status=${routingReady?.status ?? "?"} type=${routingReady?.type ?? "?"} failed=${routingReady?.failed_count ?? "?"}`,
            routingReady
        );
        if (!dryOk || !routingOk) {
            throw new Error("Road dry-run or routing readiness did not pass");
        }

        const needsWarningConfirm =
            (validationResult?.warning_count ?? 0) > 0 ||
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
        const promotedOk =
            batchTerminal === "promoted" ||
            batchTerminal === "partially_promoted" ||
            (promoteDone.promotion_result?.success_count ?? 0) >= candidateIds.length;
        record(
            "promote_complete",
            promotedOk,
            `batch status=${batchTerminal} success=${promoteDone.promotion_result?.success_count ?? "?"} failed=${promoteDone.promotion_result?.failed_count ?? "?"}`,
            promoteDone.promotion_result
        );
        if (!promotedOk) {
            throw new Error("Promotion did not complete successfully");
        }

        const evidence = await fetchPublishBatchEvidence(
            db,
            publishBatchId,
            candidateIds.map((id) => BigInt(id))
        );
        printSqlEvidence("system_publish_items after promote", evidence.items);
        printSqlEvidence("batch summary", [evidence.batch]);

        for (const id of candidateIds) {
            const v = await verifyCandidatePromotion(db, id, evidence.items);
            record(
                `candidate_promoted_${id}`,
                v.candPromoted && v.hasCoreId,
                `promotion_status=${v.cand?.promotion_status} promoted_core_id=${v.cand?.promoted_core_id ?? "null"}`,
                v.cand
            );
            record(
                `publish_item_${id}`,
                v.spiOk && v.targetOk,
                `publish_status=${v.spi?.publish_status} target_id=${v.spi?.target_id ?? "null"}`,
                v.spi
            );
            record(
                `core_street_${id}`,
                v.coreExists,
                v.coreId ? `core.core_streets id=${v.coreId}` : "No core row id"
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

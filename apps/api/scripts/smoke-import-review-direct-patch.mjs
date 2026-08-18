#!/usr/bin/env node
/**
 * Import-review direct PATCH smoke test.
 *
 * Runs list -> PATCH -> detail verification across direct PATCH families.
 *
 * Usage:
 *   API_BASE_URL=http://localhost:3001 ADMIN_TOKEN=... node apps/api/scripts/smoke-import-review-direct-patch.mjs
 *
 * Environment:
 *   - API_BASE_URL (optional): defaults to http://localhost:3001
 *   - ADMIN_TOKEN (optional placeholder supported):
 *       if not set, a documented placeholder token is used and requests will likely return 401/403
 *       unless your local server is configured to accept it.
 *   - REVIEW_BATCH_ID (optional): defaults to 2
 */

const API_BASE_URL = (process.env.API_BASE_URL ?? "http://localhost:3001").replace(/\/+$/, "");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? "__SET_ADMIN_TOKEN__";
const REVIEW_BATCH_ID = Number.parseInt(process.env.REVIEW_BATCH_ID ?? "2", 10);

const TOKEN_PLACEHOLDER = "__SET_ADMIN_TOKEN__";
const PATCH_SUFFIX = ` [smoke ${new Date().toISOString()}]`;
const IMPORT_REVIEW_ADMIN_TOKEN_HEADER = "x-import-review-admin-token";

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
const ADDRESS_FAMILY_PATH = "addresses";

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

async function readJsonResponse(resp) {
    const rawText = await resp.text();
    if (rawText.includes("Do not know how to serialize a BigInt")) {
        throw new Error("Response contains BigInt serialization runtime error");
    }

    let json = null;
    if (rawText.trim() !== "") {
        try {
            json = JSON.parse(rawText);
        } catch (err) {
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

async function apiPost(path, body) {
    const url = `${API_BASE_URL}${path}`;
    const resp = await fetch(url, {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify(body),
    });
    const payload = await readJsonResponse(resp);
    return { resp, ...payload, url };
}

function appendSuffix(value, suffix) {
    if (typeof value === "string" && value.trim() !== "") {
        return `${value}${suffix}`;
    }
    return `smoke${suffix}`;
}

function buildNamePatch(item) {
    const hasNameEn = typeof item.name_en === "string";
    const hasNameMm = typeof item.name_mm === "string";

    if (hasNameEn || (!hasNameMm && !hasNameEn)) {
        return {
            field: "name_en",
            value: appendSuffix(item.name_en, PATCH_SUFFIX),
        };
    }

    return {
        field: "name_mm",
        value: appendSuffix(item.name_mm, PATCH_SUFFIX),
    };
}

function buildFamilyPatch(family, item) {
    if (family === "routing_barriers") {
        if (typeof item.class_code === "string" && item.class_code.trim() !== "") {
            return {
                field: "class_code",
                value: appendSuffix(item.class_code, PATCH_SUFFIX),
            };
        }
        if (typeof item.name === "string" && item.name.trim() !== "") {
            return {
                field: "barrier_type",
                value: appendSuffix(item.name, PATCH_SUFFIX),
            };
        }
        return {
            field: "barrier_type",
            value: `barrier${PATCH_SUFFIX}`,
        };
    }

    return buildNamePatch(item);
}

function applyRequiredFieldPreservation(family, item, fields) {
    const preserved = { ...fields };

    if (family === "landuse") {
        if (item.land_area_class_id !== null && item.land_area_class_id !== undefined) {
            preserved.land_area_class_id = item.land_area_class_id;
        }
        if (typeof item.class_code === "string" && item.class_code.trim() !== "") {
            preserved.class_code = item.class_code;
        }
    }

    return preserved;
}

function assert2xx(resp, family, context) {
    if (resp.status < 200 || resp.status >= 300) {
        throw new Error(`${family} ${context} failed: HTTP ${resp.status}`);
    }
}

function getCandidateId(item) {
    const id = item?.id;
    if (typeof id === "string" || typeof id === "number" || typeof id === "bigint") {
        return String(id);
    }
    throw new Error("Candidate id missing in list response");
}

function assertFieldValue(item, field, expected, context) {
    const actual = item?.[field];
    if (String(actual) !== String(expected)) {
        throw new Error(`${context}: expected ${field}=${String(expected)}, got ${String(actual)}`);
    }
}

async function fetchOneCandidate(family) {
    const { resp, json, url } = await apiGet(`/api/import-review/${family}`, {
        review_batch_id: REVIEW_BATCH_ID,
        limit: 1,
        offset: 0,
        include_geometry: false,
    });

    assert2xx(resp, family, "list");
    ensureTruthy(json && Array.isArray(json.items), `${family} list response missing items[] (${url})`);

    const candidate = json.items[0];
    if (!candidate) {
        throw new Error(`${family} has no candidates in review_batch_id=${REVIEW_BATCH_ID}`);
    }
    return candidate;
}

async function smokeFamily(family) {
    const listItem = await fetchOneCandidate(family);
    const candidateId = getCandidateId(listItem);
    const patchPlan = buildFamilyPatch(family, listItem);

    const fields = applyRequiredFieldPreservation(
        family,
        listItem,
        { [patchPlan.field]: patchPlan.value }
    );

    const patchBody = {
        review_batch_id: REVIEW_BATCH_ID,
        latest: false,
        fields,
        review_note: `Smoke direct PATCH ${family}`,
    };

    const patchResult = await apiPatch(`/api/import-review/${family}/${candidateId}`, patchBody);
    assert2xx(patchResult.resp, family, "patch");
    ensureTruthy(patchResult.json && typeof patchResult.json === "object", `${family} patch response missing JSON object`);
    assertFieldValue(patchResult.json, patchPlan.field, patchPlan.value, `${family} patch response mismatch`);

    const detailResult = await apiGet(`/api/import-review/${family}/${candidateId}`, {
        review_batch_id: REVIEW_BATCH_ID,
        include_geometry: false,
    });
    assert2xx(detailResult.resp, family, "detail");
    ensureTruthy(detailResult.json && typeof detailResult.json === "object", `${family} detail response missing JSON object`);
    assertFieldValue(detailResult.json, patchPlan.field, patchPlan.value, `${family} detail persisted mismatch`);

    return {
        family,
        candidateId,
        field: patchPlan.field,
        value: patchPlan.value,
    };
}

function assertAddressValidationStructured400(json) {
    const details = json?.details;
    if (!details || typeof details !== "object") {
        throw new Error("addresses validate invalid-body response missing details object");
    }
    const validationErrors = details.validation_errors;
    if (!Array.isArray(validationErrors) || validationErrors.length === 0) {
        throw new Error("addresses validate invalid-body response missing details.validation_errors[]");
    }
    const first = validationErrors[0];
    if (!first || typeof first !== "object") {
        throw new Error("addresses validate details.validation_errors[0] is not object");
    }
    if (typeof first.field !== "string" || first.field.trim() === "") {
        throw new Error("addresses validate details.validation_errors[0].field missing");
    }
    if (typeof first.message !== "string" || first.message.trim() === "") {
        throw new Error("addresses validate details.validation_errors[0].message missing");
    }
    if (typeof first.severity !== "string" || first.severity.trim() === "") {
        throw new Error("addresses validate details.validation_errors[0].severity missing");
    }
}

async function smokeAddressValidation() {
    const listResult = await apiGet(`/api/import-review/${ADDRESS_FAMILY_PATH}`, {
        review_batch_id: REVIEW_BATCH_ID,
        limit: 1,
        offset: 0,
        include_geometry: false,
    });
    assert2xx(listResult.resp, ADDRESS_FAMILY_PATH, "list");
    ensureTruthy(
        listResult.json && Array.isArray(listResult.json.items),
        `addresses list response missing items[] (${listResult.url})`
    );
    const candidate = listResult.json.items[0];
    if (!candidate) {
        throw new Error(`addresses has no candidates in review_batch_id=${REVIEW_BATCH_ID}`);
    }
    const candidateId = getCandidateId(candidate);

    const validateResult = await apiPost("/api/import-review/addresses/validate", {
        candidate_ids: [candidateId],
    });
    assert2xx(validateResult.resp, ADDRESS_FAMILY_PATH, "validate");
    ensureTruthy(
        validateResult.json && typeof validateResult.json === "object",
        "addresses validate response missing JSON object"
    );
    ensureTruthy(Array.isArray(validateResult.json.results), "addresses validate response missing results[]");
    const candidateResult = validateResult.json.results.find(
        (row) => row && typeof row === "object" && String(row.address_candidate_id) === candidateId
    );
    if (!candidateResult) {
        throw new Error("addresses validate response does not include tested candidate_id");
    }

    // Intentionally invalid payload: both fields should trigger structured 400 validation issue.
    const invalidResult = await apiPost("/api/import-review/addresses/validate", {
        review_batch_id: String(REVIEW_BATCH_ID),
        candidate_ids: [candidateId],
    });
    if (invalidResult.resp.status !== 400) {
        throw new Error(
            `addresses validate invalid payload expected HTTP 400, got HTTP ${invalidResult.resp.status}`
        );
    }
    ensureTruthy(invalidResult.json && typeof invalidResult.json === "object", "addresses invalid response missing JSON");
    assertAddressValidationStructured400(invalidResult.json);

    return {
        family: "addresses_validate",
        candidateId,
    };
}

async function main() {
    log(`API_BASE_URL=${API_BASE_URL}`);
    log(`REVIEW_BATCH_ID=${REVIEW_BATCH_ID}`);
    if (ADMIN_TOKEN === TOKEN_PLACEHOLDER) {
        log(
            `ADMIN_TOKEN is not set. Using placeholder (${TOKEN_PLACEHOLDER}). ` +
            `Set ADMIN_TOKEN to your import-review admin token for real auth.`
        );
    }

    const results = [];
    let failures = 0;

    for (const family of FAMILIES) {
        try {
            const ok = await smokeFamily(family);
            results.push({ ok: true, ...ok });
            log(`PASS ${family}: candidate=${ok.candidateId} field=${ok.field}`);
        } catch (err) {
            failures += 1;
            const message = err instanceof Error ? err.message : String(err);
            results.push({ ok: false, family, error: message });
            fail(`FAIL ${family}: ${message}`);
        }
    }

    try {
        const addressOk = await smokeAddressValidation();
        results.push({ ok: true, ...addressOk });
        log(`PASS ${addressOk.family}: candidate=${addressOk.candidateId}`);
    } catch (err) {
        failures += 1;
        const message = err instanceof Error ? err.message : String(err);
        results.push({ ok: false, family: "addresses_validate", error: message });
        fail(`FAIL addresses_validate: ${message}`);
    }

    log("");
    log("Summary:");
    for (const row of results) {
        if (row.ok) {
            log(`  PASS ${row.family}`);
        } else {
            log(`  FAIL ${row.family}: ${row.error}`);
        }
    }

    if (failures > 0) {
        process.exitCode = 1;
    } else {
        log("All family direct PATCH smoke checks passed.");
    }
}

main().catch((err) => {
    fail(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
});

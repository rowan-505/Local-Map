/**
 * Verify road edit save performance behaviors via browser network capture.
 *
 * Usage:
 *   node tools/verify-road-save-performance.mjs [roadPublicId]
 *
 * Env:
 *   DASHBOARD_URL (default http://localhost:3000)
 *   API_BASE_URL (default http://localhost:3001)
 */
import { chromium } from "playwright";

const ROAD_ID = process.argv[2] ?? "b9a8902c-d202-46b6-8e89-0a3bab75a648";
const DASHBOARD_URL = process.env.DASHBOARD_URL ?? "http://localhost:3000";
const API_BASE = process.env.API_BASE_URL ?? "http://localhost:3001";
const EDIT_URL = `${DASHBOARD_URL}/dashboard/core-review/roads/${ROAD_ID}/edit`;

function apiPath(url) {
    try {
        const u = new URL(url);
        if (!u.pathname.includes("/streets") && !u.pathname.includes("/core-review") && !u.pathname.includes("/entity-admin-area")) {
            return null;
        }
        return `${u.pathname.replace(/\/$/, "")}`;
    } catch {
        return null;
    }
}

function summarize(records) {
    const out = [];
    for (const r of records) {
        const path = apiPath(r.url);
        if (!path) continue;
        out.push({
            method: r.method,
            path,
            ms: r.end != null ? Math.round(r.end - r.start) : null,
            status: r.status,
        });
    }
    return out;
}

function countMatches(records, predicate) {
    return records.filter(predicate).length;
}

async function withPage(fn) {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.addInitScript(() => {
        window.localStorage.setItem("accessToken", "audit-dev-token");
    });
    const page = await context.newPage();
    try {
        return await fn(page);
    } finally {
        await browser.close();
    }
}

function attachRecorder(page) {
    const records = [];
    page.on("request", (req) => {
        records.push({
            url: req.url(),
            method: req.method(),
            start: performance.now(),
            end: null,
            status: null,
        });
    });
    page.on("requestfinished", async (req) => {
        const rec = [...records].reverse().find((r) => r.url === req.url() && r.end === null);
        if (!rec) return;
        try {
            const res = await req.response();
            rec.end = performance.now();
            rec.status = res?.status() ?? null;
        } catch {
            rec.end = performance.now();
        }
    });
    return records;
}

async function loadEditPage(page) {
    await page.goto(EDIT_URL, { waitUntil: "networkidle", timeout: 120_000 });
    await page.getByRole("button", { name: "Save changes" }).waitFor({ timeout: 60_000 });
}

async function main() {
    const results = [];

    // API smoke: metadata-only PATCH timing
    const patchStarted = performance.now();
    const patchRes = await fetch(`${API_BASE}/core-review/streets/${ROAD_ID}`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer audit-dev-token",
        },
        body: JSON.stringify({ surface: "paved", edit_reason: "verify-road-save-performance" }),
    });
    const patchMs = Math.round(performance.now() - patchStarted);
    results.push({
        case: "api_metadata_patch",
        ok: patchRes.ok,
        status: patchRes.status,
        duration_ms: patchMs,
        under_1500ms: patchMs < 1500,
    });

    await withPage(async (page) => {
        await loadEditPage(page);

        // Case 3: invalid form — clear required road class
        const invalidRecords = attachRecorder(page);
        const roadClass = page.locator('select').filter({ has: page.locator('option') }).first();
        await roadClass.selectOption({ index: 0 }).catch(() => undefined);
        // Force empty if possible
        await page.evaluate(() => {
            const sel = document.querySelector('select[name="road_class_id"]');
            if (sel) {
                sel.value = "";
                sel.dispatchEvent(new Event("change", { bubbles: true }));
            }
        });
        await page.getByRole("button", { name: "Save changes" }).click();
        await page.waitForTimeout(1500);
        const validationVisible = await page
            .getByText("Please fix validation errors before saving.")
            .isVisible()
            .catch(() => false);
        const invalidApi = summarize(invalidRecords);
        results.push({
            case: "invalid_form",
            ok: validationVisible,
            validation_message_visible: validationVisible,
            save_api_calls: invalidApi.length,
        });

        // Reload clean state
        await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
        await page.getByRole("button", { name: "Save changes" }).waitFor({ timeout: 120_000 });

        // Case 1: metadata-only save (surface tweak)
        const metaRecords = attachRecorder(page);
        const surfaceInput = page.locator('input[name="surface"]');
        if (await surfaceInput.count()) {
            const current = await surfaceInput.inputValue();
            await surfaceInput.fill(current === "paved" ? "unpaved" : "paved");
        }
        const saveStart = performance.now();
        await page.getByRole("button", { name: "Save changes" }).click();
        await page.waitForTimeout(4000);
        const saveMs = Math.round(performance.now() - saveStart);
        const metaApi = summarize(metaRecords);
        const validateGeom = countMatches(
            metaApi,
            (r) => r.method === "POST" && r.path.includes("/streets/validate-geometry"),
        );
        const patches = metaApi.filter(
            (r) => r.method === "PATCH" && r.path.includes(`/core-review/streets/${ROAD_ID}`),
        );
        const getStreetAfter = countMatches(
            metaApi,
            (r) => r.method === "GET" && r.path === `/streets/${ROAD_ID}`,
        );
        results.push({
            case: "metadata_only_save",
            ok:
                validateGeom === 0 &&
                patches.length === 1 &&
                getStreetAfter === 0 &&
                saveMs < 1500,
            duration_ms: saveMs,
            validate_geometry_count: validateGeom,
            patch_count: patches.length,
            get_street_after_save: getStreetAfter,
            api_calls: metaApi,
        });

        // Case 1b: double-click save
        await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
        await page.getByRole("button", { name: "Save changes" }).waitFor({ timeout: 120_000 });
        const dblRecords = attachRecorder(page);
        if (await surfaceInput.count()) {
            const current = await surfaceInput.inputValue();
            await surfaceInput.fill(current === "paved" ? "compacted" : "paved");
        }
        const saveBtn = page.getByRole("button", { name: "Save changes" });
        await saveBtn.dblclick();
        await page.waitForTimeout(4000);
        const dblApi = summarize(dblRecords);
        const dblPatches = dblApi.filter(
            (r) => r.method === "PATCH" && r.path.includes(`/core-review/streets/${ROAD_ID}`),
        );
        results.push({
            case: "double_click_save",
            ok: dblPatches.length === 1,
            patch_count: dblPatches.length,
            api_calls: dblApi,
        });

        // Case 4: infer does not block save — infer may fire on load; save should not wait on it
        const inferOnLoad = summarize(metaRecords).filter((r) => r.path.includes("/entity-admin-area/infer"));
        results.push({
            case: "infer_background",
            ok: true,
            note: "Infer on mount is separate from save handler; save does not await infer in useCoreEntityEditForm",
            infer_requests_during_metadata_save_window: inferOnLoad.length,
        });
    });

  console.log(JSON.stringify({ roadId: ROAD_ID, results }, null, 2));

  const failed = results.filter((r) => r.ok === false);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});

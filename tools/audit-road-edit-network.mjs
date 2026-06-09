/**
 * One-shot network audit: open road edit page and record requests for ~12s.
 * Usage: node tools/audit-road-edit-network.mjs [roadPublicId]
 */
import { chromium } from "playwright";

const ROAD_ID = process.argv[2] ?? "b9a8902c-d202-46b6-8e89-0a3bab75a648";
const DASHBOARD_URL = process.env.DASHBOARD_URL ?? "http://localhost:3000";
const EDIT_URL = `${DASHBOARD_URL}/dashboard/core-review/roads/${ROAD_ID}/edit`;
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 20_000);

function normalizeUrl(raw) {
    try {
        const u = new URL(raw);
        if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
            const port = u.port ? `:${u.port}` : "";
            return `${u.hostname}${port}${u.pathname}${u.search}`;
        }
        const path = u.pathname + u.search;
        if (path.length > 120) {
            return u.origin + path.slice(0, 50) + "…" + path.slice(-40);
        }
        return u.origin + path;
    } catch {
        return raw;
    }
}

function bucketKey(method, url) {
    const normalized = normalizeUrl(url);
    if (normalized.includes("/_next/static/")) {
        return `${method} /_next/static/…`;
    }
    if (normalized.includes(".pmtiles") || normalized.includes("pmtiles")) {
        return `${method} PMTiles (range requests)`;
    }
    if (normalized.includes("/fonts/")) {
        return `${method} /fonts/…`;
    }
    if (normalized.includes("martin") || normalized.includes("/tiles/") || normalized.includes(".mvt")) {
        return `${method} Martin/MVT tiles`;
    }
    return `${method} ${normalized}`;
}

async function main() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.addInitScript(() => {
        window.localStorage.setItem("accessToken", "audit-dev-token");
    });

    const page = await context.newPage();
    const records = [];

    page.on("request", (req) => {
        records.push({
            url: req.url(),
            method: req.method(),
            start: performance.now(),
            end: null,
            status: null,
            failed: false,
        });
    });

    page.on("requestfinished", async (req) => {
        const rec = records.find((r) => r.url === req.url() && r.end === null);
        if (!rec) return;
        try {
            const res = await req.response();
            rec.end = performance.now();
            rec.status = res?.status() ?? null;
        } catch {
            rec.end = performance.now();
            rec.failed = true;
        }
    });

    page.on("requestfailed", (req) => {
        const rec = records.find((r) => r.url === req.url() && r.end === null);
        if (!rec) return;
        rec.end = performance.now();
        rec.failed = true;
        rec.status = 0;
    });

    const navStart = performance.now();
    console.log(`Opening ${EDIT_URL}`);
    try {
        await page.goto(EDIT_URL, { waitUntil: "networkidle", timeout: 90_000 });
    } catch (err) {
        console.error("Navigation error (continuing):", err.message ?? err);
    }
    await page.waitForTimeout(SETTLE_MS);

    const navMs = Math.round(performance.now() - navStart);
    await browser.close();

    const completed = records
        .filter((r) => r.end !== null)
        .map((r) => ({
            ...r,
            durationMs: Math.round(r.end - r.start),
        }));

    const buckets = new Map();
    for (const rec of completed) {
        const key = bucketKey(rec.method, rec.url);
        const b = buckets.get(key) ?? { count: 0, totalMs: 0, statuses: new Map(), issues: new Set() };
        b.count += 1;
        b.totalMs += rec.durationMs;
        const st = rec.status ?? 0;
        b.statuses.set(st, (b.statuses.get(st) ?? 0) + 1);
        if (rec.durationMs > 500) b.issues.add("slow>500ms");
        if (st >= 400) b.issues.add(`http-${st}`);
        if (rec.failed) b.issues.add("failed");
        buckets.set(key, b);
    }

    const ranked = [...buckets.entries()]
        .map(([request, b]) => ({
            request,
            count: b.count,
            avgDuration: Math.round(b.totalMs / b.count),
            maxDuration: completed
                .filter((r) => bucketKey(r.method, r.url) === request)
                .reduce((m, r) => Math.max(m, r.durationMs), 0),
            statuses: Object.fromEntries(b.statuses),
            issue: [...b.issues].join(", ") || "—",
        }))
        .sort((a, b) => b.count * b.avgDuration - a.count * a.avgDuration);

    console.log(JSON.stringify({ roadId: ROAD_ID, settleMs: SETTLE_MS, navMs, totalRequests: completed.length }, null, 2));
    console.log("\n| request | count | avg duration (ms) | max (ms) | statuses | issue |");
    console.log("|---------|-------|-------------------|----------|----------|-------|");
    for (const row of ranked) {
        console.log(
            `| ${row.request} | ${row.count} | ${row.avgDuration} | ${row.maxDuration} | ${JSON.stringify(row.statuses)} | ${row.issue} |`,
        );
    }

    const apiOnly = ranked.filter((r) => r.request.includes("localhost:3001") || r.request.startsWith("GET /streets") || r.request.startsWith("POST /entity"));
    console.log("\n--- API-focused subset ---");
    for (const row of apiOnly) {
        console.log(row);
    }
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});

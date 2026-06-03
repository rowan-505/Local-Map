#!/usr/bin/env node
/**
 * Static regression: family import-review promotion repos must not call prisma.$transaction.
 * promoteAndCommitItem (import-review-promotion-promote.repo.ts) owns the sole commit transaction.
 *
 * Run from repo root:
 *   node tools/import-review/check-no-nested-promotion-transactions.mjs
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");

const SCAN_DIR = path.join(repoRoot, "apps/api/src/modules/import-review");

/** Files that may call $transaction (top-level promotion orchestration). */
const ORCHESTRATION_ALLOWLIST = new Set([
    "import-review-promotion-promote.repo.ts",
]);

const TRANSACTION_CALL_RE = /\.\$transaction\s*\(/;

const violations = [];

function listPromotionPromoteTsFiles(dir, acc = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            listPromotionPromoteTsFiles(full, acc);
            continue;
        }
        if (!entry.isFile()) {
            continue;
        }
        if (!entry.name.includes("promotion-promote")) {
            continue;
        }
        if (!entry.name.endsWith(".ts")) {
            continue;
        }
        if (entry.name.endsWith(".test.ts")) {
            continue;
        }
        acc.push(full);
    }
    return acc;
}

function isLineAllowed(lines, lineIndex) {
    const line = lines[lineIndex] ?? "";
    if (/promotion-allow-nested-transaction/.test(line)) {
        return true;
    }
    for (let i = Math.max(0, lineIndex - 2); i < lineIndex; i++) {
        if (/promotion-allow-nested-transaction/.test(lines[i] ?? "")) {
            return true;
        }
    }
    for (let i = lineIndex; i >= Math.max(0, lineIndex - 60); i--) {
        const prev = lines[i] ?? "";
        if (/Standalone\s*\(/.test(prev)) {
            return true;
        }
        if (/^\s*(export\s+)?async\s+function\s+\w*Standalone\b/.test(prev)) {
            return true;
        }
        if (/^\s*(async\s+)?\w+Standalone\s*\(/.test(prev)) {
            return true;
        }
        if (/^\s*\w+Standalone\s*=\s*async/.test(prev)) {
            return true;
        }
    }
    return false;
}

function scanFile(absPath) {
    const base = path.basename(absPath);
    if (ORCHESTRATION_ALLOWLIST.has(base)) {
        return;
    }

    const rel = path.relative(repoRoot, absPath).split(path.sep).join("/");
    const content = fs.readFileSync(absPath, "utf8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!TRANSACTION_CALL_RE.test(line)) {
            continue;
        }
        if (isLineAllowed(lines, i)) {
            continue;
        }
        violations.push({
            file: rel,
            line: i + 1,
            text: line.trim(),
        });
    }
}

function main() {
    if (!fs.existsSync(SCAN_DIR)) {
        console.error(`[nested-promotion-tx] FAIL: scan directory missing: ${SCAN_DIR}`);
        console.error("[nested-promotion-tx] Run from repo root or fix paths.");
        process.exit(1);
    }

    const files = listPromotionPromoteTsFiles(SCAN_DIR).sort();
    console.log(
        `[nested-promotion-tx] Scanning ${files.length} file(s) under apps/api/src/modules/import-review/*promotion-promote*.ts`
    );
    console.log(
        `[nested-promotion-tx] Allowed orchestration: ${[...ORCHESTRATION_ALLOWLIST].join(", ")}`
    );
    console.log(
        "[nested-promotion-tx] Per-line exceptions: // promotion-allow-nested-transaction or *Standalone* wrapper methods"
    );

    for (const file of files) {
        scanFile(file);
    }

    if (violations.length === 0) {
        console.log("\n[nested-promotion-tx] PASS: no nested prisma.$transaction in family promotion repos.");
        process.exit(0);
    }

    console.error(
        `\n[nested-promotion-tx] FAIL: ${violations.length} nested prisma.$transaction call(s) found:`
    );
    for (const v of violations) {
        console.error(`  ${v.file}:${v.line}  ${v.text}`);
    }
    console.error(
        "\n[nested-promotion-tx] Family repos run inside promoteAndCommitItem; use *Tx(db, …) helpers with the passed client."
    );
    console.error(
        "[nested-promotion-tx] To allow an exception, use a *Standalone method or add // promotion-allow-nested-transaction on that line."
    );
    process.exit(1);
}

main();

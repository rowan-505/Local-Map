/**
 * Full private JPEG upload against a running API + real R2.
 *
 * Prerequisites:
 *   1. Apply infrastructure/database/migrations/supabase/204_media_assets_and_report_media.sql
 *   2. API running with complete R2_* env (apps/api/.env — never commit secrets)
 *   3. Surveyor (or any authenticated) login:
 *        MEDIA_SMOKE_EMAIL / MEDIA_SMOKE_PASSWORD
 *
 * Optional attach:
 *        MEDIA_SMOKE_REPORT_PUBLIC_ID  (owned field_survey report)
 *
 * Usage:
 *   npm --prefix apps/api run smoke:media-private-upload
 *
 * Does not print presigned URLs or R2 secrets.
 */

import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(scriptDir, "../..");
const repoRoot = resolve(apiRoot, "../..");
config({ path: resolve(apiRoot, ".env") });
config({ path: resolve(repoRoot, ".env") });

const API_BASE = (process.env.MEDIA_SMOKE_API_BASE ?? process.env.PUBLIC_API_URL ?? "http://localhost:3001").replace(
    /\/+$/,
    ""
);
const email = process.env.MEDIA_SMOKE_EMAIL?.trim();
const password = process.env.MEDIA_SMOKE_PASSWORD?.trim();
const reportPublicId = process.env.MEDIA_SMOKE_REPORT_PUBLIC_ID?.trim();

/** Minimal JPEG envelope. R2 stores bytes; complete checks size, not pixels. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

async function readJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) {
        return null;
    }
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return { raw: text.slice(0, 200) };
    }
}

function codeOf(body: unknown): string | undefined {
    if (body && typeof body === "object" && "code" in body && typeof body.code === "string") {
        return body.code;
    }
    return undefined;
}

async function main(): Promise<void> {
    if (!email || !password) {
        throw new Error("Set MEDIA_SMOKE_EMAIL and MEDIA_SMOKE_PASSWORD (not committed).");
    }

    const loginRes = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
    });
    const loginBody = await readJson(loginRes);
    if (!loginRes.ok) {
        throw new Error(`Login failed HTTP ${loginRes.status} code=${codeOf(loginBody) ?? "none"}`);
    }
    const accessToken =
        loginBody && typeof loginBody === "object" && "accessToken" in loginBody && typeof loginBody.accessToken === "string"
            ? loginBody.accessToken
            : null;
    if (!accessToken) {
        throw new Error("Login response missing accessToken");
    }

    const auth = { authorization: `Bearer ${accessToken}`, "content-type": "application/json" };
    const createRes = await fetch(`${API_BASE}/media/uploads`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
            mediaType: "image",
            mimeType: "image/jpeg",
            byteSize: JPEG.length,
        }),
    });
    const createBody = await readJson(createRes);
    if (!createRes.ok) {
        throw new Error(`POST /media/uploads failed HTTP ${createRes.status} code=${codeOf(createBody) ?? "none"}`);
    }
    if (
        !createBody ||
        typeof createBody !== "object" ||
        !("publicId" in createBody) ||
        typeof createBody.publicId !== "string" ||
        !("upload" in createBody) ||
        !createBody.upload ||
        typeof createBody.upload !== "object" ||
        !("url" in createBody.upload) ||
        typeof createBody.upload.url !== "string" ||
        !("headers" in createBody.upload) ||
        !createBody.upload.headers ||
        typeof createBody.upload.headers !== "object"
    ) {
        throw new Error("Upload create response was missing publicId or upload.url");
    }

    const publicId = createBody.publicId;
    const putHeaders = createBody.upload.headers as Record<string, string>;
    const putRes = await fetch(createBody.upload.url, {
        method: "PUT",
        headers: putHeaders,
        body: JPEG,
    });
    if (!putRes.ok) {
        throw new Error(`Presigned PUT failed HTTP ${putRes.status}`);
    }

    const completeRes = await fetch(`${API_BASE}/media/${publicId}/complete`, {
        method: "POST",
        headers: auth,
    });
    const completeBody = await readJson(completeRes);
    if (!completeRes.ok) {
        throw new Error(`POST /media/:id/complete failed HTTP ${completeRes.status} code=${codeOf(completeBody) ?? "none"}`);
    }
    if (
        !completeBody ||
        typeof completeBody !== "object" ||
        !("status" in completeBody) ||
        completeBody.status !== "ready"
    ) {
        throw new Error("Complete did not return status=ready");
    }

    console.log(`media smoke: upload+complete ok publicId=${publicId} bytes=${JPEG.length}`);

    if (!reportPublicId) {
        console.log("media smoke: skip attach (MEDIA_SMOKE_REPORT_PUBLIC_ID unset)");
        return;
    }

    const attachRes = await fetch(`${API_BASE}/field/reports/${reportPublicId}/media`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ assetPublicId: publicId }),
    });
    const attachBody = await readJson(attachRes);
    if (!attachRes.ok) {
        throw new Error(`POST /field/reports/:id/media failed HTTP ${attachRes.status} code=${codeOf(attachBody) ?? "none"}`);
    }
    console.log(`media smoke: attach ok reportPublicId=${reportPublicId}`);
}

main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`media smoke failed: ${message}`);
    process.exitCode = 1;
});

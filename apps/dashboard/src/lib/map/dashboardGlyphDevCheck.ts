"use client";

import { dashDevLog } from "@/src/lib/dashDevLog";

const GLYPH_PROBE_PATHS = [
    "/fonts/NotoSansMyanmar-Regular/0-255.pbf",
    "/fonts/NotoSansMyanmar-Regular/4096-4351.pbf",
    "/fonts/NotoSansMyanmar-Regular/61440-61695.pbf",
] as const;

let hasLogged = false;

export function logDashboardGlyphServingHealthInDev(): void {
    if (process.env.NODE_ENV === "production" || hasLogged || typeof window === "undefined") {
        return;
    }

    hasLogged = true;

    void Promise.all(
        GLYPH_PROBE_PATHS.map(async (path) => {
            try {
                const res = await fetch(path);
                const buf = new Uint8Array(await res.arrayBuffer());
                const sniff =
                    typeof TextDecoder !== "undefined"
                        ? new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, 64))
                        : "";
                const looksLikeHtml =
                    sniff.trimStart().startsWith("<!DOCTYPE") ||
                    sniff.trimStart().startsWith("<html");

                dashDevLog("map:glyph-dev-check", {
                    path,
                    status: res.status,
                    bytes: buf.length,
                    contentType: res.headers.get("content-type"),
                });

                if (!res.ok || looksLikeHtml) {
                    console.warn("[dashboard:glyph-dev-check] Glyph probe failed", {
                        path,
                        status: res.status,
                        looksLikeHtml,
                    });
                }
            } catch (error) {
                console.warn("[dashboard:glyph-dev-check] Glyph probe request failed", path, error);
            }
        })
    );
}

#!/usr/bin/env npx tsx
/**
 * Deprecated: YRS Move uses a WebView; ADB UI dumps contain no route text.
 * Use the web extractor instead.
 */
import process from "node:process";

const WEB = "tools/data-pipeline/train-app-import/extract/extract-yrsmm-web.ts";

console.error(
    [
        "ADB route-list extraction is not supported for YRS Move (Flutter + InAppWebView).",
        "The app loads data from https://yrsmm.com — use the web extractor (no phone needed):",
        "",
        `  npx tsx ${WEB} --step index --language en`,
        `  npx tsx ${WEB} --step details --language en`,
        `  npx tsx ${WEB} --step index --language my`,
        `  npx tsx ${WEB} --step details --language my`,
        "",
        "Legacy ADB code (for reference only): extract/legacy-adb/extract-route-index.ts",
    ].join("\n"),
);

process.exit(1);

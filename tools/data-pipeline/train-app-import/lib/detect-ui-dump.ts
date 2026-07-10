/**
 * Detect unusable UIAutomator dumps (e.g. Flutter InAppWebView shell).
 */

export function isWebViewOnlyDump(xml: string): boolean {
    if (!xml.includes("<hierarchy")) {
        return false;
    }

    const hasWebView = /class="android\.webkit\.WebView"/.test(xml);
    if (!hasWebView) {
        return false;
    }

    const textNodes = [...xml.matchAll(/\btext="([^"]+)"/g)]
        .map((match) => match[1]?.trim() ?? "")
        .filter((text) => text.length > 0);

    return textNodes.length === 0;
}

export function webViewOnlyDumpMessage(): string {
    return [
        "The train app screen is a WebView (Flutter + InAppWebView).",
        "UIAutomator XML has no readable text, so ADB route-card parsing cannot work.",
        "",
        "Use the web extractor instead (same data as the app, from https://yrsmm.com):",
        "  npx tsx tools/data-pipeline/train-app-import/extract/extract-yrsmm-web.ts --step index --language en",
        "  npx tsx tools/data-pipeline/train-app-import/extract/extract-yrsmm-web.ts --step details --language en",
        "  npx tsx tools/data-pipeline/train-app-import/extract/extract-yrsmm-web.ts --step index --language my",
        "  npx tsx tools/data-pipeline/train-app-import/extract/extract-yrsmm-web.ts --step details --language my",
    ].join("\n");
}

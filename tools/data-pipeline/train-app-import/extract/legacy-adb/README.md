# Legacy ADB extraction (not supported)

YRS Move (`com.yangonrailwayservice.yrs`) renders routes inside an **InAppWebView**. UIAutomator XML dumps only contain an empty `android.webkit.WebView` node — no route text, even on the correct screen.

Use the web extractor instead:

```bash
npx tsx tools/data-pipeline/train-app-import/extract/extract-yrsmm-web.ts --step index --language en
npx tsx tools/data-pipeline/train-app-import/extract/extract-yrsmm-web.ts --step details --language en
```

These scripts are kept for reference and parser replay tests only. They are not part of the supported workflow.

# YBS Go ADB UI Extraction (Phase 4)

Extract visible bus route and stop data from the YBS Go Android app using ADB
`uiautomator` XML dumps.

This tool does **not** touch Supabase or the CoreMap database. It only writes
JSON, XML debug files, and reports under `tmp/transport-imports/ybs-all/`.

## Prerequisites

- `adb` installed and in your PATH
- Samsung phone connected (default device: `R3CX10JRQNZ`)
- YBS Go app installed (`com.ybsgo.app`)
- USB debugging enabled

## Hard safety rule: never refresh the route list

**Never pull down on the YBS route list.** It triggers broken refresh and causes
incomplete stop data. After a bad refresh, stop rows often show placeholders like
`မှတ်တိုင် အမှတ်: ####` + `N/A - N/A`.

YBS Go has a built-in bug: **refreshing or reloading the route list can cause
infinite loading**. There is no automated recovery from this state.

The automation must never:

- pull down on the route list (downward finger swipe: `startY < endY`)
- scroll to top on the route list (`scrollUpRouteList` is forbidden)
- force-refresh or reload the route list
- restart or relaunch the app as a normal recovery step

Allowed route list actions are only:

1. XML dump (`uiautomator`)
2. scroll down only (finger moves up: `startY > endY`)
3. tap a route card by XML bounds
4. back button from route detail to the list

`safeSwipe()` in `adb.ts` blocks forbidden gestures on the route list and logs
every swipe decision:

```text
[ybs-swipe] screen=route_list (540,800)->(540,1450) duration=380ms allowed=false reason=downward finger on route list can trigger pull-to-refresh
```

Screen detection: `detectYbsScreen(xml)` → `route_list` | `route_detail` |
`stop_detail` | `loading` | `unknown`.

Loading detection: `detectRouteListLoadingOrRefreshing(xml)`. When true,
scripts stop with `ROUTE_LIST_LOADING_OR_REFRESHING`.

Other hard-stop codes:

- `ROUTE_LIST_REFRESH_GESTURE_BLOCKED`
- `TARGET_ROUTE_ABOVE_CURRENT_POSITION_MANUAL_RESET_REQUIRED`

CLI safety flag (default **true** on all Stage 8 scripts):

```bash
--strict-no-route-list-refresh true
```

**Recovery is manual only:** restore the route list on the phone yourself without
pull-refresh, then re-run (batch: `--retry-failed`).

Open the route list manually before Stage 7 or Stage 8 runs. For batch runs,
position the list near the next route — automation continues from the current
list position and never scrolls back to the top.

## Active folders

| Path | Role |
|---|---|
| `tools/data-pipeline/transport-json-import/ybs-extraction/` | Active Phase 4 scripts |
| `tmp/transport-imports/ybs-all/` | Active extraction output |
| `tmp/transport-imports/ybs-2/` | **Legacy V1 test data only** — do not use for new work |
| `tmp/transport-imports/_backups/` | Cleanup snapshots |

Legacy script `tools/data-pipeline/transport-json-import/extract-ybs-ui.ts` is
deprecated. Use this folder instead. A copy is kept in `_archive/extract-ybs-ui-v1.ts`.

## Output layout

```text
tmp/transport-imports/ybs-all/
  raw-extracted.json              run manifest
  route-index/
    route-index-my.json
    route-index-en.json
    page-sources/
  my/
    routes/
    page-sources/
    screenshots/
  en/
    routes/
    page-sources/
    screenshots/
  merged/
    routes/
  reports/
```

## Scripts

| File | Role |
|---|---|
| `config.ts` | Paths, defaults, run layout helpers |
| `adb.ts` | ADB helpers: dump XML, `safeSwipe`, tap |
| `ybs-navigation-safety.ts` | Route-list refresh gesture guards |
| `parse-ui-xml.ts` | Parse TextViews, `detectYbsScreen`, pair stops, merge scroll dumps |
| `route-identity.ts` | Route code / duplicate policy |
| `route-card-match.ts` | Score visible list cards against index item |
| `route-index-store.ts` | Load route index JSON and find route by code |
| `english-route-name.ts` | Generate `route_name_en` from English endpoints |
| `extract-route-index.ts` | Stage 7: route list index |
| `open-route.ts` | Stage 8: open one route card from index |
| `extract-current-route.ts` | Stage 8: extract open route detail + variants |
| `extract-routes-batch.ts` | Stage 8: batch open + extract |
| `merge-language-routes.ts` | Merge Myanmar + English route JSON |
| `validate-route-identity.ts` | Stage 7/8 identity policy checks |
| `validate-phase4-output.ts` | Folder layout + route JSON quality checks |

Policy reference: [`route-identity.md`](route-identity.md)

## Run commands

Run from the repo root.

### Stage 7 — route index

Open the YBS route list screen first. Do not refresh the list.

```bash
npx tsx tools/data-pipeline/transport-json-import/ybs-extraction/extract-route-index.ts \
  --device R3CX10JRQNZ \
  --run tmp/transport-imports/ybs-all \
  --language my
```

Repeat with `--language en` after switching the app to English in Settings.

Output:

```text
tmp/transport-imports/ybs-all/route-index/route-index-my.json
tmp/transport-imports/ybs-all/route-index/page-sources/
```

### Stage 8 — open one route

Start on the YBS route list screen.

```bash
npx tsx tools/data-pipeline/transport-json-import/ybs-extraction/open-route.ts \
  --device R3CX10JRQNZ \
  --run tmp/transport-imports/ybs-all \
  --language my \
  --route-code YBS-70-A
```

### Stage 8 — extract currently open route

Open one route detail screen first (outbound tab visible).

```bash
npx tsx tools/data-pipeline/transport-json-import/ybs-extraction/extract-current-route.ts \
  --device R3CX10JRQNZ \
  --run tmp/transport-imports/ybs-all \
  --language en \
  --route-code YBS-1 \
  --direction both
```

Output:

```text
tmp/transport-imports/ybs-all/en/routes/YBS-1.json
tmp/transport-imports/ybs-all/en/page-sources/YBS-1/
```

### Stage 8 — batch open + extract

```bash
npx tsx tools/data-pipeline/transport-json-import/ybs-extraction/extract-routes-batch.ts \
  --device R3CX10JRQNZ \
  --run tmp/transport-imports/ybs-all \
  --language my \
  --from-index \
  --limit 5 \
  --skip-existing
```

Explicit route list:

```bash
npx tsx tools/data-pipeline/transport-json-import/ybs-extraction/extract-routes-batch.ts \
  --device R3CX10JRQNZ \
  --run tmp/transport-imports/ybs-all \
  --language my \
  --routes YBS-2,YBS-70-A
```

English batch before `route-index-en.json` exists:

```bash
npx tsx tools/data-pipeline/transport-json-import/ybs-extraction/extract-routes-batch.ts \
  --device R3CX10JRQNZ \
  --run tmp/transport-imports/ybs-all \
  --language en \
  --routes YBS-1 \
  --index-path tmp/transport-imports/ybs-all/route-index/route-index-my.json
```

Retry failed routes:

```bash
npx tsx tools/data-pipeline/transport-json-import/ybs-extraction/extract-routes-batch.ts \
  --device R3CX10JRQNZ \
  --run tmp/transport-imports/ybs-all \
  --language my \
  --retry-failed
```

Batch report:

```text
tmp/transport-imports/ybs-all/reports/extract-routes-batch-my.json
```

### Merge Myanmar + English

```bash
npx tsx tools/data-pipeline/transport-json-import/ybs-extraction/merge-language-routes.ts \
  --myanmar tmp/transport-imports/ybs-all/my/routes/YBS-1.json \
  --english tmp/transport-imports/ybs-all/en/routes/YBS-1.json \
  --run tmp/transport-imports/ybs-all
```

Output:

```text
tmp/transport-imports/ybs-all/merged/routes/YBS-1.json
```

### Safety dry-run (no device)

```bash
npx tsx tools/data-pipeline/transport-json-import/ybs-extraction/ybs-navigation-safety-dry-run.ts
node --import tsx --test tools/data-pipeline/transport-json-import/ybs-extraction/ybs-navigation-safety.test.ts
```

### Test YBS-2 after safety update

Position the phone on the route list near YBS-2 **without pull-refresh**, then:

```bash
npx tsx tools/data-pipeline/transport-json-import/ybs-extraction/extract-routes-batch.ts \
  --device R3CX10JRQNZ \
  --run tmp/transport-imports/ybs-all \
  --language my \
  --routes YBS-2 \
  --strict-no-route-list-refresh true
```

### Validate

Route identity policy:

```bash
npx tsx tools/data-pipeline/transport-json-import/ybs-extraction/validate-route-identity.ts \
  --run tmp/transport-imports/ybs-all \
  --language my
```

Full Phase 4 output check:

```bash
npx tsx tools/data-pipeline/transport-json-import/ybs-extraction/validate-phase4-output.ts \
  --run tmp/transport-imports/ybs-all \
  --language my
```

## Extraction rules

- Use visible UI XML only. Do not use OCR.
- Do not bypass private APIs or app security.
- Save every XML page source for debugging.
- Scroll until no new rows appear.
- Do not use the **All** tab for extraction.
- Myanmar mode fills `stop_name_my` / `area_text_my`.
- English mode fills `stop_name_en` / `area_text_en` and does not mirror English into Myanmar fields.
- `route_name_en` is generated from English endpoint stops, not from Myanmar detail titles.
- Do not mark extracted data as verified.

## Related docs

- Skill: `docs/ai/skills/transport-data-extraction/SKILL.md`
- Route identity: [`route-identity.md`](route-identity.md)

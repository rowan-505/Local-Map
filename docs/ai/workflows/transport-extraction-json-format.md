# Transport Extraction JSON Format

This document describes the JSON format for CoreMap external bus app extraction.

Use it when you extract visible bus route and stop data from an external app
and clean it as JSON. The cleaned JSON is the input for the CoreMap transport
import workflow.

- Do not write code from this document yet.
- Do not touch the database from this document.
- This is only the file format contract.

Follow the `transport-data-extraction` skill for the full rules.

## Where the file lives

Save the extracted JSON under:

```text
tmp/transport-imports/<source>_<date>/raw-extracted.json
```

Example: `tmp/transport-imports/ybs-2/raw-extracted.json`.

## Top-level shape

The JSON is one object with these top-level keys:

```text
{
  "source":   { ... }        // required
  "route":    { ... }        // required
  "variants": [ { ... } ]    // required, at least one variant
}
```

## `source` object

This records where the data came from.

### Required fields

| Field | Type | Meaning |
|---|---|---|
| `source_name` | string | Short source id, for example `external_ybs_app`. |
| `source_kind` | string | How it was collected, for example `visible_app_extraction`. |
| `captured_at` | string | ISO 8601 date-time in UTC, for example `2026-07-06T00:00:00Z`. |

### Optional fields

| Field | Type | Meaning |
|---|---|---|
| `source_method` | string | Tool used, for example `manual` or `appium`. |
| `source_url` | string | App or page reference if there is one. |
| `notes` | string | Any short human note about the capture. |

## `route` object

This is the bus route (the line as a whole).

### Required fields

| Field | Type | Meaning |
|---|---|---|
| `route_code` | string | Stable code for the route, for example `YBS-2`. |
| `mode` | string | Transport mode. Use `bus` or `express_bus`. |
| `route_name_my` | string | Route name in Myanmar. Use `null` only if truly not visible. |

### Optional fields

| Field | Type | Meaning |
|---|---|---|
| `route_number` | string | Public number, for example `2`. |
| `route_kind` | string | Sub-type, for example `local_bus`. |
| `route_name_en` | string or null | Route name in English. |
| `operator_code` | string | Operator short code, for example `YUPT`. |
| `operator_name` | string | Operator display name. |
| `fare_min` | number | Lowest fare seen. |
| `fare_max` | number | Highest fare seen. |
| `currency_code` | string | Currency, for example `MMK`. |

Do not guess fares, schedules, or live GPS. Leave them out if not visible.

## `variants` array

A route has one or more variants. A variant is one direction or one pattern
of the route (for example outbound and inbound).

### Required fields per variant

| Field | Type | Meaning |
|---|---|---|
| `variant_code` | string | Stable code, for example `YBS-2-outbound`. |
| `direction_name` | string | Human direction, for example `outbound`. |
| `origin_name` | string | Start point name. |
| `destination_name` | string | End point name. |
| `approx_start` | object | Start coordinate. See below. **Required.** |
| `approx_end` | object | End coordinate. See below. **Required.** |
| `stops` | array | List of stops in order. See below. |

### Optional fields per variant

| Field | Type | Meaning |
|---|---|---|
| `direction_id` | number | `0` for outbound, `1` for inbound. |

### `approx_start` and `approx_end`

Each is an object with two numbers:

| Field | Type | Range |
|---|---|---|
| `lng` | number | -180 to 180 |
| `lat` | number | -90 to 90 |

**Why these are required before DB insert:**

CoreMap needs geometry to store transport data. In the database,
`transport.stops.geom` is `NOT NULL` and `transport.route_paths.geom` is
`NOT NULL`. This means a stop or a route path cannot be saved without a
location.

Most external apps do not give exact coordinates for every stop. So the
import step builds **approximate geometry** first:

1. It makes a straight line from `approx_start` to `approx_end`.
2. It places each stop along that line by its `sequence` number.

Without `approx_start` and `approx_end`, the import cannot make this line,
so it cannot fill the required `geom` fields, and the insert will fail.

This geometry is only a rough guess. The import marks it as approximate
(`geom_status = "auto_approximate"`) and sets review status to
`needs_review`. A human fixes the real positions later in the existing
transport dashboard pages. Approximate data is never marked `verified`.

## `stops` array

Each variant has a list of stops in travel order.

### Required fields per stop

| Field | Type | Meaning |
|---|---|---|
| `sequence` | number | Order in the variant, starting at `1`. |
| `name_my` | string | Stop name in Myanmar. |

### Optional fields per stop

| Field | Type | Meaning |
|---|---|---|
| `name_en` | string | Stop name in English. |
| `area_text_my` | string | Area or road hint in Myanmar. |
| `area_text_en` | string | Area or road hint in English. |
| `raw_text` | string | Original raw text from the app. |

Note: stops usually have no real coordinates from the app. The import
generates their approximate points from the variant line. You do not add
`lng`/`lat` per stop in this file.

## Full example JSON

```json
{
  "source": {
    "source_name": "external_ybs_app",
    "source_kind": "visible_app_extraction",
    "source_method": "manual_or_appium",
    "captured_at": "2026-07-06T00:00:00Z"
  },
  "route": {
    "route_code": "YBS-2",
    "route_number": "2",
    "mode": "bus",
    "route_kind": "local_bus",
    "route_name_my": "(၂) ပင်တောက်ကုန်း - အောင်မင်္ဂလာအဝေးပြေး",
    "route_name_en": null,
    "operator_code": "YUPT",
    "operator_name": "YUPT",
    "fare_min": 350,
    "fare_max": 400,
    "currency_code": "MMK"
  },
  "variants": [
    {
      "variant_code": "YBS-2-outbound",
      "direction_id": 0,
      "direction_name": "outbound",
      "origin_name": "ပင်တောက်ကုန်း",
      "destination_name": "အောင်မင်္ဂလာအဝေးပြေး",
      "approx_start": {
        "lng": 96.00000,
        "lat": 16.00000
      },
      "approx_end": {
        "lng": 96.10000,
        "lat": 16.10000
      },
      "stops": [
        {
          "sequence": 1,
          "name_my": "ပင်တောက်ကုန်း",
          "name_en": "Padauk Kwae",
          "area_text_my": "ကျွန်းရွှေဝါလမ်း - ဒဂုံဆိပ်ကမ်း",
          "area_text_en": "Kyun Shwe Wah Road - Dagon Seikkan",
          "raw_text": "..."
        },
        {
          "sequence": 2,
          "name_my": "အောင်မင်္ဂလာအဝေးပြေး",
          "name_en": "Aung Mingalar Highway",
          "area_text_my": null,
          "area_text_en": null,
          "raw_text": "..."
        }
      ]
    }
  ]
}
```

## Quick checklist before import

- [ ] `source.source_name`, `source.source_kind`, `source.captured_at` are set.
- [ ] `route.route_code`, `route.mode`, `route.route_name_my` are set.
- [ ] There is at least one variant.
- [ ] Each variant has `approx_start` and `approx_end` with valid `lng`/`lat`.
- [ ] Each variant has stops in order, starting at `sequence` 1.
- [ ] No guessed fares, schedules, or live GPS.
- [ ] File saved under `tmp/transport-imports/<source>_<date>/`.

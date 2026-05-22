# Admin area boundary metadata and future address usage

This document describes how **boundary status** and **address usage** metadata on `core.core_admin_areas` should be interpreted by a future address-composition system. It is intended for backend, search, and map engineers — not end-user copy.

Related migrations:

- `infrastructure/database/migrations/supabase/037_core_admin_areas_boundary_metadata.sql`
- `infrastructure/database/migrations/supabase/038_ref_admin_area_boundary_metadata.sql`

**Address system (full stack):** see [address-architecture.md](./address-architecture.md) for import_review → core → search tables, component editing rules, and reverse lookup. Admin metadata in *this* doc feeds address **composition** only.

API ref endpoints (dashboard and future clients):

- `GET /admin/ref/boundary-statuses`
- `GET /admin/ref/address-usage-types`

Map / tiles (village labels only on the public basemap):

- `infrastructure/database/migrations/supabase/039_tiles_village_labels_admin_boundaries.sql`
- `tiles.tiles_village_labels_v` — one point per village; label text is name only (no boundary status on the map)
- `tiles.tiles_admin_boundaries_v` — excludes approximate / settlement_extent / unknown village polygons
- Rebuild PMTiles after applying migration 039: `bash infrastructure/tiles/pmtiles/scripts/export-region.sh yangon <version>` then `build-region.sh`

---

## 1. Purpose

Administrative areas in Myanmar — especially **villages** — often do not have a single, authoritative polygon that matches a legal or surveyed village boundary. Drawing a full village outline from guesswork creates **false precision**: users and downstream systems may treat an approximate footprint as if it were official.

`boundary_status` and `address_usage` exist to separate:

- **What the geometry represents** (trusted legal boundary vs built-up extent vs unknown)
- **How the area may be used in addresses** (official component vs locality hint vs search-only)

Together with `is_official_boundary`, `boundary_confidence_score` (0–100), and optional `boundary_note`, they let the address system assign components **honestly** — with explicit confidence and match type — instead of silently upgrading weak geometry to “official village.”

---

## 2. Ref tables and core storage

### Ref tables (source of truth for codes and labels)

| Table | Role |
|-------|------|
| `ref.ref_boundary_statuses` | Taxonomy of boundary **trust/type**. Drives dashboard defaults (`default_is_official_boundary`, `default_boundary_confidence_score`, `default_address_usage_code`). |
| `ref.ref_address_usage_types` | Taxonomy of **address-composition permission**. Controls whether an admin area may appear as an official address line, a locality hint, search-only, or not at all. |

Both tables use stable lowercase **codes** (e.g. `settlement_extent`, `locality_hint`), not numeric FKs on `core.core_admin_areas`. Labels (`name_en`, `name_mm`, `helper_en`, `helper_mm`) come from the DB and must not be hardcoded in clients.

### Core columns (`core.core_admin_areas`)

| Column | Type | Meaning |
|--------|------|---------|
| `boundary_status` | `text` | Code from `ref.ref_boundary_statuses.code` |
| `address_usage` | `text` | Code from `ref.ref_address_usage_types.code` |
| `is_official_boundary` | `boolean` | Whether the stored polygon should be treated as an official legal/admin boundary |
| `boundary_confidence_score` | `numeric` | Reviewer/import confidence in boundary quality and placement, **0–100** (not 0–1) |
| `boundary_note` | `text` | Optional reviewer note (source, caveats, why status was chosen) |

Admin area **names** for display continue to live in core name tables using language codes **`my`**, **`en`**, and **`und`** (undetermined/fallback). Address composition should resolve display names from those tables; boundary metadata does not replace naming.

---

## 3. Boundary statuses

Codes are stored on `core.core_admin_areas.boundary_status`. Default pairings below match migration 038 seeds; adjust only via ref table updates, not ad hoc string logic in application code.

| Code | Meaning | Typical `is_official_boundary` | Default score (seed) | Default `address_usage` |
|------|---------|-------------------------------|----------------------|-------------------------|
| `official` | Trusted official/legal administrative boundary | `true` | 90 | `official` |
| `surveyed` | Manually checked or field/satellite verified; may not be from a legal source | `true` | 85 | `official` |
| `approximate` | Estimated boundary; useful for map/search, not legally exact | `false` | 65 | `locality_hint` |
| `settlement_extent` | Visible built-up settlement area only — **not** an official village boundary | `false` | 60 | `locality_hint` |
| `unknown` | Boundary unknown; prefer centroid/point or parent area | `false` | 30 | `search_only` |

**Reviewer guidance (from ref helpers):**

- **`official`** — Trusted official/legal administrative boundary.
- **`surveyed`** — Verified by review or field work; still confirm provenance before treating as legal.
- **`approximate`** — Estimated polygon; do not imply legal exactness.
- **`settlement_extent`** — Built-up area only; common for Myanmar villages when the exact official boundary is unknown.
- **`unknown`** — No reliable polygon; use point/centroid and parent admin areas for search and fallback addressing.

---

## 4. Address usage types

Codes are stored on `core.core_admin_areas.address_usage`.

| Code | Meaning | Address composition |
|------|---------|---------------------|
| `official` | Safe to use as an **official** address/admin component when geometry and point-in-polygon support it | Include in structured address with high confidence when rules match |
| `locality_hint` | May appear in display as an **approximate** village/locality; lower confidence | Prefer wording like “Near …” rather than implying exact inclusion inside a legal boundary |
| `search_only` | Searchable/focusable on the map; **do not** auto-compose into addresses | Exclude from automatic address assignment |
| `disabled` | Do not use for address or search locality hints | Exclude entirely from address and locality pipelines |

`address_usage` is independent of admin level: a township may be `official`; a village with only a settlement footprint should usually be `locality_hint` even if the village is the most specific named place users expect.

---

## 5. Address assignment priority

When resolving an address for a point (building, place, geocoded pin), evaluate candidates in roughly this order. Always respect `address_usage` and `boundary_status`; never promote a weaker status silently.

### 5.1 Point inside polygon — official / surveyed

**Condition:** Point ∈ admin area polygon **and** `boundary_status` ∈ `{ official, surveyed }` **and** `address_usage` = `official`.

**Action:** Use as an **official address component** (e.g. village or ward in the hierarchy).

**Confidence:** High — typically derive from `boundary_confidence_score` and geometry match (see §6).

### 5.2 Point inside polygon — approximate / settlement extent

**Condition:** Point ∈ admin area polygon **and** `boundary_status` ∈ `{ approximate, settlement_extent }` **and** `address_usage` = `locality_hint`.

**Action:** Use as an **approximate village/locality component**, not as proof of official boundary membership.

**Confidence:** Medium — cap below official/surveyed ranges; reflect `boundary_confidence_score`.

### 5.3 Point near village centroid, not inside polygon

**Condition:** No containing polygon match with usable `address_usage`, but a village **centroid/point** is within a configured distance threshold.

**Action:** Use **nearest village as a low-confidence locality hint only** (`match_type` ≈ nearest-centroid). Do not claim point-in-polygon.

**Confidence:** Low–medium (see §6 “nearest village point”).

### 5.4 No reliable village

**Condition:** No acceptable village polygon or centroid match.

**Action:** Fall back to **parent** admin areas (village tract, township, district, region) that have `address_usage` = `official` or policy-allowed usage.

**Confidence:** Lower — township-only fallback band (see §6).

### 5.5 Exclusions

- Skip areas with `address_usage` = `search_only` or `disabled` for automatic composition.
- Skip areas where `is_official_boundary` = `false` when the pipeline step requires an **official** boundary claim — even if the label sounds authoritative.

---

## 6. Suggested confidence scoring

All scores use a **0–100** integer scale. Stored `boundary_confidence_score` on the admin area is the baseline; the address engine may adjust within these bands based on **match_type** (inside polygon vs nearest centroid vs parent fallback).

| Scenario | Suggested range | Notes |
|----------|-----------------|-------|
| Official boundary, point inside polygon | 90–100 | Align with ref default 90; boost slightly only with strong provenance |
| Surveyed boundary, point inside polygon | 80–90 | Ref default 85 |
| Approximate boundary, point inside polygon | 60–75 | Ref default 65 |
| Settlement extent, point inside built-up polygon | 55–70 | Ref default 60; **never** treat as official |
| Nearest village point (not inside polygon) | 40–60 | Explicitly lower than in-polygon settlement extent |
| Township-only (or higher) fallback | 30–50 | Parent admin area; no village component |

Rules:

- Prefer the **admin area’s** stored `boundary_confidence_score` when present, then clamp/adjust by match type.
- Nearest-centroid and parent-fallback matches must **not** inherit the full score of an in-polygon official match.
- Display confidence to internal tools; public address strings may omit numeric scores but must reflect uncertainty in wording (§7).

---

## 7. Public wording examples

Use resolved names from core name tables (`my` / `en` / `und`). Prefixes communicate uncertainty without exposing internal codes.

### Official-style (high confidence, `address_usage` = `official`)

```
No. 12, Main Road, Aung Chan Thar Village, Kyauktan Township, Yangon Region
```

### Locality hint (approximate or settlement extent, `address_usage` = `locality_hint`)

```
Near Aung Chan Thar Village, Kyauktan Township, Yangon Region
```

Myanmar (`my`) strings should follow the same semantic distinction (exact inclusion vs approximate locality), using copy appropriate to the script — not a literal translation of “Near” if a better Myanmar convention exists.

---

## 8. Village mapping rules (data entry and tiles)

These rules apply to mappers and reviewers entering village admin areas in the dashboard or import pipeline:

1. **If the exact official village boundary is unknown, do not draw a fake full-village polygon** that implies legal coverage of paddy, forest, or neighboring settlements.
2. Prefer a **village point/centroid** and/or a **`settlement_extent`** polygon tracing **visible built-up** areas only.
3. Set `boundary_status` = `settlement_extent` (or `unknown` if even built-up extent is unclear) and `address_usage` = `locality_hint` unless a trusted official source exists.
4. Keep **paddy, farmland, and non-built-up land** as **landuse** features — not as village admin boundaries.
5. **Do not force** adjacent village settlement polygons to touch or tile seamlessly; gaps are acceptable and often more honest than invented boundaries.

The dashboard create flow applies ref-driven defaults when admin level code is `village` (settlement extent + ref defaults). Reviewers may override when they have an official source.

---

## 9. Developer rule — address composition metadata

Any address-composition API or internal structure must expose **per-component metadata** so clients and audit tools can explain *why* a line appeared. Minimum fields:

| Field | Description |
|-------|-------------|
| `component_type` | Role in the address (e.g. `house_number`, `street`, `village`, `township`, `region`) |
| `name` | Resolved display string for the component (language-specific) |
| `admin_area_id` | Internal FK to `core.core_admin_areas.id` when the component comes from an admin area |
| `boundary_status` | Code from `core.core_admin_areas.boundary_status` (or null if not area-based) |
| `address_usage` | Code from `core.core_admin_areas.address_usage` |
| `confidence_score` | 0–100 confidence for **this component in this address** |
| `match_type` | How the area was matched, e.g. `point_in_polygon`, `nearest_centroid`, `parent_fallback`, `explicit_override` |

Consumers (web, mobile, search) can use this to choose formatting, filtering, and debug views without re-deriving policy from geometry alone.

---

## 10. Warning — never silently upgrade settlement extent

**Never treat `boundary_status` = `settlement_extent` (or `approximate`, `unknown`) as an official boundary** in address assignment, legal copy, or confidence scoring — even if:

- The polygon looks “complete” on the map
- The village name is well known locally
- `is_official_boundary` was incorrectly left `true` on a legacy row

If `boundary_status` and `is_official_boundary` disagree, **`boundary_status` + `address_usage` win** for composition policy; flag the row for data cleanup.

Settlement extent exists so users can search and describe locations **without pretending** the project knows the true administrative boundary. Violating that rule erodes trust in every official address the system produces.

---

## Quick reference

```
core.core_admin_areas
  boundary_status          → ref.ref_boundary_statuses.code
  address_usage            → ref.ref_address_usage_types.code
  is_official_boundary     → boolean (must align with boundary_status policy)
  boundary_confidence_score → 0–100
  boundary_note            → optional text

Village without exact boundary (typical):
  boundary_status = settlement_extent
  address_usage   = locality_hint
  is_official_boundary = false
```

For implementation details of the dashboard and API, see the core-review admin area form and `GET /admin/ref/boundary-statuses` / `GET /admin/ref/address-usage-types`.

For address tables, promotion, dashboard edit boundaries, and `search.address_index`, see [address-architecture.md](./address-architecture.md).

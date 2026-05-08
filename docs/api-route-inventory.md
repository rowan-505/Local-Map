# API Route Inventory

> **Generated:** 2026-05-08  
> **API server:** `apps/api` — Fastify, Node.js  
> **Base URL (local):** `http://localhost:3001`  
> **Auth mechanism:** JWT Bearer token via `Authorization: Bearer <token>` (handled by `plugins/auth.ts`).  
> **Dev bypass:** When `AUTH_BYPASS=true` in `.env`, `app.authenticate` is satisfied with any token and a synthetic admin user is injected.  
> **No URL prefix** is applied to any plugin in `app.ts` — every path below is the full route path.

---

## Table of Contents

1. [Health](#1-health)
2. [Auth](#2-auth)
3. [Categories (public ref)](#3-categories-public-ref)
4. [Admin Areas](#4-admin-areas)
5. [Places (dashboard)](#5-places-dashboard)
6. [Public Map](#6-public-map)
7. [Streets (dashboard)](#7-streets-dashboard)
8. [Buildings (dashboard)](#8-buildings-dashboard)
9. [Place–Building Links](#9-placebuilding-links)
10. [Dashboard Stats](#10-dashboard-stats)
11. [OpenAPI coverage](#11-openapi-coverage)
12. [Dead Code Note](#12-dead-code-note)

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Zod schema present for this field |
| ✅ OpenAPI | Fastify route `schema` metadata is defined (see module `*.openapi.ts` under `apps/api/src`; spec at `/openapi.json`) |
| 🔒 | Requires `Authorization: Bearer <token>` (`app.authenticate`) |
| 🛡️ admin/editor | Role check: `request.user.roles` must include `admin` or `editor` |
| 🌐 | Public route — no auth required |

---

## 1. Health

### `GET /health`

| Field | Value |
|-------|-------|
| **Source** | `src/app.ts` |
| **Auth** | 🌐 None |
| **Roles** | — |
| **Path params** | — |
| **Query params** | — |
| **Request body** | — |
| **Response `200`** | `{ ok: true }` |
| **Schema** | ✅ OpenAPI (`src/lib/openapi/health.openapi.ts`); no request validation |
| **Notes** | Liveness probe. |

---

## 2. Auth

Source file: `src/modules/auth/auth.routes.ts`  
Schema file: `src/modules/auth/auth.schema.ts`

---

### `POST /auth/login`

| Field | Value |
|-------|-------|
| **Auth** | 🌐 None |
| **Roles** | — |
| **Path params** | — |
| **Query params** | — |
| **Request body** | ✅ `loginBodySchema` (see below) |
| **Response `200`** | ✅ `loginResponseSchema`: `{ accessToken: string, user: AuthUser }` |
| **Response `400`** | `{ message: string, issues: ZodFlatten }` |
| **Response `401`** | `{ message: "Invalid credentials" }` |
| **Schema** | ✅ Zod body + response; ✅ OpenAPI (`auth.openapi.ts`) |

**Request body fields:**

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `email` | `string` | conditional | valid email; required if `username` absent |
| `username` | `string` | conditional | min 3 chars; required if `email` absent |
| `password` | `string` | ✅ | min 6 chars |

Exactly one of `email` or `username` must be provided.

**`AuthUser` shape:**

```json
{
  "id": "string",
  "public_id": "uuid",
  "email": "string",
  "display_name": "string",
  "roles": ["string"]
}
```

---

### `POST /auth/signup`

| Field | Value |
|-------|-------|
| **Auth** | 🌐 None |
| **Roles** | — |
| **Path params** | — |
| **Query params** | — |
| **Request body** | ✅ `signupBodySchema` |
| **Response `200`** | ✅ `signupResponseSchema`: `{ message: "Demo admin account created", user: AuthUser }` |
| **Response `400`** | `{ message: string, issues: ZodFlatten }` |
| **Schema** | ✅ Zod body + response; ✅ OpenAPI (`auth.openapi.ts`) |
| **Notes** | Creates a demo admin account. Not intended for production user registration. |

**Request body fields:**

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `username` | `string` | ✅ | min 3 chars |
| `password` | `string` | ✅ | min 6 chars |

---

### `GET /me`

| Field | Value |
|-------|-------|
| **Auth** | 🔒 Required |
| **Roles** | Any authenticated user |
| **Path params** | — |
| **Query params** | — |
| **Request body** | — |
| **Response `200`** | `{ id, public_id, email, display_name, roles[] }` (from `request.user` JWT payload) |
| **Response `401`** | `{ message: "Unauthorized" }` |
| **Schema** | ✅ OpenAPI (`auth.openapi.ts`); no Zod on response |

---

## 3. Categories (public ref)

Source file: `src/modules/categories/categories.routes.ts`  
Schema file: `src/modules/categories/categories.schema.ts`

---

### `GET /categories`

| Field | Value |
|-------|-------|
| **Auth** | 🌐 None |
| **Roles** | — |
| **Path params** | — |
| **Query params** | ✅ `categoriesQuerySchema` (see below; currently ignored by service — **behavior mismatch**) |
| **Request body** | — |
| **Response `200`** | `Array<{ id: string, code: string, name: string, name_mm: string\|null, sort_order: number }>` |
| **Schema** | ✅ OpenAPI (`categories.openapi.ts`); Zod query — query params are parsed but the service ignores them; response not Zod-validated |
| **Notes** | Query params `parentId` and `includePrivate` are accepted and parsed but **not forwarded to the service**. The service always returns all active categories. This is a bug / incomplete feature. |

**Query params:**

| Param | Type | Default | Constraints |
|-------|------|---------|-------------|
| `parentId` | `bigint` (integer string) | — | optional |
| `includePrivate` | `boolean` | — | optional |

---

## 4. Admin Areas

Source file: `src/modules/admin-areas/admin-areas.routes.ts`  
Schema file: `src/modules/admin-areas/admin-areas.schema.ts`

---

### `GET /admin-areas`

| Field | Value |
|-------|-------|
| **Auth** | 🔒 Required |
| **Roles** | Any authenticated user |
| **Path params** | — |
| **Query params** | ✅ `adminAreasQuerySchema` |
| **Request body** | — |
| **Response `200`** | `Array<{ id: string, parent_id: string\|null, admin_level_id: string\|null, canonical_name: string\|null, slug: string\|null, is_active: boolean }>` |
| **Schema** | ✅ OpenAPI (`admin-areas.openapi.ts`); Zod query only; response not Zod-validated |

**Query params:**

| Param | Type | Default | Constraints |
|-------|------|---------|-------------|
| `limit` | `integer` | `100` | 1–100 |

---

## 5. Places (dashboard)

Source file: `src/modules/places/places.routes.ts`  
Schema file: `src/modules/places/places.schema.ts`

Role guard (`EDIT_PLACE_ROLES`): `admin`, `editor` — required for POST / PATCH / DELETE.

---

### `GET /places`

| Field | Value |
|-------|-------|
| **Auth** | 🔒 Required |
| **Roles** | Any authenticated user |
| **Path params** | — |
| **Query params** | ✅ `placesQuerySchema` |
| **Request body** | — |
| **Response `200`** | Array of place list objects (see shape below) |
| **Schema** | ✅ OpenAPI (`places.openapi.ts`); Zod query only |

**Query params:**

| Param | Type | Default | Constraints |
|-------|------|---------|-------------|
| `q` | `string` | — | optional, min 1 char (after trim) |
| `category` | `string` | — | optional, min 1 char |
| `is_public` | `boolean` | — | optional (`true`/`false`/`1`/`0`) |
| `is_verified` | `boolean` | — | optional |
| `limit` | `integer` | `50` | 1–100 |
| `offset` | `integer` | `0` | ≥ 0 |
| `sortBy` | `"name"\|"category"\|"admin_area"\|"created"\|"updated"` | `"name"` | — |
| `sortOrder` | `"asc"\|"desc"` | `"asc"` | — |

**Response shape (list item):**

```json
{
  "id": "string (internal id)",
  "public_id": "uuid",
  "myanmar_name": "string|null",
  "english_name": "string|null",
  "canonical_name": "string|null",
  "category_id": "string|null",
  "category_code": "string|null",
  "category_name": "string|null",
  "admin_area_id": "string|null",
  "admin_area_name": "string|null",
  "lat": "number|null",
  "lng": "number|null",
  "importance_score": "number|null",
  "popularity_score": "number|null",
  "confidence_score": "number|null",
  "is_public": "boolean",
  "is_verified": "boolean",
  "is_active": "boolean",
  "source_type_id": "string|null",
  "publish_status_id": "string|null",
  "names": "NameRow[]",
  "created_at": "ISO 8601 string",
  "updated_at": "ISO 8601 string"
}
```

---

### `GET /place-form-options`

| Field | Value |
|-------|-------|
| **Auth** | 🔒 Required |
| **Roles** | Any authenticated user |
| **Path params** | — |
| **Query params** | — |
| **Request body** | — |
| **Response `200`** | `{ categories, admin_areas, source_types, publish_statuses }` (see below) |
| **Schema** | ✅ OpenAPI (`places.openapi.ts`) |
| **Notes** | Convenience endpoint for populating create/edit forms in the dashboard. |

**Response shape:**

```json
{
  "categories": [{ "id": "string", "label": "string" }],
  "admin_areas": [{ "id": "string", "label": "string" }],
  "source_types": [{ "id": "string", "code": "string", "label": "string" }],
  "publish_statuses": [{ "id": "string", "code": "string", "label": "string" }]
}
```

---

### `GET /places/:id`

| Field | Value |
|-------|-------|
| **Auth** | 🔒 Required |
| **Roles** | Any authenticated user |
| **Path params** | ✅ `id` — UUID |
| **Query params** | — |
| **Request body** | — |
| **Response `200`** | Place detail object (list shape + `plus_code`, `current_version_id`, `deleted_at`) |
| **Response `404`** | `{ message: "Place not found" }` |
| **Schema** | ✅ OpenAPI (`places.openapi.ts`); Zod params only |

---

### `POST /places`

| Field | Value |
|-------|-------|
| **Auth** | 🔒 Required |
| **Roles** | 🛡️ admin/editor |
| **Path params** | — |
| **Query params** | — |
| **Request body** | ✅ `createPlaceBodySchema` (strict, see below) |
| **Response `201`** | Place detail object |
| **Response `400`** | `{ message: string, issues: ZodFlatten }` or `{ message: string }` |
| **Response `403`** | `{ message: "Admin or editor role required" }` |
| **Schema** | ✅ Zod body |

**Request body fields:**

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `myanmarName` | `string` | conditional | min 1 (after trim); at least one of `myanmarName`/`englishName` required |
| `englishName` | `string` | conditional | min 1 |
| `categoryId` | `integer` (bigint) | ✅ | positive integer |
| `adminAreaId` | `integer\|null` | optional | nullable bigint |
| `lat` | `number` | ✅ | finite, −90 to 90 |
| `lng` | `number` | ✅ | finite, −180 to 180 |
| `plusCode` | `string\|null` | optional | nullable |
| `importanceScore` | `number` | optional | finite |
| `popularityScore` | `number` | optional | finite |
| `confidenceScore` | `number` | optional | finite |
| `isPublic` | `boolean` | optional | |
| `isVerified` | `boolean` | optional | |
| `sourceTypeId` | `integer\|null` | optional | nullable bigint |
| `publishStatusId` | `integer\|null` | optional | nullable bigint |

Read-only keys (`updated_at`, `canonical_name`, `canonicalName`) are stripped before parsing.

---

### `PATCH /places/:id`

| Field | Value |
|-------|-------|
| **Auth** | 🔒 Required |
| **Roles** | 🛡️ admin/editor |
| **Path params** | ✅ `id` — UUID |
| **Query params** | — |
| **Request body** | ✅ `updatePlaceBodySchema` (strict, all fields optional, at least one required) |
| **Response `200`** | Updated place detail object |
| **Response `400`** | `{ message: string, issues: ZodFlatten }` |
| **Response `403`** | `{ message: "Admin or editor role required" }` |
| **Response `404`** | `{ message: "Place not found" }` |
| **Schema** | ✅ Zod params + body |

Same writable fields as `POST /places`, all optional except the at-least-one-field constraint.

---

### `DELETE /places/:id`

| Field | Value |
|-------|-------|
| **Auth** | 🔒 Required |
| **Roles** | 🛡️ admin/editor |
| **Path params** | ✅ `id` — UUID |
| **Query params** | — |
| **Request body** | — |
| **Response `200`** | `{ success: true, public_id: string }` |
| **Response `403`** | `{ message: "Admin or editor role required" }` |
| **Response `404`** | `{ message: "Place not found" }` |
| **Schema** | ✅ Zod params |

---

## 6. Public Map

Source file: `src/modules/public-map/public-map.routes.ts`  
Schema file: `src/modules/public-map/public-map.schema.ts`

All routes in this group are 🌐 **public — no authentication required**.

---

### `GET /public/places`

| Field | Value |
|-------|-------|
| **Auth** | 🌐 None |
| **Query params** | ✅ `publicPlacesQuerySchema` |
| **Request body** | — |
| **Response `200`** | Array of public place objects (id, publicId, name fields, category, lat/lng, scores, isVerified) |
| **Schema** | ✅ OpenAPI (`public-map.openapi.ts`); Zod query only; response not Zod-validated |

**Query params:**

| Param | Type | Default | Constraints |
|-------|------|---------|-------------|
| `q` | `string` | — | optional, min 1 char |
| `category` | `string` | — | optional, min 1 char |
| `categoryId` | `integer` (digit string) | — | optional |
| `limit` | `integer` | `200` | 1–1000 |

---

### `GET /public/places/:id`

| Field | Value |
|-------|-------|
| **Auth** | 🌐 None |
| **Path params** | ✅ `id` — UUID |
| **Request body** | — |
| **Response `200`** | Single public place object |
| **Response `404`** | `{ message: "Place not found" }` |
| **Schema** | ✅ OpenAPI (`public-map.openapi.ts`); Zod params only |

---

### `GET /public/categories`

| Field | Value |
|-------|-------|
| **Auth** | 🌐 None |
| **Query params** | — |
| **Request body** | — |
| **Response `200`** | `Array<{ id: string, code: string, name: string, nameLocal: null, iconKey: null, sortOrder: number }>` |
| **Schema** | ✅ OpenAPI (`public-map.openapi.ts`) |

---

### `GET /public/search`

| Field | Value |
|-------|-------|
| **Auth** | 🌐 None |
| **Query params** | ✅ `publicSearchQuerySchema` |
| **Request body** | — |
| **Response `200`** | Array of search hit objects with `cameraTarget`, `label`, `subLabel`, `kind`, `id` etc. |
| **Schema** | ✅ OpenAPI (`public-map.openapi.ts`); Zod query only |

**Query params:**

| Param | Type | Default | Constraints |
|-------|------|---------|-------------|
| `q` | `string` | — | ✅ required, min 1 char |
| `limit` | `integer` | `20` | 1–50 |

---

### `GET /public/map/geo/streets`

| Field | Value |
|-------|-------|
| **Auth** | 🌐 None |
| **Query params** | — |
| **Request body** | — |
| **Response `200`** | GeoJSON `FeatureCollection` of street LineStrings |
| **Schema** | ✅ OpenAPI (`public-map.openapi.ts` — tag Streets) |
| **Notes** | Queries `core.core_streets` directly. Used by the web map client for rendering. |

---

### `GET /public/map/geo/admin-areas`

| Field | Value |
|-------|-------|
| **Auth** | 🌐 None |
| **Response `200`** | GeoJSON `FeatureCollection` of admin-area polygons |
| **Schema** | ✅ OpenAPI (`public-map.openapi.ts`) |

---

### `GET /public/map/geo/bus-stops`

| Field | Value |
|-------|-------|
| **Auth** | 🌐 None |
| **Response `200`** | GeoJSON `FeatureCollection` of bus stop points |
| **Schema** | ✅ OpenAPI (`public-map.openapi.ts`) |

---

### `GET /public/map/geo/bus-routes`

| Field | Value |
|-------|-------|
| **Auth** | 🌐 None |
| **Response `200`** | GeoJSON `FeatureCollection` of bus route LineStrings |
| **Schema** | ✅ OpenAPI (`public-map.openapi.ts`) |

---

## 7. Streets (dashboard)

Source file: `src/modules/streets/streets.routes.ts`  
Schema file: `src/modules/streets/streets.schema.ts`

Role guard (`EDIT_STREET_ROLES`): `admin`, `editor` — required for POST validate-geometry, POST create, PATCH, POST split, DELETE.

---

### `GET /road-classes`

| Field | Value |
|-------|-------|
| **Auth** | 🔒 Required |
| **Roles** | Any authenticated user |
| **Path params** | — |
| **Query params** | — |
| **Request body** | — |
| **Response `200`** | `Array<{ id: string, code: string, name: string, rank: number }>` — active public road classes only |
| **Schema** | ✅ OpenAPI (`streets.openapi.ts`) |

---

### `GET /streets`

| Field | Value |
|-------|-------|
| **Auth** | 🔒 Required |
| **Roles** | Any authenticated user |
| **Path params** | — |
| **Query params** | ✅ `streetsQuerySchema` |
| **Request body** | — |
| **Response `200`** | Array of street objects (see shape below) |
| **Schema** | ✅ OpenAPI (`streets.openapi.ts`); Zod query only |

**Query params:**

| Param | Type | Default | Constraints |
|-------|------|---------|-------------|
| `q` | `string` | — | optional, min 1 char |
| `limit` | `integer` | `50` | 1–100 |
| `sortBy` | `"name"\|"admin_area"\|"created"\|"updated"` | `"name"` | — |
| `sortOrder` | `"asc"\|"desc"` | `"asc"` | — |
| `include_deleted` | `boolean` | `false` | `true`/`false`/`1`/`0` |

**Response shape (street item):**

```json
{
  "public_id": "uuid",
  "canonical_name": "string|null",
  "admin_area_id": "string|null",
  "admin_area_name": "string|null",
  "source_type_id": "string|null",
  "road_class_id": "string|null",
  "road_class": "string|null",
  "surface": "string|null",
  "is_oneway": "boolean",
  "bridge": "boolean",
  "tunnel": "boolean",
  "manual_override": "boolean",
  "edit_status": "string",
  "routing_status": "string",
  "deleted_at": "ISO 8601|null",
  "last_edited_at": "ISO 8601|null",
  "is_active": "boolean",
  "created_at": "ISO 8601",
  "updated_at": "ISO 8601",
  "geometry": "GeoJSON LineString|MultiLineString|null",
  "names": "StreetNameRow[]",
  "myanmar_name": "string|null",
  "english_name": "string|null"
}
```

---

### `GET /streets/nearest-point`

| Field | Value |
|-------|-------|
| **Auth** | 🔒 Required |
| **Roles** | Any authenticated user |
| **Path params** | — |
| **Query params** | ✅ `nearestStreetPointQuerySchema` |
| **Request body** | — |
| **Response `200`** | Nearest hit or `null` (see below) |
| **Schema** | ✅ OpenAPI (`streets.openapi.ts`); Zod query only |
| **Notes** | Dashboard map snap helper. Queries `core.core_streets` via PostGIS `ST_ClosestPoint`. |

**Query params:**

| Param | Type | Default | Constraints |
|-------|------|---------|-------------|
| `lat` | `number` | — | ✅ required, −90 to 90 |
| `lng` | `number` | — | ✅ required, −180 to 180 |
| `radiusMeters` | `number` | `50` | positive, max 500 |
| `excludePublicId` | `string` (UUID) | — | optional |

**Response shape:**

```json
{
  "street_id": "uuid",
  "nearest": { "lng": "number", "lat": "number" },
  "distance_m": "number",
  "street_name": "string|null",
  "road_class": "string|null"
}
```

or `null` if no street found within radius.

---

### `POST /streets/validate-geometry`

| Field | Value |
|-------|-------|
| **Auth** | 🔒 Required |
| **Roles** | 🛡️ admin/editor |
| **Path params** | — |
| **Query params** | — |
| **Request body** | ✅ `validateStreetGeometryBodySchema` (strict, see below) |
| **Response `200`** | `ValidateStreetGeometryResponse` (see below) |
| **Response `400`** | `{ message: string, issues: ZodFlatten }` |
| **Response `403`** | `{ message: "Admin or editor role required" }` |
| **Schema** | ✅ Zod body |
| **Notes** | Validates a candidate LineString against `core.core_streets`. Uses `ST_HausdorffDistance` (EPSG:3857), `ST_DWithin`, `ST_Crosses`, and `ST_Intersection` (geography). |

**Request body fields:**

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `geometry` | GeoJSON `LineString` | ✅ | `coordinates` array of `[lng, lat]` pairs, min 2 points |
| `streetId` | `string\|number` | optional | UUID or numeric internal id; street to exclude from topology checks |
| `street_id` | `string` (UUID) | optional | ⚠️ deprecated alias for `streetId` |
| `toleranceMeters` | `number` | optional | default `10`, positive, max 500 |

**Response shape:**

```json
{
  "isValid": "boolean",
  "errors": ["string"],
  "warnings": ["string"],
  "startConnection": {
    "street_id": "uuid",
    "nearest": { "lng": "number", "lat": "number" },
    "distance_m": "number",
    "street_name": "string|null",
    "road_class": "string|null"
  } | null,
  "endConnection": "same as startConnection | null",
  "crossings": [{
    "streetId": "uuid",
    "streetName": "string|null",
    "roadClass": "string|null"
  }],
  "duplicates": [{
    "streetId": "uuid",
    "streetName": "string|null",
    "roadClass": "string|null",
    "kind": "\"overlap\" | \"near_duplicate\""
  }]
}
```

---

### `GET /streets/:id`

| Field | Value |
|-------|-------|
| **Auth** | 🔒 Required |
| **Roles** | Any authenticated user |
| **Path params** | ✅ `id` — UUID |
| **Query params** | — |
| **Request body** | — |
| **Response `200`** | Street detail object (same shape as list item) |
| **Response `404`** | `{ message: "Street not found" }` |
| **Schema** | ✅ OpenAPI (`streets.openapi.ts`); Zod params only |

---

### `POST /streets`

| Field | Value |
|-------|-------|
| **Auth** | 🔒 Required |
| **Roles** | 🛡️ admin/editor |
| **Path params** | — |
| **Query params** | — |
| **Request body** | ✅ `createStreetBodySchema` (strict, see below) |
| **Response `201`** | Street detail object |
| **Response `400`** | `{ message: string, issues: ZodFlatten }` or `{ message: string }` |
| **Response `403`** | `{ message: "Admin or editor role required" }` |
| **Schema** | ✅ Zod body |

**Request body fields:**

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `myanmarName` | `string` | conditional | at least one of `myanmarName`/`englishName` required |
| `englishName` | `string` | conditional | |
| `road_class_id` | `integer` (bigint) | ✅ | positive integer |
| `is_oneway` | `boolean` | optional | default `false` |
| `surface` | `string\|null` | optional | |
| `admin_area_id` / `adminAreaId` | `integer\|null` | optional | nullable bigint; both accepted |
| `source_type_id` / `sourceTypeId` | `integer\|null` | optional | nullable bigint; both accepted |
| `geometry` | GeoJSON `LineString` | ✅ | min 2 coordinate pairs |
| `is_active` | `boolean` | optional | |
| `bridge` | `boolean` | optional | default `false` |
| `tunnel` | `boolean` | optional | default `false` |

---

### `PATCH /streets/:id`

| Field | Value |
|-------|-------|
| **Auth** | 🔒 Required |
| **Roles** | 🛡️ admin/editor |
| **Path params** | ✅ `id` — UUID |
| **Query params** | — |
| **Request body** | ✅ `updateStreetBodySchema` (strict, partial, at least one non-`edit_reason` field) |
| **Response `200`** | Updated street detail object |
| **Response `400`** | `{ message: string, issues: ZodFlatten }` |
| **Response `403`** | `{ message: "Admin or editor role required" }` |
| **Response `404`** | `{ message: "Street not found" }` |
| **Schema** | ✅ Zod params + body |
| **Notes** | Strips `updated_at`, `canonical_name`, `canonicalName` from body before parsing. |

**Patchable fields:**

| Field | Type | Aliases |
|-------|------|---------|
| `myanmarName` | `string` | |
| `englishName` | `string` | |
| `geometry` | GeoJSON `LineString` | |
| `road_class_id` | `integer\|null` | `roadClassId` |
| `is_oneway` | `boolean` | `isOneway` |
| `surface` | `string\|null` | |
| `admin_area_id` | `integer\|null` | `adminAreaId` |
| `edit_reason` | `string` | max 500 chars (not counted as an editable field) |
| `bridge` | `boolean` | |
| `tunnel` | `boolean` | |

---

### `POST /streets/:id/split`

| Field | Value |
|-------|-------|
| **Auth** | 🔒 Required |
| **Roles** | 🛡️ admin/editor |
| **Path params** | ✅ `splitStreetIdParamsSchema`: `id` — UUID **or** numeric street id (integer string or number) |
| **Query params** | — |
| **Request body** | ✅ `splitStreetBodySchema` (strict, see below) |
| **Response `200`** | `SplitStreetResponse` (see below) |
| **Response `400`** | `{ message: string }` (Zod or split constraint violations) |
| **Response `403`** | `{ message: "Admin or editor role required" }` |
| **Response `404`** | `{ message: "Street not found" }` |
| **Schema** | ✅ Zod params + body |
| **Notes** | Soft-deletes the original street and inserts two successor streets. The split point must be within 5 m of the stored LineString; each resulting segment must be > 2 m. |

**Request body fields:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `point` | `{ lat: number, lng: number }` | conditional | preferred; required if `split_point` absent |
| `editReason` | `string` | optional | max 500 chars |
| `split_point` | GeoJSON `Point` | conditional | ⚠️ deprecated alias for `point` |
| `edit_reason` | `string` | optional | ⚠️ deprecated alias for `editReason` |

**Response shape:**

```json
{
  "originalStreetId": "uuid",
  "newStreets": ["StreetRow", "StreetRow"],
  "streets": ["StreetRow", "StreetRow"]
}
```

---

### `DELETE /streets/:id`

| Field | Value |
|-------|-------|
| **Auth** | 🔒 Required |
| **Roles** | 🛡️ admin/editor |
| **Path params** | ✅ `id` — UUID |
| **Query params** | — |
| **Request body** | ✅ `deleteStreetBodySchema`: optional `edit_reason` (max 500 chars) |
| **Response `200`** | Soft-deleted street detail object (with `deleted_at` set) |
| **Response `403`** | `{ message: "Admin or editor role required" }` |
| **Response `404`** | `{ message: "Street not found" }` |
| **Schema** | ✅ Zod params + body |

---

## 8. Buildings (dashboard)

Source file: `src/modules/buildings/buildings.routes.ts`  
Schema file: `src/modules/buildings/buildings.schema.ts`

Role guard (`EDIT_BUILDING_ROLES`): `admin`, `editor` — required for POST / PATCH / DELETE.

---

### `GET /building-types`

| Field | Value |
|-------|-------|
| **Auth** | 🔒 Required |
| **Roles** | Any authenticated user |
| **Query params** | — |
| **Request body** | — |
| **Response `200`** | Array of active building type ref rows |
| **Schema** | ✅ OpenAPI (`buildings.openapi.ts`) |

---

### `GET /buildings`

| Field | Value |
|-------|-------|
| **Auth** | 🔒 Required |
| **Roles** | Any authenticated user |
| **Query params** | ✅ `buildingsQuerySchema` |
| **Request body** | — |
| **Response `200`** | Array of serialized building objects (see shape below) |
| **Schema** | ✅ OpenAPI (`buildings.openapi.ts`); Zod query only |

**Query params:**

| Param | Type | Default | Constraints |
|-------|------|---------|-------------|
| `limit` | `integer` | `100` | 1–100 |
| `offset` | `integer` | `0` | ≥ 0 |
| `q` | `string` | — | optional, min 1 char |
| `sortBy` | `"name"\|"building_type"\|"admin_area"\|"created"\|"updated"` | `"name"` | — |
| `sortOrder` | `"asc"\|"desc"` | `"asc"` | — |

**Response shape (building item):**

```json
{
  "id": "string",
  "public_id": "uuid",
  "name": "string|null",
  "building_type": "string|null",
  "building_type_id": "string|null",
  "admin_area_id": "string|null",
  "admin_area_name": "string|null",
  "geometry": "GeoJSON Polygon|MultiPolygon|null",
  "area_m2": "number|null",
  "levels": "number|null",
  "height_m": "number|null",
  "confidence_score": "number|null",
  "is_verified": "boolean",
  "is_active": "boolean",
  "deleted_at": "ISO 8601|null",
  "created_at": "ISO 8601",
  "updated_at": "ISO 8601"
}
```

---

### `GET /buildings/:id`

| Field | Value |
|-------|-------|
| **Auth** | 🔒 Required |
| **Roles** | Any authenticated user |
| **Path params** | ✅ `id` — UUID |
| **Response `200`** | Single building detail |
| **Response `404`** | `{ message: "Building not found" }` |
| **Schema** | ✅ OpenAPI (`buildings.openapi.ts`); Zod params only |

---

### `POST /buildings`

| Field | Value |
|-------|-------|
| **Auth** | 🔒 Required |
| **Roles** | 🛡️ admin/editor |
| **Request body** | ✅ `createBuildingBodySchema` (strict, see below) |
| **Response `201`** | Serialized building detail |
| **Response `400`** | `{ message: string, issues: ZodFlatten }` |
| **Response `403`** | `{ message: "Admin or editor role required" }` |
| **Schema** | ✅ Zod body |

**Request body fields:**

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `geometry` | GeoJSON `Polygon` or `MultiPolygon` | ✅ | min 1 ring / outer polygon |
| `name` | `string\|null` | optional | min 1 char if provided |
| `building_type` | `string` | optional | min 1 char (text label) |
| `building_type_id` | `integer` (bigint) | optional | |
| `admin_area_id` | `integer` (bigint) | optional | |
| `levels` | `integer` | optional | ≥ 0 |
| `height_m` | `number` | optional | ≥ 0, finite |
| `confidence_score` | `number` | optional | finite |
| `is_verified` | `boolean` | optional | |

---

### `PATCH /buildings/:id`

| Field | Value |
|-------|-------|
| **Auth** | 🔒 Required |
| **Roles** | 🛡️ admin/editor |
| **Path params** | ✅ `id` — UUID |
| **Request body** | ✅ `updateBuildingBodySchema` (strict, partial, at least one field) |
| **Response `200`** | Updated building detail |
| **Response `400`** | `{ message: string, issues: ZodFlatten }` |
| **Response `403`** | `{ message: "Admin or editor role required" }` |
| **Response `404`** | `{ message: "Building not found" }` |
| **Schema** | ✅ Zod params + body |

**Patchable fields:** same as POST fields above, all optional. `building_type_id` and `admin_area_id` accept `null` to clear the FK.

---

### `DELETE /buildings/:id`

| Field | Value |
|-------|-------|
| **Auth** | 🔒 Required |
| **Roles** | 🛡️ admin/editor |
| **Path params** | ✅ `id` — UUID |
| **Response `200`** | `{ ok: true, deleted: true, public_id: string }` |
| **Response `403`** | `{ message: "Admin or editor role required" }` |
| **Response `404`** | `{ message: "Building not found" }` |
| **Schema** | ✅ Zod params |

---

## 9. Place–Building Links

Source file: `src/modules/place-buildings/place-buildings.routes.ts`  
Schema file: `src/modules/place-buildings/place-buildings.schema.ts`

Role guard (`EDIT_LINK_ROLES`): `admin`, `editor` — required for POST / PATCH / DELETE.

`relation_type` enum: `"inside" | "entrance" | "nearby" | "compound"`

---

### `GET /places/:id/buildings`

| Field | Value |
|-------|-------|
| **Auth** | 🔒 Required |
| **Roles** | Any authenticated user |
| **Path params** | ✅ `id` — place UUID |
| **Response `200`** | `{ items: BuildingLinkRow[] }` |
| **Schema** | ✅ OpenAPI (`place-buildings.openapi.ts`); Zod params only |

---

### `POST /places/:id/buildings`

| Field | Value |
|-------|-------|
| **Auth** | 🔒 Required |
| **Roles** | 🛡️ admin/editor |
| **Path params** | ✅ `id` — place UUID |
| **Request body** | ✅ `linkPlaceBuildingBodySchema` (strict, see below) |
| **Response `201`** | `{ place_id: uuid, ...link row }` |
| **Response `400`** | `{ message: string, issues: ZodFlatten }` |
| **Response `403`** | `{ message: "Admin or editor role required" }` |
| **Schema** | ✅ Zod params + body |

**Request body fields:**

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `building_id` | `string` (UUID) | ✅ | — |
| `relation_type` | `"inside"\|"entrance"\|"nearby"\|"compound"` | optional | `"inside"` |
| `is_primary` | `boolean` | optional | `false` |

---

### `PATCH /places/:id/buildings/:buildingId`

| Field | Value |
|-------|-------|
| **Auth** | 🔒 Required |
| **Roles** | 🛡️ admin/editor |
| **Path params** | ✅ `id` — place UUID; `buildingId` — building UUID |
| **Request body** | ✅ `patchPlaceBuildingBodySchema` (strict; at least one of `relation_type` or `is_primary`) |
| **Response `200`** | `{ place_id: uuid, ...updated link }` |
| **Response `400`** | `{ message: string, issues: ZodFlatten }` |
| **Response `403`** | `{ message: "Admin or editor role required" }` |
| **Schema** | ✅ Zod params + body |

---

### `DELETE /places/:id/buildings/:buildingId`

| Field | Value |
|-------|-------|
| **Auth** | 🔒 Required |
| **Roles** | 🛡️ admin/editor |
| **Path params** | ✅ `id` — place UUID; `buildingId` — building UUID |
| **Response `200`** | `{ ok: true, place_id: uuid, building_id: uuid }` |
| **Response `403`** | `{ message: "Admin or editor role required" }` |
| **Schema** | ✅ Zod params |

---

### `GET /buildings/:id/places`

| Field | Value |
|-------|-------|
| **Auth** | 🔒 Required |
| **Roles** | Any authenticated user |
| **Path params** | ✅ `id` — building UUID |
| **Response `200`** | `{ items: PlaceLinkRow[] }` |
| **Schema** | ✅ OpenAPI (`place-buildings.openapi.ts`); Zod params only |

---

## 10. Dashboard Stats

Source file: `src/modules/dashboard/dashboard.routes.ts`

---

### `GET /dashboard/stats`

| Field | Value |
|-------|-------|
| **Auth** | 🔒 Required |
| **Roles** | Any authenticated user |
| **Path params** | — |
| **Query params** | — |
| **Request body** | — |
| **Response `200`** | `DashboardStatsResponse` (see below) |
| **Schema** | ✅ OpenAPI (`dashboard.openapi.ts`) |

**Response shape:**

```json
{
  "overview": {
    "total_places": "number",
    "total_streets": "number",
    "total_buildings": "number"
  },
  "main": { ... },
  "metadata": { ... },
  "transit": { ... },
  "health": { ... }
}
```

*(Full count breakdown defined in `src/modules/dashboard/dashboard.types.ts`.)*

---

## 11. OpenAPI coverage

Every route in this document is registered with a Fastify `schema` object (including `tags`, summaries, request/response JSON Schema, and `security` where JWT is required). The aggregated spec is served at **`/openapi.json`** and **`/docs`** (`@fastify/swagger` in `apps/api`).

Per-module schema helpers live next to routes, for example:

| Area | OpenAPI helper file |
|------|---------------------|
| Health | `apps/api/src/lib/openapi/health.openapi.ts` (wired from `app.ts`) |
| Auth / User | `apps/api/src/modules/auth/auth.openapi.ts` |
| Categories | `apps/api/src/modules/categories/categories.openapi.ts` |
| Admin areas | `apps/api/src/modules/admin-areas/admin-areas.openapi.ts` |
| Places | `apps/api/src/modules/places/places.openapi.ts` |
| Public map & search | `apps/api/src/modules/public-map/public-map.openapi.ts` |
| Streets | `apps/api/src/modules/streets/streets.openapi.ts` |
| Buildings | `apps/api/src/modules/buildings/buildings.openapi.ts` |
| Place–building links | `apps/api/src/modules/place-buildings/place-buildings.openapi.ts` |
| Dashboard stats | `apps/api/src/modules/dashboard/dashboard.openapi.ts` |

**Runtime validation:** Zod is still used for bodies, queries, and path params where the tables above mark ✅. OpenAPI mirrors those contracts for clients; responses are documented from service/repository shapes but are not always re-validated with Zod.

**Counts:** **41** live HTTP operations; **2** routes validate response bodies with Zod (`POST /auth/login`, `POST /auth/signup`); the rest rely on OpenAPI documentation plus existing Zod on inputs where noted.

---

## 12. Dead Code Note

`src/modules/place-form-options/place-form-options.routes.ts` defines `GET /place-form-options` with a Zod query schema but is **never registered** in `app.ts`. The same endpoint is already served via `places.routes.ts`. This file is dead code and can be removed.

---

## Route Count by Module

| Module | Routes | Public | Auth-only | Admin/Editor |
|--------|--------|--------|-----------|--------------|
| Health | 1 | 1 | — | — |
| Auth | 3 | 2 | 1 | — |
| Categories | 1 | 1 | — | — |
| Admin Areas | 1 | — | 1 | — |
| Places | 6 | — | 3 | 3 |
| Public Map | 8 | 8 | — | — |
| Streets | 9 | — | 4 | 5 |
| Buildings | 6 | — | 3 | 3 |
| Place–Building Links | 5 | — | 2 | 3 |
| Dashboard | 1 | — | 1 | — |
| **Total** | **41** | **11** | **15** | **14** |

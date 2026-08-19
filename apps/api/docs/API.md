# CoreMap API

> **Generated:** 2026-08-18T12:12:50.756Z (UTC)  
> **OpenAPI:** This file is produced from `buildApp().swagger()` in `scripts/generate-api-docs.ts` — the same JSON as `GET /openapi.json` when the server is running.

## Base URLs

| Description | URL |
| --- | --- |
| Current origin (local dev or same host as this service) | `/` |


| Environment | Typical base | Notes |
|---|---|---|
| Local development | `http://localhost:3001` | Default `PORT` in `server.ts` is **3001** unless `PORT` is set. |
| Deployed | Set `PUBLIC_API_URL` | Configures the OpenAPI `servers` entry used by Swagger UI (`/` means same origin). |

## Authentication

HTTP API for CoreMap (places, streets, buildings, public map). Routes marked with a lock require `Authorization: Bearer <token>` from POST /auth/login.

### Bearer JWT (`bearerAuth`)

When **`IMPORT_REVIEW_ADMIN_TOKEN` is unset**, Import Review requires `Authorization: Bearer <accessToken>` from `/auth/login` and JWT payload `roles` must include `"admin"` (**401** if missing or invalid JWT; **403** if not admin). When **`IMPORT_REVIEW_ADMIN_TOKEN` is set**, every Import Review request must send header **`x-import-review-admin-token: <exact token>`**; omitting/closing whitespace-only → **401**, wrong secret → **403** (Bearer JWT is **not needed** there — temporary shared-secret shim).

Send the header: `Authorization: Bearer <accessToken>`

## Endpoints by tag

### Health

Service liveness and readiness-style checks.

#### `GET` `/health`

**Summary:** Health check

Liveness probe. No authentication required.

**Security:** None

**Responses**

- **`200`**

  ```json
  {
    "ok": true
  }
  ```

### Auth

Login, registration, and token issuance.

#### `POST` `/auth/email/send-otp`

**Summary:** Send email verification OTP

Sends a 6-digit verification code to the logged-in user's email. Optional flow — does not block account use. Returns `already_verified` if the email is already verified. Throttled to one send per 60 seconds.

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Responses**

- **`200`**

  ```json
  {
    "status": "sent"
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`429`**

  ```json
  {
    "message": "string"
  }
  ```

- **`502`**

  ```json
  {
    "message": "string"
  }
  ```

- **`503`**

  ```json
  {
    "message": "string"
  }
  ```

#### `POST` `/auth/email/verify-otp`

**Summary:** Verify email verification OTP

Verifies the submitted 6-digit code for the logged-in user. On success sets `email_verified=true`. Returns `already_verified` if already verified.

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Request body** (`application/json`)

```json
{
  "code": "string"
}
```

**Responses**

- **`200`**

  ```json
  {
    "status": "sent"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`429`**

  ```json
  {
    "message": "string"
  }
  ```

- **`503`**

  ```json
  {
    "message": "string"
  }
  ```

#### `POST` `/auth/login`

**Summary:** Log in

Authenticate with email (or legacy username) plus password. Returns a short-lived `accessToken`, a `refreshToken`, and the user profile. Either `email` or `username` must be set (not both).

**Security:** None

**Request body** (`application/json`)

```json
{
  "password": "string",
  "email": "user@example.com",
  "username": "string"
}
```

**Responses**

- **`200`**

  ```json
  {
    "accessToken": "string",
    "refreshToken": "string",
    "expiresIn": "string",
    "user": {
      "id": "string",
      "public_id": "00000000-0000-4000-8000-000000000000",
      "email": "user@example.com",
      "display_name": "string",
      "roles": [
        "string"
      ]
    }
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `POST` `/auth/logout`

**Summary:** Log out

Revokes the supplied refresh session. Idempotent.

**Security:** None

**Request body** (`application/json`)

```json
{
  "refreshToken": "string"
}
```

**Responses**

- **`200`**

  ```json
  {
    "message": "Logged out"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

#### `POST` `/auth/refresh`

**Summary:** Refresh session

Exchanges a valid refresh token for a new access token and a rotated refresh token. The old refresh token is invalidated.

**Security:** None

**Request body** (`application/json`)

```json
{
  "refreshToken": "string"
}
```

**Responses**

- **`200`**

  ```json
  {
    "accessToken": "string",
    "refreshToken": "string",
    "expiresIn": "string",
    "user": {
      "id": "string",
      "public_id": "00000000-0000-4000-8000-000000000000",
      "email": "user@example.com",
      "display_name": "string",
      "roles": [
        "string"
      ]
    }
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `POST` `/auth/register`

**Summary:** Register public user

Creates a public account with role `user`. Admin / super_admin accounts cannot be created here.

**Security:** None

**Request body** (`application/json`)

```json
{
  "email": "user@example.com",
  "displayName": "string",
  "password": "string",
  "preferredLanguage": "my",
  "primaryRegionId": 0
}
```

**Responses**

- **`201`**

  ```json
  {
    "message": "Account created",
    "user": {
      "id": "string",
      "public_id": "00000000-0000-4000-8000-000000000000",
      "email": "user@example.com",
      "display_name": "string",
      "phone": "string",
      "roles": [
        "string"
      ],
      "email_verified": false,
      "account_status": "string",
      "primary_region_id": "string",
      "preferred_language": "string",
      "total_points": 0
    }
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`409`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "message": "string"
  }
  ```

### User

Authenticated user profile (`/me`).

#### `GET` `/auth/me`

**Summary:** Current user

Returns the authenticated user's full profile (roles, email_verified, account_status, primary_region_id, preferred_language, total_points).

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Responses**

- **`200`**

  ```json
  {
    "id": "string",
    "public_id": "00000000-0000-4000-8000-000000000000",
    "email": "user@example.com",
    "display_name": "string",
    "phone": "string",
    "roles": [
      "string"
    ],
    "email_verified": false,
    "account_status": "string",
    "primary_region_id": "string",
    "preferred_language": "string",
    "total_points": 0
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/me/point-history`

**Summary:** My point history

Returns the authenticated user's recent point ledger entries (newest first).

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| limit | Query | no | integer |


**Responses**

- **`200`**

  ```json
  [
    {
      "id": "string",
      "points_delta": 0,
      "reason_code": "string",
      "note": "string",
      "related_entity_type": "string",
      "related_entity_id": "string",
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  ]
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/me/points`

**Summary:** My point summary

Returns the authenticated user's point summary (cache of the ledger).

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Responses**

- **`200`**

  ```json
  {
    "total_points": 0,
    "lifetime_points_earned": 0,
    "lifetime_points_removed": 0,
    "updated_at": "2026-01-01T00:00:00.000Z"
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

#### `PATCH` `/me/profile`

**Summary:** Update current user profile

Self-service edit of the authenticated user's profile. Editable: displayName, phone, preferredLanguage, primaryRegionId. Email, roles, verification, and points are read-only here.

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Request body** (`application/json`)

```json
{
  "displayName": "string",
  "phone": "string",
  "preferredLanguage": "my",
  "primaryRegionId": 0
}
```

**Responses**

- **`200`**

  ```json
  {
    "id": "string",
    "public_id": "00000000-0000-4000-8000-000000000000",
    "email": "user@example.com",
    "display_name": "string",
    "phone": "string",
    "roles": [
      "string"
    ],
    "email_verified": false,
    "account_status": "string",
    "primary_region_id": "string",
    "preferred_language": "string",
    "total_points": 0
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/me/saved-places`

**Summary:** List saved places

Returns the authenticated user's saved places (newest first).

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Responses**

- **`200`**

  ```json
  [
    {
      "id": "string",
      "entity_type": "place",
      "entity_id": "string",
      "display_name": "string",
      "custom_name": "string",
      "category": {
        "code": "string",
        "name": "string"
      },
      "address_line": "string",
      "plus_code": "string",
      "latitude": 0,
      "longitude": 0,
      "admin_area_id": "string",
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  ]
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

#### `POST` `/me/saved-places`

**Summary:** Save a place or map point

Saves an item for the authenticated user. `entityType: "place"` references a public, non-deleted core place (duplicate saves return 409). `entityType: "map_point"` stores an arbitrary clicked location (latitude/longitude required).

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Request body** (`application/json`)

```json
{
  "entityType": "place",
  "entityId": 0
}
```

**Responses**

- **`201`**

  ```json
  {
    "id": "string",
    "entity_type": "place",
    "entity_id": "string",
    "display_name": "string",
    "custom_name": "string",
    "category": {
      "code": "string",
      "name": "string"
    },
    "address_line": "string",
    "plus_code": "string",
    "latitude": 0,
    "longitude": 0,
    "admin_area_id": "string",
    "created_at": "2026-01-01T00:00:00.000Z"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`409`**

  ```json
  {
    "message": "string"
  }
  ```

#### `DELETE` `/me/saved-places/{id}`

**Summary:** Delete a saved place

Removes one of the authenticated user's own saved places.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {
    "message": "Saved place removed"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

### Categories

Place category reference data (public and internal).

#### `GET` `/categories`

**Summary:** List categories

Public reference list of place categories. Query parameters are parsed but may not filter results until wired in the service.

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| parentId | Query | no | string |
| includePrivate | Query | no | boolean |


**Responses**

- **`200`**

  ```json
  [
    {
      "id": "string",
      "code": "string",
      "name": "string",
      "name_mm": "string",
      "sort_order": 0
    }
  ]
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

#### `GET` `/public/categories`

**Summary:** List public categories

Categories exposed to the web client.

**Security:** None

**Responses**

- **`200`**

  ```json
  [
    {
      "id": "string",
      "code": "string",
      "name": "string",
      "nameLocal": "string",
      "iconKey": "string",
      "sortOrder": 0
    }
  ]
  ```

### Admin Areas

Administrative boundaries and GeoJSON layers.

#### `GET` `/admin-areas`

**Summary:** List admin areas

Active administrative areas for dashboard pickers and filtering.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| limit | Query | no | integer |


**Responses**

- **`200`**

  ```json
  [
    {
      "id": "string",
      "parent_id": "string",
      "admin_level_id": "string",
      "canonical_name": "string",
      "slug": "string",
      "is_active": false
    }
  ]
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/admin-areas/options`

**Summary:** Admin area picker options

Active rows from core.core_admin_areas with Myanmar/English labels from core.core_admin_area_names (language my/mm and en).

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| limit | Query | no | integer |
| q | Query | no | string |
| admin_level_code | Query | no | string |


**Responses**

- **`200`**

  ```json
  [
    {
      "id": "string",
      "canonical_name": "string",
      "name_mm": "string",
      "name_en": "string",
      "admin_level_id": "string",
      "admin_level_code": "string",
      "parent_id": "string",
      "admin_level_name": "string",
      "parent_label": "string",
      "boundary_status": "string",
      "address_usage": "string"
    }
  ]
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/admin-areas/road-township-options`

**Summary:** Road/street township override search

Server-side search for active township-level admin areas only (roads). Matches id, public_id, canonical_name, Myanmar/English names (language_code my/en), slug, and external_id. Excludes ward, village, district, state, and country levels.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| q | Query | yes | string |
| limit | Query | no | integer |


**Responses**

- **`200`**

  ```json
  [
    {
      "id": "string",
      "canonical_name": "string",
      "name_mm": "string",
      "name_en": "string",
      "admin_level_id": "string",
      "admin_level_code": "string",
      "parent_id": "string",
      "admin_level_name": "string",
      "parent_label": "string",
      "boundary_status": "string",
      "address_usage": "string"
    }
  ]
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

#### `POST` `/entity-admin-area/infer`

**Summary:** Infer township admin_area_id from entity geometry

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Request body** (`application/json`)

```json
{
  "kind": "place",
  "lat": 0,
  "lng": 0,
  "geometry": {},
  "current_admin_area_id": "string",
  "entity_public_id": "string"
}
```

**Responses**

- **`200`**

  ```json
  {
    "admin_area_id": "string",
    "canonical_name": "string",
    "admin_level_code": "string",
    "name_mm": "string",
    "name_en": "string",
    "geometry_contains": false,
    "status": "valid_existing",
    "message": "string",
    "currentAdminArea": {
      "id": "string",
      "name": "string",
      "level_code": "string",
      "is_active": false
    },
    "recommendedTownship": {
      "id": "string",
      "name_mm": "string",
      "name_en": "string",
      "canonical_name": "string"
    },
    "recommendationMode": "single_overlap",
    "intersectingTownships": [
      {
        "id": "string",
        "canonical_name": "string",
        "name_mm": "string",
        "name_en": "string",
        "admin_level_code": "string",
        "overlap_m": 0,
        "overlap_pct": 0
      }
    ],
    "commonParentAdminArea": {
      "id": "string",
      "canonical_name": "string",
      "admin_level_code": "string",
      "name_mm": "string",
      "name_en": "string"
    },
    "debugReason": "invalid_geometry",
    "fallbackReason": "point_fallback",
    "nearestTownshipDistanceM": 0
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

#### `POST` `/entity-admin-area/validate-manual`

**Summary:** Validate manual township admin_area_id against geometry

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Request body** (`application/json`)

```json
{
  "kind": "place",
  "admin_area_id": "string",
  "lat": 0,
  "lng": 0,
  "geometry": {}
}
```

**Responses**

- **`200`**

  ```json
  {
    "valid": false,
    "geometry_contains": false,
    "inferred_admin_area_id": "string",
    "admin_level_code": "string",
    "message": "string",
    "can_save_without_override": false
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

#### `GET` `/public/admin-areas/{id}`

**Summary:** Get one admin area (public)

Public, read-only lookup of a single active admin area by id (region picker prefill).

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {
    "id": "string",
    "name": "string",
    "name_my": "string",
    "name_en": "string",
    "admin_level": "string",
    "admin_level_code": "string",
    "parent_name": "string",
    "display_name": "string"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/public/admin-areas/search`

**Summary:** Search admin areas (public)

Public, read-only search over active admin areas for the profile region picker. Matches Myanmar/English names, canonical name, and slug.

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| q | Query | no | string |
| limit | Query | no | integer |


**Responses**

- **`200`**

  ```json
  [
    {
      "id": "string",
      "name": "string",
      "name_my": "string",
      "name_en": "string",
      "admin_level": "string",
      "admin_level_code": "string",
      "parent_name": "string",
      "display_name": "string"
    }
  ]
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

#### `GET` `/public/map/geo/admin-areas`

**Summary:** Admin area boundaries GeoJSON

**Security:** None

**Responses**

- **`200`**

  ```json
  {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "geometry": {
          "type": "string",
          "coordinates": null,
          "bbox": [
            0
          ]
        },
        "properties": {},
        "id": "string"
      }
    ]
  }
  ```

### Places

Dashboard place CRUD, form options, and place–building links.

#### `GET` `/buildings/{id}/places`

**Summary:** List places linked to a building

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string, uuid |


**Responses**

- **`200`**

  ```json
  {
    "items": [
      {
        "relation_type": "inside",
        "is_primary": false,
        "created_at": "2026-01-01T00:00:00.000Z",
        "place": {
          "public_id": "00000000-0000-4000-8000-000000000000",
          "primary_name": "string",
          "display_name": "string",
          "lat": 0,
          "lng": 0,
          "category_name": "string"
        }
      }
    ]
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/place-form-options`

**Summary:** Place form reference options

Dropdown values for create/edit place forms.

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Responses**

- **`200`**

  ```json
  {
    "categories": [
      {
        "id": "string",
        "code": "string",
        "parent_id": "string",
        "name": "string",
        "name_mm": "string",
        "label": "string",
        "sort_order": 0,
        "is_public": false,
        "is_searchable": false
      }
    ],
    "admin_areas": [
      {
        "id": "string",
        "label": "string"
      }
    ],
    "source_types": [
      {
        "id": "string",
        "code": "string",
        "label": "string"
      }
    ],
    "publish_statuses": [
      {
        "id": "string",
        "code": "string",
        "label": "string"
      }
    ]
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/places`

**Summary:** List places

Paginated place list for the dashboard (authenticated).

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| q | Query | no | string |
| category | Query | no | string |
| is_public | Query | no | boolean |
| is_verified | Query | no | boolean |
| limit | Query | no | integer |
| offset | Query | no | integer |
| sortBy | Query | no | string |
| sortOrder | Query | no | string |


**Responses**

- **`200`**

  ```json
  [
    {
      "id": "string",
      "public_id": "00000000-0000-4000-8000-000000000000",
      "primary_name": "string",
      "secondary_name": "string",
      "name_local": "string",
      "myanmar_name": "string",
      "english_name": "string",
      "name_mm": "string",
      "name_en": "string",
      "display_name": "string",
      "category_id": "string",
      "category_name": "string",
      "admin_area_id": "string",
      "admin_area_name": "string",
      "lat": 0,
      "lng": 0,
      "importance_score": 0,
      "popularity_score": 0,
      "confidence_score": 0,
      "is_public": false,
      "is_verified": false,
      "source_type_id": "string",
      "publish_status_id": "string",
      "created_at": "2026-01-01T00:00:00.000Z",
      "updated_at": "2026-01-01T00:00:00.000Z",
      "names": [
        {
          "id": "string",
          "name": "string",
          "language_code": "string",
          "script_code": "string",
          "name_type": "string",
          "is_primary": false,
          "search_weight": 0
        }
      ],
      "myanmarName": "string",
      "englishName": "string"
    }
  ]
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

#### `POST` `/places`

**Summary:** Create place

Requires admin or editor role. At least one of `myanmarName` or `englishName` must be provided.

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Request body** (`application/json`)

```json
{
  "categoryId": "string",
  "lat": 0,
  "lng": 0,
  "myanmarName": "string",
  "englishName": "string",
  "adminAreaId": "string",
  "plusCode": "string",
  "importanceScore": 0,
  "popularityScore": 0,
  "confidenceScore": 0,
  "isPublic": false,
  "isVerified": false,
  "sourceTypeId": "string",
  "publishStatusId": "string"
}
```

**Responses**

- **`201`**

  ```json
  {
    "id": "string",
    "public_id": "00000000-0000-4000-8000-000000000000",
    "primary_name": "string",
    "secondary_name": "string",
    "name_local": "string",
    "myanmar_name": "string",
    "english_name": "string",
    "name_mm": "string",
    "name_en": "string",
    "display_name": "string",
    "category_id": "string",
    "category_name": "string",
    "admin_area_id": "string",
    "admin_area_name": "string",
    "lat": 0,
    "lng": 0,
    "importance_score": 0,
    "popularity_score": 0,
    "confidence_score": 0,
    "is_public": false,
    "is_verified": false,
    "source_type_id": "string",
    "publish_status_id": "string",
    "created_at": "2026-01-01T00:00:00.000Z",
    "updated_at": "2026-01-01T00:00:00.000Z",
    "names": [
      {
        "id": "string",
        "name": "string",
        "language_code": "string",
        "script_code": "string",
        "name_type": "string",
        "is_primary": false,
        "search_weight": 0
      }
    ],
    "myanmarName": "string",
    "englishName": "string",
    "…": "(more fields — see OpenAPI spec)"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/places/{id}`

**Summary:** Get place by id

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string, uuid |


**Responses**

- **`200`**

  ```json
  {
    "id": "string",
    "public_id": "00000000-0000-4000-8000-000000000000",
    "primary_name": "string",
    "secondary_name": "string",
    "name_local": "string",
    "myanmar_name": "string",
    "english_name": "string",
    "name_mm": "string",
    "name_en": "string",
    "display_name": "string",
    "category_id": "string",
    "category_name": "string",
    "admin_area_id": "string",
    "admin_area_name": "string",
    "lat": 0,
    "lng": 0,
    "importance_score": 0,
    "popularity_score": 0,
    "confidence_score": 0,
    "is_public": false,
    "is_verified": false,
    "source_type_id": "string",
    "publish_status_id": "string",
    "created_at": "2026-01-01T00:00:00.000Z",
    "updated_at": "2026-01-01T00:00:00.000Z",
    "names": [
      {
        "id": "string",
        "name": "string",
        "language_code": "string",
        "script_code": "string",
        "name_type": "string",
        "is_primary": false,
        "search_weight": 0
      }
    ],
    "myanmarName": "string",
    "englishName": "string",
    "…": "(more fields — see OpenAPI spec)"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `PATCH` `/places/{id}`

**Summary:** Update place

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string, uuid |


**Request body** (`application/json`)

```json
{
  "myanmarName": "string",
  "englishName": "string",
  "categoryId": "string",
  "adminAreaId": "string",
  "lat": 0,
  "lng": 0,
  "plusCode": "string",
  "importanceScore": 0,
  "popularityScore": 0,
  "confidenceScore": 0,
  "isPublic": false,
  "isVerified": false,
  "sourceTypeId": "string",
  "publishStatusId": "string"
}
```

**Responses**

- **`200`**

  ```json
  {
    "id": "string",
    "public_id": "00000000-0000-4000-8000-000000000000",
    "primary_name": "string",
    "secondary_name": "string",
    "name_local": "string",
    "myanmar_name": "string",
    "english_name": "string",
    "name_mm": "string",
    "name_en": "string",
    "display_name": "string",
    "category_id": "string",
    "category_name": "string",
    "admin_area_id": "string",
    "admin_area_name": "string",
    "lat": 0,
    "lng": 0,
    "importance_score": 0,
    "popularity_score": 0,
    "confidence_score": 0,
    "is_public": false,
    "is_verified": false,
    "source_type_id": "string",
    "publish_status_id": "string",
    "created_at": "2026-01-01T00:00:00.000Z",
    "updated_at": "2026-01-01T00:00:00.000Z",
    "names": [
      {
        "id": "string",
        "name": "string",
        "language_code": "string",
        "script_code": "string",
        "name_type": "string",
        "is_primary": false,
        "search_weight": 0
      }
    ],
    "myanmarName": "string",
    "englishName": "string",
    "…": "(more fields — see OpenAPI spec)"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `DELETE` `/places/{id}`

**Summary:** Delete place

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string, uuid |


**Responses**

- **`200`**

  ```json
  {
    "success": false,
    "public_id": "00000000-0000-4000-8000-000000000000"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/places/{id}/buildings`

**Summary:** List buildings linked to a place

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string, uuid |


**Responses**

- **`200`**

  ```json
  {
    "items": [
      {
        "relation_type": "inside",
        "is_primary": false,
        "created_at": "2026-01-01T00:00:00.000Z",
        "building": {
          "public_id": "00000000-0000-4000-8000-000000000000",
          "name": "string",
          "building_type_id": "string",
          "building_type": null,
          "building_type_code": "string",
          "building_type_name": "string",
          "building_type_name_mm": "string",
          "class_code": "string",
          "area_m2": 0,
          "admin_area": null
        }
      }
    ]
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `POST` `/places/{id}/buildings`

**Summary:** Link building to place

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string, uuid |


**Request body** (`application/json`)

```json
{
  "building_id": "00000000-0000-4000-8000-000000000000",
  "relation_type": "inside",
  "is_primary": false
}
```

**Responses**

- **`201`**

  ```json
  {
    "place_id": "00000000-0000-4000-8000-000000000000",
    "relation_type": "inside",
    "is_primary": false,
    "created_at": "2026-01-01T00:00:00.000Z",
    "building": {
      "public_id": "00000000-0000-4000-8000-000000000000",
      "name": "string",
      "building_type_id": "string",
      "building_type": null,
      "building_type_code": "string",
      "building_type_name": "string",
      "building_type_name_mm": "string",
      "class_code": "string",
      "area_m2": 0,
      "admin_area": null
    }
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`409`**

  ```json
  {
    "message": "string"
  }
  ```

#### `PATCH` `/places/{id}/buildings/{buildingId}`

**Summary:** Update place–building link

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string, uuid |
| buildingId | Path | yes | string, uuid |


**Request body** (`application/json`)

```json
{
  "relation_type": "inside",
  "is_primary": false
}
```

**Responses**

- **`200`**

  ```json
  {
    "place_id": "00000000-0000-4000-8000-000000000000",
    "relation_type": "inside",
    "is_primary": false,
    "created_at": "2026-01-01T00:00:00.000Z",
    "building": {
      "public_id": "00000000-0000-4000-8000-000000000000",
      "name": "string",
      "building_type_id": "string",
      "building_type": null,
      "building_type_code": "string",
      "building_type_name": "string",
      "building_type_name_mm": "string",
      "class_code": "string",
      "area_m2": 0,
      "admin_area": null
    }
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `DELETE` `/places/{id}/buildings/{buildingId}`

**Summary:** Remove place–building link

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string, uuid |
| buildingId | Path | yes | string, uuid |


**Responses**

- **`200`**

  ```json
  {
    "ok": false,
    "place_id": "00000000-0000-4000-8000-000000000000",
    "building_id": "00000000-0000-4000-8000-000000000000"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/public/map/places`

**Summary:** List public places in a map viewport

GeoJSON FeatureCollection of lightweight public place points inside the requested bbox.

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| bbox | Query | yes | string |
| zoom | Query | yes | number |
| category | Query | no | string |
| limit | Query | no | integer |
| offset | Query | no | integer |


**Responses**

- **`200`**

  ```json
  {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "id": "00000000-0000-4000-8000-000000000000",
        "geometry": {
          "type": "Point",
          "coordinates": [
            0
          ]
        },
        "properties": {
          "id": "string",
          "public_id": "00000000-0000-4000-8000-000000000000",
          "publicId": "00000000-0000-4000-8000-000000000000",
          "display_name": "string",
          "primary_name": "string",
          "name": "string",
          "name_mm": "string",
          "name_en": "string",
          "category_code": "string",
          "category_name": "string",
          "categoryCode": "string",
          "categoryName": "string",
          "importance_score": 0,
          "importanceScore": 0,
          "is_verified": false,
          "isVerified": false,
          "lat": 0,
          "lng": 0
        }
      }
    ],
    "metadata": {
      "count": 0,
      "limit": 0,
      "offset": 0,
      "has_more": false,
      "bbox": [
        0
      ],
      "zoom": 0,
      "density_debug": {
        "zoom": 0,
        "bbox": [
          0
        ],
        "threshold_used": 0,
        "returned_count": 0
      }
    }
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

#### `GET` `/public/places`

**Summary:** List public places

Unauthenticated list for the public map (filtered, limited).

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| q | Query | no | string |
| category | Query | no | string |
| categoryId | Query | no | string |
| limit | Query | no | integer |


**Responses**

- **`200`**

  ```json
  [
    {
      "id": "string",
      "publicId": "00000000-0000-4000-8000-000000000000",
      "myanmar_name": "string",
      "english_name": "string",
      "name_mm": "string",
      "name_en": "string",
      "display_name": "string",
      "primary_name": "string",
      "categoryId": "string",
      "categoryCode": "string",
      "category_name": "string",
      "categoryName": "string",
      "lat": 0,
      "lng": 0,
      "importanceScore": 0,
      "isVerified": false
    }
  ]
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

#### `GET` `/public/places/{id}`

**Summary:** Get public place

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string, uuid |


**Responses**

- **`200`**

  ```json
  {
    "id": "string",
    "publicId": "00000000-0000-4000-8000-000000000000",
    "myanmar_name": "string",
    "english_name": "string",
    "name_mm": "string",
    "name_en": "string",
    "display_name": "string",
    "primary_name": "string",
    "categoryId": "string",
    "categoryCode": "string",
    "category_name": "string",
    "categoryName": "string",
    "lat": 0,
    "lng": 0,
    "importanceScore": 0,
    "isVerified": false,
    "address_line": "string",
    "plus_code": "string"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

### Streets

Street centerlines, road classes, validation, and map GeoJSON.

#### `GET` `/public/map/geo/streets`

**Summary:** Street centerlines GeoJSON

GeoJSON FeatureCollection for map rendering.

**Security:** None

**Responses**

- **`200`**

  ```json
  {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "geometry": {
          "type": "string",
          "coordinates": null,
          "bbox": [
            0
          ]
        },
        "properties": {},
        "id": "string"
      }
    ]
  }
  ```

#### `GET` `/road-classes`

**Summary:** List road classes

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Responses**

- **`200`**

  ```json
  [
    {
      "id": "string",
      "code": "string",
      "name": "string",
      "rank": 0
    }
  ]
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/streets`

**Summary:** List streets (dashboard)

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| q | Query | no | string |
| limit | Query | no | integer |
| sortBy | Query | no | string |
| sortOrder | Query | no | string |
| include_deleted | Query | no | boolean |


**Responses**

- **`200`**

  ```json
  [
    {
      "public_id": "00000000-0000-4000-8000-000000000000",
      "canonical_name": "string",
      "admin_area_id": "string",
      "admin_area_name": "string",
      "road_class_id": "string",
      "road_class": "string",
      "road_class_name": "string",
      "surface": "string",
      "is_oneway": false,
      "bridge": false,
      "tunnel": false,
      "manual_override": false,
      "edit_status": "string",
      "routing_status": "string",
      "deleted_at": "2026-01-01T00:00:00.000Z",
      "last_edited_at": "2026-01-01T00:00:00.000Z",
      "is_active": false,
      "is_verified": false,
      "created_at": "2026-01-01T00:00:00.000Z",
      "updated_at": "2026-01-01T00:00:00.000Z",
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [
            "(…)"
          ]
        ]
      },
      "names": [
        {
          "id": "string",
          "name": "string",
          "language_code": "string",
          "script_code": "string",
          "name_type": "string",
          "is_primary": false
        }
      ],
      "myanmarName": "string",
      "englishName": "string",
      "source_type_id": "string"
    }
  ]
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

#### `POST` `/streets`

**Summary:** Create street

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Request body** (`application/json`)

```json
{
  "road_class_id": "string",
  "geometry": {
    "type": "LineString",
    "coordinates": [
      [
        0
      ]
    ]
  },
  "myanmarName": "string",
  "englishName": "string",
  "is_oneway": false,
  "surface": "string",
  "admin_area_id": "string",
  "adminAreaId": "string",
  "source_type_id": "string",
  "sourceTypeId": "string",
  "is_active": false,
  "bridge": false,
  "tunnel": false
}
```

**Responses**

- **`201`**

  ```json
  {
    "public_id": "00000000-0000-4000-8000-000000000000",
    "canonical_name": "string",
    "admin_area_id": "string",
    "admin_area_name": "string",
    "road_class_id": "string",
    "road_class": "string",
    "road_class_name": "string",
    "surface": "string",
    "is_oneway": false,
    "bridge": false,
    "tunnel": false,
    "manual_override": false,
    "edit_status": "string",
    "routing_status": "string",
    "deleted_at": "2026-01-01T00:00:00.000Z",
    "last_edited_at": "2026-01-01T00:00:00.000Z",
    "is_active": false,
    "is_verified": false,
    "created_at": "2026-01-01T00:00:00.000Z",
    "updated_at": "2026-01-01T00:00:00.000Z",
    "geometry": {
      "type": "LineString",
      "coordinates": [
        [
          0
        ]
      ]
    },
    "names": [
      {
        "id": "string",
        "name": "string",
        "language_code": "string",
        "script_code": "string",
        "name_type": "string",
        "is_primary": false
      }
    ],
    "myanmarName": "string",
    "englishName": "string",
    "source_type_id": "string"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/streets/{id}`

**Summary:** Get street by public id

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string, uuid |


**Responses**

- **`200`**

  ```json
  {
    "public_id": "00000000-0000-4000-8000-000000000000",
    "canonical_name": "string",
    "admin_area_id": "string",
    "admin_area_name": "string",
    "road_class_id": "string",
    "road_class": "string",
    "road_class_name": "string",
    "surface": "string",
    "is_oneway": false,
    "bridge": false,
    "tunnel": false,
    "manual_override": false,
    "edit_status": "string",
    "routing_status": "string",
    "deleted_at": "2026-01-01T00:00:00.000Z",
    "last_edited_at": "2026-01-01T00:00:00.000Z",
    "is_active": false,
    "is_verified": false,
    "created_at": "2026-01-01T00:00:00.000Z",
    "updated_at": "2026-01-01T00:00:00.000Z",
    "geometry": {
      "type": "LineString",
      "coordinates": [
        [
          0
        ]
      ]
    },
    "names": [
      {
        "id": "string",
        "name": "string",
        "language_code": "string",
        "script_code": "string",
        "name_type": "string",
        "is_primary": false
      }
    ],
    "myanmarName": "string",
    "englishName": "string",
    "source_type_id": "string"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `PATCH` `/streets/{id}`

**Summary:** Update street

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string, uuid |


**Request body** (`application/json`)

```json
{
  "myanmarName": "string",
  "englishName": "string",
  "geometry": {
    "type": "LineString",
    "coordinates": [
      [
        0
      ]
    ]
  },
  "road_class_id": "string",
  "roadClassId": "string",
  "is_oneway": false,
  "isOneway": false,
  "surface": "string",
  "admin_area_id": "string",
  "adminAreaId": "string",
  "edit_reason": "string",
  "bridge": false,
  "tunnel": false
}
```

**Responses**

- **`200`**

  ```json
  {
    "public_id": "00000000-0000-4000-8000-000000000000",
    "canonical_name": "string",
    "admin_area_id": "string",
    "admin_area_name": "string",
    "road_class_id": "string",
    "road_class": "string",
    "road_class_name": "string",
    "surface": "string",
    "is_oneway": false,
    "bridge": false,
    "tunnel": false,
    "manual_override": false,
    "edit_status": "string",
    "routing_status": "string",
    "deleted_at": "2026-01-01T00:00:00.000Z",
    "last_edited_at": "2026-01-01T00:00:00.000Z",
    "is_active": false,
    "is_verified": false,
    "created_at": "2026-01-01T00:00:00.000Z",
    "updated_at": "2026-01-01T00:00:00.000Z",
    "geometry": {
      "type": "LineString",
      "coordinates": [
        [
          0
        ]
      ]
    },
    "names": [
      {
        "id": "string",
        "name": "string",
        "language_code": "string",
        "script_code": "string",
        "name_type": "string",
        "is_primary": false
      }
    ],
    "myanmarName": "string",
    "englishName": "string",
    "source_type_id": "string"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `DELETE` `/streets/{id}`

**Summary:** Soft-delete street

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string, uuid |


**Request body** (`application/json`)

```json
{
  "edit_reason": "string"
}
```

**Responses**

- **`200`**

  ```json
  {
    "public_id": "00000000-0000-4000-8000-000000000000",
    "canonical_name": "string",
    "admin_area_id": "string",
    "admin_area_name": "string",
    "road_class_id": "string",
    "road_class": "string",
    "road_class_name": "string",
    "surface": "string",
    "is_oneway": false,
    "bridge": false,
    "tunnel": false,
    "manual_override": false,
    "edit_status": "string",
    "routing_status": "string",
    "deleted_at": "2026-01-01T00:00:00.000Z",
    "last_edited_at": "2026-01-01T00:00:00.000Z",
    "is_active": false,
    "is_verified": false,
    "created_at": "2026-01-01T00:00:00.000Z",
    "updated_at": "2026-01-01T00:00:00.000Z",
    "geometry": {
      "type": "LineString",
      "coordinates": [
        [
          0
        ]
      ]
    },
    "names": [
      {
        "id": "string",
        "name": "string",
        "language_code": "string",
        "script_code": "string",
        "name_type": "string",
        "is_primary": false
      }
    ],
    "myanmarName": "string",
    "englishName": "string",
    "source_type_id": "string"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `POST` `/streets/{id}/split`

**Summary:** Split street at point

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | — |


**Request body** (`application/json`)

```json
{
  "point": {
    "lat": 0,
    "lng": 0
  },
  "editReason": "string",
  "split_point": {
    "type": "Point",
    "coordinates": [
      0
    ]
  },
  "edit_reason": "string"
}
```

**Responses**

- **`200`**

  ```json
  {
    "originalStreetId": "00000000-0000-4000-8000-000000000000",
    "newStreets": [
      {
        "public_id": "00000000-0000-4000-8000-000000000000",
        "canonical_name": "string",
        "admin_area_id": "string",
        "admin_area_name": "string",
        "road_class_id": "string",
        "road_class": "string",
        "road_class_name": "string",
        "surface": "string",
        "is_oneway": false,
        "bridge": false,
        "tunnel": false,
        "manual_override": false,
        "edit_status": "string",
        "routing_status": "string",
        "deleted_at": "2026-01-01T00:00:00.000Z",
        "last_edited_at": "2026-01-01T00:00:00.000Z",
        "is_active": false,
        "is_verified": false,
        "created_at": "2026-01-01T00:00:00.000Z",
        "updated_at": "2026-01-01T00:00:00.000Z",
        "geometry": {
          "type": "LineString",
          "coordinates": [
            "(…)"
          ]
        },
        "names": [
          {
            "id": "string",
            "name": "string",
            "language_code": "string",
            "script_code": "string",
            "name_type": "string",
            "is_primary": false
          }
        ],
        "myanmarName": "string",
        "englishName": "string",
        "source_type_id": "string"
      }
    ],
    "streets": [
      {
        "public_id": "00000000-0000-4000-8000-000000000000",
        "canonical_name": "string",
        "admin_area_id": "string",
        "admin_area_name": "string",
        "road_class_id": "string",
        "road_class": "string",
        "road_class_name": "string",
        "surface": "string",
        "is_oneway": false,
        "bridge": false,
        "tunnel": false,
        "manual_override": false,
        "edit_status": "string",
        "routing_status": "string",
        "deleted_at": "2026-01-01T00:00:00.000Z",
        "last_edited_at": "2026-01-01T00:00:00.000Z",
        "is_active": false,
        "is_verified": false,
        "created_at": "2026-01-01T00:00:00.000Z",
        "updated_at": "2026-01-01T00:00:00.000Z",
        "geometry": {
          "type": "LineString",
          "coordinates": [
            "(…)"
          ]
        },
        "names": [
          {
            "id": "string",
            "name": "string",
            "language_code": "string",
            "script_code": "string",
            "name_type": "string",
            "is_primary": false
          }
        ],
        "myanmarName": "string",
        "englishName": "string",
        "source_type_id": "string"
      }
    ]
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/streets/nearby`

**Summary:** Streets in map viewport

Returns active street centerlines intersecting a WGS84 bbox for map editor overlays. Uses GIST index; no COUNT.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| bbox | Query | yes | string |
| limit | Query | no | integer |


**Responses**

- **`200`**

  ```json
  [
    {
      "public_id": "00000000-0000-4000-8000-000000000000",
      "canonical_name": "string",
      "myanmarName": "string",
      "englishName": "string",
      "road_class": "string",
      "is_active": false,
      "deleted_at": "2026-01-01T00:00:00.000Z",
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [
            0
          ]
        ]
      }
    }
  ]
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/streets/nearest-point`

**Summary:** Nearest point on a street

Snap helper within a search radius (meters).

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| lat | Query | yes | number |
| lng | Query | yes | number |
| radiusMeters | Query | no | number |
| excludePublicId | Query | no | string, uuid |


**Responses**

- **`200`**

  ```json
  {
    "street_id": "00000000-0000-4000-8000-000000000000",
    "nearest": {
      "lng": 0,
      "lat": 0
    },
    "distance_m": 0,
    "street_name": "string",
    "road_class": "string"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

#### `POST` `/streets/validate-geometry`

**Summary:** Validate street geometry

Topology checks against `core.core_streets`. Requires admin or editor.

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Request body** (`application/json`)

```json
{
  "geometry": {
    "type": "LineString",
    "coordinates": [
      [
        0
      ]
    ]
  },
  "streetId": "00000000-0000-4000-8000-000000000000",
  "toleranceMeters": 0,
  "street_id": "00000000-0000-4000-8000-000000000000"
}
```

**Responses**

- **`200`**

  ```json
  {
    "isValid": false,
    "errors": [
      "string"
    ],
    "warnings": [
      "string"
    ],
    "startConnection": null,
    "endConnection": null,
    "crossings": [
      {
        "streetId": "00000000-0000-4000-8000-000000000000",
        "streetName": "string",
        "roadClass": "string"
      }
    ],
    "duplicates": [
      {
        "streetId": "00000000-0000-4000-8000-000000000000",
        "streetName": "string",
        "roadClass": "string",
        "kind": "overlap"
      }
    ]
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

### Buildings

Building footprints and taxonomy.

#### `GET` `/building-types`

**Summary:** List active flat building types

Returns ref.ref_building_types where is_active = true and parent_id IS NULL (16 simplified codes for create/update dropdowns).

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Responses**

- **`200`**

  ```json
  [
    {
      "id": "string",
      "code": "string",
      "name": "string",
      "name_mm": "string",
      "parent_id": "string",
      "sort_order": 0
    }
  ]
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/buildings`

**Summary:** List buildings

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| limit | Query | no | integer |
| offset | Query | no | integer |
| q | Query | no | string |
| sortBy | Query | no | string |
| sortOrder | Query | no | string |


**Responses**

- **`200`**

  ```json
  [
    {
      "id": "string",
      "public_id": "00000000-0000-4000-8000-000000000000",
      "external_id": "string",
      "name": "string",
      "names": [
        {
          "name": "string",
          "languageCode": "my",
          "nameType": "official",
          "isPrimary": false,
          "searchWeight": 0,
          "id": 0,
          "scriptCode": "string"
        }
      ],
      "building_type_id": "string",
      "building_type": {
        "id": "string",
        "code": "string",
        "name": "string",
        "name_mm": "string",
        "parent_id": "string"
      },
      "building_type_code": "string",
      "building_type_name": "string",
      "building_type_name_mm": "string",
      "admin_area_id": "string",
      "admin_area": {
        "id": "string",
        "canonical_name": "string",
        "slug": "string"
      },
      "class_code": "string",
      "normalized_data": {},
      "source_refs": {},
      "levels": 0,
      "height_m": 0,
      "area_m2": 0,
      "confidence_score": 0,
      "is_verified": false,
      "is_active": false,
      "created_at": "2026-01-01T00:00:00.000Z",
      "updated_at": "2026-01-01T00:00:00.000Z",
      "deleted_at": "2026-01-01T00:00:00.000Z",
      "geometry": {
        "type": "Polygon",
        "coordinates": [
          [
            "(…)"
          ]
        ]
      },
      "name_mm": "string",
      "name_en": "string",
      "fallback_name": "string"
    }
  ]
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "message": "string"
  }
  ```

#### `POST` `/buildings`

**Summary:** Create building

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Request body** (`application/json`)

```json
{
  "geometry": {
    "type": "Polygon",
    "coordinates": [
      [
        [
          0
        ]
      ]
    ]
  },
  "name": "string",
  "name_mm": "string",
  "name_en": "string",
  "building_type": "string",
  "building_type_id": "string",
  "admin_area_id": "string",
  "levels": 0,
  "height_m": 0,
  "confidence_score": 0,
  "is_verified": false
}
```

**Responses**

- **`201`**

  ```json
  {
    "id": "string",
    "public_id": "00000000-0000-4000-8000-000000000000",
    "external_id": "string",
    "name": "string",
    "names": [
      {
        "name": "string",
        "languageCode": "my",
        "nameType": "official",
        "isPrimary": false,
        "searchWeight": 0,
        "id": 0,
        "scriptCode": "string"
      }
    ],
    "building_type_id": "string",
    "building_type": {
      "id": "string",
      "code": "string",
      "name": "string",
      "name_mm": "string",
      "parent_id": "string"
    },
    "building_type_code": "string",
    "building_type_name": "string",
    "building_type_name_mm": "string",
    "admin_area_id": "string",
    "admin_area": {
      "id": "string",
      "canonical_name": "string",
      "slug": "string"
    },
    "class_code": "string",
    "normalized_data": {},
    "source_refs": {},
    "levels": 0,
    "height_m": 0,
    "area_m2": 0,
    "confidence_score": 0,
    "is_verified": false,
    "is_active": false,
    "created_at": "2026-01-01T00:00:00.000Z",
    "updated_at": "2026-01-01T00:00:00.000Z",
    "deleted_at": "2026-01-01T00:00:00.000Z",
    "geometry": {
      "type": "Polygon",
      "coordinates": [
        [
          [
            "(…)"
          ]
        ]
      ]
    },
    "name_mm": "string",
    "name_en": "string",
    "fallback_name": "string"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/buildings/{id}`

**Summary:** Get building

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string, uuid |


**Responses**

- **`200`**

  ```json
  {
    "id": "string",
    "public_id": "00000000-0000-4000-8000-000000000000",
    "external_id": "string",
    "name": "string",
    "names": [
      {
        "name": "string",
        "languageCode": "my",
        "nameType": "official",
        "isPrimary": false,
        "searchWeight": 0,
        "id": 0,
        "scriptCode": "string"
      }
    ],
    "building_type_id": "string",
    "building_type": {
      "id": "string",
      "code": "string",
      "name": "string",
      "name_mm": "string",
      "parent_id": "string"
    },
    "building_type_code": "string",
    "building_type_name": "string",
    "building_type_name_mm": "string",
    "admin_area_id": "string",
    "admin_area": {
      "id": "string",
      "canonical_name": "string",
      "slug": "string"
    },
    "class_code": "string",
    "normalized_data": {},
    "source_refs": {},
    "levels": 0,
    "height_m": 0,
    "area_m2": 0,
    "confidence_score": 0,
    "is_verified": false,
    "is_active": false,
    "created_at": "2026-01-01T00:00:00.000Z",
    "updated_at": "2026-01-01T00:00:00.000Z",
    "deleted_at": "2026-01-01T00:00:00.000Z",
    "geometry": {
      "type": "Polygon",
      "coordinates": [
        [
          [
            "(…)"
          ]
        ]
      ]
    },
    "name_mm": "string",
    "name_en": "string",
    "fallback_name": "string"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "message": "string"
  }
  ```

#### `PATCH` `/buildings/{id}`

**Summary:** Update building

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string, uuid |


**Request body** (`application/json`)

```json
{
  "geometry": {
    "type": "Polygon",
    "coordinates": [
      [
        [
          0
        ]
      ]
    ]
  },
  "name": "string",
  "name_mm": "string",
  "name_en": "string",
  "building_type": "string",
  "building_type_id": "string",
  "admin_area_id": "string",
  "levels": 0,
  "height_m": 0,
  "confidence_score": 0,
  "is_verified": false
}
```

**Responses**

- **`200`**

  ```json
  {
    "id": "string",
    "public_id": "00000000-0000-4000-8000-000000000000",
    "external_id": "string",
    "name": "string",
    "names": [
      {
        "name": "string",
        "languageCode": "my",
        "nameType": "official",
        "isPrimary": false,
        "searchWeight": 0,
        "id": 0,
        "scriptCode": "string"
      }
    ],
    "building_type_id": "string",
    "building_type": {
      "id": "string",
      "code": "string",
      "name": "string",
      "name_mm": "string",
      "parent_id": "string"
    },
    "building_type_code": "string",
    "building_type_name": "string",
    "building_type_name_mm": "string",
    "admin_area_id": "string",
    "admin_area": {
      "id": "string",
      "canonical_name": "string",
      "slug": "string"
    },
    "class_code": "string",
    "normalized_data": {},
    "source_refs": {},
    "levels": 0,
    "height_m": 0,
    "area_m2": 0,
    "confidence_score": 0,
    "is_verified": false,
    "is_active": false,
    "created_at": "2026-01-01T00:00:00.000Z",
    "updated_at": "2026-01-01T00:00:00.000Z",
    "deleted_at": "2026-01-01T00:00:00.000Z",
    "geometry": {
      "type": "Polygon",
      "coordinates": [
        [
          [
            "(…)"
          ]
        ]
      ]
    },
    "name_mm": "string",
    "name_en": "string",
    "fallback_name": "string"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "message": "string"
  }
  ```

#### `DELETE` `/buildings/{id}`

**Summary:** Soft-delete building

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string, uuid |


**Responses**

- **`200`**

  ```json
  {
    "ok": false,
    "deleted": false,
    "public_id": "00000000-0000-4000-8000-000000000000"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "message": "string"
  }
  ```

### Dashboard

Internal admin surfaces.

#### `GET` `/admin/addresses/reverse-debug`

**Summary:** Reverse geocode debug (admin)

Same resolver as GET /addresses/reverse with candidate layers and decision reason. Requires dashboard authentication.

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| lat | Query | yes | number |
| lng | Query | yes | number |
| lang | Query | no | string |


**Responses**

- **`200`**

  ```json
  {
    "debug": {
      "lat": 0,
      "lng": 0,
      "lang": "string",
      "decision_reason": "string",
      "layers": {}
    },
    "result_type": "string",
    "confidence_score": 0,
    "full_address_en": null,
    "full_address_my": null,
    "display_address": null,
    "components": [
      {
        "component_type": "string",
        "value": "string",
        "language_code": "string",
        "source": "string",
        "source_id": null,
        "confidence_score": null,
        "match_type": null,
        "boundary_status": null,
        "address_usage": null
      }
    ],
    "matched": {
      "address_id": null,
      "building_id": null,
      "place_id": null,
      "street_id": null,
      "admin_area_id": null
    },
    "alternatives": [
      {}
    ],
    "warnings": [
      "string"
    ]
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {}
  }
  ```

#### `GET` `/admin/points/ledger`

**Summary:** Admin: recent point changes

Admin/super_admin only. Paginated point_ledger feed across all users, with optional user and reason filters.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| userId | Query | no | string, uuid |
| reasonCode | Query | no | string |
| page | Query | no | integer |
| pageSize | Query | no | integer |


**Responses**

- **`200`**

  ```json
  {
    "items": [
      {
        "id": "string",
        "points_delta": 0,
        "reason_code": "string",
        "note": "string",
        "created_at": "2026-01-01T00:00:00.000Z",
        "user_public_id": "00000000-0000-4000-8000-000000000000",
        "user_display_name": "string",
        "user_email": "string",
        "created_by_display_name": "string"
      }
    ],
    "total": 0,
    "page": 0,
    "pageSize": 0
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/admin/points/top-users`

**Summary:** Admin: top point users

Admin/super_admin only. Users ranked by current point balance.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| limit | Query | no | integer |


**Responses**

- **`200`**

  ```json
  [
    {
      "public_id": "00000000-0000-4000-8000-000000000000",
      "display_name": "string",
      "email": "string",
      "total_points": 0,
      "lifetime_points_earned": 0,
      "lifetime_points_removed": 0
    }
  ]
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/admin/users`

**Summary:** Admin: list users

Admin/super_admin. Paginated, filterable user list. No secrets returned.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| search | Query | no | string |
| role | Query | no | string |
| emailVerified | Query | no | boolean |
| accountStatus | Query | no | string |
| primaryRegionId | Query | no | integer |
| createdFrom | Query | no | string, date-time |
| createdTo | Query | no | string, date-time |
| page | Query | no | integer |
| pageSize | Query | no | integer |


**Responses**

- **`200`**

  ```json
  {
    "items": [
      {
        "public_id": "00000000-0000-4000-8000-000000000000",
        "email": "string",
        "display_name": "string",
        "phone": "string",
        "email_verified": false,
        "account_status": "string",
        "primary_region_id": "string",
        "roles": [
          "string"
        ],
        "total_points": 0,
        "last_seen_at": "2026-01-01T00:00:00.000Z",
        "last_login_at": "2026-01-01T00:00:00.000Z",
        "created_at": "2026-01-01T00:00:00.000Z"
      }
    ],
    "total": 0,
    "page": 0,
    "pageSize": 0
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/admin/users/{id}`

**Summary:** Admin: user detail

Admin/super_admin. Full user profile by public_id. No secrets returned.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string, uuid |


**Responses**

- **`200`**

  ```json
  {
    "public_id": "00000000-0000-4000-8000-000000000000",
    "email": "string",
    "display_name": "string",
    "phone": "string",
    "email_verified": false,
    "account_status": "string",
    "primary_region_id": "string",
    "roles": [
      "string"
    ],
    "total_points": 0,
    "last_seen_at": "2026-01-01T00:00:00.000Z",
    "last_login_at": "2026-01-01T00:00:00.000Z",
    "created_at": "2026-01-01T00:00:00.000Z",
    "is_active": false,
    "preferred_language": "string",
    "admin_note": "string",
    "lifetime_points_earned": 0,
    "lifetime_points_removed": 0,
    "saved_places_count": 0,
    "updated_at": "2026-01-01T00:00:00.000Z",
    "deleted_at": "2026-01-01T00:00:00.000Z"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `PATCH` `/admin/users/{id}/admin-note`

**Summary:** Admin: set admin note

Admin/super_admin. Sets or clears the internal admin note. Audited.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string, uuid |


**Request body** (`application/json`)

```json
{
  "adminNote": "string"
}
```

**Responses**

- **`200`**

  ```json
  {
    "public_id": "00000000-0000-4000-8000-000000000000",
    "email": "string",
    "display_name": "string",
    "phone": "string",
    "email_verified": false,
    "account_status": "string",
    "primary_region_id": "string",
    "roles": [
      "string"
    ],
    "total_points": 0,
    "last_seen_at": "2026-01-01T00:00:00.000Z",
    "last_login_at": "2026-01-01T00:00:00.000Z",
    "created_at": "2026-01-01T00:00:00.000Z",
    "is_active": false,
    "preferred_language": "string",
    "admin_note": "string",
    "lifetime_points_earned": 0,
    "lifetime_points_removed": 0,
    "saved_places_count": 0,
    "updated_at": "2026-01-01T00:00:00.000Z",
    "deleted_at": "2026-01-01T00:00:00.000Z"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/admin/users/{id}/audit`

**Summary:** Admin: user audit history

Admin/super_admin. Recent audit log entries for a user (newest first).

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| limit | Query | no | integer |
| id | Path | yes | string, uuid |


**Responses**

- **`200`**

  ```json
  [
    {
      "id": "string",
      "action_type": "string",
      "actor_display_name": "string",
      "before_snapshot": null,
      "after_snapshot": null,
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  ]
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/admin/users/{id}/points`

**Summary:** Admin: user points

Admin/super_admin only. Returns a user's point summary and recent ledger history by user public_id.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| limit | Query | no | integer |
| id | Path | yes | string, uuid |


**Responses**

- **`200`**

  ```json
  {
    "summary": {
      "total_points": 0,
      "lifetime_points_earned": 0,
      "lifetime_points_removed": 0,
      "updated_at": "2026-01-01T00:00:00.000Z"
    },
    "history": [
      {
        "id": "string",
        "points_delta": 0,
        "reason_code": "string",
        "note": "string",
        "related_entity_type": "string",
        "related_entity_id": "string",
        "created_at": "2026-01-01T00:00:00.000Z"
      }
    ]
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `POST` `/admin/users/{id}/points`

**Summary:** Admin: adjust user points

Admin/super_admin only. Appends a point_ledger row (never edits/deletes), updates the summary cache, and writes an audit log. Use a reversal row to correct mistakes.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string, uuid |


**Request body** (`application/json`)

```json
{
  "pointsDelta": 0,
  "reasonCode": "admin_adjustment",
  "note": "string",
  "relatedEntityType": "string",
  "relatedEntityId": 0
}
```

**Responses**

- **`201`**

  ```json
  {
    "ledger": {
      "id": "string",
      "points_delta": 0,
      "reason_code": "string",
      "note": "string",
      "related_entity_type": "string",
      "related_entity_id": "string",
      "created_at": "2026-01-01T00:00:00.000Z"
    },
    "summary": {
      "total_points": 0,
      "lifetime_points_earned": 0,
      "lifetime_points_removed": 0,
      "updated_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `POST` `/admin/users/{id}/roles`

**Summary:** Admin: assign role

Assigns a role. super_admin required to assign admin/super_admin. admin cannot create admins. Audited.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string, uuid |


**Request body** (`application/json`)

```json
{
  "roleCode": "string"
}
```

**Responses**

- **`200`**

  ```json
  {
    "public_id": "00000000-0000-4000-8000-000000000000",
    "email": "string",
    "display_name": "string",
    "phone": "string",
    "email_verified": false,
    "account_status": "string",
    "primary_region_id": "string",
    "roles": [
      "string"
    ],
    "total_points": 0,
    "last_seen_at": "2026-01-01T00:00:00.000Z",
    "last_login_at": "2026-01-01T00:00:00.000Z",
    "created_at": "2026-01-01T00:00:00.000Z",
    "is_active": false,
    "preferred_language": "string",
    "admin_note": "string",
    "lifetime_points_earned": 0,
    "lifetime_points_removed": 0,
    "saved_places_count": 0,
    "updated_at": "2026-01-01T00:00:00.000Z",
    "deleted_at": "2026-01-01T00:00:00.000Z"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `DELETE` `/admin/users/{id}/roles/{roleCode}`

**Summary:** Admin: remove role

Removes a role. super_admin required to remove admin/super_admin. Cannot remove your own privileged role. Audited.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string, uuid |
| roleCode | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {
    "public_id": "00000000-0000-4000-8000-000000000000",
    "email": "string",
    "display_name": "string",
    "phone": "string",
    "email_verified": false,
    "account_status": "string",
    "primary_region_id": "string",
    "roles": [
      "string"
    ],
    "total_points": 0,
    "last_seen_at": "2026-01-01T00:00:00.000Z",
    "last_login_at": "2026-01-01T00:00:00.000Z",
    "created_at": "2026-01-01T00:00:00.000Z",
    "is_active": false,
    "preferred_language": "string",
    "admin_note": "string",
    "lifetime_points_earned": 0,
    "lifetime_points_removed": 0,
    "saved_places_count": 0,
    "updated_at": "2026-01-01T00:00:00.000Z",
    "deleted_at": "2026-01-01T00:00:00.000Z"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `PATCH` `/admin/users/{id}/status`

**Summary:** Admin: set account status

admin can enable/disable normal users; super_admin required for admin accounts and for 'deleted'. Audited.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string, uuid |


**Request body** (`application/json`)

```json
{
  "accountStatus": "active"
}
```

**Responses**

- **`200`**

  ```json
  {
    "public_id": "00000000-0000-4000-8000-000000000000",
    "email": "string",
    "display_name": "string",
    "phone": "string",
    "email_verified": false,
    "account_status": "string",
    "primary_region_id": "string",
    "roles": [
      "string"
    ],
    "total_points": 0,
    "last_seen_at": "2026-01-01T00:00:00.000Z",
    "last_login_at": "2026-01-01T00:00:00.000Z",
    "created_at": "2026-01-01T00:00:00.000Z",
    "is_active": false,
    "preferred_language": "string",
    "admin_note": "string",
    "lifetime_points_earned": 0,
    "lifetime_points_removed": 0,
    "saved_places_count": 0,
    "updated_at": "2026-01-01T00:00:00.000Z",
    "deleted_at": "2026-01-01T00:00:00.000Z"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/admin/users/analytics/by-region`

**Summary:** Admin: users by region

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Responses**

- **`200`**

  ```json
  [
    {
      "region_id": "string",
      "region_name": "string",
      "count": 0
    }
  ]
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/admin/users/analytics/by-role`

**Summary:** Admin: users by role

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Responses**

- **`200`**

  ```json
  [
    {
      "role": "string",
      "count": 0
    }
  ]
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/admin/users/analytics/growth`

**Summary:** Admin: user growth time series

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| bucket | Query | no | string |
| days | Query | no | integer |


**Responses**

- **`200`**

  ```json
  [
    {
      "bucket": "string",
      "count": 0
    }
  ]
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/admin/users/analytics/points`

**Summary:** Admin: points analytics

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Responses**

- **`200`**

  ```json
  {
    "total_awarded": 0,
    "total_removed": 0,
    "net_points": 0,
    "ledger_entries": 0,
    "users_with_points": 0
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/admin/users/analytics/points-by-reason`

**Summary:** Admin: points by reason

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Responses**

- **`200`**

  ```json
  [
    {
      "reason_code": "string",
      "net_points": 0,
      "total_awarded": 0,
      "total_removed": 0,
      "entries": 0
    }
  ]
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/admin/users/analytics/saved-places`

**Summary:** Admin: saved places analytics

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Responses**

- **`200`**

  ```json
  {
    "total_saved_places": 0,
    "users_with_saved_places": 0,
    "distinct_places_saved": 0
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/admin/users/analytics/summary`

**Summary:** Admin: user analytics summary

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Responses**

- **`200`**

  ```json
  {
    "total_users": 0,
    "verified_users": 0,
    "unverified_users": 0,
    "new_today": 0,
    "new_this_week": 0,
    "new_this_month": 0,
    "active_this_week": 0,
    "disabled_users": 0,
    "admin_count": 0,
    "super_admin_count": 0,
    "total_saved_places": 0,
    "total_points_awarded": 0
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/dashboard/stats`

**Summary:** Dashboard statistics

Aggregated row counts for admin overview.

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Responses**

- **`200`**

  ```json
  {
    "overview": {
      "total_main_rows": 0,
      "total_metadata_rows": 0,
      "total_transit_rows": 0
    },
    "main": {
      "places": 0,
      "map_buildings": 0,
      "streets": 0,
      "admin_areas": 0,
      "addresses": 0
    },
    "metadata": {
      "place_names": 0,
      "street_names": 0,
      "admin_area_names": 0,
      "place_contacts": 0,
      "place_sources": 0,
      "place_media": 0,
      "place_versions": 0
    },
    "transit": {
      "bus_routes": 0,
      "bus_route_variants": 0,
      "bus_stops": 0,
      "bus_route_stops": 0
    },
    "health": {
      "places_active": 0,
      "places_deleted": 0,
      "places_verified": 0,
      "places_unverified": 0,
      "buildings_active": 0,
      "buildings_deleted": 0,
      "streets_active": 0,
      "streets_inactive": 0
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "message": "string"
  }
  ```

### Transit

Bus stops and routes (GeoJSON).

#### `GET` `/public/map/geo/bus-routes`

**Summary:** Bus routes GeoJSON

**Security:** None

**Responses**

- **`200`**

  ```json
  {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "geometry": {
          "type": "string",
          "coordinates": null,
          "bbox": [
            0
          ]
        },
        "properties": {},
        "id": "string"
      }
    ]
  }
  ```

#### `GET` `/public/map/geo/bus-stops`

**Summary:** Bus stops GeoJSON

**Security:** None

**Responses**

- **`200`**

  ```json
  {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "geometry": {
          "type": "string",
          "coordinates": null,
          "bbox": [
            0
          ]
        },
        "properties": {},
        "id": "string"
      }
    ]
  }
  ```

#### `GET` `/public/transport/stops/{id}`

**Summary:** Get public transport stop

Unauthenticated stop detail for the public web map. Lookup accepts uuid public_id or internal numeric id. Names resolve from transport.stop_names primary rows (my/en/und) with optional ?lang=my|en|und for display_name. Includes routes serving the stop and a short downstream stop preview per route variant (no route geometry).

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| lang | Query | no | string |
| id | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {
    "id": "string",
    "publicId": "00000000-0000-4000-8000-000000000000",
    "public_id": "00000000-0000-4000-8000-000000000000",
    "name": "string",
    "myanmar_name": "string",
    "english_name": "string",
    "name_mm": "string",
    "name_en": "string",
    "display_name": "string",
    "primary_name": "string",
    "stop_code": "string",
    "mode": "string",
    "stop_type": "bus_stop",
    "admin_area_name": "string",
    "lat": 0,
    "lng": 0,
    "coordinates": [
      0
    ],
    "isVerified": false,
    "verification_status": "string",
    "status_label": "string",
    "confidenceScore": 0,
    "route_count": 0,
    "routes_serving_this_stop": [
      {
        "route_id": "string",
        "route_public_id": "00000000-0000-4000-8000-000000000000",
        "route_code": "string",
        "public_name": "string",
        "variant_id": "string",
        "variant_public_id": "00000000-0000-4000-8000-000000000000",
        "variant_code": "string",
        "direction_name": "string",
        "origin_name": "string",
        "destination_name": "string",
        "stop_sequence": 0
      }
    ],
    "next_stops_preview": [
      {
        "route_id": "string",
        "route_public_id": "00000000-0000-4000-8000-000000000000",
        "route_code": "string",
        "public_name": "string",
        "variant_id": "string",
        "variant_public_id": "00000000-0000-4000-8000-000000000000",
        "variant_code": "string",
        "direction_name": "string",
        "destination_name": "string",
        "current_stop_sequence": 0,
        "stop_sequence": 0,
        "next_stops": [
          {
            "stop_sequence": 0,
            "id": "string",
            "public_id": "00000000-0000-4000-8000-000000000000",
            "display_name": "string",
            "name": "string",
            "name_mm": "string",
            "name_en": "string",
            "lat": 0,
            "lng": 0
          }
        ],
        "stops": [
          {
            "stop_sequence": 0,
            "id": "string",
            "public_id": "00000000-0000-4000-8000-000000000000",
            "display_name": "string",
            "name": "string",
            "name_mm": "string",
            "name_en": "string",
            "lat": 0,
            "lng": 0
          }
        ]
      }
    ],
    "name_my": "string",
    "name_und": "string",
    "canonical_name": "string",
    "address_line": "string",
    "…": "(more fields — see OpenAPI spec)"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/public/transport/terminals/{id}`

**Summary:** Get public transport terminal

Unauthenticated terminal detail for the public web map. Lookup accepts uuid public_id or internal numeric id. Names resolve from terminal name fields with optional ?lang=my|en|und for display_name. Includes routes serving the linked stop when available (no route geometry).

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| lang | Query | no | string |
| id | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {
    "id": "string",
    "publicId": "00000000-0000-4000-8000-000000000000",
    "public_id": "00000000-0000-4000-8000-000000000000",
    "entity_type": "terminal",
    "name": "string",
    "myanmar_name": "string",
    "english_name": "string",
    "name_mm": "string",
    "name_en": "string",
    "display_name": "string",
    "primary_name": "string",
    "terminal_code": "string",
    "terminal_role": "string",
    "mode": "string",
    "admin_area_name": "string",
    "lat": 0,
    "lng": 0,
    "coordinates": [
      0
    ],
    "isVerified": false,
    "verification_status": "string",
    "status_label": "string",
    "confidenceScore": 0,
    "route_count": 0,
    "routes_serving_this_stop": [
      {
        "route_id": "string",
        "route_public_id": "00000000-0000-4000-8000-000000000000",
        "route_code": "string",
        "public_name": "string",
        "variant_id": "string",
        "variant_public_id": "00000000-0000-4000-8000-000000000000",
        "variant_code": "string",
        "direction_name": "string",
        "origin_name": "string",
        "destination_name": "string",
        "stop_sequence": 0
      }
    ],
    "name_my": "string",
    "name_und": "string",
    "canonical_name": "string",
    "address_line": "string",
    "…": "(more fields — see OpenAPI spec)"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

### Search

Public text search for the map client.

#### `GET` `/addresses/reverse`

**Summary:** Reverse geocode map click to best possible address

Resolves a lat/lng to the best available address or partial address using core addresses, buildings, places, streets, and admin areas. Locality-hint villages are never promoted to official address lines.

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| lat | Query | yes | number |
| lng | Query | yes | number |
| lang | Query | no | string |


**Responses**

- **`200`**

  ```json
  {
    "result_type": "string",
    "confidence_score": 0,
    "full_address_en": null,
    "full_address_my": null,
    "display_address": null,
    "components": [
      {
        "component_type": "string",
        "value": "string",
        "language_code": "string",
        "source": "string",
        "source_id": null,
        "confidence_score": null,
        "match_type": null,
        "boundary_status": null,
        "address_usage": null
      }
    ],
    "matched": {
      "address_id": null,
      "building_id": null,
      "place_id": null,
      "street_id": null,
      "admin_area_id": null
    },
    "alternatives": [
      {}
    ],
    "warnings": [
      "string"
    ]
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {}
  }
  ```

#### `GET` `/addresses/search`

**Summary:** Search addresses by partial text

Queries generated search.address_index rows (not core tables directly). Supports ILIKE partial match with simple priority for house number, postcode, and street.

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| q | Query | yes | string |
| lang | Query | no | string |
| limit | Query | no | integer |
| admin_area_id | Query | no | string |


**Responses**

- **`200`**

  ```json
  {
    "q": "string",
    "lang": "string",
    "count": 0,
    "results": [
      {
        "address_id": "string",
        "language_code": "en",
        "search_text": "string",
        "display_address": "string",
        "rank_score": 0,
        "match_priority": 0,
        "house_number": null,
        "street_text": null,
        "admin_text": null,
        "postcode": null,
        "point_geom": null
      }
    ]
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {}
  }
  ```

#### `GET` `/admin/search/aliases`

**Summary:** Admin: list search aliases

Admin/super_admin. Paginated list of search-only aliases with optional filters and indexed entity context.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| q | Query | no | string |
| entity_type | Query | no | string |
| language_code | Query | no | string |
| alias_type | Query | no | string |
| is_active | Query | no | boolean |
| entity_id | Query | no | string |
| has_indexed_entity | Query | no | boolean |
| page | Query | no | integer |
| pageSize | Query | no | integer |
| sort | Query | no | string |
| order | Query | no | string |


**Responses**

- **`200`**

  ```json
  {
    "items": [
      {
        "id": "string",
        "entity_type": "string",
        "entity_id": "string",
        "alias_text": "string",
        "normalized_alias": "string",
        "language_code": "string",
        "alias_type": "common_name",
        "source": "string",
        "is_active": false,
        "created_by": "string",
        "created_at": "2026-01-01T00:00:00.000Z",
        "updated_at": "2026-01-01T00:00:00.000Z",
        "indexed_entity": {
          "display_name": "string",
          "public_id": "string"
        },
        "index_sync": {
          "ok": false,
          "names_added": 0,
          "names_removed": 0,
          "documents_updated": 0,
          "error": "string"
        }
      }
    ],
    "total": 0,
    "page": 0,
    "pageSize": 0,
    "sort": "alias_text",
    "order": "asc"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `POST` `/admin/search/aliases`

**Summary:** Admin: create search alias

Admin/super_admin. Creates a search-only alias for an indexed entity and refreshes folded aliases for that entity.

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Request body** (`application/json`)

```json
{
  "entity_type": "place",
  "entity_id": "string",
  "alias_text": "string",
  "alias_type": "common_name",
  "language_code": "string",
  "source": "string",
  "is_active": false
}
```

**Responses**

- **`201`**

  ```json
  {
    "id": "string",
    "entity_type": "string",
    "entity_id": "string",
    "alias_text": "string",
    "normalized_alias": "string",
    "language_code": "string",
    "alias_type": "common_name",
    "source": "string",
    "is_active": false,
    "created_by": "string",
    "created_at": "2026-01-01T00:00:00.000Z",
    "updated_at": "2026-01-01T00:00:00.000Z",
    "indexed_entity": {
      "display_name": "string",
      "public_id": "string"
    },
    "index_sync": {
      "ok": false,
      "names_added": 0,
      "names_removed": 0,
      "documents_updated": 0,
      "error": "string"
    }
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`409`**

  ```json
  {
    "message": "string"
  }
  ```

#### `PATCH` `/admin/search/aliases/{id}`

**Summary:** Admin: update search alias

Admin/super_admin. Updates alias fields and refreshes folded aliases for the linked entity.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Request body** (`application/json`)

```json
{
  "alias_text": "string",
  "alias_type": "common_name",
  "language_code": "string",
  "source": "string",
  "is_active": false
}
```

**Responses**

- **`200`**

  ```json
  {
    "id": "string",
    "entity_type": "string",
    "entity_id": "string",
    "alias_text": "string",
    "normalized_alias": "string",
    "language_code": "string",
    "alias_type": "common_name",
    "source": "string",
    "is_active": false,
    "created_by": "string",
    "created_at": "2026-01-01T00:00:00.000Z",
    "updated_at": "2026-01-01T00:00:00.000Z",
    "indexed_entity": {
      "display_name": "string",
      "public_id": "string"
    },
    "index_sync": {
      "ok": false,
      "names_added": 0,
      "names_removed": 0,
      "documents_updated": 0,
      "error": "string"
    }
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`409`**

  ```json
  {
    "message": "string"
  }
  ```

#### `DELETE` `/admin/search/aliases/{id}`

**Summary:** Admin: disable search alias

Admin/super_admin. Soft-disables an alias (is_active=false) and refreshes folded aliases for the linked entity.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {
    "id": "string",
    "entity_type": "string",
    "entity_id": "string",
    "alias_text": "string",
    "normalized_alias": "string",
    "language_code": "string",
    "alias_type": "common_name",
    "source": "string",
    "is_active": false,
    "created_by": "string",
    "created_at": "2026-01-01T00:00:00.000Z",
    "updated_at": "2026-01-01T00:00:00.000Z",
    "indexed_entity": {
      "display_name": "string",
      "public_id": "string"
    },
    "index_sync": {
      "ok": false,
      "names_added": 0,
      "names_removed": 0,
      "documents_updated": 0,
      "error": "string"
    }
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/admin/search/analytics`

**Summary:** Aggregated public search analytics dashboard

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| period | Query | no | string |
| from | Query | no | string, date-time |
| to | Query | no | string, date-time |


**Responses**

- **`200`**

  ```json
  {
    "range": {
      "period": "string",
      "from": "2026-01-01T00:00:00.000Z",
      "to": "2026-01-01T00:00:00.000Z",
      "previous_from": "2026-01-01T00:00:00.000Z",
      "previous_to": "2026-01-01T00:00:00.000Z",
      "timeseries_bucket": "hour"
    },
    "summary": {
      "total_searches": 0,
      "zero_result_count": 0,
      "zero_result_rate": 0,
      "searches_with_click": 0,
      "click_through_rate": 0,
      "no_click_rate": 0,
      "latency_p50_ms": 0,
      "latency_p95_ms": 0
    },
    "timeseries": [
      {
        "bucket": "2026-01-01T00:00:00.000Z",
        "searches": 0,
        "zero_result_rate": 0,
        "latency_p50_ms": 0,
        "latency_p95_ms": 0,
        "click_count": 0
      }
    ],
    "top_searches": [
      {
        "normalized_query": "string",
        "search_count": 0,
        "zero_result_count": 0,
        "zero_result_rate": 0,
        "click_count": 0
      }
    ],
    "top_failed_searches": [
      {
        "normalized_query": "string",
        "search_count": 0,
        "zero_result_count": 0,
        "zero_result_rate": 0,
        "click_count": 0
      }
    ],
    "trending_queries": [
      {
        "normalized_query": "string",
        "current_count": 0,
        "previous_count": 0,
        "growth": 0
      }
    ],
    "top_clicked_entities": [
      {
        "entity_type": "string",
        "entity_id": "string",
        "display_name": "string",
        "click_count": 0,
        "label": "string"
      }
    ],
    "by_language": [
      {
        "key": "string",
        "count": 0
      }
    ],
    "by_category": [
      {
        "key": "string",
        "count": 0
      }
    ]
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/admin/search/documents`

**Summary:** Admin: list search documents

Admin/super_admin. Paginated inspection of unified search index rows with sync state, alias counts, and server-side filters/sorting.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| q | Query | no | string |
| entity_type | Query | no | string |
| transport_mode | Query | no | string |
| review_status | Query | no | string |
| is_verified | Query | no | boolean |
| is_public | Query | no | boolean |
| is_active | Query | no | boolean |
| has_alias | Query | no | boolean |
| sync_state | Query | no | string |
| language | Query | no | string |
| sort | Query | no | string |
| order | Query | no | string |
| page | Query | no | integer |
| pageSize | Query | no | integer |


**Responses**

- **`200`**

  ```json
  {
    "items": [
      {
        "search_document_id": "string",
        "entity_type": "string",
        "entity_id": "string",
        "public_id": "string",
        "display_name": "string",
        "primary_name_my": "string",
        "primary_name_en": "string",
        "primary_name_und": "string",
        "transport_mode": "string",
        "review_status": "string",
        "is_verified": false,
        "is_public": false,
        "is_active": false,
        "importance_score": 0,
        "confidence_score": 0,
        "indexed_at": "2026-01-01T00:00:00.000Z",
        "source_updated_at": "2026-01-01T00:00:00.000Z",
        "canonical_source_updated_at": "2026-01-01T00:00:00.000Z",
        "alias_count": 0,
        "sync_state": "current"
      }
    ],
    "total": 0,
    "page": 0,
    "pageSize": 0,
    "sort": "name",
    "order": "asc"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/admin/search/failed-searches`

**Summary:** List failed / zero-result search logs

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| q | Query | no | string |
| lang | Query | no | string |
| resolved | Query | no | boolean |
| last_seen_from | Query | no | string, date-time |
| last_seen_to | Query | no | string, date-time |
| min_occurrence | Query | no | integer |
| sort | Query | no | string |
| order | Query | no | string |
| page | Query | no | integer |
| pageSize | Query | no | integer |


**Responses**

- **`200`**

  ```json
  {
    "items": [
      {
        "id": "string",
        "query": "string",
        "normalized_query": "string",
        "language": "string",
        "category": "string",
        "transport_type": "string",
        "transport_mode": "string",
        "entity_types_key": "string",
        "types": [
          "string"
        ],
        "area_context_key": "string",
        "result_count": 0,
        "occurrence_count": 0,
        "first_seen_at": "2026-01-01T00:00:00.000Z",
        "last_seen_at": "2026-01-01T00:00:00.000Z",
        "is_resolved": false,
        "resolved_at": "2026-01-01T00:00:00.000Z",
        "resolution_type": "alias",
        "linked_alias": {
          "id": "string",
          "alias_text": "string"
        },
        "linked_entity": {
          "entity_type": "string",
          "entity_id": "string",
          "display_name": "string",
          "public_id": "string"
        }
      }
    ],
    "total": 0,
    "page": 0,
    "pageSize": 0,
    "sort": "string",
    "order": "asc"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/admin/search/failed-searches/{id}`

**Summary:** Get a failed search log by id

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {
    "id": "string",
    "query": "string",
    "normalized_query": "string",
    "language": "string",
    "category": "string",
    "transport_type": "string",
    "transport_mode": "string",
    "entity_types_key": "string",
    "types": [
      "string"
    ],
    "area_context_key": "string",
    "result_count": 0,
    "occurrence_count": 0,
    "first_seen_at": "2026-01-01T00:00:00.000Z",
    "last_seen_at": "2026-01-01T00:00:00.000Z",
    "is_resolved": false,
    "resolved_at": "2026-01-01T00:00:00.000Z",
    "resolution_type": "alias",
    "linked_alias": {
      "id": "string",
      "alias_text": "string"
    },
    "linked_entity": {
      "entity_type": "string",
      "entity_id": "string",
      "display_name": "string",
      "public_id": "string"
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `PATCH` `/admin/search/failed-searches/{id}`

**Summary:** Resolve or reopen a failed search log

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Request body** (`application/json`)

```json
{
  "action": "resolve",
  "resolution_type": "alias",
  "linked_alias_id": "string"
}
```

**Responses**

- **`200`**

  ```json
  {
    "id": "string",
    "query": "string",
    "normalized_query": "string",
    "language": "string",
    "category": "string",
    "transport_type": "string",
    "transport_mode": "string",
    "entity_types_key": "string",
    "types": [
      "string"
    ],
    "area_context_key": "string",
    "result_count": 0,
    "occurrence_count": 0,
    "first_seen_at": "2026-01-01T00:00:00.000Z",
    "last_seen_at": "2026-01-01T00:00:00.000Z",
    "is_resolved": false,
    "resolved_at": "2026-01-01T00:00:00.000Z",
    "resolution_type": "alias",
    "linked_alias": {
      "id": "string",
      "alias_text": "string"
    },
    "linked_entity": {
      "entity_type": "string",
      "entity_id": "string",
      "display_name": "string",
      "public_id": "string"
    }
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`409`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/admin/search/index-health`

**Summary:** Read-only unified search index health report

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Responses**

- **`200`**

  ```json
  {
    "overall_status": "healthy",
    "overall_severity": "healthy",
    "overall_severity_reasons": [
      "string"
    ],
    "health_query_ok": false,
    "health_query_error": "string",
    "totals": {
      "expected_searchable_count": 0,
      "canonical_count": 0,
      "indexed_count": 0,
      "missing_count": 0,
      "ghost_count": 0,
      "stale_count": 0
    },
    "families": [
      {
        "entity_family": "string",
        "search_entity_type": "string",
        "expected_searchable_count": 0,
        "canonical_count": 0,
        "indexed_count": 0,
        "missing_count": 0,
        "ghost_count": 0,
        "stale_count": 0,
        "latest_indexed_at": "2026-01-01T00:00:00.000Z",
        "latest_source_updated_at": "2026-01-01T00:00:00.000Z",
        "severity": "healthy",
        "severity_reasons": [
          "string"
        ],
        "status": "healthy"
      }
    ],
    "last_rebuild_run": {
      "id": "string",
      "status": "string",
      "started_at": "2026-01-01T00:00:00.000Z",
      "finished_at": "2026-01-01T00:00:00.000Z",
      "entity_counts": null
    },
    "last_successful_run": {
      "id": "string",
      "status": "string",
      "started_at": "2026-01-01T00:00:00.000Z",
      "finished_at": "2026-01-01T00:00:00.000Z",
      "entity_counts": null
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `POST` `/admin/search/index-health/check`

**Summary:** Run unified search index health check (admin)

Admin/super_admin. Re-runs the health SQL and returns before/after snapshots (identical for read-only check).

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Responses**

- **`200`**

  ```json
  {
    "operation": "health_check",
    "status": "success",
    "duration_ms": 0,
    "affected_families": [
      "string"
    ],
    "entity_family": "string",
    "entity_type": "string",
    "entity_id": "string",
    "rebuild_views": [
      "string"
    ],
    "rebuild_run_id": "string",
    "rows_rebuilt": 0,
    "message": "string",
    "health_before": {
      "overall_status": "healthy",
      "overall_severity": "healthy",
      "overall_severity_reasons": [
        "string"
      ],
      "health_query_ok": false,
      "health_query_error": "string",
      "totals": {
        "expected_searchable_count": 0,
        "canonical_count": 0,
        "indexed_count": 0,
        "missing_count": 0,
        "ghost_count": 0,
        "stale_count": 0
      },
      "families": [
        {
          "entity_family": "string",
          "search_entity_type": "string",
          "expected_searchable_count": 0,
          "canonical_count": 0,
          "indexed_count": 0,
          "missing_count": 0,
          "ghost_count": 0,
          "stale_count": 0,
          "latest_indexed_at": "2026-01-01T00:00:00.000Z",
          "latest_source_updated_at": "2026-01-01T00:00:00.000Z",
          "severity": "healthy",
          "severity_reasons": [
            "string"
          ],
          "status": "healthy"
        }
      ],
      "last_rebuild_run": {
        "id": "string",
        "status": "string",
        "started_at": "2026-01-01T00:00:00.000Z",
        "finished_at": "2026-01-01T00:00:00.000Z",
        "entity_counts": null
      },
      "last_successful_run": {
        "id": "string",
        "status": "string",
        "started_at": "2026-01-01T00:00:00.000Z",
        "finished_at": "2026-01-01T00:00:00.000Z",
        "entity_counts": null
      }
    },
    "health_after": {
      "overall_status": "healthy",
      "overall_severity": "healthy",
      "overall_severity_reasons": [
        "string"
      ],
      "health_query_ok": false,
      "health_query_error": "string",
      "totals": {
        "expected_searchable_count": 0,
        "canonical_count": 0,
        "indexed_count": 0,
        "missing_count": 0,
        "ghost_count": 0,
        "stale_count": 0
      },
      "families": [
        {
          "entity_family": "string",
          "search_entity_type": "string",
          "expected_searchable_count": 0,
          "canonical_count": 0,
          "indexed_count": 0,
          "missing_count": 0,
          "ghost_count": 0,
          "stale_count": 0,
          "latest_indexed_at": "2026-01-01T00:00:00.000Z",
          "latest_source_updated_at": "2026-01-01T00:00:00.000Z",
          "severity": "healthy",
          "severity_reasons": [
            "string"
          ],
          "status": "healthy"
        }
      ],
      "last_rebuild_run": {
        "id": "string",
        "status": "string",
        "started_at": "2026-01-01T00:00:00.000Z",
        "finished_at": "2026-01-01T00:00:00.000Z",
        "entity_counts": null
      },
      "last_successful_run": {
        "id": "string",
        "status": "string",
        "started_at": "2026-01-01T00:00:00.000Z",
        "finished_at": "2026-01-01T00:00:00.000Z",
        "entity_counts": null
      }
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `POST` `/admin/search/index-health/reindex-entity`

**Summary:** Incrementally reindex one searchable entity

Super_admin only. Uses search.sync_search_documents for supported entity types (places, admin areas, street groups, transport).

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Request body** (`application/json`)

```json
{
  "entity_type": "string",
  "entity_id": "string"
}
```

**Responses**

- **`200`**

  ```json
  {
    "operation": "health_check",
    "status": "success",
    "duration_ms": 0,
    "affected_families": [
      "string"
    ],
    "entity_family": "string",
    "entity_type": "string",
    "entity_id": "string",
    "rebuild_views": [
      "string"
    ],
    "rebuild_run_id": "string",
    "rows_rebuilt": 0,
    "message": "string",
    "health_before": {
      "overall_status": "healthy",
      "overall_severity": "healthy",
      "overall_severity_reasons": [
        "string"
      ],
      "health_query_ok": false,
      "health_query_error": "string",
      "totals": {
        "expected_searchable_count": 0,
        "canonical_count": 0,
        "indexed_count": 0,
        "missing_count": 0,
        "ghost_count": 0,
        "stale_count": 0
      },
      "families": [
        {
          "entity_family": "string",
          "search_entity_type": "string",
          "expected_searchable_count": 0,
          "canonical_count": 0,
          "indexed_count": 0,
          "missing_count": 0,
          "ghost_count": 0,
          "stale_count": 0,
          "latest_indexed_at": "2026-01-01T00:00:00.000Z",
          "latest_source_updated_at": "2026-01-01T00:00:00.000Z",
          "severity": "healthy",
          "severity_reasons": [
            "string"
          ],
          "status": "healthy"
        }
      ],
      "last_rebuild_run": {
        "id": "string",
        "status": "string",
        "started_at": "2026-01-01T00:00:00.000Z",
        "finished_at": "2026-01-01T00:00:00.000Z",
        "entity_counts": null
      },
      "last_successful_run": {
        "id": "string",
        "status": "string",
        "started_at": "2026-01-01T00:00:00.000Z",
        "finished_at": "2026-01-01T00:00:00.000Z",
        "entity_counts": null
      }
    },
    "health_after": {
      "overall_status": "healthy",
      "overall_severity": "healthy",
      "overall_severity_reasons": [
        "string"
      ],
      "health_query_ok": false,
      "health_query_error": "string",
      "totals": {
        "expected_searchable_count": 0,
        "canonical_count": 0,
        "indexed_count": 0,
        "missing_count": 0,
        "ghost_count": 0,
        "stale_count": 0
      },
      "families": [
        {
          "entity_family": "string",
          "search_entity_type": "string",
          "expected_searchable_count": 0,
          "canonical_count": 0,
          "indexed_count": 0,
          "missing_count": 0,
          "ghost_count": 0,
          "stale_count": 0,
          "latest_indexed_at": "2026-01-01T00:00:00.000Z",
          "latest_source_updated_at": "2026-01-01T00:00:00.000Z",
          "severity": "healthy",
          "severity_reasons": [
            "string"
          ],
          "status": "healthy"
        }
      ],
      "last_rebuild_run": {
        "id": "string",
        "status": "string",
        "started_at": "2026-01-01T00:00:00.000Z",
        "finished_at": "2026-01-01T00:00:00.000Z",
        "entity_counts": null
      },
      "last_successful_run": {
        "id": "string",
        "status": "string",
        "started_at": "2026-01-01T00:00:00.000Z",
        "finished_at": "2026-01-01T00:00:00.000Z",
        "entity_counts": null
      }
    }
  }
  ```

- **`400`**

  ```json
  {
    "message": "string"
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "message": "string"
  }
  ```

#### `POST` `/admin/search/index-health/reindex-family`

**Summary:** Rebuild one allowlisted search index family

Super_admin only. Rebuilds the mapped source view via search.rebuild_search_documents.

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Request body** (`application/json`)

```json
{
  "entity_family": "string"
}
```

**Responses**

- **`200`**

  ```json
  {
    "operation": "health_check",
    "status": "success",
    "duration_ms": 0,
    "affected_families": [
      "string"
    ],
    "entity_family": "string",
    "entity_type": "string",
    "entity_id": "string",
    "rebuild_views": [
      "string"
    ],
    "rebuild_run_id": "string",
    "rows_rebuilt": 0,
    "message": "string",
    "health_before": {
      "overall_status": "healthy",
      "overall_severity": "healthy",
      "overall_severity_reasons": [
        "string"
      ],
      "health_query_ok": false,
      "health_query_error": "string",
      "totals": {
        "expected_searchable_count": 0,
        "canonical_count": 0,
        "indexed_count": 0,
        "missing_count": 0,
        "ghost_count": 0,
        "stale_count": 0
      },
      "families": [
        {
          "entity_family": "string",
          "search_entity_type": "string",
          "expected_searchable_count": 0,
          "canonical_count": 0,
          "indexed_count": 0,
          "missing_count": 0,
          "ghost_count": 0,
          "stale_count": 0,
          "latest_indexed_at": "2026-01-01T00:00:00.000Z",
          "latest_source_updated_at": "2026-01-01T00:00:00.000Z",
          "severity": "healthy",
          "severity_reasons": [
            "string"
          ],
          "status": "healthy"
        }
      ],
      "last_rebuild_run": {
        "id": "string",
        "status": "string",
        "started_at": "2026-01-01T00:00:00.000Z",
        "finished_at": "2026-01-01T00:00:00.000Z",
        "entity_counts": null
      },
      "last_successful_run": {
        "id": "string",
        "status": "string",
        "started_at": "2026-01-01T00:00:00.000Z",
        "finished_at": "2026-01-01T00:00:00.000Z",
        "entity_counts": null
      }
    },
    "health_after": {
      "overall_status": "healthy",
      "overall_severity": "healthy",
      "overall_severity_reasons": [
        "string"
      ],
      "health_query_ok": false,
      "health_query_error": "string",
      "totals": {
        "expected_searchable_count": 0,
        "canonical_count": 0,
        "indexed_count": 0,
        "missing_count": 0,
        "ghost_count": 0,
        "stale_count": 0
      },
      "families": [
        {
          "entity_family": "string",
          "search_entity_type": "string",
          "expected_searchable_count": 0,
          "canonical_count": 0,
          "indexed_count": 0,
          "missing_count": 0,
          "ghost_count": 0,
          "stale_count": 0,
          "latest_indexed_at": "2026-01-01T00:00:00.000Z",
          "latest_source_updated_at": "2026-01-01T00:00:00.000Z",
          "severity": "healthy",
          "severity_reasons": [
            "string"
          ],
          "status": "healthy"
        }
      ],
      "last_rebuild_run": {
        "id": "string",
        "status": "string",
        "started_at": "2026-01-01T00:00:00.000Z",
        "finished_at": "2026-01-01T00:00:00.000Z",
        "entity_counts": null
      },
      "last_successful_run": {
        "id": "string",
        "status": "string",
        "started_at": "2026-01-01T00:00:00.000Z",
        "finished_at": "2026-01-01T00:00:00.000Z",
        "entity_counts": null
      }
    }
  }
  ```

- **`400`**

  ```json
  {
    "message": "string"
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`409`**

  ```json
  {
    "message": "string"
  }
  ```

#### `POST` `/admin/search/index-health/repair`

**Summary:** Repair all unhealthy search index families

Super_admin only. Rebuilds only unhealthy families (same logic as search:reconcile --repair).

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Responses**

- **`200`**

  ```json
  {
    "operation": "health_check",
    "status": "success",
    "duration_ms": 0,
    "affected_families": [
      "string"
    ],
    "entity_family": "string",
    "entity_type": "string",
    "entity_id": "string",
    "rebuild_views": [
      "string"
    ],
    "rebuild_run_id": "string",
    "rows_rebuilt": 0,
    "message": "string",
    "health_before": {
      "overall_status": "healthy",
      "overall_severity": "healthy",
      "overall_severity_reasons": [
        "string"
      ],
      "health_query_ok": false,
      "health_query_error": "string",
      "totals": {
        "expected_searchable_count": 0,
        "canonical_count": 0,
        "indexed_count": 0,
        "missing_count": 0,
        "ghost_count": 0,
        "stale_count": 0
      },
      "families": [
        {
          "entity_family": "string",
          "search_entity_type": "string",
          "expected_searchable_count": 0,
          "canonical_count": 0,
          "indexed_count": 0,
          "missing_count": 0,
          "ghost_count": 0,
          "stale_count": 0,
          "latest_indexed_at": "2026-01-01T00:00:00.000Z",
          "latest_source_updated_at": "2026-01-01T00:00:00.000Z",
          "severity": "healthy",
          "severity_reasons": [
            "string"
          ],
          "status": "healthy"
        }
      ],
      "last_rebuild_run": {
        "id": "string",
        "status": "string",
        "started_at": "2026-01-01T00:00:00.000Z",
        "finished_at": "2026-01-01T00:00:00.000Z",
        "entity_counts": null
      },
      "last_successful_run": {
        "id": "string",
        "status": "string",
        "started_at": "2026-01-01T00:00:00.000Z",
        "finished_at": "2026-01-01T00:00:00.000Z",
        "entity_counts": null
      }
    },
    "health_after": {
      "overall_status": "healthy",
      "overall_severity": "healthy",
      "overall_severity_reasons": [
        "string"
      ],
      "health_query_ok": false,
      "health_query_error": "string",
      "totals": {
        "expected_searchable_count": 0,
        "canonical_count": 0,
        "indexed_count": 0,
        "missing_count": 0,
        "ghost_count": 0,
        "stale_count": 0
      },
      "families": [
        {
          "entity_family": "string",
          "search_entity_type": "string",
          "expected_searchable_count": 0,
          "canonical_count": 0,
          "indexed_count": 0,
          "missing_count": 0,
          "ghost_count": 0,
          "stale_count": 0,
          "latest_indexed_at": "2026-01-01T00:00:00.000Z",
          "latest_source_updated_at": "2026-01-01T00:00:00.000Z",
          "severity": "healthy",
          "severity_reasons": [
            "string"
          ],
          "status": "healthy"
        }
      ],
      "last_rebuild_run": {
        "id": "string",
        "status": "string",
        "started_at": "2026-01-01T00:00:00.000Z",
        "finished_at": "2026-01-01T00:00:00.000Z",
        "entity_counts": null
      },
      "last_successful_run": {
        "id": "string",
        "status": "string",
        "started_at": "2026-01-01T00:00:00.000Z",
        "finished_at": "2026-01-01T00:00:00.000Z",
        "entity_counts": null
      }
    }
  }
  ```

- **`400`**

  ```json
  {
    "message": "string"
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`409`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/admin/search/overview`

**Summary:** Admin: search overview metrics

Admin/super_admin. Lightweight summary counts for the Search dashboard overview.

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Responses**

- **`200`**

  ```json
  {
    "total_search_documents": 0,
    "total_aliases": 0,
    "active_aliases": 0,
    "unresolved_failed_searches": 0,
    "today_searches": 0,
    "overall_index_health_severity": "healthy"
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/public/search`

**Summary:** Public search

Unified public search over the search index (search.search_documents). Matches places, grouped streets (street_group), admin areas, addresses, bus stops/routes, buildings, water and land areas. Streets are returned as one logical road per result, not per segment. A Plus Code query is decoded to a point; a short Plus Code requires lat/lng (map center or user location) to expand, otherwise referenceRequired is returned.

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| q | Query | yes | string |
| limit | Query | no | integer |
| cursor | Query | no | string |
| category | Query | no | string |
| transportType | Query | no | string |
| mode | Query | no | string |
| lat | Query | no | number |
| lng | Query | no | number |
| lang | Query | no | string |
| types | Query | no | string |


**Responses**

- **`200`**

  ```json
  {
    "items": [
      {
        "id": "string",
        "entityType": "string",
        "type": "string",
        "displayName": "string",
        "hasGeometry": false,
        "score": 0,
        "verification": {
          "isVerified": false,
          "confidenceScore": 0,
          "boundaryConfidenceScore": 0,
          "reviewStatus": "string",
          "verificationStatus": "string"
        },
        "entityId": "string",
        "publicId": "string",
        "subtitle": "string",
        "primaryNameMy": "string",
        "primaryNameEn": "string",
        "lat": 0,
        "lng": 0,
        "center": [
          0
        ],
        "bbox": [
          0
        ],
        "geometryType": "string",
        "category": {
          "code": "string",
          "name": "string"
        },
        "transport": {
          "mode": "string",
          "stopType": "string",
          "routeCode": "string",
          "parentRoutePublicId": "string",
          "variantCode": "string",
          "headsign": "string",
          "directionName": "string",
          "originName": "string",
          "destinationName": "string"
        },
        "cameraTarget": {
          "type": "point",
          "center": [
            0
          ],
          "zoom": 0
        },
        "plusCode": {
          "code": "string",
          "referenceRequired": false,
          "outsideServiceArea": false,
          "reason": "string"
        },
        "coordinate": {
          "outsideServiceArea": false
        },
        "reverse": {
          "nearbyName": "string",
          "nearbyType": "string",
          "nearbyDistanceM": 0,
          "township": "string",
          "district": "string",
          "regionState": "string",
          "country": "string",
          "confidence": "string"
        }
      }
    ],
    "nextCursor": "string",
    "hasMore": false,
    "analytics": {
      "eventId": "00000000-0000-4000-8000-000000000000"
    }
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

#### `GET` `/public/search/{entityType}/{entityId}/geometry`

**Summary:** Selected search-result geometry

Returns the full GeoJSON geometry for a single search result, fetched on click (the search list only carries centroid/bbox). Large line/polygon geometries are optionally simplified via ?zoom=. Points are never simplified.

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| zoom | Query | no | number |
| entityType | Path | yes | string |
| entityId | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {
    "entityType": "string",
    "entityId": "string",
    "geometryType": "string",
    "bbox": [
      0
    ],
    "feature": {
      "type": "Feature",
      "geometry": {
        "type": "string",
        "coordinates": null,
        "bbox": [
          0
        ]
      },
      "properties": {
        "entityType": "string",
        "entityId": "string"
      }
    }
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/public/search/{entityType}/{entityId}/map-preview`

**Summary:** Transport route map preview

Returns a lightweight map overlay for a selected transport route: one simplified path, variant summaries, and optional endpoint stops. Parent routes use the focus/primary variant only (no multi-variant geometry collect).

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| zoom | Query | no | number |
| entityType | Path | yes | string |
| entityId | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {
    "entityType": "transport_route",
    "entityId": "string",
    "bbox": [
      0
    ],
    "path": {
      "type": "Feature",
      "geometry": {
        "type": "string",
        "coordinates": null,
        "bbox": [
          0
        ]
      },
      "properties": {
        "entityType": "string",
        "entityId": "string"
      }
    },
    "variants": [
      {
        "entityId": "string",
        "publicId": "string",
        "variantCode": "string",
        "headsign": "string",
        "directionName": "string",
        "isPrimary": false
      }
    ],
    "importantStops": [
      {
        "publicId": "string",
        "displayName": "string",
        "sequence": 0,
        "lat": 0,
        "lng": 0
      }
    ]
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `POST` `/public/search/analytics/clicks`

**Summary:** Record search result click analytics

Best-effort telemetry when a user selects a search result. Use eventId from GET /public/search analytics field. Never blocks user flows.

**Security:** None

**Request body** (`application/json`)

```json
{
  "event_id": "00000000-0000-4000-8000-000000000000",
  "entity_type": "string",
  "entity_id": "string",
  "clicked_rank": 0,
  "time_to_click_ms": 0
}
```

**Responses**

- **`204`**
  - Accepted

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

#### `GET` `/search/reverse`

**Summary:** Reverse geocode a point to a minimal address line

Resolves a lat/lng to a single human-readable address line (nearest public place or street plus township/district/state hierarchy), a dynamically computed Plus Code, and a confidence level. Public, read-only. Plus Code is generated on demand and never stored.

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| lat | Query | yes | number |
| lng | Query | yes | number |


**Responses**

- **`200`**

  ```json
  {
    "address_line": "string",
    "plus_code": null,
    "lat": 0,
    "lng": 0,
    "confidence": "exact_nearby"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`500`**

  ```json
  {
    "message": "string"
  }
  ```

### Reports

User report / contribution flow (signed-in and anonymous), admin review, status lifecycle, follow-ups, and manual point rewards.

#### `GET` `/admin/reports`

**Summary:** List reports (admin)

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| status | Query | no | string |
| type | Query | no | string |
| adminAreaId | Query | no | integer |
| targetEntityType | Query | no | string |
| anonymous | Query | no | string |
| createdFrom | Query | no | string, date |
| createdTo | Query | no | string, date |
| page | Query | no | integer |
| pageSize | Query | no | integer |


**Responses**

- **`200`**

  ```json
  {
    "items": [
      {
        "public_id": "00000000-0000-4000-8000-000000000000",
        "is_anonymous": false,
        "eligible_for_points": false,
        "report_type": {
          "code": "string",
          "name": "string"
        },
        "status": {
          "code": "string",
          "name": "string"
        },
        "description": "string",
        "priority": "string",
        "confidence_score": 0,
        "created_at": "2026-01-01T00:00:00.000Z",
        "updated_at": "2026-01-01T00:00:00.000Z",
        "anonymous_id": "string",
        "author": {
          "public_id": "string",
          "display_name": "string",
          "email": "string"
        },
        "reason_code": "string",
        "target_entity_type": "string",
        "target_entity_id": "string",
        "target_public_id": "string",
        "title": "string",
        "latitude": 0,
        "longitude": 0,
        "admin_area_id": "string",
        "admin_note": "string",
        "reviewed_at": "2026-01-01T00:00:00.000Z",
        "reward_granted_at": "2026-01-01T00:00:00.000Z"
      }
    ],
    "total": 0,
    "page": 0,
    "pageSize": 0
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/admin/reports/{id}`

**Summary:** Get a report (admin)

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string, uuid |


**Responses**

- **`200`**

  ```json
  {
    "public_id": "00000000-0000-4000-8000-000000000000",
    "is_anonymous": false,
    "eligible_for_points": false,
    "report_type": {
      "code": "string",
      "name": "string"
    },
    "status": {
      "code": "string",
      "name": "string"
    },
    "description": "string",
    "priority": "string",
    "confidence_score": 0,
    "created_at": "2026-01-01T00:00:00.000Z",
    "updated_at": "2026-01-01T00:00:00.000Z",
    "anonymous_id": "string",
    "author": {
      "public_id": "string",
      "display_name": "string",
      "email": "string"
    },
    "followups": [
      {
        "actor_type": "admin",
        "message": "string",
        "created_at": "2026-01-01T00:00:00.000Z",
        "actor_display_name": "string"
      }
    ],
    "status_events": [
      {
        "old_status_code": "string",
        "new_status_code": "string",
        "created_at": "2026-01-01T00:00:00.000Z",
        "actor_display_name": "string",
        "note": "string"
      }
    ],
    "reason_code": "string",
    "target_entity_type": "string",
    "target_entity_id": "string",
    "target_public_id": "string",
    "title": "string",
    "latitude": 0,
    "longitude": 0,
    "admin_area_id": "string",
    "admin_note": "string",
    "reviewed_at": "2026-01-01T00:00:00.000Z",
    "reward_granted_at": "2026-01-01T00:00:00.000Z"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `PATCH` `/admin/reports/{id}/admin-note`

**Summary:** Update admin note (admin)

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string, uuid |


**Request body** (`application/json`)

```json
{
  "adminNote": "string"
}
```

**Responses**

- **`200`**

  ```json
  {
    "public_id": "00000000-0000-4000-8000-000000000000",
    "is_anonymous": false,
    "eligible_for_points": false,
    "report_type": {
      "code": "string",
      "name": "string"
    },
    "status": {
      "code": "string",
      "name": "string"
    },
    "description": "string",
    "priority": "string",
    "confidence_score": 0,
    "created_at": "2026-01-01T00:00:00.000Z",
    "updated_at": "2026-01-01T00:00:00.000Z",
    "anonymous_id": "string",
    "author": {
      "public_id": "string",
      "display_name": "string",
      "email": "string"
    },
    "reason_code": "string",
    "target_entity_type": "string",
    "target_entity_id": "string",
    "target_public_id": "string",
    "title": "string",
    "latitude": 0,
    "longitude": 0,
    "admin_area_id": "string",
    "admin_note": "string",
    "reviewed_at": "2026-01-01T00:00:00.000Z",
    "reward_granted_at": "2026-01-01T00:00:00.000Z"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `POST` `/admin/reports/{id}/request-info`

**Summary:** Request more info (admin)

Adds an admin follow-up message and moves the report to 'needs_more_info' without creating a new report. Not allowed for anonymous reports.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string, uuid |


**Request body** (`application/json`)

```json
{
  "message": "string"
}
```

**Responses**

- **`200`**

  ```json
  {
    "public_id": "00000000-0000-4000-8000-000000000000",
    "is_anonymous": false,
    "eligible_for_points": false,
    "report_type": {
      "code": "string",
      "name": "string"
    },
    "status": {
      "code": "string",
      "name": "string"
    },
    "description": "string",
    "priority": "string",
    "confidence_score": 0,
    "created_at": "2026-01-01T00:00:00.000Z",
    "updated_at": "2026-01-01T00:00:00.000Z",
    "anonymous_id": "string",
    "author": {
      "public_id": "string",
      "display_name": "string",
      "email": "string"
    },
    "followups": [
      {
        "actor_type": "admin",
        "message": "string",
        "created_at": "2026-01-01T00:00:00.000Z",
        "actor_display_name": "string"
      }
    ],
    "reason_code": "string",
    "target_entity_type": "string",
    "target_entity_id": "string",
    "target_public_id": "string",
    "title": "string",
    "latitude": 0,
    "longitude": 0,
    "admin_area_id": "string",
    "admin_note": "string",
    "reviewed_at": "2026-01-01T00:00:00.000Z",
    "reward_granted_at": "2026-01-01T00:00:00.000Z"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`409`**

  ```json
  {
    "message": "string"
  }
  ```

#### `POST` `/admin/reports/{id}/reward-points`

**Summary:** Reward points for a report (admin)

Manually grants points to the author of an ACCEPTED report via the append-only point ledger, updates the point summary, and links the ledger row to the report. Points are never granted automatically. Rejected when the report is not accepted, anonymous, ineligible, or already rewarded. Positive pointsDelta rewards; negative is allowed for penalty/reversal reason codes.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string, uuid |


**Request body** (`application/json`)

```json
{
  "pointsDelta": 0,
  "reasonCode": "valid_report",
  "note": "string"
}
```

**Responses**

- **`200`**

  ```json
  {
    "report": {
      "public_id": "00000000-0000-4000-8000-000000000000",
      "is_anonymous": false,
      "eligible_for_points": false,
      "report_type": {
        "code": "string",
        "name": "string"
      },
      "status": {
        "code": "string",
        "name": "string"
      },
      "description": "string",
      "priority": "string",
      "confidence_score": 0,
      "created_at": "2026-01-01T00:00:00.000Z",
      "updated_at": "2026-01-01T00:00:00.000Z",
      "anonymous_id": "string",
      "author": {
        "public_id": "string",
        "display_name": "string",
        "email": "string"
      },
      "reason_code": "string",
      "target_entity_type": "string",
      "target_entity_id": "string",
      "target_public_id": "string",
      "title": "string",
      "latitude": 0,
      "longitude": 0,
      "admin_area_id": "string",
      "admin_note": "string",
      "reviewed_at": "2026-01-01T00:00:00.000Z",
      "reward_granted_at": "2026-01-01T00:00:00.000Z"
    },
    "summary": {
      "total_points": 0,
      "lifetime_points_earned": 0,
      "lifetime_points_removed": 0,
      "updated_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`409`**

  ```json
  {
    "message": "string"
  }
  ```

#### `PATCH` `/admin/reports/{id}/status`

**Summary:** Change report status (admin)

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string, uuid |


**Request body** (`application/json`)

```json
{
  "statusCode": "submitted",
  "note": "string"
}
```

**Responses**

- **`200`**

  ```json
  {
    "public_id": "00000000-0000-4000-8000-000000000000",
    "is_anonymous": false,
    "eligible_for_points": false,
    "report_type": {
      "code": "string",
      "name": "string"
    },
    "status": {
      "code": "string",
      "name": "string"
    },
    "description": "string",
    "priority": "string",
    "confidence_score": 0,
    "created_at": "2026-01-01T00:00:00.000Z",
    "updated_at": "2026-01-01T00:00:00.000Z",
    "anonymous_id": "string",
    "author": {
      "public_id": "string",
      "display_name": "string",
      "email": "string"
    },
    "reason_code": "string",
    "target_entity_type": "string",
    "target_entity_id": "string",
    "target_public_id": "string",
    "title": "string",
    "latitude": 0,
    "longitude": 0,
    "admin_area_id": "string",
    "admin_note": "string",
    "reviewed_at": "2026-01-01T00:00:00.000Z",
    "reward_granted_at": "2026-01-01T00:00:00.000Z"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`409`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/admin/reports/analytics/anonymous-vs-logged-in`

**Summary:** Anonymous vs logged-in reports (admin)

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Responses**

- **`200`**

  ```json
  {
    "anonymous": 0,
    "logged_in": 0
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/admin/reports/analytics/by-region`

**Summary:** Reports by region (admin)

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Responses**

- **`200`**

  ```json
  [
    {
      "region_id": "string",
      "region_name": "string",
      "count": 0
    }
  ]
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/admin/reports/analytics/by-status`

**Summary:** Reports by status (admin)

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Responses**

- **`200`**

  ```json
  [
    {
      "code": "string",
      "name": "string",
      "count": 0
    }
  ]
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/admin/reports/analytics/by-type`

**Summary:** Reports by type (admin)

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Responses**

- **`200`**

  ```json
  [
    {
      "code": "string",
      "name": "string",
      "count": 0
    }
  ]
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/admin/reports/analytics/summary`

**Summary:** Report analytics summary (admin)

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Responses**

- **`200`**

  ```json
  {
    "total": 0,
    "submitted": 0,
    "in_review": 0,
    "needs_more_info": 0,
    "accepted": 0,
    "rejected": 0,
    "duplicate": 0,
    "anonymous": 0,
    "logged_in": 0,
    "this_week": 0,
    "this_month": 0
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/me/reports`

**Summary:** List my reports

Returns the authenticated user's reports (newest first).

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| limit | Query | no | integer |


**Responses**

- **`200`**

  ```json
  [
    {
      "public_id": "00000000-0000-4000-8000-000000000000",
      "is_anonymous": false,
      "eligible_for_points": false,
      "report_type": {
        "code": "string",
        "name": "string"
      },
      "status": {
        "code": "string",
        "name": "string"
      },
      "description": "string",
      "priority": "string",
      "confidence_score": 0,
      "created_at": "2026-01-01T00:00:00.000Z",
      "updated_at": "2026-01-01T00:00:00.000Z",
      "reason_code": "string",
      "target_entity_type": "string",
      "target_entity_id": "string",
      "target_public_id": "string",
      "title": "string",
      "latitude": 0,
      "longitude": 0,
      "admin_area_id": "string",
      "admin_note": "string",
      "reviewed_at": "2026-01-01T00:00:00.000Z",
      "reward_granted_at": "2026-01-01T00:00:00.000Z"
    }
  ]
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

#### `POST` `/reports`

**Summary:** Submit a report

Creates a report. Works for signed-in users (created_by set, point-eligible) and anonymous users (anonymous_id required via body or the x-anonymous-id header; not point-eligible). Returns 201 on creation, or 200 with duplicate_warning=true when a recent duplicate from the same submitter already exists. DB-based rate limits return 429.

**Security:** None

**Request body** (`application/json`)

```json
{
  "reportTypeCode": "wrong_info",
  "description": "string",
  "targetEntityType": "place",
  "reasonCode": "string",
  "title": "string",
  "targetEntityId": 0,
  "targetPublicId": "00000000-0000-4000-8000-000000000000",
  "latitude": 0,
  "longitude": 0,
  "anonymousId": "string"
}
```

**Responses**

- **`200`**

  ```json
  {
    "public_id": "00000000-0000-4000-8000-000000000000",
    "is_anonymous": false,
    "eligible_for_points": false,
    "report_type": {
      "code": "string",
      "name": "string"
    },
    "status": {
      "code": "string",
      "name": "string"
    },
    "description": "string",
    "priority": "string",
    "confidence_score": 0,
    "created_at": "2026-01-01T00:00:00.000Z",
    "updated_at": "2026-01-01T00:00:00.000Z",
    "duplicate_warning": false,
    "reason_code": "string",
    "target_entity_type": "string",
    "target_entity_id": "string",
    "target_public_id": "string",
    "title": "string",
    "latitude": 0,
    "longitude": 0,
    "admin_area_id": "string",
    "admin_note": "string",
    "reviewed_at": "2026-01-01T00:00:00.000Z",
    "reward_granted_at": "2026-01-01T00:00:00.000Z",
    "message": "string"
  }
  ```

- **`201`**

  ```json
  {
    "public_id": "00000000-0000-4000-8000-000000000000",
    "is_anonymous": false,
    "eligible_for_points": false,
    "report_type": {
      "code": "string",
      "name": "string"
    },
    "status": {
      "code": "string",
      "name": "string"
    },
    "description": "string",
    "priority": "string",
    "confidence_score": 0,
    "created_at": "2026-01-01T00:00:00.000Z",
    "updated_at": "2026-01-01T00:00:00.000Z",
    "duplicate_warning": false,
    "reason_code": "string",
    "target_entity_type": "string",
    "target_entity_id": "string",
    "target_public_id": "string",
    "title": "string",
    "latitude": 0,
    "longitude": 0,
    "admin_area_id": "string",
    "admin_note": "string",
    "reviewed_at": "2026-01-01T00:00:00.000Z",
    "reward_granted_at": "2026-01-01T00:00:00.000Z",
    "message": "string"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`429`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/reports/{publicId}`

**Summary:** Get a report

Returns a single report. Authored reports require the owner; anonymous reports require a matching x-anonymous-id header.

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| publicId | Path | yes | string, uuid |


**Responses**

- **`200`**

  ```json
  {
    "public_id": "00000000-0000-4000-8000-000000000000",
    "is_anonymous": false,
    "eligible_for_points": false,
    "report_type": {
      "code": "string",
      "name": "string"
    },
    "status": {
      "code": "string",
      "name": "string"
    },
    "description": "string",
    "priority": "string",
    "confidence_score": 0,
    "created_at": "2026-01-01T00:00:00.000Z",
    "updated_at": "2026-01-01T00:00:00.000Z",
    "followups": [
      {
        "actor_type": "admin",
        "message": "string",
        "created_at": "2026-01-01T00:00:00.000Z",
        "actor_display_name": "string"
      }
    ],
    "status_events": [
      {
        "old_status_code": "string",
        "new_status_code": "string",
        "created_at": "2026-01-01T00:00:00.000Z",
        "actor_display_name": "string",
        "note": "string"
      }
    ],
    "reason_code": "string",
    "target_entity_type": "string",
    "target_entity_id": "string",
    "target_public_id": "string",
    "title": "string",
    "latitude": 0,
    "longitude": 0,
    "admin_area_id": "string",
    "admin_note": "string",
    "reviewed_at": "2026-01-01T00:00:00.000Z",
    "reward_granted_at": "2026-01-01T00:00:00.000Z"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `POST` `/reports/{publicId}/followups`

**Summary:** Reply to a report

Adds a follow-up message from the report owner and moves the report back to 'submitted'. Anonymous reports cannot use follow-ups.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| publicId | Path | yes | string, uuid |


**Request body** (`application/json`)

```json
{
  "message": "string"
}
```

**Responses**

- **`200`**

  ```json
  {
    "public_id": "00000000-0000-4000-8000-000000000000",
    "is_anonymous": false,
    "eligible_for_points": false,
    "report_type": {
      "code": "string",
      "name": "string"
    },
    "status": {
      "code": "string",
      "name": "string"
    },
    "description": "string",
    "priority": "string",
    "confidence_score": 0,
    "created_at": "2026-01-01T00:00:00.000Z",
    "updated_at": "2026-01-01T00:00:00.000Z",
    "followups": [
      {
        "actor_type": "admin",
        "message": "string",
        "created_at": "2026-01-01T00:00:00.000Z",
        "actor_display_name": "string"
      }
    ],
    "reason_code": "string",
    "target_entity_type": "string",
    "target_entity_id": "string",
    "target_public_id": "string",
    "title": "string",
    "latitude": 0,
    "longitude": 0,
    "admin_area_id": "string",
    "admin_note": "string",
    "reviewed_at": "2026-01-01T00:00:00.000Z",
    "reward_granted_at": "2026-01-01T00:00:00.000Z"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`409`**

  ```json
  {
    "message": "string"
  }
  ```

### Import Review

Admin-only Supabase `import_review` workspace. **`AUTH_BYPASS` is ignored.** Configure `IMPORT_REVIEW_ADMIN_TOKEN` to require header `x-import-review-admin-token` (401 missing, 403 mismatch; Bearer not required). Omit that env to require Bearer JWT whose payload includes `"roles": ["admin"]`.

#### `GET` `/api/import-review/{family}`

**Summary:** List import-review candidates by entity family

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| source_snapshot_version | Query | no | string |
| snapshot_version | Query | no | string |
| review_batch_id | Query | no | string |
| latest | Query | no | boolean |
| match_status | Query | no | string |
| auto_action | Query | no | string |
| review_status | Query | no | string |
| review_decision | Query | no | string |
| class_code | Query | no | string |
| promotion_status | Query | no | string |
| q | Query | no | string |
| limit | Query | no | integer |
| offset | Query | no | integer |
| sort | Query | no | string |
| include_geometry | Query | no | boolean |
| include_total | Query | no | boolean |
| family | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {
    "source_snapshot_version": "string",
    "review_batch_id": "string",
    "source_snapshot_id_local": "string",
    "items": [
      {
        "id": "string",
        "public_id": "string",
        "review_batch_id": "string",
        "source_snapshot_version": "string",
        "local_staging_id": "string",
        "source_snapshot_id_local": "string",
        "external_id": "string",
        "canonical_name": "string",
        "name": "string",
        "class_code": "string",
        "building_type": "string",
        "building_type_id": "string",
        "admin_area_id": "string",
        "levels": 0,
        "height_m": 0,
        "area_m2": 0,
        "confidence_score": 0,
        "match_status": "string",
        "auto_action": "string",
        "review_status": "string",
        "review_decision": "string",
        "reviewed_by": "string",
        "reviewed_at": "2026-01-01T00:00:00.000Z",
        "review_note": "string",
        "normalized_data": null,
        "source_refs": null,
        "matched_core_id": "string",
        "matched_core_table": "string",
        "…": "(more fields — see OpenAPI spec)"
      }
    ],
    "has_more": false,
    "limit": 0,
    "offset": 0,
    "batch_name": "string",
    "selected_by": "review_batch_id",
    "status": "string",
    "uploaded_at": "2026-01-01T00:00:00.000Z",
    "total_candidate_count": 0,
    "entity_families": [
      "string"
    ],
    "total": 0
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `GET` `/api/import-review/{family}/{id}`

**Summary:** Get one import-review candidate by entity family and id

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| source_snapshot_version | Query | no | string |
| snapshot_version | Query | no | string |
| review_batch_id | Query | no | string |
| latest | Query | no | boolean |
| include_geometry | Query | no | boolean |
| family | Path | yes | string |
| id | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {
    "id": "string",
    "public_id": "string",
    "review_batch_id": "string",
    "source_snapshot_version": "string",
    "local_staging_id": "string",
    "source_snapshot_id_local": "string",
    "external_id": "string",
    "canonical_name": "string",
    "name": "string",
    "class_code": "string",
    "building_type": "string",
    "building_type_id": "string",
    "admin_area_id": "string",
    "levels": 0,
    "height_m": 0,
    "area_m2": 0,
    "confidence_score": 0,
    "match_status": "string",
    "auto_action": "string",
    "review_status": "string",
    "review_decision": "string",
    "reviewed_by": "string",
    "reviewed_at": "2026-01-01T00:00:00.000Z",
    "review_note": "string",
    "normalized_data": null,
    "source_refs": null,
    "matched_core_id": "string",
    "matched_core_table": "string",
    "…": "(more fields — see OpenAPI spec)"
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `PATCH` `/api/import-review/{family}/{id}`

**Summary:** Patch typed candidate columns (authoritative)

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| family | Path | yes | string |
| id | Path | yes | string |


**Request body** (`application/json`)

```json
{
  "fields": {},
  "source_snapshot_version": "string",
  "snapshot_version": "string",
  "review_batch_id": "string",
  "latest": false,
  "review_note": "string"
}
```

**Responses**

- **`200`**

  ```json
  {
    "id": "string",
    "public_id": "string",
    "review_batch_id": "string",
    "source_snapshot_version": "string",
    "local_staging_id": "string",
    "source_snapshot_id_local": "string",
    "external_id": "string",
    "canonical_name": "string",
    "name": "string",
    "class_code": "string",
    "building_type": "string",
    "building_type_id": "string",
    "admin_area_id": "string",
    "levels": 0,
    "height_m": 0,
    "area_m2": 0,
    "confidence_score": 0,
    "match_status": "string",
    "auto_action": "string",
    "review_status": "string",
    "review_decision": "string",
    "reviewed_by": "string",
    "reviewed_at": "2026-01-01T00:00:00.000Z",
    "review_note": "string",
    "normalized_data": null,
    "source_refs": null,
    "matched_core_id": "string",
    "matched_core_table": "string",
    "…": "(more fields — see OpenAPI spec)"
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `PATCH` `/api/import-review/{family}/{id}/decision`

**Summary:** Patch review decision for one candidate in any entity family

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| family | Path | yes | string |
| id | Path | yes | string |


**Request body** (`application/json`)

```json
{
  "review_decision": "approved",
  "source_snapshot_version": "string",
  "snapshot_version": "string",
  "review_batch_id": "string",
  "latest": false,
  "review_note": "string",
  "force": false,
  "confirm_duplicate_reviewed": false,
  "confirm_matched_auto_update": false,
  "confirm_routing_warnings": false
}
```

**Responses**

- **`200`**

  ```json
  {
    "id": "string",
    "public_id": "string",
    "review_batch_id": "string",
    "source_snapshot_version": "string",
    "local_staging_id": "string",
    "source_snapshot_id_local": "string",
    "external_id": "string",
    "canonical_name": "string",
    "name": "string",
    "class_code": "string",
    "building_type": "string",
    "building_type_id": "string",
    "admin_area_id": "string",
    "levels": 0,
    "height_m": 0,
    "area_m2": 0,
    "confidence_score": 0,
    "match_status": "string",
    "auto_action": "string",
    "review_status": "string",
    "review_decision": "string",
    "reviewed_by": "string",
    "reviewed_at": "2026-01-01T00:00:00.000Z",
    "review_note": "string",
    "normalized_data": null,
    "source_refs": null,
    "matched_core_id": "string",
    "matched_core_table": "string",
    "…": "(more fields — see OpenAPI spec)"
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `PATCH` `/api/import-review/{family}/{id}/overrides`

**Summary:** Deprecated shim: same as PATCH /:family/:id — writes typed columns only

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| family | Path | yes | string |
| id | Path | yes | string |


**Request body** (`application/json`)

```json
{
  "fields": {},
  "source_snapshot_version": "string",
  "snapshot_version": "string",
  "review_batch_id": "string",
  "latest": false,
  "review_note": "string"
}
```

**Responses**

- **`200`**

  ```json
  {
    "id": "string",
    "public_id": "string",
    "review_batch_id": "string",
    "source_snapshot_version": "string",
    "local_staging_id": "string",
    "source_snapshot_id_local": "string",
    "external_id": "string",
    "canonical_name": "string",
    "name": "string",
    "class_code": "string",
    "building_type": "string",
    "building_type_id": "string",
    "admin_area_id": "string",
    "levels": 0,
    "height_m": 0,
    "area_m2": 0,
    "confidence_score": 0,
    "match_status": "string",
    "auto_action": "string",
    "review_status": "string",
    "review_decision": "string",
    "reviewed_by": "string",
    "reviewed_at": "2026-01-01T00:00:00.000Z",
    "review_note": "string",
    "normalized_data": null,
    "source_refs": null,
    "matched_core_id": "string",
    "matched_core_table": "string",
    "…": "(more fields — see OpenAPI spec)"
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `POST` `/api/import-review/{family}/bulk-decision`

**Summary:** Bulk review decision for candidates in an entity family

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| family | Path | yes | string |


**Request body** (`application/json`)

```json
{
  "review_decision": "approved",
  "source_snapshot_version": "string",
  "snapshot_version": "string",
  "review_batch_id": "string",
  "latest": false,
  "review_status": "approved",
  "review_note": "string",
  "force": false,
  "force_approval": false,
  "dry_run": false,
  "ids": [
    0
  ],
  "filters": {
    "match_status": "string",
    "auto_action": "string",
    "review_decision": "string"
  }
}
```

**Responses**

- **`200`**

  ```json
  {
    "source_snapshot_version": "string",
    "review_batch_id": "string",
    "source_snapshot_id_local": "string",
    "success": false,
    "updated_count": 0,
    "skipped_count": 0,
    "skipped_reasons": [
      {
        "reason": "string",
        "count": 0
      }
    ],
    "dry_run": false,
    "batch_name": "string",
    "selected_by": "review_batch_id",
    "status": "string",
    "uploaded_at": "2026-01-01T00:00:00.000Z",
    "total_candidate_count": 0,
    "entity_families": [
      "string"
    ],
    "updated_ids": [
      0
    ]
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `GET` `/api/import-review/{family}/filter-options`

**Summary:** Distinct filter values for an import-review entity family

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| source_snapshot_version | Query | no | string |
| snapshot_version | Query | no | string |
| review_batch_id | Query | no | string |
| latest | Query | no | boolean |
| family | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {
    "source_snapshot_version": "string",
    "review_batch_id": "string",
    "source_snapshot_id_local": "string",
    "batch_name": "string",
    "selected_by": "review_batch_id",
    "status": "string",
    "uploaded_at": "2026-01-01T00:00:00.000Z",
    "total_candidate_count": 0,
    "entity_families": [
      "string"
    ]
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `PATCH` `/api/import-review/addresses/{id}/components`

**Summary:** Upsert or soft-delete address components for a candidate

Persists structured import_review.address_components rows. Does not modify readonly generated full address fields on the candidate.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Request body** (`application/json`)

```json
{
  "upsert": [
    {
      "component_type_code": "string",
      "component_value": "string",
      "language_code": "en",
      "id": "string",
      "confidence_score": 0,
      "match_type": "string",
      "is_reviewed": false
    }
  ],
  "delete_ids": [
    "string"
  ]
}
```

**Responses**

- **`200`**
  - Address candidate detail after component save.

  ```json
  {}
  ```

- **`400`**

  ```json
  {
    "message": "string"
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `POST` `/api/import-review/addresses/{id}/create-place-candidate`

**Summary:** Create or link a place candidate from address source evidence

Creates an import_review.place_candidates row from address source tags, links it to the address candidate, and creates a review-time place_address_link when address strength is partial, strong, or full. Does not promote to core.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {
    "address_candidate_id": "string",
    "linked_place_candidate_id": "string",
    "matched_core_place_id": "string",
    "place_candidate_status": "string",
    "linked_place_candidate": {},
    "matched_core_place": {},
    "place_address_link": {}
  }
  ```

- **`400`**

  ```json
  {
    "message": "string"
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `PATCH` `/api/import-review/addresses/{id}/matches`

**Summary:** Save matched street/admin/building/place ids for an address candidate

Updates matched_* columns on import_review.address_candidates. When matched_street_id is set, syncs inferred street components from core.core_street_names (skips is_reviewed unless replace_reviewed_street_components=true).

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Request body** (`application/json`)

```json
{
  "matched_street_id": "string",
  "matched_admin_area_id": "string",
  "matched_building_id": "string",
  "matched_place_id": "string",
  "street_match_confidence": 0,
  "replace_reviewed_street_components": false
}
```

**Responses**

- **`200`**

  ```json
  {
    "address_candidate_id": "string",
    "matched_street_id": "string",
    "matched_admin_area_id": "string",
    "matched_building_id": "string",
    "matched_place_id": "string",
    "street_match_type": "string",
    "street_match_confidence": 0,
    "street_components_synced": [
      {
        "language_code": "string",
        "action": "inserted"
      }
    ]
  }
  ```

- **`400`**

  ```json
  {
    "message": "string"
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `GET` `/api/import-review/addresses/{id}/options`

**Summary:** Street/admin/building/place/postcode match options for an address candidate

Returns ranked nearby core.core_streets (300m then 1000m fallback), admin area options from point geometry, building options (contains + 50m), place options (100m + name similarity), and postcode values from address_components.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {
    "address_candidate_id": "string",
    "streets": [
      {
        "id": "string",
        "canonical_name": "string",
        "distance_m": 0,
        "match_score": 0,
        "match_method": "string",
        "name_en": "string",
        "name_my": "string",
        "name_und": "string"
      }
    ],
    "adminAreas": [
      {
        "id": "string",
        "canonical_name": "string",
        "admin_level_code": "string",
        "match_score": 0,
        "match_method": "string",
        "name_en": "string",
        "name_my": "string",
        "boundary_status": "string",
        "address_usage": "string",
        "distance_m": 0
      }
    ],
    "postcodes": [
      {
        "value": "string",
        "source": "string",
        "language_code": "string"
      }
    ],
    "buildings": [
      {
        "id": "string",
        "label": "string",
        "distance_m": 0,
        "match_score": 0,
        "match_method": "string",
        "building_type": "string"
      }
    ],
    "places": [
      {
        "id": "string",
        "display_name": "string",
        "distance_m": 0,
        "match_score": 0,
        "match_method": "string",
        "name_en": "string",
        "name_my": "string",
        "category": "string"
      }
    ]
  }
  ```

- **`400`**

  ```json
  {
    "message": "string"
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `PATCH` `/api/import-review/addresses/{id}/place-status`

**Summary:** Update address place candidate workflow status

Marks place evidence ignored, links a matched core place id, or clears the linked place candidate when no non-clearable place/address link exists. Does not promote to core.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Request body** (`application/json`)

```json
{
  "place_candidate_status": "ignored",
  "matched_core_place_id": "string",
  "clear_linked_place_candidate": false
}
```

**Responses**

- **`200`**

  ```json
  {
    "address_candidate_id": "string",
    "linked_place_candidate_id": "string",
    "matched_core_place_id": "string",
    "place_candidate_status": "string",
    "linked_place_candidate": {},
    "matched_core_place": {},
    "place_address_link": {}
  }
  ```

- **`400`**

  ```json
  {
    "message": "string"
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `POST` `/api/import-review/addresses/infer-admin-components`

**Summary:** Infer address admin components for a review batch

Runs import_review.infer_address_admin_components for address candidates with point_geom. Inserts idempotent inferred components from core.core_admin_areas (respecting boundary_status and address_usage), updates matched_admin_area_id and admin_match_* on candidates. Does not modify is_reviewed components.

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Request body** (`application/json`)

```json
{
  "review_batch_id": "string",
  "nearest_village_meters": 0
}
```

**Responses**

- **`200`**

  ```json
  {
    "review_batch_id": "string",
    "run": {
      "candidates_with_point": "string",
      "candidates_matched": "string",
      "components_inserted": "string",
      "candidates_updated": "string"
    },
    "verification": {
      "matched_admin_area_count": "string",
      "candidates_with_point": "string",
      "components_by_type_language": [
        {
          "component_type_code": "string",
          "language_code": "string",
          "row_count": "string"
        }
      ],
      "sample_components": [
        {
          "address_candidate_id": "string",
          "component_type_code": "string",
          "language_code": "string",
          "component_value": "string",
          "match_type": "string",
          "confidence_score": 0,
          "boundary_status": "string",
          "address_usage": "string",
          "source_admin_area_id": "string"
        }
      ]
    }
  }
  ```

- **`400`**

  ```json
  {
    "message": "string"
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`503`**

  ```json
  {
    "message": "string"
  }
  ```

#### `POST` `/api/import-review/addresses/promote`

**Summary:** Promote approved address candidates to core

Transactionally inserts core.core_addresses + core.core_address_components from review components, and marks candidates promoted. Place/address links are promoted separately after both sides exist in core. Blocked candidates and duplicates are skipped or flagged duplicate_review_needed.

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Request body** (`application/json`)

```json
{
  "review_batch_id": "string",
  "candidate_ids": [
    "string"
  ],
  "confirm_warnings": false
}
```

**Responses**

- **`200`**

  ```json
  {
    "dry_run": false,
    "review_batch_id": "string",
    "candidate_count": 0,
    "promoted": 0,
    "skipped": 0,
    "duplicate_review_needed": 0,
    "failed": 0,
    "warnings": [
      "string"
    ],
    "items": [
      {
        "address_candidate_id": "string",
        "external_id": "string",
        "outcome": "promoted",
        "reasons": [
          "string"
        ],
        "core_address_id": "string",
        "promotion_warnings": [
          {}
        ],
        "promotion_blockers": [
          {}
        ]
      }
    ],
    "finished_at": "2026-01-01T00:00:00.000Z",
    "disabled_because_env_flag_false": false,
    "message": "string"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string"
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `POST` `/api/import-review/addresses/promote-dry-run`

**Summary:** Dry-run address promotion to core

Evaluates import_review.address_candidates for promotion without writing core rows. Requires review_status=approved, validation_status valid/valid_with_warnings (with confirm_warnings when warnings), empty promotion_blockers.

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Request body** (`application/json`)

```json
{
  "review_batch_id": "string",
  "candidate_ids": [
    "string"
  ],
  "confirm_warnings": false
}
```

**Responses**

- **`200`**

  ```json
  {
    "dry_run": false,
    "review_batch_id": "string",
    "candidate_count": 0,
    "promoted": 0,
    "skipped": 0,
    "duplicate_review_needed": 0,
    "failed": 0,
    "warnings": [
      "string"
    ],
    "items": [
      {
        "address_candidate_id": "string",
        "external_id": "string",
        "outcome": "promoted",
        "reasons": [
          "string"
        ],
        "core_address_id": "string",
        "promotion_warnings": [
          {}
        ],
        "promotion_blockers": [
          {}
        ]
      }
    ],
    "finished_at": "2026-01-01T00:00:00.000Z",
    "disabled_because_env_flag_false": false,
    "message": "string"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string"
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `POST` `/api/import-review/addresses/validate`

**Summary:** Validate address candidates before promotion

Runs promotion-readiness checks on import_review.address_candidates and address_components. Persists validation_status, promotion_blockers, promotion_warnings, and validated_at. Does not promote to core.

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Request body** (`application/json`)

```json
{
  "review_batch_id": "string",
  "candidate_ids": [
    "string"
  ]
}
```

**Responses**

- **`200`**

  ```json
  {
    "review_batch_id": "string",
    "candidate_count": 0,
    "summary": {
      "blocked": 0,
      "valid_with_warnings": 0,
      "valid": 0
    },
    "results": [
      {
        "address_candidate_id": "string",
        "validation_status": "blocked",
        "promotion_blockers": [
          {
            "code": "string",
            "message": "string",
            "severity": "error",
            "field": "string",
            "component_id": "string"
          }
        ],
        "promotion_warnings": [
          {
            "code": "string",
            "message": "string",
            "severity": "error",
            "field": "string",
            "component_id": "string"
          }
        ],
        "validation_errors": [
          {
            "code": "string",
            "message": "string",
            "severity": "error",
            "field": "string",
            "component_id": "string"
          }
        ],
        "validation_warnings": [
          {
            "code": "string",
            "message": "string",
            "severity": "error",
            "field": "string",
            "component_id": "string"
          }
        ],
        "validated_at": "2026-01-01T00:00:00.000Z"
      }
    ]
  }
  ```

- **`400`**

  ```json
  {
    "message": "string"
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `GET` `/api/import-review/batches`

**Summary:** List import-review batches for a snapshot

Lightweight list of non-archived `import_review.review_batches` rows for a source_snapshot_version, newest first. No geometry or large JSONB fields.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| source_snapshot_version | Query | yes | string |
| snapshot_version | Query | no | string |


**Responses**

- **`200`**

  ```json
  {
    "source_snapshot_version": "string",
    "batches": [
      {
        "id": "string",
        "batch_name": "string",
        "source_snapshot_version": "string",
        "status": "string",
        "uploaded_at": "2026-01-01T00:00:00.000Z",
        "created_at": "2026-01-01T00:00:00.000Z",
        "updated_at": "2026-01-01T00:00:00.000Z",
        "total_candidate_count": 0,
        "entity_families": [
          "string"
        ]
      }
    ]
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `GET` `/api/import-review/buildings`

**Summary:** List import-review building candidates

Paged list from `import_review.building_candidates` with GeoJSON `geom`/centroid when `include_geometry=true`. Scope matches summary endpoint rules.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| source_snapshot_version | Query | no | string |
| snapshot_version | Query | no | string |
| review_batch_id | Query | no | string |
| latest | Query | no | boolean |
| match_status | Query | no | string |
| auto_action | Query | no | string |
| review_status | Query | no | string |
| review_decision | Query | no | string |
| class_code | Query | no | string |
| promotion_status | Query | no | string |
| q | Query | no | string |
| limit | Query | no | integer |
| offset | Query | no | integer |
| sort | Query | no | string |
| include_geometry | Query | no | boolean |
| include_total | Query | no | boolean |


**Responses**

- **`200`**

  ```json
  {
    "source_snapshot_version": "string",
    "review_batch_id": "string",
    "source_snapshot_id_local": "string",
    "items": [
      {
        "id": "string",
        "public_id": "string",
        "review_batch_id": "string",
        "source_snapshot_version": "string",
        "local_staging_id": "string",
        "source_snapshot_id_local": "string",
        "external_id": "string",
        "canonical_name": "string",
        "name": "string",
        "class_code": "string",
        "building_type": "string",
        "building_type_id": "string",
        "admin_area_id": "string",
        "levels": 0,
        "height_m": 0,
        "area_m2": 0,
        "confidence_score": 0,
        "match_status": "string",
        "auto_action": "string",
        "review_status": "string",
        "review_decision": "string",
        "reviewed_by": "string",
        "reviewed_at": "2026-01-01T00:00:00.000Z",
        "review_note": "string",
        "normalized_data": null,
        "source_refs": null,
        "matched_core_id": "string",
        "matched_core_table": "string",
        "…": "(more fields — see OpenAPI spec)"
      }
    ],
    "has_more": false,
    "limit": 0,
    "offset": 0,
    "batch_name": "string",
    "selected_by": "review_batch_id",
    "status": "string",
    "uploaded_at": "2026-01-01T00:00:00.000Z",
    "total_candidate_count": 0,
    "entity_families": [
      "string"
    ],
    "total": 0
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`409`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `GET` `/api/import-review/buildings/{id}`

**Summary:** Get one import-review building candidate

Returns a single candidate row with GeoJSON geometry when include_geometry=true.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| source_snapshot_version | Query | no | string |
| snapshot_version | Query | no | string |
| review_batch_id | Query | no | string |
| latest | Query | no | boolean |
| include_geometry | Query | no | boolean |
| id | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {
    "id": "string",
    "public_id": "string",
    "review_batch_id": "string",
    "source_snapshot_version": "string",
    "local_staging_id": "string",
    "source_snapshot_id_local": "string",
    "external_id": "string",
    "canonical_name": "string",
    "name": "string",
    "class_code": "string",
    "building_type": "string",
    "building_type_id": "string",
    "admin_area_id": "string",
    "levels": 0,
    "height_m": 0,
    "area_m2": 0,
    "confidence_score": 0,
    "match_status": "string",
    "auto_action": "string",
    "review_status": "string",
    "review_decision": "string",
    "reviewed_by": "string",
    "reviewed_at": "2026-01-01T00:00:00.000Z",
    "review_note": "string",
    "normalized_data": null,
    "source_refs": null,
    "matched_core_id": "string",
    "matched_core_table": "string",
    "…": "(more fields — see OpenAPI spec)"
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`409`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `PATCH` `/api/import-review/buildings/{id}/decision`

**Summary:** Set import-review building decision

Updates `import_review.building_candidates` decisions (never core). Rows with promotion_status=promoted require force=true for any change; manual_protected/protect_manual and duplicate_candidate follow bulk safety rules documented in dashboards.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Request body** (`application/json`)

```json
{
  "review_decision": "approved",
  "source_snapshot_version": "string",
  "snapshot_version": "string",
  "review_batch_id": "string",
  "latest": false,
  "review_note": "string",
  "force": false,
  "confirm_duplicate_reviewed": false,
  "confirm_matched_auto_update": false,
  "confirm_routing_warnings": false
}
```

**Responses**

- **`200`**

  ```json
  {
    "id": "string",
    "public_id": "string",
    "review_batch_id": "string",
    "source_snapshot_version": "string",
    "local_staging_id": "string",
    "source_snapshot_id_local": "string",
    "external_id": "string",
    "canonical_name": "string",
    "name": "string",
    "class_code": "string",
    "building_type": "string",
    "building_type_id": "string",
    "admin_area_id": "string",
    "levels": 0,
    "height_m": 0,
    "area_m2": 0,
    "confidence_score": 0,
    "match_status": "string",
    "auto_action": "string",
    "review_status": "string",
    "review_decision": "string",
    "reviewed_by": "string",
    "reviewed_at": "2026-01-01T00:00:00.000Z",
    "review_note": "string",
    "normalized_data": null,
    "source_refs": null,
    "matched_core_id": "string",
    "matched_core_table": "string",
    "…": "(more fields — see OpenAPI spec)"
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`409`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `PATCH` `/api/import-review/buildings/{id}/overrides`

**Summary:** Patch import_review building overrides

Deprecated shim — writes typed columns via `fields` plus optional audit row (`import_review.review_candidate_edits`).

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Request body** (`application/json`)

```json
{
  "fields": {},
  "source_snapshot_version": "string",
  "snapshot_version": "string",
  "review_batch_id": "string",
  "latest": false,
  "review_note": "string"
}
```

**Responses**

- **`200`**

  ```json
  {
    "id": "string",
    "public_id": "string",
    "review_batch_id": "string",
    "source_snapshot_version": "string",
    "local_staging_id": "string",
    "source_snapshot_id_local": "string",
    "external_id": "string",
    "canonical_name": "string",
    "name": "string",
    "class_code": "string",
    "building_type": "string",
    "building_type_id": "string",
    "admin_area_id": "string",
    "levels": 0,
    "height_m": 0,
    "area_m2": 0,
    "confidence_score": 0,
    "match_status": "string",
    "auto_action": "string",
    "review_status": "string",
    "review_decision": "string",
    "reviewed_by": "string",
    "reviewed_at": "2026-01-01T00:00:00.000Z",
    "review_note": "string",
    "normalized_data": null,
    "source_refs": null,
    "matched_core_id": "string",
    "matched_core_table": "string",
    "…": "(more fields — see OpenAPI spec)"
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`409`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `POST` `/api/import-review/buildings/bulk-decision`

**Summary:** Bulk import-review building decisions

Bulk updates building candidates in one transaction (or dry_run for counts). Mode A: ids. Mode B: filters. Uses DATABASE_URL.

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Request body** (`application/json`)

```json
{
  "review_decision": "approved",
  "source_snapshot_version": "string",
  "snapshot_version": "string",
  "review_batch_id": "string",
  "latest": false,
  "review_status": "approved",
  "review_note": "string",
  "force": false,
  "force_approval": false,
  "dry_run": false,
  "ids": [
    0
  ],
  "filters": {
    "match_status": "string",
    "auto_action": "string",
    "review_decision": "string"
  }
}
```

**Responses**

- **`200`**

  ```json
  {
    "source_snapshot_version": "string",
    "review_batch_id": "string",
    "source_snapshot_id_local": "string",
    "success": false,
    "updated_count": 0,
    "skipped_count": 0,
    "skipped_reasons": [
      {
        "reason": "string",
        "count": 0
      }
    ],
    "dry_run": false,
    "batch_name": "string",
    "selected_by": "review_batch_id",
    "status": "string",
    "uploaded_at": "2026-01-01T00:00:00.000Z",
    "total_candidate_count": 0,
    "entity_families": [
      "string"
    ],
    "updated_ids": [
      0
    ]
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`409`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `GET` `/api/import-review/buildings/filter-options`

**Summary:** Distinct building candidate filter options

Read-only DISTINCT dropdown values from `import_review.building_candidates` within the resolved review scope.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| source_snapshot_version | Query | no | string |
| snapshot_version | Query | no | string |
| review_batch_id | Query | no | string |
| latest | Query | no | boolean |


**Responses**

- **`200`**

  ```json
  {
    "source_snapshot_version": "string",
    "review_batch_id": "string",
    "source_snapshot_id_local": "string",
    "match_status": [
      "string"
    ],
    "auto_action": [
      "string"
    ],
    "review_status": [
      "string"
    ],
    "review_decision": [
      "string"
    ],
    "class_code": [
      "string"
    ],
    "promotion_status": [
      "string"
    ],
    "batch_name": "string",
    "selected_by": "review_batch_id",
    "status": "string",
    "uploaded_at": "2026-01-01T00:00:00.000Z",
    "total_candidate_count": 0,
    "entity_families": [
      "string"
    ]
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`409`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `POST` `/api/import-review/cleanup/promoted/dry-run`

**Summary:** Dry-run permanent cleanup of promoted import_review candidates

Reports which soft-hidden promoted import_review candidate rows are eligible for permanent deletion. Does not mutate data. Core rows and system publish history are never deleted.

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Request body** (`application/json`)

```json
{
  "review_batch_id": "string",
  "entity_families": [
    "string"
  ],
  "publish_batch_id": "string",
  "older_than_days": 0
}
```

**Responses**

- **`200`**

  ```json
  {
    "review_batch_id": "string",
    "publish_batch_id": "string",
    "selected_entity_families": [
      "string"
    ],
    "eligible_counts_by_entity": {},
    "not_eligible_counts_by_reason": {},
    "estimated_rows_to_delete": 0,
    "estimated_geometry_rows_to_delete": 0,
    "example_eligible_rows": [
      {
        "candidate_id": "string",
        "entity_family": "string",
        "promoted_core_id": "string",
        "promoted_at": "string",
        "publish_batch_id": "string"
      }
    ],
    "example_blocked_rows": [
      {
        "candidate_id": "string",
        "entity_family": "string",
        "promoted_core_id": "string",
        "promoted_at": "string",
        "publish_batch_id": "string",
        "reason": "string"
      }
    ],
    "execute_enabled": false,
    "message": "string"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string"
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `POST` `/api/import-review/cleanup/promoted/execute`

**Summary:** Execute permanent cleanup of promoted import_review candidates

Permanently deletes eligible import_review candidate rows only when ENABLE_IMPORT_REVIEW_PERMANENT_CLEANUP=true and confirmation_text matches. Core and system publish history are preserved.

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Request body** (`application/json`)

```json
{
  "review_batch_id": "string",
  "confirmation_text": "DELETE PROMOTED REVIEW DATA",
  "entity_families": [
    "string"
  ],
  "publish_batch_id": "string",
  "older_than_days": 0
}
```

**Responses**

- **`200`**

  ```json
  {
    "review_batch_id": "string",
    "publish_batch_id": "string",
    "deleted_count": 0,
    "deleted_by_entity": {},
    "message": "string"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string"
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `GET` `/api/import-review/history/publish-batches`

**Summary:** List publish batches for history (cross review-batch)

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| status | Query | no | string |
| source_review_batch_id | Query | no | string |
| source_snapshot_version | Query | no | string |
| entity_family | Query | no | string |
| created_after | Query | no | string, date-time |
| created_before | Query | no | string, date-time |
| limit | Query | no | integer |
| offset | Query | no | integer |


**Responses**

- **`200`**

  ```json
  {
    "items": [
      {}
    ],
    "total": 0,
    "limit": 0,
    "offset": 0
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `GET` `/api/import-review/history/publish-batches/{id}`

**Summary:** Get one publish batch history detail

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {}
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `GET` `/api/import-review/history/publish-batches/{id}/items`

**Summary:** List publish batch items for history

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| publish_status | Query | no | string |
| status | Query | no | string |
| entity_family | Query | no | string |
| limit | Query | no | integer |
| offset | Query | no | integer |
| id | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {
    "items": [
      {}
    ],
    "total": 0,
    "limit": 0,
    "offset": 0
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `GET` `/api/import-review/history/publish-batches/{id}/logs`

**Summary:** Get publish batch process-state logs for history

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {}
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `GET` `/api/import-review/history/review-batches`

**Summary:** List import-review upload (review) batches for history

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| status | Query | no | string |
| source_snapshot_version | Query | no | string |
| entity_family | Query | no | string |
| uploaded_after | Query | no | string, date-time |
| uploaded_before | Query | no | string, date-time |
| limit | Query | no | integer |
| offset | Query | no | integer |


**Responses**

- **`200`**

  ```json
  {
    "items": [
      {
        "id": "string",
        "public_id": "string",
        "batch_name": "string",
        "source_snapshot_version": "string",
        "source_snapshot_id_local": "string",
        "status": "string",
        "created_at": "2026-01-01T00:00:00.000Z",
        "uploaded_at": "2026-01-01T00:00:00.000Z",
        "validated_at": "2026-01-01T00:00:00.000Z",
        "promoted_at": "2026-01-01T00:00:00.000Z",
        "total_candidate_count": 0,
        "entity_families": [
          "string"
        ],
        "counts": {},
        "counts_by_entity_family": [
          {
            "entity_family": "string",
            "table_name": "string",
            "batch_total": 0,
            "active": 0,
            "pending_review": 0,
            "approved": 0,
            "rejected": 0,
            "needs_review": 0,
            "ignored": 0,
            "merged": 0,
            "ready_for_publish": 0,
            "promoted": 0,
            "promotion_failed": 0,
            "validation_error_count": 0,
            "validation_warning_count": 0
          }
        ],
        "publish_batches": {}
      }
    ],
    "total": 0,
    "limit": 0,
    "offset": 0
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `GET` `/api/import-review/history/review-batches/{id}`

**Summary:** Get one import-review upload batch history detail

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {}
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `GET` `/api/import-review/options`

**Summary:** Form dropdown options for import-review override editors

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Responses**

- **`200`**

  ```json
  {
    "admin_areas": [
      {
        "id": "string",
        "value": "string",
        "label": "string",
        "canonical_name": "string",
        "admin_level_id": "string",
        "code": "string",
        "name_mm": "string",
        "name_en": "string",
        "parent_id": "string"
      }
    ],
    "admin_levels": [
      {
        "value": "string",
        "label": "string",
        "id": "string",
        "code": "string",
        "name": "string",
        "name_mm": "string",
        "parent_id": "string"
      }
    ],
    "road_classes": [
      {
        "value": "string",
        "label": "string",
        "id": "string",
        "code": "string",
        "name": "string",
        "name_mm": "string",
        "parent_id": "string"
      }
    ],
    "poi_categories": [
      {
        "id": "string",
        "value": "string",
        "label": "string",
        "code": "string",
        "name": "string",
        "name_mm": "string",
        "parent_id": "string"
      }
    ],
    "building_types": [
      {
        "value": "string",
        "label": "string",
        "id": "string",
        "code": "string",
        "name": "string",
        "name_mm": "string",
        "parent_id": "string"
      }
    ],
    "land_area_classes": [
      {
        "value": "string",
        "label": "string",
        "id": "string",
        "code": "string",
        "name": "string",
        "name_mm": "string",
        "parent_id": "string"
      }
    ],
    "waterway_classes": [
      {
        "value": "string",
        "label": "string",
        "id": "string",
        "code": "string",
        "name": "string",
        "name_mm": "string",
        "parent_id": "string"
      }
    ],
    "water_classes": [
      {
        "value": "string",
        "label": "string",
        "id": "string",
        "code": "string",
        "name": "string",
        "name_mm": "string",
        "parent_id": "string"
      }
    ],
    "barrier_types": [
      {
        "value": "string",
        "label": "string",
        "id": "string",
        "code": "string",
        "name": "string",
        "name_mm": "string",
        "parent_id": "string"
      }
    ],
    "surface_presets": [
      {
        "value": "string",
        "label": "string",
        "id": "string",
        "code": "string",
        "name": "string",
        "name_mm": "string",
        "parent_id": "string"
      }
    ]
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `POST` `/api/import-review/place-address-links/promote`

**Summary:** Promote approved place/address links to core

Promotes import_review.place_address_links to core.core_place_addresses only when both sides resolve to existing core rows.

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Request body** (`application/json`)

```json
{
  "review_batch_id": "string",
  "link_ids": [
    "string"
  ],
  "confirm_warnings": false
}
```

**Responses**

- **`200`**

  ```json
  {
    "dry_run": false,
    "review_batch_id": "string",
    "candidate_count": 0,
    "promoted": 0,
    "skipped": 0,
    "failed": 0,
    "warnings": [
      "string"
    ],
    "items": [
      {
        "candidate_id": "string",
        "external_id": "string",
        "outcome": "promoted",
        "reasons": [
          "string"
        ],
        "core_id": "string",
        "promotion_warnings": [
          {}
        ],
        "promotion_blockers": [
          {}
        ]
      }
    ],
    "finished_at": "2026-01-01T00:00:00.000Z"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string"
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `POST` `/api/import-review/place-address-links/promote-dry-run`

**Summary:** Promote approved place/address links to core

Promotes import_review.place_address_links to core.core_place_addresses only when both sides resolve to existing core rows.

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Request body** (`application/json`)

```json
{
  "review_batch_id": "string",
  "link_ids": [
    "string"
  ],
  "confirm_warnings": false
}
```

**Responses**

- **`200`**

  ```json
  {
    "dry_run": false,
    "review_batch_id": "string",
    "candidate_count": 0,
    "promoted": 0,
    "skipped": 0,
    "failed": 0,
    "warnings": [
      "string"
    ],
    "items": [
      {
        "candidate_id": "string",
        "external_id": "string",
        "outcome": "promoted",
        "reasons": [
          "string"
        ],
        "core_id": "string",
        "promotion_warnings": [
          {}
        ],
        "promotion_blockers": [
          {}
        ]
      }
    ],
    "finished_at": "2026-01-01T00:00:00.000Z"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string"
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `POST` `/api/import-review/place-address-links/validate`

**Summary:** Validate place/address links before promotion

Runs review-time checks on import_review.place_address_links and persists validation_status, validation_errors, and validation_warnings. Does not promote to core.

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Request body** (`application/json`)

```json
{
  "review_batch_id": "string",
  "link_ids": [
    "string"
  ]
}
```

**Responses**

- **`200`**

  ```json
  {
    "review_batch_id": "string",
    "link_count": 0,
    "summary": {
      "blocked": 0,
      "valid_with_warnings": 0,
      "valid": 0
    },
    "results": [
      {
        "place_address_link_id": "string",
        "validation_status": "blocked",
        "validation_errors": [
          {
            "code": "string",
            "message": "string",
            "severity": "error",
            "field": "string",
            "component_id": "string"
          }
        ],
        "validation_warnings": [
          {
            "code": "string",
            "message": "string",
            "severity": "error",
            "field": "string",
            "component_id": "string"
          }
        ],
        "validated_at": "2026-01-01T00:00:00.000Z"
      }
    ]
  }
  ```

- **`400`**

  ```json
  {
    "message": "string"
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `GET` `/api/import-review/places`

**Summary:** List import-review place candidates

Paginated `import_review.place_candidates` within the resolved batch/source snapshot.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| source_snapshot_version | Query | no | string |
| snapshot_version | Query | no | string |
| review_batch_id | Query | no | string |
| latest | Query | no | boolean |
| match_status | Query | no | string |
| auto_action | Query | no | string |
| review_status | Query | no | string |
| review_decision | Query | no | string |
| q | Query | no | string |
| limit | Query | no | integer |
| offset | Query | no | integer |
| sort | Query | no | string |
| include_geometry | Query | no | boolean |
| include_total | Query | no | boolean |


**Responses**

- **`200`**

  ```json
  {
    "source_snapshot_version": "string",
    "review_batch_id": "string",
    "source_snapshot_id_local": "string",
    "items": [
      {
        "id": "string",
        "public_id": "string",
        "review_batch_id": "string",
        "source_snapshot_version": "string",
        "local_staging_id": "string",
        "source_snapshot_id_local": "string",
        "external_id": "string",
        "canonical_name": "string",
        "name": "string",
        "class_code": "string",
        "building_type": "string",
        "building_type_id": "string",
        "admin_area_id": "string",
        "levels": 0,
        "height_m": 0,
        "area_m2": 0,
        "confidence_score": 0,
        "match_status": "string",
        "auto_action": "string",
        "review_status": "string",
        "review_decision": "string",
        "reviewed_by": "string",
        "reviewed_at": "2026-01-01T00:00:00.000Z",
        "review_note": "string",
        "normalized_data": null,
        "source_refs": null,
        "matched_core_id": "string",
        "matched_core_table": "string",
        "…": "(more fields — see OpenAPI spec)"
      }
    ],
    "has_more": false,
    "limit": 0,
    "offset": 0,
    "batch_name": "string",
    "selected_by": "review_batch_id",
    "status": "string",
    "uploaded_at": "2026-01-01T00:00:00.000Z",
    "total_candidate_count": 0,
    "entity_families": [
      "string"
    ],
    "total": 0
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`409`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `PATCH` `/api/import-review/places/{id}/decision`

**Summary:** Set import-review place decision

Updates place candidate review columns. Same rules as buildings for manual_protected and duplicate_candidate.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Request body** (`application/json`)

```json
{
  "review_decision": "approved",
  "source_snapshot_version": "string",
  "snapshot_version": "string",
  "review_batch_id": "string",
  "latest": false,
  "review_note": "string",
  "force": false,
  "confirm_duplicate_reviewed": false,
  "confirm_matched_auto_update": false,
  "confirm_routing_warnings": false
}
```

**Responses**

- **`200`**

  ```json
  {
    "id": "string",
    "public_id": "string",
    "review_batch_id": "string",
    "source_snapshot_version": "string",
    "local_staging_id": "string",
    "source_snapshot_id_local": "string",
    "external_id": "string",
    "canonical_name": "string",
    "name": "string",
    "class_code": "string",
    "building_type": "string",
    "building_type_id": "string",
    "admin_area_id": "string",
    "levels": 0,
    "height_m": 0,
    "area_m2": 0,
    "confidence_score": 0,
    "match_status": "string",
    "auto_action": "string",
    "review_status": "string",
    "review_decision": "string",
    "reviewed_by": "string",
    "reviewed_at": "2026-01-01T00:00:00.000Z",
    "review_note": "string",
    "normalized_data": null,
    "source_refs": null,
    "matched_core_id": "string",
    "matched_core_table": "string",
    "…": "(more fields — see OpenAPI spec)"
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`409`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `POST` `/api/import-review/places/bulk-decision`

**Summary:** Bulk import-review place decisions

Bulk updates place candidates (or dry_run). Same scope rules as buildings.

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Request body** (`application/json`)

```json
{
  "review_decision": "approved",
  "source_snapshot_version": "string",
  "snapshot_version": "string",
  "review_batch_id": "string",
  "latest": false,
  "review_status": "approved",
  "review_note": "string",
  "force": false,
  "force_approval": false,
  "dry_run": false,
  "ids": [
    0
  ],
  "filters": {
    "match_status": "string",
    "auto_action": "string",
    "review_decision": "string"
  }
}
```

**Responses**

- **`200`**

  ```json
  {
    "source_snapshot_version": "string",
    "review_batch_id": "string",
    "source_snapshot_id_local": "string",
    "success": false,
    "updated_count": 0,
    "skipped_count": 0,
    "skipped_reasons": [
      {
        "reason": "string",
        "count": 0
      }
    ],
    "dry_run": false,
    "batch_name": "string",
    "selected_by": "review_batch_id",
    "status": "string",
    "uploaded_at": "2026-01-01T00:00:00.000Z",
    "total_candidate_count": 0,
    "entity_families": [
      "string"
    ],
    "updated_ids": [
      0
    ]
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`409`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `POST` `/api/import-review/places/promote`

**Summary:** Promote approved place candidates to core

Promotes import_review.place_candidates to core.core_places and core.core_place_names. Requires approved review status, valid validation result, no blockers, and no existing core duplicate.

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Request body** (`application/json`)

```json
{
  "review_batch_id": "string",
  "candidate_ids": [
    "string"
  ],
  "confirm_warnings": false
}
```

**Responses**

- **`200`**

  ```json
  {
    "dry_run": false,
    "review_batch_id": "string",
    "candidate_count": 0,
    "promoted": 0,
    "skipped": 0,
    "failed": 0,
    "warnings": [
      "string"
    ],
    "items": [
      {
        "candidate_id": "string",
        "external_id": "string",
        "outcome": "promoted",
        "reasons": [
          "string"
        ],
        "core_id": "string",
        "promotion_warnings": [
          {}
        ],
        "promotion_blockers": [
          {}
        ]
      }
    ],
    "finished_at": "2026-01-01T00:00:00.000Z"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string"
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `POST` `/api/import-review/places/promote-dry-run`

**Summary:** Promote approved place candidates to core

Promotes import_review.place_candidates to core.core_places and core.core_place_names. Requires approved review status, valid validation result, no blockers, and no existing core duplicate.

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Request body** (`application/json`)

```json
{
  "review_batch_id": "string",
  "candidate_ids": [
    "string"
  ],
  "confirm_warnings": false
}
```

**Responses**

- **`200`**

  ```json
  {
    "dry_run": false,
    "review_batch_id": "string",
    "candidate_count": 0,
    "promoted": 0,
    "skipped": 0,
    "failed": 0,
    "warnings": [
      "string"
    ],
    "items": [
      {
        "candidate_id": "string",
        "external_id": "string",
        "outcome": "promoted",
        "reasons": [
          "string"
        ],
        "core_id": "string",
        "promotion_warnings": [
          {}
        ],
        "promotion_blockers": [
          {}
        ]
      }
    ],
    "finished_at": "2026-01-01T00:00:00.000Z"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string"
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `POST` `/api/import-review/places/validate`

**Summary:** Validate place candidates before promotion

Runs review-time promotion-readiness checks on import_review.place_candidates. Persists validation_errors and validation_warnings only. Does not promote to core.

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Request body** (`application/json`)

```json
{
  "review_batch_id": "string",
  "candidate_ids": [
    "string"
  ]
}
```

**Responses**

- **`200`**

  ```json
  {
    "review_batch_id": "string",
    "candidate_count": 0,
    "summary": {
      "blocked": 0,
      "valid_with_warnings": 0,
      "valid": 0
    },
    "results": [
      {
        "place_candidate_id": "string",
        "validation_status": "blocked",
        "validation_errors": [
          {
            "code": "string",
            "message": "string",
            "severity": "error",
            "field": "string",
            "component_id": "string"
          }
        ],
        "validation_warnings": [
          {
            "code": "string",
            "message": "string",
            "severity": "error",
            "field": "string",
            "component_id": "string"
          }
        ],
        "validated_at": "2026-01-01T00:00:00.000Z"
      }
    ]
  }
  ```

- **`400`**

  ```json
  {
    "message": "string"
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `GET` `/api/import-review/promotion/batch-eligibility`

**Summary:** Preview publish batch eligibility counts per entity family

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| source_snapshot_version | Query | no | string |
| snapshot_version | Query | no | string |
| review_batch_id | Query | no | string |
| latest | Query | no | boolean |
| include_merged | Query | no | boolean |
| entity_families | Query | no | array |
| include_warnings | Query | no | boolean |
| mode | Query | no | string |


**Responses**

- **`200`**

  ```json
  {
    "review_batch_id": "string",
    "source_snapshot_version": "string",
    "entity_families": [
      "string"
    ],
    "by_family": [
      {
        "entity_family": "string",
        "table_name": "string",
        "approved_ready": 0,
        "with_warnings": 0,
        "blocked": 0,
        "already_promoted": 0,
        "excluded": 0,
        "skipped_reasons": [
          {
            "reason": "string",
            "count": 0
          }
        ]
      }
    ],
    "totals": {
      "approved_ready": 0,
      "with_warnings": 0,
      "blocked": 0,
      "already_promoted": 0
    }
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`409`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `GET` `/api/import-review/promotion/batches`

**Summary:** List publish batches for a review scope

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| source_snapshot_version | Query | no | string |
| snapshot_version | Query | no | string |
| review_batch_id | Query | no | string |
| latest | Query | no | boolean |
| include_merged | Query | no | boolean |
| limit | Query | no | integer |
| offset | Query | no | integer |


**Responses**

- **`200`**

  ```json
  {
    "items": [
      {
        "id": "string",
        "public_id": "string",
        "batch_name": "string",
        "status": "string",
        "derived_status": "string",
        "total_item_count": 0,
        "success_count": 0,
        "failed_count": 0,
        "skipped_count": 0,
        "core_verified_count": 0,
        "import_review_marked_promoted_count": 0,
        "inserted_count": 0,
        "updated_count": 0,
        "created_at": "2026-01-01T00:00:00.000Z",
        "derived_status_reason": "string",
        "stored_status_recommendation": "string",
        "status_note": "string",
        "source_review_batch_id": "string",
        "source_snapshot_version": "string",
        "region_code": "string",
        "note": "string",
        "published_at": "2026-01-01T00:00:00.000Z",
        "promoted_at": "2026-01-01T00:00:00.000Z"
      }
    ],
    "total": 0,
    "limit": 0,
    "offset": 0
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`409`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `POST` `/api/import-review/promotion/batches`

**Summary:** Create publish batch from checkbox-selected entity families

Requires review_batch_id and families[]. When dry_run=false: inserts system.system_publish_batches + system.system_publish_items and marks candidates batched. dry_run=true previews counts only. Does not validate or promote.

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Request body** (`application/json`)

```json
{
  "review_batch_id": 0,
  "families": [
    "string"
  ],
  "include_warnings": false,
  "dry_run": false,
  "batch_name": "string",
  "note": "string",
  "include_merged": false,
  "max_items": 0,
  "limit_per_family": {},
  "entity_families": [
    "string"
  ]
}
```

**Responses**

- **`200`**

  ```json
  {
    "dry_run": true,
    "batch_name": "string",
    "entity_families": [
      "string"
    ],
    "totals": {
      "included": 0,
      "excluded": 0,
      "skipped": 0
    },
    "by_family": [
      {
        "entity_family": "string",
        "included": 0,
        "excluded": 0,
        "skipped": 0,
        "skipped_reasons": [
          {
            "reason": "string",
            "count": 0
          }
        ]
      }
    ],
    "stages": [
      {
        "stage_key": "string",
        "stage_label": "string",
        "message": "string",
        "counts": {}
      }
    ],
    "message": "string"
  }
  ```

- **`201`**

  ```json
  {
    "id": 0,
    "public_id": "string",
    "review_batch_id": 0,
    "mode": "selected",
    "total_item_count": 0,
    "count_by_family": {},
    "message": "string",
    "batch": {
      "id": "string",
      "public_id": "string",
      "batch_name": "string",
      "status": "string",
      "derived_status": "string",
      "total_item_count": 0,
      "success_count": 0,
      "failed_count": 0,
      "skipped_count": 0,
      "core_verified_count": 0,
      "import_review_marked_promoted_count": 0,
      "inserted_count": 0,
      "updated_count": 0,
      "created_at": "2026-01-01T00:00:00.000Z",
      "derived_status_reason": "string",
      "stored_status_recommendation": "string",
      "status_note": "string",
      "source_review_batch_id": "string",
      "source_snapshot_version": "string",
      "region_code": "string",
      "note": "string",
      "published_at": "2026-01-01T00:00:00.000Z",
      "promoted_at": "2026-01-01T00:00:00.000Z",
      "item_counts": {
        "pending": 0,
        "success": 0,
        "failed": 0,
        "skipped": 0,
        "rolled_back": 0,
        "total": 0
      },
      "building_item_counts": {
        "pending": 0,
        "success": 0,
        "failed": 0,
        "skipped": 0,
        "rolled_back": 0,
        "total": 0
      },
      "item_counts_by_entity_family": {}
    },
    "batch_id": "string",
    "publish_batch_id": "string",
    "families": [
      "string"
    ],
    "status": "string",
    "total_items": 0,
    "items_added": 0,
    "total_selected": 0,
    "candidates_marked_batched": 0,
    "by_family": [
      {
        "entity_family": "string",
        "items_added": 0,
        "marked_batched": 0,
        "skipped_reasons": [
          {
            "reason": "string",
            "count": 0
          }
        ]
      }
    ],
    "by_entity": {},
    "skipped": 0,
    "building_candidates_marked_batched": 0,
    "timing_ms": {
      "resolve_ms": 0,
      "eligibility_ms": 0,
      "payload_ms": 0,
      "transaction_ms": 0,
      "total_ms": 0
    }
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`409`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `GET` `/api/import-review/promotion/batches/{id}`

**Summary:** Get one publish batch with item counts

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {
    "id": "string",
    "public_id": "string",
    "batch_name": "string",
    "status": "string",
    "derived_status": "string",
    "total_item_count": 0,
    "success_count": 0,
    "failed_count": 0,
    "skipped_count": 0,
    "core_verified_count": 0,
    "import_review_marked_promoted_count": 0,
    "inserted_count": 0,
    "updated_count": 0,
    "created_at": "2026-01-01T00:00:00.000Z",
    "derived_status_reason": "string",
    "stored_status_recommendation": "string",
    "status_note": "string",
    "source_review_batch_id": "string",
    "source_snapshot_version": "string",
    "region_code": "string",
    "note": "string",
    "published_at": "2026-01-01T00:00:00.000Z",
    "promoted_at": "2026-01-01T00:00:00.000Z",
    "item_counts": {
      "pending": 0,
      "success": 0,
      "failed": 0,
      "skipped": 0,
      "rolled_back": 0,
      "total": 0
    },
    "building_item_counts": {
      "pending": 0,
      "success": 0,
      "failed": 0,
      "skipped": 0,
      "rolled_back": 0,
      "total": 0
    },
    "item_counts_by_entity_family": {}
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `POST` `/api/import-review/promotion/batches/{id}/cancel-current-stage`

**Summary:** Cancel the in-flight publish batch stage

Stops validation or promotion at the next chunk checkpoint. Does not delete publish_items or promote anything.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Responses**

- **`202`**

  ```json
  {
    "batch_id": "string",
    "action": "string",
    "status": "string",
    "message": "string"
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`409`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `POST` `/api/import-review/promotion/batches/{id}/cancel-promotion`

**Summary:** Request cancel of in-flight publish batch promotion

Sets promotion_cancel_requested_at in batch summary while status=promoting. Stops at the next checkpoint; if the worker is not responding, finalizes immediately.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Responses**

- **`202`**

  ```json
  {
    "batch_id": "string",
    "status": "string",
    "message": "string"
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`409`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `POST` `/api/import-review/promotion/batches/{id}/cancel-validation`

**Summary:** Request cancel of in-flight publish batch validation

Sets validation_cancel_requested_at while status=validating. Stops at the next checkpoint; if the worker is not responding, finalizes the batch as cancelled immediately.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Responses**

- **`202`**

  ```json
  {
    "batch_id": "string",
    "status": "string",
    "message": "string"
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`409`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `POST` `/api/import-review/promotion/batches/{id}/dry-run`

**Summary:** Dry-run publish batch (no core writes)

Checks pending ready items for insert/update targets. Persists summary.dry_run_result (passed|failed). Does not write to core or change publish_status.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Request body** (`application/json`)

```json
{
  "confirm_large_batch": false
}
```

**Responses**

- **`200`**

  ```json
  {
    "status": "passed",
    "batch_id": 0,
    "entity_family": "string",
    "total": 0,
    "ready_count": 0,
    "blocked_count": 0,
    "failed_count": 0,
    "would_insert_count": 0,
    "would_update_count": 0,
    "duplicate_fixed_count": 0,
    "duplicate_blocked_count": 0,
    "duplicate_samples": [
      {
        "candidate_id": 0,
        "action": "converted_to_update",
        "message": "string",
        "external_id": null,
        "core_street_id": null
      }
    ],
    "sample_errors": [
      {
        "candidate_id": null,
        "external_id": null,
        "code": "string",
        "message": "string"
      }
    ],
    "summary": {}
  }
  ```

- **`400`**

  ```json
  {
    "status": "passed",
    "batch_id": 0,
    "entity_family": "string",
    "total": 0,
    "ready_count": 0,
    "blocked_count": 0,
    "failed_count": 0,
    "would_insert_count": 0,
    "would_update_count": 0,
    "duplicate_fixed_count": 0,
    "duplicate_blocked_count": 0,
    "duplicate_samples": [
      {
        "candidate_id": 0,
        "action": "converted_to_update",
        "message": "string",
        "external_id": null,
        "core_street_id": null
      }
    ],
    "sample_errors": [
      {
        "candidate_id": null,
        "external_id": null,
        "code": "string",
        "message": "string"
      }
    ],
    "summary": {}
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`409`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "status": "passed",
    "batch_id": 0,
    "entity_family": "string",
    "total": 0,
    "ready_count": 0,
    "blocked_count": 0,
    "failed_count": 0,
    "would_insert_count": 0,
    "would_update_count": 0,
    "duplicate_fixed_count": 0,
    "duplicate_blocked_count": 0,
    "duplicate_samples": [
      {
        "candidate_id": 0,
        "action": "converted_to_update",
        "message": "string",
        "external_id": null,
        "core_street_id": null
      }
    ],
    "sample_errors": [
      {
        "candidate_id": null,
        "external_id": null,
        "code": "string",
        "message": "string"
      }
    ],
    "summary": {}
  }
  ```

#### `GET` `/api/import-review/promotion/batches/{id}/logs`

**Summary:** List publish batch validation or promotion stage logs

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {
    "batch_id": "string",
    "items": [
      {
        "id": "string",
        "stage_key": "string",
        "stage_label": "string",
        "stage_status": "pending",
        "progress_percent": 0,
        "started_at": "2026-01-01T00:00:00.000Z",
        "message": "string",
        "details": null,
        "finished_at": "2026-01-01T00:00:00.000Z"
      }
    ]
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `GET` `/api/import-review/promotion/batches/{id}/progress`

**Summary:** Get publish batch validation or promotion progress

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {
    "batch_id": "string",
    "status": "string",
    "derived_status": "string",
    "derived_status_reason": "string",
    "stored_status_recommendation": "string",
    "status_note": "string",
    "workflow": "validation",
    "validation_total": 0,
    "validation_done": 0,
    "validation_percent": 0,
    "total_item_count": 0,
    "item_processed_count": 0,
    "stage_count": 0,
    "validated_at": "2026-01-01T00:00:00.000Z",
    "current_stage_key": "string",
    "current_stage_label": "string",
    "current_stage_status": "string",
    "current_entity_family": "string",
    "current_message": "string",
    "validation_result": {
      "outcome": "passed",
      "can_promote": false,
      "requires_warning_confirmation": false,
      "valid_count": 0,
      "warning_count": 0,
      "blocked_count": 0,
      "skipped_count": 0,
      "total_items": 0,
      "by_publish_action": {
        "insert": 0,
        "update": 0,
        "merge": 0
      },
      "by_entity": {},
      "promotable_entity_families": [
        "string"
      ],
      "ready_count": 0,
      "promotable_count": 0,
      "total_count": 0,
      "entity_family": {
        "buildings": 0
      }
    },
    "validation_logs_summary": "string",
    "promotion_result": {
      "status": "promoted",
      "inserted_count": 0,
      "updated_count": 0,
      "success_count": 0,
      "failed_count": 0,
      "skipped_count": 0,
      "total": 0,
      "core_verified_count": 0,
      "import_review_marked_promoted_count": 0,
      "verification_metadata_applied_count": 0,
      "verification_metadata_skipped_already_verified_count": 0,
      "started_at": "2026-01-01T00:00:00.000Z",
      "finished_at": "2026-01-01T00:00:00.000Z",
      "duration_ms": 0,
      "promoted_entity_families": [
        "string"
      ],
      "promoted_count": 0,
      "skipped_blocked_count": 0,
      "skipped_warning_count": 0,
      "partial_promotion": false,
      "partial_success": false
    },
    "promotion_logs_summary": "string",
    "validation_heartbeat_at": "2026-01-01T00:00:00.000Z",
    "validation_cancel_requested_at": "2026-01-01T00:00:00.000Z",
    "validation_heartbeat_stale_warning": false,
    "promotion_heartbeat_at": "2026-01-01T00:00:00.000Z",
    "promotion_heartbeat_stale_warning": false,
    "…": "(more fields — see OpenAPI spec)"
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `POST` `/api/import-review/promotion/batches/{id}/promote`

**Summary:** Promote validated publish batch to core (buildings and places)

Writes approved building and place candidates to core.core_buildings and core.core_places (including place names and sources). Returns 202 immediately; poll progress and logs endpoints.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Request body** (`application/json`)

```json
{
  "confirmation_text": "PROMOTE",
  "chunk_size": 0,
  "confirm_warnings": false,
  "allow_high_risk_families": false,
  "confirm_large_batch": false,
  "warning_confirmation_note": "string"
}
```

**Responses**

- **`202`**

  ```json
  {
    "batch_id": "string",
    "status": "string",
    "message": "string"
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`409`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `POST` `/api/import-review/promotion/batches/{id}/reset-dry-run`

**Summary:** Clear publish batch dry-run result

Removes summary.dry_run_result only. Keeps per-item validation_result.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {
    "batch_id": "string",
    "action": "string",
    "status": "string",
    "message": "string"
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`409`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `POST` `/api/import-review/promotion/batches/{id}/reset-promotion`

**Summary:** Reset stuck publish batch promotion worker state

Fails running promotion stage logs and returns batch to ready/partially_promoted when the worker is not in-process. Does not delete publish items.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Responses**

- **`202`**

  ```json
  {
    "batch_id": "string",
    "status": "string",
    "message": "string"
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`409`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `POST` `/api/import-review/promotion/batches/{id}/reset-promotion-failures`

**Summary:** Reset failed unpromoted publish items for retry

Sets failed publish items back to pending and releases candidates for retry. Never changes publish_status=success or unpromotes core rows.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {
    "batch_id": "string",
    "action": "string",
    "status": "string",
    "message": "string"
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`409`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `POST` `/api/import-review/promotion/batches/{id}/reset-validation`

**Summary:** Reset publish batch validation state to draft

Clears per-item validation_result and batch validation counters. Does not delete publish items. Not allowed on promoted batches.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {
    "batch_id": "string",
    "status": "string",
    "message": "string"
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`409`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `POST` `/api/import-review/promotion/batches/{id}/resume`

**Summary:** Resume the current publish batch pipeline stage

Continues validation (skipping items with validation_result), dry-run, or promotion for remaining promotable items. Returns already_complete when nothing is left to do.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {
    "batch_id": "string",
    "action": "string",
    "status": "string",
    "message": "string"
  }
  ```

- **`202`**

  ```json
  {
    "batch_id": "string",
    "action": "string",
    "status": "string",
    "message": "string"
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`409`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `POST` `/api/import-review/promotion/batches/{id}/retry-failed-ready`

**Summary:** Create retry publish batch from failed ready items

Creates a new draft publish batch from publish items on the source batch that failed promotion but had validation_result.status=ready. Does not modify the source batch. User must validate the new batch before promotion.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Request body** (`application/json`)

```json
{
  "batch_name": "string",
  "note": "string",
  "confirm_large_batch": false,
  "allow_high_risk_families": false,
  "mixed_high_risk_confirm": false
}
```

**Responses**

- **`201`**

  ```json
  {
    "id": 0,
    "public_id": "string",
    "review_batch_id": 0,
    "source_publish_batch_id": "string",
    "failed_ready_source_count": 0,
    "failed_ready_retry_count": 0,
    "total_item_count": 0,
    "message": "string",
    "batch_id": "string",
    "publish_batch_id": "string",
    "batch": {
      "id": "string",
      "public_id": "string",
      "batch_name": "string",
      "status": "string",
      "derived_status": "string",
      "total_item_count": 0,
      "success_count": 0,
      "failed_count": 0,
      "skipped_count": 0,
      "core_verified_count": 0,
      "import_review_marked_promoted_count": 0,
      "inserted_count": 0,
      "updated_count": 0,
      "created_at": "2026-01-01T00:00:00.000Z",
      "derived_status_reason": "string",
      "stored_status_recommendation": "string",
      "status_note": "string",
      "source_review_batch_id": "string",
      "source_snapshot_version": "string",
      "region_code": "string",
      "note": "string",
      "published_at": "2026-01-01T00:00:00.000Z",
      "promoted_at": "2026-01-01T00:00:00.000Z",
      "item_counts": {
        "pending": 0,
        "success": 0,
        "failed": 0,
        "skipped": 0,
        "rolled_back": 0,
        "total": 0
      },
      "building_item_counts": {
        "pending": 0,
        "success": 0,
        "failed": 0,
        "skipped": 0,
        "rolled_back": 0,
        "total": 0
      },
      "item_counts_by_entity_family": {}
    },
    "count_by_family": {}
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`409`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `GET` `/api/import-review/promotion/batches/{id}/road-dry-run`

**Summary:** Get cached road promotion dry-run result

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {
    "batch_id": "string",
    "road_dry_run": {
      "status": "passed",
      "checked_count": 0,
      "passed_count": 0,
      "failed_count": 0,
      "sample_errors": [
        {
          "publish_item_id": "string",
          "code": "string",
          "message": "string",
          "review_candidate_id": "string",
          "external_id": "string"
        }
      ],
      "ran_at": "2026-01-01T00:00:00.000Z"
    },
    "routing_readiness_validation": {
      "status": "passed",
      "type": "db_routing_readiness",
      "checked_count": 0,
      "failed_count": 0,
      "warning_count": 0,
      "sample_errors": [
        {
          "publish_item_id": "string",
          "code": "string",
          "message": "string",
          "review_candidate_id": "string",
          "external_id": "string"
        }
      ],
      "sample_warnings": [
        {
          "publish_item_id": "string",
          "code": "string",
          "message": "string",
          "review_candidate_id": "string",
          "external_id": "string"
        }
      ],
      "ran_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

- **`400`**

  ```json
  {
    "message": "string"
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `POST` `/api/import-review/promotion/batches/{id}/road-dry-run`

**Summary:** Run road promotion dry-run for a publish batch

Evaluates pending ready road publish items with road dry-run and DB routing-readiness validation (no Valhalla). Persists summary.road_dry_run and summary.routing_readiness_validation. Does not write to core.core_streets.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Request body** (`application/json`)

```json
{
  "include_warnings": false,
  "revalidate": false,
  "connectivity_threshold_m": 0,
  "duplicate_threshold_m": 0
}
```

**Responses**

- **`200`**

  ```json
  {
    "batch_id": "string",
    "road_dry_run": {
      "status": "passed",
      "checked_count": 0,
      "passed_count": 0,
      "failed_count": 0,
      "sample_errors": [
        {
          "publish_item_id": "string",
          "code": "string",
          "message": "string",
          "review_candidate_id": "string",
          "external_id": "string"
        }
      ],
      "ran_at": "2026-01-01T00:00:00.000Z"
    },
    "routing_readiness_validation": {
      "status": "passed",
      "type": "db_routing_readiness",
      "checked_count": 0,
      "failed_count": 0,
      "warning_count": 0,
      "sample_errors": [
        {
          "publish_item_id": "string",
          "code": "string",
          "message": "string",
          "review_candidate_id": "string",
          "external_id": "string"
        }
      ],
      "sample_warnings": [
        {
          "publish_item_id": "string",
          "code": "string",
          "message": "string",
          "review_candidate_id": "string",
          "external_id": "string"
        }
      ],
      "ran_at": "2026-01-01T00:00:00.000Z"
    }
  }
  ```

- **`400`**

  ```json
  {
    "message": "string"
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`409`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `GET` `/api/import-review/promotion/batches/{id}/routing-barrier-dry-run`

**Summary:** Get cached routing barrier promotion dry-run result

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {
    "batch_id": "string",
    "review_batch_id": "string",
    "total_count": 0,
    "safe_to_promote_count": 0,
    "promote_with_warning_count": 0,
    "needs_manual_review_count": 0,
    "blocked_count": 0,
    "warning_count": 0,
    "error_count": 0,
    "duplicate_risk_count": 0,
    "network_warning_count": 0,
    "would_insert_count": 0,
    "would_update_count": 0,
    "by_warning_code": {},
    "by_error_code": {},
    "by_barrier_type": {},
    "sample_blocked_items": [
      {}
    ],
    "sample_warning_items": [
      {}
    ],
    "disabled_because_env_flag_false": false,
    "items": [
      {}
    ],
    "finished_at": "string",
    "message": "string"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string"
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `POST` `/api/import-review/promotion/batches/{id}/routing-barrier-dry-run`

**Summary:** Run routing barrier promotion dry-run for a publish batch

Evaluates routing barrier publish items with blocking checks and network impact warnings. Does not write routing graph rows.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Request body** (`application/json`)

```json
{
  "include_warnings": false,
  "revalidate": false,
  "nearby_core_road_threshold_m": 0,
  "nearby_review_road_threshold_m": 0,
  "duplicate_threshold_m": 0
}
```

**Responses**

- **`200`**

  ```json
  {
    "batch_id": "string",
    "review_batch_id": "string",
    "total_count": 0,
    "safe_to_promote_count": 0,
    "promote_with_warning_count": 0,
    "needs_manual_review_count": 0,
    "blocked_count": 0,
    "warning_count": 0,
    "error_count": 0,
    "duplicate_risk_count": 0,
    "network_warning_count": 0,
    "would_insert_count": 0,
    "would_update_count": 0,
    "by_warning_code": {},
    "by_error_code": {},
    "by_barrier_type": {},
    "sample_blocked_items": [
      {}
    ],
    "sample_warning_items": [
      {}
    ],
    "disabled_because_env_flag_false": false,
    "items": [
      {}
    ],
    "finished_at": "string",
    "message": "string"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string"
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `POST` `/api/import-review/promotion/batches/{id}/validate`

**Summary:** Start publish batch validation (multi-family)

Validates publish items across supported entity families without writing to core. Returns 202 immediately; poll progress and logs endpoints. Batches with more than 50 items that include high-risk families (roads, addresses, admin_areas, routing_barriers) require allow_high_risk_families=true. Batches over 200 items also require confirm_large_batch=true.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Request body** (`application/json`)

```json
{
  "confirm_large_batch": false,
  "allow_high_risk_families": false,
  "mixed_high_risk_confirm": false
}
```

**Responses**

- **`202`**

  ```json
  {
    "batch_id": "string",
    "status": "string",
    "message": "string"
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`409`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `GET` `/api/import-review/promotion/batches/{id}/verify`

**Summary:** Verify publish batch promotion results

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {
    "batch_id": "string",
    "verification_status": "passed",
    "publish_items": {
      "success": 0,
      "failed": 0,
      "pending": 0,
      "skipped": 0,
      "success_missing_target_id": 0
    },
    "core_rows_missing": 0,
    "core_rows_inactive": 0,
    "candidates_promoted_missing_core_id": 0,
    "lineage_warnings": 0,
    "geometry_warnings": 0,
    "issues": [
      {
        "code": "string",
        "message": "string",
        "severity": "error"
      }
    ]
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `POST` `/api/import-review/promotion/batches/repair-invalid-promoted`

**Summary:** Repair invalid empty promoted publish batches

Finds publish batches stored as promoted with no successful promotion/verification, downgrades status to failed/blocked, and persists derived_status metadata into summary JSONB.

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Request body** (`application/json`)

```json
{
  "batch_id": "string",
  "review_batch_id": "string"
}
```

**Responses**

- **`200`**

  ```json
  {
    "scanned": 0,
    "repaired": 0,
    "skipped": 0,
    "batches": [
      {
        "id": "string",
        "previous_status": "string",
        "new_status": "string",
        "derived_status": "string"
      }
    ],
    "message": "string"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string"
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `GET` `/api/import-review/promotion/eligibility`

**Summary:** Promotion eligibility for checkbox-selected entity families

Read-only approximate per-family counts from import_review candidate tables (no candidate updates or validation runs). Requires explicit families query (comma-separated).

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| review_batch_id | Query | yes | string |
| families | Query | yes | string |
| include_warnings | Query | no | boolean |


**Responses**

- **`200`**

  ```json
  {
    "review_batch_id": 0,
    "families": [
      {
        "family": "string",
        "label": "string",
        "risk_level": "normal",
        "target": "string",
        "counts_ok": false,
        "count_error": {
          "ok": false,
          "code": "string",
          "message": "string"
        },
        "approved_count": 0,
        "ready_existing_count": 0,
        "blocked_existing_count": 0,
        "warning_existing_count": 0,
        "already_batched_count": 0,
        "already_promoted_count": 0,
        "ready_now": 0,
        "retry_needed": 0,
        "active_locked": 0,
        "stale_locked": 0,
        "ready": 0,
        "warnings": 0,
        "blocked": 0,
        "batched": 0,
        "promoted": 0
      }
    ],
    "totals": {
      "ready_now": 0,
      "retry_needed": 0,
      "active_locked": 0,
      "stale_locked": 0,
      "promoted": 0,
      "ready": 0,
      "warnings": 0,
      "blocked": 0,
      "batched": 0
    },
    "has_high_risk": false,
    "can_create_batch": false,
    "messages": [
      "string"
    ]
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`409`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`503`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `GET` `/api/import-review/promotion/eligibility/details`

**Summary:** Promotion eligibility candidate details for a family bucket

Paginated candidates for ready, warnings, blocked, batched, or promoted buckets. Uses the same bucket rules as GET /promotion/eligibility.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| review_batch_id | Query | yes | string |
| family | Query | yes | string |
| bucket | Query | yes | string |
| include_warnings | Query | no | boolean |
| limit | Query | no | integer |
| offset | Query | no | integer |
| search | Query | no | string |
| reason_code | Query | no | string |
| sort_by | Query | no | string |
| sort_order | Query | no | string |


**Responses**

- **`200`**

  ```json
  {
    "review_batch_id": 0,
    "family": "string",
    "bucket": "ready",
    "target": "string",
    "total": 0,
    "limit": 0,
    "offset": 0,
    "items": [
      {
        "id": 0,
        "external_id": "string",
        "display_name": "string",
        "match_status": "string",
        "auto_action": "string",
        "review_status": "string",
        "review_decision": "string",
        "promotion_status": "string",
        "confidence_score": 0,
        "reason_codes": [
          "string"
        ],
        "reason_messages": [
          "string"
        ],
        "validation_errors": null,
        "validation_warnings": null,
        "target": "string",
        "publish_batch_id": 0,
        "publish_batch_status": "string",
        "promoted_core_id": 0,
        "created_at": "2026-01-01T00:00:00.000Z",
        "updated_at": "2026-01-01T00:00:00.000Z"
      }
    ]
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`409`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `GET` `/api/import-review/promotion/ready`

**Summary:** Count building candidates ready for publish batching

Server-side readiness counts for approved import_review.building_candidates. No core writes.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| source_snapshot_version | Query | no | string |
| snapshot_version | Query | no | string |
| review_batch_id | Query | no | string |
| latest | Query | no | boolean |
| include_merged | Query | no | boolean |


**Responses**

- **`200`**

  ```json
  {
    "entity_family": "buildings",
    "review_batch_id": "string",
    "source_snapshot_version": "string",
    "ready_count": 0,
    "already_batched_count": 0,
    "promoted_count": 0,
    "blocked_in_active_publish_batch_count": 0
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`409`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `GET` `/api/import-review/promotion/ready-candidates`

**Summary:** List building candidates ready for publish batch preview

Paginated preview of approved building candidates eligible for publish batching. No core writes.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| source_snapshot_version | Query | no | string |
| snapshot_version | Query | no | string |
| review_batch_id | Query | no | string |
| latest | Query | no | boolean |
| include_merged | Query | no | boolean |
| entity_family | Query | no | string |
| limit | Query | no | integer |
| offset | Query | no | integer |
| sort | Query | no | string |
| include_geometry | Query | no | boolean |


**Responses**

- **`200`**

  ```json
  {
    "items": [
      {
        "id": "string",
        "public_id": "string",
        "validation_warnings_count": 0,
        "validation_errors_count": 0,
        "updated_at": "2026-01-01T00:00:00.000Z",
        "source_snapshot_version": "string",
        "review_batch_id": "string",
        "external_id": "string",
        "name": "string",
        "canonical_name": "string",
        "class_code": "string",
        "building_type": "string",
        "building_type_id": "string",
        "building_type_code": "string",
        "building_type_name": "string",
        "confidence_score": 0,
        "match_status": "string",
        "auto_action": "string",
        "review_status": "string",
        "review_decision": "string",
        "promotion_status": "string",
        "normalized_data": null,
        "source_refs": null,
        "geometry": {}
      }
    ],
    "total": 0,
    "limit": 0,
    "offset": 0,
    "counts": {
      "ready": 0,
      "already_batched": 0,
      "promoted": 0,
      "blocked_active_batch": 0
    }
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`409`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `POST` `/api/import-review/promotion/release-stale-batched`

**Summary:** Release stale batched import-review candidates

Safely moves candidates stuck in promotion_status=batched back to not_ready when their latest publish item failed on a closed batch (status failed or partial only). Never releases candidates tied to draft, validating, ready, dry_run_passed, or promoting batches.

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Request body** (`application/json`)

```json
{
  "review_batch_id": 0,
  "families": [
    "string"
  ],
  "dry_run": false
}
```

**Responses**

- **`200`**

  ```json
  {
    "status": "success",
    "dry_run": false,
    "review_batch_id": "string",
    "released_total": 0,
    "by_family": [
      {
        "entity_family": "string",
        "eligible_count": 0,
        "released_count": 0
      }
    ],
    "samples": [
      {
        "entity_family": "string",
        "candidate_id": "string",
        "publish_batch_id": null,
        "publish_item_id": null,
        "publish_status": null,
        "batch_status": null
      }
    ]
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `GET` `/api/import-review/reference-options`

**Summary:** Reference dropdown options for import-review override editors

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Responses**

- **`200`**

  ```json
  {
    "ref_poi_categories": [
      {
        "id": "string",
        "code": "string",
        "name": "string"
      }
    ],
    "ref_road_classes": [
      {
        "id": "string",
        "code": "string",
        "name": "string"
      }
    ],
    "ref_building_types": [
      {
        "id": "string",
        "code": "string",
        "name": "string"
      }
    ],
    "ref_admin_levels": [
      {
        "id": "string",
        "code": "string",
        "name": "string"
      }
    ],
    "ref_address_component_types": [
      {
        "id": "string",
        "code": "string",
        "name": "string"
      }
    ],
    "ref_source_types": [
      {
        "id": "string",
        "code": "string",
        "name": "string"
      }
    ],
    "core_admin_areas": [
      {
        "id": "string",
        "code": "string",
        "name": "string"
      }
    ]
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `GET` `/api/import-review/roads`

**Summary:** List import-review road candidates

Paginated `import_review.road_candidates` within the resolved batch/source snapshot.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| source_snapshot_version | Query | no | string |
| snapshot_version | Query | no | string |
| review_batch_id | Query | no | string |
| latest | Query | no | boolean |
| match_status | Query | no | string |
| auto_action | Query | no | string |
| review_status | Query | no | string |
| review_decision | Query | no | string |
| q | Query | no | string |
| limit | Query | no | integer |
| offset | Query | no | integer |
| sort | Query | no | string |
| include_geometry | Query | no | boolean |
| include_total | Query | no | boolean |
| promotion_status | Query | no | string |
| class_code | Query | no | string |
| include_promoted | Query | no | boolean |


**Responses**

- **`200`**

  ```json
  {
    "source_snapshot_version": "string",
    "review_batch_id": "string",
    "source_snapshot_id_local": "string",
    "items": [
      {
        "id": "string",
        "public_id": "string",
        "review_batch_id": "string",
        "source_snapshot_version": "string",
        "local_staging_id": "string",
        "source_snapshot_id_local": "string",
        "external_id": "string",
        "canonical_name": "string",
        "name": "string",
        "class_code": "string",
        "building_type": "string",
        "building_type_id": "string",
        "admin_area_id": "string",
        "levels": 0,
        "height_m": 0,
        "area_m2": 0,
        "confidence_score": 0,
        "match_status": "string",
        "auto_action": "string",
        "review_status": "string",
        "review_decision": "string",
        "reviewed_by": "string",
        "reviewed_at": "2026-01-01T00:00:00.000Z",
        "review_note": "string",
        "normalized_data": null,
        "source_refs": null,
        "matched_core_id": "string",
        "matched_core_table": "string",
        "…": "(more fields — see OpenAPI spec)"
      }
    ],
    "has_more": false,
    "limit": 0,
    "offset": 0,
    "batch_name": "string",
    "selected_by": "review_batch_id",
    "status": "string",
    "uploaded_at": "2026-01-01T00:00:00.000Z",
    "total_candidate_count": 0,
    "entity_families": [
      "string"
    ],
    "total": 0
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`409`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `PATCH` `/api/import-review/roads/{id}/decision`

**Summary:** Set import-review road decision

Updates road candidate review columns. manual_protected and duplicate_candidate follow building rules. match_status=matched_auto_update approve requires confirm_matched_auto_update=true or force=true.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Request body** (`application/json`)

```json
{
  "review_decision": "approved",
  "source_snapshot_version": "string",
  "snapshot_version": "string",
  "review_batch_id": "string",
  "latest": false,
  "review_note": "string",
  "force": false,
  "confirm_duplicate_reviewed": false,
  "confirm_matched_auto_update": false,
  "confirm_routing_warnings": false
}
```

**Responses**

- **`200`**

  ```json
  {
    "id": "string",
    "public_id": "string",
    "review_batch_id": "string",
    "source_snapshot_version": "string",
    "local_staging_id": "string",
    "source_snapshot_id_local": "string",
    "external_id": "string",
    "canonical_name": "string",
    "name": "string",
    "class_code": "string",
    "building_type": "string",
    "building_type_id": "string",
    "admin_area_id": "string",
    "levels": 0,
    "height_m": 0,
    "area_m2": 0,
    "confidence_score": 0,
    "match_status": "string",
    "auto_action": "string",
    "review_status": "string",
    "review_decision": "string",
    "reviewed_by": "string",
    "reviewed_at": "2026-01-01T00:00:00.000Z",
    "review_note": "string",
    "normalized_data": null,
    "source_refs": null,
    "matched_core_id": "string",
    "matched_core_table": "string",
    "…": "(more fields — see OpenAPI spec)"
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`409`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `PATCH` `/api/import-review/roads/{id}/overrides`

**Summary:** Patch import_review road overrides (routing-safe)

Validates LineString/MultiLineString geometry, ref road class FK, surface text, and routing continuity warnings before updating typed columns on `import_review.road_candidates`.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Request body** (`application/json`)

```json
{
  "fields": {},
  "source_snapshot_version": "string",
  "snapshot_version": "string",
  "review_batch_id": "string",
  "latest": false,
  "review_note": "string",
  "routing_validation_tolerance_meters": 0,
  "confirm_acknowledge_routing_warnings": false
}
```

**Responses**

- **`200`**

  ```json
  {
    "id": "string",
    "public_id": "string",
    "review_batch_id": "string",
    "source_snapshot_version": "string",
    "local_staging_id": "string",
    "source_snapshot_id_local": "string",
    "external_id": "string",
    "canonical_name": "string",
    "name": "string",
    "class_code": "string",
    "building_type": "string",
    "building_type_id": "string",
    "admin_area_id": "string",
    "levels": 0,
    "height_m": 0,
    "area_m2": 0,
    "confidence_score": 0,
    "match_status": "string",
    "auto_action": "string",
    "review_status": "string",
    "review_decision": "string",
    "reviewed_by": "string",
    "reviewed_at": "2026-01-01T00:00:00.000Z",
    "review_note": "string",
    "normalized_data": null,
    "source_refs": null,
    "matched_core_id": "string",
    "matched_core_table": "string",
    "…": "(more fields — see OpenAPI spec)"
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`409`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `POST` `/api/import-review/roads/{id}/validate-routing`

**Summary:** Validate import-review road for routing

Runs geometry, attribute, connectivity, duplicate, and promotion-readiness checks. Persists validation_errors / validation_warnings on import_review.road_candidates only (no core promotion).

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Request body** (`application/json`)

```json
{
  "source_snapshot_version": "string",
  "snapshot_version": "string",
  "review_batch_id": "string",
  "latest": false,
  "connectivity_threshold_m": 0,
  "duplicate_threshold_m": 0,
  "confirm_warnings": false
}
```

**Responses**

- **`200`**

  ```json
  {
    "candidate_id": "string",
    "validation_mode": "existing_region",
    "can_save": false,
    "can_approve": false,
    "errors": [
      {
        "code": "string",
        "message": "string",
        "severity": "error"
      }
    ],
    "warnings": [
      {
        "code": "string",
        "message": "string",
        "severity": "error"
      }
    ],
    "stats": {
      "nearby_core_roads": 0,
      "nearby_review_roads": 0,
      "connected_endpoints": 0,
      "isolated_endpoints": 0,
      "possible_duplicates": 0,
      "possible_unsplit_intersections": 0,
      "length_m": 0
    },
    "info": [
      {
        "code": "string",
        "message": "string",
        "severity": "error"
      }
    ]
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `POST` `/api/import-review/roads/bulk-decision`

**Summary:** Bulk import-review road decisions

Bulk updates road candidates (or dry_run). Same scope rules as buildings.

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Request body** (`application/json`)

```json
{
  "review_decision": "approved",
  "source_snapshot_version": "string",
  "snapshot_version": "string",
  "review_batch_id": "string",
  "latest": false,
  "review_status": "approved",
  "review_note": "string",
  "force": false,
  "force_approval": false,
  "dry_run": false,
  "ids": [
    0
  ],
  "filters": {
    "match_status": "string",
    "auto_action": "string",
    "review_decision": "string"
  }
}
```

**Responses**

- **`200`**

  ```json
  {
    "source_snapshot_version": "string",
    "review_batch_id": "string",
    "source_snapshot_id_local": "string",
    "success": false,
    "updated_count": 0,
    "skipped_count": 0,
    "skipped_reasons": [
      {
        "reason": "string",
        "count": 0
      }
    ],
    "dry_run": false,
    "batch_name": "string",
    "selected_by": "review_batch_id",
    "status": "string",
    "uploaded_at": "2026-01-01T00:00:00.000Z",
    "total_candidate_count": 0,
    "entity_families": [
      "string"
    ],
    "updated_ids": [
      0
    ]
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`409`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `GET` `/api/import-review/roads/dry-run-summary`

**Summary:** Road dry-run summary for a review batch

Returns the latest publish-batch road dry-run result indexed by review_candidate_id for the scoped review batch.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| source_snapshot_version | Query | no | string |
| snapshot_version | Query | no | string |
| review_batch_id | Query | no | string |
| latest | Query | no | boolean |


**Responses**

- **`200`**

  ```json
  {}
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`409`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

#### `GET` `/api/import-review/summary`

**Summary:** Import review candidate summary

Grouped counts over `import_review.*` candidates for the resolved review batch (`DATABASE_URL`, optional `IMPORT_REVIEW_DATABASE_URL` override). Supply exactly one of `source_snapshot_version` (alias: `snapshot_version`) or `review_batch_id`. When both are sent, `review_batch_id` is preferred.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| source_snapshot_version | Query | no | string |
| snapshot_version | Query | no | string |
| review_batch_id | Query | no | string |
| latest | Query | no | boolean |


**Responses**

- **`200`**

  ```json
  {
    "source_snapshot_version": "string",
    "review_batch_id": "string",
    "source_snapshot_id_local": "string",
    "entity_summaries": [
      {
        "entity_family": "string",
        "review_batch_id": "string",
        "source_snapshot_version": "string",
        "match_status": "string",
        "auto_action": "string",
        "review_status": "string",
        "review_decision": "string",
        "promotion_status": "string",
        "row_count": 0
      }
    ],
    "family_summaries": [
      {
        "entity_family": "string",
        "table_name": "string",
        "batch_total": 0,
        "active": 0,
        "pending_review": 0,
        "approved": 0,
        "rejected": 0,
        "needs_review": 0,
        "ignored": 0,
        "merged": 0,
        "ready_for_publish": 0,
        "promoted": 0,
        "promotion_failed": 0,
        "validation_error_count": 0,
        "validation_warning_count": 0
      }
    ],
    "rollup": {
      "batch_total_candidates": 0,
      "active_candidates": 0,
      "pending_review_candidates": 0,
      "approved_candidates": 0,
      "rejected_candidates": 0,
      "needs_review_candidates": 0,
      "ignored_candidates": 0,
      "merged_candidates": 0,
      "ready_for_publish_candidates": 0,
      "promoted_candidates": 0,
      "promotion_failed_candidates": 0
    },
    "total_pending_review_count": 0,
    "total_approved_count": 0,
    "total_rejected_count": 0,
    "batch_name": "string",
    "selected_by": "review_batch_id",
    "status": "string",
    "uploaded_at": "2026-01-01T00:00:00.000Z",
    "total_candidate_count": 0,
    "entity_families": [
      "string"
    ],
    "warnings": [
      "string"
    ]
  }
  ```

- **`400`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`409`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

- **`500`**

  ```json
  {
    "ok": false,
    "error": "string",
    "message": "string",
    "details": null
  }
  ```

### core-review

#### `GET` `/core-review/{entity}`

**Summary:** List core schema entities (paginated)

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| page | Query | no | integer |
| pageSize | Query | no | integer |
| search | Query | no | string |
| sortBy | Query | no | string |
| sortOrder | Query | no | string |
| verification_status | Query | no | string |
| isVerified | Query | no | boolean |
| verificationStatus | Query | no | string |
| adminAreaId | Query | no | string |
| categoryId | Query | no | string |
| buildingTypeId | Query | no | string |
| roadClassId | Query | no | string |
| isPublic | Query | no | boolean |
| status | Query | no | string |
| includeDeleted | Query | no | boolean |
| routeId | Query | no | string |
| includeTotal | Query | no | boolean |
| include_total | Query | no | boolean |
| cursorUpdatedAt | Query | no | string |
| cursorId | Query | no | string |
| entity | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {
    "data": [
      {}
    ],
    "pagination": {
      "page": 0,
      "pageSize": 0,
      "total": null,
      "totalPages": null
    },
    "filters": {},
    "meta": {}
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "message": "string"
  }
  ```

#### `POST` `/core-review/{entity}`

**Summary:** Create core schema entity

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| entity | Path | yes | string |


**Request body** (`application/json`)

```json
{}
```

**Responses**

- **`200`**

  ```json
  {
    "data": {}
  }
  ```

- **`201`**

  ```json
  {
    "data": {}
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/core-review/{entity}/{id}`

**Summary:** Get core schema entity by id

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| entity | Path | yes | string |
| id | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {
    "data": {}
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "message": "string"
  }
  ```

#### `PATCH` `/core-review/{entity}/{id}`

**Summary:** Update core schema entity

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| entity | Path | yes | string |
| id | Path | yes | string |


**Request body** (`application/json`)

```json
{}
```

**Responses**

- **`200`**

  ```json
  {
    "data": {}
  }
  ```

- **`201`**

  ```json
  {
    "data": {}
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "message": "string"
  }
  ```

#### `PATCH` `/core-review/{entity}/{id}/restore`

**Summary:** Restore soft-deleted core schema entity

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| entity | Path | yes | string |
| id | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {
    "data": {}
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "message": "string"
  }
  ```

#### `PATCH` `/core-review/{entity}/{id}/soft-delete`

**Summary:** Soft-delete core schema entity

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| entity | Path | yes | string |
| id | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {
    "data": {}
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/core-review/{entity}/count`

**Summary:** Count core-review streets for current filters (may be slow)

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| page | Query | no | integer |
| pageSize | Query | no | integer |
| search | Query | no | string |
| sortBy | Query | no | string |
| sortOrder | Query | no | string |
| verification_status | Query | no | string |
| isVerified | Query | no | boolean |
| verificationStatus | Query | no | string |
| adminAreaId | Query | no | string |
| categoryId | Query | no | string |
| buildingTypeId | Query | no | string |
| roadClassId | Query | no | string |
| isPublic | Query | no | boolean |
| status | Query | no | string |
| includeDeleted | Query | no | boolean |
| routeId | Query | no | string |
| includeTotal | Query | no | boolean |
| include_total | Query | no | boolean |
| cursorUpdatedAt | Query | no | string |
| cursorId | Query | no | string |
| entity | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {
    "total": 0,
    "verificationCounts": {
      "total": 0,
      "verified": 0,
      "unverified": 0
    },
    "filters": {}
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "message": "string"
  }
  ```

### Other

#### `GET` `/api/core-verification/{*}`

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| * | Path | yes | string |


**Responses**

- **`200`**

#### `POST` `/api/core-verification/{*}`

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| * | Path | yes | string |


**Responses**

- **`200`**

#### `PATCH` `/api/core-verification/{*}`

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| * | Path | yes | string |


**Responses**

- **`200`**

#### `PUT` `/api/core-verification/{*}`

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| * | Path | yes | string |


**Responses**

- **`200`**

#### `DELETE` `/api/core-verification/{*}`

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| * | Path | yes | string |


**Responses**

- **`200`**

#### `GET` `/api/core-verification/summary`

**Security:** None

**Responses**

- **`200`**

#### `GET` `/core-review/verification-summary`

**Security:** None

**Responses**

- **`200`**

#### `GET` `/health/db`

**Security:** None

**Responses**

- **`200`**

#### `GET` `/health/import-review`

**Security:** None

**Responses**

- **`200`**

#### `POST` `/transport/route-paths/{id}/review-action`

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Responses**

- **`200`**

#### `PATCH` `/transport/route-stops/{id}/replace-stop`

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Responses**

- **`200`**

#### `POST` `/transport/routes/{publicId}/review-action`

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| publicId | Path | yes | string |


**Responses**

- **`200`**

#### `GET` `/transport/routes/{publicId}/review-readiness`

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| publicId | Path | yes | string |


**Responses**

- **`200`**

#### `GET` `/transport/routes/{routeCode}/stops`

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| routeCode | Path | yes | string |


**Responses**

- **`200`**

#### `POST` `/transport/stops/{publicId}/merge`

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| publicId | Path | yes | string |


**Responses**

- **`200`**

#### `POST` `/transport/stops/{publicId}/review-action`

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| publicId | Path | yes | string |


**Responses**

- **`200`**

### Reference Data

#### `GET` `/admin/ref/address-usage-types`

**Summary:** List active admin area address usage types

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Responses**

- **`200`**

  ```json
  [
    {
      "id": "string",
      "code": "string",
      "name_en": "string",
      "name_mm": "string",
      "helper_en": "string",
      "helper_mm": "string",
      "sort_order": 0,
      "is_active": false
    }
  ]
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/admin/ref/boundary-statuses`

**Summary:** List active admin area boundary statuses

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Responses**

- **`200`**

  ```json
  [
    {
      "id": "string",
      "code": "string",
      "name_en": "string",
      "name_mm": "string",
      "helper_en": "string",
      "helper_mm": "string",
      "sort_order": 0,
      "default_is_official_boundary": false,
      "default_boundary_confidence_score": 0,
      "default_address_usage_code": "string",
      "is_active": false
    }
  ]
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/admin/ref/land-area-classes`

**Summary:** List active land area classes

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Responses**

- **`200`**

  ```json
  [
    {
      "id": "string",
      "code": "string",
      "name_en": "string",
      "name_mm": "string",
      "parent_id": "string",
      "sort_order": 0,
      "min_zoom": 0,
      "is_active": false
    }
  ]
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/admin/ref/landuse-classes`

**Summary:** List active land area classes

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Responses**

- **`200`**

  ```json
  [
    {
      "id": "string",
      "code": "string",
      "name_en": "string",
      "name_mm": "string",
      "parent_id": "string",
      "sort_order": 0,
      "min_zoom": 0,
      "is_active": false
    }
  ]
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/admin/ref/water-classes`

**Summary:** List active water classes

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Responses**

- **`200`**

  ```json
  [
    {
      "id": "string",
      "code": "string",
      "name_en": "string",
      "name_mm": "string",
      "parent_id": "string",
      "sort_order": 0,
      "min_zoom": 0,
      "is_active": false
    }
  ]
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "message": "string"
  }
  ```

### routing

#### `POST` `/api/routing/admin/build-graph`

**Summary:** Build a tiny routing graph from selected core.core_streets rows

Generates routing.routing_nodes, routing.routing_edges, routing.routing_edge_names, and validation reports for a scoped batch. Requires ENABLE_ROUTING_GRAPH_BUILD=true.

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Request body** (`application/json`)

```json
{
  "profile_code": "walk",
  "source_publish_batch_id": "string",
  "source_review_batch_id": "string",
  "bbox": {
    "min_lon": 0,
    "min_lat": 0,
    "max_lon": 0,
    "max_lat": 0
  },
  "region_code": "string",
  "max_roads": 0,
  "dry_run": false
}
```

**Responses**

- **`200`**

  ```json
  {
    "build_job_id": "string",
    "build_job_public_id": "string",
    "status": "completed",
    "dry_run": false,
    "profile_code": "string",
    "selected_core_road_count": 0,
    "generated_node_count": 0,
    "generated_edge_count": 0,
    "generated_edge_name_count": 0,
    "warning_count": 0,
    "error_count": 0,
    "validation_codes": [
      "string"
    ],
    "message": "string",
    "metadata_id": "string"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`409`**

  ```json
  {
    "message": "string"
  }
  ```

#### `POST` `/api/routing/feedback`

**Summary:** Submit routing feedback

Stores user feedback in routing.routing_feedback when the table exists; otherwise returns an accepted stub id.

**Security:** None

**Request body** (`application/json`)

```json
{
  "origin": {
    "lat": 0,
    "lng": 0,
    "label": "string"
  },
  "destination": {
    "lat": 0,
    "lng": 0,
    "label": "string"
  },
  "profile": "string",
  "problemType": "wrong_route",
  "requestId": "00000000-0000-4000-8000-000000000000",
  "message": "string"
}
```

**Responses**

- **`200`**

  ```json
  {
    "publicId": "00000000-0000-4000-8000-000000000000",
    "status": "string",
    "stored": false
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "code": "string",
    "details": null,
    "issues": null,
    "engine": "string",
    "upstreamStatus": null
  }
  ```

#### `GET` `/api/routing/health`

**Summary:** Routing service health

Returns ROUTING_ENABLED state, configured public profiles, and Valhalla engine health when applicable.

**Security:** None

**Responses**

- **`200`**

  ```json
  {
    "routingEnabled": false,
    "defaultEngine": "string",
    "configuredPublicProfiles": [
      "string"
    ],
    "activeEngine": "string",
    "engineHealth": null
  }
  ```

#### `GET` `/api/routing/profiles`

**Summary:** List public routing profiles

Reads routing.routing_profiles when available; falls back to ROUTING_PUBLIC_PROFILES env list.

**Security:** None

**Responses**

- **`200`**

  ```json
  {
    "profiles": [
      {
        "code": "string",
        "name": "string",
        "isPublicEnabled": false,
        "isRoutingEnabled": false,
        "sortOrder": 0,
        "source": "database",
        "description": null,
        "primaryPhysicalModeCode": null
      }
    ],
    "source": "database"
  }
  ```

#### `POST` `/api/routing/route`

**Summary:** Compute a route between two points

Road directions via Valhalla adapter (walk, car, motorcycle). Requires ROUTING_ENABLED=true. Returns normalized geometry and legs — not raw Valhalla JSON.

**Security:** None

**Request body** (`application/json`)

```json
{
  "origin": {
    "lat": 0,
    "lng": 0,
    "label": "string"
  },
  "destination": {
    "lat": 0,
    "lng": 0,
    "label": "string"
  },
  "profile": "walk",
  "allowedModes": [
    "walk"
  ],
  "excludedModes": [
    "walk"
  ],
  "serviceClasses": [
    "local"
  ],
  "preference": "fastest",
  "departureTime": "2026-01-01T00:00:00.000Z",
  "maxWalkMeters": 0,
  "maxTransfers": 0
}
```

**Responses**

- **`200`**

  ```json
  {
    "status": "ok",
    "routingEngine": "valhalla",
    "profile": "string",
    "summary": {
      "distanceMeters": 0,
      "durationSeconds": 0,
      "transferCount": 0
    },
    "geometry": {
      "type": "LineString",
      "coordinates": [
        [
          0
        ]
      ]
    },
    "legs": [
      {
        "mode": "road",
        "distanceMeters": 0,
        "durationSeconds": 0,
        "from": {
          "lat": 0,
          "lng": 0,
          "label": "string"
        },
        "to": {
          "lat": 0,
          "lng": 0,
          "label": "string"
        },
        "profile": "string",
        "physicalMode": "string",
        "serviceClass": "string",
        "geometry": {
          "type": "LineString",
          "coordinates": [
            [
              0
            ]
          ]
        },
        "transit": {
          "agencyName": "string",
          "routeShortName": "string",
          "routeLongName": "string",
          "headsign": "string",
          "serviceClass": "string",
          "physicalMode": "string"
        },
        "instructions": [
          "string"
        ]
      }
    ],
    "warnings": [
      "string"
    ],
    "debug": {
      "buildCode": "string",
      "requestId": "string"
    }
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "code": "string",
    "details": null,
    "issues": null,
    "engine": "string",
    "upstreamStatus": null
  }
  ```

- **`502`**

  ```json
  {
    "message": "string",
    "code": "string",
    "details": null,
    "issues": null,
    "engine": "string",
    "upstreamStatus": null
  }
  ```

- **`503`**

  ```json
  {
    "message": "string",
    "code": "string",
    "details": null,
    "issues": null,
    "engine": "string",
    "upstreamStatus": null
  }
  ```

- **`504`**

  ```json
  {
    "message": "string",
    "code": "string",
    "details": null,
    "issues": null,
    "engine": "string",
    "upstreamStatus": null
  }
  ```

### Routing

#### `GET` `/admin/routing/builds`

**Summary:** List routing engine builds (admin)

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| limit | Query | no | integer |
| offset | Query | no | integer |
| engine_code | Query | no | string |
| status | Query | no | string |
| is_active | Query | no | string |


**Responses**

- **`200`**

  ```json
  {
    "items": [
      {
        "id": "string",
        "publicId": "00000000-0000-4000-8000-000000000000",
        "engineCode": "string",
        "buildVersion": "string",
        "status": "string",
        "isActive": false,
        "isPublic": false,
        "profileCodes": [
          "string"
        ],
        "warningCount": 0,
        "errorCount": 0,
        "createdAt": "string",
        "updatedAt": "string",
        "regionCode": "string",
        "buildLabel": "string",
        "startedAt": "string",
        "finishedAt": "string",
        "publishedAt": "string"
      }
    ],
    "total": 0,
    "limit": 0,
    "offset": 0
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "message": "string"
  }
  ```

- **`503`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/admin/routing/builds/{id}`

**Summary:** Get routing build detail (admin)

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {
    "id": "string",
    "publicId": "00000000-0000-4000-8000-000000000000",
    "engineCode": "string",
    "buildVersion": "string",
    "status": "string",
    "isActive": false,
    "isPublic": false,
    "profileCodes": [
      "string"
    ],
    "warningCount": 0,
    "errorCount": 0,
    "createdAt": "string",
    "updatedAt": "string",
    "regionCode": "string",
    "buildLabel": "string",
    "startedAt": "string",
    "finishedAt": "string",
    "publishedAt": "string",
    "summary": {},
    "smokeTestSummary": {},
    "artifactCount": 0,
    "sourceCount": 0,
    "sourceDescription": "string"
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "message": "string"
  }
  ```

- **`503`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/admin/routing/feedback`

**Summary:** List routing user feedback (admin)

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| limit | Query | no | integer |
| offset | Query | no | integer |
| status | Query | no | string |
| problem_type | Query | no | string |


**Responses**

- **`200`**

  ```json
  {}
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "message": "string"
  }
  ```

- **`503`**

  ```json
  {
    "message": "string"
  }
  ```

#### `PATCH` `/admin/routing/feedback/{id}/status`

**Summary:** Update routing feedback status (admin)

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Request body** (`application/json`)

```json
{
  "status": "open"
}
```

**Responses**

- **`200`**

  ```json
  {}
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "message": "string"
  }
  ```

- **`503`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/admin/routing/health`

**Summary:** Routing service health (admin)

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Responses**

- **`200`**

  ```json
  {}
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/admin/routing/validation-reports`

**Summary:** List routing validation reports (admin)

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| limit | Query | no | integer |
| offset | Query | no | integer |
| routing_build_id | Query | no | string |
| severity | Query | no | string |
| report_scope | Query | no | string |


**Responses**

- **`200`**

  ```json
  {}
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "message": "string"
  }
  ```

- **`503`**

  ```json
  {
    "message": "string"
  }
  ```

### Share

#### `POST` `/share/links`

**Summary:** Create a share link

Creates a CoreMap-only short share link for a map point or a core place. Existing links for the same target are reused (dedup). No authentication required.

**Security:** None

**Request body** (`application/json`)

```json
{
  "target_type": "point",
  "lat": 0,
  "lng": 0,
  "zoom": 0,
  "address_line": "string",
  "plus_code": "string"
}
```

**Responses**

- **`201`**

  ```json
  {
    "code": "string",
    "url": "string"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/share/links/{code}`

**Summary:** Resolve a share link

Resolves a share code to its target. Point links return a stored coordinate snapshot (no reverse geocode); place links return the place public id.

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| code | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {
    "target_type": "point",
    "lat": 0,
    "lng": 0,
    "zoom": 0,
    "address_line": "string",
    "plus_code": "string"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

### Transport

#### `GET` `/transport/data-quality/queues`

**Summary:** Transport data-quality review queues (admin)

Aggregate-only counts for data-quality review queues (generated/missing names, route path/stop gaps, ferry landing candidates, low-confidence rows, import errors). Admin only.

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Responses**

- **`200`**

  ```json
  {
    "generatedNameStops": 0,
    "generatedNameTerminals": 0,
    "missingNameStops": 0,
    "missingNameTerminals": 0,
    "routesWithoutPath": 0,
    "routesWithStopsButNoPath": 0,
    "routesWithPathButNoStops": 0,
    "ferryLandingCandidates": 0,
    "lowConfidenceStops": 0,
    "lowConfidenceTerminals": 0,
    "lowConfidenceRoutes": 0,
    "importErrors": 0,
    "lowConfidenceThreshold": 0,
    "schemaAvailable": false
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/transport/import-batches`

**Summary:** List transport import batches (admin, read-only)

Paginated, filterable import-batch audit list. Read-only.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| sourceName | Query | no | string |
| sourceKind | Query | no | string |
| status | Query | no | string |
| limit | Query | no | integer |
| offset | Query | no | integer |
| page | Query | no | integer |


**Responses**

- **`200`**

  ```json
  {
    "items": [
      {
        "id": 0,
        "public_id": "00000000-0000-4000-8000-000000000000",
        "source_name": "string",
        "source_kind": "string",
        "import_scope": "string",
        "import_mode": "string",
        "status": "string",
        "started_at": "string",
        "inserted_count": 0,
        "updated_count": 0,
        "skipped_count": 0,
        "error_count": 0,
        "created_at": "string",
        "updated_at": "string",
        "finished_at": "string",
        "notes": "string"
      }
    ],
    "total": 0,
    "limit": 0,
    "offset": 0
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/transport/import-errors`

**Summary:** List transport import errors (admin, read-only)

Paginated, filterable import-error list (no raw payload). Read-only.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| importBatchId | Query | no | integer |
| entityType | Query | no | string |
| errorCode | Query | no | string |
| search | Query | no | string |
| limit | Query | no | integer |
| offset | Query | no | integer |
| page | Query | no | integer |


**Responses**

- **`200`**

  ```json
  {
    "items": [
      {
        "id": 0,
        "entity_type": "string",
        "error_code": "string",
        "error_message": "string",
        "created_at": "string",
        "import_batch_id": 0,
        "external_id": "string"
      }
    ],
    "total": 0,
    "limit": 0,
    "offset": 0
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/transport/infrastructure-lines`

**Summary:** List transport infrastructure lines (admin)

Paginated, filterable infrastructure-lines list with raw-name status and admin-area display. Never returns geometry.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| search | Query | no | string |
| mode | Query | no | string |
| lineType | Query | no | string |
| reviewStatus | Query | no | string |
| generatedName | Query | no | string |
| adminAreaId | Query | no | integer |
| isActive | Query | no | string |
| includeDeleted | Query | no | string |
| limit | Query | no | integer |
| offset | Query | no | integer |
| page | Query | no | integer |


**Responses**

- **`200`**

  ```json
  {
    "items": [
      {
        "public_id": "00000000-0000-4000-8000-000000000000",
        "name": "string",
        "raw_name_status": "real",
        "mode": "string",
        "line_type": "string",
        "review_status": "string",
        "is_active": false,
        "updated_at": "string",
        "name_mm": "string",
        "name_en": "string",
        "admin_area_id": 0,
        "admin_area_name": "string",
        "confidence_score": 0
      }
    ],
    "total": 0,
    "limit": 0,
    "offset": 0
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/transport/infrastructure-lines/{publicId}`

**Summary:** Get transport infrastructure line detail (admin)

Full line fields incl. LineString geometry, admin-area display, approximate length, source summary, and raw debug blobs.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| publicId | Path | yes | string, uuid |


**Responses**

- **`200`**

  ```json
  {
    "public_id": "00000000-0000-4000-8000-000000000000",
    "raw_name_status": "real",
    "mode": "string",
    "line_type": "string",
    "review_status": "string",
    "is_active": false,
    "sources": [
      {
        "source_name": "string",
        "source_kind": "string",
        "external_id": "string",
        "source_url": "string",
        "is_primary": false
      }
    ],
    "name": "string",
    "name_mm": "string",
    "name_en": "string",
    "admin_area_id": 0,
    "admin_area_name": "string",
    "confidence_score": 0,
    "geometry": {
      "type": "string",
      "coordinates": null,
      "bbox": [
        0
      ]
    },
    "length_m": 0,
    "created_at": "string",
    "updated_at": "string",
    "deleted_at": "string",
    "source_refs": {},
    "normalized_data": {}
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `PATCH` `/transport/infrastructure-lines/{publicId}`

**Summary:** Update transport infrastructure line metadata (admin)

Partial update of editable line fields. Cannot edit geometry, source_refs, or normalized_data. No hard delete.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| publicId | Path | yes | string, uuid |


**Request body** (`application/json`)

```json
{
  "name": "string",
  "name_mm": "string",
  "name_en": "string",
  "mode": "bus",
  "line_type": "ferry",
  "admin_area_id": 0,
  "review_status": "imported_unreviewed",
  "confidence_score": 0,
  "is_active": false
}
```

**Responses**

- **`200`**

  ```json
  {
    "public_id": "00000000-0000-4000-8000-000000000000",
    "raw_name_status": "real",
    "mode": "string",
    "line_type": "string",
    "review_status": "string",
    "is_active": false,
    "sources": [
      {
        "source_name": "string",
        "source_kind": "string",
        "external_id": "string",
        "source_url": "string",
        "is_primary": false
      }
    ],
    "name": "string",
    "name_mm": "string",
    "name_en": "string",
    "admin_area_id": 0,
    "admin_area_name": "string",
    "confidence_score": 0,
    "geometry": {
      "type": "string",
      "coordinates": null,
      "bbox": [
        0
      ]
    },
    "length_m": 0,
    "created_at": "string",
    "updated_at": "string",
    "deleted_at": "string",
    "source_refs": {},
    "normalized_data": {}
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/transport/overview`

**Summary:** Transport dashboard overview (admin)

Aggregate counts by entity, review status, and mode plus an import-health summary. Admin only.

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Responses**

- **`200`**

  ```json
  {
    "counts": {
      "routes": 0,
      "routeVariants": 0,
      "routePaths": 0,
      "routeStops": 0,
      "stops": 0,
      "terminals": 0,
      "infrastructureLines": 0,
      "importBatches": 0,
      "importErrors": 0
    },
    "byMode": {
      "routes": {},
      "stops": {},
      "terminals": {},
      "infrastructureLines": {}
    },
    "reviewStatus": {
      "routes": {},
      "stops": {},
      "terminals": {},
      "infrastructureLines": {}
    },
    "quality": {
      "routesWithStops": 0,
      "routesWithoutStops": 0,
      "routeVariantsWithPath": 0,
      "routeVariantsWithoutPath": 0,
      "ferryTerminalsImportedUnreviewed": 0,
      "generatedNameTerminals": 0,
      "generatedNameStops": 0
    },
    "importIssues": {
      "missingNameMm": 0,
      "missingNameEn": 0,
      "fallbackName": 0,
      "routeGeometry": 0,
      "routeStopMember": 0,
      "lowConfidence": 0,
      "other": 0
    },
    "schemaAvailable": false
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/transport/quality-summary`

**Summary:** Transport quality summary by mode (admin)

Read-only per-mode counts (routes, variants, variants missing stops/path/direction, routes missing variants) to help admins triage what to fix first. Admin only.

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Responses**

- **`200`**

  ```json
  {
    "items": [
      {
        "mode": "string",
        "routes": 0,
        "variants": 0,
        "variants_without_stops": 0,
        "variants_without_path": 0,
        "variants_unknown_direction": 0,
        "routes_without_variants": 0
      }
    ],
    "schemaAvailable": false
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `PATCH` `/transport/route-stops/{id}`

**Summary:** Update route stop membership flags (admin)

Update pickup_type, drop_off_type, and is_timing_point for a route_stops row. stop_sequence is not editable here (use the move endpoint). Imported source_time_text / source_time_type and timetable offsets are read-only via this route; use PATCH /transport/route-stops/:id/timing for travel/waiting edits and PATCH /transport/route-variants/:publicId/departure-time for the variant departure anchor.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Request body** (`application/json`)

```json
{
  "pickup_type": 0,
  "drop_off_type": 0,
  "is_timing_point": false
}
```

**Responses**

- **`200`**

  ```json
  {
    "id": "string",
    "stop_sequence": 0,
    "pickup_type": 0,
    "drop_off_type": 0,
    "is_timing_point": false,
    "distance_from_start_m": 0,
    "source_time_text": "string",
    "source_time_type": "string",
    "travel_time_from_previous_seconds": 0,
    "waiting_time_seconds": 0,
    "arrival_offset_seconds": 0,
    "departure_offset_seconds": 0,
    "stop": {
      "public_id": "00000000-0000-4000-8000-000000000000",
      "name": "string",
      "name_mm": "string",
      "name_en": "string",
      "mode": "string",
      "stop_type": "string",
      "geometry": {
        "type": "string",
        "coordinates": null,
        "bbox": [
          0
        ]
      }
    }
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `DELETE` `/transport/route-stops/{id}`

**Summary:** Remove a stop from a route variant (admin)

Deletes the route_stops membership row only. The stop record itself is never deleted. After removal the remaining route_stops are resequenced to a gap-free 1..N. Accepts an optional JSON body `{ reason }` recorded in the removal audit log. Returns the updated ordered stops (lightweight shape) plus route_stop_count, has_verified_path, and deleted=true so the client can update locally without a refetch.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Responses**

- **`200`**

  ```json
  {
    "variant_public_id": "string",
    "ordered_stops": [
      {
        "route_stop_id": "string",
        "stop_public_id": "00000000-0000-4000-8000-000000000000",
        "stop_sequence": 0,
        "display_name": "string",
        "name_mm": "string",
        "name_en": "string",
        "mode": "string",
        "stop_type": "string",
        "longitude": 0,
        "latitude": 0,
        "actual_longitude": 0,
        "actual_latitude": 0,
        "geometry_source": "route_stop_review_geom",
        "pickup_type": 0,
        "drop_off_type": 0,
        "is_timing_point": false,
        "is_loop_closure": false,
        "review_status": "string",
        "source_time_text": "string",
        "source_time_type": "string",
        "travel_time_from_previous_seconds": 0,
        "waiting_time_seconds": 0,
        "arrival_offset_seconds": 0,
        "departure_offset_seconds": 0
      }
    ],
    "route_stop_count": 0,
    "has_verified_path": false,
    "has_review_placeholder_path": false,
    "created_stop": {
      "route_stop_id": "string",
      "public_id": "00000000-0000-4000-8000-000000000000",
      "display_name": "string",
      "name_mm": "string",
      "name_en": "string",
      "mode": "string",
      "stop_type": "string",
      "longitude": 0,
      "latitude": 0
    },
    "deleted": false
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `POST` `/transport/route-stops/{id}/move`

**Summary:** Move a route stop up or down (admin)

Swap a route stop's sequence with its adjacent neighbor in the same variant. Affects this route variant only.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Request body** (`application/json`)

```json
{
  "direction": "up"
}
```

**Responses**

- **`200`**

  ```json
  {
    "moved": false,
    "variantPublicId": "string"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `PATCH` `/transport/route-stops/{id}/timing`

**Summary:** Update route stop timetable inputs (admin)

Update editable travel/waiting seconds on one route_stops row, recalculate arrival/departure offsets for the whole variant in one transaction, and return the refreshed ordered stop list. Does not change stop_id, stop geometry, stop_sequence, or imported source_time_text / source_time_type.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Request body** (`application/json`)

```json
{
  "travelTimeFromPreviousSeconds": 0,
  "waitingTimeSeconds": 0
}
```

**Responses**

- **`200`**

  ```json
  {
    "variant_public_id": "string",
    "ordered_stops": [
      {
        "route_stop_id": "string",
        "stop_public_id": "00000000-0000-4000-8000-000000000000",
        "stop_sequence": 0,
        "display_name": "string",
        "name_mm": "string",
        "name_en": "string",
        "mode": "string",
        "stop_type": "string",
        "longitude": 0,
        "latitude": 0,
        "actual_longitude": 0,
        "actual_latitude": 0,
        "geometry_source": "route_stop_review_geom",
        "pickup_type": 0,
        "drop_off_type": 0,
        "is_timing_point": false,
        "is_loop_closure": false,
        "review_status": "string",
        "source_time_text": "string",
        "source_time_type": "string",
        "travel_time_from_previous_seconds": 0,
        "waiting_time_seconds": 0,
        "arrival_offset_seconds": 0,
        "departure_offset_seconds": 0
      }
    ],
    "route_stop_count": 0,
    "has_verified_path": false,
    "has_review_placeholder_path": false,
    "created_stop": {
      "route_stop_id": "string",
      "public_id": "00000000-0000-4000-8000-000000000000",
      "display_name": "string",
      "name_mm": "string",
      "name_en": "string",
      "mode": "string",
      "stop_type": "string",
      "longitude": 0,
      "latitude": 0
    },
    "deleted": false
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `PATCH` `/transport/route-variants/{publicId}`

**Summary:** Update transport route variant metadata (admin)

Partial update of editable variant fields. Cannot edit source_refs or normalized_data. No hard delete.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| publicId | Path | yes | string, uuid |


**Request body** (`application/json`)

```json
{
  "variant_code": "string",
  "direction_name": "string",
  "direction_id": 0,
  "headsign": "string",
  "origin_name": "string",
  "destination_name": "string",
  "estimated_duration_min": 0,
  "review_status": "imported_unreviewed",
  "confidence_score": 0,
  "is_active": false
}
```

**Responses**

- **`200`**

  ```json
  {
    "public_id": "00000000-0000-4000-8000-000000000000",
    "variant_code": "string",
    "direction_name": "string",
    "direction_id": 0,
    "headsign": "string",
    "origin_name": "string",
    "destination_name": "string",
    "stop_count": 0,
    "path_count": 0,
    "path_status": "has_path",
    "distance_m": 0,
    "estimated_duration_min": 0,
    "review_status": "string",
    "confidence_score": 0,
    "is_active": false
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `PATCH` `/transport/route-variants/{publicId}/departure-time`

**Summary:** Update variant departure time (admin)

Stores departure_time_text on the variant normalized_data blob, recalculates timetable offsets for all ordered stops in one transaction, and returns the refreshed ordered stop list.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| publicId | Path | yes | string, uuid |


**Request body** (`application/json`)

```json
{
  "departureTimeText": "string"
}
```

**Responses**

- **`200`**

  ```json
  {
    "variant_public_id": "string",
    "ordered_stops": [
      {
        "route_stop_id": "string",
        "stop_public_id": "00000000-0000-4000-8000-000000000000",
        "stop_sequence": 0,
        "display_name": "string",
        "name_mm": "string",
        "name_en": "string",
        "mode": "string",
        "stop_type": "string",
        "longitude": 0,
        "latitude": 0,
        "actual_longitude": 0,
        "actual_latitude": 0,
        "geometry_source": "route_stop_review_geom",
        "pickup_type": 0,
        "drop_off_type": 0,
        "is_timing_point": false,
        "is_loop_closure": false,
        "review_status": "string",
        "source_time_text": "string",
        "source_time_type": "string",
        "travel_time_from_previous_seconds": 0,
        "waiting_time_seconds": 0,
        "arrival_offset_seconds": 0,
        "departure_offset_seconds": 0
      }
    ],
    "route_stop_count": 0,
    "has_verified_path": false,
    "has_review_placeholder_path": false,
    "created_stop": {
      "route_stop_id": "string",
      "public_id": "00000000-0000-4000-8000-000000000000",
      "display_name": "string",
      "name_mm": "string",
      "name_en": "string",
      "mode": "string",
      "stop_type": "string",
      "longitude": 0,
      "latitude": 0
    },
    "deleted": false
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `POST` `/transport/route-variants/{publicId}/generate-path-from-stops`

**Summary:** Generate a road-following path from ordered stops (admin)

Builds a Valhalla-snapped route path through the variant's ordered stop coordinates (all route_stop occurrences, including circular loop closure), replaces the active route_paths row for this variant, and returns the new geometry.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| routePublicId | Path | yes | string, uuid |


**Responses**

- **`200`**

  ```json
  {
    "route_path_id": "00000000-0000-4000-8000-000000000000",
    "path_kind": "string",
    "review_status": "string",
    "geometry": {
      "type": "string",
      "coordinates": null,
      "bbox": [
        0
      ]
    },
    "warnings": [
      "string"
    ],
    "distance_m": 0
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`501`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/transport/route-variants/{publicId}/ordered-stops`

**Summary:** List lightweight ordered stops for a route variant (admin)

Lightweight ordered-stops read for the Route Detail ordered-stop panel + map markers. Joins only route_stops + stops, filters route_variant_id and non-deleted stops, orders by stop_sequence. Returns the flat stop shape (no path geometry, no source_refs/normalized_data, no route detail/list) plus route_stop_count and has_verified_path. Fetch the verified path overlay separately only when has_verified_path is true.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| publicId | Path | yes | string, uuid |


**Responses**

- **`200`**

  ```json
  {
    "variant_public_id": "string",
    "ordered_stops": [
      {
        "route_stop_id": "string",
        "stop_public_id": "00000000-0000-4000-8000-000000000000",
        "stop_sequence": 0,
        "display_name": "string",
        "name_mm": "string",
        "name_en": "string",
        "mode": "string",
        "stop_type": "string",
        "longitude": 0,
        "latitude": 0,
        "actual_longitude": 0,
        "actual_latitude": 0,
        "geometry_source": "route_stop_review_geom",
        "pickup_type": 0,
        "drop_off_type": 0,
        "is_timing_point": false,
        "is_loop_closure": false,
        "review_status": "string",
        "source_time_text": "string",
        "source_time_type": "string",
        "travel_time_from_previous_seconds": 0,
        "waiting_time_seconds": 0,
        "arrival_offset_seconds": 0,
        "departure_offset_seconds": 0
      }
    ],
    "route_stop_count": 0,
    "has_verified_path": false,
    "has_review_placeholder_path": false,
    "created_stop": {
      "route_stop_id": "string",
      "public_id": "00000000-0000-4000-8000-000000000000",
      "display_name": "string",
      "name_mm": "string",
      "name_en": "string",
      "mode": "string",
      "stop_type": "string",
      "longitude": 0,
      "latitude": 0
    },
    "deleted": false
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/transport/route-variants/{publicId}/stops`

**Summary:** List ordered stops for a route variant (admin)

Stops ordered by stop_sequence with stop GeoJSON points. Pass includePath=true to also return the variant path geometry.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| limit | Query | no | integer |
| offset | Query | no | integer |
| includePath | Query | no | string |
| publicId | Path | yes | string, uuid |


**Responses**

- **`200`**

  ```json
  {
    "items": [
      {
        "id": "string",
        "stop_sequence": 0,
        "pickup_type": 0,
        "drop_off_type": 0,
        "is_timing_point": false,
        "distance_from_start_m": 0,
        "source_time_text": "string",
        "source_time_type": "string",
        "travel_time_from_previous_seconds": 0,
        "waiting_time_seconds": 0,
        "arrival_offset_seconds": 0,
        "departure_offset_seconds": 0,
        "stop": {
          "public_id": "00000000-0000-4000-8000-000000000000",
          "name": "string",
          "name_mm": "string",
          "name_en": "string",
          "mode": "string",
          "stop_type": "string",
          "geometry": {
            "type": "string",
            "coordinates": null,
            "bbox": [
              0
            ]
          }
        }
      }
    ],
    "total": 0,
    "limit": 0,
    "offset": 0,
    "path": {
      "path_kind": "string",
      "distance_m": 0,
      "geometry": {
        "type": "string",
        "coordinates": null,
        "bbox": [
          0
        ]
      }
    }
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `POST` `/transport/route-variants/{publicId}/stops/create-and-insert`

**Summary:** Create a new stop and insert it into a route variant (admin)

Quick-create path for the Insert Stop modal. Creates a new stop (localized names, mode, stop_type) and inserts it into this variant in one transaction. Placeholder geometry is derived from the variant stop sequence, or from optional longitude/latitude when the variant is empty. At least one of name_mm / name_en is required. The backend owns stop_sequence and resequences all route_stops for the variant to 1..N. Returns the updated ordered stops (lightweight shape) plus route_stop_count, has_verified_path, and the created_stop summary so the client can update locally without a refetch.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| publicId | Path | yes | string, uuid |


**Request body** (`application/json`)

```json
{
  "mode": "bus",
  "stop_type": "string",
  "position": "start",
  "name_mm": "string",
  "name_en": "string",
  "anchorRouteStopId": "string",
  "pickup_type": 0,
  "drop_off_type": 0,
  "is_timing_point": false,
  "longitude": 0,
  "latitude": 0
}
```

**Responses**

- **`200`**

  ```json
  {
    "variant_public_id": "string",
    "ordered_stops": [
      {
        "route_stop_id": "string",
        "stop_public_id": "00000000-0000-4000-8000-000000000000",
        "stop_sequence": 0,
        "display_name": "string",
        "name_mm": "string",
        "name_en": "string",
        "mode": "string",
        "stop_type": "string",
        "longitude": 0,
        "latitude": 0,
        "actual_longitude": 0,
        "actual_latitude": 0,
        "geometry_source": "route_stop_review_geom",
        "pickup_type": 0,
        "drop_off_type": 0,
        "is_timing_point": false,
        "is_loop_closure": false,
        "review_status": "string",
        "source_time_text": "string",
        "source_time_type": "string",
        "travel_time_from_previous_seconds": 0,
        "waiting_time_seconds": 0,
        "arrival_offset_seconds": 0,
        "departure_offset_seconds": 0
      }
    ],
    "route_stop_count": 0,
    "has_verified_path": false,
    "has_review_placeholder_path": false,
    "created_stop": {
      "route_stop_id": "string",
      "public_id": "00000000-0000-4000-8000-000000000000",
      "display_name": "string",
      "name_mm": "string",
      "name_en": "string",
      "mode": "string",
      "stop_type": "string",
      "longitude": 0,
      "latitude": 0
    },
    "deleted": false
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`409`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

#### `POST` `/transport/route-variants/{publicId}/stops/insert-existing`

**Summary:** Insert an existing stop into a route variant (admin)

Inserts an existing stop into this variant's ordered pattern at start/end or before/after an anchor route_stop. The backend owns stop_sequence and resequences all route_stops for the variant to 1..N (the client never sends a final sequence). The same physical stop may appear more than once (each row is a distinct route_stops occurrence). Does not create a new stop. Returns the updated ordered stops (lightweight shape) plus route_stop_count and has_verified_path so the client can update locally without a refetch.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| publicId | Path | yes | string, uuid |


**Request body** (`application/json`)

```json
{
  "position": "start",
  "stopPublicId": "00000000-0000-4000-8000-000000000000",
  "stopId": 0,
  "anchorRouteStopId": "string",
  "pickup_type": 0,
  "drop_off_type": 0,
  "is_timing_point": false
}
```

**Responses**

- **`200`**

  ```json
  {
    "variant_public_id": "string",
    "ordered_stops": [
      {
        "route_stop_id": "string",
        "stop_public_id": "00000000-0000-4000-8000-000000000000",
        "stop_sequence": 0,
        "display_name": "string",
        "name_mm": "string",
        "name_en": "string",
        "mode": "string",
        "stop_type": "string",
        "longitude": 0,
        "latitude": 0,
        "actual_longitude": 0,
        "actual_latitude": 0,
        "geometry_source": "route_stop_review_geom",
        "pickup_type": 0,
        "drop_off_type": 0,
        "is_timing_point": false,
        "is_loop_closure": false,
        "review_status": "string",
        "source_time_text": "string",
        "source_time_type": "string",
        "travel_time_from_previous_seconds": 0,
        "waiting_time_seconds": 0,
        "arrival_offset_seconds": 0,
        "departure_offset_seconds": 0
      }
    ],
    "route_stop_count": 0,
    "has_verified_path": false,
    "has_review_placeholder_path": false,
    "created_stop": {
      "route_stop_id": "string",
      "public_id": "00000000-0000-4000-8000-000000000000",
      "display_name": "string",
      "name_mm": "string",
      "name_en": "string",
      "mode": "string",
      "stop_type": "string",
      "longitude": 0,
      "latitude": 0
    },
    "deleted": false
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`409`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

#### `GET` `/transport/routes`

**Summary:** List transport routes (admin)

Paginated, filterable routes list with variant/stop/path counts. Never returns geometry. Unauthenticated callers receive the public route list shape (route_code / names / fare).

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| search | Query | no | string |
| mode | Query | no | string |
| reviewStatus | Query | no | string |
| hasStops | Query | no | string |
| hasPath | Query | no | string |
| isActive | Query | no | string |
| includeDeleted | Query | no | string |
| limit | Query | no | integer |
| offset | Query | no | integer |
| page | Query | no | integer |


**Responses**

- **`200`**

  ```json
  {
    "items": [
      {
        "public_id": "00000000-0000-4000-8000-000000000000",
        "route_code": "string",
        "public_name": "string",
        "display_name": "string",
        "mode": "string",
        "route_kind": "string",
        "review_status": "string",
        "is_active": false,
        "variant_count": 0,
        "stop_count": 0,
        "path_count": 0,
        "updated_at": "string",
        "name_mm": "string",
        "name_en": "string",
        "origin_name": "string",
        "destination_name": "string",
        "confidence_score": 0
      }
    ],
    "total": 0,
    "limit": 0,
    "offset": 0,
    "page": 0,
    "hasNextPage": false
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `POST` `/transport/routes`

**Summary:** Create transport route with auto variants (admin)

Creates a route and its default variants in one transaction. route_kind is derived from the mode config; review_status=needs_review, confidence_score=60, is_active=true, and manual/admin source_refs are set by the server. Variants: loop -> ${code}-LOOP; bus/train -> ${code}-A outbound + ${code}-B inbound; ferry -> ${code}-A outbound (+ ${code}-B inbound when create_return_variant). Returns the created route detail including variants. 409 on duplicate code.

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Request body** (`application/json`)

```json
{
  "mode": "bus",
  "route_code": "string",
  "public_name": "string",
  "origin_name": "string",
  "destination_name": "string",
  "operator_id": 0,
  "create_return_variant": false,
  "is_loop": false
}
```

**Responses**

- **`201`**

  ```json
  {
    "public_id": "00000000-0000-4000-8000-000000000000",
    "route_code": "string",
    "public_name": "string",
    "display_name": "string",
    "mode": "string",
    "route_kind": "string",
    "review_status": "string",
    "is_active": false,
    "counts": {
      "variants": 0,
      "stops": 0,
      "paths": 0
    },
    "names": [
      {
        "name": "string",
        "language_code": "string",
        "script_code": "string",
        "name_type": "string",
        "is_primary": false,
        "search_weight": 0
      }
    ],
    "sources": [
      {
        "source_name": "string",
        "source_kind": "string",
        "external_id": "string",
        "source_url": "string",
        "is_primary": false
      }
    ],
    "variants": [
      {
        "public_id": "00000000-0000-4000-8000-000000000000",
        "variant_code": "string",
        "direction_name": "string",
        "direction_id": 0,
        "headsign": "string",
        "origin_name": "string",
        "destination_name": "string",
        "stop_count": 0,
        "path_count": 0,
        "path_status": "has_path",
        "distance_m": 0,
        "estimated_duration_min": 0,
        "review_status": "string",
        "confidence_score": 0,
        "is_active": false
      }
    ],
    "name_mm": "string",
    "name_en": "string",
    "origin_name": "string",
    "destination_name": "string",
    "origin_admin_area_id": 0,
    "destination_admin_area_id": 0,
    "description": "string",
    "operator": {
      "id": 0,
      "name": "string"
    },
    "confidence_score": 0,
    "created_at": "string",
    "updated_at": "string",
    "deleted_at": "string",
    "routeMetadata": {
      "summary": {
        "mode": "string",
        "routeKind": "string",
        "routeType": "string",
        "trainType": "string",
        "trainModel": "string",
        "operationDays": [
          "string"
        ],
        "sourceStatus": "none",
        "reviewStatus": "string",
        "isActive": false,
        "confidenceScore": 0,
        "generation": "string"
      },
      "names": {
        "routeCode": "string",
        "nameMy": "string",
        "nameEn": "string",
        "originName": "string",
        "destinationName": "string",
        "displayHeadsign": "string"
      },
      "counts": {
        "variantCount": 0,
        "stopCount": 0,
        "pathCount": 0,
        "sourceLinksCount": 0
      },
      "train": {
        "trainNumber": "string",
        "trainType": "string",
        "trainModel": "string",
        "operationDays": [
          "string"
        ],
        "totalStations": 0,
        "estimatedDurationMin": 0,
        "displayGroup": "string",
        "isYangonUrbanService": false,
        "isSourceFullLoop": false,
        "closingDuplicateStopSkipped": false,
        "importedRouteStops": 0
      },
      "diagnostics": {
        "hasSourceLinks": false,
        "hasPath": false,
        "hasCompleteStopSequence": false,
        "hasStopLocationWarnings": false
      }
    }
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`409`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

#### `GET` `/transport/routes/{publicId}`

**Summary:** Get transport route detail (admin)

Route fields, localized names, source summary, and counts. No stop list.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| publicId | Path | yes | string, uuid |


**Responses**

- **`200`**

  ```json
  {
    "public_id": "00000000-0000-4000-8000-000000000000",
    "route_code": "string",
    "public_name": "string",
    "display_name": "string",
    "mode": "string",
    "route_kind": "string",
    "review_status": "string",
    "is_active": false,
    "counts": {
      "variants": 0,
      "stops": 0,
      "paths": 0
    },
    "names": [
      {
        "name": "string",
        "language_code": "string",
        "script_code": "string",
        "name_type": "string",
        "is_primary": false,
        "search_weight": 0
      }
    ],
    "sources": [
      {
        "source_name": "string",
        "source_kind": "string",
        "external_id": "string",
        "source_url": "string",
        "is_primary": false
      }
    ],
    "name_mm": "string",
    "name_en": "string",
    "origin_name": "string",
    "destination_name": "string",
    "origin_admin_area_id": 0,
    "destination_admin_area_id": 0,
    "description": "string",
    "operator": {
      "id": 0,
      "name": "string"
    },
    "confidence_score": 0,
    "created_at": "string",
    "updated_at": "string",
    "deleted_at": "string",
    "routeMetadata": {
      "summary": {
        "mode": "string",
        "routeKind": "string",
        "routeType": "string",
        "trainType": "string",
        "trainModel": "string",
        "operationDays": [
          "string"
        ],
        "sourceStatus": "none",
        "reviewStatus": "string",
        "isActive": false,
        "confidenceScore": 0,
        "generation": "string"
      },
      "names": {
        "routeCode": "string",
        "nameMy": "string",
        "nameEn": "string",
        "originName": "string",
        "destinationName": "string",
        "displayHeadsign": "string"
      },
      "counts": {
        "variantCount": 0,
        "stopCount": 0,
        "pathCount": 0,
        "sourceLinksCount": 0
      },
      "train": {
        "trainNumber": "string",
        "trainType": "string",
        "trainModel": "string",
        "operationDays": [
          "string"
        ],
        "totalStations": 0,
        "estimatedDurationMin": 0,
        "displayGroup": "string",
        "isYangonUrbanService": false,
        "isSourceFullLoop": false,
        "closingDuplicateStopSkipped": false,
        "importedRouteStops": 0
      },
      "diagnostics": {
        "hasSourceLinks": false,
        "hasPath": false,
        "hasCompleteStopSequence": false,
        "hasStopLocationWarnings": false
      }
    }
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `PATCH` `/transport/routes/{publicId}`

**Summary:** Update transport route metadata (admin)

Partial update of editable route fields. Names are edited via name_mm/name_en (public_name is derived, Myanmar first, English fallback) and written to transport.route_names. Structured train metadata merges into normalized_data keys. display_headsign updates the primary variant headsign. Cannot edit public_name, source_refs, or raw normalized_data blobs. No hard delete.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| publicId | Path | yes | string, uuid |


**Request body** (`application/json`)

```json
{
  "route_code": "string",
  "name_mm": "string",
  "name_en": "string",
  "mode": "bus",
  "route_kind": "string",
  "origin_name": "string",
  "destination_name": "string",
  "description": "string",
  "review_status": "imported_unreviewed",
  "confidence_score": 0,
  "is_active": false,
  "train_type": "string",
  "train_model": "string",
  "operation_days": [
    "string"
  ],
  "is_yangon_urban_service": false,
  "display_headsign": "string"
}
```

**Responses**

- **`200`**

  ```json
  {
    "public_id": "00000000-0000-4000-8000-000000000000",
    "route_code": "string",
    "public_name": "string",
    "display_name": "string",
    "mode": "string",
    "route_kind": "string",
    "review_status": "string",
    "is_active": false,
    "counts": {
      "variants": 0,
      "stops": 0,
      "paths": 0
    },
    "names": [
      {
        "name": "string",
        "language_code": "string",
        "script_code": "string",
        "name_type": "string",
        "is_primary": false,
        "search_weight": 0
      }
    ],
    "sources": [
      {
        "source_name": "string",
        "source_kind": "string",
        "external_id": "string",
        "source_url": "string",
        "is_primary": false
      }
    ],
    "name_mm": "string",
    "name_en": "string",
    "origin_name": "string",
    "destination_name": "string",
    "origin_admin_area_id": 0,
    "destination_admin_area_id": 0,
    "description": "string",
    "operator": {
      "id": 0,
      "name": "string"
    },
    "confidence_score": 0,
    "created_at": "string",
    "updated_at": "string",
    "deleted_at": "string",
    "routeMetadata": {
      "summary": {
        "mode": "string",
        "routeKind": "string",
        "routeType": "string",
        "trainType": "string",
        "trainModel": "string",
        "operationDays": [
          "string"
        ],
        "sourceStatus": "none",
        "reviewStatus": "string",
        "isActive": false,
        "confidenceScore": 0,
        "generation": "string"
      },
      "names": {
        "routeCode": "string",
        "nameMy": "string",
        "nameEn": "string",
        "originName": "string",
        "destinationName": "string",
        "displayHeadsign": "string"
      },
      "counts": {
        "variantCount": 0,
        "stopCount": 0,
        "pathCount": 0,
        "sourceLinksCount": 0
      },
      "train": {
        "trainNumber": "string",
        "trainType": "string",
        "trainModel": "string",
        "operationDays": [
          "string"
        ],
        "totalStations": 0,
        "estimatedDurationMin": 0,
        "displayGroup": "string",
        "isYangonUrbanService": false,
        "isSourceFullLoop": false,
        "closingDuplicateStopSkipped": false,
        "importedRouteStops": 0
      },
      "diagnostics": {
        "hasSourceLinks": false,
        "hasPath": false,
        "hasCompleteStopSequence": false,
        "hasStopLocationWarnings": false
      }
    }
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/transport/routes/{publicId}/diagnostics`

**Summary:** Route technical diagnostics (admin)

Read-only technical payload for route review: normalized_data, source_refs, variant normalized_data, source_links, and merged validation warnings from review readiness.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| publicId | Path | yes | string, uuid |


**Responses**

- **`200`**

  ```json
  {
    "route": {
      "normalized_data": null,
      "source_refs": null
    },
    "variants": [
      {
        "public_id": "00000000-0000-4000-8000-000000000000",
        "variant_code": "string",
        "normalized_data": null
      }
    ],
    "source_links": [
      {
        "id": 0,
        "entity_type": "string",
        "entity_id": 0,
        "source_name": "string",
        "source_kind": "string",
        "external_id": "string",
        "source_url": "string",
        "import_batch_id": 0,
        "confidence_score": 0,
        "is_primary": false,
        "created_at": "2026-01-01T00:00:00.000Z"
      }
    ],
    "validation_warnings": [
      "string"
    ]
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `PATCH` `/transport/routes/{publicId}/metadata`

**Summary:** Patch structured transport route metadata (admin)

Structured metadata editor endpoint. Upserts route_names my/en, updates route columns, merges normalized_data keys (never replaces the full blob), and may update the primary variant headsign from normalizedDataPatch.display_headsign. Does not edit route_stops.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| publicId | Path | yes | string, uuid |


**Request body** (`application/json`)

```json
{
  "routeNames": {
    "my": "string",
    "en": "string"
  },
  "route": {
    "originName": "string",
    "destinationName": "string",
    "reviewStatus": "imported_unreviewed",
    "confidenceScore": 0
  },
  "normalizedDataPatch": {
    "train_type": "string",
    "train_model": "string",
    "operation_days": [
      "string"
    ],
    "display_headsign": "string",
    "is_yangon_urban_service": false
  }
}
```

**Responses**

- **`200`**

  ```json
  {
    "public_id": "00000000-0000-4000-8000-000000000000",
    "route_code": "string",
    "public_name": "string",
    "display_name": "string",
    "mode": "string",
    "route_kind": "string",
    "review_status": "string",
    "is_active": false,
    "counts": {
      "variants": 0,
      "stops": 0,
      "paths": 0
    },
    "names": [
      {
        "name": "string",
        "language_code": "string",
        "script_code": "string",
        "name_type": "string",
        "is_primary": false,
        "search_weight": 0
      }
    ],
    "sources": [
      {
        "source_name": "string",
        "source_kind": "string",
        "external_id": "string",
        "source_url": "string",
        "is_primary": false
      }
    ],
    "name_mm": "string",
    "name_en": "string",
    "origin_name": "string",
    "destination_name": "string",
    "origin_admin_area_id": 0,
    "destination_admin_area_id": 0,
    "description": "string",
    "operator": {
      "id": 0,
      "name": "string"
    },
    "confidence_score": 0,
    "created_at": "string",
    "updated_at": "string",
    "deleted_at": "string",
    "routeMetadata": {
      "summary": {
        "mode": "string",
        "routeKind": "string",
        "routeType": "string",
        "trainType": "string",
        "trainModel": "string",
        "operationDays": [
          "string"
        ],
        "sourceStatus": "none",
        "reviewStatus": "string",
        "isActive": false,
        "confidenceScore": 0,
        "generation": "string"
      },
      "names": {
        "routeCode": "string",
        "nameMy": "string",
        "nameEn": "string",
        "originName": "string",
        "destinationName": "string",
        "displayHeadsign": "string"
      },
      "counts": {
        "variantCount": 0,
        "stopCount": 0,
        "pathCount": 0,
        "sourceLinksCount": 0
      },
      "train": {
        "trainNumber": "string",
        "trainType": "string",
        "trainModel": "string",
        "operationDays": [
          "string"
        ],
        "totalStations": 0,
        "estimatedDurationMin": 0,
        "displayGroup": "string",
        "isYangonUrbanService": false,
        "isSourceFullLoop": false,
        "closingDuplicateStopSkipped": false,
        "importedRouteStops": 0
      },
      "diagnostics": {
        "hasSourceLinks": false,
        "hasPath": false,
        "hasCompleteStopSequence": false,
        "hasStopLocationWarnings": false
      }
    }
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `POST` `/transport/routes/{publicId}/swap-direction`

**Summary:** Swap inbound/outbound direction metadata for a two-variant route (admin)

Atomically swaps direction_id, direction_name, variant_code suffix (-A/-B), and normalized_data.direction (when present) between the route's two active variants. Requires exactly one outbound (direction_id 0) and one inbound (direction_id 1). Does not change route_stops, paths, or endpoint stop pointers.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| publicId | Path | yes | string, uuid |


**Responses**

- **`200`**

  ```json
  {
    "variants": [
      {
        "public_id": "00000000-0000-4000-8000-000000000000",
        "variant_code": "string",
        "direction_name": "string",
        "direction_id": 0,
        "headsign": "string",
        "origin_name": "string",
        "destination_name": "string",
        "stop_count": 0,
        "path_count": 0,
        "path_status": "has_path",
        "distance_m": 0,
        "estimated_duration_min": 0,
        "review_status": "string",
        "confidence_score": 0,
        "is_active": false
      }
    ]
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/transport/routes/{publicId}/variants`

**Summary:** List variants for a route (admin)

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| publicId | Path | yes | string, uuid |


**Responses**

- **`200`**

  ```json
  {
    "items": [
      {
        "public_id": "00000000-0000-4000-8000-000000000000",
        "variant_code": "string",
        "direction_name": "string",
        "direction_id": 0,
        "headsign": "string",
        "origin_name": "string",
        "destination_name": "string",
        "stop_count": 0,
        "path_count": 0,
        "path_status": "has_path",
        "distance_m": 0,
        "estimated_duration_min": 0,
        "review_status": "string",
        "confidence_score": 0,
        "is_active": false
      }
    ],
    "total": 0
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `POST` `/transport/routes/{routePublicId}/variants`

**Summary:** Create a route variant (admin)

Creates a variant under an active route. variant_code is unique per route (route_id + variant_code); a collision returns 409. direction_id: 0 outbound, 1 inbound, 2 loop/branch/special, null unknown. review_status defaults to needs_review and confidence_score to 60 when omitted. Returns the created variant.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| routePublicId | Path | yes | string, uuid |


**Request body** (`application/json`)

```json
{
  "variant_code": "string",
  "direction_id": 0,
  "direction_name": "string",
  "headsign": "string",
  "origin_name": "string",
  "destination_name": "string",
  "origin_stop_public_id": "00000000-0000-4000-8000-000000000000",
  "destination_stop_public_id": "00000000-0000-4000-8000-000000000000",
  "review_status": "imported_unreviewed",
  "confidence_score": 0
}
```

**Responses**

- **`201`**

  ```json
  {
    "public_id": "00000000-0000-4000-8000-000000000000",
    "variant_code": "string",
    "direction_name": "string",
    "direction_id": 0,
    "headsign": "string",
    "origin_name": "string",
    "destination_name": "string",
    "stop_count": 0,
    "path_count": 0,
    "path_status": "has_path",
    "distance_m": 0,
    "estimated_duration_min": 0,
    "review_status": "string",
    "confidence_score": 0,
    "is_active": false
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`409`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

#### `GET` `/transport/routes/between-stops`

**Summary:** Search direct route variants between two stops

Finds public-release route variants that serve both stops and returns the best forward occurrence pair per variant (destination.stop_sequence > origin.stop_sequence, smallest span). Supports repeated stop_id on circular routes without wrap-around.

**Security:** None

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| origin_stop_public_id | Query | yes | string, uuid |
| destination_stop_public_id | Query | yes | string, uuid |


**Responses**

- **`200`**

  ```json
  {
    "origin_stop_public_id": "00000000-0000-4000-8000-000000000000",
    "destination_stop_public_id": "00000000-0000-4000-8000-000000000000",
    "candidates": [
      {
        "route_id": "string",
        "route_public_id": "00000000-0000-4000-8000-000000000000",
        "route_code": "string",
        "public_name": "string",
        "variant_id": "string",
        "variant_public_id": "00000000-0000-4000-8000-000000000000",
        "variant_code": "string",
        "direction_name": "string",
        "origin_name": "string",
        "destination_name": "string",
        "origin_stop_sequence": 0,
        "destination_stop_sequence": 0,
        "forward_stop_count": 0,
        "stops": [
          {
            "route_stop_id": "string",
            "stop_id": "string",
            "public_id": "00000000-0000-4000-8000-000000000000",
            "stop_sequence": 0,
            "name_my": "string",
            "name_en": "string"
          }
        ]
      }
    ]
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/transport/source-links`

**Summary:** List transport source links (admin, read-only)

Paginated, filterable source-provenance list (no payload). Read-only.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| entityType | Query | no | string |
| entityId | Query | no | integer |
| sourceName | Query | no | string |
| sourceKind | Query | no | string |
| externalId | Query | no | string |
| limit | Query | no | integer |
| offset | Query | no | integer |
| page | Query | no | integer |


**Responses**

- **`200`**

  ```json
  {
    "items": [
      {
        "id": 0,
        "entity_type": "string",
        "entity_id": 0,
        "source_name": "string",
        "source_kind": "string",
        "is_primary": false,
        "created_at": "string",
        "external_id": "string",
        "source_url": "string",
        "import_batch_id": 0,
        "confidence_score": 0
      }
    ],
    "total": 0,
    "limit": 0,
    "offset": 0
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/transport/stops`

**Summary:** List transport stops (admin)

Paginated, filterable stops list with route counts and admin-area display. Never returns geometry.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| search | Query | no | string |
| mode | Query | no | string |
| stopType | Query | no | string |
| reviewStatus | Query | no | string |
| generatedName | Query | no | string |
| hasRoutes | Query | no | string |
| hasTerminal | Query | no | string |
| adminAreaId | Query | no | integer |
| isActive | Query | no | string |
| includeDeleted | Query | no | string |
| limit | Query | no | integer |
| offset | Query | no | integer |
| page | Query | no | integer |


**Responses**

- **`200`**

  ```json
  {
    "items": [
      {
        "public_id": "00000000-0000-4000-8000-000000000000",
        "name": "string",
        "display_name": "string",
        "mode": "string",
        "stop_type": "string",
        "route_count": 0,
        "has_terminal": false,
        "review_status": "string",
        "is_active": false,
        "updated_at": "string",
        "stop_code": "string",
        "name_mm": "string",
        "name_en": "string",
        "terminal_role": "string",
        "terminal_code": "string",
        "admin_area_id": 0,
        "admin_area_name": "string",
        "confidence_score": 0
      }
    ],
    "total": 0,
    "limit": 0,
    "offset": 0
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/transport/stops/{publicId}`

**Summary:** Get transport stop detail (admin)

Full stop fields incl. point geometry, admin-area/parent display, source summary, and raw debug blobs.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| publicId | Path | yes | string, uuid |


**Responses**

- **`200`**

  ```json
  {
    "public_id": "00000000-0000-4000-8000-000000000000",
    "name": "string",
    "display_name": "string",
    "mode": "string",
    "stop_type": "string",
    "review_status": "string",
    "is_active": false,
    "route_count": 0,
    "sources": [
      {
        "source_name": "string",
        "source_kind": "string",
        "external_id": "string",
        "source_url": "string",
        "is_primary": false
      }
    ],
    "stop_code": "string",
    "name_mm": "string",
    "name_en": "string",
    "admin_area_id": 0,
    "admin_area_name": "string",
    "parent_stop_id": 0,
    "parent_stop": {
      "public_id": "00000000-0000-4000-8000-000000000000",
      "name": "string"
    },
    "confidence_score": 0,
    "longitude": 0,
    "latitude": 0,
    "geometry": {
      "type": "string",
      "coordinates": null,
      "bbox": [
        0
      ]
    },
    "linked_terminal": {
      "public_id": "00000000-0000-4000-8000-000000000000",
      "terminal_role": "string",
      "is_active": false,
      "terminal_code": "string",
      "operator_id": 0,
      "operator": {
        "id": 0,
        "name": "string"
      },
      "review_status": "string",
      "confidence_score": 0
    },
    "created_at": "string",
    "updated_at": "string",
    "deleted_at": "string",
    "source_refs": {},
    "normalized_data": {}
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `PATCH` `/transport/stops/{publicId}`

**Summary:** Update transport stop metadata + point (admin)

Partial update of editable stop fields and point geometry. Cannot edit source_refs or normalized_data. No hard delete.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| publicId | Path | yes | string, uuid |


**Request body** (`application/json`)

```json
{
  "stop_code": "string",
  "name_mm": "string",
  "name_en": "string",
  "mode": "bus",
  "stop_type": "string",
  "admin_area_id": 0,
  "parent_stop_id": 0,
  "review_status": "imported_unreviewed",
  "confidence_score": 0,
  "is_active": false,
  "point": {
    "longitude": 0,
    "latitude": 0
  }
}
```

**Responses**

- **`200`**

  ```json
  {
    "public_id": "00000000-0000-4000-8000-000000000000",
    "name": "string",
    "display_name": "string",
    "mode": "string",
    "stop_type": "string",
    "review_status": "string",
    "is_active": false,
    "route_count": 0,
    "sources": [
      {
        "source_name": "string",
        "source_kind": "string",
        "external_id": "string",
        "source_url": "string",
        "is_primary": false
      }
    ],
    "stop_code": "string",
    "name_mm": "string",
    "name_en": "string",
    "admin_area_id": 0,
    "admin_area_name": "string",
    "parent_stop_id": 0,
    "parent_stop": {
      "public_id": "00000000-0000-4000-8000-000000000000",
      "name": "string"
    },
    "confidence_score": 0,
    "longitude": 0,
    "latitude": 0,
    "geometry": {
      "type": "string",
      "coordinates": null,
      "bbox": [
        0
      ]
    },
    "linked_terminal": {
      "public_id": "00000000-0000-4000-8000-000000000000",
      "terminal_role": "string",
      "is_active": false,
      "terminal_code": "string",
      "operator_id": 0,
      "operator": {
        "id": 0,
        "name": "string"
      },
      "review_status": "string",
      "confidence_score": 0
    },
    "created_at": "string",
    "updated_at": "string",
    "deleted_at": "string",
    "source_refs": {},
    "normalized_data": {}
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `DELETE` `/transport/stops/{publicId}`

**Summary:** Archive (soft-delete) a transport stop (admin)

Soft-deletes the stop (sets deleted_at + is_active = false). Never hard-deletes and never deletes route_stops. Rejected with 409 when the stop is still used by routes — remove it from all routes first. Any terminal linked to the stop is archived in the same transaction. stop_names and source_links are preserved. Accepts an optional JSON body `{ reason }` recorded in the archive audit log.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| publicId | Path | yes | string, uuid |


**Request body** (`application/json`)

```json
{
  "reason": "string"
}
```

**Responses**

- **`200`**

  ```json
  {
    "archived": false,
    "public_id": "00000000-0000-4000-8000-000000000000",
    "route_count": 0,
    "archived_terminals": [
      "00000000-0000-4000-8000-000000000000"
    ]
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`409`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

#### `GET` `/transport/stops/{publicId}/delete-eligibility`

**Summary:** Check whether a transport stop can be permanently deleted (admin)

Read-only reference check across route_stops, variant endpoints, child stops, linked terminals, and fares (when fare stop columns exist). Verified and manual_protected stops are never eligible.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| publicId | Path | yes | string, uuid |


**Responses**

- **`200`**

  ```json
  {
    "can_delete": false,
    "message": "string",
    "has_route_usage": false,
    "route_count": 0,
    "review_status": "string",
    "references": {
      "route_stops": 0,
      "variant_endpoints": 0,
      "child_stops": 0,
      "linked_terminals": 0,
      "fares": 0
    },
    "blockers": [
      "string"
    ]
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `DELETE` `/transport/stops/{publicId}/permanent`

**Summary:** Permanently delete a transport stop (admin)

Hard-deletes the stop when it has no blocking references and is not verified / manual_protected. Deletes related stop_names and source_links in the same transaction. Rejected with 409 when references remain or the stop is protected. Accepts an optional JSON body `{ reason }` recorded in the delete audit log.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| publicId | Path | yes | string, uuid |


**Request body** (`application/json`)

```json
{
  "reason": "string"
}
```

**Responses**

- **`200`**

  ```json
  {
    "deleted": false,
    "public_id": "00000000-0000-4000-8000-000000000000"
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`409`**

  ```json
  {
    "message": "string",
    "has_route_usage": false,
    "route_count": 0,
    "blockers": [
      "string"
    ]
  }
  ```

#### `GET` `/transport/stops/{publicId}/route-usage-detail`

**Summary:** Route usage detail for one stop (admin)

Authoritative route usage for one stop: distinct route/variant totals, direction breakdown, and every non-deleted route membership. Uses the same membership filters as GET /transport/stops/:publicId/routes. One query via indexed route_stops.stop_id — no N+1.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| publicId | Path | yes | string, uuid |


**Responses**

- **`200`**

  ```json
  {
    "stopPublicId": "00000000-0000-4000-8000-000000000000",
    "stopId": "00000000-0000-4000-8000-000000000000",
    "items": [
      {
        "routeStopId": "string",
        "routeId": "00000000-0000-4000-8000-000000000000",
        "routeCode": "string",
        "routeName": "string",
        "variantId": "00000000-0000-4000-8000-000000000000",
        "variantCode": "string",
        "directionName": "string",
        "directionId": 0,
        "stopSequence": 0
      }
    ],
    "routes": [
      {
        "routeStopId": "string",
        "routeId": "00000000-0000-4000-8000-000000000000",
        "routeCode": "string",
        "routeName": "string",
        "variantId": "00000000-0000-4000-8000-000000000000",
        "variantCode": "string",
        "directionName": "string",
        "directionId": 0,
        "stopSequence": 0
      }
    ],
    "summary": {
      "totalRoutes": 0,
      "totalVariants": 0,
      "routeStopMemberships": 0,
      "inboundCount": 0,
      "outboundCount": 0,
      "clockwiseCount": 0,
      "anticlockwiseCount": 0
    },
    "totalRoutes": 0,
    "totalVariants": 0,
    "directionUsage": {
      "inbound": 0,
      "outbound": 0,
      "clockwise": 0,
      "anticlockwise": 0
    }
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/transport/stops/{publicId}/routes`

**Summary:** List route variants that include this stop (admin)

Paginated route/variant summaries (code, name, direction, sequence) — never full route detail.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| limit | Query | no | integer |
| offset | Query | no | integer |
| publicId | Path | yes | string, uuid |


**Responses**

- **`200`**

  ```json
  {
    "items": [
      {
        "route_stop_id": "string",
        "route_public_id": "00000000-0000-4000-8000-000000000000",
        "route_code": "string",
        "route_name": "string",
        "mode": "string",
        "variant_public_id": "00000000-0000-4000-8000-000000000000",
        "variant_code": "string",
        "direction_name": "string",
        "headsign": "string",
        "stop_sequence": 0
      }
    ],
    "total": 0,
    "limit": 0,
    "offset": 0
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `PATCH` `/transport/stops/{stopPublicId}/location`

**Summary:** Update a transport stop's location (admin)

Focused location edit: updates geom (SRID 4326) and optionally review_status / confidence_score, bumps updated_at, marks source_refs as a manual/admin location edit, and keeps any linked terminal point in sync. Returns the refreshed stop detail plus stops within 30 m of the saved location.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| stopPublicId | Path | yes | string, uuid |


**Request body** (`application/json`)

```json
{
  "lng": 0,
  "lat": 0,
  "review_status": "imported_unreviewed",
  "confidence_score": 0
}
```

**Responses**

- **`200`**

  ```json
  {
    "stop": {
      "public_id": "00000000-0000-4000-8000-000000000000",
      "name": "string",
      "display_name": "string",
      "mode": "string",
      "stop_type": "string",
      "review_status": "string",
      "is_active": false,
      "route_count": 0,
      "sources": [
        {
          "source_name": "string",
          "source_kind": "string",
          "external_id": "string",
          "source_url": "string",
          "is_primary": false
        }
      ],
      "stop_code": "string",
      "name_mm": "string",
      "name_en": "string",
      "admin_area_id": 0,
      "admin_area_name": "string",
      "parent_stop_id": 0,
      "parent_stop": {
        "public_id": "00000000-0000-4000-8000-000000000000",
        "name": "string"
      },
      "confidence_score": 0,
      "longitude": 0,
      "latitude": 0,
      "geometry": {
        "type": "string",
        "coordinates": null,
        "bbox": [
          0
        ]
      },
      "linked_terminal": {
        "public_id": "00000000-0000-4000-8000-000000000000",
        "terminal_role": "string",
        "is_active": false,
        "terminal_code": "string",
        "operator_id": 0,
        "operator": {
          "id": 0,
          "name": "string"
        },
        "review_status": "string",
        "confidence_score": 0
      },
      "created_at": "string",
      "updated_at": "string",
      "deleted_at": "string",
      "source_refs": {},
      "normalized_data": {}
    },
    "nearby_stops": [
      {
        "stop_public_id": "00000000-0000-4000-8000-000000000000",
        "name": "string",
        "distance_m": 0,
        "mode": "string",
        "stop_type": "string"
      }
    ]
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/transport/stops/{stopPublicId}/nearby`

**Summary:** Preview nearby stops around a point (admin)

Read-only duplicate-check helper. Returns active stops within radius_m (default 30 m) of the given lng/lat, nearest first, excluding the stop itself. Intended for previewing duplicates before a location edit is committed.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| lng | Query | yes | number |
| lat | Query | yes | number |
| radius_m | Query | no | number |
| stopPublicId | Path | yes | string, uuid |


**Responses**

- **`200`**

  ```json
  [
    {
      "stop_public_id": "00000000-0000-4000-8000-000000000000",
      "name": "string",
      "distance_m": 0,
      "mode": "string",
      "stop_type": "string"
    }
  ]
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `POST` `/transport/stops/merge`

**Summary:** Merge transport stops — keep canonical (admin)

Global keep-canonical merge: repoint all duplicate references to the canonical stop, preserve every route_stop occurrence and sequence, preserve non-conflicting names and source links, verify zero duplicate references, then hard-delete the duplicate stop. Blocks when stops differ in mode. When both stops occur on the same variant, merge requires acknowledgeSameVariantOccurrences.

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Request body** (`application/json`)

```json
{
  "canonicalStopId": "00000000-0000-4000-8000-000000000000",
  "duplicateStopId": "00000000-0000-4000-8000-000000000000",
  "currentStopId": "00000000-0000-4000-8000-000000000000",
  "candidateStopId": "00000000-0000-4000-8000-000000000000",
  "fieldSources": {
    "name": "current",
    "name_mm": "current",
    "name_en": "current",
    "stop_type": "current",
    "geom": "current",
    "admin_area_id": "current",
    "confidence_score": "current",
    "review_status": "current",
    "is_active": "current"
  },
  "reason": "string",
  "acknowledgeSameVariantOccurrences": false
}
```

**Responses**

- **`200`**

  ```json
  {
    "canonicalStop": {
      "publicId": "00000000-0000-4000-8000-000000000000",
      "name": "string",
      "nameMy": "string",
      "nameEn": "string",
      "mode": "string",
      "stopType": "string",
      "adminAreaId": 0,
      "adminAreaName": "string",
      "reviewStatus": "string",
      "confidenceScore": 0,
      "isActive": false,
      "lat": 0,
      "lng": 0
    },
    "deletedStop": {
      "publicId": "00000000-0000-4000-8000-000000000000",
      "name": "string",
      "nameMy": "string",
      "nameEn": "string",
      "mode": "string",
      "stopType": "string",
      "adminAreaId": 0,
      "adminAreaName": "string",
      "reviewStatus": "string",
      "confidenceScore": 0,
      "isActive": false,
      "lat": 0,
      "lng": 0
    },
    "deletedStopId": "00000000-0000-4000-8000-000000000000",
    "referencesChanged": {
      "routeStops": 0,
      "variantOrigins": 0,
      "variantDestinations": 0,
      "terminals": 0,
      "faresOrigin": 0,
      "faresDestination": 0,
      "childStops": 0,
      "stopNames": 0,
      "sourceLinks": 0
    },
    "affectedRouteCodes": [
      "string"
    ],
    "affectedVariantCodes": [
      "string"
    ],
    "counts": {
      "canonicalBefore": {
        "routeStops": 0,
        "variantOrigins": 0,
        "variantDestinations": 0,
        "terminals": 0,
        "faresOrigin": 0,
        "faresDestination": 0,
        "childStops": 0,
        "stopNames": 0,
        "sourceLinks": 0
      },
      "canonicalAfter": {
        "routeStops": 0,
        "variantOrigins": 0,
        "variantDestinations": 0,
        "terminals": 0,
        "faresOrigin": 0,
        "faresDestination": 0,
        "childStops": 0,
        "stopNames": 0,
        "sourceLinks": 0
      },
      "duplicateBefore": {
        "routeStops": 0,
        "variantOrigins": 0,
        "variantDestinations": 0,
        "terminals": 0,
        "faresOrigin": 0,
        "faresDestination": 0,
        "childStops": 0,
        "stopNames": 0,
        "sourceLinks": 0
      },
      "duplicateAfter": {
        "routeStops": 0,
        "variantOrigins": 0,
        "variantDestinations": 0,
        "terminals": 0,
        "faresOrigin": 0,
        "faresDestination": 0,
        "childStops": 0,
        "stopNames": 0,
        "sourceLinks": 0
      }
    }
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`409`**

  ```json
  {
    "message": "string",
    "code": "string",
    "blockers": [
      "string"
    ]
  }
  ```

#### `POST` `/transport/stops/merge-preview`

**Summary:** Preview merging two transport stops (admin)

Read-only merge preview for Review Map and stop dedup workflows. Requires both stops to exist, be active (not deleted), and share the same mode. Reports variants where both stop IDs occur (including repeated occurrences). Does not block on distance or name similarity.

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Request body** (`application/json`)

```json
{
  "currentStopId": "00000000-0000-4000-8000-000000000000",
  "candidateStopId": "00000000-0000-4000-8000-000000000000"
}
```

**Responses**

- **`200`**

  ```json
  {
    "currentStop": {
      "publicId": "00000000-0000-4000-8000-000000000000",
      "name": "string",
      "nameMy": "string",
      "nameEn": "string",
      "mode": "string",
      "stopType": "string",
      "adminAreaId": 0,
      "adminAreaName": "string",
      "reviewStatus": "string",
      "confidenceScore": 0,
      "isActive": false,
      "lat": 0,
      "lng": 0
    },
    "candidateStop": {
      "publicId": "00000000-0000-4000-8000-000000000000",
      "name": "string",
      "nameMy": "string",
      "nameEn": "string",
      "mode": "string",
      "stopType": "string",
      "adminAreaId": 0,
      "adminAreaName": "string",
      "reviewStatus": "string",
      "confidenceScore": 0,
      "isActive": false,
      "lat": 0,
      "lng": 0
    },
    "currentUsage": {
      "items": [
        {
          "routeStopId": "string",
          "routeId": "00000000-0000-4000-8000-000000000000",
          "routeCode": "string",
          "routeName": "string",
          "variantId": "00000000-0000-4000-8000-000000000000",
          "variantCode": "string",
          "directionName": "string",
          "directionId": 0,
          "stopSequence": 0
        }
      ],
      "summary": {
        "totalRoutes": 0,
        "totalVariants": 0,
        "routeStopMemberships": 0,
        "inboundCount": 0,
        "outboundCount": 0,
        "clockwiseCount": 0,
        "anticlockwiseCount": 0
      }
    },
    "candidateUsage": {
      "items": [
        {
          "routeStopId": "string",
          "routeId": "00000000-0000-4000-8000-000000000000",
          "routeCode": "string",
          "routeName": "string",
          "variantId": "00000000-0000-4000-8000-000000000000",
          "variantCode": "string",
          "directionName": "string",
          "directionId": 0,
          "stopSequence": 0
        }
      ],
      "summary": {
        "totalRoutes": 0,
        "totalVariants": 0,
        "routeStopMemberships": 0,
        "inboundCount": 0,
        "outboundCount": 0,
        "clockwiseCount": 0,
        "anticlockwiseCount": 0
      }
    },
    "sameVariantConflicts": [
      {
        "routeCode": "string",
        "variantCode": "string",
        "directionName": "string",
        "currentRouteStopId": "string",
        "currentSequence": 0,
        "candidateRouteStopId": "string",
        "candidateSequence": 0
      }
    ],
    "sameVariantWarning": "string",
    "affectedRoutes": [
      {
        "routeId": "00000000-0000-4000-8000-000000000000",
        "routeCode": "string",
        "routeName": "string"
      }
    ],
    "affectedVariants": [
      {
        "variantId": "00000000-0000-4000-8000-000000000000",
        "variantCode": "string",
        "routeId": "00000000-0000-4000-8000-000000000000",
        "routeCode": "string",
        "directionName": "string"
      }
    ],
    "duplicateMembershipConflicts": [
      {
        "routeId": "00000000-0000-4000-8000-000000000000",
        "routeCode": "string",
        "variantId": "00000000-0000-4000-8000-000000000000",
        "variantCode": "string",
        "directionName": "string",
        "currentRouteStopId": "string",
        "currentSequence": 0,
        "candidateRouteStopId": "string",
        "candidateSequence": 0
      }
    ],
    "sequenceConflicts": [
      {
        "routeId": "00000000-0000-4000-8000-000000000000",
        "routeCode": "string",
        "variantId": "00000000-0000-4000-8000-000000000000",
        "variantCode": "string",
        "directionName": "string",
        "stopSequence": 0,
        "currentRouteStopId": "string",
        "candidateRouteStopId": "string"
      }
    ],
    "mergeAllowed": false,
    "mergeBlockers": [
      "string"
    ],
    "terminalConflict": {
      "exists": false,
      "canonicalTerminal": {
        "id": "string",
        "publicId": "string",
        "name": "string"
      },
      "duplicateTerminal": {
        "id": "string",
        "publicId": "string",
        "name": "string"
      }
    },
    "referenceCounts": {
      "current": {
        "routeStops": 0,
        "variantOrigins": 0,
        "variantDestinations": 0,
        "terminals": 0,
        "faresOrigin": 0,
        "faresDestination": 0,
        "childStops": 0,
        "stopNames": 0,
        "sourceLinks": 0
      },
      "candidate": {
        "routeStops": 0,
        "variantOrigins": 0,
        "variantDestinations": 0,
        "terminals": 0,
        "faresOrigin": 0,
        "faresDestination": 0,
        "childStops": 0,
        "stopNames": 0,
        "sourceLinks": 0
      }
    },
    "fieldComparison": {
      "name": {
        "current": null,
        "candidate": null,
        "same": false
      },
      "name_mm": {
        "current": null,
        "candidate": null,
        "same": false
      },
      "name_en": {
        "current": null,
        "candidate": null,
        "same": false
      },
      "stop_type": {
        "current": null,
        "candidate": null,
        "same": false
      },
      "geom": {
        "current": {
          "lat": 0,
          "lng": 0
        },
        "candidate": {
          "lat": 0,
          "lng": 0
        },
        "same": false,
        "distanceMeters": 0
      },
      "admin_area_id": {
        "current": null,
        "candidate": null,
        "same": false
      },
      "confidence_score": {
        "current": null,
        "candidate": null,
        "same": false
      },
      "review_status": {
        "current": null,
        "candidate": null,
        "same": false
      },
      "is_active": {
        "current": null,
        "candidate": null,
        "same": false
      }
    }
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`409`**

  ```json
  {
    "message": "string",
    "code": "string",
    "blockers": [
      "string"
    ]
  }
  ```

- **`500`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/transport/stops/nearby-candidates`

**Summary:** List nearby transport stop candidates for Review Map (admin)

Reusable Review Map helper. Returns same-mode non-deleted stops within an allowed radius around lng/lat, excludes selectedStopId (stop public_id), and orders by distance. Route usage counts are not included — load GET /transport/stops/:publicId/route-usage-detail for the selected stop or a candidate.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| lng | Query | yes | number |
| lat | Query | yes | number |
| radiusMeters | Query | no | integer |
| mode | Query | yes | string |
| selectedStopId | Query | yes | string, uuid |
| selectedName | Query | no | string |
| limit | Query | no | integer |


**Responses**

- **`200`**

  ```json
  {
    "items": [
      {
        "id": "string",
        "publicId": "00000000-0000-4000-8000-000000000000",
        "name": "string",
        "nameMy": "string",
        "nameEn": "string",
        "mode": "string",
        "stopType": "string",
        "reviewStatus": "string",
        "confidenceScore": 0,
        "lat": 0,
        "lng": 0,
        "distanceMeters": 0
      }
    ],
    "radiusMeters": 50,
    "limit": 0
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/transport/stops/search`

**Summary:** Search stops for route insertion (admin)

Lightweight stop picker for inserting an existing stop into a route variant. Returns existing active stops only (never source_refs / normalized_data, never the full list of routes using the stop). Text search matches Myanmar/English/raw name and stop_code; supplying nearLng+nearLat adds a PostGIS radius filter and ranks by distance. Pass excludeRouteVariantPublicId to drop stops already in that variant. Hard-capped at 50 results.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| search | Query | no | string |
| mode | Query | no | string |
| nearLng | Query | no | number |
| nearLat | Query | no | number |
| radiusMeters | Query | no | number |
| limit | Query | no | integer |
| excludeRouteVariantPublicId | Query | no | string, uuid |


**Responses**

- **`200`**

  ```json
  {
    "items": [
      {
        "public_id": "00000000-0000-4000-8000-000000000000",
        "display_name": "string",
        "mode": "string",
        "stop_type": "string",
        "review_status": "string",
        "route_count": 0,
        "name_mm": "string",
        "name_en": "string",
        "confidence_score": 0,
        "lon": 0,
        "lat": 0,
        "distance_m": 0
      }
    ],
    "limit": 0
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/transport/terminals`

**Summary:** List transport terminals (admin)

Paginated, filterable terminals list with raw-name status, linked-stop and admin-area display. Never returns geometry.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| search | Query | no | string |
| mode | Query | no | string |
| terminalRole | Query | no | string |
| reviewStatus | Query | no | string |
| generatedName | Query | no | string |
| linkedStop | Query | no | string |
| adminAreaId | Query | no | integer |
| confidenceMin | Query | no | number |
| confidenceMax | Query | no | number |
| isActive | Query | no | string |
| includeDeleted | Query | no | string |
| limit | Query | no | integer |
| offset | Query | no | integer |
| page | Query | no | integer |


**Responses**

- **`200`**

  ```json
  {
    "items": [
      {
        "public_id": "00000000-0000-4000-8000-000000000000",
        "name": "string",
        "raw_name_status": "real",
        "mode": "string",
        "terminal_role": "string",
        "review_status": "string",
        "is_active": false,
        "updated_at": "string",
        "terminal_code": "string",
        "name_mm": "string",
        "name_en": "string",
        "linked_stop": {
          "public_id": "00000000-0000-4000-8000-000000000000",
          "name": "string"
        },
        "admin_area_id": 0,
        "admin_area_name": "string",
        "confidence_score": 0
      }
    ],
    "total": 0,
    "limit": 0,
    "offset": 0
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/transport/terminals/{publicId}`

**Summary:** Get transport terminal detail (admin)

Full terminal fields incl. point geometry, linked-stop/operator/admin-area display, derived vehicle_access, source summary, and raw debug blobs.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| publicId | Path | yes | string, uuid |


**Responses**

- **`200`**

  ```json
  {
    "public_id": "00000000-0000-4000-8000-000000000000",
    "name": "string",
    "raw_name_status": "real",
    "mode": "string",
    "terminal_role": "string",
    "review_status": "string",
    "is_active": false,
    "vehicle_access": "string",
    "sources": [
      {
        "source_name": "string",
        "source_kind": "string",
        "external_id": "string",
        "source_url": "string",
        "is_primary": false
      }
    ],
    "terminal_code": "string",
    "name_mm": "string",
    "name_en": "string",
    "linked_stop_id": 0,
    "linked_stop": {
      "public_id": "00000000-0000-4000-8000-000000000000",
      "name": "string",
      "mode": "string",
      "stop_type": "string"
    },
    "operator_id": 0,
    "operator": {
      "id": 0,
      "name": "string"
    },
    "admin_area_id": 0,
    "admin_area_name": "string",
    "confidence_score": 0,
    "longitude": 0,
    "latitude": 0,
    "geometry": {
      "type": "string",
      "coordinates": null,
      "bbox": [
        0
      ]
    },
    "created_at": "string",
    "updated_at": "string",
    "deleted_at": "string",
    "source_refs": {},
    "normalized_data": {}
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `PATCH` `/transport/terminals/{publicId}`

**Summary:** Update transport terminal metadata + point (admin)

Partial update of editable terminal fields and point geometry. Cannot edit source_refs or normalized_data. No hard delete.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| publicId | Path | yes | string, uuid |


**Request body** (`application/json`)

```json
{
  "terminal_code": "string",
  "name": "string",
  "name_mm": "string",
  "name_en": "string",
  "mode": "bus",
  "terminal_role": "string",
  "linked_stop_id": 0,
  "operator_id": 0,
  "admin_area_id": 0,
  "review_status": "imported_unreviewed",
  "confidence_score": 0,
  "is_active": false,
  "point": {
    "longitude": 0,
    "latitude": 0
  }
}
```

**Responses**

- **`200`**

  ```json
  {
    "public_id": "00000000-0000-4000-8000-000000000000",
    "name": "string",
    "raw_name_status": "real",
    "mode": "string",
    "terminal_role": "string",
    "review_status": "string",
    "is_active": false,
    "vehicle_access": "string",
    "sources": [
      {
        "source_name": "string",
        "source_kind": "string",
        "external_id": "string",
        "source_url": "string",
        "is_primary": false
      }
    ],
    "terminal_code": "string",
    "name_mm": "string",
    "name_en": "string",
    "linked_stop_id": 0,
    "linked_stop": {
      "public_id": "00000000-0000-4000-8000-000000000000",
      "name": "string",
      "mode": "string",
      "stop_type": "string"
    },
    "operator_id": 0,
    "operator": {
      "id": 0,
      "name": "string"
    },
    "admin_area_id": 0,
    "admin_area_name": "string",
    "confidence_score": 0,
    "longitude": 0,
    "latitude": 0,
    "geometry": {
      "type": "string",
      "coordinates": null,
      "bbox": [
        0
      ]
    },
    "created_at": "string",
    "updated_at": "string",
    "deleted_at": "string",
    "source_refs": {},
    "normalized_data": {}
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `PATCH` `/transport/variants/{variantPublicId}`

**Summary:** Update a route variant (admin)

Partial update of editable variant fields, including origin/destination stop pointers (by stop public_id; null clears). Cannot edit source_refs or normalized_data. No hard delete. Returns the updated variant.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| variantPublicId | Path | yes | string, uuid |


**Request body** (`application/json`)

```json
{
  "variant_code": "string",
  "direction_id": 0,
  "direction_name": "string",
  "headsign": "string",
  "origin_name": "string",
  "destination_name": "string",
  "origin_stop_public_id": "00000000-0000-4000-8000-000000000000",
  "destination_stop_public_id": "00000000-0000-4000-8000-000000000000",
  "review_status": "imported_unreviewed",
  "confidence_score": 0
}
```

**Responses**

- **`200`**

  ```json
  {
    "public_id": "00000000-0000-4000-8000-000000000000",
    "variant_code": "string",
    "direction_name": "string",
    "direction_id": 0,
    "headsign": "string",
    "origin_name": "string",
    "destination_name": "string",
    "stop_count": 0,
    "path_count": 0,
    "path_status": "has_path",
    "distance_m": 0,
    "estimated_duration_min": 0,
    "review_status": "string",
    "confidence_score": 0,
    "is_active": false
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

- **`409`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

#### `DELETE` `/transport/variants/{variantPublicId}`

**Summary:** Soft-delete a route variant (admin)

Soft-deletes the variant (deleted_at = now(), is_active = false). Never hard-deletes and never removes route_stops or route_paths. Returns the parent route detail.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| variantPublicId | Path | yes | string, uuid |


**Responses**

- **`200`**

  ```json
  {
    "public_id": "00000000-0000-4000-8000-000000000000",
    "route_code": "string",
    "public_name": "string",
    "display_name": "string",
    "mode": "string",
    "route_kind": "string",
    "review_status": "string",
    "is_active": false,
    "counts": {
      "variants": 0,
      "stops": 0,
      "paths": 0
    },
    "names": [
      {
        "name": "string",
        "language_code": "string",
        "script_code": "string",
        "name_type": "string",
        "is_primary": false,
        "search_weight": 0
      }
    ],
    "sources": [
      {
        "source_name": "string",
        "source_kind": "string",
        "external_id": "string",
        "source_url": "string",
        "is_primary": false
      }
    ],
    "name_mm": "string",
    "name_en": "string",
    "origin_name": "string",
    "destination_name": "string",
    "origin_admin_area_id": 0,
    "destination_admin_area_id": 0,
    "description": "string",
    "operator": {
      "id": 0,
      "name": "string"
    },
    "confidence_score": 0,
    "created_at": "string",
    "updated_at": "string",
    "deleted_at": "string",
    "routeMetadata": {
      "summary": {
        "mode": "string",
        "routeKind": "string",
        "routeType": "string",
        "trainType": "string",
        "trainModel": "string",
        "operationDays": [
          "string"
        ],
        "sourceStatus": "none",
        "reviewStatus": "string",
        "isActive": false,
        "confidenceScore": 0,
        "generation": "string"
      },
      "names": {
        "routeCode": "string",
        "nameMy": "string",
        "nameEn": "string",
        "originName": "string",
        "destinationName": "string",
        "displayHeadsign": "string"
      },
      "counts": {
        "variantCount": 0,
        "stopCount": 0,
        "pathCount": 0,
        "sourceLinksCount": 0
      },
      "train": {
        "trainNumber": "string",
        "trainType": "string",
        "trainModel": "string",
        "operationDays": [
          "string"
        ],
        "totalStations": 0,
        "estimatedDurationMin": 0,
        "displayGroup": "string",
        "isYangonUrbanService": false,
        "isSourceFullLoop": false,
        "closingDuplicateStopSkipped": false,
        "importedRouteStops": 0
      },
      "diagnostics": {
        "hasSourceLinks": false,
        "hasPath": false,
        "hasCompleteStopSequence": false,
        "hasStopLocationWarnings": false
      }
    }
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `PUT` `/transport/variants/{variantPublicId}/path`

**Summary:** Create or replace a route variant's path (admin)

Upserts the variant's single active manual route path. If an active path exists it is updated in place; otherwise one is inserted. No second active path is ever created. Returns the updated path geometry plus the refreshed variant summary.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| variantPublicId | Path | yes | string, uuid |


**Request body** (`application/json`)

```json
{
  "coordinates": [
    [
      0
    ]
  ],
  "path_kind": "manual",
  "manually_adjusted": false
}
```

**Responses**

- **`200`**

  ```json
  {
    "path": {
      "path_kind": "string",
      "distance_m": 0,
      "geometry": {
        "type": "string",
        "coordinates": null,
        "bbox": [
          0
        ]
      }
    },
    "variant": {
      "public_id": "00000000-0000-4000-8000-000000000000",
      "variant_code": "string",
      "direction_name": "string",
      "direction_id": 0,
      "headsign": "string",
      "origin_name": "string",
      "destination_name": "string",
      "stop_count": 0,
      "path_count": 0,
      "path_status": "has_path",
      "distance_m": 0,
      "estimated_duration_min": 0,
      "review_status": "string",
      "confidence_score": 0,
      "is_active": false
    }
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `DELETE` `/transport/variants/{variantPublicId}/path`

**Summary:** Soft-delete a route variant's path (admin)

Soft-deletes the variant's active route path (deleted_at = now(), is_active = false). Never hard-deletes, and never touches the variant or its stops. A no-op when no active path exists. Returns the path (now null) plus the variant summary.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| variantPublicId | Path | yes | string, uuid |


**Responses**

- **`200`**

  ```json
  {
    "path": {
      "path_kind": "string",
      "distance_m": 0,
      "geometry": {
        "type": "string",
        "coordinates": null,
        "bbox": [
          0
        ]
      }
    },
    "variant": {
      "public_id": "00000000-0000-4000-8000-000000000000",
      "variant_code": "string",
      "direction_name": "string",
      "direction_id": 0,
      "headsign": "string",
      "origin_name": "string",
      "destination_name": "string",
      "stop_count": 0,
      "path_count": 0,
      "path_status": "has_path",
      "distance_m": 0,
      "estimated_duration_min": 0,
      "review_status": "string",
      "confidence_score": 0,
      "is_active": false
    }
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/transport/variants/{variantPublicId}/stop-quality`

**Summary:** Stop-quality diagnostics for a route variant (admin)

Read-only diagnostics for one variant's ordered stops. Per stop: straight-line gap from the previous stop (null for the first), deviation from the active route path (null when no active path exists), a defensive exact-duplicate flag, and a count of other active same-mode stops within ~30 m. Diagnostics only — no automatic fixes.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| variantPublicId | Path | yes | string, uuid |


**Responses**

- **`200`**

  ```json
  {
    "items": [
      {
        "route_stop_id": "string",
        "stop_public_id": "00000000-0000-4000-8000-000000000000",
        "stop_name": "string",
        "stop_sequence": 0,
        "lng": 0,
        "lat": 0,
        "distance_from_previous_m": 0,
        "distance_from_path_m": 0,
        "is_exact_duplicate_in_variant": false,
        "is_loop_closure": false,
        "nearby_duplicate_count": 0
      }
    ],
    "total": 0
  }
  ```

- **`400`**

  ```json
  {
    "message": "string",
    "issues": {
      "formErrors": [
        "string"
      ],
      "fieldErrors": {}
    }
  }
  ```

- **`401`**

  ```json
  {
    "message": "string"
  }
  ```

- **`403`**

  ```json
  {
    "message": "string"
  }
  ```

- **`404`**

  ```json
  {
    "message": "string"
  }
  ```

## Common error responses

Many routes return JSON error bodies for failed validation, auth, or missing resources. Shapes are defined per route in OpenAPI; representative **examples** (from the first matching response schema in the spec) are below.

### HTTP 400

```json
{
  "message": "string",
  "issues": {
    "formErrors": [
      "string"
    ],
    "fieldErrors": {}
  }
}
```

### HTTP 401

```json
{
  "message": "string"
}
```

### HTTP 403

```json
{
  "message": "string"
}
```

### HTTP 404

```json
{
  "message": "string"
}
```

### HTTP 409

```json
{
  "message": "string"
}
```

### HTTP 429

```json
{
  "message": "string"
}
```

### HTTP 500

```json
{
  "message": "string"
}
```

### HTTP 501

```json
{
  "message": "string"
}
```

### HTTP 502

```json
{
  "message": "string"
}
```

### HTTP 503

```json
{
  "message": "string"
}
```

### HTTP 504

```json
{
  "message": "string",
  "code": "string",
  "details": null,
  "issues": null,
  "engine": "string",
  "upstreamStatus": null
}
```

---

*OpenAPI version: 3.0.3 · API version: 0.1.0 · Operations: 287*
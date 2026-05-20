# Local Map API

> **Generated:** 2026-05-19T19:08:42.118Z (UTC)  
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

HTTP API for Local Map (places, streets, buildings, public map). Routes marked with a lock require `Authorization: Bearer <token>` from POST /auth/login.

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

Login, signup, and token issuance.

#### `POST` `/auth/login`

**Summary:** Log in

Authenticate with email or username plus password. Returns a JWT `accessToken` and user profile. Either `email` or `username` must be set (not both).

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

#### `POST` `/auth/signup`

**Summary:** Sign up demo admin

Creates a demo administrator account (development / internal use).

**Security:** None

**Request body** (`application/json`)

```json
{
  "username": "string",
  "password": "string"
}
```

**Responses**

- **`200`**

  ```json
  {
    "message": "Demo admin account created",
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

#### `GET` `/me`

**Summary:** Current user

Returns the authenticated user profile from the JWT (or dev bypass user).

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Responses**

- **`200`**

  ```json
  {
    "id": "string",
    "public_id": "string",
    "email": "user@example.com",
    "display_name": "string",
    "roles": [
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
        "label": "string"
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
    "isVerified": false
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

**Summary:** List building types

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
      "source_staging_id": "string",
      "external_id": "string",
      "name": "string",
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
    "source_staging_id": "string",
    "external_id": "string",
    "name": "string",
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
    "source_staging_id": "string",
    "external_id": "string",
    "name": "string",
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
    "source_staging_id": "string",
    "external_id": "string",
    "name": "string",
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

### Search

Public text search for the map client.

#### `GET` `/public/search`

**Summary:** Public search

**Security:** None

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
      "type": "string",
      "myanmar_name": "string",
      "english_name": "string",
      "name_mm": "string",
      "name_en": "string",
      "display_name": "string",
      "primary_name": "string",
      "canonical_name": "string",
      "subtitle": "string",
      "categoryName": "string",
      "lat": 0,
      "lng": 0,
      "cameraTarget": {
        "type": "point",
        "center": [
          0
        ],
        "zoom": 0
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

### Import Review

Admin-only Supabase `import_review` workspace. **`AUTH_BYPASS` is ignored.** Configure `IMPORT_REVIEW_ADMIN_TOKEN` to require header `x-import-review-admin-token` (401 missing, 403 mismatch; Bearer not required). Omit that env to require Bearer JWT whose payload includes `"roles": ["admin"]`.

#### `GET` `/api/import-review/buildings`

**Summary:** List import-review building candidates

Paged list from `import_review.building_candidates` with GeoJSON `geom`/centroid when `include_geometry=true`. Scope matches summary endpoint rules.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| source_snapshot_version | Query | no | string |
| snapshot_version | Query | no | string |
| review_batch_id | Query | no | string |
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
        "review_overrides": {},
        "matched_core_id": "string",
        "…": "(more fields — see OpenAPI spec)"
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

#### `GET` `/api/import-review/buildings/{id}`

**Summary:** Get one import-review building candidate

Returns a single candidate row with GeoJSON geometry when include_geometry=true.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| source_snapshot_version | Query | no | string |
| snapshot_version | Query | no | string |
| review_batch_id | Query | no | string |
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
    "review_overrides": {},
    "matched_core_id": "string",
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
    "review_overrides": {},
    "matched_core_id": "string",
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

#### `PATCH` `/api/import-review/buildings/{id}/overrides`

**Summary:** Patch import_review building overrides

Shallow-merge JSON into `review_overrides` plus optional audit row (`import_review.review_candidate_edits`) when migration 024 tables exist.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Request body** (`application/json`)

```json
{
  "review_overrides": {},
  "source_snapshot_version": "string",
  "snapshot_version": "string",
  "review_batch_id": "string",
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
    "review_overrides": {},
    "matched_core_id": "string",
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
  "review_note": "string",
  "force": false,
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
    "updated_count": 0,
    "skipped_count": 0,
    "skipped_reasons": [
      {
        "reason": "string",
        "count": 0
      }
    ],
    "dry_run": false
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

- **`500`**

  ```json
  {
    "message": "string"
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
    "message": "string"
  }
  ```

- **`500`**

  ```json
  {
    "message": "string"
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
| match_status | Query | no | string |
| auto_action | Query | no | string |
| review_status | Query | no | string |
| review_decision | Query | no | string |
| q | Query | no | string |
| limit | Query | no | integer |
| offset | Query | no | integer |
| sort | Query | no | string |
| include_geometry | Query | no | boolean |


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
        "review_overrides": {},
        "matched_core_id": "string",
        "…": "(more fields — see OpenAPI spec)"
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
    "review_overrides": {},
    "matched_core_id": "string",
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
  "review_note": "string",
  "force": false,
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
    "updated_count": 0,
    "skipped_count": 0,
    "skipped_reasons": [
      {
        "reason": "string",
        "count": 0
      }
    ],
    "dry_run": false
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

- **`500`**

  ```json
  {
    "message": "string"
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
        "total_item_count": 0,
        "success_count": 0,
        "failed_count": 0,
        "skipped_count": 0,
        "created_at": "2026-01-01T00:00:00.000Z",
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

- **`500`**

  ```json
  {
    "message": "string"
  }
  ```

#### `POST` `/api/import-review/promotion/batches`

**Summary:** Create publish batch from approved building candidates

Transactional: inserts system.system_publish_batches + system.system_publish_items, marks building_candidates promotion_status=batched. No core promotion.

**Security:** Bearer JWT (`Authorization: Bearer …`)

**Request body** (`application/json`)

```json
{
  "batch_name": "string",
  "source_snapshot_version": "string",
  "snapshot_version": "string",
  "review_batch_id": "string",
  "note": "string",
  "include_merged": false
}
```

**Responses**

- **`201`**

  ```json
  {
    "message": "string",
    "batch": {
      "id": "string",
      "public_id": "string",
      "batch_name": "string",
      "status": "string",
      "total_item_count": 0,
      "success_count": 0,
      "failed_count": 0,
      "skipped_count": 0,
      "created_at": "2026-01-01T00:00:00.000Z",
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
      }
    },
    "items_added": 0,
    "building_candidates_marked_batched": 0
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

- **`500`**

  ```json
  {
    "message": "string"
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
    "total_item_count": 0,
    "success_count": 0,
    "failed_count": 0,
    "skipped_count": 0,
    "created_at": "2026-01-01T00:00:00.000Z",
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

- **`500`**

  ```json
  {
    "message": "string"
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
        "stage_status": "string",
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
    "workflow": "validation",
    "validation_total": 0,
    "validation_done": 0,
    "validation_percent": 0,
    "validated_at": "2026-01-01T00:00:00.000Z",
    "current_stage_key": "string",
    "current_stage_label": "string",
    "current_stage_status": "string",
    "current_message": "string",
    "validation_result": {
      "outcome": "passed",
      "valid_count": 0,
      "warning_count": 0,
      "blocked_count": 0,
      "total_items": 0,
      "by_publish_action": {
        "insert": 0,
        "update": 0,
        "merge": 0
      },
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
      "started_at": "2026-01-01T00:00:00.000Z",
      "finished_at": "2026-01-01T00:00:00.000Z",
      "duration_ms": 0,
      "promoted_entity_families": [
        "string"
      ],
      "partial_success": false
    },
    "promotion_logs_summary": "string"
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

#### `POST` `/api/import-review/promotion/batches/{id}/promote`

**Summary:** Promote validated publish batch to core (buildings)

Writes approved building candidates to core.core_map_buildings. Returns 202 immediately; poll progress and logs endpoints.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Request body** (`application/json`)

```json
{
  "confirmation_text": "PROMOTE",
  "chunk_size": 0
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

- **`500`**

  ```json
  {
    "message": "string"
  }
  ```

#### `POST` `/api/import-review/promotion/batches/{id}/validate`

**Summary:** Start publish batch dry-run validation (buildings)

Validates all publish items without writing to core. Returns 202 immediately; poll progress and logs endpoints.

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

- **`500`**

  ```json
  {
    "message": "string"
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

#### `GET` `/api/import-review/promotion/ready`

**Summary:** Count building candidates ready for publish batching

Server-side readiness counts for approved import_review.building_candidates. No core writes.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| source_snapshot_version | Query | no | string |
| snapshot_version | Query | no | string |
| review_batch_id | Query | no | string |
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

- **`500`**

  ```json
  {
    "message": "string"
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
        "confidence_score": 0,
        "match_status": "string",
        "auto_action": "string",
        "review_status": "string",
        "review_decision": "string",
        "promotion_status": "string",
        "normalized_data": null,
        "review_overrides": null,
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

- **`500`**

  ```json
  {
    "message": "string"
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
| match_status | Query | no | string |
| auto_action | Query | no | string |
| review_status | Query | no | string |
| review_decision | Query | no | string |
| q | Query | no | string |
| limit | Query | no | integer |
| offset | Query | no | integer |
| sort | Query | no | string |
| include_geometry | Query | no | boolean |


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
        "review_overrides": {},
        "matched_core_id": "string",
        "…": "(more fields — see OpenAPI spec)"
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
    "review_overrides": {},
    "matched_core_id": "string",
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

#### `PATCH` `/api/import-review/roads/{id}/overrides`

**Summary:** Patch import_review road overrides (routing-safe)

Validates LineString/MultiLineString geometry, ref road class FK, surface text, and routing continuity warnings before merging `review_overrides` and updating typed columns on `import_review.road_candidates`.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| id | Path | yes | string |


**Request body** (`application/json`)

```json
{
  "review_overrides": {
    "canonical_name": "string",
    "road_class_id": "string",
    "road_class_code": "string",
    "is_oneway": false,
    "surface": "string",
    "geom": {}
  },
  "source_snapshot_version": "string",
  "snapshot_version": "string",
  "review_batch_id": "string",
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
    "review_overrides": {},
    "matched_core_id": "string",
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
  "use_review_overrides": false,
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
  "review_note": "string",
  "force": false,
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
    "updated_count": 0,
    "skipped_count": 0,
    "skipped_reasons": [
      {
        "reason": "string",
        "count": 0
      }
    ],
    "dry_run": false
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

- **`500`**

  ```json
  {
    "message": "string"
  }
  ```

#### `GET` `/api/import-review/summary`

**Summary:** Import review candidate summary

Grouped counts over `import_review.*` candidates for the resolved review batch (`DATABASE_URL`, optional `IMPORT_REVIEW_DATABASE_URL` override). Supply exactly one of `source_snapshot_version` (alias: `snapshot_version`) or `review_batch_id`.

**Security:** Bearer JWT (`Authorization: Bearer …`)

| Name | In | Required | Schema |
| --- | --- | --- | --- |
| source_snapshot_version | Query | no | string |
| snapshot_version | Query | no | string |
| review_batch_id | Query | no | string |


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
    "total_pending_review_count": 0,
    "total_approved_count": 0,
    "total_rejected_count": 0,
    "warnings": [
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

### HTTP 500

```json
{
  "message": "string"
}
```

---

*OpenAPI version: 3.0.3 · API version: 0.1.0 · Operations: 66*
# Local Map API

> **Generated:** 2026-05-08T15:01:37.964Z (UTC)  
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

JWT from POST /auth/login. Example: `Authorization: Bearer <accessToken>`

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

*OpenAPI version: 3.0.3 · API version: 0.1.0 · Operations: 41*
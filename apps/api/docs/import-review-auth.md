## Import Review API authentication (`/api/import-review/*`)

`AUTH_BYPASS` **does not** relax security on these routes (unauthenticated writes were incorrectly possible previously when bypass short‑circuited JWT while Import Review reused the same decorator).

### Two modes (`IMPORT_REVIEW_ADMIN_TOKEN`)

| Env | Auth |
| --- | --- |
| **`IMPORT_REVIEW_ADMIN_TOKEN` non-empty** | Send header **`x-import-review-admin-token: <exact token>`**. Missing blank header → **`401 Unauthorized`**. Wrong secret → **`403 Forbidden`**. Bearer JWT is ignored for access (you may omit `Authorization`). |
| **`IMPORT_REVIEW_ADMIN_TOKEN` unset/empty** | Send **`Authorization: Bearer <jwt>`** from **`POST /auth/login`**. Invalid/missing bearer → **`401`**. JWT must include **`"roles":["admin"]`** (else **`403 Import review endpoints require admin role`**). |

CORS exposes the header **`x-import-review-admin-token`** for browser dashboards.

Startup log:

```text
import-review admin guard enabled: true|false
```

`true` means `IMPORT_REVIEW_ADMIN_TOKEN` is configured (mandatory symmetric header tier).

---

### Curl (token tier)

```bash
export API=http://localhost:3001    # apps/api default PORT is 3001 when unset — adjust if needed
export SNAP=osm_myanmar_2026_05_15_kyauktan_v2
export IMPORT_REVIEW_ADMIN_TOKEN=dev-secret-change-me   # MUST match apps/api .env

# Expect 401 (no header when IMPORT_REVIEW_ADMIN_TOKEN is configured on the server)
curl -sS -o /tmp/ir-body.json -w "HTTP %{http_code}\n" \
  -X PATCH "$API/api/import-review/buildings/1/decision" \
  -H 'Content-Type: application/json' \
  -d "{\"source_snapshot_version\":\"$SNAP\",\"review_decision\":\"approved\",\"review_note\":\"Test approval\"}"

# Expect 403 (wrong secret)
curl -sS -o /tmp/ir-body.json -w "HTTP %{http_code}\n" \
  -X PATCH "$API/api/import-review/buildings/1/decision" \
  -H 'Content-Type: application/json' \
  -H "x-import-review-admin-token: wrong" \
  -d "{\"source_snapshot_version\":\"$SNAP\",\"review_decision\":\"approved\",\"review_note\":\"Test approval\"}"

# Expect 200 (or business 404 if id=1 not in scope — still authenticated)
curl -sS -o /tmp/ir-body.json -w "HTTP %{http_code}\n" \
  -X PATCH "$API/api/import-review/buildings/1/decision" \
  -H 'Content-Type: application/json' \
  -H "x-import-review-admin-token: $IMPORT_REVIEW_ADMIN_TOKEN" \
  -d "{\"source_snapshot_version\":\"$SNAP\",\"review_decision\":\"approved\",\"review_note\":\"Test approval\"}"
```

### Curl (JWT tier — leave `IMPORT_REVIEW_ADMIN_TOKEN` empty on API)

```bash
export TOKEN="..."   # from /auth/login
curl -sS -w "HTTP %{http_code}\n" \
  "$API/api/import-review/summary?source_snapshot_version=$SNAP" \
  -H "Authorization: Bearer $TOKEN"
```

Also run `npm run curl-examples:import-review-auth --prefix apps/api`.

---
status: archived
reason: replaced by docs/archive/old-docs/apps/api/docs/saved-places-qa-checklist.md
archived_at: 2026-07-01
---

# Saved Places API — Manual QA Checklist

MVP saved places. All endpoints require a Bearer access token from `POST /auth/login`.
Only `entity_type='place'` referring to a public, non-deleted `core.core_places` row.

```bash
export API=http://localhost:3001
export TOKEN=<accessToken>          # from POST /auth/login
export PLACE_ID=<core_places.id>    # a public, non-deleted place
```

> Note: with `AUTH_BYPASS=true` the dev subject has no real `auth_users` row, so these
> endpoints return `401`. Test with a real logged-in user (bypass off).

## Auth required

- [ ] `GET /me/saved-places` without a token → `401`.
- [ ] `POST /me/saved-places` without a token → `401`.
- [ ] `DELETE /me/saved-places/1` without a token → `401`.

## POST /me/saved-places

```bash
curl -i -X POST "$API/me/saved-places" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d "{\"entityType\":\"place\",\"entityId\":$PLACE_ID}"
```

- [ ] Saving a valid public place → `201` with `{ id, place_id, display_name, category, admin_area_id, created_at }`.
- [ ] A row exists in `app.user_saved_places` with `entity_type='place'`, `entity_id=$PLACE_ID`, owner `user_id`.
- [ ] Saving the **same** place again → `409 Place is already saved`.
- [ ] `entityType` other than `"place"` (e.g. `"street"`) → `400`.
- [ ] Missing/zero/negative `entityId` → `400`.
- [ ] `entityId` of a non-existent place → `404 Place not found or not saveable`.
- [ ] `entityId` of a place with `is_public=false` or `deleted_at` set → `404`.

## GET /me/saved-places

```bash
curl -i "$API/me/saved-places" -H "Authorization: Bearer $TOKEN"
```

- [ ] Returns an array of the current user's saved places, **newest first**.
- [ ] Each item includes saved `id`, `place_id`, `display_name`, `category` ({code,name} or null), `admin_area_id`, `created_at`.
- [ ] Only the caller's own saves appear (log in as a second user and confirm isolation).
- [ ] A place that later became non-public/deleted still lists the saved row, with `display_name`/`category` null.

## DELETE /me/saved-places/:id

```bash
curl -i -X DELETE "$API/me/saved-places/<savedId>" -H "Authorization: Bearer $TOKEN"
```

- [ ] Deleting your own saved place → `200 {"message":"Saved place removed"}`; row is gone.
- [ ] Deleting again (already removed) → `404 Saved place not found`.
- [ ] Deleting **another user's** saved place id → `404` (owner-scoped; not revealed).
- [ ] Non-numeric id (e.g. `/me/saved-places/abc`) → `400`.

## Out of scope (should NOT exist)

- [ ] No custom map points, saved routes, folders/lists, or sharing endpoints were added.

---
status: archived
reason: replaced by docs/archive/old-docs/apps/api/docs/admin-users-qa-checklist.md
archived_at: 2026-07-01
---

# Admin User Management & Analytics — Manual QA Checklist

Base URL assumes the API runs locally (e.g. `http://localhost:3000`). All endpoints
require a Bearer access token. Get one via `POST /auth/login`.

Roles used below:

- `SA` = a user with the `super_admin` role
- `AD` = a user with the `admin` role (but NOT super_admin)
- `U`  = a normal `user`

> Tip: in dev you can set `AUTH_BYPASS=true` to skip auth, but the role-based
> rules below can only be exercised with real tokens.

---

## Authorization gates

- [ ] No token → every `/admin/users*` route returns `401`.
- [ ] Token with only `user` role → every `/admin/users*` route returns `403`.
- [ ] `AD` and `SA` tokens → list/detail/analytics return `200`.

## GET /admin/users (list + filters)

- [ ] `GET /admin/users` returns `{ items, total, page, pageSize }`.
- [ ] No `password_hash` / `refresh_token_hash` field appears anywhere in the response.
- [ ] Soft-deleted users are hidden by default.
- [ ] `?accountStatus=deleted` shows soft-deleted users.
- [ ] `?search=<name|email|phone fragment>` narrows results (ILIKE).
- [ ] `?role=admin` returns only users holding the `admin` role.
- [ ] `?emailVerified=true` / `false` filters correctly.
- [ ] `?accountStatus=disabled` filters correctly.
- [ ] `?primaryRegionId=<id>` filters correctly.
- [ ] `?createdFrom=2026-01-01T00:00:00Z&createdTo=...` bounds the `created_at` range.
- [ ] `?page=2&pageSize=5` paginates; `total` stays constant across pages.
- [ ] `pageSize=500` is rejected (`400`, max 100).

## GET /admin/users/:id

- [ ] Valid public_id → `200` with full detail (roles, total_points, lifetime points,
      saved_places_count, admin_note, preferred_language, timestamps).
- [ ] Unknown UUID → `404`.
- [ ] Non-UUID id → `400`.

## PATCH /admin/users/:id/status

- [ ] `AD` disables a normal `U` (`{"accountStatus":"disabled"}`) → `200`, status updated.
- [ ] Disabled user can no longer log in (`/auth/login` blocked).
- [ ] `AD` re-enables (`active`) the same user → `200`.
- [ ] `AD` tries to disable an `admin`/`super_admin` target → `403`.
- [ ] `AD` tries `accountStatus=deleted` → `403` (super_admin only).
- [ ] `SA` sets `deleted` on a normal user → `200`; `deleted_at` is set; user hidden from default list.
- [ ] Changing your **own** status → `400` (self-lockout guard).
- [ ] Audit row created in `system.audit_logs` (`admin_user_status_changed`) for each real change.
- [ ] No-op status (same value) does not create a duplicate audit row.

## PATCH /admin/users/:id/admin-note

- [ ] `AD`/`SA` sets `{"adminNote":"watch this account"}` → `200`, note saved.
- [ ] `{"adminNote":null}` clears the note → `200`.
- [ ] Note > 2000 chars → `400`.
- [ ] Audit row created (`admin_user_note_updated`) with before/after note.

## POST /admin/users/:id/roles

- [ ] `SA` assigns `admin` to a user → `200`, role appears in `roles`.
- [ ] `SA` assigns `super_admin` → `200`.
- [ ] `AD` tries to assign `admin` or `super_admin` → `403`.
- [ ] `AD` assigns a non-privileged role (e.g. `editor`) → `200`.
- [ ] Assigning a role the user already has → `200`, idempotent, no duplicate audit row.
- [ ] Unknown role code → `400`.
- [ ] Audit row created (`admin_user_role_assigned`).

## DELETE /admin/users/:id/roles/:roleCode

- [ ] `SA` removes `admin` from a user → `200`, role gone.
- [ ] `AD` tries to remove `admin`/`super_admin` → `403`.
- [ ] `AD` removes a non-privileged role → `200`.
- [ ] Removing your **own** privileged role → `400` (self-demotion guard).
- [ ] Removing a role the user does not have → `404`.
- [ ] Unknown role code → `400`.
- [ ] Audit row created (`admin_user_role_removed`).

## Analytics

- [ ] `GET /admin/users/analytics/summary` returns all 12 metrics as integers.
- [ ] `GET /admin/users/analytics/growth?bucket=day&days=30` returns a 31-point
      continuous series (zero-filled buckets), oldest → newest.
- [ ] `bucket=week` and `bucket=month` also work.
- [ ] `days=0` or `days=500` → `400`.
- [ ] `GET /admin/users/analytics/by-role` lists every role with a count (zero-inclusive).
- [ ] `GET /admin/users/analytics/by-region` returns region_id/region_name/count,
      including an `null/null` row for users with no region.
- [ ] `GET /admin/users/analytics/points` returns awarded/removed/net/entries/users_with_points.
- [ ] `GET /admin/users/analytics/saved-places` returns total/users/distinct counts.
- [ ] Analytics routes are reachable for `AD` and `SA`, blocked for `U`.
- [ ] `/admin/users/analytics/summary` resolves to the analytics handler, NOT
      `GET /admin/users/:id` (static path wins over `:id`).

## Route coexistence

- [ ] `GET /admin/users/:id/points` (points module) still works alongside the new routes.
- [ ] `PATCH /admin/users/:id/status` and `POST /admin/users/:id/roles` do not collide
      with `:id/points`.

## Dashboard-support read endpoints (added with the dashboard pages)

- [ ] `GET /admin/users/:id/audit?limit=50` returns recent audit entries for that user
      (newest first); unknown user → `404`; blocked for `U`.
- [ ] `GET /admin/users/analytics/points-by-reason` returns one row per reason_code with
      net/awarded/removed/entries.
- [ ] `GET /admin/points/ledger` returns a paginated cross-user ledger feed with
      `user_display_name`/`created_by_display_name`; `?userId=<uuid>` and
      `?reasonCode=...` filter correctly; blocked for `U`.
- [ ] `GET /admin/points/top-users?limit=20` ranks users by current balance (excludes
      soft-deleted); blocked for `U`.

## Dashboard pages (apps/dashboard)

- [ ] Sidebar shows a "User Management" section with Users, Analytics, Point Management.
- [ ] `/dashboard/users`: summary cards, filters (search/role/verified/status/region),
      pagination, row click → detail.
- [ ] `/dashboard/users/[id]`: profile, verified/status badges, roles, points + history,
      saved-places count, admin note, audit history.
- [ ] Detail actions: status apply, role add/remove, save/clear admin note, apply points;
      API errors (e.g. admin editing an admin) surface in the banner.
- [ ] `/dashboard/point-management`: adjust-points form, recent ledger with user/reason
      filters + pagination, top point users (Use fills the form).
- [ ] `/dashboard/user-analytics`: KPI cards + Recharts (new users line, by-role bar,
      by-region bar, points-by-reason bar); bucket/day-range selectors update the line.

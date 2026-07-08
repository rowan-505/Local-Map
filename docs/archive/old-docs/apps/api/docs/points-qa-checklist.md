---
status: archived
reason: replaced by docs/archive/old-docs/apps/api/docs/points-qa-checklist.md
archived_at: 2026-07-01
---

# Point Management API — Manual QA Checklist

Admin-managed points. `contrib.point_ledger` is the source of truth (append-only);
`contrib.user_point_summary` is a fast cache. Mistakes are corrected with a **reversal
row**, never by editing/deleting ledger rows.

```bash
export API=http://localhost:3001
export USER_TOKEN=<access token for a normal user>
export ADMIN_TOKEN=<access token for an admin / super_admin>
export TARGET=<target user public_id (uuid)>
```

> With `AUTH_BYPASS=true`, `/me/*` returns `401` (dev subject has no real user row),
> and admin actions record `created_by`/`actor_user_id` as NULL. Test `/me/*` with a real user.

## Authorization

- [ ] `GET /me/points` and `GET /me/point-history` without a token → `401`.
- [ ] `GET/POST /admin/users/:id/points` without a token → `401`.
- [ ] `GET/POST /admin/users/:id/points` with a **user** (non-admin) token → `403`.
- [ ] Same admin routes with `admin` or `super_admin` token → allowed.

## POST /admin/users/:id/points (grant)

```bash
curl -i -X POST "$API/admin/users/$TARGET/points" -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"pointsDelta":10,"reasonCode":"valid_contribution","note":"good edit"}'
```

- [ ] `201` with `{ ledger, summary }`.
- [ ] `summary.total_points` increased by 10 and `lifetime_points_earned` increased by 10.
- [ ] A new row exists in `contrib.point_ledger` (delta 10, reason `valid_contribution`, `created_by` = admin id).
- [ ] A `system.audit_logs` row exists: `action_type='admin_points_adjusted'`, `entity_type='auth_user'`, before/after snapshots present.
- [ ] First-ever grant to a user creates their `user_point_summary` row.

## POST (deduct / penalty)

```bash
curl -i -X POST "$API/admin/users/$TARGET/points" -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d '{"pointsDelta":-5,"reasonCode":"spam_penalty"}'
```

- [ ] `total_points` decreased by 5; `lifetime_points_removed` increased by 5; `lifetime_points_earned` unchanged.

## POST (reversal of a mistake)

- [ ] To undo a wrong +10, POST `{"pointsDelta":-10,"reasonCode":"reversal","note":"reverses ledger #N"}`.
- [ ] The original ledger row is **unchanged**; a new reversal row is added; summary nets out.

## POST validation

- [ ] `pointsDelta: 0` → `400`.
- [ ] Unknown `reasonCode` → `400`.
- [ ] `:id` not a uuid → `400`.
- [ ] `:id` is a valid uuid but no such (or soft-deleted) user → `404 User not found`.
- [ ] Extra/unknown body fields → `400` (additionalProperties false).

## GET /admin/users/:id/points

```bash
curl -i "$API/admin/users/$TARGET/points?limit=20" -H "Authorization: Bearer $ADMIN_TOKEN"
```

- [ ] `200` with `{ summary, history }`; `history` newest-first, capped by `limit` (default 50, max 100).
- [ ] Unknown user → `404`.

## GET /me/points and /me/point-history

```bash
curl -i "$API/me/points" -H "Authorization: Bearer $USER_TOKEN"
curl -i "$API/me/point-history?limit=10" -H "Authorization: Bearer $USER_TOKEN"
```

- [ ] `/me/points` returns the caller's summary; zeros (`updated_at: null`) if they have no ledger yet.
- [ ] `/me/point-history` returns only the caller's own ledger entries, newest-first.
- [ ] Responses never expose internal numeric user ids or `created_by`.

## Out of scope (should NOT exist)

- [ ] No automatic report rewards, badges, leaderboard, or reward shop.
- [ ] No endpoint edits or deletes existing `point_ledger` rows.

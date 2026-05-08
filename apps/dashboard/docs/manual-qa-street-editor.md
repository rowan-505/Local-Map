# Manual QA — Street editor (dashboard)

Run against a dev/staging environment with API + Postgres reachable. Check each item; note failures with screen, request id, and approximate time.

## Prerequisites

- Dashboard app running (e.g. `apps/dashboard`).
- API running and `NEXT_PUBLIC_*` (or equivalent) points at it.
- DB read access for verification queries (optional but needed for DB checklist items).
- Baseline map data around Kyauktan so snap/split tests have geometry to snap to.

---

## Create street

| # | Step | Pass |
|---|------|------|
| 1 | Open `/streets/new`. | ☐ |
| 2 | Confirm the map centers on Kyauktan (default view). | ☐ |
| 3 | Draw a **LineString** centerline (at least two vertices). | ☐ |
| 4 | Select a **road class** (required). | ☐ |
| 5 | Optionally add **Myanmar** and/or **English** names (both may be empty; server uses canonical fallback). | ☐ |
| 6 | Click **Save**. If validate-geometry returns **errors**, save is blocked; if **warnings** only, confirm the dialog: *“This street has topology warnings. Save anyway?”* then save. | ☐ |
| 7 | After redirect to edit, verify a row exists in `core.core_streets` for the new street (match `public_id` or id from URL). Check `routing_status = 'needs_rebuild'` and `manual_override = true` if your schema exposes them. | ☐ |
| 8 | If names were entered, verify corresponding rows in `core.core_street_names` (language/script as expected). | ☐ |

---

## Edit street

| # | Step | Pass |
|---|------|------|
| 1 | Open an existing street: `/streets/{id}/edit`. | ☐ |
| 2 | Confirm the map **flies** to the street extent. | ☐ |
| 3 | Confirm the **selected street** is visually **highlighted** on the map. | ☐ |
| 4 | Confirm **vertices** are visible on the line (edit mode). | ☐ |
| 5 | **Move** at least one vertex; geometry should update. | ☐ |
| 6 | **Save** (road class must remain selected). Geometry patch path should run validate-geometry; attribute-only save should skip it. | ☐ |
| 7 | Verify a new row in **`core.core_street_versions`** for that `street_id` (latest `version_no` / `created_at`). | ☐ |
| 8 | On the street row in **`core.core_streets`**, verify `routing_status = 'needs_rebuild'` (and `manual_override = true` if applicable). | ☐ |
| 9 | Reload `/streets/{id}/edit` and confirm the moved vertex remains in the saved geometry. | ☐ |

---

## Validate geometry

| # | Step | Pass |
|---|------|------|
| 1 | Draw or adjust a centerline that is **topologically questionable** (e.g. visibly **disconnected** from the network, or scenario your validator flags with warnings). | ☐ |
| 2 | Click **Validate geometry**. | ☐ |
| 3 | Confirm **warnings** (and/or errors) appear in the validation feedback panel as expected. | ☐ |
| 4 | Attempt **Save**: if only **warnings**, confirm you must accept *“This street has topology warnings. Save anyway?”* before the save proceeds; **errors** should **block** save without that success path. | ☐ |

---

## Snap

| # | Step | Pass |
|---|------|------|
| 1 | **Enable snap** in the street editor toolbar (or map control as implemented). | ☐ |
| 2 | Move a line **endpoint** near an **existing** street centerline. | ☐ |
| 3 | Confirm the endpoint **snaps** to that geometry within **5 m** (visually or by reading coordinates before/after if you have a debug readout). | ☐ |

---

## Split

| # | Step | Pass |
|---|------|------|
| 1 | Open an existing splittable street on the edit page (valid single LineString, no blocking parse warnings if your UI requires that). | ☐ |
| 2 | Click **Split road** (or equivalent). | ☐ |
| 3 | Click a **point on the line** where the split should occur. | ☐ |
| 4 | Confirm the operation completes and you land on an edit page for a **new** segment (or see success messaging). | ☐ |
| 5 | Verify the **original** street is **inactive** / soft-deleted per product rules (e.g. `deleted_at` set or status flag in `core.core_streets`). | ☐ |
| 6 | Verify **two new** street rows in `core.core_streets` linked to the split result. | ☐ |
| 7 | Verify **names** (or canonical naming rules) **copied** / present on new segments per `core.core_street_names` or canonical fields. | ☐ |
| 8 | Verify **`routing_status = 'needs_rebuild'`** on affected rows. | ☐ |

---

## Reference queries (adapt ids)

```sql
-- Latest street by public_id from URL
select id, public_id, routing_status, manual_override, deleted_at, updated_at
from core.core_streets
where public_id = '<uuid-from-url>';

-- Names
select *
from core.core_street_names
where street_id = (select id from core.core_streets where public_id = '<uuid-from-url>')
order by id;

-- Version history after edit
select street_id, version_no, created_at, action_type, edit_reason
from core.core_street_versions
where street_id = (select id from core.core_streets where public_id = '<uuid-from-url>')
order by version_no desc
limit 5;
```

# Import-review naming contract

This document defines how candidate **name fields** relate to each other for import-review list, detail, and direct-edit UI. All dashboard and API mappers must follow it.

**Related:** [direct-edit-runtime-qa.md](./direct-edit-runtime-qa.md) (PATCH persistence), dashboard helpers in `apps/dashboard/src/features/import-review/utils/importReviewNaming.ts`, API mappers in `apps/api/src/modules/import-review/import-review-effective-values.ts` and `import-review-name-fields.ts`.

---

## Field meanings

### 1. `name_mm`

- **Meaning:** Reviewer-approved Myanmar name.
- **Storage:** Editable typed column on the candidate row (`import_review.*_candidates.name_mm`).
- **UI:** Primary current value for Myanmar labels (list column, detail summary, direct-edit form).
- **PATCH:** Included in direct-edit `fields` when the reviewer changes Myanmar name.

### 2. `name_en`

- **Meaning:** Reviewer-approved English name.
- **Storage:** Editable typed column on the candidate row.
- **UI:** Primary current value for English labels.
- **PATCH:** Included in direct-edit `fields` when the reviewer changes English name.

### 3. `canonical_name`

- **Meaning:** Best internal fallback / search / display name from import or pipeline.
- **May be derived from** `name_mm`, `name_en`, or source names over time.
- **UI rule:** Must **not** override `name_mm` or `name_en` in list cells, drawer titles, or edited-truth displays. Use only after typed names are absent (title fallback chain) or for search/filter APIs that explicitly target canonical.

### 4. `display_name`

- **Meaning:** Legacy or source-derived display label (especially places).
- **UI rule:** Avoid as current edited truth. Kept for API/DB compatibility and source context only.

### 5. `primary_name`

- **Meaning:** Legacy or source primary imported name (especially places).
- **UI rule:** Avoid as current edited truth. Kept for compatibility and source helper text.

### 6. `normalized_data.tags.name`

- **Meaning:** Original imported source name (typically OSM `tags.name`).
- **UI rule:** Read-only source context. Shown as **Imported/source name** in helpers. **Never** treated as the saved result of a direct edit.

### 7. `effective_name_*` (`effective_name`, `effective_name_mm`, `effective_name_en`, …)

- **Meaning:** Legacy compatibility output for older clients and fields.
- **Computation (API):** Typed column first, then imported/source fallback (`deriveImportReviewNames` / `pickEffectiveName*`).
- **UI rule (dashboard):** Do **not** use for list columns or primary display after direct-edit migration. Prefer `name_mm` / `name_en` and `getImportReviewDisplayName()`.

---

## UI priority rules

### List table columns (Myanmar / English name)

| Column        | Display rule                                      |
|---------------|---------------------------------------------------|
| Myanmar name  | `name_mm` only, or `—` if empty                   |
| English name  | `name_en` only, or `—` if empty                   |

Do **not** fill typed name columns from `effective_name_*`, `canonical_name`, or `normalized_data`.

### Title / primary label (`getImportReviewDisplayName`)

1. `name_mm`
2. `name_en`
3. `canonical_name`
4. `display_name`
5. `primary_name`
6. `normalized_data.tags.name`
7. `external_id`
8. Fallback: `{entity label} {id}`

### Source helper text (`getImportReviewSourceImportedName`)

Show once near name fields or in summary as **Imported/source name**, using first non-empty of:

1. `normalized_data.tags.name`
2. `primary_name`
3. `display_name`
4. `canonical_name`

This is **context only**, not the saved typed value.

### Direct-edit form

- Inputs bind to typed columns (`name_mm`, `name_en`) via PATCH.
- Empty typed field does **not** auto-display source name inside the input (helper text only).
- `normalized_data` / `source_refs` panels remain read-only.

---

## API list vs detail

- **List (lightweight):** Must SELECT typed `name_mm` / `name_en` from DB so list JSON matches detail after save. `normalized_data` in list responses may be stubbed `{}` for payload size; do not rely on it for current names on list rows.
- **Detail / PATCH response:** Full row including typed names and full `normalized_data` for source panels.

---

## Code map

| Concern | Location |
|---------|----------|
| Display title | `getImportReviewDisplayName()` |
| Source label | `getImportReviewSourceImportedName()` |
| List column defs | `getImportReviewNameColumns()` |
| Table cell | `formatCandidateName()` / `renderImportReviewNameTableCell()` |
| API effective fields | `applyBilingualNameFields()` in `import-review-effective-values.ts` |
| API row mapper | `mapBuildingRow()` → `applyImportReviewEffectiveFields()` |
| Name derivation | `import-review-name-fields.ts` (`pickEffectiveNameMm` / `pickEffectiveNameEn`) |

---

## Non-goals

- Do not use `review_overrides` JSON for names (removed; typed columns only).
- Do not change DB schema in UI-only contract updates.
- Promotion logic may still read canonical/import fields where historically required; this contract governs **reviewer-facing display and direct edit** only.

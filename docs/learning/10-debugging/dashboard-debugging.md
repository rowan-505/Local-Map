---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: Dashboard troubleshooting
---

# Dashboard debugging

## Common issues

| Issue | Check |
|-------|-------|
| API errors in UI | `NEXT_PUBLIC_API_BASE_URL`, network tab |
| Import-review auth | Token header vs JWT mode — [Import review API](../03-api/import-review-api.md) |
| Basemap fails in prod | `basemapEnv.ts` localhost guard, `NEXT_PUBLIC_BASEMAP_*` |
| Map editor save fails | API validation errors in response body |
| Strict Mode double fetch | `isAbortError` in `api.ts` |

## Street editor QA (archive)

[`manual-qa-street-editor.md`](../archive/old-docs/apps/dashboard/docs/manual-qa-street-editor.md)

## Related docs

- [Dashboard overview](../05-dashboard/dashboard-overview.md)
- [Geometry editor](../05-dashboard/geometry-editor.md)

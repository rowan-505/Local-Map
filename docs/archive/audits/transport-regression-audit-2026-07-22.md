# Transport production regression audit — 2026-07-22

**Audit type:** read-only  
**Auditor window:** 2026-07-22 (UTC+9 / UTC)  
**Production API:** `https://api.coremapmm.com`  
**Production DB:** Supabase project `locghyuranqaqsnbxflc`  
**Local workspace HEAD:** `c8313df26e433c720ab968c41d6436d66763d045` (`v0.20.0 - prepare bulk import pipeline from osm`)  
**Production data modified during audit:** **No** (SELECT / GET / failed DELETE body parse / merge ack rejection only)

---

## 1. Executive summary

Three **confirmed** code/schema defects explain the main transport regressions. A fourth class of failures (401) is correct auth behavior, not a server bug. Several dashboard 500s reported earlier for overview / quality / queues were **not reproducible** on 2026-07-22 with a valid admin JWT; production currently returns 200 for those admin reads.

| # | Confirmed defect | Current prod status | Severity |
|---|---|---|---|
| A | Dashboard `DELETE /transport/route-stops/:id` sends `Content-Type: application/json` with **no body** → Fastify `FST_ERR_CTP_EMPTY_JSON_BODY` → **HTTP 400** | Still broken | P1 |
| B | Merge-preview selected `stops.admin_area_id` as **bigint** → `JSON.stringify` BigInt error → **HTTP 500** | Fixed in `c8313df`; prod returns **200** | Was P1 |
| C | Public route path applies `sqlPublicReleaseVisible` to `transport.fares`, which has **no `deleted_at` column** → SQLSTATE **42703** → **HTTP 500** | Still broken (unauthenticated / non-admin `GET /transport/routes`) | P1 |
| D | Missing/expired JWT → **401** (or missing token on optional-auth GETs falls through to public path → C) | Expected / amplified by C | P2 / UX |

**Data repair impact:** Admin-link repair filled `transport.stops.admin_area_id` for ~12,097 of 12,461 active stops (364 remain null). That **did not delete transport rows**; it **amplified** defect B by making BigInt values common in merge-preview responses. Repair did **not** cause defect A or C.

**Glyph `9472-9727.pbf` 404:** No evidence linking it to API 500s; treat as separate frontend font asset issue (P3).

---

## 2. Last known-good version

| Surface | Last known-good (evidence) |
|---|---|
| Admin transport overview / quality / queues / admin route list | Still good on prod + local with valid admin JWT at audit time (`c8313df` / Render health 200) |
| Merge-preview for stops **with** `admin_area_id` | **Broken until** API deploy of `c8313df` (bigint fix). Stops with `NULL` admin_area_id could still succeed earlier |
| Remove-stop-from-route (no reason text) | **Never reliably good** since `b60cd3d` (v0.18.0) for the empty-body path; archive-stop was later patched to send `{}`, remove-stop was not |
| Unauthenticated public `GET /transport/routes` (when fare load runs) | Broken since public visibility helper applied to fares (`fc4c817` / `ac37673` era) vs live `transport.fares` shape |

There is **no single** last-known-good commit for “all transport dashboard APIs.” Failures have different introduction points.

---

## 3. First known-bad version

| Defect | First bad (code) | First noticeable in ops |
|---|---|---|
| A — DELETE empty JSON body | `b60cd3d` (2026-06-24, v0.18.0) — `removeTransportRouteStop` | Anytime user removes a stop without typing a reason |
| B — merge-preview BigInt | Introduced with merge-preview selecting `admin_area_id` without cast (transport merge work on `main` before `c8313df`) | Surge after **2026-07-22 admin-link repair** filled most `admin_area_id` values |
| C — fares.`deleted_at` | `sqlPublicReleaseVisible("f")` in `transport-public.repo.ts` (`fc4c817` / related public release) against live schema without `deleted_at` | Any anonymous / non-admin `GET /transport/routes` that loads fares |
| Fix for B | `c8313df` (2026-07-22 20:21 +0900) | Prod merge-preview now 200 with `mergeAllowed` |

---

## 4. Confirmed root causes

### RC-1 — Remove route-stop HTTP 400 (empty JSON body)

**Evidence**

- Local (valid admin JWT), `DELETE /transport/route-stops/1` with `Content-Type: application/json` and **no body**:
  - Status: **400**
  - Body: `{"message":"Body cannot be empty when content-type is set to 'application/json'"}`
- Same call with `body: '{}'` → **404** `Transport route stop not found: 1` (proves auth + schema accept empty object; no production row touched).

**Source**

```1007:1021:apps/dashboard/src/features/transport/api.ts
export function removeTransportRouteStop(
    id: string,
    reason?: string,
    fetchInit?: Pick<RequestInit, "signal">
) {
    const trimmedReason = reason?.trim();
    return apiFetch<TransportRouteStopMutationResult>(
        `/transport/route-stops/${encodeURIComponent(id)}`,
        {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            ...(trimmedReason ? { body: JSON.stringify({ reason: trimmedReason }) } : {}),
            ...fetchInit,
        }
    );
}
```

Contrast: `archiveTransportStop` always sends `JSON.stringify(body)` with `{}` when no reason (same file ~672–691), with an explicit comment about Fastify empty-body rejection.

Backend schema documents optional body (`transport.schema.ts` deleteRouteStop body; OpenAPI `deleteRouteStopSchema`).

**Reproduction**

1. Authenticate as admin.
2. `DELETE /transport/route-stops/<id>` with header `Content-Type: application/json` and no body.
3. Observe 400 before service/SQL runs.

**Not causes:** route-stop ID confusion, inactive parent, sequence constraint, audit-log failure (none reached).

---

### RC-2 — Merge-preview HTTP 500 (BigInt serialization) — fixed on prod

**Evidence (prior session + code)**

- `transport.stops.admin_area_id` is **bigint**.
- Preview SQL selected it without numeric cast; Prisma returned `BigInt`.
- Response fields `adminAreaId` / `fieldComparison.admin_area_id` hit:
  - `TypeError: Do not know how to serialize a BigInt` → HTTP 500.

**Amplifier (data repair, proven counts)**

| Metric (active stops, `deleted_at IS NULL`) | Count |
|---|---:|
| Total | 12,461 |
| `admin_area_id` set | 12,097 |
| `admin_area_id` null | 364 |

Baseline doc `tools/data-repair/current-production/PRODUCTION_BASELINE_V1.md` lists transport.stops missing admin as **364** after repair — matches live count. Repair **assigned** admin areas; it did not delete the stop population for this check.

**Fix commit:** `c8313df` — `admin_area_id::float8`, `jsonSafeNumber` / `jsonSafeId` in `stopMergePreview.ts` / `transport.repo.ts`.

**Current prod:** authenticated merge-preview returns **200** with numeric `adminAreaId` and `mergeAllowed`.

---

### RC-3 — Public `GET /transport/routes` HTTP 500 (`fares.deleted_at` missing)

**Evidence**

- Prod unauthenticated: `GET https://api.coremapmm.com/transport/routes?limit=2` → **500**  
  `{"message":"We could not load this data right now. Please try again in a moment."}`
- Local same call without auth → **500**.
- Local/prod **with admin JWT** → **200** (admin `TransportService.listRoutes`, no fare visibility SQL).

**Live schema (Supabase MCP SELECT on `information_schema`)**

| Column on `transport.fares` | Present? |
|---|---|
| `is_active` | yes |
| `review_status` | yes |
| `deleted_at` | **no** |

**Failing code**

```69:76:apps/api/src/modules/transport/transport-public-visibility.ts
export function sqlPublicReleaseVisible(alias: string): Prisma.Sql {
    const a = Prisma.raw(alias);
    return Prisma.sql`
        ${a}.review_status IN ('reviewed', 'verified')
        AND ${a}.is_active = true
        AND ${a}.deleted_at IS NULL
    `;
}
```

Applied to fares:

```509:524:apps/api/src/modules/transport/transport-public.repo.ts
    private async loadRouteFareByCode(routeCode: string): Promise<PublicTransportFare | null> {
        const rows = await this.prisma.$queryRaw<FareRow[]>`
            ...
            FROM transport.fares f
            JOIN transport.routes r ON r.id = f.route_id
            WHERE r.route_code = ${routeCode}
              AND ${sqlPublicReleaseVisible("r")}
              AND ${sqlPublicReleaseVisible("f")}
```

**Exact DB error (prior stack capture):** Prisma `P2010` / SQLSTATE **`42703`**: `column f.deleted_at does not exist`.

**Why dashboard “sometimes” 500 on route list**

- Optional-auth GET: **no** `Authorization` → treated as public → hits RC-3 → **500**.
- Invalid/expired Bearer → **401** (`transport.routes.ts` onRequest ~262–274).
- Valid admin → admin list → **200**.

So intermittent route-list 500s are explained by **auth absence + public fare SQL**, not by random DB corruption.

**Schema note:** Original migration `067_create_core_transport_schema.sql` defined `core_transport.fares` **with** `deleted_at`, but live `transport.fares` is a **different shape** (`fare_type`, `amount_min`/`amount_max`, no `deleted_at`). API assumes soft-delete columns that the live table does not have.

---

### RC-4 — HTTP 401 is auth, not transport SQL

**Evidence**

- Prod `GET /transport/overview` without auth → **401** `No Authorization was found…`
- Prod merge-preview without auth → **401**
- Invalid Bearer → **401** (malformed/invalid token)
- Merge-preview path distinguishes auth errors from 500 (post-`c8313df`)

Dashboard may surface these as “transport failed” when the session expired.

---

## 5. Probable causes still requiring evidence

| Topic | Status | Notes |
|---|---|---|
| Overview / quality-summary / queues **500** after repair | **Not reproduced** with valid admin JWT (local+prod 200) | Possible historical: deploy mismatch, pool timeout under heavy `core_streets` repair scans, or expired session misreported. Postgres logs showed long street scans and PostgREST `pg_pgrst_no_exposed_schemas` noise (API uses Prisma; PostgREST noise is not proof of API failure). |
| Merge **execution** 500 | Not re-run as a successful write (audit forbids prod mutation). With current code, same-variant merge without ack returns **409** `MERGE_VARIANT_ACK_REQUIRED`. Pre-fix, preview 500 blocked the flow before write. Residual bigint in merge **response** after write not proven. |
| Nearby localhost vs production differences | Both return **200** for nearby-candidates when authenticated. One live **mode-mismatched** stop membership (`stops.mode` ≠ `routes.mode`) can change candidate sets when UI filters by mode. Data quirk, not API outage. |
| Render vs Vercel commit skew | Prod API behavior matches `c8313df` merge-preview response shape; dashboard empty-body bug still in tree (not fixed). Exact Render/Vercel build SHAs not read from vendor UIs in this pass. |

---

## 6. Database repair impact

**Sources:** `tools/data-repair/current-production/` (README, `PRODUCTION_BASELINE_V1.md`, reports), backup tables `system.repair_*`, live counts.

| Repair effect | Proven? | Transport impact |
|---|---|---|
| Assigned `admin_area_id` on stops/terminals/infra | **Yes** — stops with admin 12,097; null 364 | Amplified merge-preview BigInt 500 |
| Deleted transport routes/stops wholesale | **No evidence** — overview still shows large counts (e.g. routes 215, stops 12,461) | Not a deletion outage |
| Changed `is_active` / `review_status` as primary outage cause | **Not proven** for the listed 500/400 | Review queues still load |
| Backup tables queried by app SQL | **No evidence** in transport repo SQL of `system.repair_*` | N/A |
| Migrations 136–137 (`import_work`, OSM identity helpers) | Present in repo; not the fare/`deleted_at` bug | Pipeline, not dashboard remove/merge |

**Conclusion:** Repair changed **admin linkage data**. It did not invent the empty-body or fares.`deleted_at` bugs. It made merge-preview failures **much more frequent**.

---

## 7. Schema drift findings

| Object | Migration / code assumption | Live production | Impact |
|---|---|---|---|
| `transport.fares.deleted_at` | `sqlPublicReleaseVisible` requires it; 067 `core_transport.fares` had it | **Missing** on `transport.fares` | Public route list 500 |
| `transport.fares` column set | Historical product-code shape in 067 | Live: `fare_type`, `amount_min`/`max`, `is_active`, `review_status`, … | Drift; API public fare SQL partially adapted but still uses soft-delete predicate |
| `transport.stops.admin_area_id` | bigint | bigint | Merge-preview serialization (fixed) |
| Soft-delete on routes/stops/variants | `deleted_at` present | Present (used widely) | OK for those tables |
| Invalid views | Not exhaustively enumerated | Admin overview/queues work | No proof of invalid transport views blocking admin reads |

---

## 8. Production / local environment drift

| Check | Local | Production |
|---|---|---|
| API health | `localhost:3001` (dev) | `https://api.coremapmm.com/health` → 200 `{"ok":true}` |
| Workspace / expected API commit | `c8313df` | Behavior matches merge-preview fix (200 + `mergeAllowed`) |
| Admin overview / quality / queues | 200 | 200 (with admin JWT in prior probes) |
| Unauth `GET /transport/routes` | 500 | 500 |
| `DELETE` empty JSON body | 400 | 400 with valid admin JWT (prior probe); unauth → 401 before body issue |
| JWT | Local `JWT_SECRET` HS256 test tokens | Same pattern; missing/expired → 401 |
| Glyph PBF | Separate web asset | 404 reported; not API |

No evidence that dashboard gained direct Supabase access. Failures are API contract + public SQL + client Content-Type.

---

## 9. Endpoint-by-endpoint results

| Method | URL | Auth | Expected | Actual (audit) | Notes |
|---|---|---|---|---|---|
| GET | `/health` | none | 200 | 200 | OK |
| GET | `/transport/overview` | admin | 200 | 200 | OK |
| GET | `/transport/overview` | none | 401 | 401 | OK |
| GET | `/transport/quality-summary` | admin | 200 | 200 | OK |
| GET | `/transport/data-quality/queues` | admin | 200 | 200 | OK |
| GET | `/transport/routes?limit=N` | admin | 200 | 200 | Admin path |
| GET | `/transport/routes?limit=2` | none | 200 | **500** | RC-3 |
| GET | `/transport/stops/nearby-candidates` | admin | 200 | 200 | OK |
| POST | `/transport/stops/merge-preview` | admin | 200 | 200 | Fixed RC-2 |
| POST | `/transport/stops/merge-preview` | none | 401 | 401 | OK |
| POST | `/transport/stops/merge` (no same-variant ack) | admin | 409 | 409 | Guard works; no write |
| DELETE | `/transport/route-stops/:id` no body + JSON CT | admin | 200/404 | **400** | RC-1 |
| DELETE | `/transport/route-stops/:id` body `{}` | admin | 404 if fake id | 404 | Schema OK |
| GET | route detail / variants / path gen / review-action / timing | — | — | **Unverified** this pass | See §13 |

---

## 10. Broken feature inventory

| Severity | Feature | UI action | Endpoint | Actual status | Exact error | Root cause | Introduced by | Data impact | Recommended fix | Test needed |
|---|---|---|---|---|---|---|---|---|---|---|
| P1 | Remove stop from route (no reason) | Remove stop without reason text | `DELETE /transport/route-stops/:id` | 400 | `Body cannot be empty when content-type is set to 'application/json'` | Dashboard omits body while setting JSON Content-Type | `b60cd3d` `removeTransportRouteStop` | None (fails before SQL) | Always `JSON.stringify({})` or drop Content-Type when empty (mirror `archiveTransportStop`) | Unit + dashboard e2e remove without reason |
| P1 | Public / anonymous route list (and dashboard when token missing) | Open public map routes or dashboard with no Authorization | `GET /transport/routes` (public path) | 500 | SQLSTATE 42703 `column f.deleted_at does not exist` | `sqlPublicReleaseVisible("f")` on table without `deleted_at` | Public visibility + fare load (`fc4c817` era) | None (read fails) | Stop applying `deleted_at` to fares **or** migrate add `deleted_at`; prefer SQL match live schema | Public routes smoke without auth; fare present + absent |
| P3 | Map glyphs | Render Myanmar labels | Static `9472-9727.pbf` | 404 | Asset missing | Frontend/font hosting | Unrelated to API | None | Publish glyph range or adjust font stack | Visual smoke on web |

---

## 11. Degraded feature inventory

| Severity | Feature | Issue | Evidence |
|---|---|---|---|
| P2 | Dashboard session expiry UX | Expired JWT → 401; missing JWT on optional GET routes → **500** via public fare bug | onRequest optional-auth + RC-3 |
| P2 | Nearby candidates consistency | Mode filter + 1 mode-mismatched stop membership can differ by environment/data | SQL count `mismatched_modes = 1` |
| P2 | Merge flow (historical) | Preview 500 blocked merge UI after admin_area fill | Fixed on API; confirm all dashboard builds call fixed API |
| P3 | PostgREST schema noise | `pg_pgrst_no_exposed_schemas` in DB logs | Not used by Fastify Prisma path; monitor only |

---

## 12. Working feature inventory (verified 2026-07-22)

- API health
- Admin transport overview
- Admin quality-summary
- Admin data-quality queues
- Admin routes list
- Nearby-candidates (authenticated)
- Merge-preview (authenticated, post-fix)
- Merge execution **guard** (409 without same-variant ack; no production write)
- Auth rejection on protected endpoints without token (401)

---

## 13. Unverified feature inventory

Not smoke-tested in this audit pass (do not assume broken or fixed):

- Route detail by `public_id` / route-code edge cases
- Variant ordered stops / stop quality
- Path PUT / delete / generate-from-stops
- Timing / departure-time patches
- Review readiness + review-action (route/stop/path)
- Replace-stop / insert existing / create-and-insert
- Archive stop / permanent delete eligibility
- Terminals / infrastructure lines CRUD
- Import batches / errors / source links UI
- Timetable package dashboard exports (build warnings seen for `@local-map/transport-timetable` re-exports in dashboard dev)

---

## 14. Data integrity assessment

| Check | Result |
|---|---|
| Stops deleted by repair | **Not supported** by counts (12,461 active stops) |
| Admin areas filled | **Yes** — 12,097 / 12,461 |
| Mode mismatch stop↔route | **1** membership row |
| Ferry variants without stops | Quality summary: ferry 8 variants without stops (data quality, not 500) |
| Train variants without path | 61 (data quality) |
| Duplicate / gap sequences | Not fully scanned; merge conflict analysis exists in code |
| Partial merge writes on prod during audit | **None** (409 ack / no successful merge) |

---

## 15. Security findings

| Finding | Severity | Notes |
|---|---|---|
| Admin transport mutations require admin role | OK | Hook enforces admin except optional GET public path |
| Optional-auth GET without token uses **public** data path | By design | Combined with RC-3 produces 500 instead of empty/401 |
| Invalid Bearer on optional GET returns 401 | OK | Prevents silent demotion to public |
| Audit did not extract or log production secrets | — | Local JWT_SECRET used only for localhost probes |
| No production DML performed | — | Confirmed |

---

## 16. Recommended repair order

1. **P1 — Dashboard:** Fix `removeTransportRouteStop` to always send `{}` (or omit Content-Type) — same pattern as `archiveTransportStop`.
2. **P1 — API:** Change `loadRouteFare` / `loadRouteFareByCode` (and any other fare uses of `sqlPublicReleaseVisible`) to predicates that match live `transport.fares` (`is_active` + `review_status` only), **or** add a migration for `deleted_at` if soft-delete is intended.
3. **Confirm** production API stays on `c8313df+` for merge-preview BigInt safety.
4. **Data (optional, non-blocking):** Resolve the single mode-mismatched stop membership; ferry/train quality gaps.
5. **P3:** Fix glyph asset 404 on web.
6. **Hardening:** Consider returning 401 for dashboard clients that expect admin lists when Authorization is absent (product decision), so missing tokens do not hit public SQL.

**Do not** re-run destructive repair scripts as a “fix” for A/C.

---

## 17. Rollback options

| Option | Effect | Risk |
|---|---|---|
| Revert dashboard only (post-body fix) | N/A until fix lands | — |
| Redeploy API pre-`c8313df` | **Would restore** merge-preview BigInt 500 | Do **not** rollback past bigint fix |
| Revert admin_area_id repair from `system.repair_*` backups | Would restore many NULL admin_area_ids; reduce BigInt exposure only if old API redeployed | High risk; unnecessary if bigint fix stays |
| No schema rollback needed for DELETE 400 | Client-only | — |

Preferred: **forward fixes** for A and C; keep merge BigInt fix.

---

## 18. Required tests before redeployment

- [ ] API typecheck
- [ ] Unit: `stopMergePreview` / merge-preview repo tests
- [ ] Unit/integration: public `listRoutes` with fare rows present (assert no 42703)
- [ ] Contract: unauthenticated `GET /transport/routes` → 200
- [ ] Contract: admin `DELETE /route-stops/:id` with no reason → not 400 (404/200/409 as appropriate)
- [ ] Contract: merge-preview with non-null `admin_area_id` → 200, JSON numbers only
- [ ] Dashboard typecheck/build
- [ ] Manual: remove stop without reason; merge preview YBS pair; overview + queues load
- [ ] Migration status check if adding `fares.deleted_at`

---

## Appendix A — Change timeline (condensed)

| When | Commit / artifact | Transport relevance |
|---|---|---|
| 2026-06-24 | `b60cd3d` v0.18.0 | Transport dashboard landing; DELETE empty-body bug |
| 2026-06-25 | `b384a4b` | Typing change on remove client (bug retained) |
| 2026-07-08 | `fc4c817` v0.19.0 | Bus data / public visibility growth |
| 2026-07-10 | `ac37673` v0.19.2 | Train + search; visibility helpers |
| 2026-07-22 | Data repair (admin links, streets, review backlog) | Filled stop `admin_area_id`; backups `system.repair_*` |
| 2026-07-22 | Migrations 136–137 | `import_work` / OSM identity — pipeline |
| 2026-07-22 | `c8313df` v0.20.0 | Merge-preview BigInt fix + import pipeline prep |

## Appendix B — Dependency map (critical paths)

```text
Dashboard removeTransportRouteStop
  → DELETE /transport/route-stops/:id
  → Fastify JSON body parser (fails if CT=json & empty)
  → deleteRouteStopSchema / service.removeRouteStop
  → transport.repo route_stops + audit

Dashboard previewTransportStopMerge
  → POST /transport/stops/merge-preview
  → service → repo.getStopMergePreview
  → stops (+ admin_area_id) + route_stops + variants
  → JSON response (must not contain BigInt)

Dashboard getTransportRoutes (admin session)
  → GET /transport/routes
  → admin listRoutes  [OK]
Unauth / no-admin
  → publicService.listRoutes
  → loadRouteFareByCode + sqlPublicReleaseVisible(f)
  → transport.fares  [FAIL missing deleted_at]

Dashboard getTransportOverview / quality / queues
  → GET admin endpoints → TransportService aggregations
  → [OK at audit time]
```

## Appendix C — Commands / tests run (non-destructive)

- `git rev-parse HEAD` → `c8313df…`
- `curl` prod `/health`, `/transport/routes?limit=2` (no auth), auth-gated probes
- Local JWT admin probes: overview, quality-summary, queues, routes, DELETE empty vs `{}`, public routes
- Supabase MCP `execute_sql` read-only: fares columns, stop admin counts, mode mismatch count
- `apps/api` `npm run typecheck`
- Prior session: merge-preview unit/repo tests; transport module tests (one unrelated float flake noted historically)

---

**Statement:** Production database data was **not** modified during this audit. No migrations, repair scripts, DELETE/UPDATE/INSERT/TRUNCATE/DROP, or deployments were executed as part of this audit task.

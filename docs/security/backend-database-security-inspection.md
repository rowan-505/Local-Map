# Backend ↔ Database Security Inspection

**Date:** 2026-07-22  
**Mode:** Read-only (codebase + live Supabase introspection; no DDL/DML changes)  
**Project:** CoreMap (`locghyuranqaqsnbxflc`, ap-northeast-1)  
**Scope:** How `apps/api` and related runtimes use Postgres/Supabase, and whether previously identified DB privilege issues are reachable through the backend or public clients.

---

## 1. Executive summary

The intended architecture is real and enforced in application code:

```text
web / dashboard / mobile  →  Fastify API (Prisma + DATABASE_URL)  →  Supabase Postgres
                          →  Martin tiles (DATABASE_URL)          →  Supabase Postgres (read)
```

There is **no** runtime use of Supabase JS (`createClient`), `SUPABASE_ANON_KEY`, or `SUPABASE_SERVICE_ROLE_KEY` in app code. Clients talk HTTP to the API (and tile HTTP endpoints). Direct client database access was **not** found.

### Reachability of known DB findings

| Finding | Present in live DB? | Reachable via Fastify backend? | Reachable via Supabase Data API / anon? | Verdict |
| --- | --- | ---: | ---: | --- |
| `public._prisma_migrations` grants to `anon`/`authenticated` | Yes (full DML) | No app usage | **Yes in theory** (table in `public`, schema USAGE granted) | Harden immediately; not used by API |
| `public.spatial_ref_sys` write grants to `anon`/`authenticated` | Yes | No app usage | **Yes in theory** | Revoke writes immediately |
| `EXECUTE` on promote/rebuild/sync/infer for `anon`/`authenticated` | Yes | API uses `postgres` role; revoke does **not** break API | **Blocked today** by missing schema `USAGE` on `core`/`search`/`import_review` | Still revoke EXECUTE (defense in depth) |
| Mutable `search_path` on many functions | Yes (66 advisor warnings) | N/A (privilege issue) | Low while schemas unexposed | Fix gradually; start with admin RPCs |
| Inconsistent RLS | Yes (RLS on/off; many tables RLS-on with **no policies**) | API bypasses RLS as `postgres` | Private schemas lack `USAGE` for anon | Do not rely on RLS for backend-only tables; fix if schemas ever exposed |
| Custom `app_auth` | Yes | Intended design | Schema not usable by anon | Keep; do not force Supabase Auth migration now |

**Bottom line:** The dangerous *grants exist*, but most powerful RPCs are **not currently callable** by `anon`/`authenticated` because those roles lack `USAGE` on `core`, `search`, `import_review`, `app_auth`, etc. The **reachable** Supabase surface is mainly **`public`** (`_prisma_migrations`, `spatial_ref_sys`). Application security risks that *are* reachable today are mostly on the **Fastify API layer** (JWT role staleness, over-broad authenticated reads, shared import-review token), not via PostgREST RPC to private schemas.

---

## 2. Current database access architecture

```text
┌─────────────────┐     HTTP/JSON      ┌──────────────────┐   Prisma / SQL    ┌────────────────────┐
│ apps/web        │ ─────────────────► │ apps/api Fastify │ ────────────────► │ Supabase Postgres  │
│ apps/dashboard  │                    │ DATABASE_URL     │   role: postgres* │                    │
│ apps/mobile     │                    │ (optional IR URL)│                   │ schemas: app_auth, │
└─────────────────┘                    └──────────────────┘                   │ core, search, …    │
         │                                      ▲                             └────────────────────┘
         │ VITE_MARTIN_TILE_URL / CDN           │
         ▼                                      │
┌─────────────────┐   DATABASE_URL              │
│ Martin          │ ────────────────────────────┘
│ (vector tiles)  │
└─────────────────┘

Offline: tools/data-pipeline/*, infrastructure/* scripts via pg / psql / ogr2ogr
```

\*Connection user is typically `postgres` or pooler `postgres.<project_ref>` from `DATABASE_URL` — not Supabase JWT roles `anon` / `authenticated` / `service_role`.

### Runtime paths

| Component | Mechanism | Env | Server/client |
| --- | --- | --- | --- |
| Fastify API | PrismaClient | `DATABASE_URL` | Server |
| Import-review pool (optional) | Separate PrismaClient | `IMPORT_REVIEW_DATABASE_URL` → else `DATABASE_URL` | Server |
| Martin | Config `${DATABASE_URL}` | `DATABASE_URL` | Server |
| Tools / pipelines | `pg` / `psql` / `ogr2ogr` | `DATABASE_URL`, `SUPABASE_DIRECT_DATABASE_URL`, `LOCAL_DATABASE_URL`, … | Operator machine |
| Web / dashboard / mobile | HTTP only | `VITE_API_*`, `NEXT_PUBLIC_API_*`, Martin URL | Client — **no DB URL** |

Evidence:

- Prisma datasource: `apps/api/prisma/schema.prisma` lines 5–8 (`url = env("DATABASE_URL")`).
- Client factory: `apps/api/src/db/prisma.ts` lines 26–38.
- App registration: `apps/api/src/app.ts` lines 129–133, 168–197.
- Martin: `infrastructure/tiles/martin/config.yaml` lines 8–10.
- `@supabase/supabase-js` is listed in `apps/api/package.json` but **never imported** under `apps/api/src`.

---

## 3. Credentials and roles matrix

| Credential / role | Where referenced | Used by | Publicly exposable? | Bypasses RLS? |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | API, Martin, tools, deploy secrets | Postgres login (owner-style) | Must stay server-only | Yes |
| `IMPORT_REVIEW_DATABASE_URL` | API import-review pool | Same-shape Postgres URL | Server-only | Yes |
| `DIRECT_URL` / `SUPABASE_DIRECT_DATABASE_URL` | Tools only | Direct/session Postgres | Operator-only | Yes |
| `LOCAL_DATABASE_URL` / `LOCAL_RAW_DATABASE_URL` | Local tools | Local Postgres | Local only | Yes |
| `JWT_SECRET` | `apps/api/src/plugins/auth.ts:65-68` | Signs/verifies access JWTs | Server-only | N/A |
| `EMAIL_OTP_SECRET` | Auth OTP HMAC | OTP hashing | Server-only | N/A |
| `IMPORT_REVIEW_ADMIN_TOKEN` | API header guard | Synthetic admin for import-review | **High risk if leaked**; dashboard has `NEXT_PUBLIC_*` variant for **dev only** | N/A |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | **Not used** in app runtime | — | — | — |
| DB role `anon` | Live grants | Supabase Data API default | Publishable | Subject to grants/RLS |
| DB role `authenticated` | Live grants | Supabase Auth JWT role | Via Supabase Auth (unused by CoreMap apps) | Subject to grants/RLS |
| DB role `postgres` | API `DATABASE_URL` | Backend | Secret | Yes (bypasses RLS) |
| DB role `service_role` | Grants exist on public tables; **no app JS usage** | Would bypass RLS if used | Must never ship to clients | Yes |

**Masked examples (names only):** local gitignored `.env` files contain live URLs shaped like `postgresql://postgres.***@aws-*-*.pooler.supabase.com:5432/postgres` — not committed (`git check-ignore` confirms pipeline `imports/*.env` is ignored).

---

## 4. Direct client access findings

### Finding D1 — No client Supabase/Postgres clients

| Field | Value |
| --- | --- |
| Severity | Informational |
| Evidence | Grep across `apps/web`, `apps/dashboard`, `apps/mobile`, `packages`: no `createClient`, `@supabase/supabase-js` imports, `DATABASE_URL`, or Prisma |
| `apps/web/.env.example` | Only `VITE_API_BASE_URL`, `VITE_MARTIN_TILE_URL`, PMTiles URLs |
| `apps/dashboard/.env.example` | `NEXT_PUBLIC_API_BASE_URL` + optional import-review **dev** token |
| Currently reachable? | No direct DB path from clients |
| Recommended fix | Keep architecture; remove unused `@supabase/supabase-js` dependency when convenient |
| Breaking impact | None |

### Finding D2 — Dashboard may embed import-review token in **development** builds

| Field | Value |
| --- | --- |
| Severity | Medium (dev/process risk); Low in production if `NODE_ENV=production` |
| File | `apps/dashboard/src/lib/importReviewDevAccess.ts:7-12,44-53` |
| Behavior | `NEXT_PUBLIC_IMPORT_REVIEW_ADMIN_TOKEN` attaches `x-import-review-admin-token` only when `NODE_ENV !== "production"` |
| Attack scenario | Mis-set production `NODE_ENV` or accidental production embed of `NEXT_PUBLIC_*` token → anyone with bundle can call import-review promotes |
| Currently reachable? | Intended blocked in production builds; API still accepts header whenever `IMPORT_REVIEW_ADMIN_TOKEN` is set server-side |
| Recommended fix | Prefer JWT admin only in staging/prod; unset `IMPORT_REVIEW_ADMIN_TOKEN` outside controlled ops; never set `NEXT_PUBLIC_IMPORT_REVIEW_ADMIN_TOKEN` in production env |
| Breaking impact | Dev import-review without login breaks if token removed |

### Finding D3 — Martin URL is public; DB URL is not

Public web loads tiles over HTTP (`VITE_MARTIN_TILE_URL`). Martin itself holds `DATABASE_URL` server-side. No evidence the DB credential is shipped to browsers.

---

## 5. Route security inventory

Registration hub: `apps/api/src/app.ts` (routes registered ~168–197). Approximate total: ~278 HTTP routes.

### Legend

| Label | Meaning |
| --- | --- |
| Public | No JWT |
| Authenticated | Any valid JWT |
| Editor/Admin write | JWT + handler checks `admin`/`editor` |
| Admin | `authenticate` + `admin` and/or `super_admin` |
| Import-review admin | JWT `admin` **or** matching `x-import-review-admin-token` |
| Transport admin | Plugin requires `admin` (not `super_admin`) |

### Public (selected)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health`, `/health/db`, `/health/import-review` | Liveness / readiness |
| POST | `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout` | Rate-limited except logout |
| GET | `/public/*`, `/categories` | Public map/search |
| POST | `/reports` | Optional JWT; anonymous via `x-anonymous-id` |
| POST | `/share/links`, GET `/share/links/:code` | No auth, no rate limit |
| GET | `/addresses/search`, `/addresses/reverse`, `/search/reverse` | Public geo |
| GET/POST | `/api/routing/*` (non-admin) | Public routing |
| GET | `/docs`, `/openapi.json` | OpenAPI |

### Authenticated (any role) — notable gaps

| Method | Path | Issue |
| --- | --- | --- |
| GET | `/dashboard/stats` | Auth only — **no admin role** (`dashboard.routes.ts:14`) |
| GET | `/admin/addresses/reverse-debug` | Path says admin; **auth only** (`addresses.routes.ts:76`) |
| GET | `/places*`, `/streets*`, `/buildings*`, `/admin-areas*`, `/core-review` reads, `/admin/ref/*` | Auth-only reads of internal map/review data |
| POST | `/entity-admin-area/infer`, `/validate-manual` | Any authenticated user |

### Editor/Admin writes (map)

Places / streets / buildings / core-review mutating routes: `authenticate` then `roles` must include `admin` or `editor` (e.g. `places.routes.ts:150-156`, `EDIT_CORE_REVIEW_ROLES` in core-review).

### Admin / super_admin

| Area | Gate |
| --- | --- |
| Users, points adjust, reports admin, search aliases/docs/analytics | `admin` \| `super_admin` |
| Search reindex family / entity / repair | **`super_admin` only** (`search-index-health-admin.routes.ts:48-51`) |
| Transport writes | Plugin: **`admin` only** |
| Routing admin | Plugin: **`admin` only** |
| Import-review (~78 routes) | `authenticateImportReview` + `requireImportReviewAdmin` |

### Finding R1 — Auth-only “admin” surfaces

| Field | Value |
| --- | --- |
| Severity | High |
| Files | `dashboard.routes.ts:11-28`; `addresses.routes.ts:73-91`; places/streets/buildings/core-review/ref GET routes |
| Attack scenario | Register public account → scrape dashboard stats, reverse-debug, draft map lists, ref catalogs |
| Currently reachable? | **Yes**, if registration is open |
| Recommended fix | Add `requireRole("admin","super_admin")` (or editor where appropriate) on internal reads |
| Breaking impact | Non-admin JWTs lose access to those GETs (likely intended) |

### Finding R2 — Import-review shared header token = full admin

| Field | Value |
| --- | --- |
| Severity | High (when env set) |
| File | `import-review-admin.guard.ts:61-83` |
| Attack scenario | Token leak → promote/cleanup/write all import-review endpoints without user JWT |
| Currently reachable? | Yes when `IMPORT_REVIEW_ADMIN_TOKEN` is configured |
| Recommended fix | Disable token in production; JWT + finer permission (`import_review:write`) |
| Breaking impact | Ops scripts/dashboard using header must switch to JWT |

### Finding R3 — Public write spam surfaces without rate limits

| Field | Value |
| --- | --- |
| Severity | Medium |
| Files | `share.routes.ts:20`; `reports.routes.ts` POST create; routing POST |
| Attack scenario | Flood share links / reports / routing |
| Currently reachable? | Yes |
| Recommended fix | Per-IP rate limits (same pattern as auth routes) |
| Breaking impact | Legitimate high-volume clients may need higher limits |

### Write-endpoint checklist (summary)

| Domain | Auth | AuthZ | Zod | Param SQL | Ownership | Rate limit | Audit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Map edit (places/streets/buildings) | Yes | admin\|editor | Yes | Mostly tagged templates | N/A (global data) | No | Partial |
| Import-review promote | Header or JWT | admin | Yes | Tagged + allowlists | N/A | No | Promotion flows |
| Search rebuild | Yes | super_admin | Yes | Bound `$1` views | N/A | No | Index runs table |
| Points adjust | Yes | admin\|super_admin | Yes | Prisma | Target user id | No | Ledger + audit |
| Saved places | Yes | Owner checks | Yes | Prisma | Yes | No | N/A |
| Reports create | Optional | Public | Yes | Tagged | anonymous_id / owner | No | Partial |
| Transport writes | Yes | admin | Yes | Tagged | N/A | No | transport_audit_logs |
| Share links | No | None | Yes | Prisma | N/A | No | N/A |

Fastify default body size applies (~1 MiB); no custom global `bodyLimit` found in `buildApp()`.

---

## 6. Authentication and session analysis

Custom auth lives under schema **`app_auth`** (Prisma models in `apps/api/prisma/schema.prisma` lines 11–102). This is **not** Supabase Auth.

### Flow

| Step | Endpoint / mechanism | Storage |
| --- | --- | --- |
| Register | `POST /auth/register` | Argon2id hash; role `user`; **no session** |
| Login | `POST /auth/login` | Session row + refresh token; JWT access 15m |
| Refresh | `POST /auth/refresh` | Rotate refresh hash; reload roles from DB |
| Logout | `POST /auth/logout` | Revoke refresh; **access JWT still valid until expiry** |
| Email OTP | `POST /auth/email/send-otp`, `verify-otp` | HMAC-SHA256 hash in DB; plaintext only in email |
| Me / profile | `GET /auth/me`, `PATCH /me/profile` | Profile fields only (no role edits) |
| Password reset | **Not implemented** | — |

### Crypto / session controls (good)

| Control | Evidence | Status |
| --- | --- | --- |
| Password hashing | `password.ts:8-29` Argon2id; bcrypt legacy upgrade | OK |
| OTP not plaintext | `otp.ts:21-22`; `auth.service.ts:262` | OK |
| OTP expiry | Default TTL via env; `auth.service.ts:265,305-307` | OK |
| OTP attempt cap | `auth.service.ts:309-310` | OK |
| Refresh hashed | SHA-256 (`refresh-token.ts:22-24`); rotated on refresh | OK |
| AUTH_BYPASS blocked in prod | `auth.ts:38-44` | OK |
| Login messages | Shared “Invalid email or password” | OK for login |

### Finding A1 — Access JWT not revalidated against DB

| Field | Value |
| --- | --- |
| Severity | High |
| File | `apps/api/src/plugins/auth.ts:75-82` |
| Affected | All `authenticate` routes; roles from JWT claims (`auth.service.ts:384-393`) |
| Attack scenario | Admin disables user or revokes roles; attacker keeps Bearer token up to **15 minutes** for map edits / admin APIs |
| Currently reachable? | **Yes** |
| Recommended fix | On `authenticate`, load user by `sub` and check `is_active`, `account_status`, and roles (or short opaque sessions) |
| Breaking impact | Extra DB read per request; must cache carefully |

### Finding A2 — Logout does not invalidate access tokens

| Field | Value |
| --- | --- |
| Severity | Medium |
| File | `auth.service.ts:213-216` (refresh revoke only) |
| Attack scenario | Stolen access token works after logout until 15m expiry |
| Currently reachable? | Yes |
| Recommended fix | Session version / denylist / shorter access TTL |
| Breaking impact | Clients must refresh more often if TTL shortened |

### Finding A3 — Register email enumeration

| Field | Value |
| --- | --- |
| Severity | Medium |
| File | `auth.service.ts:84-86` → HTTP 409 “Email already registered” |
| Currently reachable? | Yes (public) |
| Recommended fix | Uniform response or delayed generic message |
| Breaking impact | UX change for register |

### Finding A4 — In-memory rate limits only

| Field | Value |
| --- | --- |
| Severity | Medium |
| File | `app.ts:113-127`; `auth.routes.ts` rateLimit config |
| Attack scenario | Multi-instance deploy → per-instance limits; attacker spreads across instances |
| Currently reachable? | Depends on deploy topology |
| Recommended fix | Shared store (Redis) for auth limits |
| Breaking impact | Needs Redis/infrastructure |

### Finding A5 — Role allowlist inconsistency

| Field | Value |
| --- | --- |
| Severity | Medium (ops/availability) |
| Evidence | Search admin allows `super_admin`; transport/routing/import-review often require exact `admin` |
| Attack scenario | Accidental lockout of `super_admin`-only accounts (not privilege escalation) |
| Recommended fix | Align allowlists to include `super_admin` where admin is intended |

### Checklist vs requested concerns

| Concern | Result |
| --- | --- |
| Plaintext OTP storage | No |
| Plaintext refresh tokens in DB | No (hash only) |
| Weak password hashing | No (Argon2id) |
| Missing OTP expiration | No |
| Unlimited OTP attempts | No (capped); verify-otp lacks IP rate limit |
| Missing login rate limits | Partial (in-memory) |
| Account enumeration | Register yes |
| JWT verification weaknesses | Secret required; no `aud`/`iss`; roles stale |
| Trusting client-supplied roles | No (signed JWT); stale claims yes |
| AuthZ from editable metadata | Profile cannot set roles |
| IDOR saved places / reports | Mitigated in services |
| Admin endpoints auth-only | Several GETs — see R1 |
| Sessions after logout/delete | Access JWT remains until expiry |

---

## 7. Vulnerable table usage analysis

### Live grants (confirmed via SQL)

`public._prisma_migrations` and `public.spatial_ref_sys`: `anon` and `authenticated` have SELECT/INSERT/UPDATE/DELETE/TRUNCATE/…  
`anon` has schema `USAGE` on **`public` only** among app schemas checked.

### Finding T1 — `_prisma_migrations` over-granted

| Field | Value |
| --- | --- |
| Severity | High (Data API / anon surface); Informational for Fastify |
| App references | **None** in repository |
| Prisma migrate | Uses owner connection (`DATABASE_URL` / `postgres`), not `anon` |
| API endpoint reach? | No |
| User-controlled SQL involving table? | No |
| Currently reachable? | **Via Supabase REST on `public` if Data API exposes the table** — not via CoreMap clients |
| Recommended fix | `REVOKE ALL ON public._prisma_migrations FROM anon, authenticated;` keep for `postgres` |
| Breaking impact | **None** for Fastify/Prisma migrate |

### Finding T2 — `spatial_ref_sys` write grants

| Field | Value |
| --- | --- |
| Severity | High (integrity); Informational for Fastify |
| App references | ERD stub only (`infrastructure/database/introspection/supabase/erd/current.mmd`); no API read/write |
| Currently reachable? | Anon/authenticated can theoretically UPDATE/DELETE rows via Data API |
| Attack scenario | Corrupt CRS definitions → broken PostGIS transforms for any caller using altered SRIDs |
| Recommended fix | Revoke INSERT/UPDATE/DELETE/TRUNCATE from `anon`/`authenticated`; SELECT may remain if PostGIS clients need it |
| Breaking impact | Unlikely for this API (no references); verify Martin/PostGIS still works (SELECT usually enough) |

### Schema USAGE barrier (critical context)

| Schema | `anon` USAGE | `authenticated` USAGE |
| --- | --- | --- |
| `public` | true | true |
| `core`, `search`, `import_review`, `app_auth`, `app`, `contrib`, `transport`, `ref`, `tiles` | **false** | **false** |

So table/RPC issues outside `public` are **not currently callable** by those roles even when `EXECUTE`/`table` grants appear elsewhere—unless USAGE is later granted or schemas are added to PostgREST `db_schemas`.

---

## 8. Database function / RPC analysis

### Live EXECUTE (confirmed)

All listed functions: `anon_execute=true`, `authenticated_execute=true`, `postgres_execute=true`.  
`search.rebuild_search_documents` and `search.sync_search_documents` already set `search_path=public, search, core, ref, transport`.  
Several others (promote_*, infer_*, refresh_address_index, reverse_address_minimal, find_admin_area_for_point) have **empty** `proconfig` (mutable search_path).

### Function call matrix (backend)

| Function | Caller | Endpoint / trigger | Auth | User params | Callable via PostgREST today? | Revoke anon/auth breaks API? | Keep EXECUTE for |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `core.promote_place_candidate` | **Unused** | — | — | — | No (no schema USAGE) | **No** | `postgres` only (or drop) |
| `core.promote_road_candidate` | **Unused** | — | — | — | No | **No** | `postgres` / drop |
| `core.promote_admin_area_candidate` | **Unused** | — | — | — | No | **No** | `postgres` / drop |
| `import_review.infer_address_admin_components` | `import-review-address-admin-inference.repo.ts:39-44` | `POST /api/import-review/addresses/infer-admin-components` | Import-review admin | `review_batch_id`, optional meters (Zod) | No | **No** | `postgres` |
| `search.rebuild_search_documents` | `search-family-rebuild.ts:93-96` | `POST /admin/search/index-health/reindex-family\|repair`; post-promotion | super_admin / import-review admin | Allowlisted view names | No | **No** | `postgres` |
| `search.sync_search_documents` | `unified-search-sync.repo.ts:59-63` | `POST .../reindex-entity`; entity write side effects | super_admin / write-route auth | entity type/ids from server | No | **No** | `postgres` |
| `search.refresh_address_index` | `addresses/address-index.repo.ts:23-34` | After address write/promote | Those routes’ auth | address ids from server | No | **No** | `postgres` |
| `search.refresh_search_aliases` | `unified-search-sync.repo.ts:29` | Alias CRUD / sync | Admin write paths | Server ids | No | **No** | `postgres` |
| `core.reverse_address_minimal` | `addresses/reverse-search.repo.ts:30` | `GET /search/reverse` (public) | Public | lat/lng Zod | No | **No** | `postgres` |
| `core.find_admin_area_for_point` | `reports.repo.ts:289` | `POST /reports` | Public/optional JWT | lat/lng | No | **No** | `postgres` |

Current promotion does **not** call `core.promote_*_candidate`. Live path is TypeScript SQL under `apps/api/src/modules/import-review/` (e.g. `import-review-promotion-promote*.ts`). Legacy functions remain in DB dumps (`infrastructure/database/migrations/local/000_baseline_current_local_schema.sql` ~441, 774, 1054).

### Finding F1 — Powerful EXECUTE still granted to anon/authenticated

| Field | Value |
| --- | --- |
| Severity | Medium (defense in depth); would become **Critical** if schema USAGE added |
| Evidence | Live `has_function_privilege`; advisors `function_search_path_mutable` |
| Currently reachable? | **Not via Data API today** (no USAGE on owning schemas) |
| Recommended fix | `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated;` `GRANT EXECUTE … TO postgres;` (and `martin` only if needed) |
| Breaking impact | **None** for Fastify; would break any external PostgREST caller (none found in repo) |

---

## 9. SQL injection and privilege escalation findings

### Finding S1 — `$queryRawUnsafe` / `$executeRawUnsafe` on fixed strings

| Field | Value |
| --- | --- |
| Severity | Low / Informational |
| Files | `search-family-rebuild.ts:93-96` (fixed SQL + bound `$1`); `search-index-health.ts:239,452-453`; `search-index-maintenance.lock.ts:50,67`; `public-map.repo.ts:501,1018` (constant timeout) |
| Attacker-controlled? | Views passed after allowlist guard (`guardDeprecatedSearchRebuildViews`) |
| Currently reachable exploit? | No evidence of injectable string concat from HTTP |
| Recommended fix | Prefer tagged templates where practical; keep allowlists |
| Breaking impact | None |

### Finding S2 — `Prisma.raw` for identifiers

| Field | Value |
| --- | --- |
| Severity | Low (review hotspot) |
| Files | `core-review-entities*.repo.ts`, `public-map.repo.ts`, `search-canonical-source.ts`, `reports.repo.ts` |
| Attacker-controlled? | Tables/aliases come from **entity registry / internal maps**, not free-form HTTP schema names; search ILIKE uses bound params |
| Recommended fix | Keep registry-only identifiers; never interpolate raw user strings into `Prisma.raw` |
| Breaking impact | None |

### Finding S3 — No `SET ROLE` / no migration `SECURITY DEFINER` found

| Field | Value |
| --- | --- |
| Severity | Informational |
| Evidence | Grep under `infrastructure/database` migrations: no `SET ROLE`; no `SECURITY DEFINER` in project SQL |
| Live functions checked | `security_definer=false` for listed RPCs |

### Finding S4 — Mutable `search_path` (privilege escalation class)

| Field | Value |
| --- | --- |
| Severity | Medium (advisor WARN × 66) |
| Evidence | Supabase security advisors; live count missing search_path ≈ 66 of 73 custom functions in key schemas |
| Attack scenario | If a role can create objects on an early `search_path` schema and invoke a function without fixed path, object shadowing may hijack unqualified names |
| Currently reachable? | Low for anon (no USAGE on those schemas); relevant for any shared role that can create objects |
| Recommended fix | `ALTER FUNCTION … SET search_path = …` on all custom functions |
| Breaking impact | Low if path lists match current unqualified references |

---

## 10. RLS and ownership analysis

### Live pattern

- **Backend-only schemas** (`core`, most map tables): often **RLS off**; access control is “no USAGE for anon” + Fastify auth.
- **User-ish tables**: mixed — e.g. `app.user_saved_places`, `app_auth.auth_sessions`, `email_verification_otps`, many `search.*` / `transport.*` / `import_review.*` have **RLS enabled** but advisors report **no policies** (`rls_enabled_no_policy` × 85).
- Policies query for `app` / `app_auth` / `contrib`: **empty** (no policy rows).

### Finding L1 — RLS enabled without policies

| Field | Value |
| --- | --- |
| Severity | Medium as defense-in-depth gap; **not** currently exploitable via anon (no schema USAGE) |
| Examples | `app.user_saved_places`, `app_auth.auth_sessions`, `contrib.point_ledger` |
| Effect for API | Negligible — Prisma connects as `postgres` (bypasses RLS unless `FORCE ROW LEVEL SECURITY`) |
| Effect if USAGE granted later | Default-deny for anon/authenticated (fails closed) — safer than open policies, but confusing |
| Recommended fix | For backend-only tables: prefer revoke USAGE + disable misleading RLS, **or** keep RLS forced with explicit deny and document. For true end-user PostgREST access (not planned): policies must use non-editable claims — **never `USING (true)`** |
| Breaking impact | Changing RLS while still using `postgres` API role: none |

### Finding L2 — Ownership enforced in API, not DB

Saved places / reports ownership checks live in services. That is correct for the API-centric model. Do not pretend RLS protects those rows from the API role.

---

## 11. Impact analysis for each proposed database fix

| # | Proposed fix | Classification | Notes |
| --- | --- | --- | --- |
| 1 | Revoke all privileges on `public._prisma_migrations` from `anon`/`authenticated` | **Safe to apply immediately** | No app dependency; Prisma migrate uses `postgres` |
| 2 | Revoke write privileges on `public.spatial_ref_sys` from `anon`/`authenticated` | **Safe to apply immediately** | Keep SELECT if needed; no API writers |
| 3 | Revoke default function `EXECUTE` from `PUBLIC`/`anon`/`authenticated` | **Safe to apply immediately** for API | Confirm no ad-hoc Supabase SQL editor workflows as those roles |
| 4 | Grant function execution only to backend roles (`postgres`, maybe `martin`) | **Safe to apply immediately** | Matches how API connects |
| 5 | Set fixed `search_path` on custom functions | **Safe after small validation** | Start with promote/infer/refresh/rebuild/sync; then batch remainder |
| 6 | Add RLS policies to user-owned tables | **Not currently necessary** for API model; **requires design** if Data API ever exposes `app` | Do **not** add `USING (true)`. Prefer keep schemas private |
| 7 | Keep backend-only schemas inaccessible to API roles | **Already true** for anon/authenticated USAGE — **maintain** | Do not grant USAGE on `core`/`search`/`import_review`/`app_auth` to anon |
| 8 | Replace/integrate custom auth with Supabase Auth | **Requires more information / product decision** | Custom `app_auth` is intentional and wired; migration is large and not required to fix grant issues |

---

## 12. Prioritized remediation plan

1. **DB (immediate, low risk):** Revoke `anon`/`authenticated` privileges on `_prisma_migrations` and write privileges on `spatial_ref_sys`. Capture as a git migration under `infrastructure/database/migrations/supabase/`.
2. **DB (immediate, low risk):** `REVOKE EXECUTE ON FUNCTION … FROM PUBLIC, anon, authenticated` for promote/rebuild/sync/infer/refresh/reverse helpers; `GRANT EXECUTE TO postgres`.
3. **DB (short follow-up):** Fix `search_path` on the same admin functions, then remaining 66 advisor warnings.
4. **API (high, reachable):** Re-validate user active status + roles inside `authenticate`; align admin gates on `/dashboard/stats`, `/admin/addresses/reverse-debug`, and internal map list reads.
5. **API (high when enabled):** Remove or strictly vault `IMPORT_REVIEW_ADMIN_TOKEN` in production; dashboard already blocks `NEXT_PUBLIC_*` token outside development.
6. **API (medium):** Rate-limit `/reports`, `/share/links`, OTP verify; consider Redis-backed limits.
7. **Hygiene:** Remove unused `@supabase/supabase-js`; document that Supabase Auth is not used.
8. **Defer:** Broad RLS policy projects and Supabase Auth migration until product requires direct client DB access (it should not).

---

## 13. Files requiring changes

### Database (future migration — not applied in this inspection)

- New migration SQL under `infrastructure/database/migrations/supabase/` for REVOKE/GRANT and `search_path`.

### API (application hardening)

| File | Change theme |
| --- | --- |
| `apps/api/src/plugins/auth.ts` | DB revalidation of user/roles |
| `apps/api/src/modules/dashboard/dashboard.routes.ts` | Admin role gate |
| `apps/api/src/modules/addresses/addresses.routes.ts` | Admin role gate on reverse-debug |
| Places/streets/buildings/core-review/ref route files | Tighten read authZ if data is internal-only |
| `apps/api/src/modules/import-review/import-review-admin.guard.ts` | Phase out shared token |
| `apps/api/src/modules/share/share.routes.ts` | Rate limit |
| `apps/api/src/modules/reports/reports.routes.ts` | Rate limit on create |
| `apps/api/src/app.ts` | Optional shared rate-limit store |

### Dashboard / docs

| File | Change theme |
| --- | --- |
| `apps/dashboard/.env.example` | Keep strong warnings (already present) |
| Ops runbooks | Prefer JWT for import-review in staging/prod |

### Optional cleanup

| File | Change theme |
| --- | --- |
| `apps/api/package.json` | Drop unused `@supabase/supabase-js` |

---

## 14. Tests required after changes

| Change | Tests |
| --- | --- |
| REVOKE table/function grants | Connect as `anon` (or use Data API with publishable key): expect deny on `_prisma_migrations` writes and RPC execute; API smoke: login, promote dry-run, search reindex (staging), reverse geocode, create report |
| `search_path` alters | Rebuild one search family; sync one entity; address refresh; reverse address |
| `authenticate` revalidation | Disable user → next request 401/403 before 15m; role revoke → 403; happy-path login still works |
| Dashboard/admin gates | `user` role JWT → 403 on `/dashboard/stats` and reverse-debug; admin → 200 |
| Rate limits | Burst `/share/links` and `/reports` → 429 |
| Import-review without token | With env unset: admin JWT works; missing JWT → 401 |

Minimum commands (API):

```bash
cd apps/api && npm run typecheck
# plus existing auth / import-review / search unit tests where present
```

---

## 15. Unknowns requiring manual verification

1. **Supabase Data API / PostgREST exposed schema list** in dashboard (SQL `pgrst.db_schemas` returned null from DB). Confirm UI setting: ideally **`public` only**, never `core`/`search`/`import_review`/`app_auth`.
2. Whether any **external** integration (Zapier, n8n, manual curl with anon key) calls PostgREST against `_prisma_migrations` or `spatial_ref_sys`.
3. Whether **Martin** DB role is `postgres` or a restricted `martin`/`tiles_reader` in production (migrations mention optional grants to those roles).
4. Production status of `IMPORT_REVIEW_ADMIN_TOKEN` and whether any CI job depends on it.
5. Whether registration is intentionally public in production (affects severity of auth-only internal reads).
6. Multi-instance deploy topology (affects in-memory rate-limit effectiveness).
7. Exact live policies on every RLS-enabled table beyond the advisor sample (85 `rls_enabled_no_policy` warnings).
8. Whether Prisma migrate history in `_prisma_migrations` is still the source of truth vs SQL files under `infrastructure/database/migrations/supabase/` (app code never reads the table either way).

---

## Summary table

| Priority | Issue | Currently reachable? | Backend dependency | Recommended action | Breaking risk |
| --- | ---: | ---: | ---: | --- | --- |
| P0 | `_prisma_migrations` grants to anon/authenticated | Yes via Data API (`public`) | None | Revoke all from anon/authenticated | None |
| P0 | `spatial_ref_sys` write grants to anon/authenticated | Yes via Data API | None | Revoke writes; keep SELECT if needed | Very low |
| P1 | Access JWT not revalidated (stale roles/disabled users) | Yes via API | Auth plugin | Re-check DB on authenticate | Low (latency) |
| P1 | Auth-only internal GETs (`/dashboard/stats`, reverse-debug, map lists) | Yes if register open | Route guards | Add admin/editor role checks | Low (intended) |
| P1 | `IMPORT_REVIEW_ADMIN_TOKEN` full admin | Yes when env set | Import-review guard | Disable in prod; JWT only | Medium for ops DX |
| P2 | Function EXECUTE for anon/authenticated on admin RPCs | Blocked (no schema USAGE) | API uses postgres | Revoke EXECUTE; grant postgres | None for API |
| P2 | Mutable `search_path` (66 functions) | Low today | None for HTTP | Set fixed search_path | Low |
| P2 | Public `/share/links` & `/reports` without rate limits | Yes | Routes | Add rate limits | Low |
| P2 | Register email enumeration | Yes | Auth register | Uniform responses | Low UX |
| P3 | RLS on without policies / inconsistent RLS | Not via anon (no USAGE) | API bypasses RLS | Keep schemas private; avoid broad policies | Design-dependent |
| P3 | Unused `@supabase/supabase-js` dependency | No | None | Remove | None |
| P3 | Migrate to Supabase Auth | N/A | Entire auth stack | Defer; not required for grant fixes | High if forced |
| Info | Intended API→Postgres architecture held | N/A | — | Maintain; no client DB | — |

---

## Appendix A — Evidence commands used (read-only)

Live Supabase checks (via MCP `execute_sql` / `get_advisors`):

- Function EXECUTE matrix for promote/rebuild/sync/infer/reverse helpers  
- Table grants on `_prisma_migrations` and `spatial_ref_sys`  
- Schema USAGE for `anon`/`authenticated`  
- RLS flags across key schemas  
- Security advisors: 153 lints (85 `rls_enabled_no_policy`, 66 `function_search_path_mutable`, 2 `extension_in_public`)

Code searches: `DATABASE_URL`, Prisma, `@supabase`, promote/rebuild RPC callers, auth plugin, route `preHandler`/`onRequest` hooks, `$queryRawUnsafe`, `Prisma.raw`.

---

## Appendix B — Severity rubric used

| Severity | Meaning in this report |
| --- | --- |
| Critical | Confirmed remote exploit path to data destruction or mass privilege escalation **today** |
| High | Confirmed reachable abuse with serious impact, or public grants on sensitive `public` objects |
| Medium | Real weakness; exploit needs conditions (token set, multi-instance, future USAGE grant) |
| Low | Defense-in-depth / limited impact |
| Informational | Architecture confirmation or unused surface |

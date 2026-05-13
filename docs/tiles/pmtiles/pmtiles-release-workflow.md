# PMTiles release workflow (beginner-friendly)

This document is a **repeatable checklist** for shipping a **new versioned** Yangon basemap archive to **Cloudflare R2** and cutting over the **web** and **dashboard** apps. It assumes the bucket and public hostname already work.

**Facts for this project (update dates/names in your notes as needed):**

| Item | Value |
|------|--------|
| R2 bucket | `coremap-tiles-prod` |
| Public R2 base URL | `https://pub-1f8b4bea1a884f51966c7916c5e618ce.r2.dev` |
| Object key pattern | `basemaps/<region>/<version>/basemap.pmtiles` |
| Currently deployed (example) | `basemaps/yangon/v1/basemap.pmtiles` |
| Next versions (examples) | `basemaps/yangon/v2/basemap.pmtiles`, `basemaps/yangon/v3/basemap.pmtiles` |
| Web (Vite) env | `VITE_BASEMAP_PMTILES_URL` |
| Dashboard (Next.js) env | `NEXT_PUBLIC_BASEMAP_PMTILES_URL` |

**Architecture reminder:** the **database** is the source of truth. **PMTiles** are **rendering-only** snapshots.

---

## No-overwrite rule (critical)

**Do not upload a new file to the same object key as a version that is already in use** (for example, do not replace `basemaps/yangon/v1/basemap.pmtiles` in place while anyone still points at `v1`).

- Always publish **`v2`**, **`v3`**, … as **new paths**.
- Cut over by changing **environment variables** to the new URL.
- **Rollback** = point env vars back to the **previous** full URL (previous version path), then redeploy.

Overwriting a live object can mix bytes for in-flight clients, confuse caches, and cause hard-to-debug map glitches.

---

## Example: releasing `v1` → `v2` (Yangon)

Full URL for **v1** (already deployed):

```text
https://pub-1f8b4bea1a884f51966c7916c5e618ce.r2.dev/basemaps/yangon/v1/basemap.pmtiles
```

Full URL for **v2** (after upload):

```text
https://pub-1f8b4bea1a884f51966c7916c5e618ce.r2.dev/basemaps/yangon/v2/basemap.pmtiles
```

All commands below assume your shell’s current directory is the **repository root** (`Local-Map/`), unless noted.

---

## 1. Build new PMTiles locally

1. Ensure **`DATABASE_URL`** is set (repo root `.env` is loaded by the tile scripts).
2. Export + build **Yangon `v2`** (or use `tiles:rebuild`, which runs export then build):

```bash
npm run tiles:rebuild -- yangon v2
```

3. Confirm the archive exists (typical path from the regional layout):

```bash
ls -la infrastructure/tiles/pmtiles/regions/yangon/yangon-v2.pmtiles
```

If your team stores the built file elsewhere, use that path in step 3—but the **R2 object path** must still be `basemaps/yangon/v2/basemap.pmtiles`.

---

## 2. Test locally

1. Serve tiles locally (serves `regions/…` and `current.json` on port **8080**):

```bash
npm run tiles:serve
```

2. Run **web** or **dashboard** **without** `*_BASEMAP_PMTILES_URL` so they resolve from `current.json` / local defaults, and confirm the map looks correct for **`v2`** once `current.json` points at `v2` (if you bump the pointer for local testing).

For a **direct** local test of the file you built, you can temporarily set the env vars in step 5–6 to a **local** `http://localhost:8080/…` URL that serves that `.pmtiles` file, if your static layout exposes it.

---

## 3. Upload to R2 using `upload-r2.sh`

Prerequisites: **Wrangler** installed and **`wrangler login`** done for the Cloudflare account that owns **`coremap-tiles-prod`**.

From repo root:

```bash
bash infrastructure/tiles/pmtiles/scripts/upload-r2.sh \
  infrastructure/tiles/pmtiles/regions/yangon/yangon-v2.pmtiles \
  yangon \
  v2
```

This uploads to:

```text
coremap-tiles-prod/basemaps/yangon/v2/basemap.pmtiles
```

The script prints placeholder URLs; your real public object URL is:

```text
https://pub-1f8b4bea1a884f51966c7916c5e618ce.r2.dev/basemaps/yangon/v2/basemap.pmtiles
```

---

## 4. Verify with `check-pmtiles-url.sh`

Check **HEAD**, **Range**, and **CORS** (use an origin your apps use, e.g. local dev):

```bash
bash infrastructure/tiles/pmtiles/scripts/check-pmtiles-url.sh \
  "https://pub-1f8b4bea1a884f51966c7916c5e618ce.r2.dev/basemaps/yangon/v2/basemap.pmtiles" \
  "http://localhost:5173"
```

Repeat with `http://localhost:3000` if you test the dashboard from that origin.

Resolve any **403**, missing **Range** / **206**, or missing **`access-control-allow-origin`** before cutting over production. CORS rules for the bucket live in `infrastructure/cloud/r2/cors.json` — see `infrastructure/cloud/r2/README.md`.

---

## 5. Test `apps/web` locally with hosted PMTiles

From **`apps/web/`**:

```bash
cd apps/web
VITE_BASEMAP_PMTILES_URL='https://pub-1f8b4bea1a884f51966c7916c5e618ce.r2.dev/basemaps/yangon/v2/basemap.pmtiles' npm run dev
```

In **development**, the console should log the active basemap URL. Confirm the map loads tiles from R2 (no CORS or range errors in the browser **Console** / **Network**).

---

## 6. Test `apps/dashboard` locally with hosted PMTiles

From **`apps/dashboard/`**:

```bash
cd apps/dashboard
NEXT_PUBLIC_BASEMAP_PMTILES_URL='https://pub-1f8b4bea1a884f51966c7916c5e618ce.r2.dev/basemaps/yangon/v2/basemap.pmtiles' npm run dev
```

Exercise **place**, **street**, and **building** map screens you care about; overlays should still come from the **API** while the basemap comes from R2.

---

## 7. Update Vercel environment variables

In the Vercel project(s) for **web** and **dashboard** (or a shared env if you use one):

| Variable | Example value (`v2` cutover) |
|----------|-------------------------------|
| `VITE_BASEMAP_PMTILES_URL` | `https://pub-1f8b4bea1a884f51966c7916c5e618ce.r2.dev/basemaps/yangon/v2/basemap.pmtiles` |
| `NEXT_PUBLIC_BASEMAP_PMTILES_URL` | same URL as above |

Use the **full HTTPS URL** including path. **`NEXT_PUBLIC_*`** is exposed to the browser by design.

---

## 8. Redeploy web and dashboard

Trigger production deployments for both apps (or your monorepo pipeline) so the new env values are baked into the client bundles.

---

## 9. Verify production (Network tab)

1. Open the **production** web app and dashboard.
2. Open DevTools → **Network**.
3. Filter by **`pmtiles`** or the archive filename **`basemap.pmtiles`**.
4. Confirm requests go to **`…/basemaps/yangon/v2/basemap.pmtiles`**, status **200** / **206** as appropriate, and **CORS** headers look correct for your production origins.

---

## 10. Rollback (env URL only)

If **`v2`** misbehaves in production, **do not delete `v2` immediately**. Roll back traffic first:

1. In Vercel, set both variables back to **`v1`**:

```text
https://pub-1f8b4bea1a884f51966c7916c5e618ce.r2.dev/basemaps/yangon/v1/basemap.pmtiles
```

2. Redeploy web and dashboard.
3. Confirm in the **Network** tab that clients load **`v1`** again.

Later, investigate **`v2`** offline; keep old objects until you are sure you no longer need rollback.

---

## Release checklist

Use a copy of this list for each release (e.g. `v2`, `v3`).

- [ ] **Built** new `yangon-<version>.pmtiles` locally (`npm run tiles:rebuild -- yangon <version>`).
- [ ] **Tested** locally (`npm run tiles:serve` and/or app smoke tests).
- [ ] **Uploaded** with `upload-r2.sh` to `basemaps/yangon/<version>/basemap.pmtiles` (**new key**, not overwriting an in-use version).
- [ ] **`check-pmtiles-url.sh`** passed for the new URL (HEAD, Range, CORS for dev origins; add production origins to CORS before prod cutover).
- [ ] **`apps/web`** tested with `VITE_BASEMAP_PMTILES_URL` pointing at the new object.
- [ ] **`apps/dashboard`** tested with `NEXT_PUBLIC_BASEMAP_PMTILES_URL` pointing at the new object.
- [ ] **Vercel** (or host) env vars updated for **both** apps.
- [ ] **Production** redeployed and **Network** tab verified for the new path.
- [ ] **Rollback path** documented (previous full URL kept in runbook or Vercel history).

---

## Related docs

- Regional layout and local tile commands: `infrastructure/tiles/pmtiles/README.md`
- R2 CORS commands: `infrastructure/cloud/r2/README.md`
- R2 hosting overview: `docs/tiles/pmtiles-r2-beginner-guide.md`

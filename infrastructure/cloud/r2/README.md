# Cloudflare R2 (CORS and quick checks)

This folder holds **R2 CORS** configuration for tile buckets. Tiles are **rendering-only**; the **database** remains the source of truth.

**Bucket name used in this repo’s docs:** `coremap-tiles-prod`  
**Example object path:** `basemaps/yangon/v2/basemap.pmtiles`

---

## Apply CORS rules

From the **repository root** (so the file path resolves correctly):

```bash
wrangler r2 bucket cors set coremap-tiles-prod --file infrastructure/cloud/r2/cors.json
```

## List current CORS rules

```bash
wrangler r2 bucket cors list coremap-tiles-prod
```

---

## Test CORS with an `Origin` header

Browsers send `Origin` on cross-origin requests. A quick manual test from the terminal:

Replace **both**:

- `<PUBLIC_OBJECT_URL>` — full HTTPS URL to the object, for example  
  `https://<your-r2-public-host>/basemaps/yangon/v2/basemap.pmtiles`
- `<YOUR_ALLOWED_ORIGIN>` — must match one of the origins in `cors.json` (for example your local dev origin)

```bash
curl -I \
  -H "Origin: <YOUR_ALLOWED_ORIGIN>" \
  -H "Access-Control-Request-Method: GET" \
  "<PUBLIC_OBJECT_URL>"
```

For **Range** behavior (important for PMTiles), you can combine:

```bash
curl -I \
  -H "Origin: <YOUR_ALLOWED_ORIGIN>" \
  -H "Range: bytes=0-15" \
  "<PUBLIC_OBJECT_URL>"
```

You should see CORS-related response headers when the rule matches (for example **`access-control-allow-origin`** reflecting your origin or the configured behavior Cloudflare returns for that request type).

---

## Warnings

1. **`cors.json` contains concrete web origins** (localhost and known deploy previews). When you move to production on **`tiles.yourdomain.com`**, update **allowed origins** to match your real production and staging sites. Replace placeholder references like **`yourdomain.com`** with your actual domain wherever you configure DNS and CORS.

2. **Do not overwrite versioned tile objects in place** for live traffic. Publish new paths (for example `…/v3/basemap.pmtiles`) and cut over intentionally. See `docs/tiles/pmtiles-r2-beginner-guide.md`.

---

## Related documentation

- Beginner hosting walkthrough: `docs/tiles/pmtiles-r2-beginner-guide.md`
- CORS rule file in this folder: `cors.json`

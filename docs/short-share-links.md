# Short Share Links

CoreMap-only short links for sharing a map point or a place. Opening a link
re-opens the map focused on the shared target, loading the stored snapshot
immediately for fast display.

## Scope

In scope:

- CoreMap-only short links (no external map providers).
- Point share — an arbitrary map location (coordinates + optional zoom and a
  cached `address_line` / `plus_code` snapshot).
- Place share — a core place referenced by its `public_id`.
- Fast loading: point links render the stored share record immediately and do
  not wait for reverse geocoding before showing the panel.

Explicitly out of scope (see "Later TODO"):

- No Google Maps.
- No Apple Maps.
- No QR codes.
- No private links.
- No analytics dashboard.

## URL

Production share links are minted under the map app subdomain:

```text
https://map.coremapmm.com/s/<code>
```

- `<code>` is a 6–8 character URL-safe string.
- Alphabet excludes visually confusing characters (`0 O I l 1`).
- The base URL comes from the API `PUBLIC_APP_URL` env var (falls back to the
  local web origin `http://localhost:5173` in development).
- Do **not** use `coremapmm.com` for generated links: that is the landing page.
  The `/s/:code` route is handled by the **map app** (`map.coremapmm.com`).

## Production domain layout

| Domain | App | Notes |
|---|---|---|
| `coremapmm.com` | Landing page | does not handle `/s/:code` |
| `map.coremapmm.com` | Public map app | serves `/s/:code`; share links point here |
| `api.coremapmm.com` | Fastify API | `POST/GET /share/links` |
| `admin.coremapmm.com` | Dashboard | — |

## Environment configuration

Local `.env` files are kept on localhost; production values are set in the
platform/hosting environment (see `apps/api/.env.example`, `apps/web/.env.example`).

### API (`api.coremapmm.com`)

```bash
# Mint share links under the map app subdomain (required in production).
PUBLIC_APP_URL=https://map.coremapmm.com

# Allow the front-end origins that call the API from a browser.
CORS_ORIGIN=https://map.coremapmm.com,https://coremapmm.com,https://admin.coremapmm.com
```

Local dev keeps `PUBLIC_APP_URL=http://localhost:5173` so generated links open
the locally running map app.

### Map web (`map.coremapmm.com`)

```bash
VITE_API_BASE_URL=https://api.coremapmm.com
```

## API

Both endpoints are public (no authentication).

### POST /share/links

Creates (or reuses, via dedup) a share link.

Point request:

```json
{
  "target_type": "point",
  "lat": 16.639454,
  "lng": 96.322949,
  "zoom": 17,
  "address_line": "Kyauktan Township, Yangon Region, Myanmar",
  "plus_code": "7M8RJ8QF+Q5"
}
```

Place request:

```json
{
  "target_type": "place",
  "place_public_id": "<uuid>"
}
```

Response:

```json
{
  "code": "kT82Lm",
  "url": "https://coremapmm.com/s/kT82Lm"
}
```

### GET /share/links/:code

Resolves a code to its target. No reverse geocode is performed on resolve.

Point response:

```json
{
  "target_type": "point",
  "lat": 16.639454,
  "lng": 96.322949,
  "zoom": 17,
  "address_line": "Kyauktan Township, Yangon Region, Myanmar",
  "plus_code": "7M8RJ8QF+Q5"
}
```

Place response:

```json
{
  "target_type": "place",
  "place_public_id": "<uuid>"
}
```

Invalid or unknown codes return `404`.

### Dedup

- Place: reuses the existing row with the same `place_public_id`.
- Point: reuses the existing row when latitude/longitude (rounded) and zoom
  match. Enforced by a partial unique index plus an API-side lookup.

## Manual QA

1. Share a clicked point that has an address and a Plus Code.
2. Copy the short link from the share card.
3. Open the short link in a new tab.
4. It centers the map, drops a marker, and opens the Inspect Location panel.
5. Address and Plus Code show immediately (no loading spinner over stored data).
6. Share a point with no nearby address; it still shows township/coordinates.
7. Share a public place.
8. Open the place short link; it opens the place detail panel.
9. Re-sharing the same place returns the same short code.
10. Re-sharing the same rounded point returns the same short code (dedup).
11. The share card has no Google Maps / Apple Maps section.
12. Opening `/s/badcode` shows "Shared link not found."
13. No duplicate coordinates appear in the copied share details.

### Production domain QA

- Create a share link on `https://map.coremapmm.com`.
- The copied URL must start with `https://map.coremapmm.com/s/`.
- Opening that URL resolves the target and opens the correct map state
  (point → marker + Inspect Location; place → place detail).

## Later TODO

Not implemented; do not build without an explicit request:

- QR code
- Link analytics
- Expiry
- Private links
- Login-based share history
- Custom branded codes

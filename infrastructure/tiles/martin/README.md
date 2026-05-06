# Martin (Fly.io) — vector tiles from Supabase Postgres

This directory builds the **`martin-lively-canyon-4077`** app (see [`fly.toml`](./fly.toml)).

## Config

- **Runtime**: [`config.yaml`](./config.yaml) is copied into the image by [`Dockerfile`](./Dockerfile); the container runs `martin --config /config.yaml`.
- **`postgres.auto_publish.from_schemas: [tiles]`** publishes existing tables/views under schema `tiles` (e.g. `tiles_places_v`, `tiles_road_labels_v`, `tiles_admin_boundaries_v`, `tiles_bus_stops_v`).
- **`postgres.tables.tiles_buildings_v`** explicitly registers **`tiles.tiles_buildings_v`** so it appears under `/tiles_buildings_v/{z}/{x}/{y}` and in `/catalog` when auto-discovery skips views.

Historical notes live in [`martin_config.yaml`](./martin_config.yaml) (documentation only; not copied into the image).

## Redeploy (Fly.io)

From the repo root (or from this folder):

```bash
cd infrastructure/tiles/martin
fly deploy
```

(Optional) Watch logs:

```bash
fly logs --app martin-lively-canyon-4077
```

## Verify after deploy

1. Open **Catalog**: `https://martin-lively-canyon-4077.fly.dev/catalog` — confirm **`tiles_buildings_v`** is listed.
2. **Tile JSON**: `https://martin-lively-canyon-4077.fly.dev/tiles_buildings_v` (Martin serves metadata for that source).

## Secrets (recommended follow-up)

The connection string is currently embedded in `config.yaml`. Prefer Fly secrets so the repo does not carry credentials:

1. Set `fly secrets set DATABASE_URL='postgresql://...'` on the Fly app (and remove the plaintext URL from YAML).
2. In `config.yaml`, use Martin’s env expansion:

   ```yaml
   postgres:
     connection_string: ${DATABASE_URL}
   ```

Then redeploy again.

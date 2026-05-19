# Martin (Fly.io) — vector tiles from Supabase Postgres

This directory builds the **`martin-lively-canyon-4077`** app (see [`fly.toml`](./fly.toml)).

## Config

- **Runtime**: [`config.yaml`](./config.yaml) is copied into the image by [`Dockerfile`](./Dockerfile); the container runs `martin --config /config.yaml`.
- **Database URL**: read from the **`DATABASE_URL`** environment variable only (no credentials in Git). See [`config.yaml.example`](./config.yaml.example).
- **`postgres.auto_publish.from_schemas: [tiles]`** publishes existing tables/views under schema `tiles`.
- **`postgres.tables.tiles_buildings_v`** registers **`tiles.tiles_buildings_v`** at `/tiles_buildings_v/{z}/{x}/{y}` when auto-discovery skips views.

Historical notes: [`martin_config.yaml`](./martin_config.yaml) (documentation only; not copied into the image).

## Secrets (required)

1. Set the Fly secret (use your Supabase **pooler** or direct URL; include `sslmode=require` for Supabase):

   ```bash
   cd infrastructure/tiles/martin
   fly secrets set DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/postgres?sslmode=require'
   ```

2. Prefer a **read-only** Postgres role for tile serving if you create one in Supabase.

3. Never commit real connection strings. If a password was ever committed, **rotate** it in Supabase and scrub Git history.

`fly secrets` inject `DATABASE_URL` into the container at runtime; [`config.yaml`](./config.yaml) references it via `${DATABASE_URL:?…}`.

## Local run (Docker)

```bash
export DATABASE_URL='postgresql://USER:PASSWORD@localhost:5432/postgres'
docker build -t local-martin infrastructure/tiles/martin
docker run --rm -p 3000:3000 -e DATABASE_URL "$DATABASE_URL" local-martin
```

## Redeploy (Fly.io)

From this folder:

```bash
cd infrastructure/tiles/martin
fly deploy
```

Logs:

```bash
fly logs --app martin-lively-canyon-4077
```

## Verify after deploy

1. **Catalog**: `https://martin-lively-canyon-4077.fly.dev/catalog` — confirm **`tiles_buildings_v`** is listed.
2. **Tile JSON**: `https://martin-lively-canyon-4077.fly.dev/tiles_buildings_v`

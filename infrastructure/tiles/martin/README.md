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

### Public web dev (`VITE_MARTIN_TILE_URL=http://localhost:3002`)

Transport-only config with small pool (`config.local.yaml`).

**Recommended:** put the DB URL in a local env file, then start via the helper script:

```bash
cd infrastructure/tiles/martin
cp env.example .env
# Edit .env — set DATABASE_URL (quote the value; & in query strings breaks bash source)
# Do not paste apps/api DATABASE_URL unchanged:
#   - strip Prisma params (pgbouncer, connection_limit, pool_timeout)
#   - prefer direct Postgres :5432 (transaction pooler :6543 often hangs for Martin)

npm run tiles:martin:restart-local
# or: ./scripts/restart-local.sh
```

The script:

1. Loads `DATABASE_URL` from `.env` (if not already set in the shell)
2. Reuses `coremap-martin-local` if that container already exists
3. Creates it only when missing

If you change `DATABASE_URL` in `.env`, recreate (restart alone keeps old env):

```bash
docker rm -f coremap-martin-local
npm run tiles:martin:restart-local
```

Manual first start (same as the script):

```bash
cd infrastructure/tiles/martin
export DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/postgres?sslmode=require'

docker run -d --rm --name coremap-martin-local \
  -p 3002:3000 \
  -e DATABASE_URL \
  -v "$(pwd)/config.local.yaml:/config.yaml:ro" \
  ghcr.io/maplibre/martin:1.7.0 \
  --config /config.yaml --webui enable-for-all
```

Or: `docker restart coremap-martin-local`

### Fly-style image (port 3000, full `config.yaml`)

```bash
export DATABASE_URL='postgresql://USER:PASSWORD@localhost:5432/postgres'
docker build -t local-martin infrastructure/tiles/martin
docker run --rm -p 3000:3000 -e DATABASE_URL "$DATABASE_URL" local-martin
```

## Validate transport config

Static YAML (maxzoom 22 + required MVT properties):

```bash
cd infrastructure/tiles/martin
./scripts/validate-transport-config.sh
```

Running instance (TileJSON fields + Yangon zoom probes):

```bash
MARTIN_URL=http://localhost:3002 ./scripts/validate-transport-runtime.sh
```

From repo root: `npm run tiles:martin:validate-config` and `npm run tiles:martin:validate-runtime`.

> **Transport stops vanish when zooming in:** MapLibre requests native tiles up to source
> `maxzoom` (web uses 22). Martin transport views must declare `maxzoom: 22` in
> [`config.yaml`](./config.yaml) / [`config.local.yaml`](./config.local.yaml). If Martin still
> serves the old default ~z14 pyramid, restart/redeploy Martin after config changes. A stale
> container started before `maxzoom: 22` was added will keep the old tile pyramid until restarted.

> **PostGIS &lt; 3.5:** Martin logs a warning when Supabase PostGIS is below 3.5. Some geometries
> can be missing at certain zooms. Upgrade PostGIS when possible.

> **If popups show `properties: {}`, check that selected columns are included in Martin config.**
> Explicit table sources (e.g. [`config.local.yaml`](./config.local.yaml)) only emit geometry + `id_column`
> unless each source lists a `properties:` map (`column: postgres_type`). Add the columns you need there
> and restart Martin. Verify with the source TileJSON (`/<source>` should show non-empty `fields`).

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

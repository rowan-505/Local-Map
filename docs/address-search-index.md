# search.address_index

Generated search table for fast partial/full address lookup without scanning `core.core_addresses` + components on every query.

## Schema

Table: `search.address_index` (migration `048_search_address_index.sql`)

| Column | Role |
|--------|------|
| `address_id` | FK → `core.core_addresses` |
| `language_code` | `en`, `my`, or `und` (neutral-only line) |
| `search_text` | Composed comma-separated line for ILIKE/trigram |
| `search_tokens` | `text[]` from `search.tokenize_search_text()` |
| `house_number`, `street_text`, `admin_text`, `postcode` | Field-level search + ranking hints |
| `point_geom` | `COALESCE(entrance_geom, point_geom)` |
| `admin_area_id`, `street_id` | Optional filters |
| `rank_score` | Simple static boost (verified, house #, links) |

**Rows per address:** one `en`, one `my`, optional `und` when neutral components exist.

**Source:** `core.core_address_components` (primary), fallbacks from `core.core_addresses`, `core.core_streets`, `core.core_admin_areas`.

## Refresh

```sql
-- Full rebuild
SELECT search.refresh_address_index(NULL);

-- After editing one address
SELECT search.refresh_address_index(ARRAY[123456789]::bigint[]);
```

API hooks (non-blocking on failure):

- `CoreReviewAddressesWriteService` after component patch / create / update
- `import-review` address promotion after successful promote batch

## API

```http
GET /addresses/search?q=thanlyin&lang=en&limit=10
GET /addresses/search?q=11301&lang=en&admin_area_id=42
```

### Example response

```json
{
  "q": "thanlyin",
  "lang": "en",
  "count": 2,
  "results": [
    {
      "address_id": "a1b2c3d4-....",
      "language_code": "en",
      "search_text": "12, Thanlyin-KyaukTan Road, Kyauktan Township, Yangon Region",
      "display_address": "12, Thanlyin-KyaukTan Road, Kyauktan Township, Yangon Region",
      "house_number": "12",
      "street_text": "Thanlyin-KyaukTan Road",
      "admin_text": "Kyauktan Township, Yangon Region",
      "postcode": null,
      "rank_score": 63,
      "match_priority": 2,
      "point_geom": { "type": "Point", "coordinates": [96.32, 16.63] }
    }
  ]
}
```

`match_priority`: `0` house exact, `1` postcode exact, `2` street partial, `3` full line, `4` admin partial, `5` other.

## Verification queries

```sql
-- Row counts by language
SELECT language_code, count(*) FROM search.address_index GROUP BY 1 ORDER BY 1;

-- Sample indexed lines
SELECT address_id, language_code, left(search_text, 80), rank_score
FROM search.address_index
ORDER BY updated_at DESC
LIMIT 20;

-- Trigram index present (optional)
SELECT indexname FROM pg_indexes
WHERE schemaname = 'search' AND tablename = 'address_index';

-- Manual search simulation
SELECT ai.search_text, ai.rank_score
FROM search.address_index ai
WHERE ai.language_code IN ('en', 'und')
  AND ai.search_text ILIKE '%kyauktan%'
ORDER BY ai.rank_score DESC
LIMIT 10;
```

```bash
curl -sS "http://localhost:3001/addresses/search?q=kyauktan&lang=en&limit=5" | jq .
```

## Notes

- `search.search_addresses` (migration 023) remains legacy; new work uses `search.address_index`.
- Index is **not** edited from the dashboard; always refresh from core truth.
- Ranking is intentionally simple in V1; improve later with popularity, distance, or ts_rank.

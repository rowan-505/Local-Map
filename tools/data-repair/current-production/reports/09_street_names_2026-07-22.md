# Prompt 9 — Street names (2026-07-22)

## Inspect

| Metric | Count |
| --- | ---: |
| `generated_label` present | 796,345 |
| OSM `name` tag present | 25,215 |
| `canonical_name` ~ `^road-[0-9]+$` | 796,727 |
| Real named (OSM name, no generated_label) | 25,215 |
| `core_street_names` road-N placeholders | 0 |

## Apply

- Marked `normalized_data.name_is_generated = true` on **796,342** streets (batched 25k ID ranges).
- Remaining unflagged with `generated_label`: **0** (3 skipped likely `manual_override`).
- `core_street_names` road-N → `name_type=generated`: **0** rows needed.

## Search policy (no rebuild now)

Existing `search.v_search_street_groups_source` already excludes:

- `canonical_name ~ '^road-[0-9]+$'`
- `name_type = 'generated'`

**Later search rebuild** should also exclude rows where
`coalesce((normalized_data->>'name_is_generated')::boolean, false)`
or prefer OSM/`core_street_names` real names only.

## Verify

| Metric | Count |
| --- | ---: |
| flagged `name_is_generated` | 796,342 |
| canonical placeholders | 796,727 |
| has OSM name | 25,215 |

No search rebuild. Production name distinction is ready for Baseline v1.

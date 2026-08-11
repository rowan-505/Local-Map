# Search quality golden queries

Curated regression scenarios for public unified search ranking.

## Why this exists

Ranking and index changes can silently break important Myanmar searches. The golden suite catches regressions early without requiring exact score snapshots or a live database.

## How it works

Tests live in:

- `apps/api/src/modules/public-map/search-quality-golden-queries.ts` — curated scenarios
- `apps/api/src/modules/public-map/search-quality-golden.ts` — ranking + assertions
- `apps/api/src/modules/public-map/search-quality.test.ts` — runner

Each scenario builds synthetic candidate rows and ranks them with the same TypeScript ranking logic used by production SQL (`explainUnifiedSearchScore`).

This matches the existing public-search test style (fixture-based, no Postgres in CI).

## Run

```bash
npm --prefix apps/api run test:search-quality
```

Run the wider search unit suite:

```bash
npm --prefix apps/api run test:search-suite
```

## Add a new golden query

1. Open `search-quality-golden-queries.ts`.
2. Append a `GoldenSearchQueryScenario` object.
3. Give each candidate a stable `id` (for assertions), `entityType`, `entityId`, and `doc` fields used by ranking.
4. Mark deleted/ghost rows with `excludedFromResults: true` (simulates `is_active` / `is_public` SQL filters).
5. Add expectations:
   - `requiredInTop`: entity must appear in top N (default 3)
   - `forbiddenIds`: entity must not appear at all
   - `outranks`: winner must rank above loser
   - `minEligible` / `maxEligible`: relevance threshold checks
   - `minFinalScore`: only when truly necessary (avoid brittle score locks)
6. Run `npm --prefix apps/api run test:search-quality`.

### Example

```ts
{
    name: "english example place beats weak fuzzy stop",
    query: "example",
    candidates: [
        {
            id: "example-place",
            entityType: "place",
            entityId: "9001",
            displayName: "Example",
            doc: {
                displayName: "Example",
                entityType: "place",
                trigramSimilarity: 0.5,
                isVerified: true,
            },
        },
        {
            id: "example-weak-stop",
            entityType: "transport_stop",
            entityId: "9002",
            displayName: "Near Example Road",
            doc: {
                displayName: "Near Example Road",
                entityType: "transport_stop",
                trigramSimilarity: 0.22,
            },
        },
    ],
    expect: {
        requiredInTop: [{ id: "example-place", topN: 2 }],
        outranks: [{ winnerId: "example-place", loserId: "example-weak-stop" }],
    },
},
```

## Assertion guidelines

Prefer:

- expected entity in top 3
- deleted/ghost entity absent
- verified admin area outranks weak fuzzy stop

Avoid:

- exact final score values unless there is no stable alternative
- depending on real production entity ids

## Optional DB-backed checks

The golden suite is intentionally DB-free. For full-index validation after rebuilds, use:

```bash
npm --prefix apps/api run verify:search-index
npm --prefix apps/api run search:reconcile
```

Manual curl QA examples remain in `docs/archive/old-docs/search-system-qa.md`.

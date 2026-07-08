---
status: current
last_reviewed: 2026-07-01
owner: CoreMap
scope: V2 production goals and implementation order
---

# V2 plan

Canonical source: [`AGENTS.md`](../../AGENTS.md) (sections *Product Direction*, *V2 Feature Guidance*, *Implementation Order*).

## V2 goals (summary)

- National Myanmar basemap (PMTiles)
- Yangon + Kyauktan precision tiers
- Whole-country Valhalla routing
- YBS + express bus route viewing
- Unified search
- Address + reverse address
- Auth, saved places, reports, manual admin points
- Live location sharing (time-limited)
- Full dashboard operational control

## Implementation order (default)

1. Production security foundation
2. National PMTiles + tile package registry
3. Auth + permissions + saved places
4. Contributions + manual admin points
5. Unified search
6. Address system
7. Whole-country Valhalla routing
8. YBS + express route system
9. Live location sharing

## Missing doc

**Needs verification:** `AGENTS.md` references `V2_PRODUCTION_IMPLEMENTATION_PLAN.md` but this file is **not present** in the repository. Use `AGENTS.md` as the canonical V2 plan until that file is added.

## Related docs

- [V1 status](v1-status.md)
- [Future ideas](future-ideas.md)
- [Architecture](../00-overview/architecture.md)
